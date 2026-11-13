// 任务最终产物报告（2026-11-09）：Agent 指定一个沙箱工作区文件，回合结束后自动展开面板并打开它。
// 刻意要求「非内部文件」：internal/ 与 .git/ 是内部/元数据，不作为交付报告。
import { isSafeFsPath } from './sandbox.js';

let pendingReport = '';
const INTERNAL = /^(?:internal|\.git)\//;

export function validateFinalReportPath(path, fs) {
  const p = String(path || '').trim();
  if (!p || !isSafeFsPath(p)) throw new Error('报告路径必须是合法的相对路径');
  if (INTERNAL.test(p)) throw new Error('最终产物报告必须是沙箱工作区文件，不能用 internal/ 或 .git/ 内部路径');
  if (fs && typeof fs.has === 'function' && !fs.has(p)) throw new Error(`报告文件不存在：${p}（请先用 write_file 创建）`);
  return p;
}

export function setFinalReport(path, fs) {
  pendingReport = validateFinalReportPath(path, fs);
  return pendingReport;
}
export function peekFinalReport() { return pendingReport; }
export function takeFinalReport() { const p = pendingReport; pendingReport = ''; return p; }
export function clearFinalReport() { pendingReport = ''; }

/** 回合结束时由 main.js 调用；UI 监听同名事件打开面板与文件。 */
export function announceFinalReport(path, doc = globalThis.document) {
  const p = String(path || '').trim();
  if (!p || !doc) return false;
  try {
    const Ctor = doc.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (!Ctor) return false;
    doc.dispatchEvent(new Ctor('dubhe:final-report', { detail: { path: p } }));
    return true;
  } catch { return false; }
}
