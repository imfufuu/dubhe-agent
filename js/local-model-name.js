// ─── 本地 GGUF 模型显示名：默认值生成 + 校验（纯函数，便于单测）──────────────
// 规则（用户要求）：
//   · 默认值 = 文件名去掉 .gguf，全部小写，空格与下划线改为连字符 "-"；
//   · 可修改，长度 1–64 个字符；
//   · 只允许字母、数字、连字符 "-" 与点 "."，不得包含其它特殊字符。

export const LOCAL_MODEL_NAME_MAX = 64;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}.-]*$/u;

export function defaultLocalModelName(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop().replace(/\.gguf$/i, '');
  return base
    .toLocaleLowerCase('en-US')
    .replace(/[\s_]+/gu, '-')
    .replace(/[^\p{L}\p{N}.-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, LOCAL_MODEL_NAME_MAX) || 'local-model';
}

// 返回 { ok: true, value } 或 { ok: false, error }（error 为中文提示，界面可直接显示）
export function validateLocalModelName(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, error: '名称不能为空。' };
  if (Array.from(value).length > LOCAL_MODEL_NAME_MAX) return { ok: false, error: `名称不能超过 ${LOCAL_MODEL_NAME_MAX} 个字符。` };
  if (!NAME_RE.test(value)) return { ok: false, error: '名称只能包含字母、数字、连字符（-）和点（.），且须以字母或数字开头。' };
  return { ok: true, value };
}
