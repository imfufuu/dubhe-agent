// V1.8.1 修复回归：思考被空 assistant 吞掉、连续 Ran command 合并、技能库死循环、read_file 解码等。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildOpenAIMessages, buildAnthropicPayload, isEmptyAssistantMessage, stripEmptyAssistantMessages,
} from '../js/api.js?v=2026.10.11.1';
import { commandRunFor } from '../js/toolflow.js?v=2026.10.11.1';
import { createStore } from '../js/state.js';
import { createAgent } from '../js/agent.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const sseEv = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const sseDone = 'data: [DONE]\n\n';
const sse = (text) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const toolTurn = (id, name, args, reasoning = '') => sse(
  (reasoning ? sseEv({ choices: [{ delta: { reasoning_content: reasoning } }] }) : '')
  + sseEv({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] } }] })
  + sseEv({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + sseDone);
const textTurn = (text, reasoning = '') => sse(
  (reasoning ? sseEv({ choices: [{ delta: { reasoning_content: reasoning } }] }) : '')
  + sseEv({ choices: [{ delta: { content: text } }] })
  + sseEv({ usage: { prompt_tokens: 7, completion_tokens: 3 }, choices: [] })
  + sseEv({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + sseDone);
const anthropicText = (text) => sse(
  sseEv({ type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 1 } } })
  + sseEv({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  + sseEv({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  + sseEv({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } })
  + sseEv({ type: 'message_stop' }) + sseDone);

const realFetch = globalThis.fetch;
function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const call = { url: String(url) };
    try { call.body = JSON.parse(opts && opts.body); } catch { /* GET */ }
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next;
  };
  return calls;
}
function newAgent(model) {
  const store = createStore();
  store.state.settings.webEnabled = false; store.state.settings.jevEnabled = false;
  store.state.apiKey = 'sk-teamo-test'; store.state.model = model; store.state.settings.thinking = true;
  return { store, agent: createAgent(store, {}) };
}
const lastOf = (arr) => arr[arr.length - 1];

// ── 第 11 条：思考过程消失 ───────────────────────────────────────────────────────────
test('思考：空 assistant 判定与剥离——占位/无产出消息不进请求，末尾 assistant 一定被剥掉', () => {
  assert.equal(isEmptyAssistantMessage({ role: 'assistant', text: '' }), true);
  assert.equal(isEmptyAssistantMessage({ role: 'assistant', text: '  \n' }), true);
  assert.equal(isEmptyAssistantMessage({ role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'x', args: {} }] }), false);
  assert.equal(isEmptyAssistantMessage({ role: 'assistant', text: '', reasoning: '想过' }), false);
  assert.equal(isEmptyAssistantMessage({ role: 'user', text: '' }), false);
  const out = stripEmptyAssistantMessages([
    { role: 'system', text: 's' }, { role: 'user', text: 'u' },
    { role: 'assistant', text: '', reasoning: '仅思考' }, // 末尾无正文无工具 → 也是占位
  ]);
  assert.deepEqual(out.map((m) => m.role), ['system', 'user']);
  const keep = stripEmptyAssistantMessages([{ role: 'user', text: 'u' }, { role: 'assistant', text: 'ok' }, { role: 'user', text: 'again' }, { role: 'assistant', text: '' }]);
  assert.deepEqual(keep.map((m) => m.role), ['user', 'assistant', 'user']);
});

