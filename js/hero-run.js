// 首屏运行卡：流式模拟一次真实的 Agent 对话
// 顺序：输入任务（逐字）→ 发送（气泡飞到顶部）→ 工具调用与命令输出 → 一次运行报错 → Agent 说明并修复 → 复跑通过 → 最终回复（逐字）→ 结束，不留光标
// 结束后对话区可上下滚动回看；运行中若用户手动往上翻，则不再强制贴底。
import { ROUTER_ICON_SVG, SMART_ROUTER_LABEL } from './smartrouter.js?v=2026.10.11.1';

const TASK = '把 date_utils.py 的时区转换改成支持 Asia/Shanghai，处理夏令时和无时区输入，补上单元测试，最后跑一遍 lint';

const FAIL_OUT = [
  'FAILED tests/test_date.py::test_dst_gap',
  '  AssertionError: 2026-03-29 02:30 → expected 03:30',
  '1 failed, 11 passed in 1.64s',
];

const STEPS = [
  { ico: '▤', name: 'Read file', arg: 'date_utils.py', dur: '0.1s', wait: 520 },
  { ico: '⌕', name: 'Search', arg: '"tz_convert" · 6 matches', dur: '0.3s', wait: 640 },
  { ico: '✎', name: 'Edited file', arg: 'date_utils.py', diff: [18, 6], wait: 900 },
  { ico: '✎', name: 'Edited file', arg: 'tests/test_date.py', diff: [42, 0], wait: 760 },
  { ico: '>_', name: 'Ran Command', arg: 'pytest tests/test_date.py', fail: '1.6s', wait: 1000, out: FAIL_OUT },
  {
    note: 'pytest 报错：夏令时间隙里不存在 02:30，应归一到 03:30。我在 _localize() 里补上 gap 处理，然后重跑测试。',
  },
  { ico: '✎', name: 'Edited file', arg: 'date_utils.py', diff: [3, 1], wait: 760 },
  {
    ico: '>_', name: 'Ran Command', arg: 'pytest tests/test_date.py', dur: '1.8s', wait: 1100,
    out: ['collected 12 items', 'tests/test_date.py ............ 12 passed in 1.82s'],
  },
  { ico: '>_', name: 'Ran Command', arg: 'ruff check utils/', dur: '0.4s', wait: 680, out: ['All checks passed!'] },
];

const REPLY = '已完成。date_utils.py 的时区转换现在支持 Asia/Shanghai（UTC+8），并处理了夏令时间隙和无时区输入。测试中发现一处夏令时报错，已修复。新增 4 个用例，pytest 12/12 通过，ruff 无告警。改动已写入工作区，详细说明见 report.md。';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.75 + Math.random() * 0.5);
const ERR_RE = /FAILED|failed|Assertion/;

