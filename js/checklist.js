// ─── 复杂任务清单（checklist）────────────────────────────────────────────
// 极复杂任务开始前，Agent 在系统内部用 checklist 工具列出步骤，执行中逐项更新状态；
// 前端在消息内实时显示。清单未全部 done 时，回合不得以「无工具调用」结束（见 agent.js 闸门）。
// 清单只存在于工具参数与消息状态里，不要求模型把清单写进正文。
//
// 纯函数模块：无 DOM、无网络，供 tools.js / agent.js / ui-toolflow.js 共用，并可被 node 单测直接导入。

import { text } from './locale.js';

export const CHECKLIST_STATUSES = Object.freeze(['pending', 'in_progress', 'done', 'failed']);
export const CHECKLIST_MAX_ITEMS = 30;
export const CHECKLIST_TEXT_MAX = 200;
// 模型过早结束时最多补催的次数；超过后回合照常结束，但清单上会保留未完成项（不静默掩盖）。
export const CHECKLIST_MAX_NUDGES = 4;

// 规范化模型传入的清单：去空项、截断、补 id、非法状态回落为 pending。
export function normalizeChecklist(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const raw of items.slice(0, CHECKLIST_MAX_ITEMS)) {
    const label = String(raw && (raw.text ?? raw.title) != null ? (raw.text ?? raw.title) : '')
      .replace(/\s+/g, ' ').trim().slice(0, CHECKLIST_TEXT_MAX);
    if (!label) continue;
    const status = CHECKLIST_STATUSES.includes(raw.status) ? raw.status : 'pending';
    const id = String(raw.id || `c${out.length + 1}`).replace(/[^\w.-]/g, '').slice(0, 24) || `c${out.length + 1}`;
    out.push({ id, text: label, status });
  }
  return out;
}

export function checklistOpenItems(list) {
  return (Array.isArray(list) ? list : []).filter((item) => item.status !== 'done');
}

// 至少一项，且全部 done 才算完成。
export function checklistComplete(list) {
  return Array.isArray(list) && list.length > 0 && list.every((item) => item.status === 'done');
}

// 工具返回给模型的文字回执（同时供前端状态提示使用）。
export function checklistSummary(list) {
  const done = list.filter((item) => item.status === 'done').length;
  if (checklistComplete(list)) {
    return text(`清单已更新：${done}/${list.length} 项完成。全部确认无误，可以给出最终回答。`,
      `Checklist updated: ${done}/${list.length} done. All items confirmed; you may give the final answer.`);
  }
  const open = checklistOpenItems(list).map((item) => `${item.id}（${item.status}）${item.text}`).join('；');
  return text(`清单已更新：${done}/${list.length} 项完成。未完成：${open}。全部确认无误之前不得结束回合。`,
    `Checklist updated: ${done}/${list.length} done. Open: ${open}. Do not end the turn until every item is confirmed.`);
}

// 每轮 ephemeral 提醒：只在存在未完成项时发送，避免无谓占用上下文。
export function checklistReminder(list) {
  if (!Array.isArray(list) || !list.length || checklistComplete(list)) return '';
  const lines = list.map((item) => `- [${item.status}] ${item.id}: ${item.text}`).join('\n');
  return text(`【任务清单】以下项目尚未全部确认完成，不得结束回合；逐项执行，完成后用 checklist 工具把状态改为 done：\n${lines}`,
    `[Task checklist] These items are not all confirmed yet; do not end the turn. Work through them and set each to done with the checklist tool when verified:\n${lines}`);
}

// 闸门：仍有未确认项，且补催次数未用尽 → 不结束回合。
export function checklistBlocksEnd(list, nudges) {
  return checklistOpenItems(list || []).length > 0 && nudges < CHECKLIST_MAX_NUDGES;
}

// checklist 工具成功调用后：规范化并写入消息（前端卡片据此实时重绘），返回回合内清单。
export function recordChecklistCall(store, messageId, args) {
  const list = normalizeChecklist(args && args.items);
  store.updateMessage(messageId, { checklist: list.map((item) => ({ ...item })) });
  return list;
}
