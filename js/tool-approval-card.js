// 自注册工具的用户确认卡（2026-11-08）：显示在对话输出里，复用「执行内核」高风险确认卡样式。
// 之前确认入口藏在调节器面板里，既占空间又容易与 Agent 的返回状态错位；
// 现在每次待确认变更都会在 #messages 末尾追加一张卡，批准/拒绝结果就地写回。
import { text as t } from './locale.js';
import {
  configureRegistryHooks, approvePending, denyPending, pendingApprovals,
} from './tool-registry.js';
import { renderToolManager } from './ui-tool-manager.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderApprovalCard({ token, action, summary }, container) {
  if (!container) return null;
  const card = container.ownerDocument.createElement('div');
  card.className = 'confirm-card tool-approval-card';
  card.dataset.token = token;
  const body = [
    `${t('操作', 'Operation')}: ${action}`,
    `${t('原因', 'Reason')}: ${summary}`,
    `${t('影响', 'Impact')}: ${t('仅修改本机自注册工具表，不执行网络或文件副作用', 'Only modifies the local self-registered tool table; no network or file side effects')}`,
    `${t('可逆性', 'Reversibility')}: ${action === 'delete' ? t('删除不可恢复', 'Deletion is irreversible') : t('可再次修改或删除', 'Can be changed or deleted later')}`,
    `${t('票据', 'Ticket')}: ${token.slice(0, 8)}…`,
  ].join('\n');
  card.innerHTML = `<div class="confirm-title">${esc(t('工具变更需你确认', 'Tool change needs your approval'))}</div>`
    + `<div class="confirm-body">${esc(body)}</div>`
    + `<div class="confirm-actions">`
    + `<button type="button" class="confirm-btn allow" data-act="allow">${esc(t('允许', 'Allow'))}</button>`
    + `<button type="button" class="confirm-btn deny" data-act="deny">${esc(t('拒绝', 'Deny'))}</button>`
    + `</div><div class="confirm-note">${esc(t('超时或未应答一律视为拒绝；批准后变更立即生效。', 'Timeout or no response counts as refusal; the change applies immediately once approved.'))}</div>`;
  card.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const allow = b.dataset.act === 'allow';
    const ok = allow ? approvePending(token, { autoRun: true }) : denyPending(token);
    card.classList.add('resolved');
    card.querySelector('.confirm-actions')?.remove();
    const result = card.ownerDocument.createElement('div');
    result.className = `confirm-result ${allow && ok ? 'allow' : 'deny'}`;
    result.textContent = allow
      ? (ok ? t('已批准，变更已生效', 'Approved; change applied') : t('票据已失效，请让 Agent 重新发起', 'Ticket expired; ask the Agent to retry'))
      : t('已拒绝，工具未被修改', 'Denied; no changes were made');
    card.appendChild(result);
    renderToolManager();
  }));
  container.appendChild(card);
  try { container.scrollTop = container.scrollHeight; } catch { /* jsdom */ }
  return card;
}

export function installToolApproval({ toast = () => {}, messages = globalThis.document?.getElementById('messages') } = {}) {
  configureRegistryHooks({
    onApprovalRequest: (req) => {
      renderApprovalCard(req, messages);
      toast(t(`工具变更待确认：${req.summary}`, `Tool change awaiting approval: ${req.summary}`), 'warn', 6000);
      renderToolManager();
    },
  });
  return { pendingCount: () => pendingApprovals().length };
}
