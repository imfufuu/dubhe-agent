// Dubhe Agent · 防人机（第 11 条）
// 中继（Cloudflare Worker）启用 Turnstile 时，受保护接口在缺少有效通行证时返回
// 403 + challenge=turnstile。这里弹出 Turnstile 组件，换到通行证后自动重试一次；
// 通行证只存内存，约 30 分钟有效。中继未启用防人机时，本模块完全透明：不改请求、不弹窗。

const PASS_HEADER = 'x-dubhe-human';
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const REFRESH_MARGIN_MS = 60_000;

let cached = null; // { pass, exp }  exp 为秒级时间戳
let pending = null;
let scriptPromise = null;

export function humanPassFresh(nowMs = Date.now()) {
  return cached && cached.exp * 1000 - nowMs > REFRESH_MARGIN_MS ? cached.pass : '';
}

export function withHumanPass(init = {}, pass = humanPassFresh()) {
  if (!pass) return init;
  return { ...init, headers: { ...(init.headers || {}), [PASS_HEADER]: pass } };
}

/** 中继请求的统一入口：带上已有通行证；收到 turnstile 挑战时弹窗、拿到通行证后重试一次。 */
export async function fetchRelay(url, init = {}) {
  const first = await fetch(url, withHumanPass(init));
  if (first.status !== 403) return first;
  const info = await first.clone().json().catch(() => null);
  if (!info || info.challenge !== 'turnstile' || !info.siteKey) return first;
  cached = null;
  const origin = new URL(url, globalThis.location ? globalThis.location.href : 'http://localhost').origin;
  const pass = await solveHumanChallenge({ origin, siteKey: info.siteKey, signal: init.signal });
  if (!pass) return first;
  return fetch(url, withHumanPass(init, pass));
}

function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TURNSTILE_SCRIPT;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error('Turnstile 脚本加载失败')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

async function verifyToken(origin, token) {
  const res = await fetch(`${origin}/api/human/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.pass) return '';
  cached = { pass: String(body.pass), exp: Number(body.exp) || 0 };
  return cached.pass;
}

/** 弹出 Turnstile 对话框；返回通行证字符串，用户取消或失败返回 ''。同一时间只允许一个对话框。 */
export function solveHumanChallenge({ origin, siteKey, signal } = {}) {
  if (pending) return pending;
  if (signal && signal.aborted) return Promise.resolve('');
  pending = new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'human-check';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const card = document.createElement('div');
    card.className = 'human-check-card';
    const title = document.createElement('p');
    title.className = 'human-check-title';
    title.textContent = '请完成人机验证';
    const hint = document.createElement('p');
    hint.className = 'human-check-hint';
    hint.textContent = '中继为防滥用启用了验证。完成一次后约 30 分钟内无需再次验证。';
    const box = document.createElement('div');
    box.className = 'human-check-widget';
    const status = document.createElement('p');
    status.className = 'human-check-status';
    status.setAttribute('aria-live', 'polite');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'human-check-cancel';
    cancel.textContent = '取消';
    card.append(title, hint, box, status, cancel);
    overlay.append(card);

    let widgetId = null;
    const finish = (value) => {
      try { if (widgetId != null && globalThis.turnstile) globalThis.turnstile.remove(widgetId); } catch { /* noop */ }
      overlay.remove();
      pending = null;
      resolve(value || '');
    };
    cancel.addEventListener('click', () => finish(''));
    if (signal) {
      signal.addEventListener('abort', () => finish(''), { once: true });
    }
    document.body.appendChild(overlay);
    loadTurnstile().then(() => {
      widgetId = globalThis.turnstile.render(box, {
        sitekey: siteKey,
        theme: 'auto',
        callback: (token) => {
          status.textContent = '校验中…';
          verifyToken(origin, token).then((pass) => {
            if (pass) finish(pass);
            else { status.textContent = '验证未通过，请重试'; globalThis.turnstile.reset(widgetId); }
          }, () => { status.textContent = '校验请求失败，请重试'; globalThis.turnstile.reset(widgetId); });
        },
        'error-callback': () => { status.textContent = '验证组件出错，请检查网络后重试'; },
        'expired-callback': () => { try { globalThis.turnstile.reset(widgetId); } catch { /* noop */ } },
      });
    }).catch(() => { status.textContent = '无法加载验证组件，请检查网络'; });
  });
  return pending;
}

