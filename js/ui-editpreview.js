// Stable editing DOM: filenames, headers, existing lines and scroll position survive
// parameter deltas. Only new/changed lines are patched; no per-delta innerHTML reset.
import { editPreviewMeta, editPreviewFoot } from './ui-markdown.js?v=2026.10.25.1';
import { text as localeText } from './locale.js';

const make = (tag, cls, text) => {
  const node = document.createElement(tag); node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const text = (node, value) => { const next = String(value || ''); if (node.textContent !== next) node.textContent = next; };

function createPreviewCard(path) {
  const window = make('section', 'edit-preview');
  window.dataset.path = path;
  const head = make('div', 'ep-head mono');
  const title = make('span', 'ep-path', path), meta = make('span', 'ep-meta');
  const body = make('div', 'ep-body'), empty = make('div', 'ep-line');
  empty.appendChild(make('span', 'ep-tx ep-empty', '（等待预览数据…）'));
  const foot = make('div', 'ep-foot mono');
  head.append(title, meta); body.appendChild(empty); window.append(head, body, foot);
  body.addEventListener('scroll', () => { card.userScrolledX = body.scrollLeft > 0; }, { passive: true });
  const card = { window, title, meta, body, empty, foot, lines: [], caret: null, previewPath: null, userScrolledX: false };
  return card;
}

function paintPreviewCard(card, preview, live) {
  const { window, title, meta, body, empty, foot } = card;
  const path = preview?.path || window.dataset.path || '(路径未定)';
  text(title, path);
  text(meta, preview ? editPreviewMeta(preview) : '正在准备编辑预览');
  text(foot, preview ? editPreviewFoot(preview) : '');
  foot.hidden = !foot.textContent;
  window.dataset.policy = preview?.policyVersion || '';
  window.dataset.status = preview?.status || (preview ? '' : 'pending');
  body.dataset.path = path;

  const pathChanged = card.previewPath !== path;
  const follow = pathChanged || (live && body.scrollHeight - body.scrollTop - body.clientHeight < 32);
  const scrollTop = body.scrollTop, scrollLeft = body.scrollLeft;
  const incoming = Array.isArray(preview?.changes) ? preview.changes : [];
  const added = document.createDocumentFragment();
  const emptyText = !preview ? '（等待预览数据…）'
    : preview.diffUnavailable || !preview.changes ? '（无法比较：缺少原始快照或差异计算超时）'
      : live && !preview.complete ? '（等待改动…）' : '（无行改动）';
  text(empty.firstChild, emptyText);
  incoming.forEach((line, index) => {
    let row = card.lines[index];
    if (!row) {
      const item = make('div', 'ep-line'), number = make('span', 'ep-no'), value = make('span', 'ep-tx');
      const sign = make('span', 'ep-sign');
      item.append(number, sign, value); added.appendChild(item);
      row = { item, number, value, sign, numberText: null, content: null }; card.lines.push(row);
    }
    row.item.classList.toggle('ep-add', line.kind === 'add');
    row.item.classList.toggle('ep-del', line.kind === 'del');
    row.item.classList.toggle('ep-hunk-start', index > 0 && line.hunk !== incoming[index - 1].hunk);
    text(row.sign, line.kind === 'del' ? '−' : '+');
    if (row.numberText !== line.no) { row.number.textContent = String(line.no); row.numberText = line.no; }
    if (row.content !== line.text) { row.value.textContent = String(line.text); row.content = line.text; }
  });
  // The caret lives after the code, not between old and newly-appended lines.
  body.insertBefore(added, card.caret);
  while (card.lines.length > incoming.length) card.lines.pop().item.remove();
  if (incoming.length) empty.remove();
  else if (!empty.isConnected) body.prepend(empty);
  const cursor = !!(live && preview && !preview.complete);
  if (cursor && !card.caret) { card.caret = make('span', 'ep-caret'); card.caret.setAttribute('aria-hidden', 'true'); body.appendChild(card.caret); }
  else if (!cursor && card.caret) { card.caret.remove(); card.caret = null; }
  body.scrollTop = follow ? body.scrollHeight : (pathChanged ? 0 : scrollTop);
  // 横向位置始终回到最左：行号与行首必须可见；横向滚动仅在用户主动滚动时保留（见 scroll 监听）。
  body.scrollLeft = pathChanged || !card.userScrolledX ? 0 : scrollLeft;
  card.previewPath = path;
}

let editPreviewFoldSequence = 0;

export function paintEditFoldContent(node, options) {
  const { icon = '', label, paths, discarded, live, state = '' } = options;
  const preview = options.preview || null;
  const files = preview?.files || (preview ? [preview] : []);
  const fileByPath = new Map(files.filter((file) => file && file.path).map((file) => [file.path, file]));
  const discardedPaths = discarded instanceof Set ? discarded : new Set(discarded || []);
  node._editOptions = options;
  let dom = node._editDom;
  if (!dom) {
    const ico = make('span', 'chip-ico think-ico'); ico.innerHTML = icon;
    const name = make('span', 'mono chip-name');
    const status = make('span', 'chip-state ep-state');
    const detail = make('div', 'chip-detail'), inner = make('div', 'fold-inner');
    const list = make('ul', 'edit-paths'), note = make('div', 'fold-note');
    inner.append(list, note); detail.appendChild(inner); node.append(ico, name, status, detail);
    dom = node._editDom = { name, status, list, note, pathRows: new Map() };
  }
  text(dom.name, label); text(dom.status, state); dom.status.hidden = !state;
  const setExpanded = (row, expanded) => {
    row.item.classList.toggle('expanded', expanded);
    row.name.setAttribute('aria-expanded', String(expanded));
    row.fold.setAttribute('aria-hidden', String(!expanded));
    if ('inert' in row.fold) row.fold.inert = !expanded;
  };
  const displayPaths = [...new Set((Array.isArray(paths) ? paths : []).map(String).filter(Boolean))];
  if (preview?.path && !displayPaths.includes(preview.path)) displayPaths.push(preview.path);
  const wanted = new Set(displayPaths);
  for (const [path, row] of dom.pathRows) {
    if (wanted.has(path)) continue;
    row.item.remove(); dom.pathRows.delete(path);
  }
  displayPaths.forEach((path, index) => {
    let row = dom.pathRows.get(path);
    if (!row) {
      const item = make('li', 'mono edit-path-row'), head = make('div', 'edit-path-head');
      const pathButton = make('button', 'edit-path'), tag = make('span', 'fold-tag');
      const stats = make('span', 'edit-stats'), add = make('span', 'diff-add'), del = make('span', 'diff-del');
      const fold = make('div', 'edit-path-fold'), foldInner = make('div', 'edit-path-fold-inner');
      const card = createPreviewCard(path);
      fold.id = `edit-path-preview-${++editPreviewFoldSequence}`;
      fold.setAttribute('aria-hidden', 'true'); fold.inert = true;
      foldInner.appendChild(card.window); fold.appendChild(foldInner);
      pathButton.type = 'button'; pathButton.setAttribute('aria-controls', fold.id); pathButton.setAttribute('aria-expanded', 'false');
      stats.append(add, del); head.append(pathButton, stats, tag); item.append(head, fold);
      row = { item, head, name: pathButton, tag, stats, add, del, fold, card, userToggle: null, wasLive: false };
      pathButton.addEventListener('click', (event) => {
        event.stopPropagation();
        row.userToggle = !row.item.classList.contains('expanded');
        setExpanded(row, row.userToggle);
      });
      dom.pathRows.set(path, row);
    }
    const at = dom.list.children[index] || null;
    if (at !== row.item) dom.list.insertBefore(row.item, at);
    const dropped = discardedPaths.has(path);
    text(row.name, path);
    row.name.setAttribute('aria-label', localeText(`展开或收起 ${path} 的编辑预览`, `Toggle edit preview for ${path}`));
    row.item.dataset.path = path;
    const file = fileByPath.get(path) || (preview?.path === path ? preview : null);
    const known = file && file.added != null && file.removed != null;
    const deletionOnly = known && file.added === 0 && file.removed > 0;
    row.add.className = deletionOnly ? 'diff-del' : 'diff-add';
    row.del.className = deletionOnly ? 'diff-add' : 'diff-del';
    text(row.add, !known ? '+—' : deletionOnly ? `-${file.removed}` : `+${file.added}`);
    text(row.del, !known ? '-—' : deletionOnly ? '0' : `-${file.removed}`);
    row.stats.title = known ? `新增 ${file.added} 行，删除 ${file.removed} 行${file.failed ? '（写入失败，仅为拟议改动）' : ''}` : '缺少原始快照或差异计算超时';
    row.item.classList.toggle('fold-discarded', dropped);
    row.item.title = dropped ? localeText('设置中开启了自动清理：因最终回答未引用，本文件已在回合结束时移除。', 'Auto-clean is enabled; this file was removed at turn end because the final answer did not reference it.') : '';
    text(row.tag, dropped ? localeText('自动清理 · 未引用', 'Auto-cleaned · Unreferenced') : ''); row.tag.hidden = !dropped;
    if ((live && !row.wasLive) || (!live && row.wasLive)) row.userToggle = null;
    // Live Edited Files open their per-file diffs by default; users can still collapse a row.
    setExpanded(row, row.userToggle == null ? !!live : row.userToggle);
    row.wasLive = !!live;
    paintPreviewCard(row.card, file, live);
  });
  text(dom.note, discardedPaths.size ? localeText(`本轮根据设置自动清理了 ${discardedPaths.size} 个未引用文件；internal/ 与 uploads/ 下的文件始终保留。`, `Auto-clean removed ${discardedPaths.size} unreferenced files this turn; files under internal/ and uploads/ are always retained.`) : '');
  dom.note.hidden = !discardedPaths.size;
  node.classList.toggle('has-discarded', discardedPaths.size > 0);
}

export function toggleEditingFold(node) {
  if (!node) return false;
  const expanded = !node.classList.contains('expanded');
  node.classList.toggle('expanded', expanded);
  node._userToggle = expanded;
  return expanded;
}

import { presentationCallSettled } from './toolpresentation.js?v=2026.10.25.1';
export function syncEditingFold(node, { messages, resultIds, busy }) {
  if (!node) return false;
  const owner = messages.find((m) => m.id === node.dataset.ownerId);
  const lastUser = messages.findLastIndex((m) => m.role === 'user' && !m.silent);
  const current = owner && messages.indexOf(owner) > lastUser;
  node._active = !!(current && busy && !owner.cancelled
    && node._activeCalls?.some((call) => !presentationCallSettled(call, resultIds)));
  node.classList.toggle('live', node._active);
  node.classList.toggle('is-working', node._active);
  node.setAttribute('aria-busy', String(node._active));

  const autoCollapse = node.classList.contains('edited-files')
    && node._editingWasActive === true && !node._active;
  if (autoCollapse) node._userToggle = false;
  if (autoCollapse) node.classList.remove('expanded');
  else {
    const autoOpen = node._active;
    node.classList.toggle('expanded', node._userToggle == null ? autoOpen : node._userToggle);
  }
  node._editingWasActive = node._active;
  return autoCollapse;
}