test('思考：DeepSeek 带 tools 时历史 assistant 一律带 reasoning_content（缺的补空串），其它情形不补', () => {
  const msgs = [
    { role: 'user', text: 'u' },
    { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a' } }] },
    { role: 'tool', toolCallId: 'c1', content: 'x' },
    { role: 'assistant', text: 'done', reasoning: '想过' },
  ];
  const filled = buildOpenAIMessages(msgs, { includeReasoning: true, fillMissingReasoning: true });
  assert.equal(filled[1].reasoning_content, '');
  assert.equal(filled[3].reasoning_content, '想过');
  const plain = buildOpenAIMessages(msgs, { includeReasoning: true });
  assert.equal('reasoning_content' in plain[1], false);
  assert.equal(plain[3].reasoning_content, '想过');
  assert.equal('reasoning_content' in buildOpenAIMessages(msgs)[3], false);
});

test('思考：deepseek-v4-pro 连续两个任务——每个请求都带思考参数、且绝不以空 assistant 结尾', async () => {
  const calls = mockFetch([
    toolTurn('call_1', 'write_file', { path: 'a.txt', content: 'hi' }, 'think A'),
    textTurn('done 1', 'think B'),
    toolTurn('call_2', 'write_file', { path: 'b.txt', content: 'yo' }), // 本轮模型没思考
    textTurn('done 2', 'think D'),
  ]);
  try {
    const { store, agent } = newAgent('deepseek-v4-pro');
    await agent.send('task one: write a.txt');
    await agent.send('task two: write b.txt');
    assert.equal(calls.length, 4);
    for (const [i, c] of calls.entries()) {
      const messages = c.body.messages;
      assert.deepEqual(c.body.thinking, { type: 'enabled' }, `#${i} 带思考参数`);
      assert.ok(c.body.reasoning_effort, `#${i} 带 reasoning_effort`);
      const last = lastOf(messages);
      assert.notEqual(last.role, 'assistant', `#${i} 末尾不能是 assistant（会被当成预填而跳过思考）`);
      assert.ok(!messages.some((m) => m.role === 'assistant' && !m.content && !(m.tool_calls || []).length), `#${i} 无空 assistant`);
      for (const m of messages.filter((x) => x.role === 'assistant')) assert.equal(typeof m.reasoning_content, 'string', `#${i} 历史 assistant 回传 reasoning_content`);
    }
    assert.equal(lastOf(calls).body.messages.filter((m) => m.role === 'assistant').map((m) => m.reasoning_content).join('|'), 'think A|think B|');
    const assistants = store.state.messages.filter((m) => m.role === 'assistant');
    assert.deepEqual(assistants.map((m) => m.reasoning || ''), ['think A', 'think B', '', 'think D'], '第二个任务的思考照常落到消息上');
  } finally { globalThis.fetch = realFetch; }
});

test('思考：Anthropic 协议请求同样不以空 assistant（prefill）结尾', async () => {
  const calls = mockFetch([anthropicText('一'), anthropicText('二')]);
  try {
    const { agent } = newAgent('claude-sonnet-5');
    await agent.send('第一问');
    await agent.send('第二问');
    for (const c of calls) {
      const last = lastOf(c.body.messages);
      assert.equal(last.role, 'user', '最后一条必须是 user');
    }
    const payload = buildAnthropicPayload([{ role: 'user', text: 'hi' }, { role: 'assistant', text: '' }]);
    assert.equal(lastOf(payload.messages).role, 'assistant', 'buildAnthropicPayload 本身保持纯函数，剥离在 streamChat 入口完成');
  } finally { globalThis.fetch = realFetch; }
});

test('思考：回合脚注在「请求了思考但模型未思考」时如实标注', () => {
  const ui = read('../js/ui.js');
  assert.match(ui, /未思考/);
  assert.match(ui, /模型本轮自主判定无需思考/);
});

// ── 第 2 条：分开但连续的 Ran command 合并 ─────────────────────────────────────────────
const call = (id, name = 'execute_javascript') => ({ id, name, args: {} });
test('Ran command：跨消息、中间无可见内容的命令段合并为一块，由最后一段承载', () => {
  const msgs = [
    { id: 'u', role: 'user', text: 'go' },
    { id: 'a1', role: 'assistant', text: '先查技能', toolCalls: [call('c1', 'skill_library')], outputOrder: [{ kind: 'text', start: 0, end: 4 }, { kind: 'tools', indices: [0] }], done: true },
    { id: 't1', role: 'tool', toolCallId: 'c1', content: 'ok' },
    { id: 'a2', role: 'assistant', text: '', toolCalls: [call('c2', 'skill_library')], done: true },
    { id: 't2', role: 'tool', toolCallId: 'c2', content: 'ok' },
    { id: 'a3', role: 'assistant', text: '开始生成', toolCalls: [call('c3', 'document_tool')], outputOrder: [{ kind: 'text', start: 0, end: 4 }, { kind: 'tools', indices: [0] }], done: true },
    { id: 't3', role: 'tool', toolCallId: 'c3', content: 'ok' },
    { id: 'a4', role: 'assistant', text: '', toolCalls: [call('c4', 'document_tool')], done: true },
    { id: 't4', role: 'tool', toolCallId: 'c4', content: 'ok' },
    { id: 'a5', role: 'assistant', text: '完成', done: true },
  ];
  const first = commandRunFor(msgs, 'a1', 1);
  assert.equal(first.isHost, false, 'a1 的命令段不再单独成块');
  assert.deepEqual(first.calls.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(first.host, { id: 'a2', part: 0 });
  const second = commandRunFor(msgs, 'a2', 0);
  assert.equal(second.isHost, true);
  assert.deepEqual(commandRunFor(msgs, 'a4', 0).calls.map((c) => c.id), ['c3', 'c4'], '正文「开始生成」是分隔，后一组独立');
});

test('Ran command：可见思考、文件折叠、计划、报错都是分隔，不跨越合并', () => {
  const base = (extra) => [
    { id: 'u', role: 'user', text: 'go' },
    { id: 'a1', role: 'assistant', text: '', toolCalls: [call('c1')], done: true },
    { id: 'a2', role: 'assistant', text: '', toolCalls: [call('c2')], done: true, ...extra },
  ];
  assert.equal(commandRunFor(base({}), 'a1', 0).isHost, false);
  const withThink = base({ reasoning: '想一下' });
  assert.equal(commandRunFor(withThink, 'a1', 0, { reasoningVisible: (m) => !!m.reasoning }).isHost, true, '思考折叠行在中间 → 不合并');
  assert.equal(commandRunFor(base({ publicPlan: { direction: '下一步' } }), 'a1', 0).isHost, true);
  const withRead = [
    { id: 'u', role: 'user', text: 'go' },
    { id: 'a1', role: 'assistant', text: '', toolCalls: [call('c1')], done: true },
    { id: 'a2', role: 'assistant', text: '', toolCalls: [call('r1', 'read_file')], done: true },
    { id: 'a3', role: 'assistant', text: '', toolCalls: [call('c3')], done: true },
  ];
  assert.equal(commandRunFor(withRead, 'a1', 0).isHost, true, 'Explored 折叠在中间 → 不合并');
  const errored = [
    { id: 'u', role: 'user', text: 'go' },
    { id: 'a1', role: 'assistant', text: '', toolCalls: [call('c1')], done: true, error: 'x' },
    { id: 'a2', role: 'assistant', text: '', toolCalls: [call('c2')], done: true },
  ];
  assert.equal(commandRunFor(errored, 'a1', 0).isHost, true);
  const otherTurn = [
    { id: 'u', role: 'user', text: 'go' },
    { id: 'a1', role: 'assistant', text: '', toolCalls: [call('c1')], done: true },
    { id: 'u2', role: 'user', text: 'next' },
    { id: 'a2', role: 'assistant', text: '', toolCalls: [call('c2')], done: true },
  ];
  assert.equal(commandRunFor(otherTurn, 'a1', 0).isHost, true, '不跨用户回合');
  const silentUser = [
    { id: 'u', role: 'user', text: 'go' },
    { id: 'a1', role: 'assistant', text: '', toolCalls: [call('c1')], done: true },
    { id: 's', role: 'user', text: '继续', silent: true },
    { id: 'a2', role: 'assistant', text: '', toolCalls: [call('c2')], done: true },
  ];
  assert.equal(commandRunFor(silentUser, 'a1', 0).isHost, false, '静默续写提示不可见，不打断合并');
});

test('Ran command：界面按分段寻找承载者，并隐藏被并走后变空的分段', () => {
  const ui = read('../js/ui.js');
  assert.match(ui, /commandRunFor\(msgsAll, m\.id, m\._displayFragment \? \(m\._partIndex \|\| 0\) : 0, \{ reasoningVisible \}\)/);
  assert.match(read('../js/ui-toolflow.js'), /_displayFragment: true, _partIndex: index/);
  assert.match(ui, /frag\.classList\.toggle\('frag-empty', empty\)/);
  assert.match(read('../css/styles.css'), /\.assistant-flow > \.assistant-fragment\.frag-empty \{ display: none; \}/);
});

// ── 第 5 条：反复检索/读取「Word 文档生成」技能却不动手 ─────────────────────────────────
const skillIndex = JSON.parse(read('../assets/skills/index.json'));
function mockChatAndSkills(responses) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = new URL(String(url));
    if (u.protocol === 'file:' && u.pathname.includes('/assets/skills/')) {
      if (u.pathname.endsWith('/index.json')) return Response.json(skillIndex);
      return new Response(read('../assets/skills/' + u.pathname.split('/').pop()));
    }
    const call = { url: String(url) };
    try { call.body = JSON.parse(opts && opts.body); } catch { /* GET */ }
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next;
  };
  return calls;
}
const toolNames = (body) => (body.tools || []).map((t) => t.function?.name || t.name);

