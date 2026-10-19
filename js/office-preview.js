// Dubhe Agent · 沙箱内 Office / 压缩包预览（文件查看器用，浏览器本地解析，不联网、不引外部渲染引擎）
//   · xlsx  → 逐工作表只读表格（复用 xlsx.js 的结构化解析 readXlsxWorkbook）
//   · docx  → 标题 / 段落 / 列表 / 表格的结构化文本视图（不承诺排版保真，只做内容预览）
//   · pptx  → 按幻灯片分卡展示文本框文字
//   · zip   → 条目清单（路径 + 体积），加密/不支持压缩的条目如实标注
// 统一契约：每个导出函数返回 HTML 字符串；解析失败返回错误说明而不是抛出，便于查看器直接内嵌。
// 体积/数量封顶，超出给提示并引导下载后用本地程序打开。
import { unpackZip } from './unzip.js';
import { readXlsxWorkbook } from './xlsx.js';
import { text as localeText } from './locale.js';

const esc = (s) => String(s).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// data: URL / base64 → Uint8Array（与 ui-files-panel 的解码逻辑一致，独立实现避免反向依赖 UI）
export function bytesFromDataUrl(rawStr) {
  const s = String(rawStr || '');
  const comma = s.indexOf(',');
  const b64 = /^data:/i.test(s) && comma > 0 ? s.slice(comma + 1) : (/^[A-Za-z0-9+/=\s]+$/.test(s) ? s : '');
  if (!b64) return null;
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  } catch { return null; }
}

function notice(titleHtml, subHtml) {
  return `<div class="fv-office-note"><div class="fv-office-note-title">${titleHtml}</div><div class="fv-too-big-sub">${subHtml}</div></div>`;
}

function metaLine(text) {
  return `<div class="fv-office-meta mono">${esc(text)}</div>`;
}

// ── XLSX：sheet 选项卡 + 只读表格 ─────────────────────────────────────
const XLSX_MAX_SHEETS = 8;
const XLSX_MAX_ROWS = 200;
const XLSX_MAX_COLS = 30;

