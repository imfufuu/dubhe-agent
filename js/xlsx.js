import { createZip } from './zip.js';
import { unpackZip } from './unzip.js';

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAX_SHEETS = 20;
const MAX_ROWS = 10000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 100000;
const MAX_INSPECT_CELLS = 20000;

const utf8 = new TextEncoder();
const decodeUtf8 = new TextDecoder('utf-8', { fatal: false });
const xmlSafe = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '\uFFFD');
const escapeXml = (value) => xmlSafe(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function unescapeXml(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, ref) => {
    if (ref[0] === '#') {
      const n = ref[1]?.toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\uFFFD';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[ref.toLowerCase()] || '';
  });
}

function attribute(attrs, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(String(attrs || ''));
  return match ? unescapeXml(match[1] ?? match[2] ?? '') : '';
}

function textElements(xml) {
  return [...String(xml || '').matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((match) => unescapeXml(match[1].replace(/<[^>]*>/g, ''))).join('');
}

function columnName(index) {
  let n = index;
  let out = '';
  while (n > 0) { n -= 1; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}

function columnIndex(label) {
  let n = 0;
  for (const c of String(label || '').toUpperCase()) {
    if (c < 'A' || c > 'Z') return 0;
    n = n * 26 + c.charCodeAt(0) - 64;
  }
  return n;
}

function validateSheets(data) {
  const input = Array.isArray(data?.sheets) ? data.sheets : [];
  if (!input.length || input.length > MAX_SHEETS) throw Error(`Provide 1–${MAX_SHEETS} sheets in data.sheets`);
  const seen = new Set();
  let totalCells = 0;
  return input.map((sheet, i) => {
    const name = String(sheet?.name || `Sheet${i + 1}`).trim();
    if (!name || name.length > 31 || /[\\/*?:\[\]]/.test(name) || /^'|'$/.test(name)) throw Error(`Invalid worksheet name: ${name}`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw Error(`Duplicate worksheet name: ${name}`);
    seen.add(key);
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : null;
    if (!rows || rows.length > MAX_ROWS) throw Error(`Sheet ${name} requires up to ${MAX_ROWS} rows`);
    const normalized = rows.map((row, r) => {
      if (!Array.isArray(row) || row.length > MAX_COLUMNS) throw Error(`Row ${r + 1} in ${name} must have at most ${MAX_COLUMNS} cells`);
      totalCells += row.length;
      if (totalCells > MAX_CELLS) throw Error(`Workbook exceeds ${MAX_CELLS} cells`);
      return row.map((value) => {
        if (value == null) return null;
        const text = typeof value === 'string' ? value : (typeof value === 'object' ? JSON.stringify(value) : String(value));
        if (text.length > 32767) throw Error('A cell exceeds Excel’s 32,767-character limit');
        return typeof value === 'number' && Number.isFinite(value) ? value
          : typeof value === 'boolean' ? value : text;
      });
    });
    return { name, rows: normalized };
  });
}

function worksheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      if (value === null || value === '') return '';
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
      if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      const text = escapeXml(value);
      const preserve = /^\s|\s$/.test(String(value));
      return `<c r="${ref}" t="inlineStr"><is><t${preserve ? ' xml:space="preserve"' : ''}>${text}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetData>${rowXml}</sheetData></worksheet>`;
}

export async function createXlsxWorkbook(data = {}) {
  const sheets = validateSheets(data);
  const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  const sheetEntries = sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const entries = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PACKAGE_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheetEntries}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PACKAGE_REL}">${rels}</Relationships>` },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: worksheetXml(sheet.rows) })),
  ];
  const blob = createZip(entries.map((entry) => ({ name: entry.name, bytes: utf8.encode(entry.text) })));
  return new Uint8Array(await blob.arrayBuffer());
}

function resolveRelationshipTarget(base, target) {
  if (!target || target.includes('\0') || target.includes('\\')) return '';
  const source = target.startsWith('/') ? target.slice(1) : `${base}/${target}`;
  const parts = [];
  for (const part of source.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return ''; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

function parseRelationships(xml, baseDir) {
  if (/<!DOCTYPE|<!ENTITY/i.test(String(xml || ''))) throw Error('DTD/entity declarations are not allowed');
  const targets = new Map();
  for (const match of String(xml || '').matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?\s*>/g)) {
    const attrs = match[1];
    const id = attribute(attrs, 'Id');
    const target = attribute(attrs, 'Target');
    const external = /(?:^|\s)TargetMode\s*=\s*["']External["']/i.test(attrs);
    if (id && target && !external) targets.set(id, resolveRelationshipTarget(baseDir, target));
  }
  return targets;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('DTD/entity declarations are not allowed');
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) => textElements(match[1]));
}

function cellValue(type, body, sharedStrings) {
  const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(body)?.[1];
  const value = raw == null ? '' : unescapeXml(raw.replace(/<[^>]*>/g, ''));
  if (type === 's') {
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : '';
  }
  if (type === 'inlineStr') {
    const inline = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/i.exec(body)?.[1] || body;
    return textElements(inline);
  }
  if (type === 'b') return value === '1' ? true : value === '0' ? false : value;
  if (type === 'e' || type === 'str') return value;
  if (value !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}

export async function readXlsxWorkbook(input, { maxUncompressed = 24 * 1024 * 1024 } = {}) {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const unpacked = await unpackZip(raw, { maxUncompressed });
  if (!unpacked.ok) throw Error(unpacked.error || 'Invalid XLSX package');
  const entries = new Map(unpacked.files.filter((file) => file.kind === 'text').map((file) => [file.path, file.content]));
  const contentTypes = entries.get('[Content_Types].xml') || '';
  const workbookXml = entries.get('xl/workbook.xml') || '';
  if (/<!DOCTYPE|<!ENTITY/i.test(contentTypes + workbookXml)) throw Error('DTD/entity declarations are not allowed');
  if (!/spreadsheetml\.sheet\.main\+xml/.test(contentTypes) || !workbookXml) throw Error('Not a valid XLSX workbook package');
  const workbookRels = parseRelationships(entries.get('xl/_rels/workbook.xml.rels') || '', 'xl');
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml') || '');
  const sheetNodes = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?\s*>/g)];
  if (!sheetNodes.length || sheetNodes.length > MAX_SHEETS) throw Error(`Workbook must contain 1–${MAX_SHEETS} sheets`);
  const sheets = [];
  let cellCount = 0;
  let formulaCount = 0;
  for (const [sheetIndex, match] of sheetNodes.entries()) {
    const attrs = match[1];
    const name = attribute(attrs, 'name') || `Sheet${sheetIndex + 1}`;
    const relId = attribute(attrs, 'r:id');
    const target = workbookRels.get(relId);
    if (!target || !target.startsWith('xl/worksheets/') || !entries.has(target)) throw Error(`Worksheet relationship missing or unsupported: ${name}`);
    const xml = entries.get(target);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('DTD/entity declarations are not allowed');
    const cells = [];
    for (const cellMatch of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:>([\s\S]*?)<\/(?:\w+:)?c>|\s*\/>)/g)) {
      if (++cellCount > MAX_INSPECT_CELLS) throw Error(`Workbook exceeds ${MAX_INSPECT_CELLS} inspected cells`);
      const attrsCell = cellMatch[1];
      const body = cellMatch[2] || '';
      const ref = attribute(attrsCell, 'r');
      if (!/^[A-Z]{1,3}[1-9]\d*$/i.test(ref)) continue;
      const col = columnIndex(ref.match(/^[A-Z]+/i)?.[0]);
      const row = Number(ref.match(/\d+$/)?.[0]);
      if (!col || col > MAX_COLUMNS || !row || row > MAX_ROWS) continue;
      const type = attribute(attrsCell, 't');
      const formulaRaw = /<(?:\w+:)?f\b[^>]*>([\s\S]*?)<\/(?:\w+:)?f>/i.exec(body)?.[1];
      const formula = formulaRaw == null ? '' : unescapeXml(formulaRaw.replace(/<[^>]*>/g, ''));
      if (formula) formulaCount += 1;
      cells.push({ cell: ref.toUpperCase(), row, column: col, value: cellValue(type, body, sharedStrings), ...(formula ? { formula } : {}) });
    }
    const declaredRows = [...xml.matchAll(/<(?:\w+:)?row\b[^>]*\br="(\d+)"/g)].map((m) => Number(m[1])).filter(Number.isFinite);
    sheets.push({ name, rowCount: declaredRows.length ? Math.max(...declaredRows) : 0, cellCount: cells.length, cells });
  }
  const externalRelationships = [...entries].filter(([path]) => path.endsWith('.rels')).reduce((n, [, xml]) => n + (xml.match(/TargetMode\s*=\s*["']External["']/gi) || []).length, 0);
  return { format: 'xlsx', sheetCount: sheets.length, sheets, formulaCount, externalRelationships,
    warnings: ['Structural inspection only: formatting, charts, drawings, and merged-cell layout are not rendered.', 'Formulas are reported as text and are never evaluated; external relationships are never followed.'] };
}

// 供 document_tool 分页回传：在 readXlsxWorkbook 的结构化结果上做 JSON 序列化截断。
export async function inspectXlsxWorkbook(input, { offset = 0, maxUncompressed = 24 * 1024 * 1024 } = {}) {
  const result = await readXlsxWorkbook(input, { maxUncompressed });
  const serialized = JSON.stringify(result, null, 2);
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const end = start + 12000;
  return { format: 'xlsx', sheetCount: result.sheetCount, formulaCount: result.formulaCount, externalRelationships: result.externalRelationships,
    text: serialized.slice(start, end), totalChars: serialized.length, nextOffset: end < serialized.length ? end : null,
    warnings: result.warnings };
}
