import { installModerationSetting } from './ui-moderation-setting.js';
import { updateScriptCache } from './cache-update.js';
import { syncOfflineModelAvailability, downloadOfflineModel, removeOfflineModel, formatOfflineDownloadProgress } from './offline-model.js';
import { OFFLINE_MODEL_DISPLAY_NAME, OFFLINE_MODEL_ID, OFFLINE_MODEL_FILE, OFFLINE_MODEL_SIZE_BYTES, OFFLINE_MODEL_SHA256, OFFLINE_MODEL_REPO, OFFLINE_MODEL_REVISION, formatDownloadBytes } from './offline-model-config.js';
import { isNetworkOffline } from './offline-network.js';
import { providerIcon } from './icons.js';
import { sanitizeSvgMarkup, svgDataUrl } from './svg-safety.js';
import { text as localeText } from './locale.js';
import { getOrCreateUserSalutation, validateUserSalutation, saveUserSalutation } from './user-salutation.js';
import { getLanguage, onLanguageChange } from './locale.js';
// 设置弹窗：API Key / 中继地址 / 主题 / 字号 / 沙箱 / 联网 / 快速 / 思考 / 识图·音视频解析模型 / 清空数据 / 关于
import { APP_RELEASE, APP_VERSION, STORAGE_KEY, VISION_MODELS, VIDEO_MODELS, IMAGE_MODELS, DEFAULT_IMAGE_MODEL, isImageGenModel, imageModelLabel, resolveVisionModel, resolveVideoModel } from './config.js?v=2026.10.11.1';
import { DEFAULT_GATEWAY_ID, getGateway, validateGatewayApiKey, validateGatewayBaseUrl, gatewayModelListLabel, defaultModelForGateway } from './gateway-registry.js?v=2026.10.11.1';
import { currentRelay, resetRelayProbe, RELAY_OVERRIDE_KEY } from './net.js';
import { DEFAULT_TURN_BUDGET } from './execution.js?v=2026.10.11.1';
import { NEXUS_ARCHITECTURE_SPEC } from './nexus.js';
import { readLocal, writeLocal, removeLocal } from './legacy-keys.js';

const FONT_SIZE_KEY = 'dubhe-fontsize';
const MOTION_KEY = 'dubhe-motion'; // 'auto' | 'on' | 'off'：auto = 跟随系统 prefers-reduced-motion
import { writeThemePreference } from './theme.js';

const $ = (sel) => document.querySelector(sel);
let manualModelEditingId = '';
let manualModelIconDraft = '';
let offlineModelStore = null;
let offlineDownloadController = null;
let offlineModelDownloadBusy = false;
let offlineModelStatusChecking = false;
let offlineDownloadProgress = null;
let salutationCheckTimer = null;

const ADMIN_PREFIX = 'admin-';
const isAdmin = (s) => String(s || '').startsWith(ADMIN_PREFIX);
function validateApiKey(s, gatewayId = DEFAULT_GATEWAY_ID) {
  const v = String(s || '').trim();
  if (isAdmin(v)) return gatewayId === DEFAULT_GATEWAY_ID ? { ok: true } : { ok: false, reason: '管理员别名只适用于 TeamoRouter' };
  return validateGatewayApiKey(gatewayId, v);
}
function toast(msg, type = 'info', ms = 2600) {
  try {
    import('./ui.js?v=2026.10.11.1').then(({ toast: t }) => t && t(msg, type, ms)).catch(() => {
      const wrap = document.getElementById('toasts');
      if (!wrap) return;
      const d = document.createElement('div');
      d.className = `toast ${type} in`;
      d.textContent = msg;
      wrap.appendChild(d);
      setTimeout(() => { d.classList.remove('in'); d.classList.add('leaving'); setTimeout(() => d.remove(), 400); }, ms);
    });
  } catch {}
}

function renderOfflineModelUI(status = null) {
  const statusEl = $('#set-offline-model-status');
  const downloadBtn = $('#set-offline-model-download');
  const cancelBtn = $('#set-offline-model-cancel');
  const removeBtn = $('#set-offline-model-remove');
  const progressWrap = $('#set-offline-model-progress-wrap');
  const progress = $('#set-offline-model-progress');
  const progressLabel = $('#set-offline-model-progress-label');
  const heading = $('#set-offline-model-heading');
  const title = $('#set-offline-model-title');
  const description = $('#set-offline-model-description');
  const provenance = $('#set-offline-model-provenance');
  const license = $('#set-offline-model-license');
  const fileInfo = $('#set-offline-model-file');
  const hashInfo = $('#set-offline-model-hash');
  const repoLink = $('#set-offline-model-repo');
  if (heading) heading.textContent = localeText('离线本地模型', 'Offline local model');
  if (title) title.textContent = OFFLINE_MODEL_DISPLAY_NAME;
  if (description) description.textContent = localeText(`可选 · 约 ${formatDownloadBytes(OFFLINE_MODEL_SIZE_BYTES)} · 本机推理`, `Optional · about ${formatDownloadBytes(OFFLINE_MODEL_SIZE_BYTES)} · runs locally`);
  if (provenance) provenance.textContent = localeText('仓库的 heretic / uncensored 标签是社区自述，非独立测评。', 'The repository’s “heretic / uncensored” labels are self-descriptions, not independent evaluations.');
  if (license) license.textContent = localeText('模型仓库元数据声明 Apache-2.0；请查看仓库与上游说明。', 'The model repository metadata declares Apache-2.0; review the repository and upstream notices.');
  if (fileInfo) fileInfo.textContent = `${OFFLINE_MODEL_FILE} · ${formatDownloadBytes(OFFLINE_MODEL_SIZE_BYTES)} · rev ${OFFLINE_MODEL_REVISION.slice(0, 12)}`;
  if (hashInfo) { hashInfo.textContent = `SHA-256 ${OFFLINE_MODEL_SHA256.slice(0, 12)}…`; hashInfo.title = OFFLINE_MODEL_SHA256; }
  if (repoLink) { repoLink.textContent = localeText('查看固定版本仓库', 'View pinned repository revision'); repoLink.href = `https://huggingface.co/${OFFLINE_MODEL_REPO}/tree/${OFFLINE_MODEL_REVISION}`; }
  if (cancelBtn) cancelBtn.textContent = localeText('取消', 'Cancel');
  if (removeBtn) removeBtn.textContent = localeText('删除本地模型', 'Remove local model');
  if (!statusEl || !offlineModelStore) return;
  const offline = isNetworkOffline();
  const available = status?.available ?? offlineModelStore.state.offlineModelAvailable === true;
  const supported = status?.supported ?? offlineModelStore.state.offlineModelStorageSupported === true;
  const partialBytes = Math.max(0, Number(status?.partialBytes ?? offlineModelStore.state.offlineModelPartialBytes) || 0);
  if (offlineModelStatusChecking && !offlineModelDownloadBusy) {
    if (progressWrap) progressWrap.hidden = true;
    statusEl.textContent = localeText('正在检查已保存的下载进度…', 'Checking saved download progress…');
  } else if (offlineDownloadProgress && offlineModelDownloadBusy) {
    const p = formatOfflineDownloadProgress(offlineDownloadProgress);
    const verifying = offlineDownloadProgress.phase === 'verify';
    if (progressWrap) progressWrap.hidden = false;
    if (progress) progress.value = p.percent;
    if (progressLabel) progressLabel.textContent = `${verifying ? localeText('校验', 'Verify') : localeText('下载', 'Download')} ${p.percent}% · ${p.loadedText} / ${p.totalText}`;
    statusEl.textContent = verifying
      ? localeText('下载完成，正在逐块校验模型 SHA-256…', 'Download complete; streaming the model file to verify its SHA-256…')
      : localeText('正在下载 GGUF 到本机浏览器存储…', 'Downloading the GGUF into this browser’s local storage…');
  } else {
    if (progressWrap) progressWrap.hidden = true;
    if (available) statusEl.textContent = localeText(`已安装 · ${formatDownloadBytes(status?.size || OFFLINE_MODEL_SIZE_BYTES)} · 本地推理不请求网关`, `Installed · ${formatDownloadBytes(status?.size || OFFLINE_MODEL_SIZE_BYTES)} · local inference does not call a gateway`);
    else if (!offlineModelStore.state.offlineModelChecked) statusEl.textContent = localeText('正在检查本机模型存储…', 'Checking local model storage…');
    else if (partialBytes >= OFFLINE_MODEL_SIZE_BYTES) statusEl.textContent = localeText('文件已下载 · SHA-256 校验待完成 · 点击继续校验', 'File downloaded · SHA-256 verification is pending · click to verify');
    else if (partialBytes > 0) {
      const p = formatOfflineDownloadProgress({ loaded: partialBytes, total: OFFLINE_MODEL_SIZE_BYTES });
      statusEl.textContent = localeText(`已下载 ${p.loadedText} / ${p.totalText} · 再次点击将从此处续传`, `Downloaded ${p.loadedText} / ${p.totalText} · click again to resume`);
    }
    else if (offline) statusEl.textContent = localeText('当前离线：模型未安装时不会下载或尝试联网。', 'Offline: an uninstalled model will not be downloaded or fetched.');
    else if (!supported) statusEl.textContent = localeText('此浏览器或页面环境不支持本地 OPFS 模型存储；请用 HTTPS / localhost 的现代浏览器。', 'This browser/page does not support local OPFS model storage; use a modern browser over HTTPS or localhost.');
    else if (offlineModelStore.state.offlineModelStatusError) statusEl.textContent = offlineModelStore.state.offlineModelStatusError;
    else statusEl.textContent = localeText(`未安装 · 需约 ${formatDownloadBytes(OFFLINE_MODEL_SIZE_BYTES)} 空间 · 点击后才开始下载`, `Not installed · about ${formatDownloadBytes(OFFLINE_MODEL_SIZE_BYTES)} storage · download starts only after clicking`);
  }
  if (downloadBtn) {
    downloadBtn.hidden = available;
    downloadBtn.disabled = offline || !supported || offlineModelDownloadBusy || offlineModelStatusChecking;
    downloadBtn.textContent = offlineModelStatusChecking && !offlineModelDownloadBusy
      ? localeText('检查下载进度…', 'Checking progress…')
      : offlineModelDownloadBusy
        ? localeText(offlineDownloadProgress?.phase === 'verify' ? '正在校验…' : '下载中…', offlineDownloadProgress?.phase === 'verify' ? 'Verifying…' : 'Downloading…')
        : partialBytes >= OFFLINE_MODEL_SIZE_BYTES
        ? localeText('继续校验模型', 'Continue model verification')
        : partialBytes > 0
          ? localeText('继续下载模型', 'Resume model download')
          : localeText(`下载模型（约 ${formatDownloadBytes(OFFLINE_MODEL_SIZE_BYTES)}）`, `Download model (about ${formatDownloadBytes(OFFLINE_MODEL_SIZE_BYTES)})`);
  }
  if (cancelBtn) { cancelBtn.hidden = !offlineModelDownloadBusy; cancelBtn.disabled = !offlineModelDownloadBusy; }
  if (removeBtn) { removeBtn.hidden = !available && !partialBytes; removeBtn.disabled = offlineModelDownloadBusy; }
}

