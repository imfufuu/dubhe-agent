// ─── UI · Token / 路由弹层（P4 拆分：从 mountUI 抽出）───────────────────────────
// 拥有：#tok-pop 的隐藏/定位（placeTokPop 自动上下翻转，data-place）、智能路由决策弹层（showRouterPop）、
//       token 构成与本轮费用弹层（showTokBreak）。能力表只在设置页展开，不复用此弹层。
// 不拥有：会话统计文字（updateStats 留在 ui.js）。
// 只读 store，不改状态；本文件绝不 import ui.js。
import { $, esc } from './ui-markdown.js?v=2026.10.25.1';
import { providerOf, systemPrompt } from './config.js?v=2026.10.25.1';
import { providerIcon } from './icons.js';
import { estimateTokens } from './context.js';
import { tokenBreakdown, formatTokBreak } from './commands.js';
import { priceBadgeFor, formatCcy } from './pricing.js';
import { modelDisplayName } from './smartrouter.js?v=2026.10.25.1';
import { onLanguageChange } from './locale.js';
import { onCurrencyChange } from './currency.js';

export function installPopovers({ store }) {
  function hideTokPop() {
    const pop = $('#tok-pop');
    if (!pop) return;
    if (pop._exitAnim) return; // 收起动画进行中：别叠加
    if (pop.hidden) return;
    const doc = pop.ownerDocument;
    const reduce = doc.documentElement.dataset.motion === 'off'
      || (doc.documentElement.dataset.motion !== 'on' && doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (reduce || !pop.animate) { pop.hidden = true; return; }
    // V1.8.1：收起也有动画——气泡沿 bubbleIn 原路缩回，与思考菜单同一种手感
    const cs = doc.defaultView.getComputedStyle(pop);
    const dy = (cs.getPropertyValue('--pop-dy') || '').trim() || '12px';
    const scale = (cs.getPropertyValue('--pop-scale') || '').trim() || '.78';
    const to = { opacity: 0, transform: `translate3d(0, ${dy}, 0) scale(${scale})` };
    const a = pop.animate([{ opacity: 1, transform: 'none' }, to], {
      duration: 150, easing: 'cubic-bezier(.4, 0, .9, .6)',
    });
    pop._exitAnim = a;
    a.finished.then(() => {
      if (pop._exitAnim !== a) return;
      pop._exitAnim = null; pop.hidden = true;
    }).catch(() => { if (pop._exitAnim === a) pop._exitAnim = null; });
  }
  // Token / 路由弹层只锚定到自己的可视入口；能力详情已迁入设置页。
  function isPlacedNode(n) {
    if (!n || typeof n.getBoundingClientRect !== 'function') return false;
    if (n.isConnected === false) return false;
    const r = n.getBoundingClientRect();
    return !(r.width === 0 && r.height === 0 && r.left === 0 && r.top === 0);
  }
  function resolveAnchor(anchor) {
    if (isPlacedNode(anchor)) return anchor;
    const fb = $('#conv-stats');
    if (isPlacedNode(fb)) return fb;
    return (anchor && typeof anchor.getBoundingClientRect === 'function') ? anchor : fb;
  }
  function placeTokPop(anchor) {
    const pop = $('#tok-pop');
    if (!pop || pop.hidden) return;
    if (pop._exitAnim) { pop._exitAnim.cancel(); pop._exitAnim = null; } // 收起未播完就重开：取消收起
    const target = resolveAnchor(anchor);
    if (target !== anchor) pop._anchor = target;
    const r = (target && target.getBoundingClientRect) ? target.getBoundingClientRect() : ($('#conv-stats') || {}).getBoundingClientRect?.();
    if (!r) return;
    const pw = pop.offsetWidth || 240;
    const ph = pop.offsetHeight || 160;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    let top = r.top - ph - 10;
    if (top < 8) top = Math.min(window.innerHeight - ph - 8, r.bottom + 8);
    pop.dataset.place = top >= r.bottom ? 'below' : 'above'; // 气泡弹入的 transform-origin 跟着锚点方向走
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    // 小箭头指回锚点中心（clamp 进弹层左右 12px 内，含圆角与描边）
    const cx = (r.left + r.right) / 2;
    pop.style.setProperty('--pop-arrow-x', `${Math.min(Math.max(12, cx - left), Math.max(12, pw - 12))}px`);
  }
  // 智能路由详情弹层：与 token 弹层共用 #tok-pop（同一时间只开一个）
  function showRouterPop(anchor, ri, realModel) {
    const pop = $('#tok-pop');
    const body = $('#tok-pop-body');
    const head = pop && $('.tok-pop-h', pop);
    if (!pop) return;
    if (!pop.hidden && pop.dataset.kind === 'router' && pop._anchor === anchor) { hideTokPop(); return; }
    pop.dataset.kind = 'router';
    pop._anchor = anchor;
    if (head) head.textContent = '智能路由';
    const provider = (ri && ri.chosenProvider) || providerOf(realModel) || '—';
    const rows = [
      ['服务商', provider],
    ];
    let html = rows.map(([k, v]) => `<div class="tok-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
    html += `<div class="tok-row total router-model-row"><span>具体模型</span><span class="router-model">${providerIcon(providerOf(realModel))}<span class="mono">${esc(realModel || '未知')}</span></span></div>`;
    html += '<div class="tok-hint">路由由本地启发式即时决定；换一句话问，可能会选到不同模型。</div>';
    if (body) body.innerHTML = html;
    pop.hidden = false;
    placeTokPop(anchor);
  }
  function showTokBreak(anchor, turnInfo = null) {
    const pop = $('#tok-pop');
    const body = $('#tok-pop-body');
    const stats = $('#conv-stats');
    if (!pop) return;
    if (!pop.hidden && pop.dataset.kind !== 'router') { hideTokPop(); return; }
    pop.dataset.kind = 'tokens';
    pop._turnInfo = turnInfo || null;
    pop._anchor = anchor && anchor.nodeType ? anchor : stats;
    const headEl = $('.tok-pop-h', pop);
    if (headEl) headEl.textContent = 'Token 构成';
    const sysTok = estimateTokens([{ role: 'system', text: systemPrompt(new Date(), { webEnabled: false }) }]);
    const b = tokenBreakdown(store.state.messages, estimateTokens, sysTok);
    const n = (x) => (x >= 1000 ? `${(x / 1000).toFixed(1)}k` : String(x || 0));
    const rows = [
      ['系统', b.system], ['历史', b.history], ['工具结果', b.tools], ['本轮', b.current], ['合计', b.total],
    ];
    let html = rows.map(([k, v], i) => `<div class="tok-row${i === rows.length - 1 ? ' total' : ''}"><span>${k}</span><span>${n(v)}</span></div>`).join('');
    if (turnInfo && turnInfo.summary) {
      const s = turnInfo.summary;
      const headModel = (turnInfo.headMsg && turnInfo.headMsg.model) || store.state.model;
      const gatewayId = s.gatewayId || (turnInfo.headMsg && turnInfo.headMsg.gatewayId) || store.state.gatewayId || '';
      const rateBadge = priceBadgeFor(headModel, { fastMode: !!(turnInfo.headMsg && turnInfo.headMsg.fastMode), gatewayId });
      html += `<div class="tok-row total"><span>对话模型 (${esc(rateBadge || modelDisplayName(headModel))})</span><span>${esc(formatCcy(s.chatUsd))}</span></div>`;
      if (s.visionUsd > 0) html += `<div class="tok-row"><span>识图模型</span><span>${esc(formatCcy(s.visionUsd))}</span></div>`;
      html += `<div class="tok-row"><span>音视频分析</span><span>${esc(formatCcy(s.avUsd || 0))}</span></div>`;
      if (s.imageUsd > 0) html += `<div class="tok-row"><span>生图模型</span><span>${esc(formatCcy(s.imageUsd))}</span></div>`;
      html += `<div class="tok-row"><span>视频生成</span><span>${esc(formatCcy(s.videoGenUsd || 0))}</span></div>`;
      if (s.subagentUsd > 0) html += `<div class="tok-row"><span>子智能体</span><span>${esc(formatCcy(s.subagentUsd))}</span></div>`;
      html += `<div class="tok-row total"><span>本轮预估总价</span><span>${esc(s.formatted)}</span></div>`;
    }
    if (body) body.innerHTML = html;
    const line = formatTokBreak(b);
    if (stats) stats.title = line + '（再点一次收起）';
    pop.hidden = false;
    placeTokPop(anchor && anchor.nodeType ? anchor : stats);
  }
  const refreshVisibleTokenPopover = () => {
    const pop = $('#tok-pop');
    if (!pop || pop.hidden || pop.dataset.kind !== 'tokens') return;
    if (pop._turnInfo?.summary) pop._turnInfo.summary.formatted = formatCcy(pop._turnInfo.summary.totalUsd);
    const anchor = pop._anchor || $('#conv-stats');
    pop.hidden = true;
    showTokBreak(anchor, pop._turnInfo);
  };
  onLanguageChange(refreshVisibleTokenPopover);
  onCurrencyChange(refreshVisibleTokenPopover);
  // 打开期间：Esc 收起（对话框语义，模态优先）；窗口尺寸 / 滚动变了就重新贴回锚点
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const pop = $('#tok-pop');
    if (!pop || pop.hidden) return;
    if ($('.modal.open') || $('.cmd-palette:not([hidden])')) return;
    hideTokPop();
  });
  let followRaf = 0;
  const follow = () => {
    if (followRaf) return;
    followRaf = requestAnimationFrame(() => {
      followRaf = 0;
      const pop = $('#tok-pop');
      if (pop && !pop.hidden) placeTokPop(pop._anchor);
    });
  };
  window.addEventListener('scroll', follow, { passive: true, capture: true });
  window.addEventListener('resize', follow, { passive: true });
  return { hideTokPop, placeTokPop, showRouterPop, showTokBreak };
}
