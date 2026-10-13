// 生成首页运行卡的对话区页面（demo/chat-card.html）
// 只保留对话区（消息、工具折叠、输入框），不含侧栏、顶部按钮与分享。
// 标记与样式取自真实产品：js/ui.js、js/ui-toolflow.js、js/editpreview.js 的模板 + css/styles.css + app.html 的输入区。
// 运行：node scripts/build-chat-card.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON } from '../js/icons.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const smartrouter = readFileSync(join(root, 'js/smartrouter.js'), 'utf8');
const ROUTER_ICON_SVG = smartrouter.match(/export const ROUTER_ICON_SVG = '([\s\S]*?)';\n/)[1];
const app = readFileSync(join(root, 'app.html'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 输入区：取真实 app.html 的按钮与文本框，去掉附件菜单与隐藏的文件输入
const grabBtn = (id) => {
  const m = app.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`));
  if (!m) throw new Error('missing ' + id);
  return m[0];
};
const attachBtn = grabBtn('attach-btn');
const voiceBtn = grabBtn('voice-btn');
const sendBtn = grabBtn('send-btn');
const composer = `<div class="composer-wrap">
  <div class="composer">
    <div class="attach-menu-wrap">${attachBtn}</div>
    <textarea id="composer-input" rows="1" aria-label="消息输入框" placeholder="你出想法，Duhbe来实现"></textarea>
    ${voiceBtn}
    ${sendBtn}
  </div>
  <div class="composer-hint">内容由AI生成，请仔细甄别</div>
</div>`;

// ── 数据：一轮完整的任务，与真实消息结构一致 ──
const TASK = '把 date_utils.py 的时区转换改成支持 Asia/Shanghai，处理夏令时和无时区输入，补上单元测试，最后跑一遍 lint';
const NOTE = 'pytest 报错：夏令时间隙里不存在 02:30，应归一到 03:30。我在 _localize() 里补上 gap 处理，然后重跑测试。';
const REPLY = '已完成。date_utils.py 的时区转换现在支持 Asia/Shanghai（UTC+8），并处理了夏令时间隙和无时区输入。测试中发现一处夏令时报错，已修复。新增 4 个用例，pytest 12/12 通过，ruff 无告警。改动已写入工作区，详细说明见 report.md。';

const copyAct = `<button class="act" data-act="copy" title="复制这条消息">${ICON.copy || ''}<span>复制</span></button>`;

function userMsg(text) {
  return `<div class="msg msg-user"><div class="bubble md-body"><p>${esc(text)}</p></div>
    <div class="msg-user-bar"><div class="msg-actions msg-actions-user">${copyAct}</div></div></div>`;
}

function head() {
  return `<div class="msg-head"><span class="avatar"><span class="router-ico">${ROUTER_ICON_SVG}</span></span><span class="msg-model mono">smart_router</span><span class="msg-meta"></span></div>`;
}

// 文件折叠（已读 / 已编辑）：与 ui.js paintPathFold 的结构一致
function pathFold(cls, icon, label, paths, expanded = false) {
  return `<div class="${cls}${expanded ? ' expanded' : ''}"><span class="chip-ico think-ico">${icon || ''}</span><span class="mono chip-name">${esc(label)}</span><div class="chip-detail"><div class="fold-inner"><ul>${paths.map((p) => `<li class="mono">${esc(p)}</li>`).join('')}</ul></div></div></div>`;
}

// 单条命令行：与 ui-toolflow.js 的 tool-call-chip 结构一致
function cmdChip({ id, name, ok, time, fail, detail, expanded }) {
  const state = fail
    ? `<span class="chip-fail" role="img" aria-label="失败" title="${esc(fail.title)}">✗</span><span class="chip-time">${esc(time)}</span>`
    : `<span class="chip-ok" role="img" aria-label="成功">✓</span><span class="chip-time">${esc(time)}</span>`;
  const cls = `chip tool-call-chip done ${fail ? 'fail' : 'ok'}${expanded ? ' expanded' : ''}`;
  return `<div class="${cls}" data-call-id="${id}" data-call-ids="${id}"><span class="chip-ico">${ICON.tool || ''}</span><span class="mono chip-name">${esc(name)}</span><span class="chip-state">${state}</span><div class="chip-detail mono">${detail}</div></div>`;
}

// 命令折叠：与 ui-toolflow.js paintCommandRows + syncRanCommandsFold 一致
function cmdFold(children, { expanded, failed, totalMs, count }) {
  const label = count === 1 ? 'Ran command' : `Ran commands ${count}`;
  const timeHtml = totalMs ? `<span class="chip-time">${esc(totalMs)}</span>` : '';
  return `<div class="ran-commands done ok${failed ? ' fail' : ''}${expanded ? ' expanded' : ''}"><span class="chip-ico chip-ico-term">${ICON.terminal || ICON.tool || ''}</span><span class="mono chip-name">${esc(label)}</span><span class="chip-state">${timeHtml}</span><div class="chip-detail"><div class="fold-inner"><div class="ran-command-items">${children.join('')}</div></div></div></div>`;
}

const outLines = (lines) => `<pre class="cmd-out">${lines.map((l) => (/failed|FAILED|Assertion/.test(l) ? `<span class="cmd-err">${esc(l)}</span>` : esc(l))).join('\n')}</pre>`;

function assistantMsg({ withHead, text, chips }) {
  return `<div class="msg msg-assistant">${withHead ? head() : ''}<div class="md-body${text ? '' : ' empty'}">${text ? `<p>${esc(text)}</p>` : ''}</div><div class="tool-chips">${chips.join('')}</div><div class="msg-toolbar"><div class="msg-actions"><button class="act" data-act="copy" title="复制本轮回复">${ICON.copy || ''}</button></div></div></div>`;
}

// 第 1 段：读取、编辑、运行 pytest（失败）
const turn1Chips = [
  pathFold('explored-files', ICON.file, 'Explored file', ['date_utils.py']),
  pathFold('edited-files', ICON.file, 'Edited files 2', ['date_utils.py', 'tests/test_date.py'], false),
  cmdFold([
    cmdChip({
      id: 'c3', name: 'execute_python', fail: { title: 'AssertionError: expected 03:30' }, time: '1.6s', expanded: true,
      detail: outLines(['FAILED tests/test_date.py::test_dst_gap', '  AssertionError: 2026-03-29 02:30 → expected 03:30', '1 failed, 11 passed in 1.64s']),
    }),
  ], { expanded: true, failed: true, totalMs: '1.6s', count: 1 }),
];
// 第 2 段：说明修复、再次编辑、复跑通过、lint
const turn2Chips = [
  pathFold('edited-files', ICON.file, 'Edited file', ['date_utils.py']),
  cmdFold([
    cmdChip({ id: 'c4', name: 'execute_python', time: '1.8s', detail: outLines(['collected 12 items', 'tests/test_date.py ............ 12 passed in 1.82s']) }),
    cmdChip({ id: 'c5', name: 'execute_python', time: '0.4s', detail: outLines(['All checks passed!']) }),
  ], { expanded: false, failed: false, totalMs: '2.2s', count: 2 }),
];

const messages = [
  userMsg(TASK),
  assistantMsg({ withHead: true, text: '', chips: turn1Chips }),
  assistantMsg({ withHead: false, text: NOTE, chips: turn2Chips }),
  assistantMsg({ withHead: false, text: REPLY, chips: [] }),
].join('\n');

const html = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dubhe Agent 对话区（首页示例）</title>
<link rel="stylesheet" href="../css/styles.css" />
<link rel="stylesheet" href="../assets/hljs/dubhe.css" />
<link rel="stylesheet" href="../fonts/literary.css" />
<style>
  html, body { height: 100%; margin: 0; }
  body { overflow: hidden; background: transparent; }
  .card-root { height: 100%; display: flex; flex-direction: column; box-sizing: border-box; }
  .card-root .messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  .card-root .composer-wrap { flex: 0 0 auto; }
</style>
</head>
<body>
<div class="card-root">
  <div class="messages" id="messages">
${messages}
  </div>
  ${composer}
</div>
</body>
</html>
`;

const out = join(root, 'demo/chat-card.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, 'utf8');
console.log('wrote', out, html.length, 'bytes');
