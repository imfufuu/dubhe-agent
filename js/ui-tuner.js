// ─── 输入框「调节器」(2026-11-08) ────────────────────────────────────────────
// 一个面板同时管理：回答温度（默认智能自调节 / 手动档位）、环境设置
//（Agent 模式：思考等级 + 全部工具；对话模式：思考开关 + 零工具）、以及自注册工具的
// 用户安全确认与日常管理（读取 / 启停 / 删除）。
// 只写 store.state.tuner，真正的请求解释在 agent-runtime.js；此文件不含策略判断。
import { text as t, onLanguageChange } from './locale.js';
import { TUNER_DEFAULTS, TEMPERATURE_PRESETS, REASONING_LEVEL_CHOICES, normalizeTuner, temperatureValueFor, resolveTurnEnvironment } from './agent-runtime.js';
import {
  listRegisteredTools, readRegisteredTool, pendingApprovals, approvePending, denyPending,
  uiDeleteTool, uiSetToolEnabled, configureRegistryHooks,
} from './tool-registry.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function installTuner({ store, toast = () => {} } = {}) {
  const btn = $('tuner-btn'), panel = $('tuner-panel'), close = $('tuner-close');
  if (!btn || !panel || !store) return null;
  let expandedTool = '';

  const tuner = () => normalizeTuner(store.state.tuner);
  const commit = (patch) => {
    store.state.tuner = normalizeTuner({ ...tuner(), ...patch });
    store.notify();
    render();
  };
  const open = () => { render(); panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('on'); };
  const hide = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('on'); };
  const toggle = () => (panel.hidden ? open() : hide());

  function renderTemperature() {
    const cur = tuner();
    const box = $('tuner-temp-options');
    box.innerHTML = TEMPERATURE_PRESETS.map((p) => {
      const label = t(p.zh, p.en);
      const active = cur.temperatureMode === p.id ? ' on' : '';
      const value = p.value == null ? '' : ` <small>${p.value}</small>`;
      return `<button type="button" class="tuner-seg-btn${active}" data-temp="${p.id}" aria-pressed="${!!active}">${esc(label)}${value}</button>`;
    }).join('');
    box.querySelectorAll('[data-temp]').forEach((b) => b.addEventListener('click', () => commit({ temperatureMode: b.dataset.temp })));
    const customWrap = $('tuner-custom-wrap');
    customWrap.hidden = cur.temperatureMode !== 'custom';
    const range = $('tuner-custom-range');
    range.value = String(cur.customTemperature);
    $('tuner-custom-number').textContent = Number(cur.customTemperature).toFixed(2);
    const value = temperatureValueFor(cur);
    $('tuner-temp-value').textContent = value == null ? t('智能', 'Adaptive') : `T=${value}`;
    const preset = TEMPERATURE_PRESETS.find((p) => p.id === cur.temperatureMode) || TEMPERATURE_PRESETS[0];
    $('tuner-temp-hint').textContent = t(preset.hintZh, preset.hintEn);
  }

  function renderEnvironment() {
    const cur = tuner();
    const box = $('tuner-env-options');
    const opts = [
      { id: 'agent', label: t('Agent 模式', 'Agent'), hint: t('支持全部工具调用与思考等级', 'All tools and reasoning levels') },
      { id: 'chat', label: t('对话模式', 'Chat'), hint: t('纯文本对话，不调用任何工具', 'Text only, no tools at all') },
    ];
    box.innerHTML = opts.map((o) => {
      const on = cur.environment === o.id;
      return `<button type="button" class="tuner-seg-btn${on ? ' on' : ''}" data-env="${o.id}" aria-pressed="${on}" title="${esc(o.hint)}">${esc(o.label)}</button>`;
    }).join('');
    box.querySelectorAll('[data-env]').forEach((b) => b.addEventListener('click', () => commit({ environment: b.dataset.env })));
    const agentBlock = $('tuner-agent-block'), chatBlock = $('tuner-chat-block');
    agentBlock.hidden = cur.environment === 'chat';
    chatBlock.hidden = cur.environment !== 'chat';
    const level = $('tuner-level');
    level.innerHTML = REASONING_LEVEL_CHOICES.map((l) => `<option value="${l.id}"${cur.agentReasoningLevel === l.id ? ' selected' : ''}>${esc(t(l.zh, l.en))}</option>`).join('');
    $('tuner-chat-thinking').checked = cur.chatThinking === true;
  }

  function renderPending() {
    const box = $('tuner-pending');
    const list = pendingApprovals();
    box.hidden = !list.length;
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="tuner-pending-title">${esc(t('待你确认的变更', 'Pending your approval'))}</div>` + list.map((p) => `
      <div class="tuner-pending-row" data-token="${esc(p.token)}">
        <div><b>${esc(p.action)}</b><span>${esc(p.summary)}</span><code>${esc(p.token.slice(0, 8))}…</code></div>
        <div class="tuner-pending-actions">
          <button type="button" data-act="allow" class="tuner-allow">${esc(t('允许', 'Allow'))}</button>
          <button type="button" data-act="deny" class="tuner-deny">${esc(t('拒绝', 'Deny'))}</button>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const token = b.closest('[data-token]')?.dataset.token || '';
      const ok = b.dataset.act === 'allow' ? approvePending(token, { autoRun: true }) : denyPending(token);
      toast(ok ? t('已批准该工具变更', 'Tool change approved') : t('已拒绝该工具变更', 'Tool change denied'), 'ok', 2400);
      renderTools();
    }));
  }

  function renderTools() {
    renderPending();
    const list = listRegisteredTools();
    $('tuner-tools-count').textContent = `${list.length} / 24`;
    const box = $('tuner-tools-list');
    if (!list.length) {
      box.innerHTML = `<p class="tuner-empty">${esc(t('暂无自注册工具。Agent 可用 tool_registry 创建（需你确认）。', 'No self-registered tools yet. The Agent can create one with tool_registry (your approval is required).'))}</p>`;
      return;
    }
    box.innerHTML = list.map((tool) => {
      const openState = expandedTool === tool.name;
      const detail = openState ? `<pre class="tuner-tool-json">${esc(JSON.stringify(readRegisteredTool(tool.name), null, 2))}</pre>` : '';
      return `<div class="tuner-tool${tool.enabled === false ? ' disabled' : ''}" data-tool="${esc(tool.name)}">
        <div class="tuner-tool-head">
          <button type="button" class="tuner-tool-name" data-act="read"><code>${esc(tool.name)}</code></button>
          <span class="tuner-tool-kind">${esc(tool.handler?.kind || '')}</span>
          <button type="button" class="tuner-mini" data-act="toggle">${esc(tool.enabled === false ? t('启用', 'Enable') : t('停用', 'Disable'))}</button>
          <button type="button" class="tuner-mini danger" data-act="delete">${esc(t('删除', 'Delete'))}</button>
        </div>
        <div class="tuner-tool-desc">${esc(tool.description)}</div>${detail}
      </div>`;
    }).join('');
    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const name = b.closest('[data-tool]')?.dataset.tool || '';
      const act = b.dataset.act;
      if (act === 'read') { expandedTool = expandedTool === name ? '' : name; renderTools(); return; }
      if (act === 'toggle') {
        const tool = readRegisteredTool(name);
        uiSetToolEnabled(name, tool?.enabled === false);
        renderTools(); return;
      }
      if (act === 'delete') {
        // UI 侧的显式二次确认：删除不可恢复。
        const label = t('删除', 'Delete');
        if (b.dataset.confirmed !== '1') {
          b.dataset.confirmed = '1'; b.textContent = `${label}?`; b.classList.add('confirm');
          setTimeout(() => { if (b.isConnected) { b.dataset.confirmed = ''; b.textContent = label; b.classList.remove('confirm'); } }, 4000);
          return;
        }
        uiDeleteTool(name); expandedTool = ''; renderTools();
      }
    }));
  }

  // 静态文案全部走 t(zh,en)，非中英语言由语言包补齐（i18n-audit 可验证）。
  function localize() {
    const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    const setAttr = (id, attr, value) => { const el = $(id); if (el) el.setAttribute(attr, value); };
    setText('tuner-title', t('调节器', 'Tuner'));
    setText('tuner-label-temp', t('回答温度', 'Temperature'));
    setText('tuner-label-env', t('环境设置', 'Environment'));
    setText('tuner-label-tools', t('自注册工具', 'Self-registered tools'));
    setText('tuner-level-label', t('Agent 思考等级', 'Agent reasoning level'));
    setText('tuner-chat-thinking-label', t('启用思考', 'Enable thinking'));
    setText('tuner-reset', t('恢复默认', 'Reset to defaults'));
    setText('tuner-tools-note', t('Agent 可用 tool_registry 注册 / 读取 / 删除工具；注册、修改、删除、启停都需你在此确认。工具名以 custom_ 开头，handler 只执行声明式白名单动作，不会执行模型提供的代码。', 'The Agent can create, read and delete tools with tool_registry; creation, edits, deletion and enable/disable require your approval here. Names start with custom_ and handlers only run declarative whitelisted actions — model-provided code is never executed.'));
    setAttr('tuner-btn', 'title', t('调节器：回答温度、Agent/对话环境、自注册工具', 'Tuner: temperature, Agent/Chat environment, self-registered tools'));
    setAttr('tuner-btn', 'aria-label', t('调节器', 'Tuner'));
    setAttr('tuner-panel', 'aria-label', t('调节器', 'Tuner'));
    setAttr('tuner-close', 'aria-label', t('关闭调节器', 'Close tuner'));
    setAttr('tuner-close', 'title', t('关闭', 'Close'));
    setAttr('tuner-temp-options', 'aria-label', t('回答温度档位', 'Temperature presets'));
    setAttr('tuner-custom-range', 'aria-label', t('自定义温度', 'Custom temperature'));
    setAttr('tuner-env-options', 'aria-label', t('环境模式', 'Environment mode'));
    setAttr('tuner-level', 'aria-label', t('Agent 思考等级', 'Agent reasoning level'));
  }

  function render() {
    localize();
    renderTemperature(); renderEnvironment(); renderTools();
    const env = resolveTurnEnvironment({ tuner: tuner(), settings: store.state.settings || {}, gatewayId: store.state.gatewayId });
    $('tuner-summary').textContent = t(env.summaryZh, env.summaryEn);
    const hint = $('tuner-env-hint');
    if (hint) hint.textContent = env.toolsEnabled
      ? t('Agent 模式：本轮工具表包含全部内置工具与已批准的自注册工具。', 'Agent: all built-in tools plus approved self-registered tools are available this turn.')
      : t('对话模式：工具表为空，模型幻觉出的工具调用也会被策略门丢弃。', 'Chat: the tool table is empty and any hallucinated tool calls are dropped by the policy gate.');
  }

  // 注册表变更请求到达时，自动打开面板让用户批准；Agent 无法自行批准。
  configureRegistryHooks({
    onApprovalRequest: ({ action, summary }) => {
      toast(t(`工具变更待确认：${summary}`, `Tool change awaiting approval: ${summary}`), 'warn', 6000);
      renderTools(); open();
    },
  });

  btn.addEventListener('click', toggle);
  close?.addEventListener('click', hide);
  $('tuner-custom-range')?.addEventListener('input', (e) => {
    $('tuner-custom-number').textContent = Number(e.target.value).toFixed(2);
  });
  $('tuner-custom-range')?.addEventListener('change', (e) => commit({ temperatureMode: 'custom', customTemperature: Number(e.target.value) }));
  $('tuner-level')?.addEventListener('change', (e) => commit({ agentReasoningLevel: e.target.value }));
  $('tuner-chat-thinking')?.addEventListener('change', (e) => commit({ chatThinking: e.target.checked }));
  $('tuner-reset')?.addEventListener('click', () => { store.state.tuner = { ...TUNER_DEFAULTS }; store.notify(); render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) hide(); });
  document.addEventListener('pointerdown', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    hide();
  });
  onLanguageChange(render);
  render();
  return { open, close: hide, toggle, render, environment: () => resolveTurnEnvironment({ tuner: tuner(), settings: store.state.settings || {}, gatewayId: store.state.gatewayId }) };
}