async function refreshOfflineModelUI(store = offlineModelStore) {
  if (!store) return null;
  offlineModelStore = store;
  offlineModelStatusChecking = true;
  let status = null;
  try {
    status = await syncOfflineModelAvailability(store, { notify: false });
    return status;
  } finally {
    offlineModelStatusChecking = false;
    renderOfflineModelUI(status);
  }
}

function syncSeg(sel, v) {
  const host = document.querySelector(sel);
  if (!host) return;
  host.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

async function relayCheck() {
  if (isNetworkOffline()) return localeText('离线状态：不探测中继。', 'Offline: relay probing is disabled.');
  try {
    const override = readLocal(RELAY_OVERRIDE_KEY) || '';
    resetRelayProbe();
    const { relayAvailable } = await import('./net.js');
    const ok = await relayAvailable();
    const after = currentRelay();
    if (ok && after) {
      return after.label === 'origin' ? '同源中继可用（本地 server.py / Pages Functions）' : `已连接：${after.base}`;
    }
    return override ? `自定义地址不可用：${override}` : '未检测到中继（网页抓取工具将被禁用）';
  } catch (e) { return '探测失败：' + (e.message || e); }
}

// 模型档位的 tag/note 有中英两版：英文界面不再出现「均衡 / 默认 / 效果最好」这类中文后缀。
function modelMeta(m, language) {
  return language === 'en'
    ? { tag: m.tagEn || m.tag, note: m.noteEn || m.note }
    : { tag: m.tag, note: m.note };
}
function fillModelSelect(el, list, current) {
  if (!el) return;
  const language = getLanguage();
  el.dataset.lang = language;
  if (el.options.length !== list.length || el._lang !== language) {
    el._lang = language;
    el.innerHTML = '';
    for (const m of list) {
      const { tag, note } = modelMeta(m, language);
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.label} · ${tag}`;
      opt.title = `${m.id} · ${note}`;
      el.appendChild(opt);
    }
  }
  el.value = current;
}

function syncMultimodalSelects(store) {
  const settings = (store && store.state && store.state.settings) || {};
  const vision = resolveVisionModel(settings.visionModel);
  // 音视频解析模型已合并为一个设置：videoModel 为存档主键，audioModel 与其保持同值（兼容旧快照与工具 ctx）
  const av = resolveVideoModel(settings.videoModel || settings.audioModel);
  // 生图模型随会话保存（store.state.imageModel），不在 settings 里；不在目录内的值退回默认
  const image = isImageGenModel(store && store.state && store.state.imageModel) ? store.state.imageModel : DEFAULT_IMAGE_MODEL;
  fillModelSelect($('#set-image-model'), IMAGE_MODELS, image);
  fillModelSelect($('#set-vision-model'), VISION_MODELS, vision);
  fillModelSelect($('#set-av-model'), VIDEO_MODELS, av);
  const note = $('#set-mm-note');
  if (note) {
    const vi = VISION_MODELS.find((m) => m.id === vision) || {};
    const vd = VIDEO_MODELS.find((m) => m.id === av) || {};
    const im = IMAGE_MODELS.find((m) => m.id === image) || {};
    note.textContent = `${im.label || image} · ${vi.label || vision} · ${vd.label || av}`;
  }
}

function syncBudgetInputs(store) {
  const eb = (store.state.settings && store.state.settings.executionBudget) || {};
  const ext = Number.isFinite(Number(eb.maxExternalSideEffects)) ? Number(eb.maxExternalSideEffects) : DEFAULT_TURN_BUDGET.maxExternalSideEffects;
  const tc = Number.isFinite(Number(eb.maxToolCalls)) ? Number(eb.maxToolCalls) : DEFAULT_TURN_BUDGET.maxToolCalls;
  if ($('#set-budget-ext')) $('#set-budget-ext').value = String(ext);
  if ($('#set-budget-tools')) $('#set-budget-tools').value = String(tc);
  const note = $('#set-budget-note');
  if (note) {
    const custom = ext !== DEFAULT_TURN_BUDGET.maxExternalSideEffects || tc !== DEFAULT_TURN_BUDGET.maxToolCalls;
    note.textContent = custom
      ? `自定义（默认 ${DEFAULT_TURN_BUDGET.maxExternalSideEffects} / ${DEFAULT_TURN_BUDGET.maxToolCalls}）`
      : '默认值';
  }
}

function renderManualModelList(store) {
  const row = $('#set-manual-model-list-row');
  const host = $('#set-manual-model-list');
  const gatewayId = store?.state?.gatewayId || DEFAULT_GATEWAY_ID;
  if (!row || !host) return;
  host.replaceChildren();
  const saved = (store.state.manualModelsByGateway || {}).custom;
  const meta = (store.state.manualModelMetaByGateway || {}).custom || {};
  const ids = gatewayId === 'custom' && Array.isArray(saved)
    ? saved.filter((id) => typeof id === 'string' && id.trim())
    : [];
  row.hidden = gatewayId !== 'custom' || ids.length === 0;
  for (const id of ids) {
    const chip = document.createElement('span');
    chip.className = 'manual-model-chip';
    const mark = document.createElement('span');
    mark.className = 'manual-model-provider-mark';
    const providerName = String(meta[id]?.providerName || '').trim() || localeText('自定义供应商', 'Custom provider');
    mark.innerHTML = providerIcon(providerName, { custom: true, iconDataUrl: meta[id]?.iconDataUrl || '' });
    const detail = document.createElement('span');
    detail.className = 'manual-model-provider-detail';
    const name = document.createElement('span');
    name.className = 'manual-model-provider-name';
    name.textContent = providerName;
    const code = document.createElement('code');
    code.textContent = id;
    detail.append(name, code);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'manual-model-edit';
    edit.dataset.editManualModel = id;
    edit.textContent = localeText('编辑供应商', 'Edit provider');
    edit.title = localeText(`编辑 ${id} 的供应商名称与图标`, `Edit provider name and icon for ${id}`);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'manual-model-remove';
    remove.dataset.removeManualModel = id;
    remove.textContent = '×';
    remove.title = localeText(`删除模型 ${id}`, `Remove model ${id}`);
    remove.setAttribute('aria-label', localeText(`删除模型 ${id}`, `Remove model ${id}`));
    chip.append(mark, detail, edit, remove);
    host.appendChild(chip);
  }
}

function normalizeManualProviderName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
}
function paintManualProviderPreview(name, iconDataUrl = '') {
  const preview = $('#set-manual-provider-icon-preview');
  if (preview) preview.innerHTML = providerIcon(normalizeManualProviderName(name) || localeText('自定义供应商', 'Custom provider'), { custom: true, iconDataUrl });
}
function resetManualModelEditor() {
  manualModelEditingId = '';
  manualModelIconDraft = '';
  const model = $('#set-manual-model');
  if (model) { model.value = ''; model.disabled = false; }
  const provider = $('#set-manual-provider-name');
  if (provider) provider.value = '';
  const file = $('#set-manual-provider-icon');
  if (file) file.value = '';
  paintManualProviderPreview('', '');
  const add = $('#set-add-model');
  if (add) add.textContent = localeText('添加模型', 'Add model');
  const cancel = $('#set-cancel-manual-model-edit');
  if (cancel) cancel.hidden = true;
  const clearIcon = $('#set-clear-provider-icon');
  if (clearIcon) clearIcon.hidden = true;
}
function beginManualModelEdit(store, id) {
  const meta = ((store.state.manualModelMetaByGateway || {}).custom || {})[id] || {};
  manualModelEditingId = id;
  manualModelIconDraft = String(meta.iconDataUrl || '');
  const model = $('#set-manual-model');
  if (model) { model.value = id; model.disabled = true; }
  const provider = $('#set-manual-provider-name');
  if (provider) provider.value = String(meta.providerName || '');
  const file = $('#set-manual-provider-icon');
  if (file) file.value = '';
  paintManualProviderPreview(meta.providerName, manualModelIconDraft);
  const add = $('#set-add-model');
  if (add) add.textContent = localeText('保存供应商', 'Save provider');
  const cancel = $('#set-cancel-manual-model-edit');
  if (cancel) cancel.hidden = false;
  const clearIcon = $('#set-clear-provider-icon');
  if (clearIcon) clearIcon.hidden = false;
}
async function manualProviderIconFromFile(file) {
  if (!file) return '';
  if (file.size > 128 * 1024) throw new Error(localeText('图标文件不能超过 128 KB。', 'Provider icons must be 128 KB or smaller.'));
  const name = String(file.name || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  if (mime === 'image/svg+xml' || name.endsWith('.svg') || mime === 'text/plain' || name.endsWith('.txt')) {
    const source = await file.text();
    if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg\b/i.test(source)) throw new Error(localeText('文本图标必须是 SVG 源码。', 'A text icon must contain SVG source.'));
    const dataUrl = svgDataUrl(sanitizeSvgMarkup(source, { maxChars: 180000 }));
    if (dataUrl.length > 280000) throw new Error(localeText('清理后的 SVG 过大；请使用更精简的图标。', 'The sanitized SVG is too large; use a more compact icon.'));
    return dataUrl;
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error(localeText('图标仅支持 PNG、JPEG、WebP 或 SVG。', 'Icons must be PNG, JPEG, WebP, or SVG.'));
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(localeText('图标文件读取失败。', 'Could not read the icon file.')));
    reader.readAsDataURL(file);
  });
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(dataUrl)) throw new Error(localeText('图标数据无效。', 'Invalid icon data.'));
  return dataUrl;
}

function syncGatewayFields(store) {
  const id = store.state.gatewayId || DEFAULT_GATEWAY_ID;
  const spec = getGateway(id);
  const selector = $('#set-gateway');
  if (selector) selector.value = id;
  const keyTitle = $('#set-key-title');
  if (keyTitle) keyTitle.textContent = spec.keyLabel || `${spec.name} API Key`;
  const key = $('#set-key');
  if (key) {
    key.value = store.state.apiKey || '';
    key.placeholder = spec.keyHint || 'API Key';
  }
  const base = $('#set-gateway-base');
  if (base) {
    base.value = (store.state.gatewayBaseUrls || {})[id] || '';
    base.placeholder = spec.baseUrl || 'https://api.example.com/v1';
  }
  const note = $('#set-gateway-note');
  if (note) note.textContent = gatewayModelListLabel(id);
  const manualRow = $('#set-manual-model-row');
  if (manualRow) manualRow.hidden = id !== 'custom';
  const providerRow = $('#set-manual-provider-row');
  if (providerRow) providerRow.hidden = id !== 'custom';
  const manual = $('#set-manual-model');
  if (manual) { manual.value = ''; manual.disabled = id !== 'custom'; }
  const addModelButton = $('#set-add-model');
  if (addModelButton) addModelButton.disabled = id !== 'custom';
  renderManualModelList(store);
}

function paintSalutationCopy() {
  const language = getLanguage();
  const title = $('#set-user-salutation-title'), note = $('#set-user-salutation-note');
  const input = $('#set-user-salutation'), save = $('#save-user-salutation');
  if (title) title.textContent = localeText('用户称谓', 'What should we call you?');
  if (note) note.textContent = localeText('最多 8 个字符；本地强制审核每秒刷新。默认称谓随机生成并保存在此设备。', 'Up to 8 characters. A mandatory local review refreshes every second. A random default is saved on this device.');
  if (input) { input.placeholder = localeText('输入称谓', 'Your name'); input.setAttribute('aria-label', localeText('用户称谓', 'Your name')); }
  if (save) save.textContent = localeText('保存称谓', 'Save name');
  return language;
}

function refreshSalutationCheck(store) {
  const input = $('#set-user-salutation'), status = $('#set-user-salutation-status'), save = $('#save-user-salutation');
  if (!input || !status) return null;
  const settings = store?.state?.settings || {};
  const current = getOrCreateUserSalutation(settings.userSalutation, { language: getLanguage() });
  settings.userSalutation = current;
  const result = validateUserSalutation(input.value);
  const saved = result.ok && result.value === current;
  status.classList.toggle('available', result.ok);
  status.classList.toggle('unavailable', !result.ok);
  status.textContent = result.ok ? localeText('✓ 可用', '✓ Available') : localeText('✗ 不可用', '✗ Unavailable');
  status.title = result.ok ? localeText('通过本地称谓审核', 'Passed local salutation review') : result.reason;
  input.setAttribute('aria-invalid', String(!result.ok));
  if (save) {
    save.disabled = !result.ok || saved;
    save.textContent = saved ? localeText('已保存', 'Saved') : localeText('保存称谓', 'Save name');
  }
  return result;
}

function syncSalutationField(store) {
  const input = $('#set-user-salutation');
  if (!input) return;
  const settings = store.state.settings || (store.state.settings = {});
  input.value = getOrCreateUserSalutation(settings.userSalutation, { language: getLanguage() });
  settings.userSalutation = input.value;
  paintSalutationCopy();
  refreshSalutationCheck(store);
}

export function openSettingsModal({ store } = {}) {
  const m = $('#settings-modal');
  if (!m || !store) return;
  offlineModelStore = store;
  syncGatewayFields(store);
  syncSalutationField(store);
  const downloadBtn = $('#set-offline-model-download');
  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.textContent = localeText('检查下载进度…', 'Checking progress…');
  }
  refreshOfflineModelUI(store).catch((error) => {
    store.state.offlineModelStatusError = error?.message || String(error);
    renderOfflineModelUI();
  });
  $('#set-relay').value = readLocal(RELAY_OVERRIDE_KEY) || '';
  syncSeg('#set-theme', store.state.settings.theme || 'light');
  syncSeg('#set-fontsize', document.documentElement.dataset.fontsize || 'medium');
  syncSeg('#set-motion', readMotionPreference());
  paintMotionNote();
  $('#set-sandbox').checked = store.state.settings.sandboxEnabled !== false;
  if ($('#set-cpp')) $('#set-cpp').checked = store.state.settings.remoteCppEnabled !== false;
  $('#set-web').checked = store.state.settings.webEnabled !== false;
  $('#set-fast').checked = !!store.state.settings.fastMode;
  if ($('#set-image-review')) $('#set-image-review').checked = store.state.settings.imageRemoteReview !== false;
  if ($('#set-cleanup-unreferenced')) $('#set-cleanup-unreferenced').checked = store.state.settings.cleanupUnreferencedFiles === true;
  $('#set-thinking').checked = store.state.settings.thinking !== false;
  syncSeg('#set-reason', store.state.settings.reasoningLevel || 'medium');
  syncBudgetInputs(store);
  syncMultimodalSelects(store);
  $('#set-about-ver').textContent = APP_RELEASE;
  $('#set-about-build').textContent = APP_VERSION;
  if ($('#set-about-arch')) $('#set-about-arch').textContent = `${NEXUS_ARCHITECTURE_SPEC.name.split('（')[0]} · ${NEXUS_ARCHITECTURE_SPEC.codename.short}（${NEXUS_ARCHITECTURE_SPEC.codename.zh}）`;
  const rel = currentRelay();
  $('#set-about-relay').textContent = rel ? (rel.label === 'origin' ? '同源 /api' : rel.base) : '未连接';
  try {
    let raw = '';
    for (const key of [`${STORAGE_KEY}-v2`, STORAGE_KEY]) {
      const value = localStorage.getItem(key);
      if (value) { raw = value; break; }
    }
    let saved = {};
    try { saved = raw ? JSON.parse(raw) : {}; } catch { saved = {}; }
    const sessions = Array.isArray(store.state.sessions)
      ? store.state.sessions
      : (Array.isArray(saved.sessions) ? saved.sessions : []);
    let bytes = raw.length;
    try { bytes = new TextEncoder().encode(raw).byteLength; } catch { /* 旧浏览器按字符长度估算 */ }
    const size = Math.round(bytes / 1024);
    $('#set-about-store').textContent = `${sessions.length} 个会话 · ~${size}KB`;
  } catch { $('#set-about-store').textContent = '—'; }
  m.classList.add('open');
  setTimeout(() => $('#set-key').focus(), 100);
  if (isNetworkOffline()) {
    const relay = $('#set-relay-msg');
    if (relay) relay.textContent = localeText('离线状态：不探测中继。', 'Offline: relay probing is disabled.');
    const build = $('#set-about-commit');
    if (build) build.textContent = localeText('离线状态：不检查更新或构建清单。', 'Offline: update and build-manifest checks are disabled.');
  } else {
    relayCheck().then((msg) => { const el = $('#set-relay-msg'); if (el) el.textContent = msg; });
    loadBuildInfo().then((info) => paintBuildInfo($('#set-about-commit'), info, APP_VERSION));
  }
}

// ── 部署提交（P7 供应链可验证性）：读同源 build.json（Pages 部署时由 tools/build-manifest.mjs 生成）──
// 显示 commit 短 sha + 文件数 + 清单摘要；若清单里的版本号与当前运行的 APP_VERSION 不一致，说明浏览器缓存
// 与线上部署不是同一份（或有人改了文件却没走 Pages 流程），要明说。本地 file:// / 开发服务器没有 build.json 时显示「非 Pages 部署」。
let buildInfoCache = null;
export async function loadBuildInfo({ fetchImpl = (typeof fetch === 'function' ? fetch : null), url = 'build.json' } = {}) {
  if (isNetworkOffline()) return { ok: false, reason: 'offline' };
  if (buildInfoCache) return buildInfoCache;
  if (!fetchImpl) return { ok: false, reason: 'no-fetch' };
  try {
    const res = await fetchImpl(`${url}?x=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const j = await res.json();
    if (!j || j.schema !== 'dubhe-build-manifest/1' || !j.commit) return { ok: false, reason: 'bad-schema' };
    buildInfoCache = { ok: true, commit: String(j.commit), version: String(j.version || ''), fileCount: Number(j.file_count) || 0, manifestSha: String(j.manifest_sha256 || ''), builtAt: String(j.built_at || ''), repository: String(j.repository || 'imfufuu/dubhe-agent') };
    return buildInfoCache;
  } catch { return { ok: false, reason: 'network' }; }
}
export function formatBuildInfo(info, appVersion) {
  if (!info || !info.ok) {
    if (info?.reason === 'offline') return { text: '离线状态：未检查部署清单', mismatch: false, href: '' };
    return { text: info && info.reason === 'http-404' ? '非 Pages 部署（无 build.json）' : '未知（拉不到 build.json）', mismatch: false, href: '' };
  }
  const short = info.commit.slice(0, 12);
  const mismatch = !!(info.version && appVersion && info.version !== appVersion);
  // 一行放得下：短 sha · 文件数 · 清单前 8 位（整段可悬停 / 点击看全量）；不匹配时另起说明
  const text = `${short} · ${info.fileCount} 文件 · 清单 ${info.manifestSha.slice(0, 8)}${mismatch ? ` ⚠ 线上 ${info.version} / 本页 ${appVersion}，请强刷` : ''}`;
  return { text, mismatch, href: `https://github.com/${info.repository}/commit/${info.commit}` };
}
function paintBuildInfo(el, info, appVersion) {
  if (!el) return;
  const f = formatBuildInfo(info, appVersion);
  el.textContent = '';
  if (f.href) {
    const a = document.createElement('a');
    a.href = f.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = f.text;
    el.appendChild(a);
  } else el.textContent = f.text;
  el.classList.toggle('warn', f.mismatch);
}

export function closeSettingsModal() {
  const m = $('#settings-modal');
  if (m) m.classList.remove('open');
}

function bindSeg(sel, onChange) {
  const host = document.querySelector(sel);
  if (!host) return;
  host.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    host.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    onChange && onChange(b.dataset.v);
  });
}

