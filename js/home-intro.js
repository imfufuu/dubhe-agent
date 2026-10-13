// 寒武 · 开场：星场跃迁 → 瞬时内爆 → 能力辐射大爆发（闪白、震动、火花碎裂、冲击波）
// → 标题慢慢浮现 → 开场层渐隐，主页同步入场。每个浏览器会话只播放一次；点击 / Esc / Enter / 空格可跳过。
import { getLanguage } from './locale.js';

const T = { IMPLODE: 880, BURST: 1480, WORD: 2480, REVEAL: 3050, FADE: 3250, END: 4450 };
const LABEL_OUT = 2700;
const CAPS = [
  ['沙箱执行', 'Sandbox'], ['工作区文件', 'Workspace files'], ['图片生成', 'Image generation'],
  ['深度思考', 'Deep reasoning'], ['网页调试', 'Web debug'], ['语音输入', 'Voice input'],
  ['长期记忆', 'Long memory'], ['选中分享', 'Share'], ['图片识别', 'Vision'], ['子代理', 'Subagents'],
];
const PALETTE = ['#a78bfa', '#67e8f9', '#f0abfc', '#fde68a', '#86efac', '#fb7185', '#f4f1ea'];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x) => Math.pow(clamp01(x), 2.2);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 内测开关：true = 每次进入导航页都播放；调试好后改为 false，恢复「每个会话只播放一次」
const INTRO_EVERY_VISIT = true;

export function shouldPlayIntro(reduce) {
  if (reduce) return false;
  if (INTRO_EVERY_VISIT) return true;
  try { return sessionStorage.getItem('dubhe-intro-seen') !== '1'; } catch { return true; }
}

