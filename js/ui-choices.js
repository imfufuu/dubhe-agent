import { $, $$, esc } from './ui-markdown.js?v=2026.10.25.1';
import { isOfflineModelId } from './offline-model-config.js';
import { uiText as t } from './locale.js';

// Read-only summaries survive message repaint and session reload.
export function choiceSummaryHtml(items, ignored = false) {
  if (ignored) items = items.map(item => ({ ...item, answer: t('未回答', 'Not answered') }));
  return `<div class="choice-result-title">${esc(ignored ? t('未回答选择框', 'Choices not answered') : t('选择摘要', 'Choice summary'))}</div>` + items.map(item =>
    `<div class="choice-result-row"><div class="choice-result-question">${esc(item.question)}</div><div>${esc(item.answer || t('未选择', 'Not selected'))}</div>${item.other ? `<div class="choice-result-other">${esc(t('其他', 'Other'))}: ${esc(item.other)}</div>` : ''}</div>`).join('');
}
const choiceReplyText = items => items.map(x => `${x.question}\n${x.answer || t('其他', 'Other')}${x.other ? `\n${t('其他', 'Other')}: ${x.other}` : ''}`).join('\n\n');
export function installChoiceHandler({ root, store, agent, getBusy, openKeyModal, toast }) {
  const read = box => { try { return JSON.parse(box.dataset.choiceAnswers || '[]'); } catch { return []; } };
  function setStep(box, step) {
    const blocks = $$('.choice-qblock', box), answers = read(box);
    const idx = Math.max(0, Math.min(blocks.length - 1, step));
    box.dataset.choiceStep = String(idx);
    blocks.forEach((b, i) => {
      b.classList.toggle('active', i === idx);
      for (const opt of $$('.choice-opt', b)) opt.classList.toggle('selected', opt.dataset.choiceSend === answers[i]);
    });
    $('[data-choice-back]', box).disabled = idx === 0;
    $('[data-choice-progress]', box).textContent = `${idx + 1} / ${blocks.length}`;
    $('[data-choice-next]', box).hidden = idx === blocks.length - 1;
    $('[data-choice-summary]', box).innerHTML = blocks.map((b, i) => answers[i] ? `<button type="button" class="choice-pill" data-choice-jump="${i}"><b>${i + 1}</b>${esc(answers[i])}</button>` : '').join('');
  }
  return e => {
    const box = e.target.closest('.choice-box');
    if (!box || !root.contains(box)) return false;
    const source = box.closest('.msg[data-id]');
    const owner = store.state.messages.find(x => String(x.id) === source?.dataset.id);
    if (getBusy() || !owner || owner.role !== 'assistant' || owner.cancelled || owner.error || owner.toolCalls?.length || !owner.done) return true;
    const opt = e.target.closest('[data-choice-send]');
    if (opt) {
      const idx = Number(opt.closest('.choice-qblock').dataset.choiceIdx), answers = read(box);
      answers[idx] = opt.dataset.choiceSend;
      box.dataset.choiceAnswers = JSON.stringify(answers);
      setStep(box, Math.min(idx + 1, Number(box.dataset.choiceCount) - 1));
      return true;
    }
    if (e.target.closest('[data-choice-back]')) { setStep(box, Number(box.dataset.choiceStep) - 1); return true; }
    if (e.target.closest('[data-choice-next]')) { const idx = Number(box.dataset.choiceStep); const block = $$('.choice-qblock', box)[idx]; if (!read(box)[idx] && !$('.choice-other', block).value.trim()) { toast(t('请先回答当前问题', 'Please answer this question first'), 'warn'); return true; } setStep(box, idx + 1); return true; }
    const jump = e.target.closest('[data-choice-jump]');
    if (jump) { setStep(box, Number(jump.dataset.choiceJump)); return true; }
    if (e.target.closest('[data-choice-submit]')) {
      const answers = read(box);
      const items = $$('.choice-qblock', box).map((b, i) => ({ question: $('.choice-q', b).textContent.trim(), answer: answers[i] || '', other: $('.choice-other', b).value.trim() }));
      const missing = items.findIndex(x => !x.answer && !x.other);
      if (missing >= 0) { setStep(box, missing); toast(t('请回答每个问题后提交', 'Please answer every question before submitting'), 'warn'); return true; }
      if (!store.state.apiKey && !isOfflineModelId(store.state.model)) { openKeyModal(); toast(t('请先配置 API Key', 'Please configure an API key'), 'warn'); return true; }
      const boxes = $$('.choice-box', source);
      const resultIndex = boxes.indexOf(box);
      const results = { ...(owner.choiceResults || {}), [resultIndex]: items };
      store.updateMessage(owner.id, { choiceResults: results });
      const reply = choiceReplyText(items);
      agent.send(reply, []);
      return true;
    }
    return false;
  };
}
