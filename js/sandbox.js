// ─── 沙箱：隔离代码执行 + 虚拟文件系统 ────────────────────────────────
// JS 沙箱：独立 Web Worker，无 DOM/fetch 访问面，超时强制 terminate
// Python 沙箱：Pyodide（WASM）跑在独立 Worker 中，可终止；CDN 加载失败时优雅降级

import { APP_VERSION, SANDBOX_JS_STARTUP_TIMEOUT_MS, SANDBOX_JS_TIMEOUT_MS, SANDBOX_PY_TIMEOUT_MS, SANDBOX_PY_STARTUP_TIMEOUT_MS } from './config.js?v=2026.10.25.1';
import { SANDBOX_STORAGE_CAP } from './storagefmt.js';

// ── 虚拟文件系统（会话级，随 state 持久化）─────────────────────────────
// 内部文件前缀：长久保存但用户不直接查看（识图 OCR/联网缓存/元数据等）；
// 工作区（uploads/、outputs/ 及用户主动写入的路径）对用户可见。
const WS_INTERNAL_PREFIXES = ['internal/', '.git/'];
// P2 修正：临时沙箱提交白名单。这些前缀下的文件是「整文件写入的工具副产物 / 用户上传 / 跨域拉取」，
// 不是模型自由创建的半截产物——回合结束无条件写回 baseFS，不再看最终回答有没有提到路径。
// 以前 fetch_url 落盘的 internal/web/*.md、analyze_* 的 internal/ocr/*.md 全靠「回答里碰巧出现文件名」才能活过本轮。
export const TEMP_PERSIST_PREFIXES = Object.freeze(['internal/', 'uploads/']);
export function isAlwaysPersistedPath(p) {
  const s = String(p || '');
  return TEMP_PERSIST_PREFIXES.some((pref) => s.startsWith(pref));
}
// 工具结果里的持久性说明：让「已写入 X」这句话带上契约，而不是让模型 / 用户猜
export function persistenceNote(fs, path) {
  if (!fs || fs._isTemp !== true) return '';
  return isAlwaysPersistedPath(path) ? '（已持久）' : fs.cleanupUnreferencedFiles ? '（自动清理已开启：若最终回答未引用，本轮结束后将删除）' : '（默认保留；可在设置中开启未引用文件自动清理）';
}
const FS_MAX_PATH = 512;
const FS_MAX_FILES = 5000;

export function normalizeSandboxTimeoutMs(value, fallbackMs = SANDBOX_JS_TIMEOUT_MS) {
  if (value == null || value === '') return fallbackMs;
  const requested = Number(value);
  return Number.isFinite(requested)
    ? Math.max(1000, Math.min(600000, Math.floor(requested)))
    : fallbackMs;
}

// 路径合法性：相对路径、无反斜杠 / 控制字符、无空段 / . / ..、不允许原型键，长度 ≤ 512
// 文件真实字节数：data URL 按 base64 反推（去掉填充），文本按 UTF-8 编码长度。
// 以前 list() 直接给 String(c).length —— 图片 / 视频 / PDF 的 data URL 会虚高 1/3，中文文本则偏小；
// list_files 工具、系统提示里的「当前沙箱文件」与文件面板都从这里取数，必须是真实体积。
// 按（路径 → 内容引用）缓存：同一引用直接命中，避免每次刷新文件面板都对大文件重新编码。
const sizeCache = new Map();
const utf8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const utf8ByteSize = (value) => {
  const text = String(value == null ? '' : value);
  return utf8 ? utf8.encode(text).length : text.length;
};
export function contentByteSize(content) {
  const str = String(content == null ? '' : content);
  if (str.startsWith('data:')) {
    const comma = str.indexOf(',');
    if (comma > 0 && comma < 256 && /;base64/i.test(str.slice(0, comma))) {
      const body = str.length - comma - 1;
      let pad = 0;
      if (str.endsWith('==')) pad = 2; else if (str.endsWith('=')) pad = 1;
      return Math.max(0, Math.floor(body * 3 / 4) - pad);
    }
  }
  if (!utf8) return str.length;
  // 纯 ASCII 快速路径：长度即字节数（绝大多数代码 / JSON / CSV 命中）
  // eslint-disable-next-line no-control-regex
  if (str.length < 4096 && !/[^\x00-\x7f]/.test(str)) return str.length;
  return utf8.encode(str).length;
}
function cachedSize(path, content) {
  const hit = sizeCache.get(path);
  if (hit && hit.content === content) return hit.size;
  const size = contentByteSize(content);
  if (sizeCache.size > 4096) sizeCache.clear();
  sizeCache.set(path, { content, size });
  return size;
}

export function isSafeFsPath(path) {
  const p = String(path == null ? '' : path);
  if (!p || p.length > FS_MAX_PATH) return false;
  if (p.startsWith('/') || p.includes('\\') || /[\u0000-\u001f\u007f]/.test(p)) return false;
  const parts = p.split('/');
  return !parts.some((seg) => !seg || seg === '.' || seg === '..' || seg === '__proto__' || seg === 'constructor' || seg === 'prototype');
}

