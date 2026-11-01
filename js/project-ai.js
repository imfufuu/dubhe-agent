// Dubhe Agent · 项目模式段 3：AI 辅助的提示词组装（纯逻辑，可在 node 单测）。
// 项目窗口把「当前文件 / 选区 / 报错 / 用户指令」交给 agent.send；这里只负责拼出一条清晰的任务说明。
import { languageOf } from './project-core.js';

export const AI_MAX_FILE_CHARS = 12000;
export const AI_MAX_SELECTION_CHARS = 4000;
export const AI_MAX_DIAGNOSTICS = 12;

// 快捷动作：needs 表示该动作依赖的上下文（diagnostics = 有报错，selection = 有选区，file = 有打开的文件）
export const AI_ACTIONS = Object.freeze([
  { id: 'explain', label: '解释代码', labelEn: 'Explain', needs: 'file', task: '解释这段代码做什么，指出潜在问题。不要修改任何文件。' },
  { id: 'fix', label: '修复报错', labelEn: 'Fix problems', needs: 'diagnostics', task: '根据下面的报错修复代码。只改必要的地方，保持其它行为不变。' },
  { id: 'comment', label: '补充注释', labelEn: 'Add comments', needs: 'file', task: '为选中的代码补充必要的中文注释（没有选中则为整个文件）。不改变代码逻辑。' },
  { id: 'test', label: '写测试', labelEn: 'Write tests', needs: 'file', task: '为这段代码写一个简单的测试或示例用例，保存为同目录下的测试文件。' },
  { id: 'custom', label: '自定义', labelEn: 'Custom', needs: null, task: '' },
]);

export function actionById(id) {
  return AI_ACTIONS.find((a) => a.id === id) || null;
}

/** 大文件保留头尾，中间省略并注明省略字数（避免撑爆上下文）。 */
export function clipText(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${s.slice(0, head)}\n…（中间省略 ${s.length - max} 字符）…\n${s.slice(s.length - tail)}`;
}

/**
 * 组装提示词。
 * action: AI_ACTIONS 的 id；instruction：用户补充说明（自定义动作必填）。
 * selection: { text, startLine, endLine } | null；diagnostics: [{file,line,col,message}]。
 */
export function buildAiPrompt({ action = 'custom', path = '', content = '', selection = null, diagnostics = [], instruction = '' } = {}) {
  const spec = actionById(action) || actionById('custom');
  const task = spec.id === 'custom' ? String(instruction || '').trim() : spec.task;
  const parts = [];
  parts.push(`【项目模式】${path ? `请处理工作区文件 ${path}（${languageOf(path)}）。` : '请处理当前工作区。'}`);
  if (task) parts.push(`任务：${task}`);
  if (spec.id !== 'explain') {
    parts.push('需要改动时，直接用文件工具修改工作区里的文件（保持路径不变，不要动无关文件）；完成后用两三句话说明改了什么。');
  }
  if (selection && selection.text) {
    parts.push(`选中的代码（第 ${selection.startLine}–${selection.endLine} 行）：\n\`\`\`\n${clipText(selection.text, AI_MAX_SELECTION_CHARS)}\n\`\`\``);
  }
  const diags = Array.isArray(diagnostics) ? diagnostics.slice(0, AI_MAX_DIAGNOSTICS) : [];
  if (spec.id === 'fix' && diags.length) {
    parts.push(`当前报错：\n${diags.map((d) => `- ${d.file}:${d.line}:${d.col} ${d.message}`).join('\n')}`);
  }
  if (content) {
    parts.push(`文件当前内容：\n\`\`\`\n${clipText(content, AI_MAX_FILE_CHARS)}\n\`\`\``);
  }
  if (spec.id !== 'custom' && String(instruction || '').trim()) parts.push(`补充说明：${String(instruction).trim()}`);
  return parts.join('\n\n');
}

/** 快捷动作是否可用（返回 { ok, reason }）。 */
export function actionAvailability(action, { hasFile = false, diagnosticsCount = 0 } = {}) {
  const spec = actionById(action);
  if (!spec) return { ok: false, reason: 'unknown' };
  if (spec.needs === 'file' && !hasFile) return { ok: false, reason: 'no-file' };
  if (spec.needs === 'diagnostics' && !diagnosticsCount) return { ok: false, reason: 'no-diagnostics' };
  return { ok: true, reason: '' };
}
