import { focusForegroundWorkspace } from './modal-selection.js';
import { projectIconType, projectIconSvg } from './project-icons.js';
import { createProjectFS, isProjectUserPath } from './project-store.js';
import { reviewProjectImport } from './project-import-review.js';
import { createFS } from './sandbox.js';
// Dubhe Agent · 项目模式（第 17 条，参照 VS Code）：代码为主、AI 为辅。
// 全屏工作区：左侧资源管理器（独立项目文件树）、中间多标签代码编辑器、底部状态栏。
// 文件存于独立、跨会话项目；沙箱与项目之间只允许显式复制。
// 轮询项目状态同步外部改动（Agent 写入）：未保存的标签不会被覆盖。
import { uiText as T } from './locale.js';
import { highlightCode } from './ui-markdown.js?v=2026.10.25.1';
const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import {
  workspaceEntries, isBinaryContent, languageOf, lineCol, lineCount, indentEdit, enterEdit,
  validateName, joinPath, parentDir, explorerRows, isWorkspacePath, PROJECT_RENDER_LINE_CAP,
} from './project-core.js';
import { runJavaScript, runPython, runCpp } from './sandbox.js';
import { createCompressedZip, fileBytesFromValue } from './zip.js';
import { unpackZipFromDataUrl, unpackZip } from './unzip.js';
import { planWorkspaceTransfer } from './project-core.js';
import {
  runnerFor, cppSources, parseDiagnostics, lineStartIndex, runSummary, RUNNER_LABEL,
} from './project-run.js';

const POLL_MS = 900;
const PM_IMPORT_MAX_BYTES = 20 * 1024 * 1024; // 单个导入文件上限（超出则跳过并计数）
// 空文件夹用占位文件 .keep 表示：树里保留文件夹，但不把占位文件列出来
const isPlaceholder = (p) => /(^|\/)\.keep$/.test(String(p));
function fmtBytes(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
}
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON = {
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  output: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 18v-6M9 15l3-3 3 3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 17v-5M9.5 14.5 12 12l2.5 2.5"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
};
function svgIcon(inner) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'pm-ic');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '18');
  s.setAttribute('height', '18');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}
let active = null; // 同一时间只开一个项目窗口

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

/**
 * 打开项目窗口。deps: { store, agent }。返回 { close } ；已打开时直接聚焦原窗口。
 */
