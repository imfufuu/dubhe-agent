// Dubhe Agent · 项目模式（第 17 条，参照 VS Code）：代码为主、AI 为辅。
// 全屏工作区：左侧资源管理器（沙箱工作区文件树）、中间多标签代码编辑器、底部状态栏。
// 文件直接读写永久沙箱（agent.sandboxWrite / sandboxRemove），侧栏与 Agent 看到的是同一份文件。
// 轮询 store.state.files 同步外部改动（Agent 写入）：未保存的标签不会被覆盖。
import { uiText as T } from './locale.js';
import {
  workspaceEntries, isBinaryContent, languageOf, lineCol, lineCount, indentEdit, enterEdit,
  validateName, joinPath, parentDir, explorerRows, isWorkspacePath, PROJECT_RENDER_LINE_CAP,
} from './project-core.js';

const POLL_MS = 900;
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
  };
  let timer = 0;
  const root = h('div', { class: 'pm-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('项目模式', 'Project mode') });
  const explorerBody = h('div', { class: 'pm-tree', role: 'tree' });
  const tabsBar = h('div', { class: 'pm-tabs', role: 'tablist' });
  const gutter = h('div', { class: 'pm-gutter', 'aria-hidden': 'true' });
  const textarea = h('textarea', { class: 'pm-text', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': T('代码编辑器', 'Code editor') });
  const editorWrap = h('div', { class: 'pm-editor' }, [gutter, textarea]);
  const emptyNote = h('div', { class: 'pm-empty' });
  const statusLang = h('span', { class: 'pm-st-lang' });
  const statusPos = h('span', { class: 'pm-st-pos' });
  const statusDirty = h('span', { class: 'pm-st-dirty' });
  const statusMsg = h('span', { class: 'pm-st-msg', role: 'status', 'aria-live': 'polite' });
  const projName = h('span', { class: 'pm-proj-name' }, T('项目', 'Project'));
  const projCount = h('span', { class: 'pm-proj-count' });
  const btnSave = h('button', { class: 'pm-btn primary', type: 'button', title: T('保存（Ctrl+S）', 'Save (Ctrl+S)'), onclick: () => saveActive() }, T('保存', 'Save'));
  const btnNew = h('button', { class: 'pm-icon', type: 'button', title: T('新建文件', 'New file'), 'aria-label': T('新建文件', 'New file'), onclick: () => startCreate() }, '+');
  const btnRefresh = h('button', { class: 'pm-icon', type: 'button', title: T('刷新', 'Refresh'), 'aria-label': T('刷新', 'Refresh'), onclick: () => { state.lastSnap = null; sync(); } }, '↻');
  const btnClose = h('button', { class: 'pm-btn', type: 'button', title: T('关闭（Esc）', 'Close (Esc)'), onclick: () => close() }, T('关闭', 'Close'));

  root.append(
    h('header', { class: 'pm-top' }, [
      h('span', { class: 'pm-brand' }, 'DUBHE'),
      projName,
      projCount,
      h('span', { class: 'pm-spacer' }),
      btnSave,
      btnClose,
    ]),
    h('div', { class: 'pm-body' }, [
      h('aside', { class: 'pm-explorer', 'aria-label': T('资源管理器', 'Explorer') }, [
        h('div', { class: 'pm-ex-head' }, [h('span', {}, T('资源管理器', 'EXPLORER')), btnNew, btnRefresh]),
        explorerBody,
      ]),
      h('section', { class: 'pm-main' }, [tabsBar, editorWrap, emptyNote]),
    ]),
    h('footer', { class: 'pm-status' }, [statusLang, statusPos, statusDirty, h('span', { class: 'pm-spacer' }), statusMsg]),
  );
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
  function renderTree() {
    const entries = workspaceEntries(files());
    const rows = explorerRows(entries, state.collapsed);
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
          h('button', { type: 'button', class: 'pm-mini', title: T('重命名', 'Rename'), 'aria-label': T('重命名', 'Rename'), onclick: (e) => { e.stopPropagation(); state.renaming = row.path; renderTree(); } }, '✎'),
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
      if (e.key === 'Enter') { e.preventDefault(); commitCreate(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); state.creating = null; renderTree(); }
    });
    input.addEventListener('blur', () => { setTimeout(() => { if (state.creating) { state.creating = null; renderTree(); } }, 0); });
    queueMicrotask(() => input.focus());
    return h('div', { class: 'pm-tree-row create' }, [input]);
  }

  function renameInput(row) {
    const input = h('input', { class: 'pm-input', type: 'text', value: row.name, 'aria-label': T('重命名', 'Rename') });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(row.path, input.value); }
      if (e.key === 'Escape') { e.preventDefault(); state.renaming = ''; renderTree(); }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    queueMicrotask(() => { input.focus(); input.select(); });
    return input;
  }

  function startCreate() {
    state.creating = { dir: state.selected && !files()[state.selected] ? state.selected : parentDir(state.selected) };
    renderTree();
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
    if (to === from) return renderTree();
    if (!isWorkspacePath(to) || Object.prototype.hasOwnProperty.call(files(), to)) return flash(T('目标名称不可用', 'Name not available'));
    const snap = files();
    const content = snap[from];
    if (typeof content !== 'string') return renderTree(); // 目录重命名暂不支持，保持原状
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

  function updateGutter() {
    const n = Math.min(lineCount(textarea.value), PROJECT_RENDER_LINE_CAP);
    let out = '';
    for (let i = 1; i <= n; i++) out += i + '\n';
    gutter.textContent = out;
    gutter.scrollTop = textarea.scrollTop;
  }

  function updateStatus() {
    const tab = current();
    statusLang.textContent = tab ? languageOf(tab.path) : '';
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
  textarea.addEventListener('scroll', () => { gutter.scrollTop = textarea.scrollTop; });

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

  function flash(message) {
    statusMsg.textContent = String(message || '');
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { statusMsg.textContent = ''; }, 3200);
  }

  function onKey(e) {
    if (!root.isConnected) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveActive(); return; }
    if (e.key === 'Escape' && !state.creating && !state.renaming) {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener('keydown', onKey, true);

  function close() {
    const dirty = state.tabs.filter((t) => t.dirty);
    if (dirty.length) {
      const win = document.defaultView;
      if (win && typeof win.confirm === 'function' && !win.confirm(T(`还有 ${dirty.length} 个文件未保存，仍要关闭？`, `${dirty.length} file(s) unsaved. Close anyway?`))) return;
    }
    clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    if (active === instance) active = null;
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
  const button = doc.getElementById('open-project');
  if (!button || button.dataset.bound === '1') return false;
  button.dataset.bound = '1';
  button.addEventListener('click', () => openProjectMode({ store, agent }));
  return true;
}
