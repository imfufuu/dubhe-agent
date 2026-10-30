// 用户附件落盘到沙箱 uploads/（从 agent.js 外移，保持主循环文件体积在预算内）。
// 附件落盘文件名：去掉路径分隔与控制字符，避免越权写到 uploads/ 之外
export const safeName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120) || 'file';

// 用户附件 → 沙箱 uploads/（文本写原文，图片写 data URL 以便编辑/打包下载）
// 同名且内容相同则复用路径；内容不同则追加序号，避免覆盖上一轮上传
export function copyAttachmentsToFS(fs, attachments = []) {
  const written = [];
  const taken = new Set(fs.list().map((f) => f.path));
  for (const a of attachments || []) {
    const content = a.kind === 'text' ? a.text : (a.dataUrl || a.text);
    if (content == null || content === '') continue;
    const base = `uploads/${safeName(a.name)}`;
    let path = base;
    if (taken.has(path) && fs.read(path) !== content) {
      const dot = base.lastIndexOf('.');
      for (let n = 2; taken.has(path); n++) {
        path = dot > 0 ? `${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${base}-${n}`;
      }
    }
    fs.write(path, content);
    taken.add(path);
    written.push(path);
  }
  return written;
}