export function openProjectMode({ store, agent, projectFileSystem = null }) {
  if (active) { active.focus(); return active; }
  const state = {
    tabs: [],          // { path, value, saved, dirty }
    active: '',        // 当前标签路径
    collapsed: new Set(),
    renaming: '',      // 正在重命名的路径
    creating: null,    // null | { dir }
    selected: '',      // 资源管理器里选中的路径（新建文件时作为目录参考）
    lastSnap: null,
    status: '',
    outOpen: false,
    running: false,
    controller: null,
    clipboard: null,   // 内部剪贴板：文件路径与 copy/cut；不访问系统剪贴板
    diags: [],         // 最近一次运行的问题 [{file,line,col,severity,message}]
  };
  let closing = false;
  let timer = 0;
  const root = h('div', { class: 'pm-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('项目模式', 'Project mode') });
  const explorerBody = h('div', { class: 'pm-tree', role: 'tree', tabindex: '0', 'aria-label': T('文件树', 'File tree') });
  const tabsBar = h('div', { class: 'pm-tabs', role: 'tablist' });
  const gutter = h('div', { class: 'pm-gutter', 'aria-hidden': 'true' });
  const textarea = h('textarea', { class: 'pm-text', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': T('代码编辑器', 'Code editor') });
  const marks = h('div', { class: 'pm-marks', 'aria-hidden': 'true' });
  // 语法高亮：底层 <pre> 按 hljs 着色，textarea 文字透明只保留光标与选区（同步滚动）
  const hlCode = h('code', { class: 'hljs' });
  const hlPre = h('pre', { class: 'pm-hl', 'aria-hidden': 'true' }, [hlCode]);
  const codeWrap = h('div', { class: 'pm-code' }, [hlPre, textarea]);
  const editorWrap = h('div', { class: 'pm-editor' }, [gutter, codeWrap, marks]);
  const emptyNote = h('div', { class: 'pm-empty' });
  const statusLang = h('span', { class: 'pm-st-lang' });
  const statusPos = h('span', { class: 'pm-st-pos' });
  const statusDirty = h('span', { class: 'pm-st-dirty' });
  const statusMsg = h('span', { class: 'pm-st-msg', role: 'status', 'aria-live': 'polite' });
  const projName = h('span', { class: 'pm-proj-name' }, T('项目', 'Project'));
  const projCount = h('span', { class: 'pm-proj-count' });
  const btnSave = h('button', { class: 'pm-btn primary', type: 'button', title: T('保存（Ctrl+S）', 'Save (Ctrl+S)'), onclick: () => saveActive() }, [svgIcon(ICON.save), T('保存', 'Save')]);
  const btnSide = h('button', { class: 'pm-icon pm-side-toggle', type: 'button', title: T('折叠 / 展开侧栏（Ctrl+B）', 'Toggle sidebar (Ctrl+B)'), 'aria-label': T('折叠 / 展开侧栏', 'Toggle sidebar'), 'aria-expanded': 'true', onclick: () => toggleSide() }, [svgIcon(ICON.side)]);
  const importFileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => importFiles(e.target) });
  const importDirInput = h('input', { type: 'file', multiple: true, hidden: true, webkitdirectory: true, onchange: (e) => importFiles(e.target, { folder: true }) });
  const btnClose = h('button', { class: 'pm-btn', type: 'button', title: T('关闭（Esc）', 'Close (Esc)'), onclick: () => close() }, [svgIcon(ICON.close), T('关闭', 'Close')]);
  const btnRun = h('button', { class: 'pm-btn primary run', type: 'button', title: T('运行当前文件（Ctrl+Enter）', 'Run current file (Ctrl+Enter)'), onclick: () => runActive() }, T('▶ 运行', '▶ Run'));
  const btnStop = h('button', { class: 'pm-btn', type: 'button', hidden: true, title: T('停止运行', 'Stop'), onclick: () => stopRun() }, T('■ 停止', '■ Stop'));
  const btnOut = h('button', { class: 'pm-btn', type: 'button', title: T('显示 / 隐藏输出面板', 'Show / hide output panel'), onclick: () => setOutOpen(!state.outOpen) }, [svgIcon(ICON.output), T('输出', 'Output')]);

  // 媒体预览区（图片 / 音频 / 视频 / PDF）；不支持预览的二进制文件显示信息卡片与下载按钮
  const mediaView = h('div', { class: 'pm-media', hidden: true });
  const outSum = h('div', { class: 'pm-out-sum' });
  const outProbs = h('div', { class: 'pm-probs' });
  const outLines = h('div', { class: 'pm-out-lines', role: 'log', 'aria-live': 'polite' });
  // 运行进度条：C++ 首次加载工具链（约 30 MB）与编译阶段都在这里显示；阶段未知时为循环的不确定条
  const outProgLabel = h('span', { class: 'pm-prog-label' });
  const outProgFill = h('i', { class: 'pm-prog-fill' });
  const outProgress = h('div', { class: 'pm-progress', hidden: true, role: 'status', 'aria-label': T('运行进度', 'Run progress') }, [
    h('div', { class: 'pm-prog-track' }, [outProgFill]),
    outProgLabel,
  ]);
  const outPanel = h('section', { class: 'pm-out', hidden: true, 'aria-label': T('输出与问题', 'Output and problems') }, [
    h('div', { class: 'pm-out-head' }, [
      h('span', { class: 'pm-out-title' }, T('输出 · 问题', 'OUTPUT · PROBLEMS')),
      h('span', { class: 'pm-spacer' }),
      h('button', { type: 'button', class: 'pm-mini', title: T('清空', 'Clear'), 'aria-label': T('清空输出', 'Clear output'), onclick: () => clearOutput() }, '⌫'),
      h('button', { type: 'button', class: 'pm-mini', title: T('隐藏', 'Hide'), 'aria-label': T('隐藏输出', 'Hide output'), onclick: () => setOutOpen(false) }, '×'),
    ]),
    h('div', { class: 'pm-out-body' }, [outProgress, outSum, outProbs, outLines]),
  ]);


  root.append(
    h('header', { class: 'pm-top' }, [
      h('span', { class: 'pm-brand' }, 'DUBHE'),
      projName,
      projCount,
      h('span', { class: 'pm-spacer' }),
      btnRun, btnStop, btnOut,
      btnSave,
      btnClose,
    ]),
    h('div', { class: 'pm-body' }, [
      h('aside', { class: 'pm-explorer', 'aria-label': T('资源管理器', 'Explorer') }, [
        h('div', { class: 'pm-ex-head' }, [h('span', {}, T('资源管理器', 'EXPLORER')), btnSide]),
        explorerBody,
        importFileInput,
        importDirInput,
      ]),
      h('section', { class: 'pm-main' }, [h('button', { class: 'pm-side-reopen pm-icon', type: 'button', title: T('展开资源管理器', 'Open explorer'), 'aria-label': T('展开资源管理器', 'Open explorer'), onclick: () => toggleSide() }, [svgIcon(ICON.side)]), tabsBar, editorWrap, mediaView, emptyNote]),
    ]),
    h('footer', { class: 'pm-status' }, [statusLang, statusPos, statusDirty, h('span', { class: 'pm-spacer' }), statusMsg]),
  );
  root.querySelector('.pm-status').before(outPanel);
  (document.body || document.documentElement).appendChild(root);
  focusForegroundWorkspace(root, document);

  // ── 数据 ──
  const projectFS = projectFileSystem || createProjectFS(store);
  const files = () => store.state.project.files;
  const tabOf = (path) => state.tabs.find((t) => t.path === path) || null;
  const current = () => tabOf(state.active);

  // Explorer operations are intentionally local to the sandbox, never the OS clipboard.
  let menuNode = null, suppressClick = false, dragging = '';
  function closeMenu() { if (menuNode) menuNode.remove(); menuNode = null; }
  function dismissMenu(e) { if (menuNode && !menuNode.contains(e.target)) closeMenu(); }
  document.addEventListener('pointerdown', dismissMenu, true);
  const selectDirectory = (path) => { state.selected = path || ''; if (path) state.collapsed.delete(path); };
  function openMenu(path, isDir, x, y) {
    closeMenu(); state.selected = path || ''; renderTree();
    const dir = !path || isDir ? path : parentDir(path);
    const entries = [];
    const add = (id, zh, en, fn, disabled = false) => entries.push({ id, label: T(zh, en), fn, disabled });
    if (path && !isDir) add('open', '打开', 'Open', () => openFile(path));
    if (!path || isDir) {
      add('new-file', '新建文件', 'New file', () => { selectDirectory(dir); startCreate(); });
      add('new-folder', '新建文件夹', 'New folder', () => { selectDirectory(dir); startCreate('folder'); });
      add('import-file', '导入文件', 'Import files', () => { selectDirectory(dir); importFileInput.click(); });
      add('import-folder', '导入文件夹', 'Import folder', () => { selectDirectory(dir); importDirInput.click(); });
    }
    if (path) {
      add('rename', '重命名', 'Rename', () => { state.renaming = path; renderTree({ force: true }); });
      add('copy', '拷贝', 'Copy', () => { state.clipboard = { path, cut: false }; flash(T('已拷贝', 'Copied')); });
      add('cut', '剪切', 'Cut', () => { state.clipboard = { path, cut: true }; flash(T('已剪切', 'Cut')); });
    }
    if (!path || isDir) add('paste', '粘贴', 'Paste', () => pasteInto(dir), !state.clipboard);
    if (path) {
      add('compress', '压缩为 ZIP', 'Compress to ZIP', () => compressPath(path));
      if (!isDir && /\.zip$/i.test(path)) add('extract', '解压缩', 'Extract ZIP', () => extractPath(path));
      add('delete', '删除', 'Delete', () => removePath(path, isDir));
    }
    menuNode = h('div', { class: 'pm-context-menu', role: 'menu', 'aria-label': T('文件操作', 'File operations') });
    for (const entry of entries) {
      const button = h('button', { type: 'button', role: 'menuitem', 'data-action': entry.id, disabled: entry.disabled,
        onclick: (e) => { e.stopPropagation(); closeMenu(); try { Promise.resolve(entry.fn()).catch(err => flash(err.message, true)); } catch (err) { flash(err.message, true); } } }, entry.label);
      menuNode.append(button);
    }
    root.append(menuNode);
    const rect = menuNode.getBoundingClientRect(), win = document.defaultView;
    menuNode.style.left = Math.max(4, Math.min(Number(x) || 4, (win?.innerWidth || 1024) - rect.width - 4)) + 'px';
    menuNode.style.top = Math.max(4, Math.min(Number(y) || 4, (win?.innerHeight || 768) - rect.height - 4)) + 'px';
    menuNode.querySelector('button:not(:disabled)')?.focus();
  }
  function wireTreeItem(item, row) {
    const isDir = row.type === 'dir'; let hold = null, origin = null;
    const cancelHold = () => { if (hold) clearTimeout(hold); hold = null; };
    item.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); cancelHold(); openMenu(row.path, isDir, e.clientX, e.clientY); });
    item.addEventListener('keydown', e => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); e.stopPropagation(); const r = item.getBoundingClientRect(); openMenu(row.path, isDir, r.left, r.bottom); }
    });
    item.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      origin = { x: e.clientX, y: e.clientY };
      cancelHold(); hold = setTimeout(() => { hold = null; suppressClick = true; setTimeout(() => { suppressClick = false; }, 700); openMenu(row.path, isDir, origin.x, origin.y); }, 550);
    });
    item.addEventListener('pointermove', e => { if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 10) cancelHold(); });
    item.addEventListener('pointerup', cancelHold); item.addEventListener('pointercancel', cancelHold);
    item.addEventListener('dragstart', e => { cancelHold(); dragging = row.path; e.dataTransfer?.setData('text/plain', row.path); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragend', () => { dragging = ''; });
    if (isDir) {
      item.addEventListener('dragover', e => { if (dragging) { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } });
      item.addEventListener('drop', e => { if (!dragging) return; e.preventDefault(); e.stopPropagation(); const from = dragging; dragging = ''; transferPath(from, row.path, false); });
    }
  }
  explorerBody.addEventListener('keydown', e => { if (e.target === explorerBody && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); e.stopPropagation(); const r = explorerBody.getBoundingClientRect(); openMenu('', true, r.left, r.top); } });
  explorerBody.addEventListener('contextmenu', e => { e.preventDefault(); openMenu('', true, e.clientX, e.clientY); });
  explorerBody.addEventListener('dragover', e => { if (dragging) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } });
  explorerBody.addEventListener('drop', e => { if (!dragging) return; e.preventDefault(); const from = dragging; dragging = ''; transferPath(from, '', false); });
  // Long press the empty explorer to operate on the root directory.
  let rootHold = null, rootOrigin = null;
  explorerBody.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || e.target.closest('.pm-tree-row')) return;
    rootOrigin = { x: e.clientX, y: e.clientY };
    rootHold = setTimeout(() => { rootHold = null; openMenu('', true, rootOrigin.x, rootOrigin.y); }, 550);
  });
  const cancelRootHold = () => { if (rootHold) clearTimeout(rootHold); rootHold = null; };
  explorerBody.addEventListener('pointermove', e => { if (rootOrigin && Math.hypot(e.clientX-rootOrigin.x, e.clientY-rootOrigin.y) > 10) cancelRootHold(); });
  explorerBody.addEventListener('pointerup', cancelRootHold); explorerBody.addEventListener('pointercancel', cancelRootHold);

  function applyWrites(entries, removeSources = false, sourceRoot = '') {
    const written = [], removed = [];
    try {
      for (const entry of entries) { projectFS.write(entry.to, entry.value); written.push(entry.to); }
      if (removeSources) {
        for (const entry of entries) { projectFS.remove(entry.from); removed.push(entry); }
        const root = sourceRoot || entries[0]?.from;
        // Keep the source directory visible when moving its last file or folder.
        const parent = root ? parentDir(root) : '';
        if (parent && !Object.keys(files()).some(p => p.startsWith(parent + '/'))) {
          const keep = parent + '/.keep'; projectFS.write(keep, ''); written.push(keep);
        }
      }
    } catch (err) {
      let restoreFailed = false;
      for (const entry of removed) try { projectFS.write(entry.from, entry.value); } catch { restoreFailed = true; }
      // If restoration fails, retain destination copies rather than destroying the only remaining data.
      if (!restoreFailed) for (const path of written) try { projectFS.remove(path); } catch { restoreFailed = true; }
      state.lastSnap = null; sync();
      if (restoreFailed) throw new Error(T('操作失败且回滚不完整，请检查源和目标文件：', 'Operation failed and rollback was incomplete; check source and destination: ') + err.message);
      throw err;
    }
  }
  function transferPath(from, dir, copy) {
    const plan = planWorkspaceTransfer(files(), from, dir, { copy });
    if (!plan.ok) { flash(plan.error); return false; }
    // Copy includes unsaved editor content; move keeps dirty buffers at their new paths.
    if (copy) for (const entry of plan.entries) { const t = tabOf(entry.from); if (t?.dirty) entry.value = t.value; }
    try { applyWrites(plan.entries, !copy, from); } catch (err) { flash(err.message, true); return false; }
    if (!copy) {
      for (const tab of state.tabs) if (tab.path === from || tab.path.startsWith(from + '/')) tab.path = plan.target + tab.path.slice(from.length);
      if (state.active === from || state.active.startsWith(from + '/')) state.active = plan.target + state.active.slice(from.length);
    }
    state.selected = plan.target; state.lastSnap = null; sync();
    flash(copy ? T('已拷贝', 'Copied') : T('已移动', 'Moved')); return true;
  }
  function pasteInto(dir) {
    const clip = state.clipboard;
    if (clip && transferPath(clip.path, dir, !clip.cut) && clip.cut) state.clipboard = null;
  }
  function zipDataUrl(bytes) {
    let data = ''; for (let i = 0; i < bytes.length; i += 0x8000) data += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return 'data:application/zip;base64,' + btoa(data);
  }
  function destinationFree(path, snap = files()) {
    return isWorkspacePath(path) && !Object.keys(snap).some(p => p === path || p.startsWith(path + '/') || path.startsWith(p + '/'));
  }
  async function compressPath(path) {
    const snap = files();
    const paths = Object.keys(snap).filter(p => p === path || p.startsWith(path + '/'));
    if (!paths.length) return flash(T('文件不存在', 'Source not found'));
    const entries = paths.map(p => ({ name: p.slice(parentDir(path).length ? parentDir(path).length + 1 : 0), bytes: fileBytesFromValue(tabOf(p)?.dirty ? tabOf(p).value : snap[p]).bytes }));
    const blob = await createCompressedZip(entries), bytes = new Uint8Array(await blob.arrayBuffer());
    let target = path + '.zip', n = 2;
    while (!destinationFree(target) && n < 10000) target = path + ' ' + n++ + '.zip';
    if (!destinationFree(target)) return flash(T('目标已存在', 'Destination exists'));
    try { projectFS.write(target, zipDataUrl(bytes)); } catch (err) { return flash(err.message); }
    state.lastSnap = null; sync(); flash(T('已创建 ', 'Created ') + target);
  }
  async function extractPath(path) {
    const raw = files()[path]; if (typeof raw !== 'string') return flash(T('文件不存在', 'File not found'));
    const got = raw.startsWith('data:') ? await unpackZipFromDataUrl(raw, { strict: true }) : await unpackZip(new TextEncoder().encode(raw), { strict: true });
    if (!got.ok) return flash(got.error);
    const base = path.replace(/\.zip$/i, '') || path + '-extracted';
    if (!destinationFree(base)) return flash(T('解压目标已存在，不会覆盖', 'Destination exists; nothing overwritten'));
    const entries = got.files.map(f => ({ to: base + '/' + f.path, value: f.content }));
    const names = new Set();
    for (const entry of entries) {
      if (!isWorkspacePath(entry.to) || names.has(entry.to) || !destinationFree(entry.to)) return flash(T('压缩包路径冲突或不安全', 'Unsafe or conflicting archive paths'));
      names.add(entry.to);
    }
    for (const entry of entries) if (entries.some(other => other !== entry && other.to.startsWith(entry.to + '/'))) return flash(T('压缩包路径冲突', 'Conflicting archive paths'));
    try { applyWrites(entries); } catch (err) { return flash(err.message); }
    state.lastSnap = null; sync(); flash(T('已解压到 ', 'Extracted to ') + base);
  }

  function sync() {
    if (store.state._projectPersistenceError) flash(store.state._projectPersistenceError, true);
    const snap = files();
    if (snap !== state.lastSnap) {
      state.lastSnap = snap;
      for (const tab of [...state.tabs]) {
        if (!Object.prototype.hasOwnProperty.call(snap, tab.path)) {
          if (!tab.dirty) closeTab(tab.path, { silent: true });
          else tab.gone = true;
          continue;
        }
        tab.gone = false;
        const latest = snap[tab.path];
        if (!tab.dirty && latest !== tab.saved) {
          tab.saved = latest;
          tab.value = latest;
          if (tab.path === state.active) showTab(tab, { keepSelection: true });
        }
      }
      if (state.selected && !Object.prototype.hasOwnProperty.call(snap, state.selected) && !Object.keys(snap).some(p => p.startsWith(state.selected + '/'))) state.selected = '';
    }
    renderTree();
    renderTabs();
    renderHeader();
  }

  function renderHeader() {
    const entries = workspaceEntries(files()).filter((e) => !isPlaceholder(e.path));
    projCount.textContent = T(`${entries.length} 个文件`, `${entries.length} files`);
    const cur = current();
    btnSave.disabled = !cur || cur.kind === 'media';
  }

  // ── 资源管理器 ──
  let treeKey = '';
  function treeIcon(path, isDir, expanded) {
    const icon = h('span', { class: 'pm-tree-icon', 'aria-hidden': 'true' });
    icon.innerHTML = projectIconSvg(projectIconType(path, isDir, expanded));
    return icon;
  }
  function renderTree({ force = false } = {}) {
    const entries = workspaceEntries(files());
    const rows = explorerRows(entries, state.collapsed).filter((r) => !isPlaceholder(r.path));
    const editing = !!(state.creating || state.renaming);
    // 正在输入文件名时不重建（否则输入框被替换，内容与焦点丢失）；列表没有变化也不重建（否则轮询会打断点击）
    const key = JSON.stringify([
      rows.map((r) => [r.path, r.depth, r.type]), [...state.collapsed], state.active, state.selected,
      state.tabs.filter((t) => t.dirty).map((t) => t.path), !!state.creating, state.renaming,
    ]);
    if (!force && (editing || key === treeKey)) return;
    treeKey = key;
    explorerBody.replaceChildren();
    if (state.creating) explorerBody.append(createRow());
    if (!rows.length && !state.creating) {
      explorerBody.append(h('div', { class: 'pm-tree-empty' }, T('项目还没有文件。在此处右键或长按以新建或导入。', 'No files yet. Right-click or long-press here to create or import.')));
      return;
    }
    for (const row of rows) {
      const isDir = row.type === 'dir';
      const isRenaming = state.renaming === row.path;
      const labelNode = isRenaming
        ? renameInput(row)
        : h('span', { class: 'pm-tree-name', text: row.name });
      const tab = !isDir ? tabOf(row.path) : null;
      const item = h('div', {
        class: `pm-tree-row${isDir ? ' dir' : ' file'}${row.path === state.active ? ' active' : ''}${state.selected === row.path ? ' selected' : ''}${tab && tab.dirty ? ' dirty' : ''}`,
        role: 'treeitem',
        'aria-level': String(row.depth + 1),
        tabindex: '0', draggable: 'true', 'data-path': row.path,
        'aria-expanded': isDir ? String(!state.collapsed.has(row.path)) : null,
        style: `padding-left:${8 + row.depth * 12}px`,
        title: row.path,
        onclick: (e) => {
          if (isRenaming || suppressClick) { suppressClick = false; return; }
          e.stopPropagation();
          state.selected = row.path;
          if (isDir) {
            if (state.collapsed.has(row.path)) state.collapsed.delete(row.path); else state.collapsed.add(row.path);
            renderTree();
          } else openFile(row.path);
        },
      }, [
        treeIcon(row.path, isDir, !state.collapsed.has(row.path)),
        labelNode,
        !isRenaming && !isDir && tab && tab.dirty ? h('span', { class: 'pm-dot', title: T('未保存', 'Unsaved') }, '●') : null,
      ]);
      if (!isRenaming) wireTreeItem(item, row);
      explorerBody.append(item);
    }
  }

  function createRow() {
    const input = h('input', {
      class: 'pm-input',
      type: 'text',
      placeholder: state.creating && state.creating.kind === 'folder' ? T('文件夹名，如 src/components', 'Folder name, e.g. src/components') : T('文件名，如 src/app.js', 'File name, e.g. src/app.js'),
      'aria-label': state.creating && state.creating.kind === 'folder' ? T('新文件夹名', 'New folder name') : T('新文件名', 'New file name'),
    });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // 输入法候选确认时的回车不提交
      if (e.key === 'Enter') { e.preventDefault(); commitCreate(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); state.creating = null; renderTree({ force: true }); }
    });
    const creation = state.creating;
    input.addEventListener('blur', () => { if (state.creating !== creation) return; if (input.value.trim()) commitCreate(input.value); if (state.creating === creation) { state.creating = null; renderTree({ force: true }); } });
    queueMicrotask(() => input.focus());
    return h('div', { class: 'pm-tree-row create', title: state.creating?.dir || '/' }, [h('span', { class: 'pm-create-dir', text: (state.creating?.dir || '/') + ' /' }), input]);
  }

  function renameInput(row) {
    const input = h('input', { class: 'pm-input', type: 'text', value: row.name, 'aria-label': T('重命名', 'Rename') });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); commitRename(row.path, input.value); }
      if (e.key === 'Escape') { e.preventDefault(); state.renaming = ''; renderTree({ force: true }); }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', () => { if (state.renaming === row.path) commitRename(row.path, input.value); });
    queueMicrotask(() => { input.focus(); input.select(); });
    return input;
  }

  function startCreate(kind = 'file') {
    state.renaming = '';
    state.creating = { kind, dir: state.selected && !Object.prototype.hasOwnProperty.call(files(), state.selected) ? state.selected : parentDir(state.selected) };
    if (state.creating.dir) state.collapsed.delete(state.creating.dir);
    renderTree({ force: true });
  }

  // 导入：把本机文件（或整个文件夹，保留相对结构）写入沙箱。导入到当前选中目录下；
  // 二进制、重名、不合法路径一律跳过并计数，绝不覆盖已有文件。
  async function importFiles(input, { folder = false } = {}) {
    const list = [...(input.files || [])]; input.value = '';
    if (!list.length) return;
    const names = list.slice(0, 30).map(f => folder && f.webkitRelativePath ? f.webkitRelativePath : f.name).join('\n');
    if (!window.confirm(T(`即将导入 ${list.length} 个文件到独立项目（不会导入会话沙箱）。\n\n${names}${list.length > 30 ? '\n…' : ''}\n\n导入前将在本机用规则审核文本、用本地图像模型审核图片。无法审核的二进制、压缩包或超限文件将跳过；文件内容不会发送到网关。继续？`, `Import ${list.length} file(s) into the independent project?\n\n${names}${list.length > 30 ? '\n…' : ''}\n\nText is checked by local rules and images by a local model. Unsupported binary files and archives are skipped; file contents are not sent to the gateway. Continue?`))) return;
    const dir = state.selected && !Object.prototype.hasOwnProperty.call(files(), state.selected) ? state.selected : parentDir(state.selected);
    const taken = new Set(Object.keys(files())); let done = 0, skipped = 0, blocked = 0; const reasons = [];
    for (const file of list) {
      const rel = folder && file.webkitRelativePath ? file.webkitRelativePath : file.name;
      const path = joinPath(dir, rel);
      const segOk = rel.split('/').filter(Boolean).every(seg => validateName(seg).ok);
      if (!segOk || !isProjectUserPath(path) || taken.has(path) || !destinationFree(path) || file.size > PM_IMPORT_MAX_BYTES) { skipped++; continue; }
      flash(T(`正在审核 ${rel}…`, `Reviewing ${rel}…`), true);
      try {
        const result = await reviewProjectImport(file);
        if (!result.ok) { blocked++; reasons.push(`${rel}: ${result.reason || 'review'}`); continue; }
        if (taken.has(path) || !destinationFree(path)) { skipped++; continue; }
        projectFS.write(path, result.content); taken.add(path); done++;
      } catch (error) { blocked++; reasons.push(`${rel}: ${String(error?.message || error).slice(0, 120)}`); }
    }
    state.lastSnap = null; sync();
    const detail = reasons.length ? ' · ' + reasons.slice(0, 3).join('；') + (reasons.length > 3 ? '…' : '') : '';
    flash(T(`已导入 ${done} 个；跳过 ${skipped} 个；审核未通过或无法审核 ${blocked} 个`, `Imported ${done}; skipped ${skipped}; blocked or unreviewable ${blocked}`) + detail, true);
  }

  function commitCreateFolder(raw) {
    const dir = state.creating ? state.creating.dir : '';
    const parts = String(raw || '').trim().split('/').filter(Boolean);
    if (!parts.length) return flash(T('名称不能为空', 'Name is required'));
    const names = parts.map((seg) => validateName(seg));
    const bad = names.find((c) => !c.ok);
    if (bad) return flash(bad.error);
    const path = joinPath(dir, names.map((c) => c.name).join('/'));
    if (!isWorkspacePath(path)) return flash(T('路径不合法', 'Invalid path'));
    const snap = files();
    if (Object.keys(snap).some((p) => p === path || p.startsWith(path + '/') || path.startsWith(p + '/'))) return flash(T('同名文件或文件夹已存在', 'A file or folder with that name exists'));
    try { projectFS.write(path + '/.keep', ''); } catch (err) { return flash(err.message); }
    state.creating = null;
    state.collapsed.delete(path);
    state.lastSnap = null;
    sync();
    flash(T('已新建文件夹 ' + path, 'Created folder ' + path));
  }

  function commitCreate(raw) {
    if (state.creating && state.creating.kind === 'folder') return commitCreateFolder(raw);
    const dir = state.creating ? state.creating.dir : '';
    const parts = String(raw || '').trim().split('/').filter(Boolean);
    const check = validateName(parts[parts.length - 1]);
    if (!check.ok || parts.some(p => !validateName(p).ok)) return flash(check.error || T('名称不合法', 'Invalid name'));
    const path = joinPath(dir, parts.slice(0, -1).concat(check.name).join('/'));
    if (!isWorkspacePath(path) || isPlaceholder(path)) return flash(T('路径不合法', 'Invalid path'));
    if (Object.keys(files()).some(p => p === path || p.startsWith(path + '/') || path.startsWith(p + '/'))) return flash(T('同名文件或文件夹已存在', 'A file or folder with that name exists'));
    try { projectFS.write(path, ''); } catch (err) { return flash(err.message); }
    state.creating = null;
    state.lastSnap = null;
    openFile(path);
    flash(T(`已新建 ${path}`, `Created ${path}`));
  }

  function commitRename(from, raw) {
    state.renaming = '';
    const check = validateName(raw);
    if (!check.ok || check.name === '.keep') { renderTree({ force: true }); return flash(check.error || T('该名称保留', 'Name is reserved')); }
    const to = joinPath(parentDir(from), check.name);
    if (to === from) return renderTree({ force: true });
    const snap = files();
    const paths = Object.keys(snap).filter(p => p === from || p.startsWith(from + '/'));
    if (!isWorkspacePath(to) || !paths.length || Object.keys(snap).some(p => !paths.includes(p) && (p === to || p.startsWith(to + '/')))) { renderTree({ force: true }); return flash(T('目标名称不可用', 'Name not available')); }
    const entries = paths.map(path => ({ from: path, to: to + path.slice(from.length), value: snap[path] }));
    try { applyWrites(entries, true, from); } catch (err) { renderTree({ force: true }); return flash(err.message); }
    for (const tab of state.tabs) if (tab.path === from || tab.path.startsWith(from + '/')) tab.path = to + tab.path.slice(from.length);
    if (state.active === from || state.active.startsWith(from + '/')) state.active = to + state.active.slice(from.length);
    state.selected = to;
    state.lastSnap = null;
    sync();
    flash(T(`已重命名为 ${to}`, `Renamed to ${to}`));
  }

  function removePath(path, isDir) {
    const win = document.defaultView;
    const dirty = state.tabs.some(t => t.dirty && (t.path === path || t.path.startsWith(path + '/')));
    const label = (isDir ? T(`删除目录 ${path} 及其中的文件？`, `Delete folder ${path} and its files?`) : T(`删除 ${path}？`, `Delete ${path}?`)) + (dirty ? T(' 未保存的修改也将丢失。', ' Unsaved changes will also be lost.') : '');
    if (win && typeof win.confirm === 'function' && !win.confirm(label)) return;
    const targets = isDir
      ? Object.keys(files()).filter((p) => p.startsWith(`${path}/`))
      : [path];
    const backup = targets.map(p => ({ path: p, value: files()[p] }));
    const removed = [];
    try {
      for (const item of backup) { projectFS.remove(item.path); removed.push(item); }
      const parent = parentDir(path);
      if (parent && !Object.keys(files()).some(p => p.startsWith(parent + '/'))) projectFS.write(parent + '/.keep', '');
    } catch (err) {
      let restoreFailed = false;
      for (const item of removed) try { projectFS.write(item.path, item.value); } catch { restoreFailed = true; }
      state.lastSnap = null; sync();
      return flash((restoreFailed ? T('删除失败且回滚不完整，请检查文件：', 'Delete failed and rollback was incomplete; check files: ') : T('删除失败：', 'Delete failed: ')) + err.message, true);
    }
    for (const p of targets) if (tabOf(p)) closeTab(p, { silent: true });
    if (state.selected === path || state.selected.startsWith(path + '/')) state.selected = '';
    state.lastSnap = null;
    sync();
    flash(T('已删除', 'Deleted'));
  }

  // ── 标签与编辑器 ──
  function openFile(path) {
    if (isPlaceholder(path)) return;
    const content = files()[path];
    if (typeof content !== 'string') return flash(T('这是目录或不存在的文件', 'That is a folder or a missing file'));
    let tab = tabOf(path);
    if (!tab) {
      tab = { path, value: content, saved: content, dirty: false, gone: false, kind: isBinaryContent(content) ? 'media' : 'text' };
      state.tabs.push(tab);
    }
    state.active = path;
    state.selected = path;
    showTab(tab);
    renderTree();
    renderTabs();
    renderHeader();
    textarea.focus();
  }

  function showTab(tab, { keepSelection = false } = {}) {
    if (tab.kind === 'media') {
      renderMedia(tab);
      textarea.hidden = true;
      mediaView.hidden = false;
      emptyNote.hidden = true;
      updateStatus();
      return;
    }
    mediaView.hidden = true;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const scrollTop = textarea.scrollTop;
    if (textarea.value !== tab.value) textarea.value = tab.value;
    if (keepSelection) {
      textarea.setSelectionRange(Math.min(start, tab.value.length), Math.min(end, tab.value.length));
      textarea.scrollTop = scrollTop;
    } else {
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = 0;
    }
    updateGutter();
    updateStatus();
    emptyNote.hidden = true;
    textarea.hidden = false;
  }

  async function closeTab(path, { silent = false } = {}) {
    const tab = tabOf(path);
    if (!tab) return;
    if (tab.dirty && !silent) {
      if (askingClose) return;
      askingClose = true;
      let choice;
      try { choice = await askUnsaved([path]); } finally { askingClose = false; }
      if (choice === 'cancel') return;
      if (choice === 'save') {
        try { projectFS.write(tab.path, tab.value); } catch (err) { return flash(T('保存失败：' + err.message, 'Save failed: ' + err.message)); }
        tab.saved = tab.value; tab.dirty = false; tab.gone = false;
      }
    }
    state.tabs = state.tabs.filter((t) => t.path !== path);
    if (state.active === path) {
      const next = state.tabs[state.tabs.length - 1];
      state.active = next ? next.path : '';
      if (next) showTab(next); else showEmpty();
    }
    renderTabs();
    renderTree();
  }

  function renderMedia(tab) {
    if (mediaView._path === tab.path && mediaView._value === tab.value) return;
    mediaView._path = tab.path; mediaView._value = tab.value;
    const mime = (/^data:([^;,]*)/.exec(tab.value) || [])[1] || 'application/octet-stream';
    const name = tab.path.split('/').pop();
    const bytes = Math.floor(String(tab.value).length * 3 / 4);
    const info = mime + ' · ' + fmtBytes(bytes);
    let view;
    if (/^image\//.test(mime)) view = h('img', { class: 'pm-media-img', src: tab.value, alt: name });
    else if (/^audio\//.test(mime)) view = h('audio', { controls: true, src: tab.value });
    else if (/^video\//.test(mime)) view = h('video', { class: 'pm-media-img', controls: true, src: tab.value });
    else if (mime === 'application/pdf') view = h('iframe', { class: 'pm-media-frame', src: tab.value, title: name });
    else view = h('div', { class: 'pm-media-card' }, [
      h('p', {}, T(name + ' 暂不支持预览', name + ' cannot be previewed')),
      h('p', { class: 'pm-muted' }, info),
    ]);
    const dl = h('a', { class: 'pm-btn', href: tab.value, download: name }, [svgIcon(ICON.file), T('下载', 'Download')]);
    mediaView.replaceChildren(
      h('div', { class: 'pm-media-bar' }, [h('span', { class: 'pm-muted' }, name + ' · ' + info), h('span', { class: 'pm-spacer' }), dl]),
      h('div', { class: 'pm-media-body' }, [view]),
    );
  }

  function showEmpty() {
    mediaView.hidden = true;
    textarea.value = '';
    textarea.hidden = true;
    gutter.textContent = '';
    emptyNote.hidden = false;
    emptyNote.textContent = T('从左侧打开一个文件开始编辑。', 'Open a file from the explorer to start editing.');
    updateStatus();
  }

  function renderTabs() {
    tabsBar.replaceChildren();
    for (const tab of state.tabs) {
      const name = tab.path.split('/').pop();
      tabsBar.append(h('div', {
        class: `pm-tab${tab.path === state.active ? ' active' : ''}${tab.dirty ? ' dirty' : ''}${tab.gone ? ' gone' : ''}`,
        role: 'tab',
        'aria-selected': String(tab.path === state.active),
        title: tab.gone ? T(`${tab.path}（已在项目中删除）`, `${tab.path} (deleted in project)`) : tab.path,
        onclick: () => { state.active = tab.path; showTab(tab); renderTabs(); renderTree(); textarea.focus(); },
      }, [
        h('span', { class: 'pm-tab-name', text: name }),
        tab.dirty ? h('span', { class: 'pm-dot', 'aria-label': T('未保存', 'Unsaved') }, '●') : null,
        h('button', { type: 'button', class: 'pm-mini', 'aria-label': T('关闭标签', 'Close tab'), onclick: (e) => { e.stopPropagation(); closeTab(tab.path); } }, '×'),
      ]));
    }
    if (!state.tabs.length) showEmpty();
  }

  // 高亮语言：languageOf 的显示名 → hljs 语言 ID；超过行数上限或纯文本不着色（保持性能与可读）
  const HL_LINE_CAP = 3000;
  function paintHighlight() {
    const tab = current();
    const name = tab ? languageOf(tab.path) : 'Text';
    const lang = name.toLowerCase().replace('c++', 'cpp').replace('c#', 'csharp');
    const on = !!tab && name !== 'Text' && lineCount(textarea.value) <= HL_LINE_CAP;
    codeWrap.classList.toggle('hl-on', on);
    hlCode.innerHTML = on ? highlightCode(textarea.value + '\n', lang, escHtml) : '';
    hlPre.scrollTop = textarea.scrollTop;
    hlPre.scrollLeft = textarea.scrollLeft;
  }

  function updateGutter() {
    paintHighlight();
    const n = Math.min(lineCount(textarea.value), PROJECT_RENDER_LINE_CAP);
    let out = '';
    for (let i = 1; i <= n; i++) out += i + '\n';
    gutter.textContent = out;
    gutter.scrollTop = textarea.scrollTop;
  }

  function updateStatus() {
    const tab = current();
    statusLang.textContent = tab ? languageOf(tab.path) : '';
    // 运行按钮只对正在编辑的可运行脚本（JS / Python / C++）显示
    btnRun.hidden = !(tab && runnerFor(tab.path));
    const pos = lineCol(textarea.value, textarea.selectionEnd);
    statusPos.textContent = tab ? T(`行 ${pos.line}，列 ${pos.col}`, `Ln ${pos.line}, Col ${pos.col}`) : '';
    statusDirty.textContent = tab && tab.dirty ? T('● 未保存', '● Unsaved') : '';
  }

  textarea.addEventListener('input', () => {
    const tab = current();
    if (!tab) return;
    tab.value = textarea.value;
    tab.dirty = tab.value !== tab.saved;
    updateGutter();
    updateStatus();
    renderMarks();
    renderTabs();
    renderTree();
    renderHeader();
  });
  textarea.addEventListener('keydown', (e) => {
    const tab = current();
    if (!tab) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      applyEdit(indentEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd, { dedent: e.shiftKey }));
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      applyEdit(enterEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd));
    }
  });
  textarea.addEventListener('keyup', updateStatus);
  textarea.addEventListener('click', updateStatus);
  textarea.addEventListener('scroll', () => { gutter.scrollTop = textarea.scrollTop; hlPre.scrollTop = textarea.scrollTop; hlPre.scrollLeft = textarea.scrollLeft; renderMarks(); });

  function applyEdit(edit) {
    const tab = current();
    if (!tab) return;
    textarea.value = edit.value;
    textarea.setSelectionRange(edit.start, edit.end);
    tab.value = edit.value;
    tab.dirty = tab.value !== tab.saved;
    updateGutter();
    updateStatus();
    renderTabs();
    renderTree();
    renderHeader();
  }

  function saveActive() {
    const tab = current();
    if (!tab || tab.kind === 'media') return;
    try {
      projectFS.write(tab.path, tab.value);
    } catch (err) {
      return flash(T(`保存失败：${err.message}`, `Save failed: ${err.message}`));
    }
    tab.saved = tab.value;
    tab.dirty = false;
    tab.gone = false;
    state.lastSnap = null;
    renderTabs();
    renderTree();
    renderHeader();
    updateStatus();
    flash(T(`已保存 ${tab.path}`, `Saved ${tab.path}`));
  }

  // ── 段 2：编译 / 运行 ──
  function setOutOpen(open) {
    state.outOpen = !!open;
    outPanel.hidden = !state.outOpen;
    btnOut.setAttribute('aria-pressed', String(state.outOpen));
    if (state.outOpen) renderMarks();
  }

  function setRunning(running) {
    state.running = running;
    btnRun.disabled = running;
    btnStop.hidden = !running;
  }

  // fraction < 0 表示阶段未知（不确定条）；0..1 为确定进度
  function setProgress(text, fraction = -1) {
    outProgress.hidden = false;
    outProgLabel.textContent = String(text || '');
    outProgress.classList.toggle('indeterminate', !(fraction >= 0));
    outProgFill.style.width = fraction >= 0 ? `${Math.round(Math.min(1, fraction) * 1000) / 10}%` : '';
  }
  function hideProgress() {
    outProgress.hidden = true;
    outProgress.classList.remove('indeterminate');
    outProgFill.style.width = '';
  }
  const CPP_PHASE_TEXT = {
    bootstrap: () => T('启动本地 C++ Worker…', 'Starting local C++ worker…'),
    executing: () => T('加载本地 C++ 工具链…', 'Loading local C++ toolchain…'),
    'loading-assets': () => T('按需加载本站 C++ 工具链（首次约 30 MB）…', 'Loading the C++ toolchain (about 30 MB on first run)…'),
    compiling: () => T('Clang / LLD 编译与链接中…', 'Compiling and linking with Clang / LLD…'),
    'program-start': () => T('WASI 程序执行中…', 'Running the WASI program…'),
  };

  function clearOutput() {
    hideProgress();
    state.diags = [];
    outLines.replaceChildren();
    outProbs.replaceChildren();
    outSum.textContent = T('暂无输出。点击「运行」执行当前文件，或按 Ctrl+Enter。', 'No output yet. Click Run or press Ctrl+Enter.');
    renderMarks();
  }

  function appendOutLine(log) {
    const level = log && log.level === 'error' ? 'error' : log && log.level === 'warn' ? 'warn' : 'log';
    const el = h('div', { class: `pm-line ${level}`, text: String(log?.text ?? log ?? '').replace(/\n$/, '') });
    outLines.append(el);
    while (outLines.childElementCount > 2000) outLines.firstElementChild.remove();
    outLines.scrollTop = outLines.scrollHeight;
  }

  function renderProblems() {
    outProbs.replaceChildren();
    for (const d of state.diags) {
      outProbs.append(h('button', {
        type: 'button', class: `pm-prob ${d.severity}`, title: d.file,
        onclick: () => gotoLine(d.file, d.line, d.col),
      }, [
        h('span', { class: 'pm-prob-loc', text: `${d.file}:${d.line}:${d.col}` }),
        h('span', { class: 'pm-prob-msg', text: d.message }),
      ]));
    }
  }

  function renderMarks() {
    marks.replaceChildren();
    const tab = current();
    if (!tab || !state.diags.length || textarea.hidden) return;
    const lh = lineHeight();
    for (const d of state.diags) {
      if (d.file !== tab.path) continue;
      marks.append(h('div', {
        class: `pm-mark ${d.severity}`, title: d.message,
        style: `top:${10 + (d.line - 1) * lh - textarea.scrollTop}px`,
      }));
    }
  }

  function lineHeight() {
    const v = parseFloat(getComputedStyle(textarea).lineHeight);
    return Number.isFinite(v) && v > 0 ? v : 20;
  }

  function gotoLine(file, line, col = 1) {
    if (!tabOf(file)) openFile(file);
    const tab = tabOf(file);
    if (!tab) return flash(T(`无法打开 ${file}`, `Cannot open ${file}`));
    if (state.active !== file) { state.active = file; showTab(tab); renderTabs(); renderTree(); }
    const start = lineStartIndex(textarea.value, line);
    const pos = Math.min(start + Math.max(0, col - 1), textarea.value.length);
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
    textarea.scrollTop = Math.max(0, (line - 6) * lineHeight());
    gutter.scrollTop = textarea.scrollTop;
    renderMarks();
    updateStatus();
  }

  function stopRun() {
    if (state.controller) state.controller.abort();
  }

  async function runActive() {
    if (state.running) return flash(T('已有任务在运行', 'A run is already in progress'));
    const tab = current();
    if (!tab) return flash(T('先打开一个文件', 'Open a file first'));
    const lang = runnerFor(tab.path);
    if (!lang) return flash(T('只能运行 JS、Python、C++ 文件', 'Only JS, Python and C++ files can run'));
    if (tab.dirty) saveActive();
    const code = tab.value;
    const path = tab.path;
    const controller = new AbortController();
    state.controller = controller;
    state.diags = [];
    setRunning(true);
    setOutOpen(true);
    clearOutput();
    outSum.textContent = T(`${RUNNER_LABEL[lang]} · 运行中…`, `${RUNNER_LABEL[lang]} · running…`);
    outLines.replaceChildren();
    const onLog = (log) => appendOutLine(log);
    // Execute against a disposable snapshot: code cannot silently change the project.
    let fsObj;
    try { fsObj = createFS(projectFS.export()); } catch (error) { setRunning(false); return flash(error.message); }
    let out;
    try {
      if (lang === 'javascript') {
        out = await runJavaScript(code, fsObj, { signal: controller.signal, onOutput: onLog });
      } else if (lang === 'python') {
        out = await runPython(code, fsObj, (p) => {
          if (typeof p === 'string') outSum.textContent = `${RUNNER_LABEL[lang]} · ${p}`;
        }, [], { signal: controller.signal, onOutput: onLog });
      } else {
        out = await runCpp(code, {
          mainPath: path, files: cppSources(files(), path), signal: controller.signal,
          onPhase: (phase) => { if (CPP_PHASE_TEXT[phase]) setProgress(CPP_PHASE_TEXT[phase](), -1); },
          onProgress: (p) => {
            const total = Number(p?.total) || 0;
            const loaded = Math.min(Number(p?.loaded) || 0, total || Number(p?.loaded) || 0);
            const mb = (n) => (n / 1048576).toFixed(1);
            if (!(total > 0)) { setProgress(T(`下载工具链…（已 ${mb(loaded)} MB）`, `Downloading toolchain… (${mb(loaded)} MB)`), -1); return; }
            const fraction = Math.min(1, loaded / total);
            setProgress(T(`下载工具链 ${Math.round(fraction * 100)}%（${mb(loaded)} / ${mb(total)} MB）`, `Downloading toolchain ${Math.round(fraction * 100)}% (${mb(loaded)} / ${mb(total)} MB)`), fraction);
          },
        });
      }
    } catch (err) {
      out = { ok: false, logs: [], error: { message: String(err?.message || err) } };
    }
    state.controller = null;
    setRunning(false);
    hideProgress();
    // 运行器可能写出了文件（回写到 fsObj）：同步到 store，侧栏与 Agent 随之可见
    // Runtime writes remain in the disposable execution sandbox.
    state.lastSnap = null;
    sync();
    // 结果：用运行器返回的完整日志替换流式输出，并补上未出现在日志里的错误信息
    outLines.replaceChildren();
    const logs = Array.isArray(out.logs) ? out.logs : [];
    for (const log of logs.slice(-2000)) appendOutLine(log);
    const msg = out.error && out.error.message ? String(out.error.message) : '';
    if (msg && !logs.some((l) => String(l?.text ?? '').includes(msg))) appendOutLine({ level: 'error', text: msg });
    state.diags = parseDiagnostics(out, { activePath: path });
    outSum.textContent = runSummary(out, lang);
    renderProblems();
    renderMarks();
    if (!state.diags.length && out.ok) flash(T('运行成功', 'Run succeeded'));
    else if (state.diags.length) flash(T(`${state.diags.length} 个问题，点击输出面板中的条目可跳转`, `${state.diags.length} problem(s); click one in the output panel to jump`));
  }

  function toggleSide() {
    const collapsed = root.classList.toggle('pm-side-collapsed');
    btnSide.setAttribute('aria-expanded', String(!collapsed));
  }

  function flash(message, persistent = false) {
    statusMsg.textContent = String(message || '');
    clearTimeout(flash.t);
    if (!persistent) flash.t = setTimeout(() => { statusMsg.textContent = ''; }, 3200);
  }

  function onKey(e) {
    if (!root.isConnected || root.querySelector('.pm-confirm')) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveActive(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleSide(); return; }
    if (((e.ctrlKey || e.metaKey) && e.key === 'Enter') || e.key === 'F5') { e.preventDefault(); runActive(); return; }
    if (e.key === 'Escape' && menuNode) { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (e.key === 'Escape' && !state.creating && !state.renaming) {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener('keydown', onKey, true);
  // Browser navigation/refresh cannot offer our custom save dialog, but it must
  // still warn before the in-memory editor buffers are lost.
  const projectWindow = document.defaultView;
  const onBeforeUnload = (event) => {
    if (!state.tabs.some(tab => tab.dirty && tab.kind !== 'media')) return;
    event.preventDefault(); event.returnValue = '';
  };
  projectWindow?.addEventListener('beforeunload', onBeforeUnload);

  let askingClose = false;
  // 未保存修改：由用户明确选择。返回 'save' | 'discard' | 'cancel'
  function askUnsaved(paths) {
    return new Promise((resolve) => {
      const done = (v) => { document.removeEventListener('keydown', esc, true); wrap.remove(); resolve(v); };
      const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); } };
      const wrap = h('div', { class: 'pm-confirm', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('未保存的修改', 'Unsaved changes') }, [
        h('div', { class: 'pm-confirm-box' }, [
          h('p', {}, T('以下文件有未保存的修改：' + paths.join('、'), 'Unsaved changes in: ' + paths.join(', '))),
          h('div', { class: 'pm-confirm-acts' }, [
            h('button', { class: 'pm-btn', type: 'button', onclick: () => done('cancel') }, T('取消', 'Cancel')),
            h('button', { class: 'pm-btn', type: 'button', onclick: () => done('discard') }, T('丢弃并关闭', 'Discard and close')),
            h('button', { class: 'pm-btn primary', type: 'button', onclick: () => done('save') }, T('保存并关闭', 'Save and close')),
          ]),
        ]),
      ]);
      document.addEventListener('keydown', esc, true);
      root.append(wrap);
      wrap.querySelector('.pm-btn.primary').focus();
    });
  }

  async function close() {
    if (closing || askingClose) return;
    const dirty = state.tabs.filter((t) => t.dirty && t.kind !== 'media');
    if (dirty.length) {
      askingClose = true;
      let choice = 'cancel';
      try { choice = await askUnsaved(dirty.map((t) => t.path)); } finally { askingClose = false; }
      if (choice === 'cancel') return;
      if (choice === 'save') {
        for (const t of dirty) {
          try { projectFS.write(t.path, t.value); } catch (err) { return flash(T('保存失败：' + err.message, 'Save failed: ' + err.message)); }
          t.saved = t.value; t.dirty = false; t.gone = false;
        }
        state.lastSnap = null;
      }
    }
    if (closing) return;
    closing = true;

    clearInterval(timer);
    closeMenu();
    document.removeEventListener('pointerdown', dismissMenu, true);
    document.removeEventListener('keydown', onKey, true);
    projectWindow?.removeEventListener('beforeunload', onBeforeUnload);
    if (active === instance) active = null;
    root.classList.add('pm-leaving');
    setTimeout(() => root.remove(), 200);
  }

  const instance = {
    close,
    focus() { textarea.focus(); },
  };
  active = instance;
  timer = setInterval(sync, POLL_MS);
  sync();
  if (!state.tabs.length) {
    const first = explorerRows(workspaceEntries(files()), state.collapsed)
      .find((row) => row.type === 'file' && !isPlaceholder(row.path) && !isBinaryContent(files()[row.path]));
    if (first) openFile(first.path); else showEmpty();
  }
  return instance;
}

/** 侧栏「项目」按钮。 */
export function installProjectEntry({ store, agent, doc = document }) {
  // 两个入口：顶栏「项目」按钮（主入口，始终可见）与沙箱面板里的图标按钮；同一个打开逻辑，各自只绑定一次
  let bound = false;
  for (const id of ['project-toggle', 'open-project']) {
    const button = doc.getElementById(id);
    if (!button || button.dataset.bound === '1') continue;
    button.dataset.bound = '1';
    button.addEventListener('click', () => openProjectMode({ store, agent }));
    bound = true;
  }
  return bound;
}
