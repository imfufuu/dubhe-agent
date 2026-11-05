// Smooth unusually large gateway text deltas without delaying network reads. All events
// behind a text delta stay ordered; normal token-sized deltas pass through immediately.
export function createStreamSmoother(emit, { signal, intervalMs = 40, maxDelayMs = 4000, threshold = 80, now = () => Date.now(), schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let queue = [], timer = null, deadline = 0, error = null, cancelled = false;
  const waiters = [];
  const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
  function settle() {
    if (queue.length && !error && !cancelled) return;
    while (waiters.length) {
      const { resolve, reject } = waiters.shift();
      if (cancelled) reject(abortError()); else if (error) reject(error); else resolve();
    }
  }
  function clearTimer() { if (timer != null) { unschedule(timer); timer = null; } }
  function cancel() { cancelled = true; clearTimer(); queue = []; settle(); }
  if (signal) {
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }
  function deliver(ev) {
    try { emit(ev); } catch (e) { error = e; clearTimer(); queue = []; }
  }
  function take(text, count) {
    let end = Math.min(text.length, count);
    if (end < text.length && end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end++;
    return end;
  }
  function pump(force = false) {
    clearTimer();
    while (queue.length && !cancelled && !error) {
      const ev = queue[0];
      if (ev.type !== 'text' || !ev.text) { queue.shift(); deliver(ev); continue; }
      if (force) { queue.shift(); deliver(ev); continue; }
      const remaining = queue.reduce((n, item) => n + (item.type === 'text' ? (item.text || '').length : 0), 0);
      const ticks = Math.max(1, Math.ceil((deadline - now()) / intervalMs));
      const count = take(ev.text, Math.max(4, Math.ceil(remaining / ticks)));
      const chunk = ev.text.slice(0, count);
      if (count >= ev.text.length) queue.shift(); else queue[0] = { ...ev, text: ev.text.slice(count) };
      deliver({ ...ev, text: chunk });
      if (queue.length && !error) { timer = schedule(() => pump(), intervalMs); return; }
    }
    deadline = 0;
    settle();
  }
  return {
    push(ev) {
      if (cancelled) return;
      if (error) throw error;
      if (!queue.length && !(ev?.type === 'text' && typeof ev.text === 'string' && ev.text.length > threshold)) {
        emit(ev);
        return;
      }
      queue.push(ev);
      if (timer == null) { deadline = now() + maxDelayMs; pump(); }
    },
    finish() {
      if (cancelled) return Promise.reject(abortError());
      if (error) return Promise.reject(error);
      if (!queue.length) return Promise.resolve();
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    flush() { if (!cancelled && !error) pump(true); if (error) throw error; },
    dispose() { clearTimer(); queue = []; if (signal) signal.removeEventListener('abort', cancel); settle(); },
  };
}
