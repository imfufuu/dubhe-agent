// The offline entry is a slot for one user-selected GGUF, not a hard-coded model or download URL.
export const OFFLINE_MODEL_ID = 'local/gguf';
export const LEGACY_OFFLINE_MODEL_IDS = Object.freeze([
  'local/qwen2.5-1.5b-instruct-heretic-q4_k_m',
]);
export const OFFLINE_MODEL_CONTEXT_SIZE = 4096;
// Reserve room for output and template/tool overhead in the local context.
export const OFFLINE_MODEL_CONTEXT_BUDGET = 3072;
export const OFFLINE_MODEL_MAX_OUTPUT_TOKENS = 768;
export const OFFLINE_MODEL_DISPLAY_NAME = '本地 GGUF';
export const OFFLINE_MODEL_PROVIDER_ZH = '本地模型';
export const OFFLINE_MODEL_PROVIDER_EN = 'Local model';
export const MAX_SINGLE_GGUF_BYTES = (2 * 1024 ** 3) - 1;
export const WLLAMA_VERSION = '3.8.1';

export function isOfflineModelId(value) {
  const id = String(value || '');
  return id === OFFLINE_MODEL_ID || LEGACY_OFFLINE_MODEL_IDS.includes(id);
}

export function formatByteSize(value) {
  const n = Math.max(0, Number(value) || 0);
  if (n >= 1024 ** 4) return `${(n / (1024 ** 4)).toFixed(2)} TiB`;
  if (n >= 1024 ** 3) return `${(n / (1024 ** 3)).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / (1024 ** 2)).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${Math.round(n)} B`;
}
