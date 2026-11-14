// Dubhe Agent · 防人机（第 11 条）
// 中继（Cloudflare Worker）启用 Turnstile 时，受保护接口在缺少有效通行证时返回
// 403 + challenge=turnstile。这里弹出 Turnstile 组件，换到通行证后自动重试一次；
// 通行证只存内存，约 30 分钟有效。中继未启用防人机时，本模块完全透明：不改请求、不弹窗。
//
// 2026-11-14：验证期间暂停任务计时（等待人机验证不算任务耗时）；widget 初始化失败（300010 等）
// 自动退避重试，并把错误码翻译成用户能照做的原因，而不是把裸数字丢在对话框里。
import { text as localeText } from './locale.js';
import { pauseTaskClock, resumeTaskClock } from './task-clock.js';
// HANDSHAKE 是「人在验证」这一暂停原因，与执行内核确认用的 'confirm' 分开计数。
const PAUSE_REASON = 'human';

const PASS_HEADER = 'x-dubhe-human';
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__dubheTurnstileReady';
const REFRESH_MARGIN_MS = 60_000;
// widget 建不起来时的退避重试：300010 常见于瞬时执行失败 / 隐私扩展拦脚本，重画往往就好了。
const RENDER_RETRY_DELAYS_MS = [400, 1200];
const SCRIPT_TIMEOUT_MS = 15_000;

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

/** 中继是否启用了防人机；拿不到状态时返回 null（调用方按「未知」处理，不做任何假设）。 */
export async function humanChallengeConfig(origin) {
  try {
    const res = await fetch(`${origin}/api/human/config`);
    if (!res.ok) return null;
    const body = await res.json();
    return { required: !!body.required, siteKey: String(body.siteKey || '') };
  } catch { return null; }
}

function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TURNSTILE_SCRIPT;
      s.async = true;
      s.onerror = () => { scriptPromise = null; reject(new Error('turnstile-script-load-failed')); };
      // api.js 带 onload=... 时由它回调：脚本执行完才会调用，早于 ready 的 render 会得到 300010。
      const settle = () => {
        const api = globalThis.turnstile;
        if (!api) { reject(new Error('turnstile-api-missing')); return; }
        if (typeof api.ready === 'function') api.ready(() => resolve());
        else resolve();
      };
      globalThis.__dubheTurnstileReady = settle;
      s.addEventListener('load', () => { if (!globalThis.turnstile) return; settle(); }, { once: true });
      const timer = setTimeout(() => { scriptPromise = null; reject(new Error('turnstile-script-timeout')); }, SCRIPT_TIMEOUT_MS);
      const done = () => clearTimeout(timer);
      s.addEventListener('load', done, { once: true });
      s.addEventListener('error', done, { once: true });
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/**
 * Turnstile 客户端错误码 → 用户能照做的说明。
 * 300xxx/600xxx 是族编号：300 段是 widget 建不起来（站点密钥、域名白名单、脚本被拦、瞬时故障），
 * 600 段是挑战本身没通过。110200 是本项目网页域名没加进 Turnstile 的 Hostname Management。
 */
