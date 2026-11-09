// 项目模式：清空预览区的全部视觉残留。
// 编辑器是「textarea + 底层语法高亮 <pre> + 行号 + 标记 + 媒体预览」叠在一起的多层结构；
// 隐藏 textarea 或清空 value 并不会清掉底层高亮层 / 媒体 DOM，删除当前选中的目录后旧文件内容
// 会继续叠在空状态背景上（2026-11-08 修复）。把清理集中成一个可单测的纯 DOM 函数。
export function resetPreviewSurface({
  textarea, gutter, hlCode, hlPre, codeWrap, marks, mediaView, emptyNote,
} = {}) {
  // 1) 底层高亮：必须清空 innerHTML 并移除 hl-on，否则 CSS 会让 .pm-hl 继续显示旧代码，
  //    同时 .pm-code.hl-on > .pm-text 会把 textarea 文字变透明，看起来像「内容滞留」。
  if (hlCode) hlCode.innerHTML = '';
  if (codeWrap && codeWrap.classList) codeWrap.classList.remove('hl-on');
  if (hlPre) { try { hlPre.scrollTop = 0; hlPre.scrollLeft = 0; } catch { /* jsdom */ } }
  if (gutter) gutter.textContent = '';
  if (marks && typeof marks.replaceChildren === 'function') marks.replaceChildren();
  // 2) 编辑器
  if (textarea) {
    textarea.value = '';
    textarea.hidden = true;
    try { textarea.scrollTop = 0; textarea.scrollLeft = 0; textarea.setSelectionRange?.(0, 0); } catch { /* jsdom */ }
  }
  // 3) 媒体预览：<img>/<video>/<iframe> 与 data URL 必须真的从 DOM 移除，不能只 hidden。
  //    同时清掉 renderMedia 的缓存键，避免下次打开同名文件时因缓存命中而跳过渲染。
  if (mediaView) {
    if (typeof mediaView.replaceChildren === 'function') mediaView.replaceChildren();
    else mediaView.innerHTML = '';
    mediaView._path = '';
    mediaView._value = '';
    mediaView.hidden = true;
  }
  // 4) 空状态
  if (emptyNote) emptyNote.hidden = false;
}

/** 删除/移动路径后判断「当前预览是否落在被删目录里」。 */
export function isActiveUnderPath(active, path) {
  const a = String(active || ''), p = String(path || '').replace(/\/+$/, '');
  return !!a && !!p && (a === p || a.startsWith(p + '/'));
}
