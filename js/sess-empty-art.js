// 侧栏「还没有会话记录」空状态：与记忆 / 文件面板同一套线稿插画 + 一句话（currentColor，随深浅主题）。
// 独立模块：ui.js 已接近 3000 行预算，插画不放进去。
const SESS_EMPTY_ART = `<svg class="files-empty-art sess-empty-art" viewBox="0 0 160 112" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs><linearGradient id="seg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".10"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
  <ellipse cx="80" cy="98" rx="52" ry="7" fill="url(#seg)"/>
  <g class="fe-back" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" opacity=".5" transform="rotate(-5 80 60)">
    <path d="M96 22h34a5 5 0 0 1 5 5v20a5 5 0 0 1-5 5h-22l-8 7v-7h-4a5 5 0 0 1-5-5V27a5 5 0 0 1 5-5Z" fill="var(--bg)"/>
  </g>
  <g class="fe-stack" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M42 42h54a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H66l-12 10v-10h-12a5 5 0 0 1-5-5V47a5 5 0 0 1 5-5Z" fill="var(--bg)"/>
    <path d="M52 55h34M52 64h22" stroke-opacity=".5"/>
  </g>
  <g class="fe-sparks" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".5">
    <path d="M26 30v6M23 33h6"/><path d="M134 72v4M132 74h4"/><circle cx="128" cy="86" r="1.4" fill="currentColor" stroke="none"/>
  </g>
</svg>`;

// 返回一个可直接 appendChild 的空状态节点（无边框；文案走语言层的 DOM 文本翻译）
export function sessionsEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'files-empty sess-empty sess-empty-hint';
  wrap.innerHTML = `${SESS_EMPTY_ART}<p class="files-empty-text">还没有会话记录</p>`;
  return wrap;
}