// 把沙箱 Worker 回传的 files 快照合并回真实文件系统（Worker 代码可能是对抗性的）：
//   · 键必须通过 isSafeFsPath；值必须是字符串
//   · internal/ 与 .git/ 为受保护前缀：Worker 不能新增、修改或删除（保留 before 里的版本）
//   · 总量不得超过 SANDBOX_STORAGE_CAP、文件数不得超过 FS_MAX_FILES；超限时整体拒收，保留 before
export function sanitizeWorkerFiles(before, after, { cap = SANDBOX_STORAGE_CAP, maxFiles = FS_MAX_FILES } = {}) {
  const prev = before && typeof before === 'object' ? before : {};
  const next = after && typeof after === 'object' ? after : {};
  const out = Object.create(null);
  const rejected = [];
  const isProtected = (k) => WS_INTERNAL_PREFIXES.some((pref) => k.startsWith(pref));
  // 受保护文件原样保留
  for (const k of Object.keys(prev)) if (isProtected(k)) out[k] = prev[k];
  let total = Object.values(out).reduce((n, v) => n + contentByteSize(v), 0);
  let count = Object.keys(out).length;
  for (const k of Object.keys(next)) {
    if (isProtected(k)) { if (!(k in prev) || prev[k] !== next[k]) rejected.push({ path: k, reason: 'protected' }); continue; }
    if (!isSafeFsPath(k)) { rejected.push({ path: k, reason: 'unsafe-path' }); continue; }
    const v = next[k];
    if (typeof v !== 'string') { rejected.push({ path: k, reason: 'non-string' }); continue; }
    out[k] = v;
    total += contentByteSize(v);
    count += 1;
  }
  if (total > cap || count > maxFiles) {
    return { ok: false, files: { ...prev }, rejected, reason: total > cap ? `沙箱输出 ${(total / 1048576).toFixed(1)} MB 超过容量上限 ${(cap / 1048576).toFixed(0)} MB` : `文件数 ${count} 超过上限 ${maxFiles}`, total, count };
  }
  return { ok: true, files: { ...out }, rejected, total, count };
}

// 把 Worker 跑完后的文件镜像写回会话文件系统——按「差异」写，而不是 clear() + import()。
// 根因（V1.7 → .28 一直存在）：每轮工具拿到的是 createTempFS 临时层，它的 import() 是空操作、clear() 会清掉本轮所有写入，
// 于是任何一次 execute_javascript / execute_python 都会：① 把本轮 write_file 写的文件清空 ② 丢掉沙箱代码自己写的 files。
// 表现就是「write_file 成功 → 下一个 JS 调用 files_keys: []」「同调用能回读 files/probe.txt，下一调用就没了」。
// 差异写法对真实 FS（createFS）与临时层（createTempFS）语义一致：新增 / 修改 → write，Worker 里删掉的 → remove。
export function applyWorkerFiles(fsObj, before, after) {
  const r = sanitizeWorkerFiles(before, after);
  if (!r.ok) return r;
  const prev = before && typeof before === 'object' ? before : {};
  let written = 0, removed = 0;
  for (const k of Object.keys(r.files)) {
    if (!Object.prototype.hasOwnProperty.call(prev, k) || prev[k] !== r.files[k]) {
      try { fsObj.write(k, r.files[k]); written += 1; } catch (err) { r.rejected.push({ path: k, reason: `write-failed: ${err && err.message || err}` }); }
    }
  }
  for (const k of Object.keys(prev)) {
    if (!Object.prototype.hasOwnProperty.call(r.files, k) && typeof fsObj.remove === 'function') {
      try { fsObj.remove(k); removed += 1; } catch { /* 删不掉就保留 */ }
    }
  }
  return { ...r, written, removed };
}

function noteWorkerFiles(out, r) {
  if (!r) return out;
  const notes = [];
  if (!r.ok) notes.push(`[沙箱] ${r.reason}，本次对文件的修改已全部丢弃`);
  if (r.rejected.length) {
    const why = { protected: '受保护路径', 'unsafe-path': '非法路径', 'non-string': '值不是字符串' };
    notes.push(`[沙箱] 已拒绝 ${r.rejected.length} 个文件写入：${r.rejected.slice(0, 5).map((x) => `${x.path}（${why[x.reason] || x.reason}）`).join('；')}${r.rejected.length > 5 ? ' …' : ''}`);
  }
  if (!notes.length) return out;
  return { ...out, logs: [...(out.logs || []), ...notes.map((text) => ({ level: 'warn', text }))], filesRejected: r.rejected.length, filesDropped: !r.ok };
}

export function createFS(initial = {}) {
  const files = Object.create(null);
  for (const [k, v] of Object.entries(initial || {})) files[k] = v;
  const has = (p) => Object.prototype.hasOwnProperty.call(files, p);
  return {
    read(path) {
      const p = String(path);
      if (!has(p)) throw new Error(`文件不存在: ${path}`);
      return files[p];
    },
    write(path, content) {
      const p = String(path || '');
      if (!isSafeFsPath(p)) throw new Error(`非法路径: ${p}`);
      files[p] = String(content);
    },
    remove(path) {
      const p = String(path || '');
      if (!isSafeFsPath(p)) return;
      delete files[p];
    },
    list() {
      return Object.entries(files).map(([path, c]) => ({ path, size: cachedSize(path, c) }));
    },
    export() { return { ...files }; },
    import(obj) { for (const [k, v] of Object.entries(obj || {})) { if (isSafeFsPath(k)) files[k] = String(v); } },
    clear() { for (const k of Object.keys(files)) delete files[k]; },
    // 清空工作区（保留内部文件 internal/ 与元数据 .git/）
    clearWorkspace() {
      for (const k of Object.keys(files)) {
        if (WS_INTERNAL_PREFIXES.some((pref) => k.startsWith(pref))) continue;
        delete files[k];
      }
    },
    // 只列出工作区文件（过滤 internal/ 与 .git/）
    listWorkspace() {
      return this.list().filter(({ path }) => !WS_INTERNAL_PREFIXES.some((pref) => path.startsWith(pref)));
    },
    isInternalPath(p) { return WS_INTERNAL_PREFIXES.some((pref) => String(p).startsWith(pref)); },
    has(path) { return has(String(path)); },
    keys() { return Object.keys(files); },
  };
}

