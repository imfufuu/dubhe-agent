const PATCH_MARKER = Symbol.for('dubhe.wllama.abort-message-guard.v1');

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return String(value); } catch { return ''; }
}

function surfaceAbort(instance, signalType, message, rawStack, error) {
  const detail = message || safeString(error?.message) || 'Local model aborted.';
  const abortMessage = signalType === 'abort' && !detail.startsWith('(ABORT)') ? `(ABORT) ${detail}` : detail;
  const stack = safeString(rawStack).replace(/\|/gu, '\n') || safeString(error?.stack);
  try { instance?.logger?.error?.('Wllama abort handler failed; preserving the original abort.', error); } catch { /* diagnostic logging is best-effort */ }
  try { instance?.abort?.(abortMessage, stack); } catch { /* never replace the original abort with fallback cleanup */ }
}

/**
 * Wllama 3.8.1's `signal.abort` handler calls `.replace()` on both `message` and
 * `rawStack` from the worker payload. Some aborts deliver a missing/non-string
 * field, which can throw a TypeError and mask the actual model abort. Normalize
 * those two fields before Wllama handles the message; keep all other messages
 * and the library implementation untouched.
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
    const message = safeString(args[1]);
    const rawStack = safeString(args[2]);
    args[0] = signalType;
    args[1] = message;
    args[2] = rawStack;
    const safeEvent = { data: { ...data, args } };

    try {
      const result = original.call(this, safeEvent);
      if (result && typeof result.then === 'function') {
        return result.catch((error) => surfaceAbort(this, signalType, message, rawStack, error));
      }
      return result;
    } catch (error) {
      // If this runtime build throws synchronously, preserve the abort rather than
      // surfacing a secondary message/stack formatting error to the caller.
      surfaceAbort(this, signalType, message, rawStack, error);
      return undefined;
    }
  };
  Object.defineProperty(prototype, PATCH_MARKER, { value: true, configurable: false });
  prototype.onRecvMsg = guarded;
  return true;
}
