// 寒武 · 开场：星场跃迁 → 内爆 → 能力辐射大爆发（闪光、震动、火花碎裂、冲击波）→ 标题浮现
// → 开场层完全淡出后，主页内容才开始加载入场。配套音效：assets/audio/cambrian-intro.wav（同步于爆发时刻）。
import { getLanguage } from './locale.js';

// 内测开关：true = 每次进入导航页都播放；调试好后改为 false，恢复「每个会话只播放一次」
const INTRO_EVERY_VISIT = false;
const SFX_SRC = 'assets/audio/cambrian-intro.wav';

// 时间线（毫秒）。爆发与音效的重击同在 1150ms。
const T = { IMPLODE: 700, BURST: 1150, WORD: 1900, LABEL_OUT: 2550, FADE: 2900, END: 3500 };
const CAPS = [
  ['沙箱执行', 'Sandbox'], ['工作区文件', 'Workspace files'], ['图片生成', 'Image generation'],
  ['深度思考', 'Deep reasoning'], ['网页调试', 'Web debug'], ['语音输入', 'Voice input'],
  ['长期记忆', 'Long memory'], ['选中分享', 'Share'], ['图片识别', 'Vision'], ['子代理', 'Subagents'],
];
// 克制的高级色板：冷白、薰衣草、冰蓝、香槟金
const PALETTE = ['233,228,255', '196,181,253', '125,211,252', '245,230,200'];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x) => Math.pow(clamp01(x), 2.2);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function shouldPlayIntro(reduce) {
  if (reduce) return false;
  if (INTRO_EVERY_VISIT) return true;
  try { return sessionStorage.getItem('dubhe-intro-seen') !== '1'; } catch { return true; }
}

