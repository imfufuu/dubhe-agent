const PATCH_MARKER = Symbol.for('dubhe.wllama.abort-message-guard.v2');
const ASSERTIONS_HINT = 'Build with -sASSERTIONS for more info.';

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return String(value); } catch { return ''; }
}

function safeLog(logger, level, ...args) {
  try { logger?.[level]?.(...args); } catch { /* 诊断日志是尽力而为，绝不能打断中止流程 */ }
}

/**
 * Wllama 3.8.1 的 `signal.abort` 处理器有两个问题：
 *  1. 它把 `message.replace(...)` 放进一个 `__async` IIFE 里并 `return;`，
 *     IIFE 内部抛出的错误（例如 message 缺失/非字符串，或栈解码失败）变成没人接的
 *     Promise rejection，即控制台里的 `window.rejection`；
 *  2. 因为异常发生在 `this.abort(...)` 之前，挂起的推理 Promise 永远不会被 reject，界面一直转圈。
 *
 * 这里对 `signal.abort` 消息改为同步处理：规范化字段 → 记录日志 → 同步调用 `this.abort(...)`。
 * 不再调用原实现，因此不会产生游离 Promise；代价是栈不再经过 wasm 函数名解码（仅影响诊断细节）。
 * 其它 verb 原样交给 Wllama 原实现。
 */
export function patchWllamaAbortMessageHandling(WllamaClass) {
  const prototype = WllamaClass?.prototype;
  if (!prototype || typeof prototype.onRecvMsg !== 'function') return false;
  if (prototype[PATCH_MARKER]) return true;

  const original = prototype.onRecvMsg;
  const guarded = function onRecvMsgWithSafeAbortMessage(event) {
    const data = event?.data;
    if (data?.verb !== 'signal.abort') return original.call(this, event);

    const args = Array.isArray(data.args) ? [...data.args] : Array.from(data.args || []);
    const signalType = safeString(args[0]);
    const rawMessage = safeString(args[1]);
    const rawStack = safeString(args[2]);
    const originalErr = args[3];
    const logger = this?.logger;

    if (originalErr) safeLog(logger, 'error', originalErr);

    let message = rawMessage.split(ASSERTIONS_HINT).join('').trim();
    if (!message) message = signalType === 'exception' ? 'Local model runtime exception.' : 'Local model aborted.';
    let stack = '';
    if (signalType === 'abort') {
      if (!message.startsWith('(ABORT)')) message = `(ABORT) ${message}`;
      stack = rawStack.replace(/\|/gu, '\n');
    } else if (signalType === 'exception') {
      stack = rawStack;
    }

    safeLog(logger, 'error', `Stack trace (${signalType || 'unknown'}):\n${stack}`);
    try {
      this.abort(message, stack);
    } catch (error) {
      // 最后的兜底：仍要把原始中止原因交给挂起的任务，否则推理 Promise 会永久挂起。
      safeLog(logger, 'error', 'Wllama abort handler failed; forwarding the original abort reason.', error);
      try { this.abort(message, stack || safeString(error?.stack)); } catch { /* 无法再中止时只能放弃 */ }
    }
    return undefined;
  };
  Object.defineProperty(prototype, PATCH_MARKER, { value: true, configurable: false });
  prototype.onRecvMsg = guarded;
  return true;
}

/**
 * Wllama 3.8.1 的 `onRecvMsg` / `abort` 定义在内部类 ProxyToWorker 上（未导出），
 * 外层 Wllama 只在 loadModel() 时执行 `this.proxy = new ProxyToWorker(...)`，
 * 随后 moduleInit() 才执行 `this.worker.onmessage = this.onRecvMsg.bind(this)`。
 * 因此不能对导出的 Wllama 类打补丁（那样是无效的，且会静默失败），而要在 `proxy` 被赋值的瞬间，
 * 给刚创建的 proxy 的原型打补丁——这早于 worker 的 onmessage 绑定。
 * 若结构不兼容（找不到 onRecvMsg），直接抛错让加载失败并可见，而不是退回到会悬挂的原始实现。
 */
export function guardWllamaProxy(runtime) {
  let proxy = null;
  Object.defineProperty(runtime, 'proxy', {
    configurable: true,
    enumerable: true,
    get() { return proxy; },
    set(value) {
      const proto = value && Object.getPrototypeOf(value);
      if (!patchWllamaAbortMessageHandling({ prototype: proto })) {
        throw new Error('本地模型运行时与 Wllama 版本不兼容（缺少 onRecvMsg），已停止加载。');
      }
      proxy = value;
    },
  });
  return runtime;
}