export async function xlsxPreviewHtml(raw) {
  const bytes = raw instanceof Uint8Array ? raw : bytesFromDataUrl(raw);
  if (!bytes || !bytes.length) return notice(localeText('无法预览此 XLSX', 'Cannot preview this XLSX'), localeText('内容不是可解码的二进制表格文件，请下载后查看。', 'The content is not a decodable binary workbook. Download it to view.'));
  let book;
  try {
    book = await readXlsxWorkbook(bytes, { maxUncompressed: 24 * 1024 * 1024 });
  } catch (err) {
    return notice(localeText('无法预览此 XLSX', 'Cannot preview this XLSX'), `${esc(err.message || String(err))} · ${localeText('请下载后用本地程序打开', 'download and open it locally')}`);
  }
  const sheets = (book.sheets || []).slice(0, XLSX_MAX_SHEETS);
  const tabs = sheets.map((s, i) => `<button type="button" class="fv-sheet-tab${i === 0 ? ' active' : ''}" data-sheet="${i}">${esc(s.name)}</button>`).join('');
  const panes = sheets.map((sheet, i) => {
    const grid = new Map(); // row -> Map(col -> cell)
    let maxCol = 0;
    for (const c of sheet.cells || []) {
      if (!grid.has(c.row)) grid.set(c.row, new Map());
      grid.get(c.row).set(c.column, c);
      if (c.column > maxCol) maxCol = c.column;
    }
    const rows = [...grid.keys()].sort((a, b) => a - b);
    const colsShown = Math.min(maxCol, XLSX_MAX_COLS);
    const rowsShown = rows.slice(0, XLSX_MAX_ROWS);
    const colLabel = (n) => { let out = ''; let x = n; while (x > 0) { x -= 1; out = String.fromCharCode(65 + (x % 26)) + out; x = Math.floor(x / 26); } return out; };
    const head = `<tr><th class="fv-rn">#</th>${Array.from({ length: colsShown }, (_, j) => `<th>${colLabel(j + 1)}</th>`).join('')}</tr>`;
    const body = rowsShown.map((r) => {
      const cells = Array.from({ length: colsShown }, (_, j) => {
        const cell = grid.get(r).get(j + 1);
        if (!cell) return '<td></td>';
        const rawVal = cell.value;
        const text = rawVal == null ? '' : (typeof rawVal === 'boolean' ? (rawVal ? 'TRUE' : 'FALSE') : String(rawVal));
        const num = typeof rawVal === 'number';
        const title = cell.formula ? ` title="=${esc(cell.formula)}"` : '';
        return `<td${num ? ' class="num"' : ''}${title}>${esc(text)}</td>`;
      }).join('');
      return `<tr><td class="fv-rn">${r}</td>${cells}</tr>`;
    }).join('');
    const notes = [];
    if ((sheet.cells || []).length && rows.length > XLSX_MAX_ROWS) notes.push(localeText(`仅预览前 ${XLSX_MAX_ROWS} 行`, `first ${XLSX_MAX_ROWS} rows shown`));
    if (maxCol > XLSX_MAX_COLS) notes.push(localeText(`仅预览前 ${XLSX_MAX_COLS} 列`, `first ${XLSX_MAX_COLS} columns shown`));
    const summary = localeText(`${rows.length || sheet.rowCount || 0} 行 × ${maxCol} 列 · ${sheet.cellCount || 0} 个非空单元格`, `${rows.length || sheet.rowCount || 0} rows × ${maxCol} cols · ${sheet.cellCount || 0} non-empty cells`);
    return `<div class="fv-sheet-pane" data-sheet-pane="${i}"${i === 0 ? '' : ' hidden'}>`
      + metaLine(`${summary}${notes.length ? ' · ' + notes.join(localeText('，', ', ')) : ''}`)
      + `<div class="fv-rendered fv-table"><table><thead>${head}</thead><tbody>${body || '<tr><td>—</td></tr>'}</tbody></table></div></div>`;
  }).join('');
  const moreSheets = (book.sheetCount || 0) > XLSX_MAX_SHEETS
    ? `<div class="fv-too-big-sub">${localeText(`共 ${book.sheetCount} 个工作表，仅预览前 ${XLSX_MAX_SHEETS} 个`, `${book.sheetCount} sheets total; first ${XLSX_MAX_SHEETS} shown`)}</div>` : '';
  return `<div class="fv-office fv-xlsx" data-sheets="${sheets.length}">`
    + metaLine(localeText(`XLSX 工作簿 · ${book.sheetCount} 个工作表`, `XLSX workbook · ${book.sheetCount} sheet(s)`))
    + (sheets.length > 1 ? `<div class="fv-sheet-tabs" role="tablist">${tabs}</div>` : '')
    + panes + moreSheets + '</div>';
}

// ── DOCX：段落 / 标题 / 列表 / 表格（结构化文本，不承诺版式保真）────────
const DOCX_MAX_BLOCKS = 800;
const DOCX_MAX_TEXT = 200000;

function unescapeXml(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, ref) => {
    if (ref[0] === '#') {
      const n = ref[1]?.toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\uFFFD';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[ref.toLowerCase()] || '';
  });
}

function docxParagraphText(pXml) {
  const runs = [...String(pXml).matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?(?:tab|br)\b[^>]*\/?\s*>/g)];
  return runs.map((r) => (r[1] === undefined ? (/\btab/.test(r[0]) ? '\t' : ' ') : unescapeXml(r[1].replace(/<[^>]*>/g, ''))))
    .join('').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function docxParagraphStyle(pXml) {
  const style = /<(?:\w+:)?pStyle\b[^>]*\bw:val=["']([^"']+)["']/.exec(pXml)?.[1] || '';
  const heading = /^(?:Heading|heading)\s?(\d)$/.exec(style)?.[1] || (/^标题\s?(\d)$/.exec(style)?.[1] || '');
  const numbered = /<(?:\w+:)?numPr\b/.test(pXml);
  return { style, heading: heading ? Math.min(6, Math.max(1, Number(heading))) : 0, numbered };
}

