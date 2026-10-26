import { reasoningLevelLabel } from './reasoning.js?v=2026.10.25.1';
import { turnRange } from './editpreview.js?v=2026.10.25.1';
import { fmtClock, fmtAgo } from './ui-common.js?v=2026.10.25.1';
import { formatDateTime, t } from './i18n.js?v=2026.10.25.1';

/** Build a small view-only painter; reasoning bodies stay untouched and are never read into the footer. */
export function createAssistantFootPainter(store) {
  return function paintFoot(wrap, message) {
    const foot = wrap?.querySelector('.msg-foot');
    if (!foot) return;
    if (message.role !== 'assistant' || !message.done) { foot.hidden = true; foot.textContent = ''; return; }

    const messages = store.state.messages || [];
    const at = messages.findIndex((item) => item.id === message.id);
    const [lo] = turnRange(messages, at < 0 ? messages.length - 1 : at);
    const turn = messages.slice(Math.max(0, lo), at + 1);
    const hasThought = turn.some((item) => item.role === 'assistant' && (
      item.reasoning || item.thoughtHidden || item.usage?.reasoning || item.thinkingBlocks?.length
    ));
    const bits = [];
    if (message.reasoningLevel && message.reasoningLevel !== 'off') bits.push(reasoningLevelLabel(message.reasoningLevel));
    const noThought = bits.length > 0 && !hasThought;
    if (noThought) bits.push(t('未思考'));
    else if (!bits.length && hasThought) bits.push(t('已收到思考内容'));

    const clock = message.durationMs != null ? fmtClock(message.durationMs) : '';
    const relative = message.ts ? fmtAgo(message.ts) : '';
    const ago = relative && message.tsEstimated ? `≈ ${relative}` : relative;
    const time = [clock, ago].filter(Boolean).join(' | ');
    const head = bits.join(' · ');
    const line = head && time ? `${head} · ${time}` : (head || time);
    if (!line) { foot.hidden = true; foot.textContent = ''; return; }

    foot.hidden = false;
    foot.textContent = line;
    const date = message.ts ? formatDateTime(message.ts) : '';
    const title = message.reasoningLevel === 'off'
      ? t('本轮思考 Off')
      : noThought
        ? t('已发送思考参数，模型本轮自主判定无需思考')
        : message.tsEstimated
          ? `${date} · ${t('时间为估算值，原始消息未提供时间戳。')}`
          : date;
    foot.title = title;
  };
}
