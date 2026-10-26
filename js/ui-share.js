import { ICON } from './icons.js';
import { buildShareDocument } from './share-document.js?v=2026.10.25.1';
import { captureShare } from './share-capture.js';
import { createZip } from './zip.js';
import { text, onLanguageChange } from './locale.js';

export function shareableMessages(messages) { return (messages || []).filter((m) => ['user', 'assistant'].includes(m?.role) && !m.transientModeration); }

// ── 分享的最小单位是「一轮」（用户消息 + 该轮的全部输出）────────────────────
// 2026.10.11.1：不再逐条消息分享。用户要的是整轮可读的对话片段；单条消息（尤其半截回答）
// 单独导出既没有上下文，也容易泄漏不该带走的内容。
export function turnsOf(messages) {
  const list = shareableMessages(messages);
  const turns = [];
  for (const m of list) {
    const last = turns[turns.length - 1];
    if (m.role === 'user' || !last) turns.push({ id: m.id, messages: [m] });
    else last.messages.push(m);
  }
  return turns.filter((t) => t.messages.length);
}
export function turnIds(turn) { return (turn?.messages || []).map((m) => m.id); }
export function turnLabel(turn, language) {
  const first = turn?.messages?.[0] || {};
  const prompt = String(first.text || first.error || '').replace(/\s+/g, ' ').trim();
  const outputs = (turn?.messages || []).filter((m) => m.role === 'assistant').length;
  return { prompt: prompt || (language === 'en' ? '(empty prompt)' : '（空提问）'), outputs };
}

const DOWNLOAD_UNSUPPORTED = typeof document !== 'undefined' && !('download' in document.createElement('a'));

