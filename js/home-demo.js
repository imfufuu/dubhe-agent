import { syncMessageRhythm } from './ui-message-rhythm.js?v=2026.10.11.1';
// The homepage is an explicitly simulated, replayable turn, not a second agent.
// Use the conversation's diff model and stable renderer to keep both views aligned.
import { buildFileEditPreview } from './editpreview.js?v=2026.10.11.1';
import { paintEditFoldContent } from './ui-editpreview.js?v=2026.10.11.1';
import { ICON } from './icons.js';
import { animateMessageSend } from './ui-send-animation.js?v=2026.10.11.1';
import { revealChunks } from './ui-chunks.js?v=2026.10.11.1';
import { readThemePreference } from './theme.js';
import { getLanguage, LANGUAGE_KEY, onLanguageChange } from './locale.js';

// 演示是「模拟的一轮对话」，内容语言跟随界面语言：脚本按 zh / en 各写一份，
// 切语言时清空并按新语言重播（见 mountHomeDemo 底部的语言订阅），不做逐句机翻。
const DEMO_SCRIPTS = {
  zh: {
    prompt: '把 date_utils.py 的时区转换改成支持 Asia/Shanghai，处理夏令时和无时区输入，补上单元测试，最后跑一遍 lint',
    summary: '已完成。时区转换支持 Asia/Shanghai，并处理无时区输入与夏令时间隙。发现的 DST 测试失败已修复：12/12 测试通过，ruff 无告警。',
    intro: '先检查时区转换与现有测试，再修改实现并验证。',
    gap: '夏令时间隙中的 02:30 不存在。我会用 UTC 往返转换归一化到 03:30，然后重跑测试。',
    statusIdle: 'Agent 运行演示 · 模拟数据',
    statusTyping: 'Agent 运行演示 · 正在输入',
    statusStreaming: 'Agent 运行演示 · 模拟流式输出',
    statusDone: 'Agent 运行演示 · 已完成',
    statusFailed: '演示暂不可用，请重播',
    replay: '↻ 重播',
    running: '执行中…',
    writing: '写入中…',
    commandTooltip: (s) => `总耗时 ${s}s（模拟）`,
    footer: (s) => `命令总耗时 ${s}s · 模拟`,
    actions: { copy: '复制本轮回复', rollback: '回滚', regen: '重新生成', up: '赞', down: '踩', share: '分享本轮' },
    demoLabel: 'Agent 演示对话',
    inputLabel: '演示用户逐字输入',
    placeholder: '你出想法，Dubhe 来实现',
    sendTitle: '自动发送演示',
    sendLabel: '演示自动发送',
    hint: '模拟运行，不调用模型或实际执行工具',
  },
  en: {
    prompt: 'Update the timezone conversion in date_utils.py to support Asia/Shanghai, handle DST and naive inputs, add unit tests, then run lint',
    summary: 'Done. Timezone conversion now supports Asia/Shanghai and handles naive inputs and the DST gap. The failing DST test is fixed: 12/12 tests pass and ruff reports no warnings.',
    intro: 'First I will review the timezone conversion and the existing tests, then change the implementation and verify.',
    gap: '02:30 does not exist inside the DST gap. I will normalize it to 03:30 with a UTC round-trip, then rerun the tests.',
    statusIdle: 'Agent demo · simulated data',
    statusTyping: 'Agent demo · typing',
    statusStreaming: 'Agent demo · simulated streaming',
    statusDone: 'Agent demo · complete',
    statusFailed: 'Demo unavailable; press replay',
    replay: '↻ Replay',
    running: 'Running…',
    writing: 'Writing…',
    commandTooltip: (s) => `Total ${s}s (simulated)`,
    footer: (s) => `Command time ${s}s · simulated`,
    actions: { copy: 'Copy this reply', rollback: 'Roll back', regen: 'Regenerate', up: 'Good', down: 'Bad', share: 'Share this turn' },
    demoLabel: 'Agent demo conversation',
    inputLabel: 'Simulated user typing',
    placeholder: 'You bring the idea, Dubhe builds it',
    sendTitle: 'Auto-send demo',
    sendLabel: 'Demo auto-send',
    hint: 'Simulated run; no model calls and no real tool execution',
  },
};
const demoScript = () => DEMO_SCRIPTS[getLanguage()] ?? DEMO_SCRIPTS.zh;
const BEFORE = 'from datetime import datetime\n\ndef to_timezone(value):\n    return value.astimezone()\n';
const AFTER = 'from datetime import datetime\nfrom zoneinfo import ZoneInfo\n\ndef to_timezone(value, target="Asia/Shanghai"):\n    if value.tzinfo is None:\n        value = value.replace(tzinfo=ZoneInfo(target))\n    return value.astimezone(ZoneInfo(target))\n';
const TESTS = 'def test_shanghai():\n    assert to_timezone(naive).utcoffset().total_seconds() == 28800\n\ndef test_dst_gap():\n    assert normalize_gap(nonexistent).hour == 3\n';
const GAP_FIX = 'def normalize_gap(value):\n    return value.astimezone(ZoneInfo("UTC")).astimezone(value.tzinfo)\n';
const make = (tag, cls, text) => {
  const n = document.createElement(tag); n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// Deterministic micro-pauses make replay/test behavior reproducible, not a fast ticker.
export function demoCharacterDelay(char, index, inputMode = false) {
  const base = inputMode ? 48 + (index % 5) * 9 : 38 + (index % 4) * 12;
  return base + (/[。！？.!?]/.test(char) ? 200 : /[，、,;；:：\n]/.test(char) ? 90 : 0);
}

export function mountHomeDemo(root, { autoStart = true, delay = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const messages = root.querySelector('#messages'), input = root.querySelector('#composer-input');
  const status = root.querySelector('#demo-status'), replay = root.querySelector('#demo-replay');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let generation = 0, animation = null, visible = true, started = false, follow = true;
  // 演示卡的外壳文字（状态栏、重播、输入框提示等）也跟随界面语言，挂载与切语言时同步。
  const syncChrome = () => {
    const S = demoScript();
    status.textContent = S.statusIdle;
    replay.textContent = S.replay;
    messages.setAttribute('aria-label', S.demoLabel);
    input.setAttribute('aria-label', S.inputLabel);
    input.placeholder = S.placeholder;
    const send = root.querySelector('#send-btn');
    if (send) { send.title = S.sendTitle; send.setAttribute('aria-label', S.sendLabel); }
    const hint = root.querySelector('.composer-hint');
    if (hint) hint.textContent = S.hint;
    document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
  };
  syncChrome();
  const scroll = () => { syncMessageRhythm(messages); if (follow) messages.scrollTop = messages.scrollHeight; };
  messages.addEventListener('scroll', () => {
    follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60;
  });
  const fold = (cls, label, icon) => {
    const n = make('div', `${cls} expanded`);
    const ico = make('span', 'chip-ico'); ico.innerHTML = icon || ICON.tool || '';
    n.append(ico, make('span', 'mono chip-name', label), make('span', 'chip-state'));
    return n;
  };
  const bindFold = (n) => {
    // Only the header is a toggle; selecting output never closes the panel.
    const header = n.querySelector(':scope > .chip-name');
    header.classList.add('demo-toggle'); header.tabIndex = 0; header.setAttribute('role', 'button');
    const detail = n.querySelector(':scope > .chip-detail');
    detail.id = `demo-detail-${generation}-${root.querySelectorAll('.demo-toggle').length}`;
    header.setAttribute('aria-controls', detail.id);
    const sync = () => header.setAttribute('aria-expanded', String(n.classList.contains('expanded')));
    n._syncFold = sync;
    header.addEventListener('click', () => { n.classList.toggle('expanded'); n._userToggle = n.classList.contains('expanded'); sync(); });
    header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); } });
    sync();
  };
  const activity = (n, active) => {
    n.classList.toggle('is-working', active); n.classList.toggle('running', active);
    n.classList.toggle('done', !active); n.setAttribute('aria-busy', String(active));
  };
  const assistant = () => { const n = make('div', 'msg msg-assistant'); messages.append(n); return n; };

  async function play() {
    const S = demoScript();
    const run = ++generation; animation?.cancel(); animation = null; started = true; follow = true;
    messages.replaceChildren(); input.value = ''; input.style.height = ''; root.dataset.phase = 'typing';
    status.textContent = S.statusTyping;
    const check = () => { if (run !== generation) throw new DOMException('Replay', 'AbortError'); };
    const wait = async (ms) => {
      check(); await delay(reduce ? Math.min(ms, 100) : ms); check();
      while (document.hidden || !visible) { await delay(150); check(); }
    };
    const settleFold = async (n) => {
      await wait(850);
      if (n._userToggle == null) n.classList.remove('expanded');
      n._syncFold?.(); scroll();
    };
    const streamInput = async (node, value) => {
      const chars = Array.from(value), stride = reduce ? chars.length : 1;
      for (let i = 0; i < chars.length; i += stride) {
        await wait(demoCharacterDelay(chars[i], i, true));
        node.value = chars.slice(0, i + stride).join('');
        node.style.height = 'auto'; node.style.height = `${Math.min(node.scrollHeight, 70)}px`;
        scroll();
      }
    };
    const streamChunks = async (body, node, value) => {
      const chars = Array.from(value), stride = 10;
      const state = body._chunk || (body._chunk = { blocks: 0, texts: [] });
      const animate = document.documentElement.dataset.motion !== 'off';
      for (let at = 0; at < chars.length; at += stride) {
        const end = Math.min(chars.length, at + stride);
        await wait(animate ? demoCharacterDelay(chars[end - 1], Math.floor(at / stride), false) : 0);
        node.textContent = chars.slice(0, end).join('');
        revealChunks(body, state, animate);
        scroll();
      }
    };
    const say = async (text) => {
      const n = assistant(), body = make('div', 'md-body'), p = make('p', ''); body.append(p); n.append(body);
      await wait(220); await streamChunks(body, p, text); await wait(180); return n;
    };
    const edit = async (specs) => {
      const n = make('div', 'edited-files expanded'); assistant().append(n);
      const calls = [], disk = new Map(specs.map((s) => [s.path, s.before]));
      const fs = { read: (p) => disk.get(p) || '' };
      const paint = (live) => paintEditFoldContent(n, { icon: ICON.edited, label: live ? 'Writing files' : `Edited File${specs.length > 1 ? `s ${specs.length}` : ''}`,
        paths: specs.map((s) => s.path), discarded: new Set(), preview: buildFileEditPreview(calls, fs), live, state: live ? S.writing : '' });
      for (const [i, spec] of specs.entries()) {
        const call = { id: `demo-write-${i}`, name: 'write_file', status: 'running', args: { path: spec.path, content: '' } };
        calls.push(call); activity(n, true); paint(true);
        if (!n.querySelector('.demo-toggle')) bindFold(n);
        const chars = Array.from(spec.after), stride = reduce ? chars.length : 8;
        for (let at = 0; at < chars.length; at += stride) {
          await wait(105 + (at % 3) * 30); call.args.content = chars.slice(0, at + stride).join(''); paint(true); scroll();
        }
        disk.set(spec.path, spec.after); call.status = 'ok'; paint(true);
      }
      activity(n, false); paint(false); scroll(); await settleFold(n);
    };
    let totalCommandMs = 0;
    const command = async (code, output, failed = false, durationMs = 2200) => {
      const n = fold('ran-commands', 'Running command', ICON.terminal);
      const detail = make('div', 'chip-detail'), inner = make('div', 'fold-inner');
      const codeBlock = make('pre', 'mono cmd-out', `$ ${code}`), out = make('pre', 'mono cmd-out');
      inner.append(codeBlock, out); detail.append(inner); n.append(detail); assistant().append(n);
      bindFold(n); activity(n, true);
      n.querySelector('.chip-state').textContent = S.running; scroll();
      const lines = output.split('\n');
      for (let i = 0; i < lines.length; i++) {
        await wait(durationMs / lines.length);
        out.textContent = lines.slice(0, i + 1).join('\n'); scroll();
      }
      totalCommandMs += durationMs;
      activity(n, false); n.querySelector('.chip-name').textContent = 'Ran command';
      const state = n.querySelector('.chip-state'); state.replaceChildren();
      state.append(make('span', failed ? 'chip-fail' : 'chip-ok', failed ? '✗' : '✓'), make('span', 'chip-time', `${(durationMs / 1000).toFixed(1)}s`));
      state.title = S.commandTooltip((durationMs / 1000).toFixed(1));
      n.classList.toggle('fail', failed); scroll(); await settleFold(n);
    };
    try {
      await wait(700); await streamInput(input, S.prompt); await wait(650);
      const origin = input.getBoundingClientRect();
      // Clear BEFORE inserting/animating the bubble: never show two copies in flight.
      input.value = ''; input.style.height = ''; root.dataset.phase = 'sending';
      const user = make('div', 'msg msg-user'), bubble = make('div', 'bubble md-body');
      bubble.append(make('p', '', S.prompt)); user.append(bubble); messages.append(user); messages.scrollTop = 0;
      animation = animateMessageSend(bubble, origin, { reducedMotion: reduce });
      if (animation) { await animation.finished; check(); animation = null; }
      else await wait(100);
      root.dataset.phase = 'agent'; status.textContent = S.statusStreaming;
      await say(S.intro);
      const read = fold('explored-files', 'Reading files', ICON.file), detail = make('div', 'chip-detail'), inner = make('div', 'fold-inner'), list = make('ul', '');
      for (const path of ['date_utils.py', 'tests/test_date.py']) list.append(make('li', 'mono', path));
      inner.append(list); detail.append(inner); read.append(detail); assistant().append(read); bindFold(read); activity(read, true); scroll();
      await wait(1600); activity(read, false); read.querySelector('.chip-name').textContent = 'Explored files 2'; await settleFold(read);
      await edit([{ path: 'date_utils.py', before: BEFORE, after: AFTER }, { path: 'tests/test_date.py', before: '', after: TESTS }]);
      await command('pytest -q', 'FAILED tests/test_date.py::test_dst_gap\nAssertionError: expected 03:30\n1 failed, 11 passed in 1.64s', true, 1640);
      await say(S.gap);
      await edit([{ path: 'date_utils.py', before: AFTER, after: AFTER + '\n' + GAP_FIX }]);
      await command('pytest -q && ruff check .', '12 passed in 1.82s\nAll checks passed!');
      const final = await say(S.summary), toolbar = make('div', 'msg-toolbar');
      const actions = make('div', 'msg-actions');
      // Appearance-only controls: no clipboard, regenerate, rollback or feedback handlers.
      for (const [action, label, icon, extra] of [
        ['copy', S.actions.copy, ICON.copy, ''],
        ['rollback', S.actions.rollback, ICON.rollback, ' act-danger'],
        ['regen', S.actions.regen, ICON.regen, ' act-regen'],
        ['up', S.actions.up, ICON.thumbUp, ' feedback-btn'],
        ['down', S.actions.down, ICON.thumbDown, ' feedback-btn'],
        ['share', S.actions.share, ICON.share, ''],
      ]) {
        const button = make('button', 'act' + extra);
        button.type = 'button'; button.dataset.act = action; button.title = label;
        button.setAttribute('aria-label', label); button.innerHTML = icon; actions.append(button);
      }
      const foot = make('div', 'msg-foot mono', S.footer((totalCommandMs / 1000).toFixed(1)));
      toolbar.append(actions, foot); final.append(toolbar); root.dataset.phase = 'complete';
      status.textContent = S.statusDone; scroll();
    } catch (error) {
      if (error.name !== 'AbortError') { status.textContent = S.statusFailed; console.error(error); }
    }
  }
  replay.addEventListener('click', play);
  // 切换语言：外壳文字立即换新语言；已经开始过的演示自动清空并按新语言重播。
  // 演示在 iframe 里跑，父页切语言只会触发跨窗口的 storage 事件（同源），所以两条路都订阅：
  // storage（真实 iframe 场景）+ onLanguageChange（同文档场景，如单测）。
  const onLangSwitch = () => { syncChrome(); if (started) play(); };
  const onStorage = (e) => { if (!e.key || e.key === LANGUAGE_KEY) onLangSwitch(); };
  window.addEventListener('storage', onStorage);
  const offLanguage = onLanguageChange(onLangSwitch);
  let observer;
  if (autoStart && typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible && !started) play(); });
    observer.observe(root);
  } else if (autoStart) play();
  return {
    play,
    destroy() {
      generation++; animation?.cancel(); observer?.disconnect();
      window.removeEventListener('storage', onStorage); offLanguage();
      replay.removeEventListener('click', play);
    },
  };
}

// V1.8.1：演示卡片跟随首页主题（以前 iframe 固定浅色：深色首页里输出文字与卡片底色几乎重合、看不见）
export function syncDemoTheme(doc = document, host = (typeof window !== 'undefined' && window.parent !== window) ? window.parent : null) {
  let theme = '';
  try { theme = host?.document?.documentElement?.dataset?.theme || ''; } catch { /* 跨源嵌入：退回存储偏好 */ }
  if (!theme) theme = readThemePreference('light');
  doc.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  return doc.documentElement.dataset.theme;
}

if (typeof document !== 'undefined') {
  syncDemoTheme();
  try { new MutationObserver(() => syncDemoTheme()).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch { /* 非同源父页 */ }
  window.addEventListener('storage', () => syncDemoTheme());
  const root = document.querySelector('.card-root');
  if (root) mountHomeDemo(root);
}
