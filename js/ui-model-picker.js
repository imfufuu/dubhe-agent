import { mergeAvailableModels, MODEL_CATALOG_DATE } from './model-catalog.js?v=2026.10.25.1';
// ─── UI · 模型选择器（P4 拆分：从 mountUI 抽出）────────────────────────────────
// 拥有：模型下拉菜单（合并网关列表与本地兜底表、隐藏已下线/生图模型、搜索/清空）、selectModel 与按钮态同步、
//       /system 隐藏通道的进入/退出与现场隔离（preSystem）、生图模型 <select>、「刷新模型」按钮。
// 不拥有：会话切换、消息渲染、能力条。这些经 deps 注入（rebuildMessages / renderSessions / renderFiles / updateStats /
//       syncCapLine / syncWeb / getBusy / openKeyModal），本文件绝不 import ui.js。
// deps 里 renderFiles / syncWeb 在 mountUI 中定义得比本模块晚：调用方必须以惰性箭头函数传入。
import { text as localeText, onLanguageChange } from './locale.js';
import { onCurrencyChange } from './currency.js';
import { $, el, esc } from './ui-markdown.js?v=2026.10.25.1';
import { FALLBACK_MODELS, isImageModel, providerOf, SMART_ROUTER_ID, PROVIDER_ORDER, SMART_ROUTER_PROVIDER, sortModelsInFamily, isFreeModel, supportsVision, supportsFastMode, IMAGE_MODELS, DEFAULT_IMAGE_MODEL, imageModelLabel } from './config.js?v=2026.10.25.1';
import { isJevModel } from './jev.js';
import { ICON, providerIcon } from './icons.js';
import { LOCAL_PROVIDER_ICON_SVG } from './icons.js';
import { ROUTER_ICON_SVG, isSmartRouter, SMART_ROUTER_LABEL, SMART_ROUTER_PROVIDER_LABEL } from './smartrouter.js?v=2026.10.25.1';
import { fetchModels } from './api.js?v=2026.10.25.1';
import { effectiveApiKey } from './adminkey.js';
import { formatRate } from './pricing.js';
import { USD_TO_CNY_RATE, USD_TO_CNY_RATE_DATE } from './currency.js';
import { isNetworkOffline } from './offline-network.js';
import { OFFLINE_MODEL_DISPLAY_NAME, OFFLINE_MODEL_ID, OFFLINE_MODEL_PROVIDER_EN, OFFLINE_MODEL_PROVIDER_ZH, isOfflineModelId } from './offline-model-config.js';
import { formatParameterCount } from './gguf.js';
import { DEFAULT_GATEWAY_ID, gatewayFallbackModels, defaultModelForGateway, gatewayModelListLabel, isModelForGateway } from './gateway-registry.js?v=2026.10.25.1';

