// 附件卡片图标（输入框芯片 + 用户气泡共用）。
// 规则：图片 → 原图缩略；视频 → 首帧海报（poster）+ ▶ 角标；其余 → 按格式归类的彩色标签图标（PDF / DOCX / XLSX / ZIP / 代码 …）。
// 纯函数 + 字符串 HTML，不依赖 DOM，便于测试。附件格式不做限制：未知格式统一落到「其它」类。

const CATS = Object.freeze({
  pdf: ['pdf'],
  word: ['doc', 'docx', 'odt', 'rtf', 'pages'],
  sheet: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'],
  slide: ['ppt', 'pptx', 'odp', 'key'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'dmg', 'iso'],
  audio: ['mp3', 'mpga', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba', 'aiff', 'mid', 'midi'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'mpeg', 'mpg', '3gp'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'avif', 'apng', 'heic', 'heif', 'svg', 'psd', 'raw'],
  code: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'dart', 'lua', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'sql', 'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'less', 'r', 'jl', 'm', 'hs', 'ex', 'exs', 'clj', 'diff', 'patch', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'conf', 'md', 'markdown', 'tex', 'latex'],
  text: ['txt', 'log', 'text', 'srt', 'vtt'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
  model: ['glb', 'gltf', 'obj', 'stl', 'fbx', 'blend', 'dwg', 'dxf', 'step', 'stp'],
});
const EXT_TO_CAT = new Map();
for (const [cat, exts] of Object.entries(CATS)) for (const e of exts) EXT_TO_CAT.set(e, cat);

export const FILE_CARD_LABEL = Object.freeze({
  pdf: 'PDF', word: '文档', sheet: '表格', slide: '演示', archive: '压缩包', audio: '音频', video: '视频',
  image: '图片', code: '代码', text: '文本', font: '字体', model: '模型', other: '文件',
});

export function fileExtOf(name) {
  const m = /\.([a-z0-9]{1,12})$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/** 附件 → 卡片分类键（pdf/word/sheet/slide/archive/audio/video/image/code/text/font/model/other）。 */
export function fileCategoryOf(a = {}) {
  const name = String(a.name || a.originalName || '');
  const mime = String(a.mime || '').toLowerCase();
  const ext = fileExtOf(name);
  if (a.kind === 'image' || a.source === 'svg' || mime.startsWith('image/')) return 'image';
  if (a.source === 'video' || mime.startsWith('video/')) return 'video';
  if (a.source === 'audio' || mime.startsWith('audio/')) return 'audio';
  if (a.source === 'pdf' || mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (a.source === 'zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'archive';
  if (a.source === 'office' || /wordprocessingml|msword|opendocument\.text/.test(mime)) return EXT_TO_CAT.get(ext) || 'word';
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(mime)) return 'sheet';
  if (/presentationml|ms-powerpoint|opendocument\.presentation/.test(mime)) return 'slide';
  if (ext && EXT_TO_CAT.has(ext)) return EXT_TO_CAT.get(ext);
  if (a.kind === 'text' || mime.startsWith('text/')) return 'text';
  if (/^application\/(json|xml|yaml|x-yaml|toml|javascript|x-sh|sql)$/.test(mime)) return 'code';
  if (mime.startsWith('font/')) return 'font';
  return 'other';
}

/** 卡片上显示的扩展名（最多 4 个字符，全大写；没有扩展名则用分类标签）。 */
export function fileCardBadge(a = {}) {
  const ext = fileExtOf(a.originalName || a.name);
  return ext ? ext.slice(0, 4).toUpperCase() : FILE_CARD_LABEL[fileCategoryOf(a)] || '文件';
}

/**
 * 卡片图标 HTML。
 * @param {object} a 附件
 * @param {{ safeImgSrc?: (s:string)=>string, esc?: (s:string)=>string }} [opt]
 */
export function fileCardIconHtml(a = {}, { safeImgSrc = (s) => s, esc = (s) => String(s) } = {}) {
  const cat = fileCategoryOf(a);
  if (cat === 'image') {
    const src = safeImgSrc(a.dataUrl);
    if (src) return `<span class="fc-ico fc-thumb fc-image"><img src="${src}" alt=""></span>`;
  }
  if (cat === 'video') {
    const poster = safeImgSrc(a.poster);
    return `<span class="fc-ico fc-thumb fc-video">${poster ? `<img src="${poster}" alt="">` : '<span class="fc-glyph">▶</span>'}<span class="fc-play" aria-hidden="true"></span></span>`;
  }
  if (cat === 'audio' || cat === 'video' || cat === 'image') return `<span class="fc-ico fc-${cat}" data-cat="${cat}" title="${esc(FILE_CARD_LABEL[cat])}"><span class="fc-badge">${esc(fileCardBadge(a))}</span></span>`;
  const badge = esc(fileCardBadge(a));
  return `<span class="fc-ico fc-${cat}" data-cat="${cat}" title="${esc(FILE_CARD_LABEL[cat])}"><svg class="fc-file-svg" viewBox="0 0 28 28" aria-hidden="true"><path d="M6 2.5h10l6 6v17H6z" fill="var(--bg)" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M16 2.5v6h6" fill="none" stroke="currentColor" stroke-width="1.3"/><text x="14" y="19" text-anchor="middle" fill="currentColor" font-size="${badge.length > 3 ? 5 : 6.5}" font-weight="700">${badge}</text></svg></span>`;
}