function splitTopLevel(xml, tag) {
  // 把 xml 里最外层的 <tag ...>...</tag> 切出来（深度计数，允许嵌套同名标签），返回 [{block, start, end}]
  const out = [];
  const openRe = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>`, 'g');
  let m;
  while ((m = openRe.exec(xml))) {
    if (m[0].endsWith('/>')) { // 自闭合空节点（如 <w:p/>）：按空块处理，不参与深度计数
      out.push({ block: '', start: m.index, end: openRe.lastIndex });
      continue;
    }
    const depthRe = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\/>|</(?:\\w+:)?${tag}>|<(?:\\w+:)?${tag}\\b`, 'g');
    depthRe.lastIndex = m.index;
    let depth = 0;
    let d;
    let end = -1;
    while ((d = depthRe.exec(xml))) {
      if (d[0].startsWith('</')) depth -= 1;
      else if (d[0].endsWith('/>')) { /* 自闭合不计深度 */ }
      else depth += 1;
      if (depth === 0) { end = depthRe.lastIndex; break; }
    }
    if (end < 0) { out.push({ block: xml.slice(m.index), start: m.index, end: xml.length }); break; }
    out.push({ block: xml.slice(m.index, end), start: m.index, end });
    openRe.lastIndex = end;
  }
  return out;
}

export async function docxPreviewHtml(raw) {
  const bytes = raw instanceof Uint8Array ? raw : bytesFromDataUrl(raw);
  if (!bytes || !bytes.length) return notice(localeText('无法预览此 DOCX', 'Cannot preview this DOCX'), localeText('内容不是可解码的二进制文档，请下载后查看。', 'The content is not a decodable document. Download it to view.'));
  let zip;
  try { zip = await unpackZip(bytes, { maxUncompressed: 24 * 1024 * 1024 }); } catch (err) {
    return notice(localeText('无法预览此 DOCX', 'Cannot preview this DOCX'), `${esc(err.message || String(err))} · ${localeText('请下载后用本地程序打开', 'download and open it locally')}`);
  }
  if (!zip.ok) return notice(localeText('无法预览此 DOCX', 'Cannot preview this DOCX'), `${esc(zip.error || '')} · ${localeText('请下载后用本地程序打开', 'download and open it locally')}`);
  const entries = new Map(zip.files.map((f) => [f.path, f.content]));
  const body = entries.get('word/document.xml');
  if (!body || /<!DOCTYPE|<!ENTITY/i.test(body)) {
    return notice(localeText('无法预览此 DOCX', 'Cannot preview this DOCX'), localeText('不是有效的 DOCX 包（缺少 word/document.xml）。', 'Not a valid DOCX package (word/document.xml missing).'));
  }
  const blocks = [];
  // 表格整体切出，避免单元格段落被当独立段落重复渲染
  const tbls = splitTopLevel(body, 'tbl');
  let cursor = 0;
  for (const t of tbls) {
    const seg = body.slice(cursor, t.start);
    for (const p of splitTopLevel(seg, 'p')) blocks.push({ kind: 'p', xml: p.block });
    const rows = splitTopLevel(t.block, 'tr');
    const tableRows = rows.slice(0, 200).map((r) => splitTopLevel(r.block, 'tc')
      .slice(0, 40)
      .map((c) => splitTopLevel(c.block, 'p').map((p) => docxParagraphText(p.block)).join(' ').trim()));
    blocks.push({ kind: 'table', rows: tableRows });
    cursor = t.end;
  }
  for (const p of splitTopLevel(body.slice(cursor), 'p')) blocks.push({ kind: 'p', xml: p.block });

  let chars = 0;
  const html = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { html.push('</ul>'); listOpen = false; } };
  for (const b of blocks.slice(0, DOCX_MAX_BLOCKS)) {
    if (chars > DOCX_MAX_TEXT) break;
    if (b.kind === 'table') {
      closeList();
      const rowsHtml = b.rows.map((cells) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      html.push(`<div class="fv-rendered fv-table"><table><tbody>${rowsHtml || '<tr><td>—</td></tr>'}</tbody></table></div>`);
      continue;
    }
    const text = docxParagraphText(b.xml);
    if (!text.trim()) continue;
    chars += text.length;
    const { heading, numbered } = docxParagraphStyle(b.xml);
    if (heading) {
      closeList();
      html.push(`<h${heading + 1} class="fv-docx-h">${esc(text)}</h${heading + 1}>`);
    } else if (numbered) {
      if (!listOpen) { html.push('<ul class="fv-docx-list">'); listOpen = true; }
      html.push(`<li>${esc(text)}</li>`);
    } else {
      closeList();
      html.push(`<p class="fv-docx-p">${esc(text)}</p>`);
    }
  }
  closeList();
  const tableCount = blocks.filter((b) => b.kind === 'table').length;
  const more = blocks.length > DOCX_MAX_BLOCKS
    ? `<div class="fv-too-big-sub">${localeText(`共 ${blocks.length} 个内容块，仅预览前 ${DOCX_MAX_BLOCKS} 个`, `${blocks.length} blocks total; first ${DOCX_MAX_BLOCKS} shown`)}</div>` : '';
  return `<div class="fv-office fv-docx">`
    + metaLine(localeText(`DOCX 文档 · ${tableCount} 个表格 · 内容预览（不保证版式保真）`, `DOCX document · ${tableCount} table(s) · content preview (not a layout renderer)`))
    + `<div class="fv-docx-body">${html.join('') || '<p class="fv-docx-p">—</p>'}</div>${more}</div>`;
}

