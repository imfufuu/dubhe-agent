// Original, hand-drawn SVG marks for the project tree. All markup is static;
// filenames only select from this allowlist and are never interpolated into SVG.
const marks = Object.freeze({
  folder: '<path d="M2.5 6.5V4.7c0-.9.7-1.6 1.6-1.6h4.6l2 2h7.2c.9 0 1.6.7 1.6 1.6v1.1"/><path d="M2.5 7.7h17.3l-1.5 10.2a1.7 1.7 0 0 1-1.7 1.5H3.9a1.5 1.5 0 0 1-1.4-1.7z"/>',
  folderOpen: '<path d="M2.6 17.3V4.7c0-.9.7-1.6 1.6-1.6h4.5l2 2h7.2c.9 0 1.6.7 1.6 1.6v1.2"/><path d="M4.4 9h16l-2.1 9a1.8 1.8 0 0 1-1.7 1.4H3a1.1 1.1 0 0 1-1-1.4z"/>',
  file: '<path d="M5 2.5h8l5 5v14H5z"/><path d="M13 2.5v5h5M8 12h7M8 15.5h7"/>',
  code: '<path d="m9 6-5 6 5 6M15 6l5 6-5 6M13.5 4l-3 16"/>',
  ts: '<rect x="2.5" y="2.5" width="19" height="19" rx="3" class="fill"/><path class="white" d="M6 8h7M9.5 8v8M17.9 8.8c-3-1.8-5 1.2-2 2.7l1.3.6c2.8 1.3 1.1 4.9-2.4 3.5"/>',
  js: '<rect x="2.5" y="2.5" width="19" height="19" rx="2.5" class="fill"/><path class="dark" d="M9.5 8v6.3c0 2.5-2.4 3-3.5 1M18.2 8.9c-2.7-1.7-4.7 1-1.8 2.5l1.1.6c2.8 1.4 1 4.6-2.5 3.2"/>',
  react: '<ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/><circle cx="12" cy="12" r="1.4" class="fill"/>',
  css: '<path d="M4 3h16l-1.4 15L12 21l-6.6-3z" class="fill"/><path class="white" d="M7.5 7h9l-.3 2.6-7.9 2.5h7.5l-.5 3.8-3.3 1-3.4-1-.2-1.5"/>',
  html: '<path d="M4 3h16l-1.4 15L12 21l-6.6-3z" class="fill"/><path class="white" d="M8 7h8l-.3 2H9l.3 2.3h6.1l-.5 4.4-2.9 1-3-.9-.2-1.5"/>',
  json: '<path d="M8.5 3.5c-2.4 0-2.9 1-2.9 3.1v2.2c0 1.9-.6 2.7-2.3 3.2 1.7.5 2.3 1.3 2.3 3.2v2.2c0 2.1.5 3.1 2.9 3.1M15.5 3.5c2.4 0 2.9 1 2.9 3.1v2.2c0 1.9.6 2.7 2.3 3.2-1.7.5-2.3 1.3-2.3 3.2v2.2c0 2.1-.5 3.1-2.9 3.1"/>',
  env: '<path d="M5 3.5h14v17H5z" class="fill"/><rect x="8" y="11" width="8" height="6" rx="1" class="dark"/><path class="dark" d="M9.5 11V9a2.5 2.5 0 1 1 5 0v2"/>',
  package: '<path d="M12 2.5 21 7v10l-9 4.5L3 17V7z" class="fill"/><path class="white" d="M3.5 7.2 12 12l8.5-4.8M12 12v9M7.5 5l9 4.8"/>',
  config: '<path d="M10 2.5h4l.6 2.2 2 .8 2-1.1 2.8 2.8-1.1 2 .8 2L23 12v2l-2.2.6-.8 2 1.1 2-2.8 2.8-2-1.1-2 .8L14 23h-4l-.6-2.2-2-.8-2 1.1-2.8-2.8 1.1-2-.8-2L1 14v-4l2.2-.6.8-2-1.1-2L5.7 2.6l2 1.1 2-.8z" class="fill"/><circle cx="12" cy="12" r="3.3" class="white"/>',
  markdown: '<path d="M3 5h18v14H3z"/><path d="M6 16V9l2.7 3 2.7-3v7M16 8v7m-2-2 2 2 2-2"/>',
  python: '<path d="M12 3c-4.8 0-4.8 1.9-4.8 4.6h5.2v1.2H5.8C3 8.8 2.5 11 2.5 12.5c0 2.3 1.1 3.7 3.2 3.7h1.6v-2c0-2.2 1.7-3.2 3.6-3.2h5.2c1.7 0 2.6-1.2 2.6-3V6c0-2-1.8-3-6.7-3z" class="fill"/><path d="M12 21c4.8 0 4.8-1.9 4.8-4.6h-5.2v-1.2h6.6c2.8 0 3.3-2.2 3.3-3.7 0-2.3-1.1-3.7-3.2-3.7h-1.6v2c0 2.2-1.7 3.2-3.6 3.2H7.9c-1.7 0-2.6 1.2-2.6 3v2c0 2 1.8 3 6.7 3z"/><circle cx="9" cy="5.8" r=".7"/><circle cx="15" cy="18.2" r=".7"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.7"/><path d="m4 17 5-5 3.5 3 3-3 4.5 5"/>',
  audio: '<path d="M9 17V6l9-2v11M9 7l9-2"/><ellipse cx="6.7" cy="17.5" rx="2.4" ry="1.8"/><ellipse cx="15.7" cy="15.5" rx="2.4" ry="1.8"/>',
  video: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m10 9 5 3-5 3z" class="fill"/>',
  archive: '<path d="M5 2.5h14v19H5z"/><path d="M11 3v2h2v2h-2v2h2v2h-2v2h2v2h-2M10 16h4v3h-4z"/>',
  database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3M4 14.5c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  doc: '<path d="M5 2.5h8l5 5v14H5z"/><path d="M13 2.5v5h5M8 11h7M8 14h7M8 17h5"/>',
  shell: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m6 9 3 3-3 3M12 16h5"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9z"/>',
});

