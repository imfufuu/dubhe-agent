import { mergeAvailableModels, MODEL_CATALOG_DATE } from './model-catalog.js?v=2026.10.11.1';
// ─── UI · 模型选择器（P4 拆分：从 mountUI 抽出）────────────────────────────────
// 拥有：模型下拉菜单（合并网关列表与本地兜底表、隐藏已下线/生图模型、搜索/清空）、selectModel 与按钮态同步、
//       /system 隐藏通道的进入/退出与现场隔离（preSystem）、生图模型 <select>、「刷新模型」按钮。
// 不拥有：会话切换、消息渲染、能力条。这些经 deps 注入（rebuildMessages / renderSessions / renderFiles / updateStats /
//       syncCapLine / syncWeb / getBusy / openKeyModal），本文件绝不 import ui.js。
// deps 里 renderFiles / syncWeb 在 mountUI 中定义得比本模块晚：调用方必须以惰性箭头函数传入。
import { text as localeText } from './locale.js';
import { $, el, esc } from './ui-markdown.js?v=2026.10.11.1';
import { FALLBACK_MODELS, isImageModel, providerOf, SMART_ROUTER_ID, PROVIDER_ORDER, SMART_ROUTER_PROVIDER, sortModelsInFamily, isFreeModel, supportsVision, supportsFastMode, IMAGE_MODELS, DEFAULT_IMAGE_MODEL, imageModelLabel } from './config.js?v=2026.10.11.1';
import { isJevModel } from './jev.js';
import { ICON, providerIcon } from './icons.js';
import { ROUTER_ICON_SVG, isSmartRouter, SMART_ROUTER_LABEL, SMART_ROUTER_PROVIDER_LABEL } from './smartrouter.js?v=2026.10.11.1';
import { fetchModels } from './api.js?v=2026.10.11.1';
import { effectiveApiKey } from './adminkey.js';
import { isNetworkOffline } from './offline-network.js';
import { OFFLINE_MODEL_DISPLAY_NAME, OFFLINE_MODEL_ID, OFFLINE_MODEL_PROVIDER_EN, OFFLINE_MODEL_PROVIDER_ZH, isOfflineModelId } from './offline-model-config.js';
import { DEFAULT_GATEWAY_ID, gatewayFallbackModels, defaultModelForGateway, gatewayModelListLabel, isModelForGateway } from './gateway-registry.js?v=2026.10.11.1';

