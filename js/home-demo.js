import { syncMessageRhythm } from './ui-message-rhythm.js?v=2026.10.11.1';
// The homepage is an explicitly simulated, replayable turn, not a second agent.
// Use the conversation's diff model and stable renderer to keep both views aligned.
import { buildFileEditPreview } from './editpreview.js?v=2026.10.11.1';
import { paintEditFoldContent } from './ui-editpreview.js?v=2026.10.11.1';
import { ICON } from './icons.js?v=2026.10.11.1';
import { animateMessageSend } from './ui-send-animation.js?v=2026.10.11.1';

const PROMPT = '把 date_utils.py 的时区转换改成支持 Asia/Shanghai，处理夏令时和无时区输入，补上单元测试，最后跑一遍 lint';
const SUMMARY = '已完成。时区转换支持 Asia/Shanghai，并处理无时区输入与夏令时间隙。发现的 DST 测试失败已修复：12/12 测试通过，ruff 无告警。';
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
    const run = ++generation; animation?.cancel(); animation = null; started = true; follow = true;
    messages.replaceChildren(); input.value = ''; input.style.height = ''; root.dataset.phase = 'typing';
    status.textContent = 'Agent 运行演示 · 正在输入';
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
    const stream = async (node, value, { inputMode = false } = {}) => {
      if (!inputMode) node.classList.add('demo-stream');
      const chars = Array.from(value), stride = reduce ? chars.length : 1;
      for (let i = 0; i < chars.length; i += stride) {
        await wait(demoCharacterDelay(chars[i], i, inputMode));
        const part = chars.slice(0, i + stride).join('');
        if (inputMode) { node.value = part; node.style.height = 'auto'; node.style.height = `${Math.min(node.scrollHeight, 70)}px`; }
        else node.textContent = part;
        scroll();
      }
      node.classList.remove('demo-stream');
    };
    const say = async (text) => {
      const n = assistant(), body = make('div', 'md-body'), p = make('p', ''); body.append(p); n.append(body);
      await wait(220); await stream(p, text); await wait(180); return n;
    };
    const edit = async (specs) => {
      const n = make('div', 'edited-files expanded'); assistant().append(n);
      const calls = [], disk = new Map(specs.map((s) => [s.path, s.before]));
      const fs = { read: (p) => disk.get(p) || '' };
      const paint = (live) => paintEditFoldContent(n, { icon: ICON.edited, label: live ? 'Writing files' : `Edited file${specs.length > 1 ? `s ${specs.length}` : ''}`,
        paths: specs.map((s) => s.path), discarded: new Set(), preview: buildFileEditPreview(calls, fs), live, state: live ? '写入中…' : '' });
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
      n.querySelector('.chip-state').textContent = '执行中…'; scroll();
      const lines = output.split('\n');
      for (let i = 0; i < lines.length; i++) {
        await wait(durationMs / lines.length);
        out.textContent = lines.slice(0, i + 1).join('\n'); scroll();
      }
      totalCommandMs += durationMs;
      activity(n, false); n.querySelector('.chip-name').textContent = 'Ran command';
      const state = n.querySelector('.chip-state'); state.replaceChildren();
      state.append(make('span', failed ? 'chip-fail' : 'chip-ok', failed ? '✗' : '✓'), make('span', 'chip-time', `${(durationMs / 1000).toFixed(1)}s`));
      state.title = `总耗时 ${(durationMs / 1000).toFixed(1)}s（模拟）`;
      n.classList.toggle('fail', failed); scroll(); await settleFold(n);
    };
    try {
      await wait(700); await stream(input, PROMPT, { inputMode: true }); await wait(650);
      const origin = input.getBoundingClientRect();
      // Clear BEFORE inserting/animating the bubble: never show two copies in flight.
      input.value = ''; input.style.height = ''; root.dataset.phase = 'sending';
      const user = make('div', 'msg msg-user'), bubble = make('div', 'bubble md-body');
      bubble.append(make('p', '', PROMPT)); user.append(bubble); messages.append(user); messages.scrollTop = 0;
      animation = animateMessageSend(bubble, origin, { reducedMotion: reduce });
      if (animation) { await animation.finished; check(); animation = null; }
      else await wait(100);
      root.dataset.phase = 'agent'; status.textContent = 'Agent 运行演示 · 模拟流式输出';
      await say('先检查时区转换与现有测试，再修改实现并验证。');
      const read = fold('explored-files', 'Reading files', ICON.file), detail = make('div', 'chip-detail'), inner = make('div', 'fold-inner'), list = make('ul', '');
      for (const path of ['date_utils.py', 'tests/test_date.py']) list.append(make('li', 'mono', path));
      inner.append(list); detail.append(inner); read.append(detail); assistant().append(read); bindFold(read); activity(read, true); scroll();
      await wait(1600); activity(read, false); read.querySelector('.chip-name').textContent = 'Explored files 2'; await settleFold(read);
      await edit([{ path: 'date_utils.py', before: BEFORE, after: AFTER }, { path: 'tests/test_date.py', before: '', after: TESTS }]);
      await command('pytest -q', 'FAILED tests/test_date.py::test_dst_gap\nAssertionError: expected 03:30\n1 failed, 11 passed in 1.64s', true, 1640);
      await say('夏令时间隙中的 02:30 不存在。我会用 UTC 往返转换归一化到 03:30，然后重跑测试。');
      await edit([{ path: 'date_utils.py', before: AFTER, after: AFTER + '\n' + GAP_FIX }]);
      await command('pytest -q && ruff check .', '12 passed in 1.82s\nAll checks passed!');
      const final = await say(SUMMARY), toolbar = make('div', 'msg-toolbar');
      const actions = make('div', 'msg-actions');
      // Appearance-only controls: no clipboard, regenerate, rollback or feedback handlers.
      for (const [action, label, icon, extra] of [
        ['copy', '复制本轮回复', ICON.copy, ''],
        ['rollback', '回滚', ICON.rollback, ' act-danger'],
        ['regen', '重新生成', ICON.regen, ' act-regen'],
        ['up', '赞', ICON.thumbUp, ' feedback-btn'],
        ['down', '踩', ICON.thumbDown, ' feedback-btn'],
        ['share', '分享本轮', ICON.share, ''],
      ]) {
        const button = make('button', 'act' + extra);
        button.type = 'button'; button.dataset.act = action; button.title = label;
        button.setAttribute('aria-label', label); button.innerHTML = icon; actions.append(button);
      }
      const foot = make('div', 'msg-foot mono', `命令总耗时 ${(totalCommandMs / 1000).toFixed(1)}s · 模拟`);
      toolbar.append(actions, foot); final.append(toolbar); root.dataset.phase = 'complete';
      status.textContent = 'Agent 运行演示 · 已完成'; scroll();
    } catch (error) {
      if (error.name !== 'AbortError') { status.textContent = '演示暂不可用，请重播'; console.error(error); }
    }
  }
  replay.addEventListener('click', play);
  let observer;
  if (autoStart && typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible && !started) play(); });
    observer.observe(root);
  } else if (autoStart) play();
  return { play, destroy() { generation++; animation?.cancel(); observer?.disconnect(); replay.removeEventListener('click', play); } };
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('.card-root');
  if (root) mountHomeDemo(root);
}