export function mountSettings(store, { onRelayChanged, onKeySaved, onSettingChanged, onGatewayChanged } = {}) {
  offlineModelStore = store;
  renderOfflineModelUI();
  const syncNetworkControls = () => {
    const offline = isNetworkOffline();
    const update = $('#set-update-cache');
    const clear = $('#set-clear-cache');
    if (update) update.disabled = offline;
    if (clear) clear.disabled = offline;
    for (const selector of ['#set-web', '#set-cpp', '#set-image-review', '#set-relay']) {
      const control = $(selector);
      if (control) control.disabled = offline;
    }
    if (offline && $('#set-cache-update-status')) $('#set-cache-update-status').textContent = localeText('离线状态：不检查更新，也不清除离线应用资源。', 'Offline: update checks are disabled and cached app resources are preserved.');
  };
  syncNetworkControls();
  window.addEventListener('dubhe:network-state', (event) => {
    if (event.detail?.offline) offlineDownloadController?.abort();
    renderOfflineModelUI();
    syncNetworkControls();
  });
  window.addEventListener('dubhe:offline-model-status', (event) => renderOfflineModelUI(event.detail));
  // 设置页改了开关 / 档位 / 主题后通知外部（main.js → ui.syncToolbar）：顶栏 pill、能力行、主题按钮要跟着变，
  // 不然「设置里开了快速模式，会话区那颗 ⚡ 还是灰的」（.27 修）
  const changed = (key, value) => { try { onSettingChanged && onSettingChanged(key, value); } catch { /* 不影响设置本身 */ } };
  const moderationSetting = installModerationSetting({ store, changed });
  const btn = $('#settings-btn');
  if (btn) btn.addEventListener('click', () => openSettingsModal({ store }));
  $('#settings-close').addEventListener('click', closeSettingsModal);
  $('#settings-done').addEventListener('click', closeSettingsModal);
  const m = $('#settings-modal');
  m.addEventListener('click', (e) => { if (e.target === m) closeSettingsModal(); });
  document.addEventListener('keydown', (e) => {
    if (!m.classList.contains('open')) return;
    if (e.key === 'Escape') closeSettingsModal();
  });

  const salutationInput = $('#set-user-salutation');
  const salutationSave = $('#save-user-salutation');
  if (salutationInput) {
    const refreshSalutation = () => refreshSalutationCheck(store);
    salutationInput.addEventListener('input', refreshSalutation);
    salutationInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (salutationSave && !salutationSave.disabled) salutationSave.click();
    });
    salutationSave?.addEventListener('click', () => {
      const result = saveUserSalutation(salutationInput.value);
      if (!result.ok) { refreshSalutation(); return; }
      store.state.settings.userSalutation = result.value;
      salutationInput.value = result.value;
      store.notify();
      refreshSalutation();
      try { window.dispatchEvent(new CustomEvent('dubhe:user-salutation-changed', { detail: { salutation: result.value } })); } catch { /* non-browser tests */ }
      toast(localeText('用户称谓已保存。', 'Your salutation is saved.'), 'ok');
    });
    if (salutationCheckTimer) clearInterval(salutationCheckTimer);
    salutationCheckTimer = setInterval(refreshSalutation, 1000);
    salutationCheckTimer?.unref?.();
    refreshSalutation();
  }

  function saveKey() {
    const v = $('#set-key').value.trim();
    const gatewayId = store.state.gatewayId || DEFAULT_GATEWAY_ID;
    const chk = validateApiKey(v, gatewayId);
    if (!chk.ok) { toast('Key 格式错误：' + chk.reason, 'err', 5000); $('#set-key').focus(); $('#set-key').select(); return false; }
    store.state.apiKey = v;
    store.state.gatewayKeys = store.state.gatewayKeys || {};
    if (v && !isAdmin(v)) store.state.gatewayKeys[gatewayId] = v;
    else delete store.state.gatewayKeys[gatewayId];
    store.notify();
    onKeySaved && onKeySaved(gatewayId);
    return true;
  }
  $('#set-key').addEventListener('change', saveKey);
  $('#set-key').addEventListener('blur', saveKey);

  const saveGatewayBase = ({ notify = true } = {}) => {
    const id = store.state.gatewayId || DEFAULT_GATEWAY_ID;
    const input = $('#set-gateway-base');
    const raw = input ? input.value.trim() : '';
    const checked = validateGatewayBaseUrl(raw);
    if (!checked.ok) { toast(checked.reason, 'err', 5000); input && input.focus(); return false; }
    store.state.gatewayBaseUrls = store.state.gatewayBaseUrls || {};
    if (checked.value) store.state.gatewayBaseUrls[id] = checked.value;
    else delete store.state.gatewayBaseUrls[id];
    if (notify) {
      store.state.modelsByGateway = store.state.modelsByGateway || {};
      store.state.modelsFetchedAtByGateway = store.state.modelsFetchedAtByGateway || {};
      store.state.modelsByGateway[id] = [];
      delete store.state.modelsFetchedAtByGateway[id];
      store.state.models = [];
      store.state.modelsFetchedAt = 0;
      store.notify();
      onGatewayChanged && onGatewayChanged(id, { baseChanged: true, hasKey: !!store.state.apiKey });
      changed('gatewayBaseUrl', checked.value);
    }
    return true;
  };

  const gatewaySelect = $('#set-gateway');
  if (gatewaySelect) gatewaySelect.addEventListener('change', () => {
    const nextId = getGateway(gatewaySelect.value).id;
    const prevId = store.state.gatewayId || DEFAULT_GATEWAY_ID;
    if (nextId === prevId) return;
    if (!saveGatewayBase({ notify: false })) { gatewaySelect.value = prevId; return; }
    const oldKey = String(store.state.apiKey || '');
    store.state.gatewayKeys = store.state.gatewayKeys || {};
    if (oldKey && !isAdmin(oldKey)) store.state.gatewayKeys[prevId] = oldKey;
    else if (!oldKey) delete store.state.gatewayKeys[prevId];
    store.state.gatewayId = nextId;
    store.state.apiKey = String(store.state.gatewayKeys[nextId] || '');
    store.state.modelsByGateway = store.state.modelsByGateway || {};
    store.state.modelsFetchedAtByGateway = store.state.modelsFetchedAtByGateway || {};
    store.state.models = Array.isArray(store.state.modelsByGateway[nextId]) ? store.state.modelsByGateway[nextId] : [];
    store.state.modelsFetchedAt = Number(store.state.modelsFetchedAtByGateway[nextId]) || 0;
    const availableIds = store.state.modelsFetchedAt || store.state.models.length ? store.state.models : null;
    store.state.model = defaultModelForGateway(nextId, '', availableIds);
    const active = (store.state.sessions || []).find((s) => s.id === store.state.activeSessionId);
    if (active) { active.gatewayId = nextId; active.model = store.state.model; }
    store.notify();
    syncGatewayFields(store);
    onGatewayChanged && onGatewayChanged(nextId, { hasKey: !!store.state.apiKey });
    changed('gatewayId', nextId);
  });
  const gatewayBaseInput = $('#set-gateway-base');
  if (gatewayBaseInput) gatewayBaseInput.addEventListener('change', () => saveGatewayBase());
  if (gatewayBaseInput) gatewayBaseInput.addEventListener('blur', () => {
    const before = (store.state.gatewayBaseUrls || {})[store.state.gatewayId || DEFAULT_GATEWAY_ID] || '';
    if (gatewayBaseInput.value.trim() !== before) saveGatewayBase();
  });

  const addModel = () => {
    const gatewayId = store.state.gatewayId || DEFAULT_GATEWAY_ID;
    if (gatewayId !== 'custom') { toast('手动添加模型 ID 仅适用于自定义网关', 'warn'); return; }
    const input = $('#set-manual-model');
    const id = manualModelEditingId || String(input && input.value || '').trim();
    const providerInput = $('#set-manual-provider-name');
    const providerName = normalizeManualProviderName(providerInput?.value);
    if (!id) return;
    if (!providerName) {
      toast(localeText('请填写供应商名称；未上传图标时会自动显示名称首字母。', 'Enter a provider name; without an uploaded icon its initial will be used.'), 'warn');
      providerInput?.focus();
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id)) {
      toast('模型 ID 只能包含字母、数字、点、下划线、冒号、斜杠或连字符', 'err'); return;
    }
    store.state.manualModelsByGateway = store.state.manualModelsByGateway || {};
    const list = Array.isArray(store.state.manualModelsByGateway.custom) ? store.state.manualModelsByGateway.custom : [];
    if (manualModelEditingId) {
      if (!list.includes(id)) { resetManualModelEditor(); return toast('该模型已不存在，请重新添加。', 'warn'); }
      store.state.manualModelMetaByGateway = store.state.manualModelMetaByGateway || {};
      store.state.manualModelMetaByGateway.custom = store.state.manualModelMetaByGateway.custom || {};
      store.state.manualModelMetaByGateway.custom[id] = { providerName, iconDataUrl: manualModelIconDraft };
      renderManualModelList(store);
      store.notify();
      onGatewayChanged && onGatewayChanged(gatewayId, { manualModel: id, hasKey: !!store.state.apiKey, metadataChanged: true });
      changed('manualModelMetadata', id);
      resetManualModelEditor();
      toast(localeText('已保存供应商信息。', 'Provider details saved.'), 'ok');
      return;
    }
    if (list.includes(id)) { toast(`模型 ID 已存在：${id}`, 'warn'); return; }
    list.push(id);
    store.state.manualModelsByGateway.custom = list;
    store.state.manualModelMetaByGateway = store.state.manualModelMetaByGateway || {};
    store.state.manualModelMetaByGateway.custom = store.state.manualModelMetaByGateway.custom || {};
    store.state.manualModelMetaByGateway.custom[id] = { providerName, iconDataUrl: manualModelIconDraft };
    resetManualModelEditor();
    renderManualModelList(store);
    store.notify();
    onGatewayChanged && onGatewayChanged(gatewayId, { manualModel: id, hasKey: !!store.state.apiKey });
    changed('manualModels', id);
    toast(`已添加模型 ID：${id}`, 'ok');
  };
  const addModelButton = $('#set-add-model');
  if (addModelButton) addModelButton.addEventListener('click', addModel);
  const manualInput = $('#set-manual-model');
  if (manualInput) manualInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addModel(); } });
  const providerNameInput = $('#set-manual-provider-name');
  if (providerNameInput) providerNameInput.addEventListener('input', () => paintManualProviderPreview(providerNameInput.value, manualModelIconDraft));
  const providerIconInput = $('#set-manual-provider-icon');
  if (providerIconInput) providerIconInput.addEventListener('change', async () => {
    const file = providerIconInput.files?.[0];
    if (!file) return;
    try {
      manualModelIconDraft = await manualProviderIconFromFile(file);
      paintManualProviderPreview(providerNameInput?.value, manualModelIconDraft);
    } catch (error) {
      providerIconInput.value = '';
      toast(error?.message || localeText('无法读取供应商图标。', 'Could not read the provider icon.'), 'err');
    }
  });
  const cancelManualEdit = $('#set-cancel-manual-model-edit');
  if (cancelManualEdit) cancelManualEdit.addEventListener('click', resetManualModelEditor);
  const clearProviderIcon = $('#set-clear-provider-icon');
  if (clearProviderIcon) clearProviderIcon.addEventListener('click', () => {
    manualModelIconDraft = '';
    const file = $('#set-manual-provider-icon');
    if (file) file.value = '';
    paintManualProviderPreview($('#set-manual-provider-name')?.value, '');
  });
  const manualList = $('#set-manual-model-list');
  if (manualList) manualList.addEventListener('click', (e) => {
    const editButton = e.target.closest('[data-edit-manual-model]');
    if (editButton && (store.state.gatewayId || DEFAULT_GATEWAY_ID) === 'custom') {
      beginManualModelEdit(store, editButton.dataset.editManualModel);
      return;
    }
    const button = e.target.closest('[data-remove-manual-model]');
    if (!button || (store.state.gatewayId || DEFAULT_GATEWAY_ID) !== 'custom') return;
    const id = button.dataset.removeManualModel;
    store.state.manualModelsByGateway = store.state.manualModelsByGateway || {};
    const list = Array.isArray(store.state.manualModelsByGateway.custom) ? store.state.manualModelsByGateway.custom : [];
    const next = list.filter((item) => item !== id);
    if (next.length) store.state.manualModelsByGateway.custom = next;
    else delete store.state.manualModelsByGateway.custom;
    if (store.state.manualModelMetaByGateway?.custom) delete store.state.manualModelMetaByGateway.custom[id];
    if (manualModelEditingId === id) resetManualModelEditor();
    if (store.state.model === id) {
      store.state.model = defaultModelForGateway('custom');
      const active = (store.state.sessions || []).find((s) => s.id === store.state.activeSessionId);
      if (active && active.model === id) active.model = store.state.model;
    }
    renderManualModelList(store);
    store.notify();
    onGatewayChanged && onGatewayChanged('custom', { manualModelRemoved: id, hasKey: !!store.state.apiKey });
    changed('manualModels', id);
    toast(`已移除模型 ID：${id}`, 'ok');
  });

  const offlineDownloadButton = $('#set-offline-model-download');
  if (offlineDownloadButton) offlineDownloadButton.addEventListener('click', async () => {
    if (isNetworkOffline()) {
      toast(localeText('当前离线，下载已停止。联网后再手动开始。', 'Offline: the download was not started. Reconnect and start it manually.'), 'warn');
      return;
    }
    if (offlineModelDownloadBusy) return;
    offlineDownloadController = new AbortController();
    offlineModelDownloadBusy = true;
    offlineDownloadProgress = { loaded: Math.max(0, Number(offlineModelStore?.state.offlineModelPartialBytes) || 0), total: OFFLINE_MODEL_SIZE_BYTES, phase: 'download' };
    renderOfflineModelUI();
    try {
      await downloadOfflineModel({
        signal: offlineDownloadController.signal,
        onProgress: (progress) => {
          offlineDownloadProgress = progress;
          if (offlineModelStore?.state) offlineModelStore.state.offlineModelPartialBytes = Math.max(0, Math.min(OFFLINE_MODEL_SIZE_BYTES, Number(progress?.loaded) || 0));
          renderOfflineModelUI();
        },
      });
      const status = await syncOfflineModelAvailability(offlineModelStore, { notify: true });
      renderOfflineModelUI(status);
      if (status.available) toast(localeText('本地模型下载完成，可以断网后使用。', 'Model downloaded. You can now use it offline.'), 'ok', 4200);
      else toast(localeText('下载完成，但本地缓存校验未通过。', 'Download finished, but local cache verification failed.'), 'err', 5000);
    } catch (error) {
      if (error?.name === 'AbortError') toast(localeText('模型下载已暂停；已下载部分已保留，可稍后继续。', 'Model download paused; downloaded data is saved and can be resumed later.'), 'warn');
      else toast(error?.message || String(error), 'err', 6500);
      await refreshOfflineModelUI(offlineModelStore);
    } finally {
      offlineDownloadController = null;
      offlineModelDownloadBusy = false;
      offlineDownloadProgress = null;
      renderOfflineModelUI();
    }
  });
  const offlineCancelButton = $('#set-offline-model-cancel');
  if (offlineCancelButton) offlineCancelButton.addEventListener('click', () => offlineDownloadController?.abort());
  const offlineRemoveButton = $('#set-offline-model-remove');
  if (offlineRemoveButton) offlineRemoveButton.addEventListener('click', async () => {
    if (!offlineModelStore?.state.offlineModelAvailable && !(offlineModelStore?.state.offlineModelPartialBytes > 0)) return;
    if (!window.confirm(localeText('从此浏览器的本地存储中删除离线模型或未完成的下载？此操作不会联网。', 'Remove the offline model or incomplete download from this browser’s local storage? This will not access the network.'))) return;
    offlineRemoveButton.disabled = true;
    try {
      await removeOfflineModel();
      if (!isNetworkOffline() && offlineModelStore.state.model === OFFLINE_MODEL_ID) {
        offlineModelStore.state.model = defaultModelForGateway(offlineModelStore.state.gatewayId || DEFAULT_GATEWAY_ID);
        const active = (offlineModelStore.state.sessions || []).find((session) => session.id === offlineModelStore.state.activeSessionId);
        if (active && active.model === OFFLINE_MODEL_ID) active.model = offlineModelStore.state.model;
      }
      await refreshOfflineModelUI(offlineModelStore);
      offlineModelStore.notify();
      toast(localeText('本地模型已删除。', 'Local model removed.'), 'ok');
    } catch (error) { toast(error?.message || String(error), 'err', 5000); }
    finally { renderOfflineModelUI(); }
  });

  $('#set-relay').addEventListener('change', async () => {
    if (isNetworkOffline()) {
      const status = $('#set-relay-msg');
      if (status) status.textContent = localeText('离线状态：未保存 / 未探测中继地址。', 'Offline: relay address was not saved or probed.');
      return;
    }
    const v = $('#set-relay').value.trim();
    if (v) writeLocal(RELAY_OVERRIDE_KEY, v); else removeLocal(RELAY_OVERRIDE_KEY);
    const msg = await relayCheck();
    const el = $('#set-relay-msg'); if (el) el.textContent = msg;
    onRelayChanged && onRelayChanged();
  });
  $('#set-relay').addEventListener('blur', () => $('#set-relay').dispatchEvent(new Event('change')));

  bindSeg('#set-theme', (v) => {
    store.state.settings.theme = v;
    document.documentElement.dataset.theme = v;
    writeThemePreference(v);
    store.notify();
    changed('theme', v);
  });
  bindSeg('#set-fontsize', (v) => applyFontSizeValue(v));
  bindSeg('#set-motion', (v) => { applyMotionValue(v); paintMotionNote(); changed('motion', v); });

  const bindSw = (id, key, onChange) => {
    const el = $(id); if (!el) return;
    el.addEventListener('change', () => {
      store.state.settings[key] = el.checked;
      store.notify();
      onChange && onChange(el.checked);
      changed(key, el.checked);
    });
  };
  bindSw('#set-sandbox', 'sandboxEnabled');
  if ($('#set-cpp')) bindSw('#set-cpp', 'remoteCppEnabled');
  bindSw('#set-web', 'webEnabled');
  bindSw('#set-fast', 'fastMode');
  bindSw('#set-image-review', 'imageRemoteReview');
  bindSw('#set-cleanup-unreferenced', 'cleanupUnreferencedFiles');
  const reasonRow = document.getElementById('set-reason-row');
  const syncReasonRow = () => { if (reasonRow) reasonRow.hidden = !$('#set-thinking').checked; };
  bindSw('#set-thinking', 'thinking', syncReasonRow);
  syncReasonRow();

  // 执行预算（P1 修正：预算拦截要有用户可操作的恢复路径）：两路最常撞墙的通道可调，其余沿用内核默认
  const bindBudget = (id, key, min, max) => {
    const el = $(id); if (!el) return;
    el.addEventListener('change', () => {
      const def = DEFAULT_TURN_BUDGET[key];
      let n = Math.round(Number(el.value));
      if (!Number.isFinite(n)) n = def;
      n = Math.max(min, Math.min(max, n));
      const cur = { ...(store.state.settings.executionBudget || {}) };
      if (n === def) delete cur[key]; else cur[key] = n;
      store.state.settings.executionBudget = Object.keys(cur).length ? cur : undefined;
      store.notify();
      syncBudgetInputs(store);
      toast(n === def ? `${key === 'maxExternalSideEffects' ? '外部副作用' : '工具调用'}上限已恢复默认 ${def}（下一轮生效）` : `${key === 'maxExternalSideEffects' ? '外部副作用' : '工具调用'}上限已设为 ${n}（下一轮生效）`, 'ok', 2600);
    });
  };
  bindBudget('#set-budget-ext', 'maxExternalSideEffects', 1, 60);
  bindBudget('#set-budget-tools', 'maxToolCalls', 4, 128);
  const budgetReset = $('#set-budget-reset');
  if (budgetReset) budgetReset.addEventListener('click', () => {
    store.state.settings.executionBudget = undefined;
    store.notify();
    syncBudgetInputs(store);
    toast(`执行预算已恢复默认（外部副作用 ${DEFAULT_TURN_BUDGET.maxExternalSideEffects} · 工具调用 ${DEFAULT_TURN_BUDGET.maxToolCalls}）`, 'ok', 2600);
  });

  bindSeg('#set-reason', (v) => {
    store.state.settings.reasoningLevel = v;
    store.notify();
    changed('reasoningLevel', v);
  });

  // 识图 / 视频识别模型：全局设置（不随会话），analyze_image / analyze_pdf / analyze_video 读取
  const bindModelSelect = (id, key, resolve) => {
    const el = $(id); if (!el) return;
    el.addEventListener('change', () => {
      store.state.settings[key] = resolve(el.value);
      store.notify();
      syncMultimodalSelects(store);
    });
  };
  // 生图模型：写进当前会话（与旧模型菜单里的行为一致），不是全局设置
  const imgSel = $('#set-image-model');
  if (imgSel) imgSel.addEventListener('change', () => {
    const id = isImageGenModel(imgSel.value) ? imgSel.value : DEFAULT_IMAGE_MODEL;
    store.state.imageModel = id;
    store.notify();
    syncMultimodalSelects(store);
    toast(`生图模型已切换为 ${imageModelLabel(id)}（由 Agent 的 generate_image 工具调用，随当前会话保存）`, 'ok');
  });
  bindModelSelect('#set-vision-model', 'visionModel', resolveVisionModel);
  // 音视频解析模型合并为一个设置：analyze_video / analyze_audio 共用同一档位。
  // videoModel 是存档主键；audioModel 同步同值，旧快照与工具 ctx 的读取路径无需改动。
  const avSel = $('#set-av-model');
  if (avSel) avSel.addEventListener('change', () => {
    const id = resolveVideoModel(avSel.value);
    store.state.settings.videoModel = id;
    store.state.settings.audioModel = id;
    store.notify();
    syncMultimodalSelects(store);
  });
  // 语言切换：模型档位的 tag/note 有中英两版，切换后立刻重排（面板开着时也生效）
  onLanguageChange(() => {
    paintMotionNote();
    for (const sel of ['#set-image-model', '#set-vision-model', '#set-av-model']) { const el = $(sel); if (el) el._lang = ''; }
    syncMultimodalSelects(store);
    renderOfflineModelUI();
    renderManualModelList(store);
    paintSalutationCopy();
    refreshSalutationCheck(store);
  });

  // 清除临时缓存：只动「丢了也能重建」的东西——Cache Storage（SW 离线资源：模型 / 审核资产 / 静态文件）、sessionStorage、
  // 中继探测缓存；会话 / 密钥 / 设置 / 长效记忆（localStorage + IndexedDB）一律不碰。不刷新页面，下次用到的资源按需重新下载。
  const cacheBtn = $('#set-clear-cache');
  const updateCacheBtn = $('#set-update-cache');
  const updateStatus = $('#set-cache-update-status');
  const progressWrap = $('#set-cache-update-progress-wrap');
  const progressBar = $('#set-cache-update-progress');
  const progressLabel = $('#set-cache-update-progress-label');
  const setUpdateStatus = (message) => { if (updateStatus) updateStatus.textContent = message; };
  const paintUpdateProgress = (info = {}) => {
    if (!progressWrap || !progressBar || !progressLabel) return;
    progressWrap.hidden = false;
    if (info.phase === 'manifest' || !(Number(info.total) > 0)) {
      progressBar.removeAttribute('value');
      progressLabel.textContent = localeText('准备中…', 'Preparing…');
      if (info.phase === 'manifest') setUpdateStatus(info.reason === 'repair'
        ? localeText(`当前版本 v${info.version} 的缓存不完整，正在补建…`, `The cache for v${info.version} is incomplete; rebuilding it…`)
        : localeText(`发现新版 v${info.version}，正在准备缓存…`, `Found v${info.version}; preparing the cache…`));
      return;
    }
    const total = Math.max(1, Number(info.total));
    const completed = Math.max(0, Math.min(total, Number(info.completed) || 0));
    const percent = info.phase === 'ready' ? 100 : Math.round(completed / total * 100);
    progressBar.value = percent;
    progressLabel.textContent = `${percent}%`;
    if (info.phase === 'cache') {
      setUpdateStatus(localeText(`正在缓存脚本资源：${completed} / ${total}`, `Caching script assets: ${completed} / ${total}`));
    }
  };
  const updateFailureText = (error) => {
    switch (error?.code) {
      case 'offline': return localeText('离线状态下不会检查或安装更新。', 'Updates are not checked or installed while offline.');
      case 'manifest-network': return localeText('检查失败：无法连接到线上版本清单。', 'Could not reach the online build manifest.');
      case 'manifest-http': return localeText('线上版本清单暂不可用，请稍后再试。', 'The online build manifest is unavailable. Try again later.');
      case 'manifest-invalid': return localeText('线上版本清单无效，请稍后重试。', 'The online build manifest is invalid. Try again later.');
      case 'unsupported': return localeText('此环境不支持 Service Worker 缓存更新（请使用 HTTPS 或 localhost）。', 'Service Worker cache updates require HTTPS or localhost.');
      case 'cache-install-failed': return localeText('脚本缓存更新失败；旧缓存仍保留，请检查网络或存储空间后重试。', 'Script cache update failed; the previous cache is intact. Check network/storage and retry.');
      case 'cache-update-timeout': return localeText('缓存更新超时；旧缓存仍保留，请检查网络后重试。', 'Cache update timed out; the previous cache is intact. Check your connection and retry.');
      case 'cache-clear-failed': return localeText('应用缓存清理失败，尚未开始更新；请稍后重试。', 'Could not clear app caches, so the update was not started. Try again later.');
      case 'no-worker-update': return localeText('发现新版，但浏览器未启动缓存安装。请稍后重试。', 'A newer build exists, but the browser did not start cache installation. Try again later.');
      default: return localeText('缓存更新失败，请检查网络后重试。', 'Cache update failed. Check your connection and retry.');
    }
  };
  if (updateCacheBtn) updateCacheBtn.addEventListener('click', async () => {
    if (isNetworkOffline()) {
      setUpdateStatus(localeText('离线状态：不检查更新，也不清除离线应用资源。', 'Offline: update checks are disabled and cached app resources are preserved.'));
      return;
    }
    updateCacheBtn.disabled = true;
    if (cacheBtn) cacheBtn.disabled = true;
    updateCacheBtn.textContent = localeText('检查中…', 'Checking…');
    if (progressWrap) progressWrap.hidden = true;
    if (progressBar) progressBar.value = 0;
    setUpdateStatus(localeText('正在清除应用缓存…', 'Clearing app caches…'));
    try {
      const { result } = await clearThenUpdateScriptCache({
        options: { currentVersion: APP_VERSION, onProgress: paintUpdateProgress },
      });
      if (result.status === 'current') {
        if (progressWrap) progressWrap.hidden = true;
        setUpdateStatus(localeText(`当前已是最新版本（v${result.version}）。`, `Already on the latest version (v${result.version}).`));
      } else if (result.status === 'remote-behind') {
        if (progressWrap) progressWrap.hidden = true;
        setUpdateStatus(localeText(`线上清单版本 v${result.version} 低于当前页面，可能部署/CDN 正在同步，请稍后再试。`, `Online manifest v${result.version} is older than this page; deployment/CDN may still be syncing. Retry later.`));
      } else if (result.status === 'unsupported') {
        if (progressWrap) progressWrap.hidden = true;
        setUpdateStatus(updateFailureText({ code: 'unsupported' }));
      } else {
        paintUpdateProgress({ phase: 'ready', completed: 1, total: 1 });
        setUpdateStatus(localeText(`v${result.version} 的脚本已缓存。结束当前任务后刷新页面即可使用；不会强制中断。`, `Scripts for v${result.version} are cached. Refresh when your current task is finished; nothing is interrupted.`));
      }
    } catch (error) {
      setUpdateStatus(updateFailureText(error));
    } finally {
      updateCacheBtn.disabled = isNetworkOffline();
      updateCacheBtn.textContent = localeText('检查并更新', 'Check & update');
      if (cacheBtn) cacheBtn.disabled = isNetworkOffline();
    }
  });
  if (cacheBtn) cacheBtn.addEventListener('click', async () => {
    if (isNetworkOffline()) {
      setUpdateStatus(localeText('离线状态：保留离线应用资源；联网后再清理。', 'Offline: cached app resources are preserved; clear them when online.'));
      return;
    }
    cacheBtn.disabled = true;
    if (updateCacheBtn) updateCacheBtn.disabled = true;
    const label = cacheBtn.textContent;
    cacheBtn.textContent = '清除中…';
    try {
      const r = await clearTransientCaches();
      const note = $('#set-cache-note');
      if (note) note.textContent = `已清除 ${r.cacheStores} 个缓存（${r.cacheEntries} 条）· 请在任务结束后刷新，重新建立资源缓存`;
      toast(`✓ 临时缓存已清除（${r.cacheStores} 个离线缓存 · ${r.cacheEntries} 条资源）`, 'ok', 4200);
      onRelayChanged && onRelayChanged();
    } catch (err) {
      toast(localeText(`清除失败：${err && err.message ? err.message : String(err)}`, `Clear failed: ${err && err.message ? err.message : String(err)}`), 'err', 5000);
    } finally { cacheBtn.disabled = isNetworkOffline(); cacheBtn.textContent = label; if (updateCacheBtn) updateCacheBtn.disabled = isNetworkOffline(); }
  });

}

