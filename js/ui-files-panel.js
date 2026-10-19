import { staticPreviewDocument } from './file-preview.js?v=2026.10.11.1';
import { sandboxProject, sandboxBrowserRequest, probeLocalBrowser } from './localbrowser.js?v=2026.10.11.1';
// Dubhe Agent · 侧栏沙箱文件面板（从 ui.js 的 mountUI 拆出，V1.7.1）
// 职责：文件树渲染（容量条 / 折叠目录 / 行内操作）、单文件与整包 ZIP 下载、文件预览窗。
// 只依赖 store.state.files 与少量渲染工具；通过 installFilesPanel(deps) 注入，返回 { renderFiles, openFileViewer, downloadFile }。
import { createZip, fileBytesFromValue, withExtension, mimeFromPath } from './zip.js';
import { buildFileTree, treeStats, flattenTree } from './filetree.js';
import { ICON } from './icons.js';
import { SANDBOX_STORAGE_CAP, sandboxQuotaLabel } from './storagefmt.js';
import { pdfToImages } from './pdfpages.js';
import { contentByteSize } from './sandbox.js';
import { text as localeText } from './locale.js';
import { renderMarkdown } from './ui-markdown.js?v=2026.10.11.1';
import { readableFileText } from './file-text.js';
import { fvNoticeHtml, csvTableHtml, dualViewKind, DUAL_VIEW_MAX, viewModesHtml, applyViewMode, openFileSwitcher } from './ui-file-viewer.js';
import { motionAllowed } from './page-fx.js?v=2026.10.11.1';

// data:video/…、data:audio/… → blob URL（与 ui.js 气泡播放同一做法；独立实现以免 split 模块反向 import ui.js）
function mediaBlobUrl(dataUrl) {
  const s = String(dataUrl || '');
  const m = /^data:([^;,]+);base64,/.exec(s);
  if (!m) return '';
  try {
    const bin = atob(s.slice(s.indexOf(',') + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8], { type: m[1] }));
  } catch { return ''; }
}
const videoBlobUrl = mediaBlobUrl;

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function syncFullscreenButton(viewer) {
  const button = $('#fv-full', viewer);
  if (!button) return;
  const on = viewer.classList.contains('fv-fullscreen');
  button.innerHTML = `${on ? ICON.compress : ICON.expand}<span>${localeText(on ? '退出全屏' : '全屏', on ? 'Exit' : 'Fullscreen')}</span>`;
  button.title = localeText(on ? '退出全屏预览' : '全屏预览', on ? 'Exit fullscreen preview' : 'Fullscreen preview');
  button.setAttribute('aria-pressed', String(on));
}

function setViewerFullscreen(viewer, fullscreen) {
  if (!viewer) return;
  const wasFullscreen = viewer.classList.contains('fv-fullscreen');
  if (wasFullscreen === !!fullscreen) return;
  const before = viewer.getBoundingClientRect();
  try { viewer._fullscreenAnimation?.cancel(); } catch { /* noop */ }
  viewer._fullscreenAnimation = null;
  viewer.classList.toggle('fv-fullscreen', !!fullscreen);
  const after = viewer.getBoundingClientRect();
  if (motionAllowed(document) && typeof viewer.animate === 'function' && before.width > 0 && before.height > 0 && after.width > 0 && after.height > 0) {
    const sx = before.width / after.width;
    const sy = before.height / after.height;
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    try {
      const animation = viewer.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: 'top left', borderRadius: fullscreen ? '12px' : '0px' },
        { transform: 'none', transformOrigin: 'top left', borderRadius: fullscreen ? '0px' : '12px' },
      ], { duration: 320, easing: 'cubic-bezier(.22,.61,.36,1)' });
      viewer._fullscreenAnimation = animation;
      animation.onfinish = () => { if (viewer._fullscreenAnimation === animation) viewer._fullscreenAnimation = null; };
    } catch { /* the fullscreen state still works if Web Animations are unavailable */ }
  }
  syncFullscreenButton(viewer);
}

// 空状态插画：一叠文件 + 一个被放进来的文件（线稿，currentColor，随深浅主题）
const FILES_EMPTY_ART = `<svg class="files-empty-art" viewBox="0 0 160 112" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs><linearGradient id="feg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".10"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
  <ellipse cx="80" cy="98" rx="52" ry="7" fill="url(#feg)"/>
  <g class="fe-stack" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <path d="M44 42h40l12 12v38a4 4 0 0 1-4 4H44a4 4 0 0 1-4-4V46a4 4 0 0 1 4-4Z" fill="var(--bg)"/>
    <path d="M84 42v12h12" stroke-opacity=".7"/>
    <path d="M52 68h32M52 78h24" stroke-opacity=".45" stroke-linecap="round"/>
  </g>
  <g class="fe-back" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" opacity=".55">
    <path d="M58 32h36l10 10v8" stroke-linecap="round"/>
    <path d="M54 36v-2a4 4 0 0 1 4-4" stroke-linecap="round"/>
  </g>
  <g class="fe-drop" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M106 18h18l7 7v18a3 3 0 0 1-3 3h-22a3 3 0 0 1-3-3V21a3 3 0 0 1 3-3Z" fill="var(--bg)"/>
    <path d="M124 18v7h7" stroke-opacity=".7"/>
    <path d="M117 29v10M113 35l4 4 4-4" stroke-opacity=".9"/>
  </g>
  <g class="fe-sparks" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".5">
    <path d="M30 30v6M27 33h6"/><path d="M134 62v4M132 64h4"/><circle cx="26" cy="70" r="1.4" fill="currentColor" stroke="none"/>
  </g>
</svg>`;

