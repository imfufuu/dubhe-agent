// Dubhe Agent · 项目模式（第 17 条，参照 VS Code）：代码为主、AI 为辅。
// 全屏工作区：左侧资源管理器（沙箱工作区文件树）、中间多标签代码编辑器、底部状态栏。
// 文件直接读写永久沙箱（agent.sandboxWrite / sandboxRemove），侧栏与 Agent 看到的是同一份文件。
// 轮询 store.state.files 同步外部改动（Agent 写入）：未保存的标签不会被覆盖。
import { uiText as T } from './locale.js';
import { highlightCode } from './ui-markdown.js?v=2026.10.25.1';
const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import {
  workspaceEntries, isBinaryContent, languageOf, lineCol, lineCount, indentEdit, enterEdit,
  validateName, joinPath, parentDir, explorerRows, isWorkspacePath, PROJECT_RENDER_LINE_CAP,
} from './project-core.js';
import { runJavaScript, runPython, runCpp } from './sandbox.js';
import {
  runnerFor, cppSources, parseDiagnostics, lineStartIndex, runSummary, RUNNER_LABEL,
} from './project-run.js';

const POLL_MS = 900;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON = {
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  output: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 18v-6M9 15l3-3 3 3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 17v-5M9.5 14.5 12 12l2.5 2.5"/>',
};
function svgIcon(inner) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', 'pm-ic');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '14');
  s.setAttribute('height', '14');
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
export function openProjectMode({ store, agent }) {
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
    diags: [],         // 最近一次运行的问题 [{file,line,col,severity,message}]
  };
  let closing = false;
  let timer = 0;
  const root = h('div', { class: 'pm-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('项目模式', 'Project mode') });
  const explorerBody = h('div', { class: 'pm-tree', role: 'tree' });
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
  const btnNew = h('button', { class: 'pm-icon', type: 'button', title: T('新建文件', 'New file'), 'aria-label': T('新建文件', 'New file'), onclick: () => startCreate() }, '+');
  const btnRefresh = h('button', { class: 'pm-icon', type: 'button', title: T('刷新', 'Refresh'), 'aria-label': T('刷新', 'Refresh'), onclick: () => { state.lastSnap = null; sync(); } }, '↻');
  const importFileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => importFiles(e.target) });
  const importDirInput = h('input', { type: 'file', multiple: true, hidden: true, webkitdirectory: true, onchange: (e) => importFiles(e.target, { folder: true }) });
  const btnImportFile = h('button', { class: 'pm-icon', type: 'button', title: T('导入文件', 'Import files'), 'aria-label': T('导入文件', 'Import files'), onclick: () => importFileInput.click() }, [svgIcon(ICON.file)]);
  const btnImportDir = h('button', { class: 'pm-icon', type: 'button', title: T('导入文件夹', 'Import folder'), 'aria-label': T('导入文件夹', 'Import folder'), onclick: () => importDirInput.click() }, [svgIcon(ICON.folder)]);
  const btnClose = h('button', { class: 'pm-btn', type: 'button', title: T('关闭（Esc）', 'Close (Esc)'), onclick: () => close() }, [svgIcon(ICON.close), T('关闭', 'Close')]);
  const btnRun = h('button', { class: 'pm-btn primary run', type: 'button', title: T('运行当前文件（Ctrl+Enter）', 'Run current file (Ctrl+Enter)'), onclick: () => runActive() }, T('▶ 运行', '▶ Run'));
  const btnStop = h('button', { class: 'pm-btn', type: 'button', hidden: true, title: T('停止运行', 'Stop'), onclick: () => stopRun() }, T('■ 停止', '■ Stop'));
  const btnOut = h('button', { class: 'pm-btn', type: 'button', title: T('显示 / 隐藏输出面板', 'Show / hide output panel'), onclick: () => setOutOpen(!state.outOpen) }, [svgIcon(ICON.output), T('输出', 'Output')]);

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
        h('div', { class: 'pm-ex-head' }, [h('span', {}, T('资源管理器', 'EXPLORER')), btnImportFile, btnImportDir, btnNew, btnRefresh]),
        explorerBody,
        importFileInput,
        importDirInput,
      ]),
      h('section', { class: 'pm-main' }, [tabsBar, editorWrap, emptyNote]),
    ]),
    h('footer', { class: 'pm-status' }, [statusLang, statusPos, statusDirty, h('span', { class: 'pm-spacer' }), statusMsg]),
  );
  root.querySelector('.pm-status').before(outPanel);
  (document.body || document.documentElement).appendChild(root);

  // ── 数据 ──
  const files = () => (store.state && store.state.files) || {};
  const tabOf = (path) => state.tabs.find((t) => t.path === path) || null;
  const current = () => tabOf(state.active);

  function sync() {
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
      if (state.selected && !Object.prototype.hasOwnProperty.call(snap, state.selected) && !snap[state.selected + '/']) state.selected = '';
    }
    renderTree();
    renderTabs();
    renderHeader();
  }

  function renderHeader() {
    const entries = workspaceEntries(files());
    projCount.textContent = T(`${entries.length} 个文件`, `${entries.length} files`);
    btnSave.disabled = !current();
  }

  // ── 资源管理器 ──
  let treeKey = '';
  function renderTree({ force = false } = {}) {
    const entries = workspaceEntries(files());
    const rows = explorerRows(entries, state.collapsed);
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
      explorerBody.append(h('div', { class: 'pm-tree-empty' }, T('工作区还没有文件。让 Agent 生成文件，或点“+”新建。', 'No files yet. Let the agent create some, or click “+”.')));
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
        'aria-expanded': isDir ? String(!state.collapsed.has(row.path)) : null,
        style: `padding-left:${8 + row.depth * 12}px`,
        title: row.path,
        onclick: (e) => {
          if (isRenaming) return;
          e.stopPropagation();
          state.selected = row.path;
          if (isDir) {
            if (state.collapsed.has(row.path)) state.collapsed.delete(row.path); else state.collapsed.add(row.path);
            renderTree();
          } else openFile(row.path);
        },
      }, [
        h('span', { class: 'pm-tree-glyph', 'aria-hidden': 'true' }, isDir ? (state.collapsed.has(row.path) ? '▸' : '▾') : ''),
        labelNode,
        !isRenaming && !isDir && tab && tab.dirty ? h('span', { class: 'pm-dot', title: T('未保存', 'Unsaved') }, '●') : null,
        !isRenaming ? h('span', { class: 'pm-row-acts' }, [
          h('button', { type: 'button', class: 'pm-mini', title: T('重命名', 'Rename'), 'aria-label': T('重命名', 'Rename'), onclick: (e) => { e.stopPropagation(); state.renaming = row.path; renderTree({ force: true }); } }, '✎'),
          h('button', { type: 'button', class: 'pm-mini danger', title: T('删除', 'Delete'), 'aria-label': T('删除', 'Delete'), onclick: (e) => { e.stopPropagation(); removePath(row.path, isDir); } }, '×'),
        ]) : null,
      ]);
      explorerBody.append(item);
    }
  }

  function createRow() {
    const input = h('input', {
      class: 'pm-input',
      type: 'text',
      placeholder: T('文件名，如 src/app.js', 'File name, e.g. src/app.js'),
      'aria-label': T('新文件名', 'New file name'),
    });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // 输入法候选确认时的回车不提交
      if (e.key === 'Enter') { e.preventDefault(); commitCreate(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); state.creating = null; renderTree({ force: true }); }
    });
    input.addEventListener('blur', () => { setTimeout(() => { if (state.creating) { state.creating = null; renderTree({ force: true }); } }, 0); });
    queueMicrotask(() => input.focus());
    return h('div', { class: 'pm-tree-row create' }, [input]);
  }

  function renameInput(row) {
    const input = h('input', { class: 'pm-input', type: 'text', value: row.name, 'aria-label': T('重命名', 'Rename') });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); commitRename(row.path, input.value); }
      if (e.key === 'Escape') { e.preventDefault(); state.renaming = ''; renderTree({ force: true }); }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    queueMicrotask(() => { input.focus(); input.select(); });
    return input;
  }

  function startCreate() {
    state.creating = { dir: state.selected && !files()[state.selected] ? state.selected : parentDir(state.selected) };
    renderTree({ force: true });
  }

  // 导入：把本机文件（或整个文件夹，保留相对结构）写入沙箱。导入到当前选中目录下；
  // 二进制、重名、不合法路径一律跳过并计数，绝不覆盖已有文件。
  async function importFiles(input, { folder = false } = {}) {
    const list = [...(input.files || [])];
    input.value = '';
    if (!list.length) return;
    const dir = state.selected && !files()[state.selected] ? state.selected : parentDir(state.selected);
    const taken = new Set(Object.keys(files()));
    let done = 0;
    let skipped = 0;
    for (const file of list) {
      const rel = folder && file.webkitRelativePath ? file.webkitRelativePath : file.name;
      const path = joinPath(dir, rel);
      const segOk = rel.split('/').filter(Boolean).every((seg) => validateName(seg).ok);
      if (!segOk || !isWorkspacePath(path) || taken.has(path)) { skipped++; continue; }
      let text = '';
      try { text = await file.text(); } catch { skipped++; continue; }
      if (isBinaryContent(text)) { skipped++; continue; }
      try { agent.sandboxWrite(path, text); taken.add(path); done++; } catch { skipped++; }
    }
    state.lastSnap = null;
    sync();
    flash(skipped
      ? T(`已导入 ${done} 个文件，跳过 ${skipped} 个（二进制、重名或名称不合法）`, `Imported ${done} file(s), skipped ${skipped} (binary, duplicate or invalid name)`)
      : T(`已导入 ${done} 个文件`, `Imported ${done} file(s)`));
  }

  function commitCreate(raw) {
    const dir = state.creating ? state.creating.dir : '';
    state.creating = null;
    const parts = String(raw || '').trim().split('/').filter(Boolean);
    const check = validateName(parts[parts.length - 1]);
    if (!check.ok) return flash(check.error);
    const path = joinPath(dir, parts.slice(0, -1).concat(check.name).join('/'));
    if (!isWorkspacePath(path)) return flash(T('路径不合法', 'Invalid path'));
    if (Object.prototype.hasOwnProperty.call(files(), path)) return flash(T('同名文件已存在', 'A file with that name exists'));
    try { agent.sandboxWrite(path, ''); } catch (err) { return flash(err.message); }
    state.lastSnap = null;
    openFile(path);
    flash(T(`已新建 ${path}`, `Created ${path}`));
  }

  function commitRename(from, raw) {
    state.renaming = '';
    const check = validateName(raw);
    if (!check.ok) return flash(check.error);
    const to = joinPath(parentDir(from), check.name);
    if (to === from) return renderTree({ force: true });
    if (!isWorkspacePath(to) || Object.prototype.hasOwnProperty.call(files(), to)) return flash(T('目标名称不可用', 'Name not available'));
    const snap = files();
    const content = snap[from];
    if (typeof content !== 'string') return renderTree({ force: true }); // 目录重命名暂不支持，保持原状
    try {
      agent.sandboxWrite(to, content);
      agent.sandboxRemove(from);
    } catch (err) { return flash(err.message); }
    const tab = tabOf(from);
    if (tab) { tab.path = to; if (state.active === from) state.active = to; }
    state.lastSnap = null;
    sync();
    flash(T(`已重命名为 ${to}`, `Renamed to ${to}`));
  }

  function removePath(path, isDir) {
    const win = document.defaultView;
    const label = isDir ? T(`删除目录 ${path} 及其中的文件？`, `Delete folder ${path} and its files?`) : T(`删除 ${path}？`, `Delete ${path}?`);
    if (win && typeof win.confirm === 'function' && !win.confirm(label)) return;
    const targets = isDir
      ? Object.keys(files()).filter((p) => p.startsWith(`${path}/`))
      : [path];
    for (const p of targets) {
      try { agent.sandboxRemove(p); } catch { /* 已不存在 */ }
      if (tabOf(p)) closeTab(p, { silent: true });
    }
    if (state.selected === path) state.selected = '';
    state.lastSnap = null;
    sync();
    flash(T('已删除', 'Deleted'));
  }

  // ── 标签与编辑器 ──
  function openFile(path) {
    const content = files()[path];
    if (typeof content !== 'string') return flash(T('这是目录或不存在的文件', 'That is a folder or a missing file'));
    if (isBinaryContent(content)) return flash(T('二进制文件不在编辑器中打开（可用 Agent 的 read_file / analyze_* 工具查看）', 'Binary files cannot be edited here (ask the agent to inspect them)'));
    let tab = tabOf(path);
    if (!tab) {
      tab = { path, value: content, saved: content, dirty: false, gone: false };
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

  function closeTab(path, { silent = false } = {}) {
    const tab = tabOf(path);
    if (!tab) return;
    if (tab.dirty && !silent && !confirmDiscard(path)) return;
    state.tabs = state.tabs.filter((t) => t.path !== path);
    if (state.active === path) {
      const next = state.tabs[state.tabs.length - 1];
      state.active = next ? next.path : '';
      if (next) showTab(next); else showEmpty();
    }
    renderTabs();
    renderTree();
  }

  function showEmpty() {
    textarea.value = '';
    textarea.hidden = true;
    gutter.textContent = '';
    emptyNote.hidden = false;
    emptyNote.textContent = T('从左侧打开一个文件开始编辑。', 'Open a file from the explorer to start editing.');
    updateStatus();
  }

  function confirmDiscard(path) {
    const win = document.defaultView;
    return !win || typeof win.confirm !== 'function' || win.confirm(T(`${path} 有未保存的修改，仍要关闭？`, `${path} has unsaved changes. Close anyway?`));
  }

  function renderTabs() {
    tabsBar.replaceChildren();
    for (const tab of state.tabs) {
      const name = tab.path.split('/').pop();
      tabsBar.append(h('div', {
        class: `pm-tab${tab.path === state.active ? ' active' : ''}${tab.dirty ? ' dirty' : ''}${tab.gone ? ' gone' : ''}`,
        role: 'tab',
        'aria-selected': String(tab.path === state.active),
        title: tab.gone ? T(`${tab.path}（已在沙箱中删除）`, `${tab.path} (deleted in sandbox)`) : tab.path,
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
    if (!tab) return;
    try {
      agent.sandboxWrite(tab.path, tab.value);
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
    const fsObj = agent.sandboxFS();
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
    try { agent.sandboxCommit(); } catch { /* 同步失败不影响输出 */ }
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

  function flash(message) {
    statusMsg.textContent = String(message || '');
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { statusMsg.textContent = ''; }, 3200);
  }

  function onKey(e) {
    if (!root.isConnected) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveActive(); return; }
    if (((e.ctrlKey || e.metaKey) && e.key === 'Enter') || e.key === 'F5') { e.preventDefault(); runActive(); return; }
    if (e.key === 'Escape' && !state.creating && !state.renaming) {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener('keydown', onKey, true);

  function close() {
    if (closing) return;
    const dirty = state.tabs.filter((t) => t.dirty);
    if (dirty.length) {
      const win = document.defaultView;
      if (win && typeof win.confirm === 'function' && !win.confirm(T(`还有 ${dirty.length} 个文件未保存，仍要关闭？`, `${dirty.length} file(s) unsaved. Close anyway?`))) return;
    }
    closing = true;
    clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
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
      .find((row) => row.type === 'file' && !isBinaryContent(files()[row.path]));
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
