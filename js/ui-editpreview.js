// Stable editing DOM: filenames, headers, existing lines and scroll position survive
// parameter deltas. Only new/changed lines are patched; no per-delta innerHTML reset.
import { editPreviewMeta, editPreviewFoot } from './ui-markdown.js?v=2026.10.11.1';

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
  return { window, title, meta, body, empty, foot, lines: [], caret: null, previewPath: null };
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
  body.scrollLeft = pathChanged ? 0 : scrollLeft;
  card.previewPath = path;
}

export function paintEditFoldContent(node, options) {
  const { icon = '', label, paths, discarded, live, state = '' } = options;
  const preview = options.preview || null;
  const files = preview?.files || (preview ? [preview] : []);
  const fileByPath = new Map(files.filter((file) => file && file.path).map((file) => [file.path, file]));
  node._editOptions = options;
  let dom = node._editDom;
  if (!dom) {
    const ico = make('span', 'chip-ico think-ico'); ico.innerHTML = icon;
    const name = make('span', 'mono chip-name');
    const status = make('span', 'chip-state ep-state');
    const detail = make('div', 'chip-detail'), inner = make('div', 'fold-inner');
    const list = make('ul', 'edit-paths'), note = make('div', 'fold-note');
    const previews = make('div', 'edit-previews');
    inner.append(list, note, previews); detail.appendChild(inner); node.append(ico, name, status, detail);
    dom = node._editDom = { name, status, list, note, previews, pathRows: [], previewCards: new Map() };
  }
  text(dom.name, label); text(dom.status, state); dom.status.hidden = !state;
  paths.forEach((path, index) => {
    let row = dom.pathRows[index];
    if (!row) {
      const item = make('li', 'mono'), name = make('button', 'edit-path'), tag = make('span', 'fold-tag');
      const stats = make('span', 'edit-stats'), add = make('span', 'diff-add'), del = make('span', 'diff-del');
      name.type = 'button'; name.setAttribute('aria-label', `跳转到 ${path} 的编辑预览`);
      name.addEventListener('click', (event) => {
        event.stopPropagation();
        const card = node._editDom?.previewCards.get(item.dataset.path);
        card?.window?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      });
      stats.append(add, del); item.append(name, stats, tag); dom.list.appendChild(item);
      row = { item, name, tag, stats, add, del }; dom.pathRows.push(row);
    }
    const dropped = discarded.has(path);
    text(row.name, path); row.name.setAttribute('aria-label', `跳转到 ${path} 的编辑预览`); row.item.dataset.path = path;
    const file = fileByPath.get(path) || (preview?.path === path ? preview : null);
    const known = file && file.added != null && file.removed != null;
    const deletionOnly = known && file.added === 0 && file.removed > 0;
    row.add.className = deletionOnly ? 'diff-del' : 'diff-add';
    row.del.className = deletionOnly ? 'diff-add' : 'diff-del';
    text(row.add, !known ? '+—' : deletionOnly ? `-${file.removed}` : `+${file.added}`);
    text(row.del, !known ? '-—' : deletionOnly ? '0' : `-${file.removed}`);
    row.stats.title = known ? `新增 ${file.added} 行，删除 ${file.removed} 行${file.failed ? '（写入失败，仅为拟议改动）' : ''}` : '缺少原始快照或差异计算超时';
    row.item.classList.toggle('fold-discarded', dropped);
    row.item.title = dropped ? '回合结束时最终回答没有提到这个文件，临时沙箱已把它丢弃；在回答里写出路径或文件名即可保留' : '';
    text(row.tag, dropped ? '已丢弃 · 回答未引用' : ''); row.tag.hidden = !dropped;
  });
  while (dom.pathRows.length > paths.length) dom.pathRows.pop().item.remove();
  text(dom.note, discarded.size ? `本轮丢弃 ${discarded.size} 个未在回答中引用的临时文件；internal/ 与 uploads/ 下的文件总是保留。` : '');
  dom.note.hidden = !discarded.size;
  node.classList.toggle('has-discarded', discarded.size > 0);

  const previewPaths = [...new Set(paths)];
  if (preview?.path && !previewPaths.includes(preview.path)) previewPaths.push(preview.path);
  const wanted = new Set(previewPaths);
  for (const [path, card] of dom.previewCards) {
    if (wanted.has(path)) continue;
    card.window.remove(); dom.previewCards.delete(path);
  }
  previewPaths.forEach((path, index) => {
    let card = dom.previewCards.get(path);
    if (!card) {
      card = createPreviewCard(path); dom.previewCards.set(path, card);
    }
    const at = dom.previews.children[index] || null;
    if (at !== card.window) dom.previews.insertBefore(card.window, at);
    paintPreviewCard(card, fileByPath.get(path) || (preview?.path === path ? preview : null), live);
  });
  dom.previews.hidden = previewPaths.length === 0;
}

import { presentationCallSettled } from './toolpresentation.js?v=2026.10.11.1';
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