export function installModelPicker({ store, agent, toast, getBusy, openKeyModal, rebuildMessages, renderSessions, renderFiles, updateStats, syncCapLine, syncWeb }) {
  // ── 模型下拉 ──
  const ddBtn = $('#model-btn');
  const ddMenu = $('#model-menu');
  const ddSearch = $('#model-search');
  // 网关仍可能返回已下线的福利档；本地兜底表删了也不够，这里再挡一层。
  const HIDDEN_MODELS = new Set(['glm-5.3-flash-free', 'deepseek-v4-flash-free', 'deepseek-flash-free']); // 后两者已从 FALLBACK_MODELS 删除，这里兜底防网关 /v1/models 再塞回来
  // 对话模型列表：过滤掉生图模型（只能由主智能体通过 generate_image 工具调用，
  // 直接选中会绕过工具循环、破坏 Agent 特性；网关 /v1/models 里带它们时也照样隐藏）
  function localModelRecord() {
    return {
      id: OFFLINE_MODEL_ID,
      provider: localeText(OFFLINE_MODEL_PROVIDER_ZH, OFFLINE_MODEL_PROVIDER_EN),
      displayName: OFFLINE_MODEL_DISPLAY_NAME,
      localModel: true,
      available: store.state.offlineModelAvailable === true,
      contextWindow: 4096,
    };
  }
  function mergedModels() {
    if (isNetworkOffline()) return [localModelRecord()];
    const gatewayId = store.state.gatewayId || DEFAULT_GATEWAY_ID;
    const presets = gatewayFallbackModels(gatewayId);
    const extraIds = gatewayId === 'custom' ? ((store.state.manualModelsByGateway || {})[gatewayId] || []) : [];
    const manualMeta = ((store.state.manualModelMetaByGateway || {})[gatewayId]) || {};
    const liveKnown = !!store.state.modelsFetchedAt || (store.state.models || []).length > 0;
    const gatewayModels = mergeAvailableModels(store.state.models, presets, liveKnown,
      { gatewayId, includeRouter: gatewayId === DEFAULT_GATEWAY_ID, extraIds })
      // A live first-party listing is an exact allowlist; otherwise use the checked-in documentation list.
      .filter(m => isModelForGateway(gatewayId, m.id, liveKnown ? (store.state.models || []) : null))
      .filter(m => !HIDDEN_MODELS.has(m.id) && !isImageModel(m.id) && !isJevModel(m.id))
      .map(m => {
        const customProvider = gatewayId === 'custom' && extraIds.includes(m.id);
        const meta = customProvider ? (manualMeta[m.id] || {}) : {};
        return {
          ...m,
          provider: customProvider
            ? (String(meta.providerName || '').trim() || localeText('自定义供应商', 'Custom provider'))
            : (m.provider || providerOf(m.id)),
          customProvider,
          providerIconDataUrl: customProvider ? String(meta.iconDataUrl || '') : '',
        };
      });
    return store.state.offlineModelAvailable === true
      ? [...gatewayModels, localModelRecord()]
      : gatewayModels;
  }
  if (HIDDEN_MODELS.has(store.state.model)) {
    store.state.model = SMART_ROUTER_ID;
    store.notify();
  }
  function renderModelMenu() {
    const q = ddSearch.value.trim().toLowerCase();
    // 隐藏通道：搜索 /system 出现「系统命令识别器」（输入命令获取系统反馈，如 /debug on）
    if (q === '/system' || q.startsWith('/system ')) {
      ddMenu.querySelectorAll('.dd-group, .dd-empty').forEach((n) => n.remove());
      const g = el('div', 'dd-group');
      g.appendChild(el('div', 'dd-group-title', `<span class="sys-gear">${ICON.system}</span><span>DUBHEAGENT</span>`));
      const item = el('button', 'dd-item' + (store.state.model === '__system__' ? ' active' : ''));
      item.type = 'button';
      // 简约：一行式条目（图标 + 名称），介绍信息省略
      item.innerHTML = '<span class="dd-item-id mono">system-commands</span>';
      item.addEventListener('click', () => selectModel('__system__'));
      g.appendChild(item);
      ddMenu.appendChild(g);
      return;
    }
    const list = mergedModels().filter((m) => !q || m.id.toLowerCase().includes(q) || String(m.provider || '').toLowerCase().includes(q) || String(m.displayName || '').toLowerCase().includes(q));
    const groups = new Map();
    for (const m of list) {
      if (!groups.has(m.provider)) groups.set(m.provider, []);
      groups.get(m.provider).push(m);
    }
    const order = [...PROVIDER_ORDER.filter((p) => groups.has(p)), ...[...groups.keys()].filter((p) => !PROVIDER_ORDER.includes(p))];
    ddMenu.querySelectorAll('.dd-group, .dd-empty').forEach((n) => n.remove());
    for (const p of order) {
      const g = el('div', 'dd-group');
      const isRouterGroup = p === SMART_ROUTER_PROVIDER;
      const customProviderModel = groups.get(p).find((m) => m.customProvider);
      const groupIcon = customProviderModel
        ? providerIcon(p, { custom: true, iconDataUrl: customProviderModel.providerIconDataUrl })
        : (p === localeText(OFFLINE_MODEL_PROVIDER_ZH, OFFLINE_MODEL_PROVIDER_EN)
          ? providerIcon(p, { custom: true })
          : providerIcon(p));
      g.appendChild(el('div', 'dd-group-title', `${isRouterGroup ? `<span class="router-group-ico">${ROUTER_ICON_SVG}</span>` : groupIcon}<span>${esc(isRouterGroup ? SMART_ROUTER_PROVIDER_LABEL : p)}</span>`));
      for (const m of sortModelsInFamily(groups.get(p))) {
        const item = el('button', 'dd-item' + (m.id === store.state.model ? ' active' : ''));
        item.type = 'button';
        const hit = m;
        if (hit.localModel && !hit.available) {
          item.disabled = true;
          item.title = localeText('本地模型尚未下载；请先在设置 → 离线本地模型中手动下载。', 'Local model is not installed. Download it manually in Settings → Offline local model first.');
        }
        const local = !!hit.localModel;
        const free = !local && isFreeModel(m.id);
        const hot = !local && !!hit.hot;
        const cheap = !local && (!!hit.cheap || free);
        const localState = store.state.offlineModelAvailable
          ? localeText('已安装', 'Installed')
          : (store.state.offlineModelChecked ? localeText('未下载', 'Not downloaded') : localeText('检查中', 'Checking'));
        // 预览档不再单独挂 Preview/Experimental badge；只显示有实际意义的标签。
        item.title = local
          ? (hit.available
            ? localeText('本地 GGUF · Q4_K_M · 约 986 MB。低拒答/uncensored 是仓库自述标签，未经独立测评。', 'Local GGUF · Q4_K_M · about 986 MB. Low-refusal/uncensored are repository self-descriptions, not independently benchmarked.')
            : localeText('本地模型尚未下载；请先在设置 → 离线本地模型中手动下载。', 'Local model is not installed. Download it manually in Settings → Offline local model first.'))
          : (hit.listPrice ? localeText(`网关标价（${MODEL_CATALOG_DATE}）：输入 $${hit.listPrice.input} / 输出 $${hit.listPrice.output}，每百万 token；实际账单以网关为准`, `Gateway list price (${MODEL_CATALOG_DATE}): $${hit.listPrice.input} input / $${hit.listPrice.output} output per million tokens; final billing is determined by the gateway`) : m.id);
        const isRouter = isSmartRouter(m.id);
        item.innerHTML = isRouter
          ? `<span class="dd-item-id mono router-name">${esc(SMART_ROUTER_LABEL)}</span>
            <span class="dd-item-badges">
              <span class="badge hot" title="${localeText('按任务类型 / 难度自动选模型', 'Auto-selects a model by task type and difficulty')}">${localeText('自动', 'Auto')}</span>
            </span>`
          : (local
            ? `<span class="dd-item-id mono">${esc(OFFLINE_MODEL_DISPLAY_NAME)}</span>
              <span class="dd-item-badges">
                <span class="badge local-model-badge">${localeText('本地', 'Local')}</span>
                <span class="badge">${localState}</span>
                <span class="badge low-refusal-badge" title="${localeText('仓库自述标签；不是独立低拒答或安全评测。', 'Repository self-description; not an independent low-refusal or safety benchmark.')}">${localeText('社区标注', 'Community tag')}</span>
              </span>`
            : `<span class="dd-item-id mono">${esc(m.id)}</span>
              <span class="dd-item-badges">
                ${hot ? `<span class="badge hot" title="${localeText('应用预设热门精选，非实时使用热度或质量实测排行', 'App-curated popular pick, not live usage popularity or benchmark rank')}">${localeText('热门', 'Popular')}</span>` : ''}
                ${free ? '<span class="badge">FREE</span>' : (cheap ? `<span class="badge cheap" title="${localeText('网关标价：输入不高于 $1/M 且输出不高于 $5/M', 'Gateway list price: input ≤ $1/M and output ≤ $5/M')}">${localeText('低价', 'Cheap')}</span>` : '')}
                ${supportsVision(m.id) ? '<span class="badge vision" title="支持图片输入（多模态）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></span>' : ''}
              </span>`);
        item.addEventListener('click', () => selectModel(m.id));
        g.appendChild(item);
      }
      ddMenu.appendChild(g);
    }
    if (!order.length) ddMenu.appendChild(el('div', 'dd-empty', '无匹配模型'));
  }
  // ── /system 通道隔离（.17）：进入时收起真实会话现场、换一次性草稿；
  // state.js 的 commit 对 __system__ 直接跳过 → 真实会话零写入，退出后原样恢复 ──
  let preSystem = null;
  const inSystem = () => store.state.model === '__system__';
  function enterSystem() {
    if (preSystem) return;
    preSystem = { messages: store.state.messages, checkpoints: store.state.checkpoints, files: store.state.files };
    store.state.messages = []; store.state.checkpoints = []; store.state.files = {};
    // 沙箱文件也要隔离：agent.fs 换成空的（真实文件随 preSystem 暂存，退出时恢复）
    try { agent.loadFiles({}); } catch { /* 忽略 */ }
    rebuildMessages(); renderSessions(); renderFiles(); updateStats();
    syncCapLine(); // 能力行同步显示通道态，不再定格上一个模型（.18）
  }
  function exitSystem() {
    if (!preSystem) return;
    store.state.messages = preSystem.messages; store.state.checkpoints = preSystem.checkpoints; store.state.files = preSystem.files;
    preSystem = null;
    try { agent.loadFiles(store.state.files); } catch { /* 忽略 */ }
    rebuildMessages(); renderSessions(); renderFiles(); updateStats();
    syncCapLine();
  }
  // 通道内：思考/沙箱按钮灰置，会话列表禁点（防止系统输出混进 Agent 会话）
  function applySystemLock() {
    const sys = inSystem();
    for (const sel of ['#thinking-toggle', '#sandbox-toggle']) {
      const b = $(sel);
      if (!b) continue;
      b.disabled = sys;
      b.classList.toggle('sys-locked', sys);
    }
    const list = $('#session-list');
    if (list) list.classList.toggle('sys-locked', sys);
  }
  function selectModel(id) {
    if (!id) return;
    if (isNetworkOffline() && !isOfflineModelId(id)) {
      closeMenu();
      return toast(localeText('离线时只允许选择本地模型。', 'Only the local model can be selected while offline.'), 'warn');
    }
    if (id === '__system__') {
      if (preSystem) { closeMenu(); return; }
      if (getBusy()) { closeMenu(); return toast('请等待当前回合结束再进入系统命令通道', 'warn'); }
      store.state.model = id;
      enterSystem();
      store.notify();
      updateModelBtn(); closeMenu(); applySystemLock();
      toast('已进入 /system 隐藏通道：直接输入 /help 查看命令（真实会话不会被写入）', 'ok', 4200);
      return;
    }
    if (preSystem) {
      if (getBusy()) { closeMenu(); return toast('请等待当前回合结束', 'warn'); }
      store.state.model = id;
      exitSystem();
      store.notify();
      updateModelBtn(); closeMenu(); applySystemLock();
      syncCapLine();
      toast('已退出隐藏通道，回到原会话', 'ok', 2400);
      return;
    }
    store.state.model = id; store.notify();
    if (typeof syncWeb === 'function') syncWeb();
    updateModelBtn(); closeMenu();
    const fast = $('#fast-toggle');
    if (fast) {
      fast.disabled = !supportsFastMode(id, store.state.gatewayId || DEFAULT_GATEWAY_ID);
      if (store.state.settings.fastMode && !supportsFastMode(id, store.state.gatewayId || DEFAULT_GATEWAY_ID)) {
        store.state.settings.fastMode = false; fast.classList.remove('on');
      }
    }
    syncCapLine();
  }
  const isSystemIsolated = () => !!preSystem; // 诊断面板用：真实会话是否已被隔离
  function chatModels() {
    return mergedModels();
  }
  function updateModelBtn() {
    const displayedId = isNetworkOffline() ? OFFLINE_MODEL_ID : store.state.model;
    const selected = mergedModels().find((m) => m.id === displayedId);
    const sys = displayedId === '__system__';
    const router = !sys && isSmartRouter(displayedId);
    let icon, name, prov;
    if (sys) {
      icon = `<span class="sys-gear">${ICON.system || '⚙'}</span>`;
      name = 'system-commands';
      prov = 'DUBHEAGENT';
    } else if (router) {
      icon = `<span class="router-ico">${ROUTER_ICON_SVG}</span>`;
      name = SMART_ROUTER_LABEL;
      prov = SMART_ROUTER_PROVIDER_LABEL;
    } else if (isOfflineModelId(displayedId)) {
      const localProvider = localeText(OFFLINE_MODEL_PROVIDER_ZH, OFFLINE_MODEL_PROVIDER_EN);
      icon = providerIcon(localProvider, { custom: true });
      name = OFFLINE_MODEL_DISPLAY_NAME;
      if (!store.state.offlineModelAvailable) name += ` · ${localeText('未下载', 'not downloaded')}`;
      prov = isNetworkOffline() ? localeText('离线 · 本地', 'Offline · local') : localProvider;
    } else if (selected?.customProvider) {
      icon = providerIcon(selected.provider, { custom: true, iconDataUrl: selected.providerIconDataUrl });
      name = selected.displayName || selected.id;
      prov = selected.provider;
    } else {
      icon = providerIcon(selected?.provider || providerOf(displayedId));
      name = displayedId;
      prov = selected?.provider || providerOf(displayedId);
    }
    $('#model-btn-icon').innerHTML = icon;
    $('#model-btn-name').textContent = name;
    $('#model-btn-provider').textContent = prov;
    syncImageModelSelect();
  }
  // 生图模型（由 Agent 调用，不作为对话模型）：与会话绑定。.33 起选择器在设置 → 多模态模型（#set-image-model，settings.js 负责填充与 change）；
  // 这里只在切会话 / 切模型时把当前会话的值同步过去，并把旧版本 / 导入会话里不在目录内的值退回默认。
  function syncImageModelSelect() {
    let want = store.state.imageModel;
    if (!IMAGE_MODELS.some((m) => m.id === want)) {
      want = DEFAULT_IMAGE_MODEL;
      store.state.imageModel = want;
    }
    const sel = $('#set-image-model');
    if (sel && sel.options.length && sel.value !== want) sel.value = want;
  }
  const openMenu = () => {
    renderModelMenu();
    // fixed 定位（脱离侧栏 overflow:hidden 裁剪），按按钮实际位置摆放
    const r = ddBtn.getBoundingClientRect();
    ddMenu.style.left = `${r.left}px`;
    ddMenu.style.top = `${r.bottom + 6}px`;
    ddMenu.style.width = `${Math.max(r.width + 60, 260)}px`;
    ddMenu.classList.add('open');
  };
  const closeMenu = () => ddMenu.classList.remove('open');
  ddBtn.addEventListener('click', () => ddMenu.classList.contains('open') ? closeMenu() : openMenu());
  ddSearch.addEventListener('input', renderModelMenu);
  // 搜索框一键清空（.18）
  const ddClear = $('#model-search-clear');
  if (ddClear) {
    const syncClear = () => { ddClear.hidden = !ddSearch.value; };
    ddSearch.addEventListener('input', syncClear);
    ddClear.addEventListener('click', () => { ddSearch.value = ''; syncClear(); renderModelMenu(); ddSearch.focus(); });
    syncClear();
  }
  document.addEventListener('click', (e) => { if (!$('#model-picker').contains(e.target)) closeMenu(); });
  window.addEventListener('resize', closeMenu);
  updateModelBtn();

  async function refreshModels({ silent = false, requireKey = true } = {}) {
    if (isNetworkOffline()) {
      if (!silent) toast(localeText('离线时不检查网关模型列表；可在设置中使用已下载的本地模型。', 'Gateway model lists are not checked offline; use the installed local model in settings.'), 'warn');
      return false;
    }
    const gatewayId = store.state.gatewayId || DEFAULT_GATEWAY_ID;
    const apiKey = effectiveApiKey(store.state.apiKey);
    if (requireKey && !apiKey) { if (!silent) openKeyModal(); return false; }
    const button = $('#refresh-models');
    if (button) button.classList.add('spin');
    try {
      const list = apiKey ? await fetchModels(apiKey, undefined, {
        gatewayId, gatewayBaseUrl: (store.state.gatewayBaseUrls || {})[gatewayId] || '',
      }) : null;
      store.state.modelsByGateway = store.state.modelsByGateway || {};
      store.state.modelsFetchedAtByGateway = store.state.modelsFetchedAtByGateway || {};
      if (list === null) {
        store.state.modelsByGateway[gatewayId] = [];
        delete store.state.modelsFetchedAtByGateway[gatewayId];
        store.state.models = [];
        store.state.modelsFetchedAt = 0;
        store.notify();
        syncGateway();
        if (!silent) toast(gatewayModelListLabel(gatewayId), 'warn', 6000);
        return true;
      }
      store.state.modelsByGateway[gatewayId] = list;
      store.state.modelsFetchedAtByGateway[gatewayId] = Date.now();
      store.state.models = list;
      store.state.modelsFetchedAt = store.state.modelsFetchedAtByGateway[gatewayId];
      if (store.state.model !== '__system__' && !isModelForGateway(gatewayId, store.state.model, list)) {
        store.state.model = defaultModelForGateway(gatewayId, '', list);
      }
      store.notify();
      syncGateway();
      if (!silent) toast(`已从 ${gatewayId} 获取 ${list.length} 个模型`, 'ok');
      return true;
    } catch (err) {
      if (!silent) toast(localeText('模型列表获取失败：', 'Failed to load the model list: ') + err.message, 'err');
      return false;
    } finally { if (button) button.classList.remove('spin'); }
  }
  function syncGateway() {
    const button = $('#refresh-models');
    if (button) {
      const gatewayId = store.state.gatewayId || DEFAULT_GATEWAY_ID;
      const name = gatewayId === DEFAULT_GATEWAY_ID ? 'TeamoRouter' : gatewayId;
      button.title = `从当前网关 ${name} 刷新模型列表`;
      button.setAttribute('aria-label', button.title);
    }
    updateModelBtn();
    renderModelMenu();
  }
  $('#refresh-models').addEventListener('click', () => refreshModels());

  return { inSystem, isSystemIsolated, selectModel, chatModels, updateModelBtn, renderModelMenu, refreshModels, syncGateway };
}
