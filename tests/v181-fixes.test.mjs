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
import { translateUI } from '../js/ui-language.js';

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
    assert.match(results[1].content, /技能 word-docx 已加载，所需工具组 document_tool、xlsx_tool 已挂载到本轮工具表。下一步直接调用 document_tool/);
    assert.match(results[2].content, /幂等复用/);
    assert.match(results[2].content, /# Word 文档生成与重建/, '重复读取拿得到正文');
    assert.match(results[2].content, /下一步直接调用 document_tool/);
    const sys = calls[2].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    assert.doesNotMatch(sys, /^- document_tool:/m, '已挂载的工具不再出现在紧凑的按需目录里');
  } finally { globalThis.fetch = realFetch; }
});

test('工具目录 search→read：首轮只发紧凑目录，读取 XLSX Schema 后自动一次挂载 Office 文档组', async () => {
  const { searchToolDirectory } = await import('../js/tool-catalog.js');
  const { TOOL_DEFS } = await import('../js/tools.js');
  assert.ok(searchToolDirectory(TOOL_DEFS, '请帮我做个电子表格').some((tool) => tool.name === 'xlsx_tool'), '自然中文查询可命中 XLSX');
  const calls = mockFetch([
    toolTurn('tl1', 'tool_library', { action: 'search', query: 'xlsx spreadsheet excel' }),
    toolTurn('tl2', 'tool_library', { action: 'read', name: 'xlsx_tool' }),
    textTurn('明白，我可以处理工作簿。'),
  ]);
  try {
    const { store, agent } = newAgent('gpt-5.6-sol');
    await agent.send('你好');
    assert.equal(calls.length, 3);
    const namesOf = (call) => toolNames(call.body);
    assert.ok(!namesOf(calls[0]).includes('xlsx_tool') && !namesOf(calls[0]).includes('document_tool'));
    const sys = calls[0].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    assert.match(sys, /按需未挂载工具目录/);
    assert.match(sys, /xlsx_tool: 本地检查或生成 XLSX/);
    assert.doesNotMatch(sys, /parameters|input_schema|sheets:\[/i, '未挂载 schema 不进入系统提示');
    const results = store.state.messages.filter((m) => m.role === 'tool');
    assert.equal(results.length, 2);
    assert.match(results[0].content, /"name": "xlsx_tool"/);
    assert.doesNotMatch(results[0].content, /"parameters"/);
    assert.match(results[1].content, /\[Tool definition loaded: xlsx_tool\]/);
    assert.match(results[1].content, /完整 Schema/);
    const mounted = namesOf(calls[2]);
    assert.ok(mounted.includes('document_tool') && mounted.includes('xlsx_tool'));
    assert.ok(mounted.indexOf('document_tool') > mounted.indexOf('tool_library'), '动态 Office 工具追加在核心缓存前缀之后');
    assert.ok(mounted.indexOf('xlsx_tool') > mounted.indexOf('tool_library'));
    const sysAfter = calls[2].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    assert.doesNotMatch(sysAfter, /^- xlsx_tool:/m, '已挂载工具从按需目录移除');
  } finally { globalThis.fetch = realFetch; }
});

test('轻量工具路由在首个模型请求前完成：XLSX 意图已一次挂载 DOCX/PPTX/PDF + XLSX 组', async () => {
  const calls = mockFetch([textTurn('我会按要求处理工作簿。')]);
  try {
    const { agent } = newAgent('gpt-5.6-sol');
    await agent.send('请生成一个 Excel XLSX 工作簿');
    assert.equal(calls.length, 1, '路由不额外调用分类模型，也不等工具报错');
    const names = toolNames(calls[0].body);
    assert.ok(names.includes('document_tool') && names.includes('xlsx_tool'));
    assert.ok(names.indexOf('document_tool') > names.indexOf('tool_library'));
    assert.ok(names.indexOf('xlsx_tool') > names.indexOf('tool_library'));
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
import { stripFailureClassNote, splitToolStreams, hasSubstantiveToolOutput, classifyToolResult, toolWindowsOf } from '../js/toolwindows.js?v=2026.10.11.1';
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
  const emptyExec = '[JavaScript 沙箱]\n（执行完成，无输出）\n[env: web-worker; apis: console, files; files_keys: []]\n[执行耗时 4ms]';
  assert.equal(hasSubstantiveToolOutput(emptyExec), false, '环境、耗时和无输出包装不能伪装成 stdout');
  assert.deepEqual(classifyToolResult(emptyExec), { status: 'error', note: 'No output', noOutput: true });
  assert.deepEqual(classifyToolResult('not found', { status: 'error', errorNote: 'not found' }),
    { status: 'error', note: 'not found', noOutput: false });
  assert.deepEqual(classifyToolResult('[error] boom'), { status: 'error', note: '', noOutput: false });
  const noOutputChip = { dataset: { callIds: 'silent' }, _items: [{ id: 'silent', name: 'execute_javascript', args: { code: 'void 0' } }],
    _outs: { silent: emptyExec }, _toolStates: { silent: { status: 'error', settled: true, note: 'No output', noOutput: true } } };
  const noOutputWindows = toolWindowsOf(noOutputChip);
  assert.equal(noOutputWindows.noOutput, true); assert.equal(noOutputWindows.stdout, ''); assert.equal(noOutputWindows.stderr, '');
  const errorExec = '[Python sandbox]\n── Error ──\nNameError: missing\n[Duration 4ms]';
  const errorChip = { dataset: { callIds: 'err' }, _items: [{ id: 'err', name: 'execute_python', args: { code: 'bad' } }],
    _outs: { err: errorExec }, _toolStates: { err: { status: 'error', settled: true } } };
  const errorWindows = toolWindowsOf(errorChip);
  assert.equal(errorWindows.stdout, '', '只有错误时不生成假 STDOUT'); assert.match(errorWindows.stderr, /NameError/);
  const uiSrc = read('../js/agent.js');
  assert.doesNotMatch(uiSrc, /text = fin\.finalText/, '回答末尾不再追加执行内核披露');
  const ex = read('../js/execution.js');
  assert.doesNotMatch(ex, /`> 失败归类：\$\{detail\}`,?`/, '披露文案本身去掉归类行');
});

test('助手气泡的整轮耗时与完成时间会写回并经刷新持久恢复', () => {
  const ui = read('../js/ui.js');
  const timing = read('../js/ui-toolflow.js');
  const state = read('../js/state.js');
  assert.match(ui, /persistTurnTiming\(store, ms, msgNodes, paintFoot, syncAssistantShell, renderTimeStats\)/);
  assert.match(timing, /last\.durationMs = ms; last\.ts = Date\.now\(\);/);
  assert.match(timing, /store\.save\?\.\(true\)/);
  assert.match(ui, /const clock = m\.durationMs != null \? fmtClock\(m\.durationMs\) : '';/);
  assert.match(ui, /durationMs: m\.durationMs, thinkingBlocks: m\.thinkingBlocks/);
  assert.match(state, /durationMs: m\.durationMs/);
  assert.match(state, /ts: m\.ts/);
  assert.doesNotMatch(state, /turnDurationMs/);
});

test('快捷导航不抢输入焦点；文件面板可收缩长名称、目录操作常显并动画展开', () => {
  const palette = read('../js/ui-command-palette.js');
  const open = palette.slice(palette.indexOf('function openPal()'), palette.indexOf('function closePal()'));
  assert.doesNotMatch(open, /palInput\.focus\(\)/);
  assert.match(open, /active\.blur\(\)/, '打开时不让后续按键误输入到主输入框');
  const css = read('../css/styles.css');
  assert.match(css, /grid-template-columns:\s*var\(--sbw, 268px\) minmax\(0, 1fr\) var\(--pnw, 310px\)/);
  assert.match(css, /\.fv-actions \.fv-modes[^}]*border-radius:\s*999px/);
  assert.match(css, /\.fv-actions \.fv-modes \{[^}]*height: 24px; min-height: 24px/);
  assert.match(css, /\.fv-actions \.fv-modes button[^}]*height:\s*18px; min-height: 0/);
  assert.match(css, /\.fv-modes-thumb[^}]*border-radius:\s*999px[^}]*transition: transform \.42s/);
  assert.match(css, /\.file-list \.ft-row \{ width: 100%; min-width: 0; \}/);
  assert.match(css, /\.ft-name[^}]*overflow: hidden; text-overflow: ellipsis/);
  assert.match(css, /\.ft-actions[^}]*justify-self: end; margin-left: 0/);
  assert.match(css, /\.ft-row\.ft-file \{[^}]*grid-template-columns: 12px 14px minmax\(0, 1fr\) auto/);
  assert.match(css, /\.ft-row\.ft-dir \{[^}]*grid-template-columns: 12px 14px minmax\(0, 1fr\) max-content;/, '目录行没有操作按钮列');
  assert.match(css, /\.ft-row:hover \.files-icon-btn, \.ft-row:focus-within \.files-icon-btn \{ opacity: 1; \}/);
  assert.doesNotMatch(css, /\.ft-row\.ft-dir \.files-icon-btn, \.ft-row\.ft-file \.ft-copy \{ opacity: 1; \}/, '复制/下载按钮只在悬浮时显示，不允许常显规则');
  assert.match(css, /#file-list \.ft-row\.ft-row-collapsing/);
  assert.match(css, /#file-list \.ft-row\.ft-row-expanding/);
  assert.match(css, /\.ft-dir-count/);
  assert.match(css, /^button \{[^}]*line-height: inherit;/m, '桌面按钮不依赖各操作系统的 UA 行高');
  assert.match(css, /\.mini-btn \{[^}]*min-height: 24px; line-height: 1\.35;/);
  assert.match(css, /\.icon-btn \{[^}]*min-width: 24px; min-height: 24px; line-height: 1;/);
  assert.match(css, /\.file-item, \.ft-row \{[^}]*min-height: 24px; padding: 3px 8px;[^}]*line-height: 1\.4;/, '桌面沙箱文件行具有稳定的最小高度与行高');
  assert.match(css, /@keyframes ft-row-collapse\s*\{[\s\S]*?to\s*\{[^}]*min-height: 0;/, '折叠动画同步压缩最小高度');
  assert.match(css, /@keyframes ft-row-expand\s*\{[\s\S]*?to\s*\{[^}]*min-height: 24px;/, '展开动画恢复桌面行高');
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

test('消息重绘遵循读者滚动状态；只有明确切换时才落底', () => {
  const ui = read('../js/ui.js');
  const scroll = read('../js/ui-message-scroll.js');
  const rb = ui.slice(ui.indexOf('function rebuildMessages'), ui.indexOf('function attachToolResult'));
  assert.match(rb, /captureMessageScroll\(\)/);
  assert.match(rb, /if \(scroll === 'bottom'\) jumpToBottom\(\);[\s\S]*restoreMessageScroll\(scrollSnapshot\)/);
  assert.doesNotMatch(rb, /^\s*jumpToBottom\(\);/m);
  assert.match(ui, /createMessageScrollManager/);
  assert.match(scroll, /followLatest = false/);
  assert.match(scroll, /msgList\.scrollTop = msgList\.scrollHeight;/);
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
  assert.equal((modes.match(/class="fv-mode-icon"/g) || []).length, 2, '代码和预览切换只显示图标');
  assert.match(modes, /aria-label="(?:预览|Preview)"/); assert.match(modes, /aria-label="(?:代码|Code)"/);
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
  const switcher = read('../js/ui-file-viewer.js');
  assert.match(switcher, /pop\.classList\.add\('is-closing'\)/, '筛选弹层关闭时应先播放收起过渡');
  const css = read('../css/styles.css');
  assert.match(css, /@keyframes fvQuickFilterExpand/);
  assert.match(css, /@keyframes fvQuickFilterCollapse/);
  assert.match(css, /@keyframes fvSwitcherOut/);
});

test('光标：1.2em 高、下沉 2px、左移 1px；桌面 2px 宽；减少动效只停换色不停闪烁', () => {
  assert.equal(CARET_EM, 1.2);
  assert.deepEqual(CARET_NUDGE, { x: -1, y: 2 });
  const css = read('../css/styles.css');
  // 3px 在桌面端显得过粗且整条偏右 1px；2px + 左移 1px 正好以插入点为中心
  assert.match(css, /\.rb-caret\{[^}]*width:2px;border-radius:1px;[^}]*\}/);
  assert.match(css, /@media \(pointer:fine\)\{\.rb-caret\{width:2px\}\}/);
  assert.doesNotMatch(css, /\.rb-caret\{[^}]*width:3px/);
  // 减少动效（系统设置或应用内开关）只保留 rb-blink 单动画：文本光标与原生一致照常闪烁，
  // 彩虹换色（rb-color）才是被停掉的装饰动效；不允许再出现整条 animation:none
  assert.match(css, /html\[data-motion="off"\] \.rb-caret\{animation:rb-blink 1\.1s steps\(1,end\) infinite\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\{html:not\(\[data-motion="on"\]\) \.rb-caret\{animation:rb-blink 1\.1s steps\(1,end\) infinite\}\}/);
  assert.doesNotMatch(css, /\.rb-caret\{animation:none\}/);
});

test('convert_file：三条通路计划、ffmpeg 参数、注册表/契约/挂载规则同步', async () => {
  const c = await import('../js/convert.js');
  assert.deepEqual(c.planConversion({ fromExt: 'svg', mime: 'image/svg+xml', to: 'png' }), { mode: 'canvas', outExt: 'png', outMime: 'image/png' });
  assert.equal(c.planConversion({ fromExt: 'mp3', mime: 'audio/mpeg', to: 'wav' }).mode, 'wav', '音频转 WAV 走 WebAudio，不碰 ffmpeg');
  assert.deepEqual(c.planConversion({ fromExt: 'mp4', mime: 'video/mp4', to: 'mp3' }), { mode: 'ffmpeg', outExt: 'mp3', outMime: 'audio/mpeg', audioOnly: true });
  assert.equal(c.planConversion({ fromExt: 'mov', mime: 'video/quicktime', to: 'gif' }).mode, 'ffmpeg');
  assert.equal(c.planConversion({ fromExt: 'mp4', mime: 'video/mp4', to: 'jpg' }).frame, true, '视频抽帧走 ffmpeg');
  assert.equal(c.planConversion({ fromExt: 'md', mime: 'text/markdown', to: 'png' }), null, '文本不是媒体，拒绝');
  assert.equal(c.planConversion({ fromExt: 'png', mime: 'image/png', to: 'svg' }), null, '不产出 SVG');
  const a1 = c.ffmpegArgs({ outExt: 'mp3', opts: { start: 5, duration: 3 }, audioOnly: true });
  assert.deepEqual(a1.slice(0, 8), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '5', '-i', 'in.bin']);
  assert.ok(a1.includes('-t') && a1.includes('-vn') && a1[a1.length - 1] === 'out.mp3');
  const a2 = c.ffmpegArgs({ outExt: 'webm', opts: { mute: true, width: 640 } });
  assert.ok(a2.includes('libvpx') && a2.includes('-an') && !a2.includes('-c:a'), '静音视频不再挂音频编码器');
  assert.ok(a2.some((x) => String(x).startsWith('scale=640')), '宽度进滤镜');
  const wav = c.encodeWav({ numberOfChannels: 1, sampleRate: 8000, length: 2, getChannelData: () => new Float32Array([0.5, -0.5]) });
  assert.equal(wav.length, 48);
  assert.equal(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]), 'RIFF');
  const { TOOL_DEFS } = await import('../js/tools.js');
  assert.ok(TOOL_DEFS.some((t) => t.name === 'convert_file' && /ffmpeg\.wasm/.test(t.description)));
  assert.equal(TOOL_DEFS.length, 42, '含新增的 tool_library 与 xlsx_tool');
  const caps = await import('../js/capabilities.js');
  assert.ok(caps.CAPABILITY_REGISTRY.convert_file, '能力登记');
  assert.ok(caps.TOOL_MOUNT_RULES.convert_file, '按需挂载规则（no-rule 会全量下发）');
  const ex = await import('../js/execution.js?v=2026.10.11.1');
  assert.equal(ex.TOOL_CONTRACTS.convert_file.sideEffect, 'filesystem');
  const mountSrc = read('../js/capabilities-mount.js');
  assert.match(mountSrc, /convert_file: \{ text: /);
});

test('convert.js：进度事件（含 0%）不终结任务；只有 ok/error 消息结算（真机踩过：首帧进度被当失败）', () => {
  const src = read('../js/convert.js');
  assert.match(src, /if \(m\.progress != null\) \{ p\.onProgress\?\.\(m\.progress\); return; \}/);
  assert.doesNotMatch(src, /if \(m\.progress\) \{/);
  const w = read('../js/worker-convert.js');
  assert.match(w, /ffmpeg-core\.wasm/);
  assert.match(w, /wasmBinary/);
  assert.match(w, /Invalid|magic word|head\[1\] === 0x61/, 'wasm 响应先验魔数，防代理把 HTML 页当二进制喂给实例化');
});

test('扫描文档附件菜单项在英文界面有标签和摄像头处理说明', () => {
  assert.equal(translateUI('扫描文档', 'en'), 'Scan document');
  assert.equal(
    translateUI('摄像头扫描文档：自动找边、透视矫正、黑白增强', 'en'),
    'Scan a document with your camera: automatic edge detection, perspective correction and black-and-white enhancement.',
  );
});

test('文档扫描：算法核（合成纸面检出四角）、PDF 结构、入口按钮只随真实相机出现', async () => {
  const m = await import('../js/doc-scanner.js');
  const w = 200; const h = 200; const data = new Uint8ClampedArray(w * h * 4);
  const quad = [{ x: 40, y: 30 }, { x: 170, y: 45 }, { x: 160, y: 170 }, { x: 30, y: 155 }];
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const xi = quad[i].x; const yi = quad[i].y; const xj = quad[j].x; const yj = quad[j].y;
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) c = !c;
    }
    return c;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4; const v = inside(x, y) ? 235 : 40;
    data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
  }
  const det = m.detectDocCorners({ width: w, height: h, data });
  assert.ok(det, '检出四边形');
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(det[i].x - quad[i].x) <= 2 && Math.abs(det[i].y - quad[i].y) <= 2, `角点 ${i} 偏差过大`);
  }
  assert.equal(m.detectDocCorners({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(200) }), null, '低对比（纯色）不乱猜');

  // 强阴影、纹理背景与文字遮挡下仍取纸面凸包四角；黑纸白底也支持反极性检测。
  const scene = (sw, sh, corners, valueAt) => {
    const pixels = new Uint8ClampedArray(sw * sh * 4);
    const inPoly = (x, y) => {
      let c = false;
      for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
        const a = corners[i], b = corners[j];
        if (((a.y > y) !== (b.y > y)) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const p = (y * sw + x) * 4, value = valueAt(x, y, inPoly(x, y));
      pixels[p] = pixels[p + 1] = pixels[p + 2] = value; pixels[p + 3] = 255;
    }
    return { width: sw, height: sh, data: pixels };
  };
  const skew = [{ x: 45, y: 28 }, { x: 275, y: 45 }, { x: 260, y: 212 }, { x: 27, y: 193 }];
  const shadowedPage = scene(320, 240, skew, (x, y, paper) => {
    if (!paper) return 35 + ((x * 17 + y * 11) % 24);
    if (x > 78 && x < 245 && y > 70 && y < 185 && y % 19 < 4) return 25;
    return 238 - x * 0.22 - y * 0.05 + ((x * 3 + y * 5) % 5);
  });
  const robust = m.detectDocCorners(shadowedPage);
  assert.ok(robust, '阴影与文字覆盖时仍检测到纸面');
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(robust[i].x - skew[i].x) <= 3 && Math.abs(robust[i].y - skew[i].y) <= 3, `阴影角点 ${i} 偏差过大：${JSON.stringify(robust[i])}`);
  const darkPage = scene(320, 240, skew, (x, y, paper) => paper ? 35 + ((x + y) % 12) : 225 - ((x * 2 + y * 3) % 14));
  const darkDetected = m.detectDocCorners(darkPage);
  assert.ok(darkDetected, '深色纸面 / 浅色背景反极性检测');
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(darkDetected[i].x - skew[i].x) <= 3 && Math.abs(darkDetected[i].y - skew[i].y) <= 3, `深色页角点 ${i} 偏差过大`);
  const gradientOnly = scene(320, 240, [], (x) => 25 + Math.round(210 * x / 319));
  assert.equal(m.detectDocCorners(gradientOnly), null, '纯渐变背景不当作文档');

  // 二值阈值按局部光照适配，浅色抗锯齿文字在强阴影两端都保持为黑。
  const monoW = 240, monoH = 64, monoData = new Uint8ClampedArray(monoW * monoH * 4);
  for (let y = 0; y < monoH; y++) for (let x = 0; x < monoW; x++) {
    const background = 238 - Math.round(0.42 * x);
    const ink = y >= 26 && y <= 29 && x >= 18 && x <= 222;
    const value = ink ? background - 28 : background;
    const p = (y * monoW + x) * 4;
    monoData[p] = monoData[p + 1] = monoData[p + 2] = value; monoData[p + 3] = 255;
  }
  const mono = m.applyScanFilter({ width: monoW, height: monoH, data: monoData }, 'mono');
  for (const x of [40, 100, 160, 215]) {
    assert.equal(mono.data[(27 * monoW + x) * 4], 0, `阴影位置 x=${x} 的浅色字迹应清晰变黑`);
    assert.equal(mono.data[(12 * monoW + x) * 4], 255, `纸面背景 x=${x} 应保持白色`);
  }
  const H = m.computeHomography(det, 200, 200);
  assert.ok(H && H.length === 9);
  const warp = m.warpImageData({ width: w, height: h, data }, H, 120, 120);
  assert.ok(warp.data[(60 * 120 + 60) * 4] > 200, '矫正后中心是纸面');
  assert.equal(m.applyScanFilter(warp, 'mono').data[(60 * 120 + 60) * 4] % 255, 0, '黑白滤镜输出纯色');
  const fakeJpeg = new Uint8Array([255, 216, 255, 225, 1, 2, 3, 255, 217]);
  const pdf = Buffer.from(m.jpegPagesToPdf([{ bytes: fakeJpeg, width: 100, height: 80 }, { bytes: fakeJpeg, width: 100, height: 80 }]));
  const str = pdf.toString('latin1');
  assert.match(str, /^%PDF-1\.4/);
  assert.match(str, /\/Count 2/);
  assert.ok(str.trimEnd().endsWith('%%EOF'));
  const xrefAt = Number(/startxref\n(\d+)/.exec(str)[1]);
  assert.equal(str.slice(xrefAt, xrefAt + 4), 'xref');
  for (const mo of str.slice(xrefAt).matchAll(/^(\d{10}) 00000 n /gm)) {
    assert.match(str.slice(Number(mo[1]), Number(mo[1]) + 12), /^\d+ 0 obj/, 'xref 偏移必须指向对象行');
  }
  // 入口与门控
  const html = read('../app.html');
  assert.match(html, /id="scan-btn"[^>]*hidden/);
  assert.match(html, /扫描文档/);
  const dev = read('../js/ui-devices.js');
  assert.match(dev, /scan\.hidden = !\(allowed\('camera'\) && state\.camera === true\)/);
  const att = read('../js/ui-attachments.js');
  assert.match(att, /import\('\.\/ui-scanner\.js'\)/);
  assert.match(att, /addFiles\(files\)/);
  const ui = read('../js/ui-scanner.js');
  assert.match(ui, /仅本地处理/);
  assert.doesNotMatch(ui, /fetch\(|XMLHttpRequest/); // 相机画面绝不外发
  assert.match(ui, /主画布显示完整原图/, '四角控件必须与完整源图保持同一坐标系');
  assert.match(ui, /校正预览/, '扫描页保留透视矫正后的结果预览');
  const geometry = await import('../js/ui-scanner.js');
  assert.equal(geometry.SCANNER_HANDLE_HIT_RADIUS, 46);
  assert.equal(geometry.nearestScannerHandle({ x: 45, y: 0 }, [{ x: 0, y: 0 }]), 0, '扩大的触控热区覆盖 45 CSS px');
  assert.equal(geometry.nearestScannerHandle({ x: 47, y: 0 }, [{ x: 0, y: 0 }]), -1, '热区有明确边界');
  const metrics = geometry.scannerDisplayMetrics(
    { left: 130, top: 90, width: 800, height: 450 },
    { left: 110, top: 70, width: 840, height: 490 },
    1600, 900,
  );
  const bottomRight = geometry.scannerImageToOverlay({ x: 1600, y: 900 }, metrics);
  assert.deepEqual(bottomRight, { x: 820, y: 470 }, '源图四角映射到显示画布范围内，而非裁剪结果之外');
  assert.deepEqual(geometry.scannerOverlayToImage(bottomRight, metrics), { x: 1600, y: 900 }, '拖动坐标反算回全分辨率源图');
});

test('2026.10.21：「自动路由」徽标改为「自动」、设置网关栏目补英文翻译、演示跟随语言清空重播', () => {
  // 1. 路由徽标只显示「自动」；旧文案全仓绝迹
  const picker = read('../js/ui-model-picker.js');
  assert.match(picker, /localeText\('自动', 'Auto'\)/);
  assert.equal(picker.includes('自动路由'), false);
  assert.equal(read('../js/ui-strings.js').includes('自动路由'), false);
  assert.equal(translateUI('自动', 'en'), 'Auto');

  // 2. 设置页网关栏目（含 Key 弹窗与校验文案）都有英文翻译
  for (const zh of [
    '模型网关', '切换后使用该网关独立的 Key 与模型目录', 'TeamoRouter（第三方）', 'Claude / Anthropic（官方）',
    '自定义 OpenAI 兼容网关', '按网关独立保存；仅本机存储，直连所选服务', '网关基础 URL（可选）',
    '留空使用官方默认；自定义网关必填 HTTPS URL', '例如 model-id', '添加', '已添加的自定义模型 ID',
    '仅 TeamoRouter 后端中继；官方网关不走此中继', '同源中继可用（本地 server.py / Pages Functions）',
    'Key 长度过短，请检查是否复制完整', '仅允许 HTTPS 网关地址', '在 TeamoRouter 控制台创建',
    '管理员别名只适用于 TeamoRouter', '智谱 API Key', '自定义网关 API Key',
    'API Key 仅保存在本机浏览器，随请求头直发所选网关。',
  ]) {
    assert.notEqual(translateUI(zh, 'en'), zh, `网关栏目缺英文翻译：${zh}`);
  }
  assert.equal(translateUI('已添加模型 ID：my-model', 'en'), 'Added model ID: my-model');
  assert.equal(translateUI('已移除模型 ID：my-model', 'en'), 'Removed model ID: my-model');
  assert.equal(translateUI('Kimi / Moonshot AI 官方文档', 'en'), 'Kimi / Moonshot AI official docs');

  // 3. 演示脚本 zh/en 两份，切语言（同文档 onLanguageChange / iframe storage 事件）都会清空重播
  const demo = read('../js/home-demo.js');
  assert.match(demo, /DEMO_SCRIPTS = \{/);
  assert.match(demo, /zh: \{/); assert.match(demo, /en: \{/);
  assert.match(demo, /const onLangSwitch = \(\) => \{ syncChrome\(\); if \(started\) play\(\); \};/);
  assert.match(demo, /onLanguageChange\(onLangSwitch\)/);
  assert.match(demo, /e\.key === LANGUAGE_KEY/);
});

test('2026.10.21：knowledge_search 独立消息块（toolflow 家族 / UI 接线 / 抛光 CSS）', async () => {
  const { toolFamily, displayParts, commandRunFor } = await import('../js/toolflow.js');
  assert.equal(toolFamily({ name: 'knowledge_search' }), 'knowledge');
  assert.equal(toolFamily({ name: 'read_file' }), 'explored');
  assert.equal(toolFamily({ name: 'list_files' }), 'commands');
  // 检索与命令分成不同的显示段；检索段是命令合并的屏障（partIndex 0 不属于任何命令 run）
  const msg = { id: 'a', role: 'assistant', toolCalls: [
    { id: 'k1', name: 'knowledge_search' }, { id: 'c1', name: 'list_files' }, { id: 'c2', name: 'copy_file' },
  ] };
  assert.deepEqual(displayParts(msg).map((p) => p.kind), ['knowledge', 'commands']);
  const turn = [{ id: 'u', role: 'user', text: 'x' }, msg];
  assert.equal(commandRunFor(turn, 'a', 0), null, '检索段不参与命令合并');
  assert.equal(commandRunFor(turn, 'a', 1)?.isHost, true, '命令段照常合并成 Ran commands');
  // UI 接线：命令菜单排除 + 独立折叠行 + 英文进行时/过去时标签
  const ui = read('../js/ui.js');
  assert.match(ui, /FILE_FOLD_TOOLS = new Set\(\[[^\]]*'knowledge_search'/);
  assert.match(ui, /paintKnowledgeFold\(wrap, m, chips, \{ msgsAll, msgNodes, syncFileFold, syncAssistantShell, decodeRawJsonString \}\)/);
  assert.match(ui, /const hasSearched = !!\$\('\.searched-library', w\);/);
  assert.match(ui, /!hasEdited && !hasSearched && !hasFoot/, '知识检索独立回合不能被空消息壳规则隐藏');
  const toolflowUi = read('../js/ui-toolflow.js');
  assert.match(toolflowUi, /export function paintKnowledgeFold/);
  assert.match(toolflowUi, /'Searching library'/);
  assert.match(toolflowUi, /'Searched library'/);
  assert.match(toolflowUi, /searched-library-query/);
  // 抛光扫光与「不可展开」的光标约定
  const css = read('../css/styles.css');
  assert.match(css, /\.searched-library\)\.is-working > \.chip-name/);
  assert.match(css, /\.searched-library \{ cursor: default; \}/);
  assert.match(css, /\.searched-library-query \{ flex: 1 1 14rem;/);
  assert.match(read('../js/icons.js'), /search: ico\(/);
});

test('2026.10.22：快捷图表静态显示、赞踩无灰底、对话米白与输入框白色及编辑器优化', () => {
  const css = read('../css/styles.css');
  const lightbox = read('../js/ui-lightbox.js');
  assert.match(lightbox, /staticChart: !!expandChart\.closest\('\.md-chart'\)/);
  assert.match(lightbox, /opts\.staticChart && clone\.matches\?\.\('\.md-chart-svg'\)/);
  assert.match(lightbox, /md-chart-static-view/);
  assert.match(css, /\.md-chart-svg\.md-chart-static-view, \.md-chart-svg\.md-chart-static-view \* \{ animation: none !important; transition: none !important; \}/);
  assert.match(css, /\.md-chart-svg\.md-chart-static-view \[data-chart-label\] \{ pointer-events: none !important; cursor: default !important; \}/);
  assert.match(css, /\.feedback-btn\[aria-pressed="true"\]\{background:transparent;border-color:transparent;box-shadow:none\}/);
  assert.match(css, /\.feedback-btn:hover\{translate:0 -1px;background:transparent;border-color:transparent\}/);
  assert.doesNotMatch(css, /\.feedback-btn\[aria-pressed="true"\]\{[^}]*background:var\(--bg-hover\)/);
  assert.match(css, /--conversation-bg: #fcfaf6/);
  assert.match(css, /\[data-theme="dark"\] \{[^}]*--conversation-bg: var\(--bg\)/s);
  assert.match(css, /\.main \{[^}]*background: var\(--conversation-bg, var\(--bg\)\)/);
  assert.match(css, /\.sidebar \{[^}]*background: var\(--conversation-bg, var\(--bg\)\)/);
  assert.match(css, /\.panel \{[^}]*background: var\(--conversation-bg, var\(--bg\)\)/);
  assert.match(css, /:root\s*\{[^}]*--bg:\s*#ffffff/s, '浅色主题的 --bg 是白色');
  assert.match(css, /\.composer \{[^}]*background: var\(--bg\)/, '输入容器使用白色主题底色');
  assert.match(css, /#composer-input \{[^}]*background: none/);
  assert.match(css, /\.photo-editor \{[^}]*height:\s*min\(96dvh, 900px\)/, '照片编辑器给工作区分配更充足的视口高度');
  assert.match(css, /\.scan-bar \{[^}]*grid-template-areas:\s*"filters actions session"/s, '扫描底栏把拍摄操作置于中央主位');
  assert.match(css, /\.reasoning\.expanded > \.chip-detail::before[\s\S]*?background: var\(--line-2\)/, '展开思考过程时显示纵向层级线');
  const scannerUi = read('../js/ui-scanner.js');
  assert.match(scannerUi, /data-r="reshoot"[\s\S]*?data-r="shoot"[\s\S]*?data-r="toggle-preview"/, '拍摄主按钮位于辅助操作之前');
});

test('导航、对话与文档页统一品牌图标规格；首页不加版本徽章，字标保持细字重', () => {
  const home = read('../index.html'), app = read('../app.html'), docs = read('../docs.html');
  const logoSvg = (html) => html.match(/<(?:span|a) class="logo-mark"[^>]*><svg[^>]*>([\s\S]*?)<\/svg>/)?.[1] || '';
  assert.ok(logoSvg(home) && logoSvg(app) && logoSvg(docs), '三页都应包含同一产品图标');
  assert.equal(logoSvg(home), logoSvg(app));
  assert.equal(logoSvg(app), logoSvg(docs));
  assert.doesNotMatch(home, /class="(?:ver-badge|ver)"/, '导航页不挂版本徽章');
  assert.match(read('../css/home.css'), /\.nav \.logo-text \{[^}]*font-weight:\s*500;/);
  assert.match(read('../css/styles.css'), /\.ver-badge\s*\{[^}]*border-radius:\s*999px;/);
  assert.match(docs, /\.ver-badge\s*\{[^}]*border-radius:\s*999px;/);
  for (const css of [read('../css/home.css'), read('../css/styles.css'), docs]) {
    assert.match(css, /\.logo-mark svg \{ width: 21px; height: 21px; display: block; \}/);
  }
});

test('文档页部署清单链接为清晰的主题化圆角按钮，具备 hover 与键盘焦点反馈', () => {
  const docs = read('../docs.html');
  assert.match(docs, /<a class="build-manifest-link" href="\.\/build\.json">部署清单 ↗<\/a>/);
  assert.match(docs, /\.build-manifest-link\{[^}]*border-radius:999px[^}]*text-decoration:none/);
  assert.match(docs, /\.build-manifest-link:hover\{/);
  assert.match(docs, /\.build-manifest-link:focus-visible\{/);
});

test('思考强度菜单左侧带浅灰细线，不影响各档位按钮布局', () => {
  const css = read('../css/styles.css');
  assert.match(css, /\.think-menu \{ padding: 6px; border-left: 1px solid color-mix\(in srgb, var\(--fg\) 18%, var\(--bg\)\); \}/);
  assert.match(read('../app.html'), /id="think-menu" class="dd-menu think-menu"/);
});

test('管理员 API Key 弹窗仅对 TeamoRouter 管理员别名显示暗号输入；暗号不以明文写入源码', () => {
  const app = read('../app.html'), ui = read('../js/ui.js'), admin = read('../js/adminkey.js');
  assert.match(app, /id="key-admin-phrase-wrap" class="key-admin-phrase-wrap" hidden/);
  assert.match(app, /id="key-admin-phrase"[^>]*type="text"[^>]*inputmode="text"/);
  assert.doesNotMatch(app.match(/<input id="key-admin-phrase"[^>]*>/)?.[0] || '', /type="password"/, 'Chinese admin phrases must allow normal IME text composition');
  assert.match(ui, /isAdminAlias\(keyInput\.value\.trim\(\)\).*DEFAULT_GATEWAY_ID/);
  assert.match(ui, /unlockAdminKey\(typed, \{ phrase \}\)/);
  assert.equal(translateUI('管理员暗号', 'en'), 'Admin phrase');
  assert.match(admin, /ADMIN_PASSWORD_BODY = 10/);
  assert.match(admin, /reason: 'bad-phrase'/);
  const phrase = String.fromCodePoint(0x5929, 0x67a2, 0x667a, 0x6838, 0xff0c, 0x70b9, 0x4eae, 0x672a, 0x6765);
  assert.equal(admin.includes(phrase), false, '管理员暗号只保存为派生值');
});