export function playCambrianIntro(root = document) {
  const el = root.getElementById('intro');
  if (!el) return null;
  el.hidden = false;
  const canvas = el.querySelector('canvas');
  const word = el.querySelector('.intro-word');
  const skip = el.querySelector('.intro-skip');
  const ctx = canvas.getContext('2d');
  const en = getLanguage() === 'en';
  const html = root.documentElement;

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, maxR = 1, capRx = 1, capRy = 1;
  let raf = 0, t0 = 0, last = 0, finished = false;
  const done = { burst: false, word: false, reveal: false, fade: false };
  let flash = 0, shake = 0, stars = [], sparks = [], waves = [];

  const caps = CAPS.map(([zh, eng], i) => {
    const d = root.createElement('div');
    d.className = 'intro-cap';
    d.textContent = en ? eng : zh;
    d.style.setProperty('--c', PALETTE[i % PALETTE.length]);
    el.appendChild(d);
    return { el: d, a: (i / CAPS.length) * Math.PI * 2 - Math.PI / 2 + 0.14, start: T.BURST + 240 + i * 75 };
  });

  const layout = () => {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    cx = W / 2; cy = H / 2;
    maxR = Math.hypot(W, H) / 2;
    capRx = Math.min(W * 0.42, 560); capRy = Math.min(H * 0.36, 300);
    const n = Math.round(Math.min(340, Math.max(140, (W * H) / 4400)));
    stars = Array.from({ length: n }, () => ({
      a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.5 + Math.random() * 1.5,
      c: pick(['#ffffff', '#c4b5fd', '#67e8f9', '#f0abfc']),
    }));
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', layout);
    window.removeEventListener('keydown', onKey);
    html.classList.remove('intro-on');
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 900);
    try { sessionStorage.setItem('dubhe-intro-seen', '1'); } catch { /* 无存储时仅本页生效 */ }
  };
  const onKey = (e) => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); finish(); } };
  el.addEventListener('click', finish);
  skip.addEventListener('click', (e) => { e.stopPropagation(); finish(); });
  window.addEventListener('resize', layout);
  window.addEventListener('keydown', onKey);

  const spark = (x, y, vx, vy, o) => Object.assign(
    { x, y, px: x, py: y, vx, vy, life: 1, decay: 0.012, size: 1.6, c: '#fff', frag: false, depth: 0 }, o);

  const burst = () => {
    // 主爆：高速火花，少数会在消亡时碎裂成小火花
    for (let i = 0; i < 460; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.pow(Math.random(), 0.42) * 16 + 2.5;
      sparks.push(spark(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp * 0.86, {
        decay: rnd(0.008, 0.02), size: rnd(1.1, 3), c: pick(PALETTE), frag: Math.random() < 0.5,
      }));
    }
    // 慢速尘埃：拖出层次
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.6, 4.5);
      sparks.push(spark(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp * 0.9, {
        decay: rnd(0.004, 0.009), size: rnd(0.8, 1.6), c: pick(['#c4b5fd', '#67e8f9', '#ffffff']),
      }));
    }
    waves.push({ r: 0, v: 11, a: 0.85, w: 3.2, delay: 0 }, { r: 0, v: 6.5, a: 0.5, w: 1.6, delay: 70 });
    flash = 1; shake = 1;
  };

  const frame = (now) => {
    if (finished) return;
    if (!t0) { t0 = now; last = now; }
    const t = now - t0;
    const dt = Math.min(50, now - last);
    last = now;
    const f = dt / 16.7;

    // 残影：星场与内爆保留拖尾；爆发后拖尾更长，形成火花的光迹
    const trail = t < T.IMPLODE ? 0.34 : t < T.BURST ? 0.3 : 0.2;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(4,5,10,${trail})`;
    ctx.fillRect(-60, -60, W + 120, H + 120);

    // 震动：爆发瞬间的屏幕抖动，指数衰减
    shake *= Math.pow(0.9, f);
    if (shake > 0.01) ctx.setTransform(DPR, 0, 0, DPR, (Math.random() - 0.5) * shake * 22, (Math.random() - 0.5) * shake * 22);

    ctx.globalCompositeOperation = 'lighter';

    // 阶段 1：星场跃迁（0–880ms）
    if (t < T.IMPLODE) {
      const k = easeIn(t / T.IMPLODE);
      for (const s of stars) {
        const d = ((s.r + (t / 900) * s.s * 0.4) % 1) * maxR;
        const len = (2 + d * (0.05 + k * 0.12)) * s.s;
        const x = cx + Math.cos(s.a) * d, y = cy + Math.sin(s.a) * d;
        const x0 = cx + Math.cos(s.a) * Math.max(0, d - len), y0 = cy + Math.sin(s.a) * Math.max(0, d - len);
        ctx.strokeStyle = s.c;
        ctx.globalAlpha = clamp01(0.25 + 0.75 * (d / maxR) * (0.5 + k * 0.5));
        ctx.lineWidth = 0.6 + s.s * 0.4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      }
    }

    // 阶段 2：瞬时内爆（880–1480ms）：星体被吸向中心，核心迅速变亮
    if (t >= T.IMPLODE && t < T.BURST + 200) {
      const p = clamp01((t - T.IMPLODE) / (T.BURST - T.IMPLODE));
      const e = easeIn(p);
      for (const s of stars) {
        const d = (1 - e) * (maxR * 0.5) * s.s * 0.5 + 4;
        const ang = s.a + e * 2.2;
        const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d;
        ctx.fillStyle = s.c; ctx.globalAlpha = 0.45 + 0.55 * e;
        ctx.beginPath(); ctx.arc(x, y, 0.9 + s.s * 0.5, 0, Math.PI * 2); ctx.fill();
      }
      const coreR = 26 + 150 * e;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * e})`);
      g.addColorStop(0.25, `rgba(196,181,253,${0.55 * e})`);
      g.addColorStop(0.6, `rgba(103,232,249,${0.14 * e})`);
      g.addColorStop(1, 'rgba(4,5,10,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(i * 1.05 + t / (1400 + i * 300));
        ctx.scale(1, 0.36 + i * 0.1);
        ctx.strokeStyle = i === 1 ? `rgba(103,232,249,${0.7 * e})` : `rgba(167,139,250,${0.6 * e})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, 70 + i * 48, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    // 阶段 3：能力大爆发（1480ms 起）
    if (t >= T.BURST) {
      if (!done.burst) { done.burst = true; burst(); }
      // 核心余晖
      const q = clamp01((t - T.BURST) / 800);
      if (q < 1) {
        const r = 60 + 260 * easeOut(q);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${0.85 * (1 - q)})`);
        g.addColorStop(0.4, `rgba(196,181,253,${0.35 * (1 - q)})`);
        g.addColorStop(1, 'rgba(4,5,10,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
      // 冲击波
      for (const w of waves) {
        if (w.delay > 0) { w.delay -= dt; continue; }
        w.r += w.v * f; w.a *= Math.pow(0.965, f);
        ctx.strokeStyle = `rgba(196,181,253,${w.a})`;
        ctx.lineWidth = w.w * (1 - clamp01(w.r / maxR)) + 0.6;
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(cx, cy, w.r, 0, Math.PI * 2); ctx.stroke();
      }
      waves = waves.filter((w) => w.a > 0.01 && w.r < maxR * 1.3);
      // 火花：运动、阻尼、轻微重力；消亡时碎裂
      const born = [];
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.px = p.x; p.py = p.y;
        const drag = p.depth ? 0.93 : 0.972;
        p.vx *= Math.pow(drag, f); p.vy *= Math.pow(drag, f);
        p.vy += 0.03 * f;
        p.x += p.vx * f; p.y += p.vy * f;
        p.life -= p.decay * f;
        const a = clamp01(p.life);
        ctx.globalAlpha = a; ctx.strokeStyle = p.c; ctx.lineWidth = p.size * (0.4 + a);
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = a * 0.9; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2); ctx.fill();
        if (p.life <= 0 || p.x < -80 || p.x > W + 80 || p.y < -80 || p.y > H + 80) {
          if (p.frag && !p.spawned && p.depth === 0) {
            p.spawned = true;
            for (let k = 0; k < 5; k++) {
              const a2 = Math.random() * Math.PI * 2, sp = rnd(1, 4.2);
              born.push(spark(p.x, p.y, Math.cos(a2) * sp + p.vx * 0.2, Math.sin(a2) * sp + p.vy * 0.2,
                { decay: rnd(0.03, 0.05), size: rnd(0.8, 1.6), c: p.c, depth: 1 }));
            }
          }
          sparks.splice(i, 1);
        }
      }
      if (born.length) sparks.push(...born);
      if (sparks.length > 1400) sparks.splice(0, sparks.length - 1400);
      // 闪白：一层很淡的白光，衰减快
      flash *= Math.pow(0.9, f);
      if (flash > 0.01) {
        ctx.globalAlpha = 1; ctx.fillStyle = `rgba(236,232,255,${flash * 0.3})`;
        ctx.fillRect(-60, -60, W + 120, H + 120);
      }
    }

    // 能力标签：DOM 文字层（不拖尾），并连接到核心
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const fadeCaps = clamp01((t - LABEL_OUT) / 500);
    caps.forEach((c) => {
      const p = clamp01((t - c.start) / 700);
      if (p <= 0) return;
      const e = easeOut(p);
      const x = cx + Math.cos(c.a) * capRx * e, y = cy + Math.sin(c.a) * capRy * e;
      const right = x >= cx;
      c.el.style.transform = `translate(${x}px, ${y}px) translate(${right ? '14px' : 'calc(-100% - 14px)'}, -50%)`;
      c.el.style.opacity = String(Math.max(0, p * (1 - fadeCaps)));
      ctx.globalAlpha = 0.22 * p * (1 - fadeCaps);
      ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    });

    // 阶段节点：标题浮现 → 主页入场 → 开场层渐隐
    if (!done.word && t >= T.WORD) { done.word = true; word.classList.add('show'); }
    if (!done.reveal && t >= T.REVEAL) { done.reveal = true; html.classList.remove('intro-on'); }
    if (!done.fade && t >= T.FADE) { done.fade = true; el.classList.add('fading'); }
    if (t >= T.END) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };

  html.classList.add('intro-on');
  raf = requestAnimationFrame(frame);
  layout();
  return { finish };
}