export function installSharing({ store, agent, getBusy, root, toast }) {
  const $ = (id) => document.getElementById(id), modal = $('share-modal'), list = $('share-messages');
  if (!modal || !list) return { refresh() {} };
  let selected = new Set(), openedSession = '', exporting = false, abort, opener, lastArtifact = null;

  let hintShown = false;
  const status = (msg, kind = '') => {
    const el = $('share-status');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.className = 'share-status' + (kind ? ' ' + kind : '');
  };
  // 结果状态（已导出 / 导出失败）只由导出流程设置；update() 只负责「还没选任何一轮」这一条提示，
  // 不能在导出结束后把刚写上的结果冲掉（第 6 条：导出必须给出明确结果）。
  const hint = () => { hintShown = true; status(text('先勾选至少一轮对话，然后导出。', 'Select at least one turn to export.'), 'warn'); };
  const clearArtifact = () => {
    const box = $('share-latest');
    if (lastArtifact?.url) URL.revokeObjectURL(lastArtifact.url);
    lastArtifact = null;
    if (box) { box.hidden = true; box.replaceChildren(); }
  };
  // 产物永远留一个「再存一次」的入口：某些设备（iOS Safari / 微信内置浏览器）不触发 <a download>，
  // 或者用户把系统下载拦了。生成一次后不让用户重跑整个导出，是这个入口存在的理由。
  const offerArtifact = (blob, filename) => {
    const box = $('share-latest');
    clearArtifact();
    if (!box) return;
    const url = URL.createObjectURL(blob);
    lastArtifact = { url, filename, blob };
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.textContent = text(`下载 ${filename}`, `Download ${filename}`);
    a.className = 'share-latest-link';
    a.addEventListener('click', () => { tryDownload(blob, filename); });
    const hint = document.createElement('span');
    hint.textContent = text('如果点击没有开始下载：用浏览器「另存为」保存这个链接，或长按链接选择保存。', 'If nothing downloads: use "Save link as" or long-press the link to save it.');
    box.append(a, hint);
    box.hidden = false;
  };
  function tryDownload(blob, filename) {
    try {
      const href = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = href; a.download = filename; a.rel = 'noopener';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      return true;
    } catch { return false; }
  }
  // iOS / 内嵌浏览器：优先走系统分享面板（可直接存到「文件」或发给自己）。
  async function shareOrFallback(blob, filename) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }) && typeof navigator.share === 'function') {
      try { await navigator.share({ files: [file], title: filename }); return 'shared'; } catch (err) { if (err && err.name === 'AbortError') return 'cancelled'; }
    }
    if (!DOWNLOAD_UNSUPPORTED && tryDownload(blob, filename)) return 'downloaded';
    if (blob.type === 'text/html') {
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) { setTimeout(() => URL.revokeObjectURL(url), 120000); return 'opened'; }
    }
    return 'manual';
  }

  const selectedTurns = () => turnsOf(store.state.messages).filter((t) => turnIds(t).every((id) => selected.has(id)));
  const update = () => {
    const turns = selectedTurns();
    const count = text(`已选 ${turns.length} 轮`, `${turns.length} turn${turns.length === 1 ? '' : 's'} selected`);
    if ($('share-count').textContent !== count) $('share-count').textContent = count;
    const empty = exporting || !turns.length;
    for (const id of ['share-png', 'share-html']) $(id).disabled = empty;
    if (!exporting && !turns.length) { if (!hintShown) hint(); }
    else if (hintShown) { hintShown = false; status(''); }
    if ($('share-open')) $('share-open').disabled = getBusy() || !shareableMessages(store.state.messages).length;
  };
  // 每轮一个分享入口，挂在「该轮动作条」上；用户消息自己那一行不放分享按钮（2026.10.11.1）。
  const refresh = () => {
    update();
    if (modal.classList.contains('open') && openedSession !== store.state.activeSessionId) close();
    const messages = store.state.messages || [];
    const turns = turnsOf(messages);
    const ownerOfTurn = new Map();
    for (const t of turns) {
      const lastAssistant = [...t.messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant) ownerOfTurn.set(String(lastAssistant.id), t);
    }
    for (const node of root.querySelectorAll('.msg[data-id]')) {
      const host = node.querySelector('.msg-actions');
      if (!host) continue;
      const turn = ownerOfTurn.get(String(node.dataset.id));
      const existing = host.querySelector('[data-share-turn]');
      if (!turn) { existing?.remove(); continue; }
      if (existing && existing.dataset.shareTurn === String(turn.id)) continue;
      existing?.remove();
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'act'; b.dataset.shareTurn = String(turn.id);
      // 图标与其它操作按钮一致：弯箭头（只留图标，文字见 title / aria-label）
      b.innerHTML = ICON.share;
      b.title = text('分享这一轮对话（提问 + 全部输出）', 'Share this turn (prompt plus its full output)');
      b.setAttribute('aria-label', text('分享本轮', 'Share turn'));
      host.append(b);
    }
  };
  const renderPicker = () => {
    list.replaceChildren();
    const language = document.documentElement.lang === 'en' ? 'en' : 'zh';
    for (const [index, turn] of turnsOf(store.state.messages).entries()) {
      const label = document.createElement('label'); label.className = 'share-row';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(turn.id);
      input.checked = turnIds(turn).every((id) => selected.has(id));
      const content = document.createElement('span'); content.className = 'share-row-content';
      const role = document.createElement('span'); role.className = 'share-row-role';
      const { prompt, outputs } = turnLabel(turn, language);
      role.textContent = text(`第 ${index + 1} 轮 · 含 ${outputs} 条输出`, `Turn ${index + 1} · ${outputs} output${outputs === 1 ? '' : 's'}`);
      const summary = document.createElement('span'); summary.className = 'share-row-text'; summary.dataset.i18nIgnore = '1';
      summary.textContent = prompt.slice(0, 220);
      content.append(role, summary); label.append(input, content); list.append(label);
    }
    update();
  };
  const open = (turnId) => {
    if (getBusy()) return toast(text('请等待当前任务结束后分享', 'Wait for the current task to finish before sharing'), 'warn');
    opener = document.activeElement; openedSession = store.state.activeSessionId;
    clearArtifact(); status('');
    const turns = turnsOf(store.state.messages);
    const wanted = turns.find((t) => String(t.id) === String(turnId)) || turns[turns.length - 1];
    selected = new Set(wanted ? turnIds(wanted) : []);
    renderPicker(); modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); $('share-close').focus();
  };
  function close() { abort?.abort(); modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); status(''); opener?.focus?.(); }

  const runExport = async (format) => {
    if (exporting) return;
    const turns = selectedTurns();
    if (!turns.length) { hint(); return; }
    if (getBusy()) return toast(text('请等待当前任务结束后分享', 'Wait for the current task to finish before sharing'), 'warn');
    const messages = [...store.state.messages], wanted = new Set(turns.flatMap(turnIds));
    const chosen = shareableMessages(messages).filter((m) => wanted.has(m.id));
    if (!chosen.length) return;
    const files = agent.fs.export(), fs = { read: (p) => Object.hasOwn(files, p) ? files[p] : null };
    const session = store.state.sessions?.find((s) => s.id === store.state.activeSessionId);
    const title = session?.title || 'Dubhe Agent';
    const name = String(title).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 70) || 'Dubhe-Agent';
    const options = { messages, selected: chosen, fs, title, tools: $('share-tools').checked, reasoning: $('share-reasoning').checked, interactive: format === 'html' };
    abort = new AbortController(); const mine = abort; exporting = true; hintShown = false; update();
    status(format === 'html' ? text('正在生成离线 HTML…', 'Building offline HTML…') : text('正在渲染长图（消息多时需要几秒）…', 'Rendering the long image (a few seconds for long turns)…'), 'busy');
    try {
      const html = await buildShareDocument(options);
      if (mine.signal.aborted) return;
      if (format === 'html') {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const how = await shareOrFallback(blob, name + '.html');
        offerArtifact(blob, name + '.html');
        status(how === 'manual'
          ? text('已生成，但浏览器没有交付文件：用下面的链接另存为。', 'Generated, but the browser did not save it: use the link below.')
          : how === 'shared' ? text('已交给系统分享面板。', 'Handed to the system share sheet.')
          : how === 'opened' ? text('已在新的标签页打开，可用浏览器「另存为」保存。', 'Opened in a new tab; use Save As in the browser.')
          : text('分享文件已导出。', 'Share file exported.'), how === 'manual' ? 'warn' : 'ok');
      } else {
        const parts = await captureShare(html, { signal: mine.signal }); if (mine.signal.aborted) return;
        if (parts.length === 1) {
          const how = await shareOrFallback(parts[0], name + '.png');
          offerArtifact(parts[0], name + '.png');
          status(how === 'manual' ? text('长图已生成，但浏览器没有交付文件：用下面的链接另存为。', 'Image generated, but the browser did not save it: use the link below.')
            : how === 'opened' ? text('已在新的标签页打开图片，可长按或另存为保存。', 'Opened in a new tab; long-press or Save As to keep it.')
            : text('分享长图已导出。', 'Share image exported.'), how === 'manual' ? 'warn' : 'ok');
        } else {
          const entries = await Promise.all(parts.map(async (b, i) => ({ name: `${name}-${String(i + 1).padStart(2, '0')}.png`, bytes: new Uint8Array(await b.arrayBuffer()) })));
          const zip = new Blob([createZip(entries)], { type: 'application/zip' });
          await shareOrFallback(zip, name + '-images.zip');
          offerArtifact(zip, name + '-images.zip');
          status(text(`内容较长，已拆成 ${parts.length} 张长图（ZIP），没有截断。`, `Split into ${parts.length} complete long images (ZIP); nothing was truncated.`), 'ok');
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') status(text('导出失败：', 'Export failed: ') + (err.message || err), 'err');
    } finally { exporting = false; update(); }
  };

  $('share-png').addEventListener('click', () => runExport('png'));
  $('share-html').addEventListener('click', () => runExport('html'));
  $('share-open')?.addEventListener('click', () => open());
  $('share-close').addEventListener('click', close);
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-share-turn]'); if (b) { e.preventDefault(); open(b.dataset.shareTurn); } });
  list.addEventListener('change', (e) => {
    if (!e.target.matches('input[type=checkbox]')) return;
    const turn = turnsOf(store.state.messages).find((t) => String(t.id) === String(e.target.value));
    if (!turn) return;
    for (const id of turnIds(turn)) { if (e.target.checked) selected.add(id); else selected.delete(id); }
    update();
  });
  $('share-all').addEventListener('click', () => { selected = new Set(turnsOf(store.state.messages).flatMap(turnIds)); renderPicker(); });
  $('share-none').addEventListener('click', () => { selected.clear(); renderPicker(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const controls = [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')].filter((n) => n.offsetParent !== null), first = controls[0], last = controls.at(-1);
      if (!first) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  store.subscribe(refresh);
  const observer = new root.ownerDocument.defaultView.MutationObserver(() => refresh()); observer.observe(root, { childList: true, subtree: true });
  onLanguageChange(() => { if (modal.classList.contains('open')) renderPicker(); refresh(); });
  refresh();
  return { refresh, open, export: runExport, disconnect: () => observer.disconnect() };
}