// 临时缓存清理（纯函数化，便于单测）：返回清掉了什么。任何一项不可用（非 https / 旧浏览器）都跳过而不是报错。
export async function clearTransientCaches() {
  if (isNetworkOffline()) {
    const error = new Error('Offline mode preserves cached application resources.');
    error.code = 'offline';
    throw error;
  }
  const out = { cacheStores: 0, cacheEntries: 0, sessionKeys: 0, relayProbeReset: false };
  // Forget the in-memory manifest as well, and let the next visit rebuild the cache.
  try {
    const scope = new URL('../', import.meta.url).href;
    const reg = await globalThis.navigator?.serviceWorker?.getRegistration(scope);
    if (reg?.scope === scope) {
      for (const worker of [reg.active, reg.waiting, reg.installing]) worker?.postMessage({ type: 'dubhe-cache-cleared' });
      await reg.unregister();
    }
  } catch { /* unavailable in private/unsupported environments */ }

  if (typeof caches !== 'undefined' && caches && typeof caches.keys === 'function') {
    const names = await caches.keys();
    const prefix = 'dubhe-static-v3:' + encodeURIComponent(new URL('../', import.meta.url).pathname) + ':';
    for (const n of names.filter(n => n.startsWith(prefix) || /^dubhe-(?:assets|static|moderation)-v[12]$/.test(n))) {
      try { out.cacheEntries += (await (await caches.open(n)).keys()).length; } catch { /* 数不出来就不数 */ }
      try { if (await caches.delete(n)) out.cacheStores += 1; } catch { /* 单个失败不影响其它 */ }
    }
  }
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage) { out.sessionKeys = sessionStorage.length; sessionStorage.clear(); }
  } catch { /* 隐私模式可能抛 */ }
  try { resetRelayProbe(); out.relayProbeReset = true; } catch { /* noop */ }
  return out;
}