// ── PPTX：按幻灯片分卡展示文本 ────────────────────────────────────────
const PPTX_MAX_SLIDES = 40;

export async function pptxPreviewHtml(raw) {
  const bytes = raw instanceof Uint8Array ? raw : bytesFromDataUrl(raw);
  if (!bytes || !bytes.length) return notice(localeText('无法预览此 PPTX', 'Cannot preview this PPTX'), localeText('内容不是可解码的演示文稿，请下载后查看。', 'The content is not a decodable deck. Download it to view.'));
  let zip;
  try { zip = await unpackZip(bytes, { maxUncompressed: 24 * 1024 * 1024 }); } catch (err) {
    return notice(localeText('无法预览此 PPTX', 'Cannot preview this PPTX'), `${esc(err.message || String(err))} · ${localeText('请下载后用本地程序打开', 'download and open it locally')}`);
  }
  if (!zip.ok) return notice(localeText('无法预览此 PPTX', 'Cannot preview this PPTX'), `${esc(zip.error || '')} · ${localeText('请下载后用本地程序打开', 'download and open it locally')}`);
  const entries = new Map(zip.files.map((f) => [f.path, f.content]));
  if (!entries.has('ppt/presentation.xml') || !entries.has('[Content_Types].xml')) {
    return notice(localeText('无法预览此 PPTX', 'Cannot preview this PPTX'), localeText('不是有效的 PPTX 包（缺少 ppt/presentation.xml）。', 'Not a valid PPTX package (ppt/presentation.xml missing).'));
  }
  // 幻灯片顺序跟随 presentation.xml 的 sldIdLst，而不是文件名排序
  const presentation = entries.get('ppt/presentation.xml');
  const rels = entries.get('ppt/_rels/presentation.xml.rels') || '';
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && target && !/TargetMode="External"/.test(m[1])) {
      targets.set(id, target.startsWith('/') ? target.slice(1) : `ppt/${target.replace(/^\.\//, '')}`);
    }
  }
  const order = [];
  for (const m of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/g)) {
    const target = targets.get(m[1]);
    if (target && entries.has(target)) order.push(target);
  }
  if (!order.length) {
    for (const path of [...entries.keys()].filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort()) order.push(path);
  }
  const slides = order.slice(0, PPTX_MAX_SLIDES).map((path, i) => {
    const xml = entries.get(path) || '';
    const paras = splitTopLevel(xml, 'p').map((p) => docxParagraphText(p.block).trim()).filter(Boolean);
    const lines = paras.slice(0, 60).map((t) => `<li>${esc(t)}</li>`).join('');
    return `<figure class="fv-slide"><figcaption class="mono">${localeText(`第 ${i + 1} 页`, `Slide ${i + 1}`)}</figcaption><ul class="fv-slide-text">${lines || '<li>—</li>'}</ul></figure>`;
  }).join('');
  const more = order.length > PPTX_MAX_SLIDES
    ? `<div class="fv-too-big-sub">${localeText(`共 ${order.length} 页，仅预览前 ${PPTX_MAX_SLIDES} 页`, `${order.length} slides total; first ${PPTX_MAX_SLIDES} shown`)}</div>` : '';
  return `<div class="fv-office fv-pptx">`
    + metaLine(localeText(`PPTX 演示文稿 · ${order.length} 页 · 文本内容预览（不含图片与版式）`, `PPTX deck · ${order.length} slide(s) · text preview (images and layout omitted)`))
    + `<div class="fv-slides">${slides || '<p class="fv-docx-p">—</p>'}</div>${more}</div>`;
}

