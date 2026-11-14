// ─── 调节器 v2 (2026-11-08) ──────────────────────────────────────────────────
// 独立页面（与设置页同样使用 .modal + .modal-card），平滑展开且不受输入框宽度/视口限制。
// 只保留两件事：回答温度档位（无自定义滑杆）与 Agent / 对话环境切换。
// 自注册工具管理已迁到「设置 → 自注册工具」，用户确认已迁到对话输出里的确认卡。
// 本模块只写 store.state.tuner；请求侧解释统一由 agent-runtime.js 负责。
import { text as t, onLanguageChange } from './locale.js';
import { TUNER_DEFAULTS, TEMPERATURE_PRESETS, normalizeTuner, temperatureValueFor, resolveTurnEnvironment } from './agent-runtime.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function installTuner({ store, toast = () => {} } = {}) {
  const btn = $('tuner-btn'), modal = $('tuner-modal'), close = $('tuner-close');
  let hideTimer = 0;
  if (!btn || !modal || !store) return null;

  const tuner = () => normalizeTuner(store.state.tuner);
  const commit = (patch) => {
    store.state.tuner = normalizeTuner({ ...tuner(), ...patch });
    store.notify();
    render();
  };
  const open = () => {
    render();
    clearTimeout(hideTimer);
    modal.hidden = false;
    void modal.offsetHeight; // 强制 reflow，让 .modal 的 opacity / transform 过渡真正播放
    modal.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('on');
  };
  const hide = () => {
    // 与设置页一致：先移除 .open 触发 .3s 淡出 + translate 过渡，动画结束再真正隐藏。
    modal.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('on');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!modal.classList.contains('open')) modal.hidden = true; }, 320);
  };
  const toggle = () => (modal.classList.contains('open') ? hide() : open());

  function renderTemperature() {
    const cur = tuner();
    const box = $('tuner-temp-options');
    const presets = TEMPERATURE_PRESETS.filter((p) => p.id !== 'custom'); // 自定义与滑杆已移除
    box.innerHTML = presets.map((p) => {
      const active = cur.temperatureMode === p.id ? ' on' : '';
      const value = p.value == null ? '' : ` <small>${p.value}</small>`;
      return `<button type="button" class="tuner-seg-btn${active}" data-temp="${p.id}" aria-pressed="${!!active}">${esc(t(p.zh, p.en))}${value}</button>`;
    }).join('');
    box.querySelectorAll('[data-temp]').forEach((b) => b.addEventListener('click', () => commit({ temperatureMode: b.dataset.temp })));
    const value = temperatureValueFor(cur);
    $('tuner-temp-value').textContent = value == null ? t('智能', 'Adaptive') : `T=${value}`;
    const preset = presets.find((p) => p.id === cur.temperatureMode) || presets[0];
    $('tuner-temp-hint').textContent = t(preset.hintZh, preset.hintEn);
  }

  function renderEnvironment() {
    const cur = tuner();
    const box = $('tuner-env-options');
    const opts = [
      { id: 'agent', label: t('Agent 模式', 'Agent'), hint: t('全部工具与系统提示词', 'All tools and system prompts') },
      { id: 'chat', label: t('对话模式', 'Chat'), hint: t('不上传任何提示词，不调用任何工具', 'No prompts uploaded, no tools') },
    ];
    box.innerHTML = opts.map((o) => {
      const on = cur.environment === o.id;
      return `<button type="button" class="tuner-seg-btn${on ? ' on' : ''}" data-env="${o.id}" aria-pressed="${on}" title="${esc(o.hint)}">${esc(o.label)}</button>`;
    }).join('');
    box.querySelectorAll('[data-env]').forEach((b) => b.addEventListener('click', () => commit({ environment: b.dataset.env })));
    $('tuner-chat-block').hidden = cur.environment !== 'chat';
    $('tuner-chat-thinking').checked = cur.chatThinking === true;
  }

  function renderPersonalPrompt() {
    const box = $('tuner-personal-prompt');
    if (!box) return;
    const cur = tuner();
    if (box.value !== cur.personalPrompt) box.value = cur.personalPrompt;
    const count = $('tuner-personal-count');
    if (count) count.textContent = `${cur.personalPrompt.length} / 2000`;
  }

  function localize() {
    const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    const setAttr = (id, attr, value) => { const el = $(id); if (el) el.setAttribute(attr, value); };
    setText('tuner-title', t('调节器', 'Tuner'));
    setText('tuner-label-personal', t('个性化系统提示词', 'Personal system prompt'));
    setAttr('tuner-personal-prompt', 'placeholder', t('补充你的偏好，不会覆盖应用主提示词；对话模式下不发送', 'Add your preferences; does not replace the app prompt and is not sent in Chat mode'));
    setText('tuner-label-temp', t('回答温度', 'Temperature'));
    setText('tuner-label-env', t('环境设置', 'Environment'));
    setText('tuner-chat-thinking-label', t('启用思考', 'Enable thinking'));
    setText('tuner-reset', t('恢复默认', 'Reset to defaults'));
    setAttr('tuner-btn', 'title', t('调节器：回答温度与 Agent/对话环境', 'Tuner: temperature and Agent/Chat environment'));
    setAttr('tuner-btn', 'aria-label', t('调节器', 'Tuner'));
    setAttr('tuner-modal', 'aria-label', t('调节器', 'Tuner'));
    setAttr('tuner-close', 'aria-label', t('关闭调节器', 'Close tuner'));
    setAttr('tuner-close', 'title', t('关闭', 'Close'));
    setAttr('tuner-temp-options', 'aria-label', t('回答温度档位', 'Temperature presets'));
    setAttr('tuner-env-options', 'aria-label', t('环境模式', 'Environment mode'));
  }

  function render() {
    localize();
    renderTemperature(); renderEnvironment(); renderPersonalPrompt();
    const env = resolveTurnEnvironment({ tuner: tuner(), settings: store.state.settings || {}, gatewayId: store.state.gatewayId });
    $('tuner-summary').textContent = t(env.summaryZh, env.summaryEn);
    const hint = $('tuner-env-hint');
    if (hint) hint.textContent = env.toolsEnabled
      ? t('Agent 模式：下发工具表与系统提示词。', 'Agent: tool table and system prompts are sent.')
      : t('对话模式：不上传任何提示词，纯净模型对话，零工具。', 'Chat: no prompt text is uploaded; pure model conversation with zero tools.');
  }

  btn.addEventListener('click', toggle);
  close?.addEventListener('click', hide);
  $('tuner-personal-prompt')?.addEventListener('change', (e) => commit({ personalPrompt: String(e.target.value || '').slice(0, 2000) }));
  $('tuner-chat-thinking')?.addEventListener('change', (e) => commit({ chatThinking: e.target.checked }));
  $('tuner-reset')?.addEventListener('click', () => { store.state.tuner = { ...TUNER_DEFAULTS }; store.notify(); render(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) hide(); }); // 点遮罩关闭
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) hide(); });
  onLanguageChange(render);
  render();
  return {
    open, close: hide, toggle, render,
    environment: () => resolveTurnEnvironment({ tuner: tuner(), settings: store.state.settings || {}, gatewayId: store.state.gatewayId }),
  };
}