export function projectIconType(path, isDir = false, expanded = false) {
  if (isDir) return expanded ? 'folderOpen' : 'folder';
  const name = String(path || '').split('/').pop().toLowerCase();
  if (/^\.env(?:\.|$)/.test(name)) return 'env';
  if (name === 'package.json' || name === 'package-lock.json' || name === 'pnpm-lock.yaml') return 'package';
  if (/^(?:eslint|prettier|postcss|vite|webpack|next|tsconfig|drizzle|rollup|babel|jest|vitest|tailwind)(?:\.|$)/.test(name)) return 'config';
  if (/^(?:dockerfile|makefile)$/.test(name)) return 'config';
  const ext = name.split('.').pop();
  if (['tsx','jsx'].includes(ext)) return 'react';
  if (['ts','mts','cts'].includes(ext)) return 'ts';
  if (['js','mjs','cjs'].includes(ext)) return 'js';
  if (['css','scss','sass','less'].includes(ext)) return 'css';
  if (['html','htm'].includes(ext)) return 'html';
  if (['json','jsonc'].includes(ext)) return 'json';
  if (['md','markdown'].includes(ext)) return 'markdown';
  if (ext === 'py') return 'python';
  if (['png','jpg','jpeg','gif','svg','webp','ico','avif'].includes(ext)) return 'image';
  if (['mp3','wav','ogg','flac','m4a'].includes(ext)) return 'audio';
  if (['mp4','webm','mov'].includes(ext)) return 'video';
  if (['zip','gz','tar','7z','rar'].includes(ext)) return 'archive';
  if (['sql','db','sqlite'].includes(ext)) return 'database';
  if (['sh','bash','zsh','ps1'].includes(ext)) return 'shell';
  if (['url','webloc'].includes(ext)) return 'web';
  if (['txt','pdf','doc','docx','csv','yml','yaml','toml','xml'].includes(ext)) return 'doc';
  if (['c','cpp','h','hpp','go','rs','java','php','swift'].includes(ext)) return 'code';
  return 'file';
}
export function projectIconSvg(type) {
  const mark = marks[type] || marks.file;
  return `<svg viewBox="0 0 24 24" class="pm-file-icon pm-icon-${type in marks ? type : 'file'}" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mark}</svg>`;
}