export function turnstileErrorHint(code, hostname = '') {
  const c = String(code || '');
  if (c === '110200') {
    // 110200 只说明「当前网页域名不在白名单」，必须点名域名，否则用户不知道该加哪一个。
    const host = hostname || (globalThis.location && globalThis.location.hostname) || 'localhost';
    return localeText(`当前网页域名 ${host} 未获 Turnstile 授权：请把该域名加入站点密钥的 Hostname Management（只加中继域名不够）。`, `This page hostname ${host} is not allowed by the Turnstile sitekey. Add it in Hostname Management, not just the relay domain.`);
  }
  if (/^100/.test(c)) {
    return localeText(`站点密钥无效或不完整（${c}）：请核对中继里的 TURNSTILE_SITE_KEY。`, `Invalid or incomplete sitekey (${c}). Check TURNSTILE_SITE_KEY on the relay.`);
  }
  if (/^300/.test(c)) {
    return localeText(`验证组件未能初始化（${c}）：常见原因是隐私扩展/代理拦了 challenges.cloudflare.com、脚本被延迟执行，或 Cloudflare 瞬时故障。可重试、换无痕窗口或暂时关闭拦截扩展。`, `The widget could not initialize (${c}). Usually a privacy extension or proxy blocking challenges.cloudflare.com, delayed scripts, or a transient Cloudflare issue. Retry, use a private window, or disable blocker extensions.`);
  }
  if (/^600/.test(c)) {
    return localeText(`挑战未通过（${c}）：网络环境被判定为风险。可稍后重试或更换网络。`, `The challenge was not passed (${c}). The network looked risky; retry later or switch networks.`);
  }
  return localeText(`验证组件出错${c ? `（${c}）` : ''}：请检查网络后重试。`, `Verification widget error${c ? ` (${c})` : ''}. Check the network and retry.`);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 弹出 Turnstile 对话框；返回通行证字符串，用户取消或失败返回 ''。同一时间只允许一个对话框。 */
export function solveHumanChallenge({ origin, siteKey, signal } = {}) {
  if (pending) return pending;
  if (signal && signal.aborted) return Promise.resolve('');
  // 人在验证：任务计时从这一刻暂停，关掉对话框（成功/取消/失败）立刻恢复。
  pauseTaskClock(PAUSE_REASON);
  pending = new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'human-check';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const card = document.createElement('div');
    card.className = 'human-check-card';
    const title = document.createElement('p');
    title.className = 'human-check-title';
    title.textContent = localeText('请完成人机验证', 'Complete the human check');
    const hint = document.createElement('p');
    hint.className = 'human-check-hint';
    hint.textContent = localeText('中继为防滥用启用了验证。完成一次后约 30 分钟内无需再次验证；验证期间任务计时暂停。', 'The relay enables verification to prevent abuse. One pass lasts about 30 minutes, and task timing is paused while you verify.');
    const box = document.createElement('div');
    box.className = 'human-check-widget';
    // 0×0 容器会让 widget 建不起来（也是 300010 的一种来源），先给最小可交互尺寸。
    box.style.minWidth = '300px';
    box.style.minHeight = '65px';
    const status = document.createElement('p');
    status.className = 'human-check-status';
    status.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'human-check-retry';
    retry.textContent = localeText('重新验证', 'Retry verification');
    retry.hidden = true;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'human-check-cancel';
    cancel.textContent = localeText('取消', 'Cancel');
    card.append(title, hint, box, status, retry, cancel);
    overlay.append(card);

    let widgetId = null;
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      try { if (widgetId != null && globalThis.turnstile) globalThis.turnstile.remove(widgetId); } catch { /* noop */ }
      overlay.remove();
      pending = null;
      resumeTaskClock(PAUSE_REASON);
      resolve(value || '');
    };
    cancel.addEventListener('click', () => { try { globalThis.dispatchEvent?.(new CustomEvent('dubhe:turnstile-cancelled')); } catch { /* noop */ } finish(''); });
    if (signal) signal.addEventListener('abort', () => finish(''), { once: true });
    document.body.appendChild(overlay);

    const render = (attempt) => {
      if (finished) return;
      try { if (widgetId != null && globalThis.turnstile) globalThis.turnstile.remove(widgetId); } catch { /* noop */ }
      widgetId = globalThis.turnstile.render(box, {
        sitekey: siteKey,
        theme: 'auto',
        callback: (token) => {
          status.textContent = localeText('校验中…', 'Verifying…');
          verifyToken(origin, token).then((pass) => {
            if (pass) finish(pass);
            else {
              status.textContent = localeText('验证未通过，请重试', 'Verification failed, please retry');
              retry.hidden = false;
              try { globalThis.turnstile.reset(widgetId); } catch { /* noop */ }
            }
          }, () => {
            status.textContent = localeText('校验请求失败，请重试', 'Verification request failed, please retry');
            retry.hidden = false;
            try { globalThis.turnstile.reset(widgetId); } catch { /* noop */ }
          });
        },
        'error-callback': (code) => {
          const msg = turnstileErrorHint(code, globalThis.location?.hostname || '');
          // 300010 等「建不起来」的失败先自动重画，重画仍失败才把选择交给用户。
          if (attempt < RENDER_RETRY_DELAYS_MS.length && /^[36]00/.test(String(code || ''))) {
            status.textContent = localeText(`验证组件暂时不可用（${code}），正在自动重试…`, `Widget temporarily unavailable (${code}), retrying…`);
            sleep(RENDER_RETRY_DELAYS_MS[attempt]).then(() => render(attempt + 1));
            return true;
          }
          status.textContent = msg;
          retry.hidden = false;
          return true; // 错误已在对话框里如实呈现，不留未处理异常
        },
        'expired-callback': () => { try { globalThis.turnstile.reset(widgetId); } catch { /* noop */ } },
      });
    };
    retry.addEventListener('click', () => { retry.hidden = true; status.textContent = ''; render(0); });

    loadTurnstile().then(() => render(0)).catch((err) => {
      status.textContent = String(err && err.message) === 'turnstile-script-timeout'
        ? localeText('验证组件加载超时：请检查网络或安全软件后点「重新验证」。', 'The verification script timed out. Check the network or security software, then retry.')
        : localeText('无法加载验证组件：可能被隐私扩展或网络策略拦截。可换无痕窗口或关闭拦截后重试。', 'The verification script could not load. A privacy extension or network policy may be blocking it; try a private window or disable blockers.');
      retry.hidden = false;
    });
  });
  return pending;
}
