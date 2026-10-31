// 文件查看器的小部件（V1.8.1，自 ui-files-panel.js 拆出，纯 DOM / 纯函数，不依赖 mountUI 闭包）：
//   · 提示插画：二进制 / 超过预览上限 / PDF 无法预览——取代原来的 📦 ⚠️ 📄 emoji（线稿，currentColor 随主题）；
//   · CSV / TSV 表格预览；
//   · 「代码 / 预览」分段切换（滑块 + 两层交叉淡入，不再 display 硬切；并排模式已移除）；
//   · 点文件名弹出的沙箱文件目录，快速切换预览的文件。
import { ICON } from './icons.js';
import { parseCsv } from './utiltools.js';
import { uiText as localeText } from './locale.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHADOW = '<ellipse cx="60" cy="88" rx="40" ry="5" fill="currentColor" opacity=".07"/>';
const PAGE = '<path d="M36 14h30l14 14v52a4 4 0 0 1-4 4H36a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z" fill="var(--bg)"/><path d="M66 14v14h14" opacity=".7"/>';
const art = (inner) => `<svg class="fv-art" viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${SHADOW}`
  + `<g stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;

export const FV_ART = Object.freeze({
  // 二进制：纸页上的 0 / 1 位元 + 右下角「下载」徽标
  binary: art(`${PAGE}<g opacity=".5"><path d="M41 36v8M55 36v8M60 36v8M50 50v8M71 50v8M41 64v8M46 64v8M60 64v8"/>`
    + `<ellipse cx="48" cy="40" rx="2.3" ry="4"/><ellipse cx="67" cy="40" rx="2.3" ry="4"/><ellipse cx="43" cy="54" rx="2.3" ry="4"/>`
    + `<ellipse cx="57" cy="54" rx="2.3" ry="4"/><ellipse cx="64" cy="54" rx="2.3" ry="4"/><ellipse cx="53" cy="68" rx="2.3" ry="4"/></g>`
    + `<g class="fv-art-badge"><circle cx="84" cy="74" r="11" fill="var(--bg)"/><path d="M84 68v10M80 74.5l4 4 4-4"/></g>`),
  // 超过预览上限：后面还压着一页、行数溢出纸页 + 右下角提示三角
  tooBig: art(`<path d="M44 8h24l12 12v6" opacity=".4"/><path d="M40 11v-1a3 3 0 0 1 3-3" opacity=".4"/>${PAGE}`
    + `<path d="M40 38h28M40 46h34M40 54h22M40 62h30M40 70h16" opacity=".45"/>`
    + `<g class="fv-art-badge"><path d="M85 60.5 97 81H73Z" fill="var(--bg)"/><path d="M85 67.5v6.5"/><circle cx="85" cy="77.3" r=".8" fill="currentColor"/></g>`),
  // PDF 无法预览：带 PDF 标签的纸页 + 右下角 ×
  pdf: art(`${PAGE}<rect x="38" y="38" width="26" height="12" rx="3" opacity=".75"/>`
    + `<path d="M42.5 47v-6h2.2a1.6 1.6 0 0 1 0 3.2h-2.2M49.5 47v-6h1.6a3 3 0 0 1 0 6Zm8.5 0v-6h3.5M58 44h2.6" stroke-width="1.1"/>`
    + `<path d="M40 58h32M40 66h24" opacity=".45"/>`
    + `<g class="fv-art-badge"><circle cx="84" cy="74" r="11" fill="var(--bg)"/><path d="m80.2 70.2 7.6 7.6m0-7.6-7.6 7.6"/></g>`),
});

/** 查看器里的提示块：插画 + 标题 + 说明（title / sub 由调用方负责转义，可含 <strong>） */
export function fvNoticeHtml(kind, titleHtml, subHtml) {
  return `<div class="fv-too-big" data-notice="${esc(kind)}"><div class="fv-too-big-ico">${FV_ART[kind] || FV_ART.binary}</div>`
    + `<div class="fv-too-big-text"><div>${titleHtml}</div><div class="fv-too-big-sub">${subHtml}</div></div></div>`;
}

const NUMERIC = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?%?$/;
/** CSV / TSV → 只读表格（首行作表头；行列数封顶，超出给提示） */
export function csvTableHtml(text, { delimiter = ',', maxRows = 1000, maxCols = 50 } = {}) {
  const { columns, rows } = parseCsv(text, { delimiter, header: true });
  if (!columns.length) return `<div class="fv-table-meta">${localeText('空表格', 'Empty table')}</div>`;
  const cols = columns.slice(0, maxCols), body = rows.slice(0, maxRows);
  const cell = (v) => { const s = String(v ?? ''); return `<td${NUMERIC.test(s.trim()) ? ' class="num"' : ''}>${esc(s)}</td>`; };
  const notes = [];
  if (rows.length > maxRows) notes.push(localeText(`仅预览前 ${maxRows} 行`, `first ${maxRows} rows shown`));
  if (columns.length > maxCols) notes.push(localeText(`仅预览前 ${maxCols} 列`, `first ${maxCols} columns shown`));
  return `<div class="fv-table-meta mono">${localeText(`${rows.length} 行 × ${columns.length} 列`, `${rows.length} rows × ${columns.length} columns`)}${notes.length ? ' · ' + notes.join(localeText('，', ', ')) : ''}</div>`
    + `<table><thead><tr><th class="fv-rn">#</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`
    + `<tbody>${body.map((r, i) => `<tr><td class="fv-rn">${i + 1}</td>${cols.map((_, j) => cell(r[j])).join('')}</tr>`).join('')}</tbody></table>`;
}

