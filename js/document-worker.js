/* Trusted local document operations, isolated from the UI. No arbitrary code,
 * network document fetches, macros, scripts or external relationships are run.
 * Libraries are fixed, self-hosted, and loaded only for the operation requested.
 */
const ROOT = new URL('../', self.location.href);
const LIMIT = 32 * 1024 * 1024;
const MIME = { docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf:'application/pdf' };
function bytes(value) {
  const m = /^data:[^;,]*;base64,([a-zA-Z0-9+/\r\n]*={0,2})$/.exec(String(value || ''));
  if (!m || m[1].length > Math.ceil(LIMIT / 3) * 4) throw Error('Invalid or oversized binary document');
  const s = atob(m[1]), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function dataURL(value, format) {
  const arr = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (arr.length > LIMIT) throw Error('Output exceeds 32MB');
  let s = ''; for (let i = 0; i < arr.length; i += 32768) s += String.fromCharCode(...arr.subarray(i, i + 32768));
  return `data:${MIME[format]};base64,${btoa(s)}`;
}
function load(name) { importScripts(new URL('assets/vendor/office/' + name, ROOT).href); }
function safeText(value, max = 50000) { const s = String(value ?? ''); if (s.length > max) throw Error('Text block too long'); return s; }
function array(value, max) { if (!Array.isArray(value) || value.length > max) throw Error(`Expected an array of at most ${max} items`); return value; }
function sliceText(text, offset = 0) { const start = Math.max(0, Math.floor(Number(offset) || 0)), end = start + 12000; return { text: text.slice(start, end), totalChars: text.length, nextOffset: end < text.length ? end : null }; }
function image(files, spec) {
  const raw = files[spec.path]; if (!raw) throw Error('Missing image: ' + spec.path);
  const arr = bytes(raw);
  const png = arr[0] === 137 && arr[1] === 80 && arr[2] === 78 && arr[3] === 71;
  const jpeg = arr[0] === 255 && arr[1] === 216 && arr[2] === 255;
  if ((!png && !jpeg) || arr.length > 5 * 1024 * 1024) throw Error('Images must be PNG/JPEG, at most 5MB');
  return { bytes: arr, type: png ? 'png' : 'jpg', data: `data:image/${png ? 'png' : 'jpeg'};base64,` + raw.split(',')[1] };
}
function entity(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v) => {
    if (v[0] === '#') { const n = v[1]?.toLowerCase() === 'x' ? parseInt(v.slice(2), 16) : Number(v.slice(1)); return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\uFFFD'; }
    return ({ amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" })[v.toLowerCase()] || '';
  });
}
function xmlParagraphs(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('DTD/entity declarations are not allowed');
  return [...xml.matchAll(/<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/g)].map(m => {
    const runs = [...m[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?(?:tab|br)\b[^>]*\/?\s*>/g)];
    return runs.map(r => r[1] === undefined ? (/\btab/.test(r[0]) ? '\t' : '\n') : entity(r[1].replace(/<[^>]*>/g, ''))).join('');
  }).filter(Boolean).join('\n');
}
async function inspectOffice(raw, format, offset) {
  const { unpackZip } = await import('./unzip.js');
  const zip = await unpackZip(bytes(raw), { maxUncompressed: 24 * 1024 * 1024 });
  if (!zip.ok) throw Error(zip.error);
  const entries = new Map(zip.files.map(f => [f.path, f.content]));
  if (!entries.has('[Content_Types].xml') || !entries.has(format === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml')) throw Error('Not a valid ' + format.toUpperCase() + ' package');
  const externalRelationships = zip.files.filter(f => f.path.endsWith('.rels')).reduce((n, f) => n + (f.content.match(/TargetMode\s*=\s*["']External["']/g) || []).length, 0);
  let parts = [], count;
  if (format === 'docx') {
    const body = entries.get('word/document.xml');
    count = (body.match(/<w:tbl\b/g) || []).length;
    parts = [['Document', body], ...[...entries].filter(([p]) => /^word\/(?:header|footer)\d+\.xml$/.test(p))];
  } else {
    const presentation = entries.get('ppt/presentation.xml'), rels = entries.get('ppt/_rels/presentation.xml.rels') || '';
    const targets = new Map();
    for (const m of rels.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)) {
      const id = /\bId=["']([^"']+)["']/.exec(m[1])?.[1], target = /\bTarget=["']([^"']+)["']/.exec(m[1])?.[1];
      if (id && target && !/TargetMode=["']External/.test(m[1])) targets.set(id, target.startsWith('/') ? target.slice(1) : 'ppt/' + target.replace(/^\.\//, ''));
    }
    for (const m of presentation.matchAll(/<p:sldId\b[^>]*\br:id=["']([^"']+)["'][^>]*\/?\s*>/g)) {
      const target = targets.get(m[1]); if (target && entries.has(target)) parts.push([`Slide ${parts.length + 1}`, entries.get(target)]);
    }
    if (!parts.length) throw Error('Slide relationships missing or unsupported');
    count = parts.length;
    parts.push(...[...entries].filter(([p]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p)));
  }
  const text = parts.map(([name, xml]) => `## ${name}\n${xmlParagraphs(xml)}`).join('\n\n');
  return { format, ...(format === 'pptx' ? { slides: count } : { tables: count }), ...sliceText(text, offset), externalRelationships,
    warnings: ['Text extraction only, not a layout renderer. Tables follow XML paragraph order. Equations, images, embedded objects and tracked changes need separate review.', 'External relationships, macros and document scripts were not executed.'] };
}
async function createDocx(data, files) {
  load('docx-9.5.1.js'); const d = self.docx;
  const children = [];
  if (data.title) children.push(new d.Paragraph({ text: safeText(data.title), heading: d.HeadingLevel.TITLE }));
  const table = (t) => new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: array(t.rows, 200).map((row, i) => new d.TableRow({ tableHeader: i === 0, children: array(row, 20).map(cell => new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text: safeText(cell, 5000), bold: i === 0 })] })] })) })) });
  let inlineTables = 0;
  for (const p of array(data.paragraphs || [], 1000)) {
    const v = typeof p === 'string' ? { text: p } : p;
    // 段落里内联的表格：落在所在小节下面，而不是统一堆到文末
    if (v && v.table && typeof v.table === 'object') { if (++inlineTables > 30) throw Error('At most 30 inline tables'); children.push(table(v.table), new d.Paragraph({ text: '' })); continue; }
    children.push(new d.Paragraph({ children: [new d.TextRun({ text: safeText(v.text), bold: !!v.bold })], ...(v.heading ? { heading: d.HeadingLevel['HEADING_' + Math.max(1, Math.min(3, Number(v.heading) || 1))] } : {}), ...(v.bullet ? { bullet: { level: 0 } } : {}), spacing: { after: 140 } }));
  }
  for (const t of array(data.tables || [], 30)) children.push(table(t));
  for (const spec of array(data.images || [], 20)) {
    const img = image(files, spec);
    children.push(new d.Paragraph({ children: [new d.ImageRun({ type: img.type, data: img.bytes, transformation: { width: Math.max(1, Math.min(600, Number(spec.width) || 450)), height: Math.max(1, Math.min(700, Number(spec.height) || 300)) }, altText: { title: safeText(spec.alt || 'Image'), description: safeText(spec.alt || 'Image'), name: spec.path } })] }));
  }
  const section = { children };
  if (data.header) section.headers = { default: new d.Header({ children: [new d.Paragraph(safeText(data.header))] }) };
  if (data.footer) section.footers = { default: new d.Footer({ children: [new d.Paragraph(safeText(data.footer))] }) };
  const doc = new d.Document({ creator: safeText(data.author || 'Dubhe Agent'), title: safeText(data.title || ''), sections: [section] });
  return dataURL(await d.Packer.toArrayBuffer(doc), 'docx');
}
async function createPptx(data, files) {
  load('pptxgenjs-3.12.0.js'); const pptx = new self.PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  pptx.author = safeText(data.author || 'Dubhe Agent'); pptx.title = safeText(data.title || 'Presentation');
  pptx.subject = 'Editable local presentation'; pptx.lang = 'zh-CN';
  for (const [i, spec] of array(data.slides, 60).entries()) {
    const slide = pptx.addSlide(); slide.background = { color: 'FAFAF8' };
    slide.addText(String(i + 1).padStart(2, '0'), { x: 0.65, y: 0.28, w: 1, h: 0.2, fontSize: 10, color: '777777' });
    slide.addText(safeText(spec.title, 300), { x: 0.65, y: 0.72, w: 12, h: 0.9, fontSize: 28, bold: true, color: '202322', margin: 0, fit: 'shrink', breakLine: false });
    const body = Array.isArray(spec.body) ? spec.body.map(v => '• ' + safeText(v, 3000)).join('\n') : safeText(spec.body || '', 12000);
    if (body) slide.addText(body, { x: 0.72, y: 1.9, w: spec.images?.length ? 5.8 : 11.8, h: spec.table ? 1.5 : 4.5, fontSize: 20, color: '343C39', margin: 0, breakLine: false, fit: 'shrink', valign: 'top', paraSpaceAfterPt: 12 });
    if (spec.table) slide.addTable(array(spec.table.rows, 16).map(row => array(row, 8).map(v => safeText(v, 500))), { x: 0.72, y: body ? 3.7 : 1.9, w: 11.8, h: body ? 2.4 : 4.2, border: { pt: 0.5, color: 'D6DAD7' }, fontSize: 14, color: '26332C', fill: 'FFFFFF', autoPage: false });
    for (const img of array(spec.images || [], 6)) {
      const value = image(files, img), x = Number(img.x ?? 7), y = Number(img.y ?? 1.9), w = Number(img.w ?? 5.5), h = Number(img.h ?? 3.5);
      if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 13.3334 || y + h > 7.5) throw Error('Image falls outside the slide');
      slide.addImage({ data: value.data, x, y, w, h, altText: safeText(img.alt || 'Image') });
    }
    if (spec.notes) slide.addNotes(safeText(spec.notes, 12000));
  }
  return dataURL(await pptx.write({ outputType: 'arraybuffer' }), 'pptx');
}
function selectedPages(spec, count) {
  const list = spec == null ? Array.from({ length: count }, (_, i) => i + 1) : array(spec, 200);
  if (!list.length || list.some(n => !Number.isInteger(n) || n < 1 || n > count)) throw Error('pages must contain valid 1-based page numbers');
  return list.map(n => n - 1);
}
async function pdfOperation(args, files) {
  load('pdf-lib-1.17.1.js'); const { PDFDocument, StandardFonts, degrees, rgb } = self.PDFLib;
  const loadPdf = async path => { if (!files[path]) throw Error('Missing PDF: ' + path); const doc = await PDFDocument.load(bytes(files[path]), { updateMetadata: false }); if (doc.getPageCount() > 200) throw Error('At most 200 pages per operation'); return doc; };
  const data = args.data || {};
  let doc;
  if (args.action === 'merge') {
    doc = await PDFDocument.create();
    for (const path of array(args.paths, 8)) { const src = await loadPdf(path); for (const page of await doc.copyPages(src, selectedPages(null, src.getPageCount()))) doc.addPage(page); if (doc.getPageCount() > 200) throw Error('Merged PDF exceeds 200 pages'); }
  } else if (args.action === 'create') {
    doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const text of array(data.pages || [], 100)) { const page = doc.addPage([595.28, 841.89]); page.drawText(safeText(text, 10000), { x: 45, y: 790, size: 12, font, maxWidth: 505, lineHeight: 18 }); }
    if (!doc.getPageCount()) throw Error('Provide data.pages');
  } else doc = await loadPdf(args.path);
  if (args.action === 'inspect' || args.action === 'form_fields') {
    const fields = doc.getForm().getFields().map(f => ({ name: f.getName(), type: f.constructor.name, ...(typeof f.getOptions === 'function' ? { options: f.getOptions() } : {}) }));
    return { pageCount: doc.getPageCount(), title: doc.getTitle() || '', author: doc.getAuthor() || '', ...sliceText(JSON.stringify({ pages: doc.getPages().map((p, i) => ({ page: i + 1, ...p.getSize(), rotation: p.getRotation().angle })), fields }, null, 2), args.offset), warnings: ['Local structural inspection only. Use analyze_pdf with pages=0 for text, or explicit visual analysis for scans.', 'Encrypted PDFs, dynamic XFA, digital signing and high-fidelity Office-to-PDF conversion are not supported.'] };
  }
  if (args.action === 'extract') { const out = await PDFDocument.create(); for (const page of await out.copyPages(doc, selectedPages(args.pages, doc.getPageCount()))) out.addPage(page); doc = out; }
  if (args.action === 'rotate') { if (![90, 180, 270].includes(args.angle)) throw Error('angle must be 90, 180 or 270'); for (const n of selectedPages(args.pages, doc.getPageCount())) { const p = doc.getPage(n); p.setRotation(degrees((p.getRotation().angle + args.angle) % 360)); } }
  if (args.action === 'watermark') {
    const text = safeText(data.text || '', 200); if (!text) throw Error('Provide watermark data.text');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const n of selectedPages(args.pages, doc.getPageCount())) { const p = doc.getPage(n); p.drawText(text, { x: 30, y: Math.max(20, p.getHeight() / 2), font, size: Math.max(8, Math.min(72, Number(data.size) || 28)), color: rgb(0.45, 0.45, 0.45), opacity: Math.max(0.05, Math.min(1, Number(data.opacity) || 0.22)), rotate: degrees(25) }); }
  }
  if (args.action === 'fill_form') {
    const form = doc.getForm(); if (!data.fields || typeof data.fields !== 'object') throw Error('Provide data.fields');
    for (const [name, value] of Object.entries(data.fields)) {
      const f = form.getField(name);
      if (typeof f.setText === 'function') f.setText(safeText(value, 10000));
      else if (typeof f.check === 'function' && typeof value === 'boolean') value ? f.check() : f.uncheck();
      else if (typeof f.select === 'function') f.select(Array.isArray(value) ? value.map(String) : String(value));
      else throw Error('Unsupported form field: ' + name);
    }
    if (data.flatten === true) form.flatten();
  }
  if (args.action === 'metadata') {
    if (data.title != null) doc.setTitle(safeText(data.title, 1000));
    if (data.author != null) doc.setAuthor(safeText(data.author, 1000));
    if (data.subject != null) doc.setSubject(safeText(data.subject, 1000));
    if (data.keywords != null) doc.setKeywords(array(data.keywords, 50).map(String));
  }
  return { output: dataURL(await doc.save(), 'pdf'), pageCount: doc.getPageCount(), warnings: ['Original file preserved. Saving may invalidate digital signatures; metadata edits are not anonymization, and watermarking is not redaction.', 'Built-in PDF fonts cover Latin text only; non-Latin watermark/form/create text may fail rather than silently substitute.'] };
}
self.onmessage = async event => {
  try {
    const { args, files } = event.data;
    let result;
    if (args.format === 'pdf') result = await pdfOperation(args, files);
    else if (args.action === 'inspect') result = await inspectOffice(files[args.path], args.format, args.offset);
    else if (args.action === 'create') result = { output: await (args.format === 'docx' ? createDocx(args.data || {}, files) : createPptx(args.data || {}, files)), warnings: ['Editable OOXML generated locally. No Office rendering engine: inspect content and review layout in a viewer before publishing.'] };
    else throw Error('This format supports inspect/create only; use skill_library for workflows');
    self.postMessage({ ok: true, result });
  } catch (error) { self.postMessage({ ok: false, error: String(error?.message || error) }); }
};