export function installFilesPanel({ store, agent, toast, fmtSize, highlightCode, sanitizeSvgRaw, safeImgSrc }) {
  // ── 沙箱下载：整包 ZIP / 单个文件（图片按原始二进制还原，可直接打开）──
  const stampName = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  function saveBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const zipName = (path, mime) => withExtension(path.split('/').pop() || 'file', mime && mime.startsWith('image/') ? mime : '');
  function downloadFile(path) {
    let raw;
    try { raw = agent.fs.read(path); } catch { return toast('文件已不存在', 'err'); }
    const { bytes, mime: detectedMime } = fileBytesFromValue(raw);
    // 优先用文件路径扩展名推断的 MIME，避免浏览器因 text/plain 把文件另存为 .txt
    const pathMime = mimeFromPath(path);
    const mime = (detectedMime && !detectedMime.startsWith('text/plain')) ? detectedMime : (pathMime || detectedMime || 'application/octet-stream');
    const name = withExtension(path.split('/').pop() || 'file', detectedMime && detectedMime.startsWith('image/') ? detectedMime : '');
    saveBlob(name, new Blob([bytes], { type: mime }));
    toast(`已下载 ${name}（${fmtSize(bytes.length)}）`, 'ok');
  }
  // 打包：整包（保留目录结构）或单个目录；entries.name 即沙箱内路径
  const zipEntriesOf = (paths) => paths.map((p) => {
    let raw = '';
    try { raw = agent.fs.read(p); } catch { /**/ }
    const { bytes, mime } = fileBytesFromValue(raw);
    return { name: withExtension(p, mime && mime.startsWith('image/') ? mime : ''), bytes };
  });
  let filesZippedOnce = false;
  function saveZip(entries, base) {
    if (!entries.length) return toast('没有可打包的文件', 'warn');
    const blob = createZip(entries);
    saveBlob(`${base}-${stampName()}.zip`, blob);
    filesZippedOnce = true;
    toast(localeText(`已打包 ${entries.length} 个文件（${fmtSize(blob.size)}）`, `Packed ${entries.length} files (${fmtSize(blob.size)})`), 'ok');
  }
  $('#download-zip').addEventListener('click', () => {
    const wsKeys = (typeof agent.fs.listWorkspace === 'function' ? agent.fs.listWorkspace() : agent.fs.list()).map((f) => f.path);
    saveZip(zipEntriesOf(wsKeys), 'dubhe-workspace');
  });
  $('#clear-files').addEventListener('click', () => {
    const wsKeys = (typeof agent.fs.listWorkspace === 'function' ? agent.fs.listWorkspace() : agent.fs.list()).map((f) => f.path);
    const n = wsKeys.length;
    if (!n) return toast(localeText('工作区没有文件（内部缓存/OCR 会自动长期保留）', 'No files in the workspace (internal cache and OCR are kept automatically)'));
    if (!filesZippedOnce) {
      if (!confirm(localeText('尚未打包 ZIP。清空后工作区文件无法恢复，仍要清空？（内部缓存/OCR 等不受影响）', 'No ZIP has been packed yet. Workspace files cannot be restored after clearing. Clear anyway? (internal cache and OCR are not affected)'))) return;
    } else if (!confirm(localeText('清空工作区里的全部文件？内部缓存/OCR 会保留。此操作不可恢复。', 'Clear all files in the workspace? Internal cache and OCR are kept. This cannot be undone.'))) return;
    if (!confirm('再次确认：确定清空工作区文件？')) return;
    if (typeof agent.fs.clearWorkspace === 'function') {
      agent.fs.clearWorkspace();
    } else {
      agent.fs.clear();
    }
    store.clearFiles(); renderFiles(); toast(localeText('工作区已清空（内部文件保留）', 'Workspace cleared (internal files kept)'));
  });

  // 目录折叠状态：本次页面会话内记住（沙箱是路径即结构，没有真实目录节点）
  const collapsedDirs = new Set();
  const pendingDirCloses = new Map();
  const DIR_TRANSITION_MS = 190;
  const cancelDirTransitions = () => {
    for (const timer of pendingDirCloses.values()) clearTimeout(timer);
    pendingDirCloses.clear();
  };
  const setDirectoryRowState = (row, entry, closed) => {
    row.classList.toggle('closed', closed);
    row.classList.toggle('open', !closed);
    row.setAttribute('aria-expanded', String(!closed));
    row.title = `${entry.path}/（点击${closed ? '展开' : '折叠'}，共 ${entry.count} 个文件，${fmtSize(Number(entry.size) || 0)}）`;
    const icon = $('.ft-ico', row);
    if (icon) icon.innerHTML = closed ? ICON.folder : ICON.folderOpen;
  };
  const toggleDirectory = (entry, row) => {
    const pending = pendingDirCloses.get(entry.path);
    if (pending != null) { clearTimeout(pending); pendingDirCloses.delete(entry.path); }
    if (collapsedDirs.has(entry.path)) {
      collapsedDirs.delete(entry.path);
      renderFiles({ expandingPath: entry.path });
      return;
    }
    collapsedDirs.add(entry.path);
    setDirectoryRowState(row, entry, true);
    const box = $('#file-list');
    const prefix = `${entry.path}/`;
    const descendants = [...box.querySelectorAll('.ft-row')].filter((n) => String(n.dataset.path || '').startsWith(prefix));
    if (!motionAllowed(document) || !descendants.length) { renderFiles(); return; }
    descendants.forEach((n) => {
      n.style.setProperty('--row-height', `${n.getBoundingClientRect().height}px`);
      n.classList.add('ft-row-collapsing');
    });
    const timer = setTimeout(() => {
      pendingDirCloses.delete(entry.path);
      if (collapsedDirs.has(entry.path)) renderFiles();
    }, DIR_TRANSITION_MS);
    pendingDirCloses.set(entry.path, timer);
  };
  // 图片以 data URL 存放，字符串长度会虚高 ~1/3；按 base64 反推真实字节
  const approxBytes = (raw) => contentByteSize(raw);

  const storageQuota = SANDBOX_STORAGE_CAP; // 产品上限 120MB，不用 navigator.storage 那种 39321.6MB
  const zipEstimateBytes = (files) => {
    // zip.js 使用 STORE（不压缩内容），这里估算「打包后容器大小」：数据字节 + 本地头/中心目录/EOCD。
    // 这样不必每次刷新文件树都真正 createZip / 解码所有大图。
    const enc = new TextEncoder();
    let n = 22;
    for (const f of files || []) {
      const nameLen = enc.encode(String(f.path || '').replace(/^\/+/, '').replace(/\\/g, '/')).length;
      n += Number(f.size || 0) + 30 + nameLen + 46 + nameLen;
    }
    return n;
  };

  let lastSig = null;
  function renderFiles({ expandingPath = '' } = {}) {
    cancelDirTransitions();
    const box = $('#file-list'); box.innerHTML = '';
    const allList = agent.fs.list();
    const allFiles = allList.map((f) => {
      let raw = '';
      try { raw = agent.fs.read(f.path); } catch { /**/ }
      const str = String(raw);
      const isSvg = /\.svg$/i.test(f.path) || (/^data:image\/svg/i.test(str)) || (/<svg[\s>]/i.test(str.slice(0, 2000)));
      return { path: f.path, size: approxBytes(raw), isImage: /^data:image\//.test(str), isSvg, isVideo: /^data:video\//.test(str) || /\.(mp4|webm|mov|m4v)$/i.test(f.path) };
    });
    // 与上一次渲染比对：新建 / 内容变化的文件行短暂高亮（首次渲染与会话切换不高亮）
    const sigNow = new Map(allFiles.map((f) => [f.path, f.size]));
    const changed = new Set();
    if (lastSig && lastSig.sid === store.state.activeSessionId) {
      for (const [path, size] of sigNow) if (lastSig.map.get(path) !== size) changed.add(path);
    }
    lastSig = { sid: store.state.activeSessionId, map: sigNow };
    const isInternal = (p) => typeof agent.fs.isInternalPath === 'function' && agent.fs.isInternalPath(p);
    const wsFiles = allFiles.filter((f) => !isInternal(f.path));
    const intFiles = allFiles.filter((f) => isInternal(f.path));
    const tree = buildFileTree(wsFiles);
    const stat = treeStats(tree);
    const quotaEl = $('#files-count');
    if (quotaEl) {
      const wsSize = stat.size;
      const intSize = intFiles.reduce((a, f) => a + (Number(f.size) || 0), 0);
      quotaEl.textContent = sandboxQuotaLabel(wsSize + intSize, storageQuota);
      quotaEl.title = `工作区 ${fmtSize(wsSize)} + 内部 ${fmtSize(intSize)} · 上限 120MB`;
    }
    const nEl = $('#files-n');
    if (nEl) {
      const n = Number(stat.files) || 0;
      const ni = intFiles.length;
      nEl.textContent = ni ? localeText(`${n} 个文件 · 内部 ${ni}`, `${n} files · internal ${ni}`) : localeText(`${n} 个文件`, `${n} files`);
      nEl.title = ni ? localeText(`工作区显示 ${n} 个用户可见文件，另有 ${ni} 个内部长期文件（OCR/缓存等，不可见）`, `Workspace shows ${n} user-visible files; ${ni} internal long-lived files (OCR/cache) are hidden`) : '';
    }
    const zipEl = $('#files-zip');
    if (zipEl) {
      const z = zipEstimateBytes(wsFiles);
      zipEl.textContent = `ZIP ≈ ${fmtSize(z)}`;
      zipEl.title = `工作区文件打包后估算体积：${fmtSize(z)}（内部文件不打包）`;
    }
    if (!tree.length) {
      // 空状态：一句说明 + 轻量线稿插画（内联 SVG，跟随主题色；暂无文件时整块居中）
      const empty = el('div', 'files-empty');
      empty.setAttribute('aria-label', '暂无文件');
      empty.innerHTML = `${FILES_EMPTY_ART}<p class="files-empty-text">在此会话中创建或上传的所有文件都将保存在这里</p><p class="files-empty-sub">拖入 / 粘贴附件，或让 Agent 在沙箱里生成</p>`;
      box.appendChild(empty);
      return;
    }
    const imageSet = new Set(wsFiles.filter((f) => f.isImage).map((f) => f.path));
    const videoSet = new Set(wsFiles.filter((f) => f.isVideo).map((f) => f.path));
    const rows = flattenTree(tree, { isCollapsed: (p) => collapsedDirs.has(p) });
    for (const r of rows) {
      const closed = r.type === 'dir' && collapsedDirs.has(r.path);
      const row = el('div', `ft-row ft-${r.type}${r.type === 'dir' ? (closed ? ' closed' : ' open') : ' file-item'}`);
      row.style.setProperty('--d', r.depth);
      row.dataset.path = r.path;
      if (r.type !== 'dir' && changed.has(r.path)) row.classList.add('just-changed');
      row.title = r.type === 'dir' ? `${r.path}/（点击${collapsedDirs.has(r.path) ? '展开' : '折叠'}，共 ${r.count} 个文件，${fmtSize(Number(r.size) || 0)}）` : r.path;
      if (expandingPath && r.path.startsWith(`${expandingPath}/`)) {
        row.classList.add('ft-row-expanding');
        setTimeout(() => row.classList.remove('ft-row-expanding'), 230);
      }
      if (r.type === 'dir') {
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.setAttribute('aria-expanded', String(!closed));
        // 目录行不放复制 / 下载按钮（点整行折叠展开）；最外层目录（如 uploads）直接给出文件总数与总体积
        const countLabel = localeText(`${Number(r.count) || 0} 个文件`, `${Number(r.count) || 0} files`);
        const meta = r.depth === 0
          ? `${countLabel} · ${fmtSize(Number(r.size) || 0)}`
          : countLabel;
        row.innerHTML = `<span class="ft-chev">${ICON.chevRight}</span>`
          + `<span class="ft-ico">${closed ? ICON.folder : ICON.folderOpen}</span>`
          + `<span class="ft-name">${esc(r.name)}</span>`
          + `<span class="ft-meta ft-dir-count">${meta}</span>`;
        const toggle = () => toggleDirectory(r, row);
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      } else {
        const fr = wsFiles.find((ff) => ff.path === r.path);
        const isSvgFile = !!(fr && fr.isSvg);
        // 复制 / 下载按钮仅在鼠标悬浮（或键盘聚焦）该行时显示；下载在左、复制靠右
        row.innerHTML = `<span class="ft-sp"></span>`
          + `<span class="ft-ico">${videoSet.has(r.path) ? (ICON.video || '🎬') : (imageSet.has(r.path) || isSvgFile ? ICON.image : ICON.file)}</span>`
          + `<span class="ft-name file-path">${esc(r.name)}</span>`
          + `<span class="ft-actions"><button class="files-icon-btn file-dl" type="button" title="${localeText('下载此文件', 'Download file')}" aria-label="${localeText('下载此文件', 'Download file')}">${ICON.download}</button><button class="files-icon-btn ft-copy" type="button" title="${localeText('复制文件名', 'Copy file name')}" aria-label="${localeText('复制文件名', 'Copy file name')}">${ICON.copy}</button></span>`;
        $('.ft-copy', row).addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(r.name).then(() => toast(localeText('已复制文件名', 'File name copied'), 'ok', 1200), () => toast(localeText('复制失败：浏览器拒绝了剪贴板权限', 'Copy failed: clipboard permission was denied'), 'err'));
        });
        $('.file-dl', row).addEventListener('click', (e) => { e.stopPropagation(); downloadFile(r.path); });
        row.addEventListener('click', () => openFileViewer(r.path));
      }
      box.appendChild(row);
    }
  }

  let webPreviewId = '';
  let viewerGeneration = 0;
  let viewerSwapTimer = 0;
  let viewMode = 'preview'; // 双视图默认「预览」；用户切过之后本页会话内沿用
  let closeSwitcher = null; // 文件名下拉（沙箱文件目录）
  const FV_TEXT_MAX = 1 * 1024 * 1024; // 沙箱预览：文本类文件上限 1MB（超出请下载后在本地编辑器查看）
  function openFileViewer(path) {
    const viewer = $('#file-viewer');
    let raw = '';
    try { raw = agent.fs.read(path); } catch { return toast('文件已不存在', 'err'); }
    const rawStr = String(raw);
    const byteLen = approxBytes(rawStr);
    const lower = path.toLowerCase();
    const imgSrc = /^data:image\//.test(rawStr) ? safeImgSrc(rawStr) : '';
    // SVG 文件：如果内容是 SVG XML（不管有没有 data: 头），渲染为内联 SVG
    let svgContent = '';
    if (!imgSrc) {
      if (/\.svg$/i.test(lower) || /<svg[\s>]/i.test(rawStr.slice(0, 2000))) {
        svgContent = sanitizeSvgRaw(rawStr);
      }
    }
    // 代码/文本文件扩展名白名单
    const isCode = /\.(js|mjs|cjs|ts|jsx|tsx|py|java|c|cpp|h|hpp|cc|cxx|cs|go|rs|rb|php|swift|kt|scala|dart|m|matlab|sh|bash|zsh|ps1|bat|cmd|sql|json|jsonc|yml|yaml|toml|ini|conf|xml|html|htm|css|scss|less|md|markdown|r|jl|pyi|vue|svelte|tex|latex|lua|hs|erl|ex|exs|clj|cljs|fs|fsx|ml|mli|asm|s|vhd|v|sv|cu|sol|graphql|gql|hbs|jinja|j2|dockerfile|mk|nginx|diff|patch|log|csv|tsv|txt|text)$/i.test(lower);
    const isTextual = isCode || /^text\//.test(lower);
    // 上传的文本文件（SVG / Markdown / CSV / 代码）可能以 data URL 存放：代码视图与预览都用解码后的原文
    const textView = isTextual || /\.svg$/i.test(lower) ? readableFileText(rawStr, path) : null;
    const textStr = textView && !textView.binary ? textView.text : rawStr;
    let bodyHtml = '';
    // 视频（uploads/*.mp4 等 data:video/…）：转 blob URL 交给 <video controls>（CSP media-src 放行 blob:）
    const videoUrl = /^data:video\//i.test(rawStr) ? mediaBlobUrl(rawStr) : '';
    // 音频（mp3/wav/m4a/… data:audio/…）：同样转 blob 交给 <audio controls>
    const audioUrl = /^data:audio\//i.test(rawStr) ? mediaBlobUrl(rawStr) : '';
    const isAudio = !!audioUrl || /\.(mp3|wav|m4a|aac|ogg|oga|flac|weba)$/i.test(lower);
    // Office 三件套与 ZIP：结构化预览（office-preview.js 按需加载）；旧版 .doc/.ppt/.xls 只给说明
    const officeKind = /\.(xlsx|xlsm)$/i.test(lower) ? 'xlsx'
      : /\.docx$/i.test(lower) ? 'docx'
        : /\.pptx$/i.test(lower) ? 'pptx'
          : /\.zip$/i.test(lower) ? 'zip' : '';
    const isLegacyOffice = /\.(doc|ppt|xls)$/i.test(lower);
    const FV_OFFICE_MAX = 16 * 1024 * 1024;
    if (videoUrl) {
      bodyHtml = `<div class="fv-video"><video controls playsinline preload="metadata" src="${esc(videoUrl)}" title="${esc(path)}"></video><div class="fv-video-meta mono">${esc(path.split('/').pop())} · ${fmtSize(byteLen)}</div></div>`;
    } else if (isAudio) {
      // 上传的音频以 data:audio/… 存放；没有可解码内容时给下载提示
      bodyHtml = audioUrl
        ? `<div class="fv-audio"><audio controls preload="metadata" src="${esc(audioUrl)}" title="${esc(path)}"></audio><div class="fv-video-meta mono">${esc(path.split('/').pop())} · ${fmtSize(byteLen)}</div></div>`
        : fvNoticeHtml('binary', localeText('无法在浏览器内播放此音频', 'Cannot play this audio file here'), localeText('文件内容不可解码，请下载后播放。', 'The content is not decodable here. Download it to play.'));
    } else if (officeKind && byteLen <= FV_OFFICE_MAX) {
      bodyHtml = `<div class="fv-office-host" data-office="${officeKind}"><div class="fv-pdf-loading">${localeText('正在解析预览…', 'Preparing preview…')}</div></div>`;
    } else if (officeKind) {
      bodyHtml = fvNoticeHtml('tooBig', localeText(`此文件 <strong>${fmtSize(byteLen)}</strong>，超过预览上限 16MB`, `This file is <strong>${fmtSize(byteLen)}</strong>, above the 16MB preview limit`),
        localeText('为避免界面卡顿已禁用内联预览，请下载后用本地程序打开。', 'Inline preview is disabled to keep the UI responsive; download it to view.'));
    } else if (isLegacyOffice) {
      bodyHtml = fvNoticeHtml('binary', localeText('旧版 Office 格式 · <strong>不支持内联预览</strong>', 'Legacy Office format · <strong>no inline preview</strong>'),
        localeText('请先在本机用 Office / WPS 另存为 .docx / .pptx / .xlsx 再上传，或下载后用本地程序打开。', 'Save it as .docx / .pptx / .xlsx in Office or WPS first, or download and open it locally.'));
    } else if (imgSrc) {
      bodyHtml = `<div class="fv-img"><img src="${esc(imgSrc)}" alt="${esc(path)}"></div>`;
    } else if (svgContent) {
      bodyHtml = `<div class="fv-svg">${svgContent}</div>`;
    } else if (isTextual) {
      if (byteLen > FV_TEXT_MAX) {
        // 超过 1MB：不直接渲染（hljs 处理超大文本会卡主线程），只显示提示 + 下载按钮
        bodyHtml = fvNoticeHtml('tooBig', `此文本文件大小为 <strong>${fmtSize(byteLen)}</strong>，超过预览上限 1MB。`,
          '为避免界面卡顿，已禁用内联预览，请点右上角「下载」后用本地编辑器查看。');
      } else {
        const lang = (lower.split('.').pop() || 'text');
        bodyHtml = isCode
          ? `<div class="fv-code"><pre><code class="hljs">${highlightCode(textStr, lang, esc)}</code></pre></div>`
          : `<div class="fv-code"><pre>${esc(textStr)}</pre></div>`;
      }
    } else if (/\.pdf$/i.test(lower) || /^data:application\/pdf/i.test(rawStr)) {
      // PDF：用 pdf.js 把前几页画成图预览（不走 iframe，避免放宽 CSP frame-src）
      bodyHtml = `<div class="fv-pdf" data-path="${esc(path)}"><div class="fv-pdf-loading">正在渲染 PDF 预览…</div></div>`;
    } else {
      bodyHtml = fvNoticeHtml('binary', `二进制文件 · <strong>${fmtSize(byteLen)}</strong>`, '该文件无法在浏览器内预览，请下载后用对应程序打开。');
    }
    // 双视图（V1.8.1）：HTML / SVG 静态预览、Markdown 渲染、CSV / TSV 表格；只有「代码 / 预览」两态（并排已移除），默认预览
    const dualKind = dualViewKind(lower);
    const dualPreview = !!dualKind && byteLen <= DUAL_VIEW_MAX[dualKind] && !(textView && textView.binary);
    const previewSource = textStr;
    if (dualPreview) {
      const codeLang = dualKind === 'web' ? (lower.endsWith('.svg') ? 'xml' : 'html') : dualKind === 'md' ? 'markdown' : 'plaintext';
      const previewPane = dualKind === 'web'
        ? `<div class="fv-pane fv-static" data-pane="preview"><div class="fv-static-note">${localeText('静态预览 · 脚本与外网已禁用', 'Static preview · scripts and network disabled')}</div><iframe sandbox="" referrerpolicy="no-referrer" title="${esc(path)} preview"></iframe></div>`
        : dualKind === 'md'
          ? `<div class="fv-pane fv-rendered" data-pane="preview"><div class="md-body fv-md">${renderMarkdown(previewSource)}</div></div>`
          : `<div class="fv-pane fv-rendered fv-table" data-pane="preview">${csvTableHtml(previewSource, { delimiter: lower.endsWith('.tsv') ? '\t' : ',' })}</div>`;
      bodyHtml = `<div class="fv-dual" data-kind="${dualKind}" data-mode="${viewMode}"><div class="fv-pane fv-code" data-pane="code"><pre><code class="hljs">${highlightCode(previewSource, codeLang, esc)}</code></pre></div>${previewPane}</div>`;
    }
    const animateSwap = viewer.classList.contains('open') && motionAllowed(document);
    if (viewerSwapTimer) clearTimeout(viewerSwapTimer);
    viewerSwapTimer = 0;
    viewer.classList.remove('switching');
    stopViewerMedia();
    viewer.innerHTML = `<div class="file-viewer-head mono"><button type="button" class="fv-path" aria-haspopup="dialog" aria-expanded="false" title="${localeText('点击切换沙箱文件', 'Click to switch sandbox file')}"><span class="fv-path-text">${esc(path)}</span>${ICON.chevRight}</button><span class="fv-size">${fmtSize(byteLen)}</span><span class="fv-actions">`
      + (dualPreview ? viewModesHtml(viewMode) : '')
      + `<button id="fv-dl" type="button" title="${localeText('下载此文件', 'Download file')}" aria-label="${localeText('下载此文件', 'Download file')}">${ICON.download}<span>下载</span></button>`
      + (/\.html?$/i.test(lower) ? `<button id="fv-run" type="button" title="在本地沙箱服务运行并用 Chromium 调试">${ICON.terminal || ICON.tool}<span>运行网页</span></button>` : '')
      + `<button id="fv-full" type="button" title="${localeText('全屏预览', 'Fullscreen preview')}" aria-label="${localeText('全屏预览', 'Fullscreen preview')}" aria-pressed="false">${ICON.expand}<span>${localeText('全屏', 'Fullscreen')}</span></button>`
      + `<button id="fv-close" type="button" title="关闭">${ICON.x}</button></span></div>`
      + bodyHtml;
    viewer.classList.add('open');
    if (animateSwap) {
      viewer.classList.add('switching');
      viewerSwapTimer = setTimeout(() => { viewer.classList.remove('switching'); viewerSwapTimer = 0; }, 380);
    }
    if (dualPreview) {
      const frame = viewer.querySelector('.fv-static iframe');
      if (frame) frame.srcdoc = staticPreviewDocument(previewSource, path, agent.fs);
      applyViewMode(viewer, viewMode);
      viewer.querySelectorAll('[data-view-mode]').forEach(button => button.addEventListener('click', () => {
        viewMode = applyViewMode(viewer, button.dataset.viewMode); // 记住选择：切到下一个文件沿用
      }));
    }
    const pathBtn = $('.fv-path', viewer);
    // 点文件名：弹出沙箱文件目录，直接切换要预览的文件（不必回到文件树）
    pathBtn.addEventListener('click', () => {
      if (closeSwitcher) { closeSwitcher(); return; }
      const isInternal = (p) => typeof agent.fs.isInternalPath === 'function' && agent.fs.isInternalPath(p);
      closeSwitcher = openFileSwitcher({ viewer, anchor: pathBtn, current: path, fmtSize,
        files: agent.fs.list().filter((f) => !isInternal(f.path)),
        onPick: (next) => openFileViewer(next), onClose: () => { closeSwitcher = null; } });
    });
    if (videoUrl || audioUrl) {
      // 关闭 / 切换文件时释放 blob，避免反复打开把内存吃满
      const mediaEl = $('.fv-video video, .fv-audio audio', viewer);
      const blobUrl = videoUrl || audioUrl;
      const release = () => { try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ } };
      const MO = globalThis.MutationObserver || window.MutationObserver;
      const mo = new MO(() => { if (!mediaEl || !mediaEl.isConnected || !viewer.classList.contains('open')) { release(); mo.disconnect(); } });
      mo.observe(viewer, { childList: true, attributes: true, attributeFilter: ['class'] });
    }
    $('#fv-close').addEventListener('click', () => closeViewer());
    $('#fv-dl').addEventListener('click', () => downloadFile(path));
    $('#fv-run')?.addEventListener('click', async () => {
      const generation = viewerGeneration;
      const button = $('#fv-run'); button.disabled = true;
      try {
        if (!await probeLocalBrowser({ force: true })) throw new Error(localeText('需要本机 npm run setup:browser，然后 python3 server.py；请从本地网页使用此能力，Pages 本身不能运行 Chromium。', 'Requires a local `npm run setup:browser`, then `python3 server.py`. Use this from a local web page; GitHub Pages cannot run Chromium.'));
        if (generation !== viewerGeneration || !viewer.classList.contains('open')) return;
        if (webPreviewId) { await sandboxBrowserRequest({ action: 'stop', preview_id: webPreviewId }).catch(() => {}); webPreviewId = ''; }
        const r = await sandboxBrowserRequest({ action: 'start', ...sandboxProject(agent.fs, path) });
        if (generation !== viewerGeneration || !viewer.classList.contains('open')) { await sandboxBrowserRequest({ action: 'stop', preview_id: r.preview_id }); return; }
        webPreviewId = r.preview_id;
        if (!/^\/sandbox-web\/[a-f0-9]{32}\//.test(r.preview_path || '')) throw new Error('无效的本地预览地址');
        const old = viewer.querySelector('.fv-web'); if (old) old.remove();
        const box = document.createElement('div'); box.className = 'fv-web';
        box.innerHTML = `<div class="fv-web-note">本地网页预览 · 与 Agent 调试会话独立 · HTTP 资源仅限当前项目 <a href="${esc(r.preview_path)}" target="_blank" rel="noopener noreferrer">新标签页</a></div><iframe sandbox="allow-scripts" title="沙箱网页 ${esc(path)}" src="${esc(r.preview_path)}"></iframe>`;
        const staticBox = viewer.querySelector('.fv-static');
        if (staticBox) {
          staticBox.replaceChildren(box);
          viewMode = applyViewMode(viewer, 'preview');
        } else { viewer.appendChild(box); viewer.querySelector('.fv-code')?.setAttribute('hidden', ''); }
      } catch (err) { toast(String(err.message || err), 'warn', 8000); }
      finally { if (generation === viewerGeneration && button.isConnected) button.disabled = false; }
    });
    const pdfBox = $('.fv-pdf', viewer);
    if (pdfBox) renderPdfPreview(pdfBox, rawStr, path);
    const officeBox = $('.fv-office-host', viewer);
    if (officeBox) renderOfficePreview(officeBox, officeBox.dataset.office || 'zip', rawStr);
    // 全屏预览：所有文件类型共用同一个查看器，一键放大到整个视口（CSS 全屏，兼容不支持 Fullscreen API 的 iOS Safari）
    const fullBtn = $('#fv-full', viewer);
    syncFullscreenButton(viewer);
    if (fullBtn) fullBtn.addEventListener('click', () => {
      setViewerFullscreen(viewer, !viewer.classList.contains('fv-fullscreen'));
    });
  }

  // Office / ZIP 预览：按需加载 office-preview.js，结果直接内嵌到查看器（失败给可下载的提示）
  async function renderOfficePreview(box, kind, rawStr) {
    const generation = viewerGeneration;
    try {
      const mod = await import('./office-preview.js?v=2026.10.11.1');
      const html = kind === 'xlsx' ? await mod.xlsxPreviewHtml(rawStr)
        : kind === 'docx' ? await mod.docxPreviewHtml(rawStr)
          : kind === 'pptx' ? await mod.pptxPreviewHtml(rawStr)
            : await mod.zipListHtml(rawStr);
      if (generation !== viewerGeneration || !box.isConnected) return;
      box.innerHTML = html;
      box.classList.remove('fv-office-host');
      box.classList.add('fv-office-wrap');
      // xlsx 工作表选项卡
      const tabs = [...box.querySelectorAll('.fv-sheet-tab')];
      tabs.forEach((tab) => tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        box.querySelectorAll('[data-sheet-pane]').forEach((pane) => {
          pane.hidden = pane.dataset.sheetPane !== tab.dataset.sheet;
        });
      }));
    } catch (err) {
      if (generation !== viewerGeneration || !box.isConnected) return;
      box.innerHTML = fvNoticeHtml('binary', localeText('预览失败', 'Preview failed'), `${esc(err.message || String(err))} · ${localeText('请下载后用本地程序打开', 'download and open it locally')}`);
    }
  }

  // 关闭查看器：只摘 .open 类的话 <video> 还挂在 DOM 里继续出声（.26 前的 bug：点 ✕ 后音频照放）。
  // 先把所有媒体元素停掉并卸载源，再收起；下一次 openFileViewer 会整体重建 innerHTML。
  function stopViewerMedia() {
    viewerGeneration += 1;
    if (closeSwitcher) closeSwitcher();
    const id = webPreviewId; webPreviewId = '';
    if (id) sandboxBrowserRequest({ action: 'stop', preview_id: id }).catch(() => {});
    const viewer = $('#file-viewer');
    if (!viewer) return;
    viewer.querySelector('.fv-web')?.remove();
    viewer.querySelectorAll('.fv-static iframe').forEach(frame => frame.remove());
    for (const m of viewer.querySelectorAll('video, audio')) {
      try { m.pause(); } catch { /* noop */ }
      try { m.removeAttribute('src'); m.load(); } catch { /* noop */ }
    }
  }
  function closeViewer() {
    stopViewerMedia();
    const viewer = $('#file-viewer');
    if (viewer) {
      try { viewer._fullscreenAnimation?.cancel(); } catch { /* noop */ }
      viewer._fullscreenAnimation = null;
      viewer.classList.remove('open');
      viewer.classList.remove('fv-fullscreen');
    }
  }
  // Esc：全屏预览先退出全屏（不关查看器）；再按一次关闭查看器（与灯箱一致）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const viewer = $('#file-viewer');
    if (!viewer || !viewer.classList.contains('open')) return;
    if (viewer.classList.contains('fv-fullscreen')) {
      setViewerFullscreen(viewer, false);
      e.preventDefault();
      return;
    }
    closeViewer();
  });

  const FV_PDF_PAGES = 6;
  async function renderPdfPreview(box, rawStr, path) {
    let bytes;
    try {
      const comma = rawStr.indexOf(',');
      const b64 = /^data:/i.test(rawStr) && comma > 0 ? rawStr.slice(comma + 1) : '';
      if (!b64) throw new Error('不是 base64 PDF');
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (err) {
      box.innerHTML = fvNoticeHtml('pdf', '无法预览此 PDF', `${esc(err.message || String(err))}，请下载后查看。`);
      return;
    }
    let got;
    try {
      got = await pdfToImages(bytes, { name: path.split('/').pop(), maxPages: FV_PDF_PAGES, baseScale: 1.2, maxEdge: 1600, quality: 0.8 });
    } catch (err) { got = { ok: false, error: err.message || String(err), images: [] }; }
    if (!box.isConnected) return;
    if (!got || !got.ok || !got.images.length) {
      box.innerHTML = fvNoticeHtml('pdf', '无法预览此 PDF', `${esc((got && got.error) || '渲染失败')}，请下载后查看。`);
      return;
    }
    const more = got.truncated ? `<div class="fv-pdf-more">共 ${got.pages} 页，预览前 ${got.images.length} 页；完整内容请让 Agent 调用 analyze_pdf 或下载查看。</div>` : '';
    box.innerHTML = `<div class="fv-pdf-meta mono">PDF · ${got.pages} 页</div>`
      + got.images.map((img) => `<figure class="fv-pdf-page"><img src="${esc(img.dataUrl)}" alt="第 ${img.page} 页" loading="lazy"><figcaption>第 ${img.page} 页</figcaption></figure>`).join('')
      + more;
  }
  return { renderFiles, openFileViewer, closeViewer, downloadFile };
}