/** 哪些文件有「代码 / 预览」双视图：HTML / SVG（静态 iframe）、Markdown（渲染）、CSV / TSV（表格） */
export function dualViewKind(path) {
  const p = String(path || '').toLowerCase();
  if (/\.(?:html?|svg)$/.test(p)) return 'web';
  if (/\.(?:md|markdown)$/.test(p)) return 'md';
  if (/\.(?:csv|tsv)$/.test(p)) return 'table';
  return '';
}
export const DUAL_VIEW_MAX = Object.freeze({ web: 1024 * 1024, md: 512 * 1024, table: 512 * 1024 });
export const VIEW_MODES = Object.freeze(['code', 'preview']);

/** 分段切换：图标按钮 + 一块滑动的底色（data-mode 驱动，CSS 负责滑动与淡入） */
export function viewModesHtml(mode) {
  const labels = { code: localeText('代码', 'Code'), preview: localeText('预览', 'Preview') };
  const icons = {
    code: '<svg class="fv-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
    preview: '<svg class="fv-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  };
  return `<span class="fv-modes" role="group" aria-label="${localeText('显示模式', 'View mode')}" data-mode="${mode}"><span class="fv-modes-thumb" aria-hidden="true"></span>`
    + VIEW_MODES.map((m) => `<button type="button" data-view-mode="${m}" aria-pressed="${m === mode}" aria-label="${labels[m]}" title="${labels[m]}">${icons[m]}</button>`).join('') + '</span>';
}
export function applyViewMode(viewer, mode) {
  const next = VIEW_MODES.includes(mode) ? mode : 'preview';
  const dual = viewer.querySelector('.fv-dual');
  if (dual) dual.dataset.mode = next;
  const modes = viewer.querySelector('.fv-modes');
  if (modes) modes.dataset.mode = next;
  viewer.querySelectorAll('[data-view-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viewMode === next)));
  viewer.querySelectorAll('.fv-dual > [data-pane]').forEach((pane) => {
    const hidden = pane.dataset.pane !== next;
    pane.setAttribute('aria-hidden', String(hidden));
    if ('inert' in pane) pane.inert = hidden;
  });
  return next;
}

const fileIcon = (p) => (/\.(?:mp4|webm|mov|m4v)$/i.test(p) ? ICON.video : /\.(?:png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i.test(p) ? ICON.image : ICON.file);
/** 沙箱文件按目录分组：根目录文件在前，其余按目录名、文件名排序 */
export function groupFilesByDir(files) {
  const split = (p) => { const i = p.lastIndexOf('/'); return i > 0 ? [p.slice(0, i), p.slice(i + 1)] : ['', p]; };
  return [...files].map((f) => ({ ...f, dir: split(f.path)[0], name: split(f.path)[1] }))
    .sort((a, b) => (a.dir === '' ? 0 : 1) - (b.dir === '' ? 0 : 1) || a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name));
}

/**
 * 点文件名弹出的沙箱文件目录：筛选框 + 分组列表；↑↓ 移动、Enter 打开、Esc 关闭、点外面关闭。
 * @returns {() => void} close
 */
export function openFileSwitcher({ viewer, anchor, current, files, fmtSize, onPick, onClose }) {
  const pop = document.createElement('div');
  pop.className = 'fv-switcher';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', localeText('切换沙箱文件', 'Switch sandbox file'));
  pop.innerHTML = `<input class="fv-sw-q" type="search" autocomplete="off" spellcheck="false" placeholder="${localeText('筛选文件…', 'Filter files…')}" aria-label="${localeText('筛选沙箱文件', 'Filter sandbox files')}">`
    + `<div class="fv-sw-list" role="listbox" aria-label="${localeText('沙箱文件', 'Sandbox files')}"></div>`;
  const q = pop.querySelector('.fv-sw-q'), list = pop.querySelector('.fv-sw-list');
  const grouped = groupFilesByDir(files);
  const paint = () => {
    const needle = q.value.trim().toLowerCase();
    let lastDir = null, html = '';
    for (const f of grouped) {
      if (needle && !f.path.toLowerCase().includes(needle)) continue;
      if (f.dir !== lastDir) {
        if (f.dir) html += `<div class="fv-sw-dir" role="presentation">${ICON.folderOpen}<span>${esc(f.dir)}/</span></div>`;
        lastDir = f.dir;
      }
      const on = f.path === current;
      html += `<button type="button" class="fv-sw-item${on ? ' current' : ''}${f.dir ? ' nested' : ''}" role="option" aria-selected="${on}" data-path="${esc(f.path)}" title="${esc(f.path)}">`
        + `${fileIcon(f.path)}<span class="fv-sw-name">${esc(f.name)}</span><span class="fv-sw-size">${esc(fmtSize(Number(f.size) || 0))}</span></button>`;
    }
    list.innerHTML = html || `<div class="fv-sw-empty">${localeText('没有匹配的文件', 'No matching files')}</div>`;
  };
  const items = () => [...list.querySelectorAll('.fv-sw-item')];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onOutside, true);
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    if (typeof onClose === 'function') onClose();
    pop.setAttribute('aria-hidden', 'true');
    pop.inert = true;
    pop.classList.add('is-closing');
    const motionSetting = document.documentElement?.dataset.motion;
    const reducedMotion = motionSetting === 'off'
      || (motionSetting !== 'on' && !!document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (reducedMotion) { pop.remove(); return; }
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      pop.removeEventListener('animationend', onAnimationEnd);
      clearTimeout(closeTimer);
      pop.remove();
    };
    const onAnimationEnd = (event) => { if (event.target === pop && event.animationName === 'fvSwitcherOut') remove(); };
    const closeTimer = setTimeout(remove, 190);
    pop.addEventListener('animationend', onAnimationEnd);
  };
  const onOutside = (e) => { if (!pop.contains(e.target) && !(anchor && anchor.contains(e.target))) close(); };
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.fv-sw-item');
    if (!item) return;
    close();
    if (item.dataset.path !== current) onPick(item.dataset.path);
  });
  q.addEventListener('input', paint);
  pop.addEventListener('keydown', (e) => {
    const all = items(), at = all.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor?.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!all.length) return;
      const next = e.key === 'ArrowDown' ? (at < 0 ? 0 : Math.min(all.length - 1, at + 1)) : (at <= 0 ? -1 : at - 1);
      if (next < 0) q.focus(); else { all[next].focus(); all[next].scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Enter' && document.activeElement === q) {
      e.preventDefault();
      const first = all.find((b) => !b.classList.contains('current')) || all[0];
      first?.click();
    }
  });
  paint();
  const head = viewer.querySelector('.file-viewer-head');
  pop.style.top = `${(head ? head.offsetTop + head.offsetHeight : 40) + 4}px`;
  viewer.appendChild(pop);
  anchor?.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onOutside, true);
  (list.querySelector('.fv-sw-item.current') || null)?.scrollIntoView({ block: 'nearest' });
  q.focus({ preventScroll: true });
  return close;
}