// Retain local HTML/CSS/JS resource closures when the answer links only the entry.
export function websiteDependencies(files, entries) {
  const kept = new Set(), queue = [...entries];
  while (queue.length && kept.size < 512) {
    const path = queue.shift();
    if (kept.has(path) || !Object.hasOwn(files, path) || !isSafeFsPath(path) || /^internal\//.test(path)) continue;
    kept.add(path);
    if (!/\.(?:html?|css|js|mjs|svg)$/i.test(path)) continue;
    const source = String(files[path]).slice(0, 1024 * 1024), refs = [];
    for (const re of [/(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi, /url\(\s*["']?([^\s"')]+)["']?\s*\)/gi,
      /(?:\b(?:import|export)[^;\n]{0,160}?\bfrom\s*|\bimport\s*(?:\(|\s)|\b(?:fetch|URL)\s*\()\s*["']([^"']+)["']/gi]) {
      let match; while ((match = re.exec(source))) refs.push(match[1]);
    }
    for (const ref of refs) {
      if (!ref || /^[a-z][\w+.-]*:|^\/|^#/i.test(ref)) continue;
      try {
        const url = new URL(ref.replace(/&amp;/g, '&'), 'https://sandbox.invalid/' + path);
        const dep = decodeURIComponent(url.pathname.slice(1));
        if (url.origin === 'https://sandbox.invalid' && isSafeFsPath(dep)) queue.push(dep.endsWith('/') ? dep + 'index.html' : dep);
      } catch { /* invalid/remote resources are not deliverables */ }
    }
  }
  return kept;
}

// ── 临时沙箱（ephemeral overlay）：任务期间 Agent 写的文件先落在临时层。
//    默认回合结束后全部保留；只有用户在设置中显式开启自动清理，才会删除未被最终回答引用的产物。
//    internal/ 与 uploads/ 始终保留；用户通过文件工具主动删除的既有文件照常删除。
export function createTempFS(baseFS, { cleanupUnreferencedFiles = false } = {}) {
  const ephemeral = {}; // 本轮临时写的文件
  const projectGroups = new Map();
  const deletedInEphemeral = new Set(); // 本轮主动删除的基文件
  const fs = {
    cleanupUnreferencedFiles: cleanupUnreferencedFiles === true,
    read(path) {
      const p = String(path);
      if (deletedInEphemeral.has(p)) throw new Error(`文件不存在: ${p}`);
      if (Object.prototype.hasOwnProperty.call(ephemeral, p)) return ephemeral[p];
      return baseFS.read(p);
    },
    write(path, content) {
      const p = String(path || '');
      const parts = p.split('/');
      if (!p || p.startsWith('/') || p.includes('\\') || p.includes('\0')
          || parts.some((seg) => !seg || seg === '.' || seg === '..')) {
        throw new Error(`非法路径: ${p}`);
      }
      ephemeral[p] = String(content);
      deletedInEphemeral.delete(p);
    },
    remove(path) {
      const p = String(path || '');
      if (p.startsWith('/') || p.includes('\0')) return;
      // 临时层删
      delete ephemeral[p];
      // 如果基文件里也有，标记删除
      try { if (baseFS.has(p)) deletedInEphemeral.add(p); } catch { /* noop */ }
    },
    list() {
      const seen = new Set();
      const out = [];
      // 先列临时层
      for (const [path, c] of Object.entries(ephemeral)) {
        seen.add(path);
        out.push({ path, size: cachedSize(path, c) });
      }
      // 再列基文件（剔除被删/被临时覆盖的）
      for (const e of baseFS.list()) {
        if (seen.has(e.path) || deletedInEphemeral.has(e.path)) continue;
        out.push(e);
      }
      return out;
    },
    export() {
      const all = {};
      try { Object.assign(all, baseFS.export()); } catch { /* noop */ }
      for (const k of deletedInEphemeral) delete all[k];
      Object.assign(all, ephemeral);
      return all;
    },
    import(/* obj */) { /* 不允许批量导入临时层 */ },
    clear() {
      for (const k of Object.keys(ephemeral)) delete ephemeral[k];
      deletedInEphemeral.clear();
    },
    clearWorkspace() {
      // 临时层：非内部的删除，内部保留
      for (const k of Object.keys(ephemeral)) {
        if (!WS_INTERNAL_PREFIXES.some((pref) => k.startsWith(pref))) delete ephemeral[k];
      }
      // 基文件：委托基 fs
      try {
        if (baseFS.clearWorkspace) baseFS.clearWorkspace();
        else for (const k of (baseFS.keys ? baseFS.keys() : [])) {
          if (!WS_INTERNAL_PREFIXES.some((pref) => k.startsWith(pref))) { baseFS.remove(k); deletedInEphemeral.delete(k); }
        }
      } catch { /* noop */ }
    },
    listWorkspace() {
      return this.list().filter(({ path }) => !WS_INTERNAL_PREFIXES.some((pref) => path.startsWith(pref)));
    },
    isInternalPath(p) { return WS_INTERNAL_PREFIXES.some((pref) => String(p).startsWith(pref)); },
    has(path) {
      const p = String(path);
      if (deletedInEphemeral.has(p)) return false;
      if (Object.prototype.hasOwnProperty.call(ephemeral, p)) return true;
      return !!baseFS.has && baseFS.has(p);
    },
    keys() {
      const s = new Set();
      for (const k of Object.keys(ephemeral)) s.add(k);
      try { for (const k of baseFS.keys()) if (!deletedInEphemeral.has(k)) s.add(k); } catch { /* noop */ }
      return [...s];
    },
    retainProject(entry, paths) {
      if (isSafeFsPath(entry) && Array.isArray(paths) && paths.length <= 512)
        projectGroups.set(entry, paths.filter((p) => isSafeFsPath(p) && !/^internal\//.test(p)));
    },
    // 提交：默认保留全部写入；仅在设置显式开启自动清理时才丢弃未引用文件。
    commitAnswer(answerText) {
      const text = String(answerText || '');
      const committed = [];
      const discarded = [];
      // 1) 把被标记删除的基文件真正从 baseFS 删除
      for (const p of deletedInEphemeral) {
        try { baseFS.remove(p); } catch { /* noop */ }
      }
      // 2) 判断临时文件是否在回答里被引用/展示
      const looksReferenced = (path) => {
        // 直接路径字符串出现
        if (text.includes(path)) return true;
        // data-sb-open / data-sb-dl 属性在 HTML 里 → 以 `path` 或 `"path"` 出现
        // （renderMarkdown 后的 HTML 中路径会被包进属性值）
        const esc1 = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 如果生成了 HTML 预览，路径会在 data-sb-open="${path}" 中
        if (new RegExp(`data-sb-(?:open|dl)="${esc1}"`).test(text)) return true;
        // 文件名（basename）在回答中出现且路径本身不晦涩：视为交付物
        const base = path.split('/').pop();
        if (base && /\.(png|jpg|jpeg|gif|svg|webp|pdf|docx|xlsx|pptx|zip|html|md|csv|json|txt)$/i.test(base)
            && text.includes(base)) return true;
        return false;
      };
      const snapshot = this.export();
      const entries = Object.keys(snapshot).filter((p) => /\.html?$/i.test(p) && looksReferenced(p));
      const dependencies = websiteDependencies(snapshot, entries);
      for (const [entry, paths] of projectGroups) if (looksReferenced(entry)) for (const p of paths) dependencies.add(p);
      for (const [p, c] of Object.entries(ephemeral)) {
        // 白名单前缀（internal/ · uploads/）始终保留；用户未开启自动清理时所有文件都提交。
        if (!this.cleanupUnreferencedFiles || isAlwaysPersistedPath(p) || looksReferenced(p) || dependencies.has(p)) {
          try { baseFS.write(p, c); committed.push(p); } catch { /* noop */ }
        } else {
          discarded.push(p);
        }
      }
      // 清理临时层
      this.clear(); projectGroups.clear();
      return { committed, discarded };
    },
    // 任务中止 / 失败时清理临时层；默认保留写入，只有用户开启自动清理才丢弃自由路径产物。
    // 白名单前缀下的抓取全文 / 识图结果 / 下载件始终保留。
    discard() {
      const committed = [];
      const discarded = [];
      for (const [p, c] of Object.entries(ephemeral)) {
        if (!this.cleanupUnreferencedFiles || isAlwaysPersistedPath(p)) {
          try { baseFS.write(p, c); committed.push(p); continue; } catch { /* 写不进去就按丢弃记 */ }
        }
        discarded.push(p);
      }
      this.clear(); projectGroups.clear();
      return { committed, discarded };
    },
    _isTemp: true,
  };
  return fs;
}

let pyodideBroken = false; // CDN 加载失败后不再尝试
export function pythonAvailable() { return !pyodideBroken; }

// Package history is not a requirements file. Only the current invocation's
// explicit packages are sent; the resident Worker reuses already-loaded modules.
export function pythonPackagesForRun(packages) {
  return [...new Set((Array.isArray(packages) ? packages : [])
    .filter((p) => typeof p === 'string').map((p) => p.trim()).filter(Boolean))];
}

// ── Worker 创建：同源文件优先，blob 兜底 ───────────────────────────────
// 背景：部分宿主页面（如预览 iframe）的 CSP 不允许 blob: Worker，
// 直接 new Worker(blobURL) 会触发 onerror（message 为空、瞬间失败）。
// 因此优先加载同源真实文件 js/worker-*.js（CSP 'self' 放行），
// 文件加载再失败时，取源码文本回退为 blob Worker，仍失败则给出明确诊断。
// rpc：{ method: async (params) => result }——主线程替沙箱做它自己做不了的事（目前只有受控 fetch）。
// 通道是 MessageChannel 的一端，随首条消息 transfer 给 Worker；Worker 侧把它关在闭包里，用户代码拿不到。
// ── 首次启动预热（2026.10.11.1）──────────────────────────────────────────────
// 症状：首次 execute_javascript 偶发「未在 12s 内就绪」。原因是冷启动要现场下载
// worker-js.js + worker-shims.js（缓存未命中或弱网/慢设备），启动预算被网络吃光。
// 处理：应用空闲时先把脚本取进 HTTP 缓存，并预先拉起一个「等待载荷」的 Worker 实例；
// 首次真正执行直接接管这个已就绪实例，冷启动成本不再落在用户那一次点击上。
// 预算本身不动（启动 12s / 执行 8s 的分账保持原样），只是让启动不再需要花时间。
// 版本化 URL：Worker 脚本与垫片都带 ?v=，避免 CDN/浏览器缓存拿到旧版本
const versionedURL = (name) => { const u = new URL(name, import.meta.url); u.searchParams.set('v', APP_VERSION); return u; };
const WARM_TTL_MS = 5 * 60 * 1000;
const WARM_SCRIPTS = ['worker-shims.js', 'worker-js.js'];
let warmWorker = null; // { worker, dispose, at, ready }
function discardWarmWorker() {
  if (!warmWorker) return;
  try { warmWorker.worker.terminate(); } catch { /* 已关闭 */ }
  try { warmWorker.dispose?.(); } catch { /* 已释放 */ }
  warmWorker = null;
}
export function warmSandboxWorker() {
  if (typeof Worker !== 'function' || typeof fetch !== 'function') return false;
  if (warmWorker && Date.now() - warmWorker.at < WARM_TTL_MS) return true;
  discardWarmWorker();
  // 先取进缓存：即便预热实例被浏览器回收，脚本也已经在缓存里了（force-cache 命中就别再等网络）。
  for (const name of WARM_SCRIPTS) {
    try { fetch(versionedURL(name), { cache: 'force-cache' }).catch(() => {}); } catch { /* 忽略 */ }
  }
  let worker, dispose = () => {};
  try {
    worker = new Worker(versionedURL(WARM_SCRIPTS[1]));
    worker.onerror = () => { if (warmWorker && warmWorker.worker === worker) discardWarmWorker(); };
    worker.onmessage = (e) => {
      const data = e.data;
      const parsed = typeof data === 'string' ? (() => { try { return JSON.parse(data); } catch { return null; } })() : data;
      if (warmWorker && warmWorker.worker === worker && parsed?.__dubheReady === 'js-runtime-2') warmWorker.ready = true;
    };
  } catch (err) {
    // 预热失败不影响功能（真正执行时仍走原来的冷启动路径），只留一条可诊断的日志
    try { console.info('[sandbox] Worker 预热未成功：' + (err && err.message ? err.message : err)); } catch { /* 忽略 */ }
    return false;
  }
  warmWorker = { worker, dispose, at: Date.now(), ready: false };
  return true;
}
export function releaseWarmSandboxWorker() { discardWarmWorker(); }

function runInWorker(workerFile, payload, timeoutMs, {
  rpc = null, extraScripts = [], onOutput = null, onPhase = null, signal = null,
  readyToken = 'js-runtime-2', workerType = 'classic', allowBlobFallback = true,
  startupTimeoutMs = SANDBOX_JS_STARTUP_TIMEOUT_MS, executionTimeoutPhase = '',
  preExecutionTimeoutMs = 0, timeoutMessage = '', preExecutionTimeoutMessage = '', onProgress = null,
} = {}) {
  return new Promise((resolve) => {
    let settled = false, active = null, triedBlob = false, started = false;
    let execTimer = null, attemptTimer = null;
    const fetchAbort = new AbortController();
    const sourceURL = versionedURL;
    const canUseBlobFallback = allowBlobFallback === true && workerType !== 'module';
    const timeoutResult = (message) => finish({ ok: false, timedOut: true, logs: [], files: payload.files || {},
      error: { message } });
    const armProgramTimeout = () => {
      clearTimeout(execTimer);
      execTimer = setTimeout(() => timeoutResult(timeoutMessage || `执行超时（>${Math.round(timeoutMs / 1000)}s），沙箱已强制终止`), timeoutMs);
    };
    const closeActive = () => {
      if (!active) return;
      try { active.worker.terminate(); active.port?.close(); } catch { /* closed */ }
      active.dispose(); active = null;
    };
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(bootTimer); clearTimeout(execTimer); clearTimeout(attemptTimer);
      fetchAbort.abort(); signal?.removeEventListener('abort', abort); closeActive();
      resolve({ ...v, started });
    };
    const bootstrapFail = (detail) => finish({ ok: false, bootstrapFailed: true, logs: [], files: payload.files || {},
      error: { message: `沙箱 Worker 启动失败：${detail}。代码尚未执行；请检查 CSP、网络或在独立标签页打开应用。` } });
    const abort = () => finish({ ok: false, aborted: true, logs: [], files: payload.files || {}, error: { message: '执行已停止' } });
    const bootTimer = setTimeout(() => bootstrapFail(`未在 ${startupTimeoutMs / 1000}s 内就绪`), startupTimeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    onPhase?.('bootstrap');
    const spawn = async (useBlob) => {
      if (settled) return;
      if (!useBlob) closeActive();
      clearTimeout(attemptTimer);
      let worker, dispose = () => {}, adoptedReady = false;
      try {
        // 预热实例：同一份 worker-js.js、还在 TTL 内 → 直接接管，省掉整个冷启动窗口。
        // worker-js.js 自己会 importScripts 垫片，所以只要请求的就是它（外加允许的垫片），预热实例即可直接接管。
        const warmCompatible = workerFile === WARM_SCRIPTS[1] && (extraScripts || []).every((f) => WARM_SCRIPTS.includes(f));
        if (!useBlob && warmCompatible && warmWorker && warmWorker.worker && Date.now() - warmWorker.at < WARM_TTL_MS) {
          worker = warmWorker.worker; dispose = warmWorker.dispose; adoptedReady = !!warmWorker.ready;
          warmWorker = null;
        } else if (useBlob) {
          if (workerType === 'module') throw new Error('ES module Worker does not support the classic Blob fallback');
          const fetchText = async (name) => { const r = await fetch(sourceURL(name), { signal: fetchAbort.signal, cache: 'reload' }); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return r.text(); };
          const texts = await Promise.all([...extraScripts, workerFile].map(fetchText));
          if (settled || started) return;
          const url = URL.createObjectURL(new Blob([texts.join('\n;\n')], { type: 'text/javascript' }));
          dispose = () => URL.revokeObjectURL(url); worker = new Worker(url);
        } else worker = new Worker(sourceURL(workerFile), workerType === 'module' ? { type: 'module' } : undefined);
      } catch (err) {
        dispose();
        if (settled || started) return;
        if (!useBlob && !triedBlob && canUseBlobFallback) { triedBlob = true; return spawn(true); }
        return bootstrapFail(String(err.message || err));
      }
      if (settled) { worker.terminate(); dispose(); return; }
      closeActive();
      const mine = { worker, dispose, port: null, sent: false }; active = mine;
      const start = () => {
        if (settled || active !== mine || mine.sent) return;
        mine.sent = true; started = true;
        clearTimeout(bootTimer); clearTimeout(attemptTimer); fetchAbort.abort(); onPhase?.('executing');
        if (executionTimeoutPhase && preExecutionTimeoutMs > 0) {
          execTimer = setTimeout(() => timeoutResult(preExecutionTimeoutMessage || `编译准备超时（>${Math.round(preExecutionTimeoutMs / 1000)}s），沙箱已强制终止`), preExecutionTimeoutMs);
        } else armProgramTimeout();
        let transfer = [];
        if (rpc && typeof MessageChannel === 'function') {
          const channel = new MessageChannel(); mine.port = channel.port1; transfer = [channel.port2];
          channel.port1.onmessage = async (ev) => {
            if (settled || active !== mine) return;
            const d = ev.data || {}; let reply;
            try { reply = typeof rpc[d.method] === 'function' ? await rpc[d.method](d.params || {}) : { error: `沙箱 RPC 不支持 ${d.method}` }; }
            catch (err) { reply = { error: String(err.message || err).slice(0, 300) }; }
            if (!settled && active === mine) try { channel.port1.postMessage({ id: d.id, ...(reply && typeof reply === 'object' ? reply : { result: reply }) }); } catch { /* closed */ }
          };
        }
        try { worker.postMessage(payload, transfer); }
        catch (err) { started = false; bootstrapFail(`参数无法传入 Worker：${err.message}`); }
      };
      worker.onmessage = (e) => {
        if (settled || active !== mine) return;
        let data = e.data;
        if (typeof data === 'string') try { data = JSON.parse(data); } catch { return bootstrapFail('无法解析 Worker 的响应'); }
        if (data?.__dubheReady === readyToken) { start(); return; }
        if (data?.__phase) {
          onPhase?.(data.__phase);
          if (executionTimeoutPhase && data.__phase === executionTimeoutPhase) armProgramTimeout();
          return;
        }
        if (data?.__progress) { try { onProgress?.(data.__progress); } catch { /* 进度回调失败不影响执行 */ } return; }
        if (data?.__log) { onOutput?.(data.__log); return; }
        if (!mine.sent || !data || typeof data.ok !== 'boolean') return;
        finish(data);
      };
      worker.onmessageerror = () => !mine.sent ? bootstrapFail('无法读取启动握手') : finish({ ok: false, logs: [], error: { message: '沙箱 Worker 响应无法反序列化；执行结果丢失，请先核验文件状态。' } });
      worker.onerror = (e) => {
        if (settled || active !== mine) return;
        e.preventDefault?.();
        if (!mine.sent && !useBlob && !triedBlob && canUseBlobFallback) { triedBlob = true; return spawn(true); }
        const detail = [e.message, e.filename && `${e.filename.split('/').pop()}:${e.lineno}`].filter(Boolean).join(' @ ');
        if (!mine.sent) bootstrapFail(detail || '脚本被浏览器拒绝');
        else finish({ ok: false, logs: [], error: { message: `沙箱 Worker 执行失败：${detail || '运行时崩溃，结果丢失'}` } });
      };
      // 预热实例握手可能早于这里的监听器：直接开跑，不占启动预算。
      if (adoptedReady) { start(); return; }
      // Some WebKit/CSP failures never dispatch onerror. Fall back while the shared bootstrap deadline still has room.
      if (!useBlob && canUseBlobFallback) attemptTimer = setTimeout(() => { if (!settled && active === mine && !mine.sent) { triedBlob = true; spawn(true); } }, 6000);
    };
    spawn(false);
  });
}

// 对外统一执行接口：返回 { ok, logs, result, error, timedOut, durationMs, files }
// 沙箱内受控网络的上限：一次执行最多 8 次抓取、单次 ≤ 2 MB、累计 ≤ 6 MB——够拉几个 JSON / 一个 CDN 库，不够当爬虫
export const SANDBOX_NET_LIMITS = Object.freeze({ maxCalls: 8, maxBytesPerCall: 2 * 1024 * 1024, maxBytesTotal: 6 * 1024 * 1024 });
export function createSandboxNetRpc(net, limits = SANDBOX_NET_LIMITS) {
  if (!net || !net.enabled || typeof net.fetchPage !== 'function') return null;
  let calls = 0; let bytes = 0;
  return {
    async fetch({ url, mode } = {}) {
      if (++calls > limits.maxCalls) return { error: `沙箱内 fetch 次数超过上限（${limits.maxCalls} 次/次执行）` };
      const r = await net.fetchPage({ url: String(url || ''), mode: mode === 'text' ? 'text' : 'raw', maxBytes: limits.maxBytesPerCall, full: true, fs: null });
      if (!r || !r.ok) return { ok: false, status: (r && r.status) || 0, error: (r && r.error) || '抓取失败' };
      const text = String(r.text || '');
      bytes += utf8ByteSize(text);
      if (bytes > limits.maxBytesTotal) return { error: `沙箱内 fetch 累计字节超过上限（${Math.round(limits.maxBytesTotal / 1048576)} MB/次执行）` };
      return { ok: true, status: r.status || 200, url: r.url || url, contentType: r.contentType || '', text };
    },
  };
}

// opts.net = { enabled, fetchPage }：宿主是否放行沙箱内网络（顶栏联网开 + 中继可用），放行时由主线程代为抓取
export async function runJavaScript(code, fsObj, opts = {}) {
  const t0 = performance.now();
  const files = fsObj.export();
  const rpc = createSandboxNetRpc(opts.net);
  const timeoutMs = normalizeSandboxTimeoutMs(opts.timeoutMs, SANDBOX_JS_TIMEOUT_MS);
  let out = await runInWorker('worker-js.js', { code, files, net: { enabled: !!rpc, ...SANDBOX_NET_LIMITS } }, timeoutMs, { rpc, extraScripts: ['worker-shims.js'], signal: opts.signal, onOutput: opts.onOutput, onPhase: opts.onPhase });
  if (out.files && !out.timedOut) out = noteWorkerFiles(out, applyWorkerFiles(fsObj, files, out.files));
  return { ...out, durationMs: Math.round(performance.now() - t0) };
}

// ── Python：常驻 Worker（Pyodide 运行时只加载一次）─────────────────────
let pyWorker = null;
let pySyncedWorker = null; // 上次成功同步过镜像的 Worker 实例
let pySynced = null;       // 该 Worker 当前持有的镜像（{path: content}）
// 只传变化：引用相同的字符串比较是 O(1)，未改动的大文件不会被扫描
export function diffFiles(prev, next) {
  const set = {};
  const del = [];
  const p = prev || {};
  const n = next || {};
  for (const k of Object.keys(n)) if (!(k in p) || p[k] !== n[k]) set[k] = n[k];
  for (const k of Object.keys(p)) if (!(k in n)) del.push(k);
  return { set, del };
}
export function applyDelta(base, delta) {
  const out = { ...(base || {}) };
  const d = delta || {};
  for (const k of Object.keys(d.set || {})) out[k] = d.set[k];
  for (const k of (Array.isArray(d.del) ? d.del : [])) delete out[k];
  return out;
}
let pyBlobTried = false;
// Pyodide Worker 与文件镜像是模块级共享状态：子智能体可并发，但同一个运行时只能逐项执行。
let pyRunQueue = Promise.resolve();

async function runPythonNow(code, fsObj, onProgress, extraPkgs = [], opts = {}) {
  if (pyodideBroken) {
    return { ok: false, logs: [], error: { message: 'Pyodide 运行时不可用（CDN 加载失败），请改用 execute_javascript' }, durationMs: 0 };
  }
  const files = fsObj.export();
  const packages = pythonPackagesForRun(extraPkgs);
  const t0 = performance.now();
  // 增量同步：常驻 Worker 已持有上次镜像时只发 diff；Worker 重建 / 上次失败则发全量
  // 不论全量还是增量，Worker 应用完载荷后的镜像都恰好等于 files（delta = diff(镜像, files)）
  let usedWorker = null;
  let sentFull = true;
  const buildPayload = (worker) => {
    usedWorker = worker;
    if (worker === pySyncedWorker && pySynced) {
      sentFull = false;
      return { code, delta: diffFiles(pySynced, files), packages };
    }
    sentFull = true;
    return { code, files, packages };
  };

  const codeTimeoutMs = normalizeSandboxTimeoutMs(opts.timeoutMs, SANDBOX_PY_TIMEOUT_MS);

  const attempt = (useBlob) => new Promise((resolve) => {
    let settled = false;
    let worker = null;
    let workerBlobUrl = null;
    let timer = null;
    let phase = 'startup';
    const releaseBlobUrl = () => {
      const url = workerBlobUrl;
      if (!url) return;
      workerBlobUrl = null;
      try { URL.revokeObjectURL(url); } catch { /* 已释放或浏览器不支持 */ }
    };
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
      resolve(v);
    };
    const discardWorker = () => {
      try { worker?.terminate(); } catch { /* noop */ }
      releaseBlobUrl();
      if (pyWorker === worker) pyWorker = null;
      if (pySyncedWorker === worker) { pySyncedWorker = null; pySynced = null; }
    };
    const abort = () => {
      discardWorker();
      pySynced = null; pySyncedWorker = null;
      finish({ ok: false, aborted: true, logs: [], files, error: { message: '执行已停止' } });
    };
    const armTimeout = (nextPhase, ms) => {
      phase = nextPhase;
      clearTimeout(timer);
      timer = setTimeout(() => {
        discardWorker();
        const startup = phase === 'startup';
        finish({
          ok: false,
          timedOut: true,
          startupTimedOut: startup,
          stage: startup ? 'startup-timeout' : 'run',
          logs: [],
          files,
          error: { message: startup
            ? `Python 运行时准备超时（>${Math.round(SANDBOX_PY_STARTUP_TIMEOUT_MS / 1000)}s）：冷启动或依赖安装未能在准备窗口内完成，用户代码尚未开始。`
            : `用户代码执行超时（>${Math.round(codeTimeoutMs / 1000)}s），Python Worker 已强制终止` },
        });
      }, ms);
    };

    opts.signal?.addEventListener('abort', abort, { once: true });
    armTimeout('startup', SANDBOX_PY_STARTUP_TIMEOUT_MS);
    if (opts.signal?.aborted) { abort(); return; }

    const spawn = async () => {
      try {
        if (useBlob) {
          const res = await fetch(versionedURL('worker-py.js'));
          if (!res.ok) throw new Error(`无法获取沙箱脚本（HTTP ${res.status}）`);
          const source = await res.text();
          if (settled) return;
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          workerBlobUrl = url;
          worker = new Worker(url); // 常驻复用：后续 attempt(false) 直接拿到这个 blob Worker
          pyWorker = worker;
        } else {
          if (!pyWorker) pyWorker = new Worker(versionedURL('worker-py.js'));
          worker = pyWorker;
        }
        if (settled) { discardWorker(); return; }
        worker.onmessage = (e) => {
          if (settled) return;
          // 收到首帧即证明 Worker 已载入脚本；URL 可撤销，常驻 Worker 仍可继续执行。
          releaseBlobUrl();
          if (e.data?.__userCodeStart) { armTimeout('run', codeTimeoutMs); return; }
          if (e.data?.__log) { opts.onOutput?.(e.data.__log); return; }
          if (e.data && e.data.__progress) { onProgress && onProgress(String(e.data.__progress)); return; }
          finish(e.data);
        };
        worker.onerror = (e) => {
          if (settled) return;
          discardWorker();
          finish({ __workerError: e.message || '加载失败' });
        };
        worker.postMessage(buildPayload(worker));
      } catch (err) {
        if (!settled) {
          if (worker) discardWorker();
          else releaseBlobUrl();
          finish({ __workerError: err.message || String(err) });
        }
      }
    };
    spawn();
  });

  let out = await attempt(false);
  if (out.__workerError && !pyBlobTried) {
    // 文件 Worker 被拦截（如 CSP）→ 回退 blob Worker 重试一次
    pyBlobTried = true;
    pyWorker = null;
    out = await attempt(true);
  }
  if (out.__workerError) {
    pyWorker = null;
    return {
      ok: false, logs: [], files,
      error: { message: `Python 沙箱 Worker 加载失败：${out.__workerError}（可能受页面 CSP 限制）` },
      durationMs: Math.round(performance.now() - t0),
    };
  }
  if (out.timedOut) pyWorker = null;
  // 只有「运行时加载阶段」失败才标记不可用。过去用正则匹配错误文本，而 Pyodide 的 Python 回溯里
  // 本身就带 _pyodide/ 路径——任何一次用户代码抛异常都会把整个会话的 Python 沙箱误判为坏掉。
  const loadStageFailure = !out.ok && (out.stage === 'load'
    || (out.stage === undefined && /importScripts|loadPyodide|indexURL/i.test(String(out.error && out.error.message)) && !/Traceback/.test(String(out.error && out.error.message))));
  if (loadStageFailure) {
    pyodideBroken = true;
    pyWorker = null;
    out.error.message += '（已标记 Python 沙箱不可用，本次会话内请使用 execute_javascript）';
  }
  // 回传形态：新版 filesDelta {set, del}（相对 Worker 镜像），旧版 files 全量
  let workerAfter = null;
  if (out.ok && out.filesDelta && typeof out.filesDelta === 'object') {
    workerAfter = applyDelta(files, out.filesDelta);
  } else if (out.files && !out.timedOut) {
    workerAfter = out.files;
  }
  if (workerAfter) {
    out = noteWorkerFiles(out, applyWorkerFiles(fsObj, files, workerAfter));
    // 记录 Worker 镜像（含被主线程拒收的条目——下一轮 diff 会把它们纠正回来）
    pySyncedWorker = out.ok ? usedWorker : null;
    pySynced = out.ok ? workerAfter : null;
  } else {
    pySyncedWorker = null;
    pySynced = null;
  }
  if (sentFull && !out.ok) { pySyncedWorker = null; pySynced = null; }

  return { ...out, durationMs: Math.round(performance.now() - t0) };
}

export function runPython(code, fsObj, onProgress, extraPkgs = [], opts = {}) {
  const task = pyRunQueue.catch(() => {}).then(() => runPythonNow(code, fsObj, onProgress, extraPkgs, opts));
  pyRunQueue = task.catch(() => {});
  return task;
}

// ── C++：Clang/LLD + WASI 1 本地浏览器编译 / 执行 ─────────────────────
const SANDBOX_CPP_TIMEOUT_MS = 30000;
const SANDBOX_CPP_PREPARATION_TIMEOUT_MS = 120000;

export async function runCpp(code, opts = {}) {
  const t0 = performance.now();
  const timeoutMs = normalizeSandboxTimeoutMs(opts.timeoutMs, SANDBOX_CPP_TIMEOUT_MS);
  const files = Array.isArray(opts.files) ? opts.files.filter((f) => f && f.filename).map((f) => ({
    filename: String(f.filename), contents: String(f.contents ?? ''), compile: f.compile !== false,
  })) : [];
  const payload = {
    code: String(code || ''),
    mainPath: String(opts.mainPath || 'main.cpp'),
    files,
    stdin: opts.stdin == null ? '' : String(opts.stdin),
    args: Array.isArray(opts.args) ? opts.args.map((value) => String(value)) : [],
  };
  const out = await runInWorker('worker-cpp.js', payload, timeoutMs, {
    signal: opts.signal,
    onOutput: opts.onOutput,
    onPhase: opts.onPhase,
    onProgress: opts.onProgress,
    readyToken: 'cpp-runtime-1',
    workerType: 'module',
    allowBlobFallback: false,
    executionTimeoutPhase: 'program-start',
    preExecutionTimeoutMs: SANDBOX_CPP_PREPARATION_TIMEOUT_MS,
    preExecutionTimeoutMessage: `本地 C++ 工具链加载/编译超时（>${SANDBOX_CPP_PREPARATION_TIMEOUT_MS / 1000}s），沙箱已强制终止`,
    timeoutMessage: `C++ 程序执行超时（>${Math.round(timeoutMs / 1000)}s），沙箱已强制终止`,
  });
  return { ...out, durationMs: Math.round(performance.now() - t0) };
}
