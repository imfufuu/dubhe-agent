// Dubhe Agent · 固定状态能力行与设置页工具表预览。
// 状态行只汇报模型 / 开关 / 线路；能力裁剪明细仅从设置页展开，避免在对话区制造告警胶囊。
import { text as localeText } from './locale.js';
import { isSmartRouter, SMART_ROUTER_LABEL } from './smartrouter.js?v=2026.10.11.1';
import { reasoningLevelLabel } from './reasoning.js?v=2026.10.11.1';
import { getTransport } from './api.js?v=2026.10.11.1';
import { DROP_REASON_FIX } from './executionContext.js?v=2026.10.11.1';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 纯函数：设置页的工具能力预览与 agent.previewToolTable() 共用同一份裁剪结果。 */
export function renderCapabilityTableHtml(preview) {
  const p = preview || { allowed: [], dropped: [], total: 0, tier: null };
  const allowed = Array.isArray(p.allowed) ? p.allowed : [];
  const dropped = Array.isArray(p.dropped) ? p.dropped : [];
  const tier = p.tier || {};
  const rows = [
    `<div class="tok-row"><span>可用工具</span><span class="mono">${allowed.length} / ${p.total || allowed.length + dropped.length}</span></div>`,
    `<div class="tok-row"><span>思考档位</span><span>${esc(tier.displayTier || '—')}${tier.canDispatch ? '（可委派）' : '（不可委派）'}</span></div>`,
  ];
  let list = '';
  if (dropped.length) {
    list = `<div class="cap-drop-h">未启用 ${dropped.length} 个</div>` + dropped.map((d) => {
      const fix = DROP_REASON_FIX[d.reason];
      const btn = fix && fix.kind !== 'settings'
        ? `<button type="button" class="tok-btn cap-fix" data-fix="${esc(fix.kind)}" data-tool="${esc(d.name)}">${esc(fix.label)}</button>` : '';
      return `<div class="cap-drop" data-tool="${esc(d.name)}" data-reason="${esc(d.reason)}"><span class="mono cap-tool">${esc(d.name)}</span><span class="cap-why">${esc(d.label || d.reason)}</span>${btn}</div>`;
    }).join('');
  } else {
    list = '<div class="tok-hint cap-all-ok">✓ 当前开关下，全部工具均可用。</div>';
  }
  return `${rows.join('')}${list}<div class="tok-hint">按当前开关态预览；实际请求使用同一份工具门控结果。</div>`;
}

export function installCapabilityPanel({
  store, agent, toast,
  setReasoning, toggleWeb, toggleSandbox, reprobeRelay,
} = {}) {
  const preview = () => {
    try { return agent && typeof agent.previewToolTable === 'function' ? agent.previewToolTable() : null; } catch { return null; }
  };

  let lastCapSig = null;
  let lastTableSig = null;
  function syncCapLine() {
    const line = $('#cap-line');
    if (!line) return;
    const settings = store.state.settings;
    const bits = [['model', store.state.model === '__system__' ? 'system-commands' : (isSmartRouter(store.state.model) ? SMART_ROUTER_LABEL : store.state.model)]];
    if (settings.thinking !== false) bits.push(['think', `思考 ${reasoningLevelLabel(settings.reasoningLevel)}`]);
    if (settings.sandboxEnabled) bits.push(['sandbox', '沙箱']);
    if (store.state.relayOk === true && settings.webEnabled !== false) bits.push(['web', '联网']);
    bits.push(['transport', getTransport() === 'proxy' ? '中继' : '直连']);
    const panel = $('#sandbox-panel');
    if (panel && !panel.classList.contains('collapsed')) bits.push(['panel', '面板']);
    const signature = JSON.stringify(bits);
    if (signature !== lastCapSig || !line.firstChild) {
      line.innerHTML = bits.map(([key, label]) => `<span class="cap-pill" data-cap="${key}">${esc(label)}</span>`).join('<span class="cap-sep">  ·  </span>');
      lastCapSig = signature;
    }

    const table = $('#set-capability-table-body');
    if (table) {
      const pv = preview();
      const tableSig = JSON.stringify(pv);
      if (tableSig !== lastTableSig || !table.firstChild) {
        table.innerHTML = renderCapabilityTableHtml(pv);
        lastTableSig = tableSig;
      }
    }
  }

  const runFix = async (kind, tool) => {
    try {
      if (kind === 'reasoning-max') setReasoning && setReasoning('max');
      else if (kind === 'web-on') toggleWeb && (await toggleWeb());
      else if (kind === 'sandbox-on') toggleSandbox && toggleSandbox();
      else if (kind === 'relay-reprobe') reprobeRelay && (await reprobeRelay());
    } catch (error) {
      toast && toast(localeText(`操作失败：${String((error && error.message) || error).slice(0, 120)}`, `Action failed: ${String((error && error.message) || error).slice(0, 120)}`), 'warn');
    }
    syncCapLine();
    const current = preview();
    if (current && !current.dropped.some((entry) => entry.name === tool)) toast && toast(`${tool} 已加入工具表`, 'ok');
  };

  const table = $('#set-capability-table-body');
  if (table) table.addEventListener('click', (event) => {
    const button = event.target.closest('.cap-fix');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    runFix(button.dataset.fix, button.dataset.tool);
  });

  return { syncCapLine, previewToolTable: preview };
}
