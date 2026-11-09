// 自注册工具管理（2026-11-08 从调节器迁到「设置」页面）。
// 用户确认不在这里：待确认变更由 tool-approval-card.js 渲染成对话输出里的确认卡。
import { text as t } from './locale.js';
import {
  listRegisteredTools, readRegisteredTool, pendingApprovals,
  uiDeleteTool, uiSetToolEnabled,
} from './tool-registry.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let expandedTool = '';

/** 打开设置页并滚到工具管理区；调节器里的按钮与确认卡都可调用。 */
export function openToolManager() {
  const settings = $('settings-modal');
  if (!settings) return false;
  settings.hidden = false;
  void settings.offsetHeight;
  settings.classList.add('open');
  $('set-tool-manager')?.scrollIntoView?.({ block: 'start' });
  renderToolManager();
  return true;
}

export function renderToolManager() {
  const root = $('tool-manager-root');
  if (!root) return;
  const list = listRegisteredTools();
  const pending = pendingApprovals();
  const count = $('tool-manager-count');
  if (count) count.textContent = `${list.length} / 24`;
  const note = $('tool-manager-pending');
  if (note) {
    note.hidden = !pending.length;
    note.textContent = pending.length
      ? t(`有 ${pending.length} 项工具变更待确认：请在对话输出的确认卡里点「允许」或「拒绝」。`, `${pending.length} tool change(s) awaiting approval: use the confirmation card in the chat output.`)
      : '';
  }
  if (!list.length) {
    root.innerHTML = `<p class="tuner-empty">${esc(t('暂无自注册工具。Agent 可用 tool_registry 创建（需你在输出里确认）。', 'No self-registered tools yet. The Agent can create one with tool_registry (your approval is required in the chat output).'))}</p>`;
    return;
  }
  root.innerHTML = list.map((tool) => {
    const openState = expandedTool === tool.name;
    const detail = openState ? `<pre class="tuner-tool-json">${esc(JSON.stringify(readRegisteredTool(tool.name), null, 2))}</pre>` : '';
    return `<div class="tuner-tool${tool.enabled === false ? ' disabled' : ''}" data-tool="${esc(tool.name)}">
      <div class="tuner-tool-head">
        <button type="button" class="tuner-tool-name" data-act="read"><code>${esc(tool.name)}</code></button>
        <span class="tuner-tool-kind">${esc(tool.handler?.kind || '')}</span>
        <button type="button" class="tuner-mini" data-act="toggle">${esc(tool.enabled === false ? t('启用', 'Enable') : t('停用', 'Disable'))}</button>
        <button type="button" class="tuner-mini danger" data-act="delete">${esc(t('删除', 'Delete'))}</button>
      </div>
      <div class="tuner-tool-desc">${esc(tool.description)}</div>${detail}
    </div>`;
  }).join('');
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const name = b.closest('[data-tool]')?.dataset.tool || '';
    const act = b.dataset.act;
    if (act === 'read') { expandedTool = expandedTool === name ? '' : name; renderToolManager(); return; }
    if (act === 'toggle') {
      const tool = readRegisteredTool(name);
      uiSetToolEnabled(name, tool?.enabled === false);
      renderToolManager(); return;
    }
    if (act === 'delete') {
      const label = t('删除', 'Delete');
      if (b.dataset.confirmed !== '1') {
        b.dataset.confirmed = '1'; b.textContent = `${label}?`; b.classList.add('confirm');
        setTimeout(() => { if (b.isConnected) { b.dataset.confirmed = ''; b.textContent = label; b.classList.remove('confirm'); } }, 4000);
        return;
      }
      uiDeleteTool(name); expandedTool = ''; renderToolManager();
    }
  }));
}

export function installToolManager() {
  const title = $('tool-manager-title');
  if (title) title.textContent = t('自注册工具', 'Self-registered tools');
  const desc = $('tool-manager-desc');
  if (desc) desc.textContent = t('Agent 可以注册、读取、启停、删除自己的工具；所有变更都需要你在对话输出里的确认卡批准。名称以 custom_ 开头，handler 只执行声明式白名单动作。', 'The Agent can register, read, enable/disable and delete its own tools; every change needs your approval on the confirmation card in the chat output. Names start with custom_ and handlers only run declarative whitelisted actions.');
  renderToolManager();
  return { open: openToolManager, render: renderToolManager };
}