/** Clear this app's transient caches before querying/installing the current static build. */
export async function clearThenUpdateScriptCache({
  clear = clearTransientCaches,
  update = updateScriptCache,
  options = {},
} = {}) {
  if (isNetworkOffline()) {
    const error = new Error('Offline mode disables update and cache-refresh operations.');
    error.code = 'offline';
    throw error;
  }
  let cleared;
  try { cleared = await clear(); }
  catch (cause) {
    const error = new Error('cache-clear-failed');
    error.code = 'cache-clear-failed';
    error.cause = cause;
    throw error;
  }
  const result = await update(options);
  return { cleared, result };
}

// ── 界面动效偏好（.32）──
// Windows「设置 → 辅助功能 → 视觉效果 → 动画效果」关掉后，浏览器会报 prefers-reduced-motion: reduce，
// 我们的 CSS 据此关掉所有动画——用户只看到「别人有动画我没有」。这里把原因摆出来，并允许覆盖：
//   auto（默认）跟随系统；on 强制开（CSS 的 reduce 块带 html:not([data-motion="on"]) 门控）；off 强制关（html[data-motion="off"] 规则）。
export function systemPrefersReducedMotion() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
export function readMotionPreference() {
  const v = String(readLocal(MOTION_KEY) || 'auto');
  return ['auto', 'on', 'off'].includes(v) ? v : 'auto';
}
export function applyMotionValue(value, { persist = true } = {}) {
  const v = ['auto', 'on', 'off'].includes(String(value)) ? String(value) : 'auto';
  if (typeof document !== 'undefined') {
    if (v === 'auto') delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = v;
  }
  if (persist) { if (v === 'auto') removeLocal(MOTION_KEY); else writeLocal(MOTION_KEY, v); }
  return v;
}
export function applyMotion() { return applyMotionValue(readMotionPreference(), { persist: false }); }
export function motionNoteText(pref = readMotionPreference(), systemReduce = systemPrefersReducedMotion(), language = getLanguage()) {
  const text = (zh, en) => language === 'en' ? en : zh;
  if (pref === 'on') return systemReduce
    ? text('强制开启（忽略系统「减少动效」）', 'Forced on (ignores system “Reduce motion”)')
    : text('强制开启', 'Forced on');
  if (pref === 'off') return text('已关闭', 'Off');
  return systemReduce
    ? text(
      '系统要求减少动效，动画已停（Windows：设置 → 辅助功能 → 视觉效果 → 动画效果）。选「开」可忽略',
      'Your system requests reduced motion, so animations are paused. Select “On” to override.',
    )
    : text('跟随系统', 'Follow system');
}
function paintMotionNote() {
  const n = $('#set-motion-note');
  if (n) n.textContent = motionNoteText();
}