// ── ZIP：条目清单 ─────────────────────────────────────────────────────
const ZIP_MAX_ENTRIES = 300;

export async function zipListHtml(raw) {
  const bytes = raw instanceof Uint8Array ? raw : bytesFromDataUrl(raw);
  if (!bytes || !bytes.length) return notice(localeText('无法读取此压缩包', 'Cannot read this archive'), localeText('内容不是可解码的 ZIP 数据，请下载后查看。', 'The content is not decodable ZIP data. Download it to view.'));
  let zip;
  try { zip = await unpackZip(bytes, { maxUncompressed: 24 * 1024 * 1024 }); } catch (err) {
    return notice(localeText('无法读取此压缩包', 'Cannot read this archive'), `${esc(err.message || String(err))} · ${localeText('请下载后查看', 'download it to view')}`);
  }
  if (!zip.ok) return notice(localeText('无法读取此压缩包', 'Cannot read this archive'), `${esc(zip.error || '')} · ${localeText('请下载后查看', 'download it to view')}`);
  const files = zip.files.slice(0, ZIP_MAX_ENTRIES);
  const rows = files.map((f) => {
    const size = f.kind === 'bin' ? Math.round(String(f.content).length * 0.75) : String(f.content).length;
    return `<tr><td class="mono">${esc(f.path)}</td><td class="num">${size}</td><td>${esc(f.kind)}</td></tr>`;
  }).join('');
  const more = zip.files.length > ZIP_MAX_ENTRIES
    ? `<div class="fv-too-big-sub">${localeText(`共 ${zip.files.length} 个条目，仅列出前 ${ZIP_MAX_ENTRIES} 个`, `${zip.files.length} entries total; first ${ZIP_MAX_ENTRIES} listed`)}</div>` : '';
  return `<div class="fv-office fv-zip">`
    + metaLine(localeText(`ZIP 压缩包 · ${zip.files.length} 个文件`, `ZIP archive · ${zip.files.length} file(s)`))
    + `<div class="fv-rendered fv-table"><table><thead><tr><th>${localeText('路径', 'Path')}</th><th>${localeText('字节', 'Bytes')}</th><th>${localeText('类型', 'Kind')}</th></tr></thead><tbody>${rows}</tbody></table></div>${more}</div>`;
}
