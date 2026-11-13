// 已通过初审 + 用户确认的代码工具执行器。
// 默认 runner 在受限作用域里同步求值；CSP 禁止 unsafe-eval 的环境会给出明确错误而不是静默失败。
// 可注入 runner 便于单测与未来接入 Web Worker 沙箱。
export function runToolCode(code, args, { runner } = {}) {
  const a = Object.freeze({ ...(args && typeof args === 'object' ? args : {}) });
  const execute = runner || defaultRunner;
  try {
    const value = execute(String(code || ''), a);
    if (value === undefined) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (err) {
    return `代码工具执行失败：${String(err?.message || err)}`;
  }
}

function defaultRunner(code, args) {
  if (typeof Function !== 'function') throw new Error('当前环境不支持动态代码执行');
  // 把危险全局名作为形参遮蔽；配合 tool-code-review 的静态黑名单形成两层约束。
  // 严格模式禁止把 eval / arguments 用作形参名，这里由静态初审覆盖 eval。
  const shadow = ['Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
    'globalThis', 'window', 'document', 'process', 'require', 'self', 'postMessage',
    'localStorage', 'indexedDB', 'navigator', 'setTimeout', 'setInterval'];
  try {
    const fn = new Function('args', ...shadow, `"use strict"; return (${code});`);
    const produced = fn(args, ...shadow.map(() => undefined));
    if (typeof produced !== 'function') throw new Error('代码必须求值为一个函数');
    return produced(args);
  } catch (err) {
    if (/unsafe-eval|Content Security Policy/i.test(String(err?.message || ''))) {
      throw new Error('页面 CSP 禁止动态代码执行；请改用本地 server.py 模式或声明式 handler');
    }
    throw err;
  }
}
