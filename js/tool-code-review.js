// 自注册「代码工具」的安全部门初审（静态审查，2026-11-09）。
// 这不是形式化验证：初审通过只是允许进入用户确认环节，执行仍受受限运行时约束。
export const TOOL_CODE_MAX_BYTES = 4000;

const FORBIDDEN = [
  /\beval\b/, /\bnew\s+Function\b/, /\bFunction\s*\(/, /\bimport\s*\(/, /\brequire\s*\(/,
  /\bfetch\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bimportScripts\b/, /\bnavigator\b/,
  /\bglobalThis\b/, /\bwindow\b/, /\bdocument\b/, /\bprocess\b/, /\bself\b/, /\bpostMessage\b/,
  /\blocalStorage\b/, /\bindexedDB\b/, /\bcookie\b/i, /\b__proto__\b/, /\bconstructor\b/,
  /\bprototype\b/, /\bReflect\b/, /\bProxy\b/, /\bSymbol\b/, /\bwhile\s*\(/, /\bfor\s*\(/,
  /\bsetTimeout\b/, /\bsetInterval\b/, /\bDate\b/, /\bMath\.random\b/, /\bdebugger\b/,
  /\basync\b/, /\bawait\b/, /\bclass\b/, /\bthis\b/, /\bthrow\b/, /\btry\b/, /\bcatch\b/,
];

export function reviewToolCode(code) {
  const src = String(code ?? '');
  const reasons = [];
  if (!src.trim()) reasons.push('代码为空');
  if (src.length > TOOL_CODE_MAX_BYTES) reasons.push(`代码超过 ${TOOL_CODE_MAX_BYTES} 字符上限`);
  for (const re of FORBIDDEN) {
    if (re.test(src)) { reasons.push(`命中禁用语法 ${re.source}`); break; }
  }
  if (!/\bfunction\b|\=>/.test(src)) reasons.push('必须是一个纯函数体（function 或箭头表达式）');
  const approved = reasons.length === 0;
  return { approved, reasons, checkedAt: new Date().toISOString(), bytes: src.length, policy: 'static-v1' };
}
