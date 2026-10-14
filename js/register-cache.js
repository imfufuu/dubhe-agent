// Stable entry shared by app, homepage and docs. A waiting update must not
// silently replace modules underneath running agents or open editing panels.
const base = new URL('../', import.meta.url);
let registration;
function showWaitingUpdate() {
  if (document.getElementById('cache-update-note')) return;
  const en = document.documentElement.lang?.startsWith('en');
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet'; sheet.href = new URL('css/cache-notice.css', base).href;
  document.head.append(sheet);
  const note = document.createElement('aside');
  note.id = 'cache-update-note'; note.className = 'cache-update-note';
  note.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = en
    ? 'Update downloaded. Finish your work, then close all app tabs and reopen to use it. Your current task will not be interrupted.'
    : '更新已下载。请先完成当前任务，再关闭本应用的所有标签页并重新打开。当前任务不会被打断。';
  const close = document.createElement('button'); close.type = 'button';
  close.textContent = en ? 'Got it' : '知道了';
  close.addEventListener('click', () => note.remove());
  note.append(text, close); document.body.append(note);
}
export function registerOfflineCache() {
  if (registration) return registration;
  try {
    if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) return Promise.resolve(null);
    registration = navigator.serviceWorker.register(new URL('sw.js', base).href, { scope: base.href, updateViaCache: 'none' }).then(reg => {
      const watch = worker => {
        if (!worker) return;
        const check = () => { if (worker.state === 'installed' && reg.waiting && navigator.serviceWorker.controller) showWaitingUpdate(); };
        worker.addEventListener('statechange', check); check();
      };
      if (reg.waiting && navigator.serviceWorker.controller) showWaitingUpdate();
      watch(reg.installing); reg.addEventListener('updatefound', () => watch(reg.installing));
      // Worker-version check is small; cached static files themselves make zero requests.
      reg.update().catch(() => {});
      return reg;
    }).catch(() => null); // no manifest / private mode must not block app boot
    return registration;
  } catch { return Promise.resolve(null); }
}
