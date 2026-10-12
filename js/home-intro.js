// 寒武 · 开场动画：星场跃迁 → 轨道汇聚 → 能力大爆发（寒武纪式辐射） → 收束进入主页
// 每个浏览器会话只播放一次；点击 / Esc / Enter / 空格 可跳过；减少动态效果时不播放。
import { getLanguage } from './locale.js';

const DURATION = 4600;
const LEAVE_AT = 3900;
const BURST_AT = 2200;
const WORD_AT = 2350;
const CAPS = [
  ['沙箱执行', 'Sandbox'], ['工作区文件', 'Workspace files'], ['图片生成', 'Image generation'],
  ['深度思考', 'Deep reasoning'], ['网页调试', 'Web debug'], ['语音输入', 'Voice input'],
  ['长期记忆', 'Long memory'], ['选中分享', 'Share'], ['图片识别', 'Vision'], ['子代理', 'Subagents'],
];
const BURST_COLORS = ['#a78bfa', '#67e8f9', '#f0abfc', '#fde68a', '#86efac', '#f4f1ea'];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x) => Math.pow(clamp01(x), 2.4);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function shouldPlayIntro(reduce) {
  if (reduce) return false;
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

  let W = 0, H = 0, DPR = 1, raf = 0, t0 = 0, finished = false, burst = false, wordShown = false, leaving = false;
  const stars = [];
  const sparks = [];
  const caps = CAPS.map(([zh, eng], i) => ({ text: en ? eng : zh, a: (i / CAPS.length) * Math.PI * 2 - Math.PI / 2 + 0.12 }));

  const resize = () => {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  };
  resize();
  const N = Math.round(Math.min(360, Math.max(140, (W * H) / 4200)));
  for (let i = 0; i < N; i++) {
    stars.push({ a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.5 + Math.random() * 1.5, c: pick(['#ffffff', '#c4b5fd', '#67e8f9', '#f0abfc']) });
  }
  const maxR = Math.hypot(W, H) / 2;
  const capRx = Math.min(W * 0.4, 540), capRy = Math.min(H * 0.34, 300);

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKey);
    el.classList.add('leaving');
    html.classList.remove('intro-on');
    setTimeout(() => { el.hidden = true; el.remove(); }, 800);
    try { sessionStorage.setItem('dubhe-intro-seen', '1'); } catch { /* 无存储时仅本页生效 */ }
  };
  const onKey = (e) => {
    if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); finish(); }
  };
  el.addEventListener('click', finish);
  skip.addEventListener('click', (e) => { e.stopPropagation(); finish(); });
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKey);

  const spawnBurst = () => {
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1.2 + Math.random() * 6.5;
      sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.82, life: 0.6 + Math.random() * 0.4, c: pick(BURST_COLORS), r: 0.8 + Math.random() * 2 });
    }
  };

  const frame = (now) => {
    if (finished) return;
    if (!t0) t0 = now;
    const t = now - t0;
    const cx = W / 2, cy = H / 2;

    // 残影：星场与爆发阶段保留拖尾
    // 仅星场跃迁保留拖尾；汇聚与爆发阶段整屏清除，避免冲击波与标签残影
    ctx.fillStyle = t < 1100 ? 'rgba(4,5,10,0.32)' : '#04050a';
    ctx.fillRect(0, 0, W, H);

    // 阶段 1：星场跃迁（0–1100ms）
    if (t < 1100) {
      const k = easeIn(t / 1100);
      for (const s of stars) {
        const d = (((s.r + (t / 900) * s.s * 0.35) % 1)) * maxR;
        const len = (2 + d * 0.08) * s.s;
        const x = cx + Math.cos(s.a) * d, y = cy + Math.sin(s.a) * d;
        const x0 = cx + Math.cos(s.a) * Math.max(0, d - len), y0 = cy + Math.sin(s.a) * Math.max(0, d - len);
        ctx.strokeStyle = s.c;
        ctx.globalAlpha = 0.25 + 0.75 * (d / maxR) * (0.4 + k * 0.6);
        ctx.lineWidth = 0.6 + s.s * 0.4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 阶段 2：轨道汇聚（1100–2200ms）：星体向中心收拢，轨道环旋转显现
    if (t >= 1100 && t < BURST_AT + 300) {
      const p = clamp01((t - 1100) / 1100);
      const e = easeOut(p);
      for (const s of stars) {
        const d = (1 - e) * s.s * 160 + 6 + Math.abs(Math.sin(t / 300 + s.a)) * 10 * (1 - e);
        const x = cx + Math.cos(s.a + e * 1.4) * d, y = cy + Math.sin(s.a + e * 1.4) * d * 0.9;
        ctx.fillStyle = s.c; ctx.globalAlpha = 0.5 + 0.5 * e;
        ctx.beginPath(); ctx.arc(x, y, 0.9 + s.s * 0.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // 核心辉光
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 140 + 80 * e);
      glow.addColorStop(0, `rgba(196,181,253,${0.55 * e})`);
      glow.addColorStop(0.5, `rgba(103,232,249,${0.15 * e})`);
      glow.addColorStop(1, 'rgba(4,5,10,0)');
      ctx.fillStyle = glow; ctx.fillRect(cx - 300, cy - 300, 600, 600);
      // 三道倾斜轨道环
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(i * 1.05 + t / (2600 + i * 500));
        ctx.scale(1, 0.36 + i * 0.1);
        ctx.strokeStyle = i === 1 ? `rgba(103,232,249,${0.6 * e})` : `rgba(167,139,250,${0.55 * e})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 70 + i * 46, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    // 阶段 3：寒武纪式能力大爆发（2200ms 起）
    if (t >= BURST_AT) {
      if (!burst) { burst = true; spawnBurst(); }
      const q = clamp01((t - BURST_AT) / 900);
      // 冲击波
      ctx.strokeStyle = `rgba(167,139,250,${0.7 * (1 - q)})`;
      ctx.lineWidth = 2 + 6 * (1 - q);
      ctx.beginPath(); ctx.arc(cx, cy, easeOut(q) * Math.min(W, H) * 0.42, 0, Math.PI * 2); ctx.stroke();
      // 火花
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.x += sp.vx; sp.y += sp.vy; sp.vx *= 0.975; sp.vy *= 0.975;
        sp.life -= 0.012;
        if (sp.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, sp.life * 1.6);
        ctx.fillStyle = sp.c;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // 能力物种：沿椭圆轨道依次辐射展开
      caps.forEach((c, i) => {
        const start = BURST_AT + 90 + i * 55;
        const p = clamp01((t - start) / 620);
        if (p <= 0) return;
        const e = easeOut(p);
        const x = cx + Math.cos(c.a) * capRx * e, y = cy + Math.sin(c.a) * capRy * e;
        ctx.fillStyle = BURST_COLORS[i % BURST_COLORS.length];
        ctx.globalAlpha = 0.9 * e;
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(244,241,234,${0.22 * e})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = `rgba(244,241,234,${0.92 * e})`;
        ctx.font = `${Math.round(Math.min(15, Math.max(12, W / 60)))}px ${en ? 'system-ui, sans-serif' : '"PingFang SC", "Noto Sans SC", sans-serif'}`;
        ctx.textAlign = x > cx ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.text, x + (x > cx ? 10 : -10), y);
      });
      ctx.globalAlpha = 1;
      if (!wordShown && t >= WORD_AT) { wordShown = true; word.classList.add('show'); }
    }

    // 收束：从 LEAVE_AT 起淡出层（CSS 过渡），结束后露出主页
    if (!leaving && t >= LEAVE_AT) { leaving = true; el.classList.add('fading'); }
    if (t >= DURATION) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };

  html.classList.add('intro-on');
  raf = requestAnimationFrame(frame);
  return { finish };
}