// ── 旧浏览器能力提示（.32）：界面依赖 color-mix() / :has()，缺一个就会「样式有、细节丢」──
export function browserFeatureReport() {
  const sup = (prop, val) => { try { return typeof CSS !== 'undefined' && CSS.supports && CSS.supports(prop, val); } catch { return false; } };
  const supSel = (sel) => { try { return typeof CSS !== 'undefined' && CSS.supports && CSS.supports(`selector(${sel})`); } catch { return false; } };
  const missing = [];
  if (!sup('color', 'color-mix(in srgb, red 50%, blue)')) missing.push('color-mix()');
  if (!supSel(':has(a)')) missing.push(':has()');
  if (!sup('backdrop-filter', 'blur(2px)') && !sup('-webkit-backdrop-filter', 'blur(2px)')) missing.push('backdrop-filter');
  return { ok: missing.length === 0, missing, advice: missing.length ? `浏览器缺少 ${missing.join(' / ')}，部分视觉效果与动画会缺失；建议 Chrome / Edge ≥ 111、Firefox ≥ 121、Safari ≥ 16.4` : '' };
}

export function applyFontSizeValue(value, { persist = true } = {}) {
  const v = ['small', 'medium', 'large'].includes(String(value)) ? String(value) : 'medium';
  document.documentElement.dataset.fontsize = v;
  if (persist) {
    writeLocal(FONT_SIZE_KEY, v);
  }
  return v;
}

export function applyFontSize() {
  let v = 'medium';
  v = readLocal(FONT_SIZE_KEY) || 'medium';
  return applyFontSizeValue(v, { persist: false });
}
