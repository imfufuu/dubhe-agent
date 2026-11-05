import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { REASONING_LEVELS, reasoningControlFor, reasoningStrategy, withReasoningStrategy } from '../js/reasoning.js';
import { thinkingParamsFor } from '../js/config.js';
import { streamChat, __resetThinkingFallbackForTests, thinkingDisabledFor, effortDisabledFor, buildOpenAIMessages } from '../js/api.js';
import { syncMessageRhythm } from '../js/ui-message-rhythm.js';
import { demoCharacterDelay } from '../js/home-demo.js';
import { isGptModel, reasoningSummaryItems } from '../js/reasoning-summary.js';

const levels = REASONING_LEVELS;

test('reasoning UI parses GPT summary markers only and shows complete non-GPT reasoning', () => {
  const raw = '**Plan****Check constraints**';
  assert.equal(isGptModel('gpt-5.6-sol'), true);
  assert.equal(isGptModel('openai/gpt-5.6'), true);
  assert.equal(isGptModel('claude-sonnet-5'), false);
  assert.equal(isGptModel('gemini-3.8-flash'), false);
  assert.deepEqual(reasoningSummaryItems(raw, 'gpt-5.6'), ['Plan', 'Check constraints']);
  assert.deepEqual(reasoningSummaryItems('Full reasoning text without markers', 'gpt-5.6'), []);
  assert.deepEqual(reasoningSummaryItems(raw, 'claude-sonnet-5'), [], 'non-GPT reasoning must not be parsed as GPT summaries');
  assert.deepEqual(reasoningSummaryItems(raw, 'gemini-3.8-flash'), []);
  assert.deepEqual(reasoningSummaryItems('**same****same****last**', 'gpt-5.6'), ['same', 'same', 'last'], '每个 marker pair 都独立显示，保留重复项与原顺序');
  const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(ui, /reasoningSummaryItems\(m\.reasoning, reasoningModel\)/);
  assert.match(ui, /isGptModel\(reasoningModel\)/);
  assert.match(ui, /think-full-text/);
  assert.match(ui, /paintReasoningBlocks\(full, renderMarkdown\(reasoningMarkdownSource\(m\.reasoning\)\), \{ animate: thinkRunning \}\)/, '非 GPT 思考全文走 Markdown 渲染，并与正文同一浮现机制');
  assert.match(ui, /paintReasoningBlocks\(list, items\.map/, 'GPT 摘要条目同样复用浮现机制');
  assert.doesNotMatch(ui, /renderReasoningLines/);
  assert.match(css, /\.reasoning \.think-full-text/);
  assert.match(css, /\.reasoning\.expanded > \.chip-detail/);
  assert.match(css, /\.reasoning\.live\s*>\s*\.chip-detail/);
  assert.match(ui, /reason\.classList\.toggle\('live', thinkLive && expanded\)/, 'live 展示状态由用户展开态决定，手动收起优先');
});
test('DeepSeek v4 uses native low/high/max, never fictitious output/reasoning budgets', () => {
  assert.deepEqual(levels.map(l => thinkingParamsFor('deepseek-v4-pro',l).reasoning_effort), ['low','low','high','high','max','max']);
  for (const l of levels) {
    const p=thinkingParamsFor('deepseek-flash',l); assert.equal(p.thinking.type,'enabled');
    assert.equal(p.budget_tokens,undefined); assert.equal(p.max_tokens,undefined); assert.equal(p.thinking.budget_tokens,undefined);
  }
});
test('GLM 5.3 permits only low/high/max; 5.2 avoids a low request that drops thinking', () => {
  assert.deepEqual(levels.map(l=>thinkingParamsFor('glm-5.3-flash',l).reasoning_effort),['low','low','high','high','max','max']);
  assert.deepEqual(levels.map(l=>thinkingParamsFor('glm-5.2',l).reasoning_effort),['high','high','high','high','max','max']);
  assert.equal(reasoningControlFor('glm-5.3','mini').alwaysThinking,true);
});
test('legacy toggles and unknown providers get distinct soft effort, not invented params', () => {
  assert.deepEqual(thinkingParamsFor('glm-4.7','ultra'),{thinking:{type:'enabled'}});
  assert.deepEqual(thinkingParamsFor('deepseek-reasoner','mini'),{reasoning:true});
  assert.deepEqual(thinkingParamsFor('gpt-4o','high'),{});
  assert.deepEqual(thinkingParamsFor('custom-model','ultra'),{});
  assert.equal(new Set(levels.map(reasoningStrategy)).size,6);
  for (const l of levels) assert.match(reasoningStrategy(l),/not a fixed token budget|Keep private reasoning private/);
});
test('existing supported providers preserve native control; o-series gets valid ranges', () => {
  assert.equal(thinkingParamsFor('claude-sonnet-5','ultra').thinking.budget_tokens,32768);
  assert.equal(thinkingParamsFor('gpt-5.6-sol','ultra').reasoning_effort,'xhigh');
  assert.equal(thinkingParamsFor('gemini-3.8-flash','ultra').reasoning_effort,'high');
  assert.equal(thinkingParamsFor('grok-4.6','mini').reasoning_effort,'low');
  assert.equal(thinkingParamsFor('o3','mini').reasoning_effort,'low');
  assert.equal(thinkingParamsFor('o3','ultra').reasoning_effort,'high');
});
test('policies are request-local, Off adds nothing and caller history never mutates', () => {
  const m=[{role:'system',text:'original'},{role:'user',text:'hello'}], before=JSON.stringify(m);
  assert.equal(withReasoningStrategy(m,{thinking:false}),m);
  for(const l of levels) {
    const p=withReasoningStrategy(m,{thinking:true,level:l});assert.equal(p.length,2);assert.match(p[0].text,/Dubhe effort:/);
  }
  assert.equal(JSON.stringify(m),before);
});
test('reasoning_content is replayed only for explicitly opted-in native chat routes', () => {
  const m=[{role:'assistant',text:'checking',reasoning:'saved reasoning',toolCalls:[{id:'t',name:'read_file',args:{path:'a'}}]}];
  assert.equal(buildOpenAIMessages(m)[0].reasoning_content,undefined);
  assert.equal(buildOpenAIMessages(m,{includeReasoning:true})[0].reasoning_content,'saved reasoning');
});
const ok = () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
async function requestTest(responses, fn) {
  const original=globalThis.fetch, calls=[]; __resetThinkingFallbackForTests();
  globalThis.fetch=async (url,opts)=>{calls.push(JSON.parse(opts.body));const r=responses.shift();return r?r():ok();};
  try { await fn(calls); } finally {globalThis.fetch=original;__resetThinkingFallbackForTests();}
}
const send=(extra={})=>streamChat({model:'glm-5.3',apiKey:'test-only',messages:[{role:'system',text:'identity'},{role:'user',text:'test'}],thinking:true,reasoningLevel:'ultra',onEvent(){},firstTokenTimeoutMs:0,...extra});
test('TeamoRouter MiniMax-M3 splits reasoning from content and honors the thinking toggle', async () => {
  await requestTest([], async (calls) => {
    await send({ model: 'MiniMax-M3', thinking: true, reasoningLevel: 'high' });
    await send({ model: 'MiniMax-M3', thinking: false });
    assert.equal(calls[0].model, 'MiniMax-M3');
    assert.equal(calls[0].reasoning_split, true);
    assert.deepEqual(calls[0].thinking, { type: 'adaptive' });
    assert.equal(calls[0].reasoning_effort, undefined);
    assert.equal(calls[1].reasoning_split, true);
    assert.deepEqual(calls[1].thinking, { type: 'disabled' });
  });
});
test('TeamoRouter MiniMax-M3.1-Flash keeps reasoning split and never sends an invalid disabled flag', async () => {
  await requestTest([], async (calls) => {
    await send({ model: 'MiniMax-M3.1-Flash', thinking: true, reasoningLevel: 'high' });
    await send({ model: 'MiniMax-M3.1-Flash', thinking: false });
    assert.equal(calls[0].reasoning_split, true);
    assert.deepEqual(calls[0].thinking, { type: 'adaptive' });
    assert.equal(calls[0].reasoning_effort, 'high');
    assert.equal(calls[1].reasoning_split, true);
    assert.equal(calls[1].thinking, undefined);
    assert.equal(calls[1].reasoning_effort, undefined);
  });
});
test('wire request includes native effort plus exactly one tier policy; no output cap', async()=>{
  await requestTest([],async calls=>{
    await send(); assert.equal(calls[0].reasoning_effort,'max');assert.equal(calls[0].thinking.type,'enabled');
    assert.equal(calls[0].max_tokens,undefined);assert.equal(calls[0].messages.filter(m=>m.content.includes('[Dubhe effort:')).length,1);
    await send({thinking:false});assert.equal(calls[1].reasoning_effort,undefined);assert.equal(calls[1].thinking,undefined);
    assert.equal(calls[1].messages.some(m=>m.content.includes('[Dubhe effort:')),false);
  });
});
test('effort-specific 400 drops only effort, retains thinking and caches the downgrade', async()=>{
  await requestTest([()=>new Response('Unsupported reasoning_effort',{status:400})],async calls=>{
    const notices=[];await send({onThinkingFallback:(m,d)=>notices.push(d.kind)});
    assert.equal(calls.length,2);assert.equal(calls[1].reasoning_effort,undefined);assert.equal(calls[1].thinking.type,'enabled');
    assert.ok(effortDisabledFor('glm-5.3'));assert.equal(thinkingDisabledFor('glm-5.3'),false);assert.deepEqual(notices,['effort']);
    await send();assert.equal(calls[2].reasoning_effort,undefined);assert.equal(calls[2].thinking.type,'enabled');
    assert.equal(calls[2].messages.filter(m=>m.content.includes('[Dubhe effort:')).length,1);
  });
});
test('full thinking rejection still preserves soft tier distinctions on retry',async()=>{
  await requestTest([()=>new Response('thinking is not supported',{status:400})],async calls=>{
    await send();assert.equal(calls[1].thinking,undefined);assert.equal(calls[1].reasoning_effort,undefined);
    assert.ok(calls[1].messages.some(m=>m.content.includes('[Dubhe effort: Ultra]')));assert.ok(thinkingDisabledFor('glm-5.3'));
  });
});
test('message rhythm crosses hidden merge shells but never a user turn or body paragraph',()=>{
  const dom=new JSDOM('<div id="root"><div class="msg msg-assistant" id="a"><div class="tool-chips"><div>command</div></div></div><div class="msg msg-assistant msg-collapsed"></div><div class="msg msg-assistant" id="b"><div class="assistant-flow"><div class="assistant-fragment"><div class="edited-files">file</div></div></div></div><div class="msg msg-user">user</div><div class="msg msg-assistant"><div class="explored-files">read</div></div></div>');
  const root=dom.window.document.querySelector('#root');syncMessageRhythm(root);
  assert.ok(root.querySelector('#a').classList.contains('tools-continue'));assert.equal(root.querySelector('#b').classList.contains('tools-continue'),false);
  root.querySelector('#b').innerHTML='<div class="md-body">answer</div>';syncMessageRhythm(root);
  assert.equal(root.querySelector('#a').classList.contains('tools-continue'),false);
});
test('demo text is moderately faster and the longer pauses remain in tools',()=>{
  assert.ok(demoCharacterDelay('中',0,true)<65);assert.ok(demoCharacterDelay('中',0)<52);
  assert.ok(demoCharacterDelay('。',0)>demoCharacterDelay('中',0));
  const source=fs.readFileSync(new URL('../js/home-demo.js',import.meta.url),'utf8');assert.match(source,/await wait\(1600\)/);assert.match(source,/durationMs \/ lines.length/);
});

test('large stream deltas are paced, preserve Unicode and event order, and drain within a bounded backlog', async () => {
  const { createStreamSmoother } = await import('../js/stream-smoothing.js');
  let clock = 0, id = 0; const timers = new Map(), events = [];
  const smoother = createStreamSmoother(e => events.push(e), {
    now: () => clock, intervalMs: 40, maxDelayMs: 4000,
    schedule: fn => { const k = ++id; timers.set(k, fn); return k; },
    unschedule: k => timers.delete(k),
  });
  smoother.push({ type: 'text', text: 'small' });
  assert.equal(events[0].text, 'small', 'normal streaming is immediate');
  const text = '👩猫markdown `*`'.repeat(1500);
  smoother.push({ type: 'text', text });
  smoother.push({ type: 'tool_delta', index: 0 });
  smoother.push({ type: 'text', text: 'after tool' });
  const finished = smoother.finish();
  assert.ok(events.length > 1 && events.length < 4, 'large burst only partly visible initially');
  for (let ticks = 0; timers.size && ticks < 102; ticks++) {
    clock += 40; const [key, fn] = timers.entries().next().value; timers.delete(key); fn();
  }
  await finished;
  const tool = events.findIndex(e => e.type === 'tool_delta');
  assert.equal(events.slice(1, tool).map(e => e.text).join(''), text);
  assert.equal(events.slice(tool + 1).map(e => e.text).join(''), 'after tool');
  assert.ok(clock <= 4040, `backlog must not drag indefinitely: ${clock}`);
  for (const ev of events.filter(e => e.type === 'text')) assert.doesNotMatch(ev.text, /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
  smoother.dispose();
});

test('smoother cancellation prevents late callbacks; flush preserves received text on errors', async () => {
  const { createStreamSmoother } = await import('../js/stream-smoothing.js');
  const ctrl = new AbortController(), seen = [];
  const smooth = createStreamSmoother(e => seen.push(e.text), { signal: ctrl.signal });
  smooth.push({ type: 'text', text: 'x'.repeat(300) });
  const finished = smooth.finish();
  ctrl.abort();
  await assert.rejects(finished, { name: 'AbortError' });
  const count = seen.length;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(seen.length, count);
  smooth.dispose();
  const saved = [], second = createStreamSmoother(e => saved.push(e));
  second.push({ type: 'text', text: 'y'.repeat(300) });
  second.push({ type: 'finish', reason: 'stop' });
  second.flush();
  assert.equal(saved.filter(e => e.type === 'text').map(e => e.text).join(''), 'y'.repeat(300));
  assert.equal(saved.at(-1).type, 'finish');
  second.dispose();
});

test('gateway SSE burst drains gradually before tool and finish events', async () => {
  const original = globalThis.fetch, events = [];
  const payload = '汉🙂'.repeat(45);
  const frame = value => `data: ${JSON.stringify(value)}\n\n`;
  globalThis.fetch = async () => new Response(
    frame({ choices: [{ delta: { content: payload } }] }) +
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'foo', arguments: '{}' } }] } }] }) +
    frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    await streamChat({ model: 'gpt-5.6-sol', apiKey: 'test', messages: [{ role: 'user', text: 'test' }], smoothText: true, onEvent: e => events.push(e) });
    const toolIndex = events.findIndex(e => e.type === 'tool_delta');
    assert.ok(events.filter(e => e.type === 'text').length > 1);
    assert.equal(events.slice(0, toolIndex).filter(e => e.type === 'text').map(e => e.text).join(''), payload);
    assert.ok(events.findIndex(e => e.type === 'finish') > toolIndex);
  } finally { globalThis.fetch = original; }
});