test('技能库：read 结果头部带工具清单，可被内核解析', async () => {
  const { retrieveSkill, skillToolsFromResult } = await import('../js/skill-library.js');
  mockChatAndSkills([]);
  try {
    const guide = await retrieveSkill({ action: 'read', id: 'word-docx' });
    assert.match(guide, /^\[Built-in extension skill: word-docx; tools: document_tool, read_file, write_file;/);
    assert.match(guide, /\[End of skill\] Next: call document_tool directly; do not search or re-read this skill again\./);
    assert.deepEqual(skillToolsFromResult(guide), { id: 'word-docx', tools: ['document_tool', 'read_file', 'write_file'] });
    assert.equal(skillToolsFromResult('{"skills":[]}'), null);
  } finally { globalThis.fetch = realFetch; }
});

test('技能库：读完技能自动挂载 document_tool；同轮重复 read 回放完整正文而不是只给摘要', async () => {
  const calls = mockChatAndSkills([
    toolTurn('s1', 'skill_library', { action: 'search', query: 'docx word' }),
    toolTurn('s2', 'skill_library', { action: 'read', id: 'word-docx' }),
    toolTurn('s3', 'skill_library', { action: 'read', id: 'word-docx' }),
    textTurn('好的，我直接生成。'),
  ]);
  try {
    const { store, agent } = newAgent('gpt-5.6-sol');
    await agent.send('把会议要点整理好，给我一个能下载的文件');
    assert.equal(calls.length, 4);
    assert.ok(!toolNames(calls[0].body).includes('document_tool'), '用户原话不含文档关键词：起初按需未挂载');
    assert.ok(!toolNames(calls[1].body).includes('document_tool'));
    assert.ok(toolNames(calls[2].body).includes('document_tool'), '读完 word-docx 后下一次请求就带上 document_tool');
    const results = store.state.messages.filter((m) => m.role === 'tool');
    assert.match(results[1].content, /技能 word-docx 已加载，所需工具 document_tool 已挂载到本轮工具表。下一步直接调用 document_tool/);
    assert.match(results[2].content, /幂等复用/);
    assert.match(results[2].content, /# Word 文档生成与重建/, '重复读取拿得到正文');
    assert.match(results[2].content, /下一步直接调用 document_tool/);
    const sys = calls[2].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    assert.doesNotMatch(sys, /按需未挂载：[^\n]*document_tool/, '已挂载的工具不再出现在「按需未挂载」名单里');
  } finally { globalThis.fetch = realFetch; }
});

test('技能库：同轮调用超过上限后不再执行，明确要求动手', async () => {
  const { SKILL_CALLS_PER_TURN } = await import('../js/toolrunner.js');
  const queue = [];
  for (let i = 0; i <= SKILL_CALLS_PER_TURN; i++) queue.push(toolTurn(`q${i}`, 'skill_library', { action: 'search', query: `docx ${i}` }));
  queue.push(textTurn('收到'));
  mockChatAndSkills(queue);
  try {
    const { store, agent } = newAgent('gpt-5.6-sol');
    await agent.send('生成 Word 文档');
    const results = store.state.messages.filter((m) => m.role === 'tool');
    assert.equal(results.length, SKILL_CALLS_PER_TURN + 1);
    assert.doesNotMatch(results[SKILL_CALLS_PER_TURN - 1].content, /⛔/);
    assert.match(results[SKILL_CALLS_PER_TURN].content, new RegExp(`⛔ 执行内核：本轮 skill_library 已调用 ${SKILL_CALLS_PER_TURN} 次`));
  } finally { globalThis.fetch = realFetch; }
});

test('技能库：document_tool 描述自带 DOCX/PPTX 数据格式，常规生成无需先查技能；挂载规则覆盖常见文书', async () => {
  const { TOOL_DEFS } = await import('../js/tools.js');
  const doc = TOOL_DEFS.find((t) => t.name === 'document_tool');
  assert.match(doc.description, /Common DOCX\/PPTX create needs no skill lookup/);
  assert.match(doc.description, /paragraphs:\[/);
  assert.match(doc.description, /slides:\[/);
  assert.doesNotMatch(doc.description, /Use skill_library first/);
  const { TOOL_MOUNT_RULES_SOURCE } = await import('../js/capabilities-mount.js');
  for (const text of ['帮我起草一份劳动合同', '写一份个人简历', '生成本周周报', '整理会议纪要']) assert.match(text, TOOL_MOUNT_RULES_SOURCE.document_tool.text, text);
  const worker = read('../js/document-worker.js');
  assert.match(worker, /if \(v && v\.table && typeof v\.table === 'object'\)/, '段落内联表格，表格落在所在小节下');
});

test('只读工具的同轮复用以文件系统未变为前提：先读、改写、再读会重新执行', async () => {
  const calls = mockChatAndSkills([
    toolTurn('r1', 'read_file', { path: 'a.txt' }),
    toolTurn('w1', 'write_file', { path: 'a.txt', content: 'v2' }),
    toolTurn('r2', 'read_file', { path: 'a.txt' }),
    textTurn('ok'),
  ]);
  try {
    const { store, agent } = newAgent('gpt-5.6-sol');
    agent.fs.write('a.txt', 'v1');
    await agent.send('读 a.txt，改成 v2 再读一次');
    const results = store.state.messages.filter((m) => m.role === 'tool');
    assert.match(results[0].content, /v1/);
    assert.match(results[2].content, /v2/, '第二次读到的是改写后的内容');
    assert.doesNotMatch(results[2].content, /幂等复用/);
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = realFetch; }
});

// ── 第 10 条：read_file 读 SVG 等返回 base64 ─────────────────────────────────────────
test('read_file：data URL 存放的 SVG / 文本解码成原文；二进制只给说明，不回传 base64', async () => {
  const { executeTool } = await import('../js/tools.js');
  const { createFS } = await import('../js/sandbox.js');
  const { readableFileText } = await import('../js/file-text.js');
  const fsx = createFS();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>中文</text></svg>';
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  fsx.write('uploads/logo.svg', `data:image/svg+xml;base64,${b64(svg)}`);
  fsx.write('uploads/a.csv', `data:text/csv;charset=utf-8;base64,${b64('\ufeffname,value\n张三,1\n')}`);
  fsx.write('uploads/b.svg', `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
  fsx.write('uploads/p.png', `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64')}`);
  fsx.write('uploads/plain.txt', 'hello');
  const svgOut = await executeTool('read_file', { path: 'uploads/logo.svg' }, { fs: fsx });
  assert.match(svgOut, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svgOut, /中文/);
  assert.doesNotMatch(svgOut, /base64/);
  const csvOut = await executeTool('read_file', { path: 'uploads/a.csv' }, { fs: fsx });
  assert.match(csvOut, /── uploads\/a\.csv ──\nname,value\n张三,1/, 'BOM 去掉、参数化 data URL 也能解');
  assert.match(await executeTool('read_file', { path: 'uploads/b.svg' }, { fs: fsx }), /<text>中文<\/text>/, '非 base64 的 data URL');
  const pngOut = await executeTool('read_file', { path: 'uploads/p.png' }, { fs: fsx });
  assert.match(pngOut, /\[二进制文件 · image\/png · 12 B\]/);
  assert.match(pngOut, /analyze_image/);
  assert.doesNotMatch(pngOut, /iVBOR/);
  assert.match(await executeTool('read_file', { path: 'uploads/plain.txt' }, { fs: fsx }), /^── uploads\/plain\.txt ──\nhello\n/, '普通文本原样返回');
  const latin = readableFileText(`data:text/plain;base64,${Buffer.from([0xff, 0xfe, 0x00, 0xd8]).toString('base64')}`, 'x.txt');
  assert.equal(latin.binary, true, '不是合法 UTF-8 的「文本」按二进制说明处理，不回 base64');
});

// ── V1.8.1 收尾：失败归类不显示、日常对话免回执、重建落底、连接呼吸点、弹层收起动画、光标与查看器 ──
import { stripFailureClassNote, splitToolStreams, toolWindowsOf } from '../js/toolwindows.js?v=2026.10.11.1';
import { publicTaskPlan, publicPlanMarkdown } from '../js/publicplan.js';
import { CARET_EM, CARET_NUDGE } from '../js/ui-caret.js';
let panel0 = '';
import {
  dualViewKind, csvTableHtml, VIEW_MODES, FV_ART, viewModesHtml, DUAL_VIEW_MAX,
} from '../js/ui-file-viewer.js';

test('失败归类：窗口/回答都不显示，模型上下文仍保留；silent 披露不再追加进正文', () => {
  const note = '文件不存在：x.txt\n\n[执行内核] 失败归类：文件不存在（不重试同参数：先 list_files 探测）。指引\n[执行耗时 3ms]';
  assert.equal(stripFailureClassNote(note).includes('失败归类'), false);
  const split = splitToolStreams(note);
  assert.doesNotMatch(split.stdout + split.stderr, /失败归类/, 'STDOUT/STDERR 窗口过滤归类行');
  const chip = {
    dataset: { callIds: 'k1' }, _items: [{ id: 'k1', name: 'read_file', args: { path: 'x.txt' } }],
    _outs: { k1: note }, _toolStates: { k1: { status: 'error', settled: true } },
  };
  assert.doesNotMatch(toolWindowsOf(chip).stderr, /失败归类/, '失败提示同样不带归类');
  const uiSrc = read('../js/agent.js');
  assert.doesNotMatch(uiSrc, /text = fin\.finalText/, '回答末尾不再追加执行内核披露');
  const ex = read('../js/execution.js');
  assert.doesNotMatch(ex, /`> 失败归类：\$\{detail\}`,?`/, '披露文案本身去掉归类行');
});

test('日常对话不再打「收到任务 / 方向与计划」回执；多步任务保留', () => {
  assert.equal(publicPlanMarkdown(publicTaskPlan('你好')), '');
  assert.equal(publicPlanMarkdown(publicTaskPlan('今天天气怎么样？')), '');
  const plan = publicTaskPlan('帮我写一个 Python 脚本统计 CSV 里的销售额并输出图表文件');
  const md = publicPlanMarkdown(plan);
  assert.match(md, /收到任务/); assert.match(md, /计划/);
  const core = read('../js/prompt-core.js');
  assert.match(core, /不写「收到任务」「任务方向」「计划」之类的回执标题/);
  assert.doesNotMatch(core, /接到任务第一时间先在正文回执/);
});

test('重建消息（进入旧会话 / 回滚 / 展开更早）瞬时落底，不再平滑滑一次', () => {
  const ui = read('../js/ui.js');
  const rb = ui.slice(ui.indexOf('function rebuildMessages'), ui.indexOf('function attachToolResult'));
  assert.match(rb, /jumpToBottom\(\);/);
  assert.match(ui, /msgList\.style\.scrollBehavior = 'auto';\s*msgList\.scrollTop = msgList\.scrollHeight;/);
});

test('连接模型：气泡里是 12px 深色呼吸点，圆环退场；状态栏维持原状（三点跳动还在）', () => {
  const ui = read('../js/ui.js');
  assert.match(ui, /class="connect-dot"/);
  assert.doesNotMatch(ui, /connect-ring/);
  const css = read('../css/styles.css');
  assert.match(css, /\.connect-dot \{ width: 12px; height: 12px;[^}]*animation: connectBreathe/);
  assert.match(css, /\.dot\.busy\.connecting \{ background: #7d8aa0; animation: pulse \.7s ease-in-out infinite, halo 1\.4s ease-out infinite; \}/);
  assert.match(css, /\.sdots i \{[^}]*bounce/);
});

test('Token 构成 / 能力表与附件菜单：收起有同套气泡动画，重开会取消收起', () => {
  const pop = read('../js/ui-popovers.js');
  assert.match(pop, /pop\._exitAnim = a;/);
  assert.match(pop, /translate3d\(0, \$\{dy\}, 0\) scale\(\$\{scale\}\)/);
  assert.match(pop, /if \(pop\._exitAnim\) \{ pop\._exitAnim\.cancel\(\); pop\._exitAnim = null; \}/);
  const motion = read('../js/ui-motion.js');
  assert.match(motion, /getPropertyValue\('--pop-dy'\)/);
  assert.match(motion, /duration: open \? 440 : 150/);
  const css = read('../css/styles.css');
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?#sandbox-panel \{\s*\/\* V1\.8\.1：抽屉开合动画[^\n]*\n\s*transition: transform \.32s var\(--ease\)/);
});

test('查看器：只剩代码/预览两档；md/csv 双视图；提示插画没有 emoji；文件切换器在源码里', () => {
  assert.deepEqual(VIEW_MODES, ['code', 'preview']);
  const modes = viewModesHtml('preview');
  assert.equal((modes.match(/data-view-mode="/g) || []).length, 2, '只有代码/预览两档');
  assert.doesNotMatch(modes, /split|并排/);
  assert.match(modes, /fv-modes-thumb/);
  assert.match(modes, /data-view-mode="preview" aria-pressed="true"/);
  assert.equal(dualViewKind('a.md'), 'md');
  assert.equal(dualViewKind('a.csv'), 'table');
  assert.equal(dualViewKind('a.tsv'), 'table');
  assert.equal(dualViewKind('a.svg'), 'web');
  assert.equal(dualViewKind('a.png'), '');
  assert.match(panel0 = read('../js/ui-files-panel.js'), /byteLen <= DUAL_VIEW_MAX\[dualKind\]/, '超过体积上限不再做双视图');
  const table = csvTableHtml('region,n\n华东,1\n华南,2\n');
  assert.match(table, /<th[^>]*>region<\/th>/); assert.match(table, /fv-rn/);
  assert.deepEqual(Object.keys(FV_ART).sort(), ['binary', 'pdf', 'tooBig']);
  assert.doesNotMatch(FV_ART.binary, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, '插画是线稿 SVG，不是 emoji');
  const panel = read('../js/ui-files-panel.js');
  assert.doesNotMatch(panel.replace(/fv-split|'split'/g, ''), /📦|️|📄/);
  assert.doesNotMatch(panel, /fv-split|'split'/);
  assert.match(panel, /openFileSwitcher/);
  assert.match(panel, /class="fv-path"/);
});

test('光标：1.2em 高、下沉 2px、左移 1px', () => {
  assert.equal(CARET_EM, 1.2);
  assert.deepEqual(CARET_NUDGE, { x: -1, y: 2 });
});
