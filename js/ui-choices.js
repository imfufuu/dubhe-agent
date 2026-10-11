import { $, $$, esc } from './ui-markdown.js?v=2026.10.10.2';
export function installChoiceHandler({ root, store, agent, getBusy, openKeyModal, toast }) {
  function readChoiceAnswers(box) {
    try { return JSON.parse(box.dataset.choiceAnswers || '[]'); } catch { return []; }
  }
  function writeChoiceAnswers(box, answers) {
    box.dataset.choiceAnswers = JSON.stringify((answers || []).map((x) => String(x || '')));
  }
  function setChoiceStep(box, step) {
    if (!box) return;
    const blocks = $$('.choice-qblock', box);
    const count = blocks.length || Number(box.dataset.choiceCount || 1) || 1;
    const idx = Math.max(0, Math.min(count - 1, Number(step) || 0));
    box.dataset.choiceStep = String(idx);
    blocks.forEach((b, i) => b.classList.toggle('active', i === idx));
    const answers = readChoiceAnswers(box);
    const summary = $('[data-choice-summary]', box);
    if (summary) {
      summary.innerHTML = answers.length
        ? answers.map((a, i) => a ? `<button type="button" class="choice-pill" data-choice-jump="${i}" title="回到第 ${i + 1} 题"><b>${i + 1}</b>${esc(a)}</button>` : '').join('')
        : '';
    }
    blocks.forEach((b, i) => {
      const ans = answers[i] || '';
      for (const opt of $$('.choice-opt', b)) opt.classList.toggle('selected', !!ans && opt.getAttribute('data-choice-send') === ans);
    });
    const back = $('[data-choice-back]', box);
    if (back) back.disabled = idx <= 0;
    const progress = $('[data-choice-progress]', box);
    if (progress) progress.textContent = `${idx + 1} / ${count}`;
  }
  function choiceReplyText(box) {
    const answers = readChoiceAnswers(box);
    const qs = $$('.choice-qblock', box).map((b, i) => (($('.choice-q', b) || {}).textContent || `问题 ${i + 1}`).trim());
    return answers.map((a, i) => `${qs[i] || `问题 ${i + 1}`}：${a}`).join('\n');
  }
  const msgList = root;
  return (e) => {
    const opt = e.target.closest('[data-choice-send]');
    if (opt) {
      if (getBusy()) return true;
      const source = opt.closest('.msg[data-id]');
      const owner = store.state.messages.find(x => String(x.id) === source?.dataset.id);
      if (!owner || owner.role !== 'assistant' || owner.cancelled || owner.error || owner.toolCalls?.length || !owner.done) return true;
      const box = opt.closest('.choice-box');
      const block = opt.closest('.choice-qblock');
      if (!box || !block) return true;
      const text = opt.getAttribute('data-choice-send') || '';
      if (!text) return true;
      const idx = Number(block.dataset.choiceIdx || box.dataset.choiceStep || 0) || 0;
      const count = Number(box.dataset.choiceCount || $$('.choice-qblock', box).length || 1) || 1;
      const answers = readChoiceAnswers(box);
      answers.length = idx;
      answers[idx] = text;
      writeChoiceAnswers(box, answers);
      if (idx + 1 < count) {
        setChoiceStep(box, idx + 1);
        return true;
      }
      if (!store.state.apiKey) { openKeyModal(); toast('请先配置 TeamoRouter API Key', 'warn'); setChoiceStep(box, idx); return true; }
      const reply = choiceReplyText(box) || text;
      for (const b of $$('.choice-box', msgList)) b.remove();
      agent.send(reply, []);
      return true;
    }
    const back = e.target.closest('[data-choice-back]');
    if (back) {
      e.preventDefault();
      const box = back.closest('.choice-box');
      if (!box) return true;
      const target = Math.max(0, (Number(box.dataset.choiceStep || 0) || 0) - 1);
      const answers = readChoiceAnswers(box);
      answers.length = target; // 回退即清掉目标题及其后的旧选择状态
      writeChoiceAnswers(box, answers);
      setChoiceStep(box, target);
      return true;
    }
    const choiceJump = e.target.closest('[data-choice-jump]');
    if (choiceJump) {
      e.preventDefault();
      const box = choiceJump.closest('.choice-box');
      if (!box) return true;
      setChoiceStep(box, Number(choiceJump.getAttribute('data-choice-jump') || 0));
      return true;
    }
    return false;
  };
}
