// 回滚到此消息：被删消息带粒子粉碎动画离开对话区（Requirement 6）。
// 自 ui.js 拆出——ui.js 有 3000 行 / 160 KB 的硬上限（agent.test P4 验收）。
export function createRollbackFx(host) {
  let active = null;
  function cancel() {
    if (active && typeof active.cancel === 'function') active.cancel();
    active = null;
  }
  function disintegrateMessageNodes(nodes, onDone) {
    cancel();
    const list = (nodes || []).filter((n) => n && n.isConnected);
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!list.length || reduced || typeof HTMLCanvasElement === 'undefined') {
      onDone && onDone();
      return;
    }
    const hostRect = host.getBoundingClientRect();
    if (!(hostRect.width > 0 && hostRect.height > 0)) {
      onDone && onDone();
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.className = 'rollback-particle-canvas';
    canvas.style.cssText = `position:fixed;left:${hostRect.left}px;top:${hostRect.top}px;width:${hostRect.width}px;height:${hostRect.height}px;pointer-events:none;z-index:60;`;
    canvas.width = Math.round(hostRect.width * dpr);
    canvas.height = Math.round(hostRect.height * dpr);
    document.body.appendChild(canvas);
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      onDone && onDone();
      return;
    }
    ctx.scale(dpr, dpr);
    const dark = document.documentElement.dataset.theme === 'dark';
    // 小黑色微粒调色盘：高精细度墨黑/炭黑/石墨微尘（深色模式下混入少量深灰炭粒保证清晰层次）
    const BLACK_MICRO_PALETTE = dark
      ? ['#09090b', '#111110', '#18181b', '#27272a', '#3f3f46', '#52525b', '#71717a']
      : ['#050505', '#09090b', '#111110', '#18181b', '#27272a', '#3f3f46', '#52525b'];
    const particles = [];
    for (const node of list) {
      const r = node.getBoundingClientRect();
      node.style.height = `${r.height}px`;
      node.classList.add('msg-disintegrating');
      const relX = r.left - hostRect.left;
      const relY = r.top - hostRect.top;
      const w = Math.max(40, Math.min(r.width, hostRect.width));
      const h = Math.max(24, Math.min(r.height, hostRect.height));
      if (relY + r.height < -40 || relY > hostRect.height + 40) continue;
      const area = w * h;
      // 提升粒子密度与空间采样精细度（分层网格抖动采样 + 微米级墨粒尺寸 0.65px ~ 2.2px）
      const count = Math.max(260, Math.min(720, Math.round(area / 92)));
      const cols = Math.max(12, Math.round(Math.sqrt(count * (w / Math.max(1, h)))));
      const rowsGrid = Math.max(6, Math.ceil(count / cols));
      const cellW = w / cols;
      const cellH = h / rowsGrid;
      for (let i = 0; i < count; i++) {
        const gx = i % cols;
        const gy = Math.floor(i / cols) % rowsGrid;
        const px = relX + (gx + 0.15 + Math.random() * 0.7) * cellW;
        const py = Math.max(0, Math.min(hostRect.height, relY + (gy + 0.15 + Math.random() * 0.7) * cellH));
        const wave = ((px - relX) / Math.max(1, w)) * 0.44 + ((py - relY) / Math.max(1, h)) * 0.2;
        const angle = (Math.random() - 0.5) * Math.PI * 1.35 - Math.PI * 0.32;
        const speed = 22 + Math.random() * 84;
        particles.push({
          x: px,
          y: py,
          vx: Math.cos(angle) * speed + (Math.random() - 0.34) * 36,
          vy: Math.sin(angle) * speed - (16 + Math.random() * 42),
          size: 0.65 + Math.random() * 1.55,
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 11,
          phase: Math.random() * Math.PI * 2,
          delay: wave * 210 + Math.random() * 55,
          life: 460 + Math.random() * 260,
          color: BLACK_MICRO_PALETTE[i % BLACK_MICRO_PALETTE.length],
          grainKind: i % 4, // 0,1: 极细圆点墨尘；2: 微矩炭粒；3: 锐利微晶碎屑
        });
      }
    }
    const t0 = performance.now();
    let lastT = t0;
    let rafId = 0;
    let finished = false;
    const finish = (runCallback) => {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      canvas.remove();
      if (active && active.canvas === canvas) active = null;
      if (runCallback && onDone) onDone();
    };
    active = { canvas, cancel: () => finish(false) };
    const tick = (now) => {
      if (finished) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;
      const elapsed = now - t0;
      ctx.clearRect(0, 0, hostRect.width, hostRect.height);
      let alive = 0;
      for (const p of particles) {
        const local = elapsed - p.delay;
        if (local < 0) { alive++; continue; }
        const prog = local / p.life;
        if (prog >= 1) continue;
        alive++;
        // 微湍流旋涡扰动 + 轻盈上浮墨尘感
        const turbX = Math.sin(prog * 8.5 + p.phase) * 20;
        const turbY = Math.cos(prog * 6.5 + p.phase) * 12;
        p.x += (p.vx + turbX) * dt;
        p.y += (p.vy + turbY) * dt;
        p.vy -= 24 * dt;
        p.vx *= (1 - 1.05 * dt);
        p.rot += p.vrot * dt;
        const alpha = Math.max(0, (1 - prog) * (1 - prog * 0.58));
        const s = Math.max(0.35, p.size * (1 - prog * 0.42));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.color;
        if (p.grainKind <= 1) {
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.68, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.grainKind === 2) {
          ctx.rotate(p.rot);
          ctx.fillRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
        } else {
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(-s * 0.85, -s * 0.45);
          ctx.lineTo(s * 0.95, -s * 0.15);
          ctx.lineTo(s * 0.3, s * 0.9);
          ctx.lineTo(-s * 0.65, s * 0.55);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      if (alive > 0 && elapsed < 780) {
        rafId = requestAnimationFrame(tick);
      } else {
        finish(true);
      }
    };
    rafId = requestAnimationFrame(tick);
  }
  return { disintegrateMessageNodes, cancel };
}
