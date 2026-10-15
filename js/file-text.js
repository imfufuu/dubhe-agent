// read_file 的「文本视图」：沙箱里的上传附件（SVG / 代码 / 数据等）常以 data URL 存放。
// 旧版 read_file 原样返回 `data:image/svg+xml;base64,…`，模型拿到的是一大串 base64 而不是 SVG 源码。
// 这里把文本类 data URL 解码成 UTF-8 文本；真正的二进制只回一行说明 + 该用的工具，不把 base64 塞进上下文。
import { mimeFromPath } from './zip.js';

const DATA_URL_RE = /^data:([^;,]*)((?:;[^;,]*)*),/i;
const TEXT_EXT = new Set(('svg txt md markdown csv tsv json jsonc json5 xml html htm xhtml css scss less js mjs cjs ts tsx jsx '
  + 'py java c cc cpp cxx h hpp cs go rs rb php swift kt kts scala dart m r jl sh bash zsh ps1 bat cmd sql yml yaml toml ini env '
  + 'conf cfg log tex latex lua hs erl ex exs clj cljs fs fsx ml mli asm diff patch vue svelte gitignore editorconfig srt vtt ics rtf').split(' '));
const TEXT_MIME_RE = /^(?:text\/|image\/svg\+xml$|application\/(?:json|ld\+json|xml|javascript|ecmascript|x-javascript|typescript|x-sh|x-shellscript|sql|x-sql|toml|x-toml|yaml|x-yaml|csv|x-tex|rtf|x-httpd-php|x-python|graphql|manifest\+json)$|[^/]+\/[^/]+\+(?:xml|json)$)/i;

export function isTextualFile(mime = '', path = '') {
  const ext = String(path || '').toLowerCase().split('/').pop().split('.').slice(1).pop() || '';
  return TEXT_MIME_RE.test(String(mime || '').trim()) || TEXT_EXT.has(ext);
}

function binaryHint(mime, path) {
  const m = String(mime || '').toLowerCase(), ext = (String(path).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  if (m.startsWith('image/')) return '要看图片内容用 analyze_image；要换格式用 convert_file';
  if (m === 'application/pdf' || ext === 'pdf') return '要读 PDF 文字用 document_tool(format="pdf", action="inspect") 或 analyze_pdf';
  if (/wordprocessingml|presentationml/.test(m) || ext === 'docx' || ext === 'pptx') return '要读 Office 文稿用 document_tool(action="inspect")';
  if (m.startsWith('audio/')) return '要听写/分析音频用 analyze_audio；要换格式用 convert_file';
  if (m.startsWith('video/')) return '要分析视频用 analyze_video；要换格式或抽音轨用 convert_file';
  if (m === 'application/zip' || ext === 'zip') return '要查看压缩包用 unzip_file';
  return '如确需原始字节，在 execute_javascript 里读取 files[path]（data URL）';
}
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/**
 * @returns {{ text: string, binary: boolean, decoded: boolean, mime: string, bytes: number }}
 *   decoded=true 表示原值是 data URL、已解码成文本；binary=true 表示二进制，text 是一行说明。
 */
export function readableFileText(value, path = '') {
  const raw = value == null ? '' : String(value);
  const head = DATA_URL_RE.exec(raw.slice(0, 256));
  if (!head) return { text: raw, binary: false, decoded: false, mime: '', bytes: raw.length };
  const mime = (head[1] || '').trim().toLowerCase() || mimeFromPath(path) || 'application/octet-stream';
  const isB64 = /;base64/i.test(head[2] || '');
  let bytes;
  try {
    const payload = raw.slice(head[0].length);
    if (isB64) {
      const bin = atob(payload.replace(/\s+/g, ''));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else bytes = new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return { text: raw, binary: false, decoded: false, mime, bytes: raw.length };
  }
  if (isTextualFile(mime, path)) {
    try {
      let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      return { text, binary: false, decoded: true, mime, bytes: bytes.length };
    } catch { /* 不是合法 UTF-8：按二进制说明处理，绝不回 base64 */ }
  }
  return {
    text: `[二进制文件 · ${mime} · ${fmtBytes(bytes.length)}] read_file 只返回文本内容，不回传 base64。${binaryHint(mime, path)}。`,
    binary: true, decoded: false, mime, bytes: bytes.length,
  };
}