export function installModelPicker({ store, agent, toast, getBusy, openKeyModal, rebuildMessages, renderSessions, renderFiles, updateStats, syncCapLine, syncWeb }) {
  // ── 模型下拉 ──
  const ddBtn = $('#model-btn');
  const ddMenu = $('#model-menu');
  const ddSearch = $('#model-search');
  // 网关仍可能返回已下线的福利档；本地兜底表删了也不够，这里再挡一层。
  const HIDDEN_MODELS = new Set(['glm-5.3-flash-free', 'deepseek-v4-flash-free', 'deepseek-flash-free']); // 后两者已从 FALLBACK_MODELS 删除，这里兜底防网关 /v1/models 再塞回来
  const LOCAL_PROVIDER_ICON = LOCAL_PROVIDER_ICON_SVG;
  // 对话模型列表：过滤掉生图模型（只能由主智能体通过 generate_image 工具调用，
  // 直接选中会绕过工具循环、破坏 Agent 特性；网关 /v1/models 里带它们时也照样隐藏）
  function localModelMetadata() {
    return store.state.offlineModelMetadata && typeof store.state.offlineModelMetadata === 'object'
      ? store.state.offlineModelMetadata
      : null;
  }
  function localModelName() {
    const metadata = localModelMetadata();
    return String(metadata?.displayName || localeText(OFFLINE_MODEL_DISPLAY_NAME, 'Local GGUF')).slice(0, 160);
  }
  function localModelDetails() {
    const metadata = localModelMetadata();
    const parts = [];
    if (metadata?.parameterCount) parts.push(formatParameterCount(metadata.parameterCount, 'en'));
    if (metadata?.quantization) parts.push(String(metadata.quantization).slice(0, 32));
    return parts.join(' · ');
  }
  function localModelRecord() {
    return {
      id: OFFLINE_MODEL_ID,
      provider: localeText(OFFLINE_MODEL_PROVIDER_ZH, OFFLINE_MODEL_PROVIDER_EN),
      displayName: localModelName(),
      localModel: true,
      available: store.state.offlineModelAvailable === true,
      contextWindow: 4096,
      localDetails: localModelDetails(),
    };
  }
  function modelPriceTitle(hit) {
    const p = hit?.listPrice;
    if (!p) return hit?.id || '';
    const official = hit.priceSource === 'official';
    const label = official
      ? localeText('供应商官方价目表', 'Official provider rate card')
      : localeText('TeamoRouter 网关标价', 'TeamoRouter gateway list price');
    const cny = `；中文金额按 ${USD_TO_CNY_RATE_DATE} 中间价 1 USD = ¥${USD_TO_CNY_RATE} 折算`;
    const rates = localeText(
      `输入 ${formatRate(p.input, 'zh')} / 输出 ${formatRate(p.output, 'zh')}`
        + (p.cached_input != null ? ` / 缓存命中 ${formatRate(p.cached_input, 'zh')}` : '')
        + (p.cached_input_explicit != null ? ` / 显式缓存命中 ${formatRate(p.cached_input_explicit, 'zh')}` : '')
        + (p.cache_write != null ? ` / 缓存写入 ${formatRate(p.cache_write, 'zh')}` : ''),
      `${formatRate(p.input, 'en')} input / ${formatRate(p.output, 'en')} output`
        + (p.cached_input != null ? ` / ${formatRate(p.cached_input, 'en')} cache hit` : '')
        + (p.cached_input_explicit != null ? ` / ${formatRate(p.cached_input_explicit, 'en')} explicit cache hit` : '')
        + (p.cache_write != null ? ` / ${formatRate(p.cache_write, 'en')} cache write` : ''),
    );
    const note = localeText(hit.priceNote || '', hit.priceNoteEn || '');
    return localeText(
      `${label}（核验 ${MODEL_CATALOG_DATE}${official ? cny : ''}）：${rates}，每百万 token；${note}`
        + (official ? ' 实际账单可能因地区、服务档位或网关而异。' : ' 实际账单以网关为准。'),
      `${label} (checked ${MODEL_CATALOG_DATE}): ${rates} per million tokens; ${note}`
        + (official ? ' Actual billing may vary by region, service tier, or gateway.' : ' Final billing is determined by the gateway.'),
    );
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
      const isLocalGroup = groups.get(p).some((model) => model.localModel);
      const groupIcon = customProviderModel
        ? providerIcon(p, { custom: true, iconDataUrl: customProviderModel.providerIconDataUrl })
        : (isLocalGroup ? LOCAL_PROVIDER_ICON : providerIcon(p));
      const groupLabel = isRouterGroup
        ? SMART_ROUTER_PROVIDER_LABEL
        : (isLocalGroup ? 'LOCAL' : p);
      g.appendChild(el('div', 'dd-group-title', `${isRouterGroup ? `<span class="router-group-ico">${ROUTER_ICON_SVG}</span>` : groupIcon}<span>${esc(groupLabel)}</span>`));
      for (const m of sortModelsInFamily(groups.get(p))) {
        const item = el('button', 'dd-item' + (m.id === store.state.model ? ' active' : ''));
        item.type = 'button';
        const hit = m;
        if (hit.localModel && !hit.available) {
          item.disabled = true;
          item.title = localeText('尚未选择本地 GGUF；请先在设置 → 离线本地模型中选择文件。', 'No local GGUF is selected. Choose a file in Settings → Offline local model first.');
        }
        const local = !!hit.localModel;
        const free = !local && isFreeModel(m.id);
        const hot = !local && !!hit.hot;
        const cheap = !local && (!!hit.cheap || free);
        const cheapBadgeTitle = localeText(
          `目录低价标签阈值：输入≤${formatRate(1, 'zh')}/M、输出≤${formatRate(5, 'zh')}/M（按 ${USD_TO_CNY_RATE_DATE} 中间价折算；非实时账单价）`,
          `Curated cheap-tag threshold: input ≤ ${formatRate(1, 'en')}/M and output ≤ ${formatRate(5, 'en')}/M; not a live bill.`,
        );
        // 本地模型名称、参数量与量化来自用户选择的 GGUF 元数据；未做独立性能评测。
        item.title = local
          ? (hit.available
            ? localeText(`本机 GGUF · ${localModelDetails() || '参数量未知'} · 仅本机推理，不请求网关。`, `Local GGUF · ${localModelDetails() || 'parameter count unknown'} · local inference; no gateway request.`)
            : localeText('尚未选择本地 GGUF；请先在设置 → 离线本地模型中选择文件。', 'No local GGUF is selected. Choose a file in Settings → Offline local model first.'))
          : modelPriceTitle(hit);
        const isRouter = isSmartRouter(m.id);
        item.innerHTML = isRouter
          ? `<span class="dd-item-id mono router-name">${esc(SMART_ROUTER_LABEL)}</span>
            <span class="dd-item-badges">
              <span class="badge hot" title="${localeText('按任务类型 / 难度自动选模型', 'Auto-selects a model by task type and difficulty')}">${localeText('自动', 'Auto')}</span>
            </span>`
          : (local
            ? `<span class="dd-item-id mono">${esc(localModelName())}</span>
              <span class="dd-item-badges">
                <span class="badge local-model-badge">${localeText('本地', 'Local')}</span>
              </span>`
            : `<span class="dd-item-id mono">${esc(m.id)}</span>
              <span class="dd-item-badges">
                ${hot ? `<span class="badge hot" title="${localeText('应用预设热门精选，非实时使用热度或质量实测排行', 'App-curated popular pick, not live usage popularity or benchmark rank')}">${localeText('热门', 'Popular')}</span>` : ''}
                ${free ? '<span class="badge">FREE</span>' : (cheap ? `<span class="badge cheap" title="${esc(cheapBadgeTitle)}">${localeText('低价', 'Cheap')}</span>` : '')}
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
  function enterSystem(prevModel) {
    if (preSystem) return;
    // 记住进入前的模型：新建 / 切换会话时要切回它（或会话自己的模型）
    preSystem = { model: prevModel, messages: store.state.messages, checkpoints: store.state.checkpoints, files: store.state.files };
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
  }
  // 退出 /system 通道并恢复进入前的模型（新建、切换会话时调用；会话列表不再锁定）
  function leaveSystemChannel() {
    if (!preSystem) return false;
    const back = preSystem.model && preSystem.model !== '__system__' ? preSystem.model : store.state.model;
    store.state.model = back;
    exitSystem();
    store.notify();
    applySystemLock();
    updateModelBtn();
    return true;
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
      const prevModel = store.state.model;
      store.state.model = id;
      enterSystem(prevModel);
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
      // 与模型菜单的本地分组保持一致：图标用同一个 LOCAL 图标，文字统一为 LOCAL
      icon = LOCAL_PROVIDER_ICON;
      name = localModelName();
      if (!store.state.offlineModelAvailable) name += ` · ${localeText('未选择', 'not selected')}`;
      prov = 'LOCAL';
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
  onLanguageChange(() => { if (!ddMenu.hidden) renderModelMenu(); });
  onCurrencyChange(() => { if (!ddMenu.hidden) renderModelMenu(); });
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
      if (!silent) toast(localeText('离线时不检查网关模型列表；可在设置中选择本地 GGUF 文件。', 'Gateway model lists are not checked offline; choose a local GGUF file in settings.'), 'warn');
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

  return { inSystem, isSystemIsolated, leaveSystemChannel, selectModel, chatModels, updateModelBtn, renderModelMenu, refreshModels, syncGateway };
}