export function startHeroRun() {
  const card = document.querySelector('.hero-run .run-card');
  if (!card || card.dataset.run) return;
  card.dataset.run = '1';

  const q = (s) => card.querySelector(s);
  q('.rc-av').innerHTML = ROUTER_ICON_SVG;
  q('.rc-model').textContent = SMART_ROUTER_LABEL;
  const thread = q('.rc-thread');
  const inputEl = q('.rc-input');
  const typed = q('.rc-typed');
  const cursor = q('.rc-cursor');
  const placeholder = q('.rc-placeholder');
  const status = q('.rc-status');
  const dot = q('.run-dot');
  const send = q('.rc-send');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 用户手动往上翻时，停止自动贴底，方便回看
  let away = false;
  thread.addEventListener('scroll', () => {
    away = thread.scrollHeight - thread.scrollTop - thread.clientHeight > 40;
  }, { passive: true });
  const scrollEnd = () => { if (!away) thread.scrollTop = thread.scrollHeight; };

  function makeBubble(text) {
    const wrap = document.createElement('div');
    wrap.className = 'rc-user';
    const b = document.createElement('div');
    b.className = 'rc-bubble';
    b.textContent = text;
    wrap.appendChild(b);
    thread.appendChild(wrap);
    return wrap;
  }

  function makeChip(s) {
    const d = document.createElement('div');
    d.className = 'rc-chip';
    d.innerHTML = '<span class="rc-ico"></span><span class="rc-name"></span><span class="rc-arg"></span><span class="rc-ok rc-pending">…</span>';
    d.querySelector('.rc-ico').textContent = s.ico;
    d.querySelector('.rc-name').textContent = s.name;
    d.querySelector('.rc-arg').textContent = s.arg;
    if (s.ico === '✎') d.querySelector('.rc-ico').classList.add('rc-ico-edit');
    if (s.ico === '>_') d.querySelector('.rc-ico').classList.add('rc-ico-run');
    return d;
  }

  function finishChip(el, s) {
    const ok = el.querySelector('.rc-ok');
    ok.classList.remove('rc-pending');
    if (s.fail) {
      ok.classList.add('rc-fail');
      ok.textContent = `✗ ${s.fail}`;
    } else if (s.diff) {
      ok.innerHTML = `<span class="rc-diff"><b>+${s.diff[0]}</b> <i>−${s.diff[1]}</i></span>`;
    } else {
      ok.textContent = `✓ ${s.dur}`;
    }
  }

  function outLineHtml(line) {
    if (ERR_RE.test(line)) return `<span class="rc-err">${line}</span>`;
    return line.replace(/(\d+ passed)/, '<em>$1</em>');
  }

  function renderStatic() {
    thread.innerHTML = '';
    makeBubble(TASK);
    for (const s of STEPS) {
      if (s.note) {
        const p = document.createElement('p');
        p.className = 'rc-note';
        p.textContent = s.note;
        thread.appendChild(p);
        continue;
      }
      const el = makeChip(s);
      thread.appendChild(el);
      finishChip(el, s);
      if (s.out) {
        const pre = document.createElement('pre');
        pre.className = 'rc-out';
        for (const line of s.out) {
          const sp = document.createElement('span');
          sp.innerHTML = outLineHtml(line);
          pre.appendChild(sp);
        }
        thread.appendChild(pre);
      }
    }
    const p = document.createElement('p');
    p.className = 'rc-reply';
    p.textContent = REPLY;
    thread.appendChild(p);
    typed.textContent = '';
    cursor.hidden = true;
    placeholder.hidden = false;
    status.textContent = '已完成';
    dot.classList.add('done');
    thread.scrollTop = thread.scrollHeight;
  }

  async function run() {
    // 1. 逐字输入任务
    placeholder.hidden = true;
    cursor.hidden = false;
    for (const ch of TASK) {
      typed.textContent += ch;
      await sleep(jitter(52));
    }
    await sleep(520);

    // 2. 发送：输入框里的文字飞到对话顶部，变成用户气泡
    send.classList.add('press');
    const cardBox = card.getBoundingClientRect();
    const ox = cardBox.left + card.clientLeft;
    const oy = cardBox.top + card.clientTop;
    const from = inputEl.getBoundingClientRect();
    const bubbleWrap = makeBubble(TASK);
    bubbleWrap.style.visibility = 'hidden';
    const to = bubbleWrap.querySelector('.rc-bubble').getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'rc-ghost';
    ghost.textContent = TASK;
    card.appendChild(ghost);
    const a = { l: from.left - ox, t: from.top - oy, w: from.width, h: from.height };
    const b = { l: to.left - ox, t: to.top - oy, w: to.width, h: to.height };
    const px = (n) => `${n}px`;
    ghost.style.left = px(a.l); ghost.style.top = px(a.t); ghost.style.width = px(a.w); ghost.style.height = px(a.h);
    const anim = ghost.animate(
      [
        { left: px(a.l), top: px(a.t), width: px(a.w), height: px(a.h), opacity: 1 },
        { left: px(b.l), top: px(b.t), width: px(b.w), height: px(b.h), opacity: 1 },
      ],
      { duration: 720, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' },
    );
    await anim.finished.catch(() => {});
    bubbleWrap.style.visibility = '';
    ghost.remove();
    send.classList.remove('press');
    typed.textContent = '';
    cursor.hidden = true;
    placeholder.hidden = false;
    status.textContent = '运行中';
    scrollEnd();
    await sleep(380);

    // 3. 工具调用、命令输出、报错与修复
    for (const s of STEPS) {
      if (s.note) {
        const p = document.createElement('p');
        p.className = 'rc-note';
        const caret = document.createElement('span');
        caret.className = 'rc-caret';
        p.appendChild(caret);
        thread.appendChild(p);
        for (const ch of s.note) {
          p.insertBefore(document.createTextNode(ch), caret);
          scrollEnd();
          await sleep(jitter(22));
        }
        caret.remove();
        await sleep(jitter(260));
        continue;
      }
      const el = makeChip(s);
      thread.appendChild(el);
      scrollEnd();
      await sleep(jitter(s.wait));
      finishChip(el, s);
      if (s.out) {
        const pre = document.createElement('pre');
        pre.className = 'rc-out';
        thread.appendChild(pre);
        for (const line of s.out) {
          const sp = document.createElement('span');
          sp.innerHTML = outLineHtml(line);
          pre.appendChild(sp);
          scrollEnd();
          await sleep(jitter(280));
        }
      }
      await sleep(jitter(200));
    }

    // 4. 最终回复逐字流出，结束后光标移除
    const p = document.createElement('p');
    p.className = 'rc-reply';
    const caret = document.createElement('span');
    caret.className = 'rc-caret';
    p.appendChild(caret);
    thread.appendChild(p);
    for (const ch of REPLY) {
      p.insertBefore(document.createTextNode(ch), caret);
      scrollEnd();
      await sleep(jitter(24));
    }
    caret.remove();
    status.textContent = '已完成';
    dot.classList.add('done');
    scrollEnd();
  }

  // 等开场动画完全结束、首屏入场完成后再开始
  const ready = () => !document.getElementById('intro') && !document.documentElement.classList.contains('intro-on');
  const whenReady = () => {
    if (ready()) setTimeout(() => (reduce ? renderStatic() : run()), reduce ? 0 : 900);
    else setTimeout(whenReady, 150);
  };
  whenReady();
}
