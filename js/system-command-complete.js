// ─── /system 通道 · 命令自动补全 + 实时候选（纯函数部分，便于单测）────────────
// 候选数据与 ui-system-commands.js 的 handleSystemCommand 分支一一对应；新增命令时两边同步。
// 只负责「输入文本 → 候选项」，不读写 DOM、不执行命令。

export const SYSTEM_COMMAND_SPECS = Object.freeze([
  { name: 'help', usage: '/help', zh: '列出全部 /system 命令', en: 'list all /system commands' },
  { name: 'debug', usage: '/debug on|off', args: ['on', 'off'], zh: '开/关调试浮窗', en: 'show or hide the debug panel' },
  { name: 'status', usage: '/status', zh: '版本 / 模型 / 预热 / 审核状态', en: 'version, model, warm-up and moderation status' },
  { name: 'version', usage: '/version', zh: '仅版本一行', en: 'version line only' },
  { name: 'env', usage: '/env', zh: '粗略浏览器 / 设备环境', en: 'rough browser and device info' },
  { name: 'stats', usage: '/stats', zh: '会话与耗时统计', en: 'session and timing statistics' },
  { name: 'model', usage: '/model <模型ID>', argsFrom: 'models', zh: '切换模型（需完整 ID）', en: 'switch model (full ID required)' },
  { name: 'models', usage: '/models', zh: '列出可用模型', en: 'list available models' },
  { name: 'theme', usage: '/theme dark|light', args: ['dark', 'light'], zh: '切换深 / 浅主题', en: 'switch dark or light theme' },
  { name: 'cache', usage: '/cache [clear]', args: ['clear'], zh: '查看或清空离线缓存', en: 'view or clear the offline cache' },
  { name: 'key', usage: '/key', zh: '查看 API Key 尾号', en: 'show the API key tail' },
  { name: 'export', usage: '/export', zh: '导出全部会话（JSON）', en: 'export all sessions (JSON)' },
  { name: 'clear', usage: '/clear', zh: '清空通道草稿', en: 'clear the channel draft' },
  { name: 'p2', usage: '/p2 [report|policy|fault|exp]', args: ['report', 'policy', 'fault', 'exp'], zh: '策略 / 指标 / 审计 / 故障 / 实验', en: 'policy, metrics, audit, faults, experiments' },
  { name: 'guard', usage: '/guard observe|strict|strict-l2', args: ['observe', 'strict', 'strict-l2'], zh: '高风险操作确认档位', en: 'confirmation level for high-risk actions' },
  { name: 'resume', usage: '/resume', zh: '查看断点续跑计划', en: 'view the resume plan' },
]);

// 别名：输入时也能匹配（与 handleSystemCommand 中的 'environment' 分支一致）
const COMMAND_ALIASES = Object.freeze({ environment: 'env' });

// /p2 fault 的故障类型（与 ui-system-commands.js 中的 kinds 列表一致）
export const SYSTEM_FAULT_KINDS = Object.freeze([
  'tool-timeout', 'tool-empty-result', 'tool-bad-schema', 'artifact-modified-externally', 'duplicate-tool-call',
  'audit-event-missing', 'capability-mask-mismatch', 'memory-instruction-conflict', 'authorization-revoked-midway',
]);

const ARG_HINTS = Object.freeze({
  on: ['开启', 'on'], off: ['关闭', 'off'],
  dark: ['深色', 'dark'], light: ['浅色', 'light'],
  clear: ['清空缓存', 'clear cache'],
  report: ['统一指标报告', 'unified metrics report'], policy: ['策略版本自检', 'policy self-check'],
  fault: ['故障注入（下一轮一次）', 'fault injection (next turn, once)'], exp: ['策略实验汇总', 'policy experiment summary'],
  observe: ['记录并披露，不打断', 'log and disclose, no interruption'],
  strict: ['L3 需人工确认', 'L3 needs manual confirmation'],
  'strict-l2': ['L2 + L3 需人工确认', 'L2 and L3 need manual confirmation'],
});

const isZh = (locale) => String(locale || '').toLowerCase().startsWith('zh');
const pick = (pair, locale) => (isZh(locale) ? pair[0] : pair[1]);

function resolveCommandName(name) {
  const lower = String(name || '').toLowerCase();
  return COMMAND_ALIASES[lower] || lower;
}

/**
 * 根据输入框文本给出候选。
 * @returns {null | { mode: 'command' | 'argument', items: Array<{ insert: string, label: string, hint: string, command: string, args: boolean }> }}
 *   null 表示当前输入不是斜杠命令（不展示菜单）。
 */
export function getSystemCommandSuggestions(input, { models = [], locale = 'zh' } = {}) {
  const raw = String(input ?? '');
  const match = /^\s*[/／]/u.exec(raw);
  if (!match) return null;
  const body = raw.slice(match[0].length);
  const hasSpace = /\s/u.test(body);

  if (!hasSpace) {
    const query = body.toLowerCase();
    const specs = SYSTEM_COMMAND_SPECS.filter((spec) => spec.name.startsWith(query));
    const contains = SYSTEM_COMMAND_SPECS.filter((spec) => !spec.name.startsWith(query) && spec.name.includes(query));
    const ordered = [...specs, ...contains];
    return {
      mode: 'command',
      items: ordered.map((spec) => {
        const takesArgs = !!(spec.args || spec.argsFrom);
        return {
          insert: `/${spec.name}${takesArgs ? ' ' : ''}`,
          label: spec.usage,
          hint: pick([spec.zh, spec.en], locale),
          command: spec.name,
          args: takesArgs,
        };
      }),
    };
  }

  // 参数模式：/<命令> <已输入的参数前缀>
  const parts = body.trim().split(/\s+/u);
  const command = resolveCommandName(parts[0]);
  const spec = SYSTEM_COMMAND_SPECS.find((s) => s.name === command);
  if (!spec) return { mode: 'argument', items: [] };
  const endsWithSpace = /\s$/u.test(body);
  const current = endsWithSpace ? '' : (parts.length > 1 ? parts[parts.length - 1] : '');
  const done = endsWithSpace ? parts.slice(1) : parts.slice(1, -1);

  let options = [];
  let hintOf = (value) => pick(ARG_HINTS[value] || [value, value], locale);
  if (spec.argsFrom === 'models') {
    options = models.map((id) => String(id));
    hintOf = () => pick(['模型 ID', 'model ID'], locale);
  } else if (command === 'p2' && done[0] && done[0].toLowerCase() === 'fault') {
    options = [...SYSTEM_FAULT_KINDS];
    hintOf = () => pick(['故障类型', 'fault kind'], locale);
  } else if (command === 'p2' && done.length > 0) {
    options = [];
  } else {
    options = spec.args || [];
  }
  const needle = current.toLowerCase();
  const prefix = `/${spec.name} ${done.map((t) => `${t} `).join('')}`;
  const chosen = new Set(done.map((t) => t.toLowerCase()));
  const items = options
    .filter((value) => !chosen.has(value.toLowerCase()) && value.toLowerCase().startsWith(needle))
    .map((value) => ({ insert: `${prefix}${value}`, label: value, hint: hintOf(value), command, args: false }));
  return { mode: 'argument', items };
}

/** 判断一条候选是否与当前输入等价（用于决定 Enter 是「补全」还是「发送」）。 */
export function isSameCommandText(a, b) {
  return String(a ?? '').trim().replace(/\s+/gu, ' ') === String(b ?? '').trim().replace(/\s+/gu, ' ');
}