// 发光精灵图：离屏预渲染一次，爆发时用 drawImage 叠加，比逐帧 shadowBlur 便宜得多
function makeSprite(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.16, `rgba(${rgb},0.95)`);
  gr.addColorStop(0.45, `rgba(${rgb},0.22)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
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
  const sprites = PALETTE.map(makeSprite);

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, maxR = 1, capRx = 1, capRy = 1;
  let raf = 0, t0 = 0, last = 0, finished = false;
  const done = { burst: false, word: false, fade: false };
  let flash = 0, shake = 0, stars = [], sparks = [], waves = [], streak = 0;

  // 音效：与视觉同时起播；若浏览器拦截自动播放，则在用户第一次操作时补播（从头开始）
  const sfx = new Audio(SFX_SRC);
  sfx.preload = 'auto';
  sfx.volume = 0.9;
  const playSfx = () => { try { sfx.currentTime = 0; const p = sfx.play(); if (p && p.catch) p.catch(() => armGesture()); } catch { /* 无音频环境 */ } };
  const armGesture = () => {
    const go = () => { playSfx(); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
    window.addEventListener('pointerdown', go, { once: false });
    window.addEventListener('keydown', go, { once: false });
  };

  const caps = CAPS.map(([zh, eng], i) => {
    const d = root.createElement('div');
    d.className = 'intro-cap';
    d.textContent = en ? eng : zh;
    d.style.setProperty('--c', PALETTE[i % PALETTE.length]);
    el.appendChild(d);
    return { el: d, a: (i / CAPS.length) * Math.PI * 2 - Math.PI / 2 + 0.14, start: T.BURST + 170 + i * 55 };
  });

  const layout = () => {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    cx = W / 2; cy = H / 2;
    maxR = Math.hypot(W, H) / 2;
    capRx = Math.min(W * 0.42, 560); capRy = Math.min(H * 0.36, 300);
    const n = Math.round(Math.min(300, Math.max(120, (W * H) / 4800)));
    stars = Array.from({ length: n }, () => ({
      a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.5 + Math.random() * 1.5, c: pick(PALETTE),
    }));
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', layout);
    window.removeEventListener('keydown', onKey);
    try { sfx.pause(); } catch { /* ignore */ }
    html.classList.remove('intro-on');   // 主页入场动画只在开场完全结束后开始
    el.remove();
    try { sessionStorage.setItem('dubhe-intro-seen', '1'); } catch { /* 无存储时仅本页生效 */ }
  };
  const onKey = (e) => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); finish(); } };
  el.addEventListener('click', finish);
  skip.addEventListener('click', (e) => { e.stopPropagation(); finish(); });
  window.addEventListener('resize', layout);
  window.addEventListener('keydown', onKey);

  const spark = (x, y, vx, vy, o) => Object.assign(
    { x, y, px: x, py: y, vx, vy, life: 1, decay: 0.012, size: 1.6, c: PALETTE[0], frag: false, depth: 0 }, o);

  const burst = () => {
    // 主爆：高速火花（一半会碎裂），外层慢速尘埃
    for (let i = 0; i < 380; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.pow(Math.random(), 0.42) * 17 + 3;
      sparks.push(spark(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp * 0.86, {
        decay: rnd(0.009, 0.02), size: rnd(1.0, 2.6), c: pick(PALETTE), frag: Math.random() < 0.5,
      }));
    }
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.5, 4.2);
      sparks.push(spark(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp * 0.9, {
        decay: rnd(0.0045, 0.01), size: rnd(0.7, 1.4), c: pick(PALETTE),
      }));
    }
    waves.push({ r: 0, v: 12, a: 0.7, w: 1.6, delay: 0 }, { r: 0, v: 7, a: 0.38, w: 1, delay: 90 });
    flash = 1; shake = 1; streak = 1;
  };

  const frame = (now) => {
    if (finished) return;
    if (!t0) { t0 = now; last = now; }
    const t = now - t0;
    const dt = Math.min(50, now - last);
    last = now;
    const f = dt / 16.7;

    // 残影底色：星场与内爆保留较长拖尾；爆发后拖尾略短，保持清晰
    const trail = t < T.IMPLODE ? 0.34 : t < T.BURST ? 0.28 : 0.2;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(4,5,10,${trail})`;
    ctx.fillRect(-60, -60, W + 120, H + 120);

    // 震动：爆发瞬间的屏幕抖动，快速衰减
    shake *= Math.pow(0.86, f);
    if (shake > 0.01) ctx.setTransform(DPR, 0, 0, DPR, (Math.random() - 0.5) * shake * 16, (Math.random() - 0.5) * shake * 16);

    ctx.globalCompositeOperation = 'lighter';

    // 阶段 1：星场跃迁（0–700ms）
    if (t < T.IMPLODE) {
      const k = easeIn(t / T.IMPLODE);
      for (const s of stars) {
        const d = ((s.r + (t / 900) * s.s * 0.4) % 1) * maxR;
        const len = (2 + d * (0.05 + k * 0.12)) * s.s;
        const x = cx + Math.cos(s.a) * d, y = cy + Math.sin(s.a) * d;
        const x0 = cx + Math.cos(s.a) * Math.max(0, d - len), y0 = cy + Math.sin(s.a) * Math.max(0, d - len);
        ctx.strokeStyle = `rgba(${s.c},${clamp01(0.25 + 0.75 * (d / maxR) * (0.5 + k * 0.5))})`;
        ctx.lineWidth = 0.6 + s.s * 0.4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      }
    }

    // 阶段 2：内爆（700–1150ms）：星体被吸入，核心迅速变亮，轨道环显现
    if (t >= T.IMPLODE && t < T.BURST + 150) {
      const p = clamp01((t - T.IMPLODE) / (T.BURST - T.IMPLODE));
      const e = easeIn(p);
      for (const s of stars) {
        const d = (1 - e) * (maxR * 0.5) * s.s * 0.5 + 4;
        const ang = s.a + e * 2.2;
        const x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d;
        ctx.globalAlpha = 0.45 + 0.55 * e;
        ctx.drawImage(sprites[0], x - 6, y - 6, 12, 12);
      }
      ctx.globalAlpha = 1;
      const coreR = 24 + 160 * e;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * e})`);
      g.addColorStop(0.3, `rgba(196,181,253,${0.4 * e})`);
      g.addColorStop(1, 'rgba(4,5,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(i * 1.05 + t / (1400 + i * 300));
        ctx.scale(1, 0.36 + i * 0.1);
        ctx.strokeStyle = i === 1 ? `rgba(125,211,252,${0.55 * e})` : `rgba(196,181,253,${0.5 * e})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.arc(0, 0, 70 + i * 48, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    // 阶段 3：能力大爆发（1150ms 起）
    if (t >= T.BURST) {
      if (!done.burst) { done.burst = true; burst(); }
      // 核心余晖
      const q = clamp01((t - T.BURST) / 700);
      if (q < 1) {
        const r = 50 + 260 * easeOut(q);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${0.8 * (1 - q)})`);
        g.addColorStop(0.4, `rgba(196,181,253,${0.3 * (1 - q)})`);
        g.addColorStop(1, 'rgba(4,5,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }
      // 水平光带：镜头式横向划过
      if (streak > 0.01) {
        const sg = ctx.createLinearGradient(0, cy, W, cy);
        sg.addColorStop(0, 'rgba(255,255,255,0)');
        sg.addColorStop(0.5, `rgba(233,228,255,${0.5 * streak})`);
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(0, cy - 0.6 - 2 * streak, W, 1.2 + 4 * streak);
        streak *= Math.pow(0.9, f);
      }
      // 冲击波
      for (const w of waves) {
        if (w.delay > 0) { w.delay -= dt; continue; }
        w.r += w.v * f; w.a *= Math.pow(0.965, f);
        ctx.strokeStyle = `rgba(196,181,253,${w.a})`;
        ctx.lineWidth = w.w * (1 - clamp01(w.r / maxR)) + 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, w.r, 0, Math.PI * 2); ctx.stroke();
      }
      waves = waves.filter((w) => w.a > 0.01 && w.r < maxR * 1.3);
      // 火花：阻尼、轻微重力，尾迹 + 精灵图光点；消亡时碎裂
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
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = `rgba(${p.c},1)`; ctx.lineWidth = p.size * (0.3 + a * 0.5);
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
        const R = p.size * 3.4;
        ctx.globalAlpha = a;
        ctx.drawImage(sprites[PALETTE.indexOf(p.c)] || sprites[0], p.x - R, p.y - R, R * 2, R * 2);
        if (p.life <= 0 || p.x < -80 || p.x > W + 80 || p.y < -80 || p.y > H + 80) {
          if (p.frag && !p.spawned && p.depth === 0) {
            p.spawned = true;
            for (let k = 0; k < 5; k++) {
              const a2 = Math.random() * Math.PI * 2, sp = rnd(1, 4.2);
              born.push(spark(p.x, p.y, Math.cos(a2) * sp + p.vx * 0.2, Math.sin(a2) * sp + p.vy * 0.2,
                { decay: rnd(0.03, 0.05), size: rnd(0.7, 1.4), c: p.c, depth: 1 }));
            }
          }
          sparks.splice(i, 1);
        }
      }
      if (born.length) sparks.push(...born);
      if (sparks.length > 1200) sparks.splice(0, sparks.length - 1200);
      // 闪光：很淡的冷白光，衰减快
      flash *= Math.pow(0.88, f);
      if (flash > 0.01) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(236,232,255,${flash * 0.22})`;
        ctx.fillRect(-60, -60, W + 120, H + 120);
      }
    }

    // 能力标签：DOM 文字层（不拖尾），并以细线连到核心
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    const outK = clamp01((t - T.LABEL_OUT) / 400);
    caps.forEach((c) => {
      const p = clamp01((t - c.start) / 600);
      if (p <= 0) return;
      const e = easeOut(p);
      const x = cx + Math.cos(c.a) * capRx * e, y = cy + Math.sin(c.a) * capRy * e;
      const right = x >= cx;
      c.el.style.transform = `translate(${x}px, ${y}px) translate(${right ? '14px' : 'calc(-100% - 14px)'}, -50%)`;
      c.el.style.opacity = String(Math.max(0, p * (1 - outK)));
      ctx.globalAlpha = 0.18 * p * (1 - outK);
      ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    });

    // 节奏：标题浮现 → 开场层淡出 → 完全结束后主页入场
    if (!done.word && t >= T.WORD) { done.word = true; word.classList.add('show'); }
    if (!done.fade && t >= T.FADE) { done.fade = true; el.classList.add('fading'); }
    if (t >= T.END) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };

  html.classList.add('intro-on');
  playSfx();
  raf = requestAnimationFrame(frame);
  layout();
  return { finish };
}
