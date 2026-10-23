// Fixed, optional local GGUF model. The revision is pinned so an install is reproducible.
export const OFFLINE_MODEL_ID = 'local/qwen2.5-1.5b-instruct-heretic-q4_k_m';
export const OFFLINE_MODEL_REPO = 'saidutta69/Qwen2.5-1.5B-Instruct-heretic';
export const OFFLINE_MODEL_REVISION = 'aef80af71c5b26237c31454f1f570e30eb05f9eb';
export const OFFLINE_MODEL_FILE = 'Qwen2.5-1.5B-Instruct-heretic-Q4_K_M.gguf';
export const OFFLINE_MODEL_URL = `https://huggingface.co/${OFFLINE_MODEL_REPO}/resolve/${OFFLINE_MODEL_REVISION}/${OFFLINE_MODEL_FILE}`;
export const OFFLINE_MODEL_SIZE_BYTES = 986_048_736;
export const OFFLINE_MODEL_SHA256 = '76d6e62551937fcd4cbcdf9664459cc7c87d08b3570150c6d03161a0233bb0c3';
export const OFFLINE_MODEL_CONTEXT_SIZE = 4096;
// Reserve room for output and template/tool overhead in the 4K Wllama context.
export const OFFLINE_MODEL_CONTEXT_BUDGET = 3072;
export const OFFLINE_MODEL_MAX_OUTPUT_TOKENS = 768;
export const OFFLINE_MODEL_DISPLAY_NAME = 'Qwen2.5 1.5B Heretic · Q4_K_M';
export const OFFLINE_MODEL_PROVIDER_ZH = '本地模型';
export const OFFLINE_MODEL_PROVIDER_EN = 'Local model';
export const OFFLINE_MODEL_LICENSE_CLAIM = 'Apache-2.0';
export const WLLAMA_VERSION = '3.8.1';

export function isOfflineModelId(value) {
  return String(value || '') === OFFLINE_MODEL_ID;
}

export function isOfflineModelUrl(value) {
  return String(value || '') === OFFLINE_MODEL_URL;
}

export function formatDownloadBytes(value) {
  const n = Math.max(0, Number(value) || 0);
  if (n >= 1024 ** 3) return `${(n / (1024 ** 3)).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / (1024 ** 2)).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)} MiB`;
  return `${(n / 1024).toFixed(0)} KiB`;
}
