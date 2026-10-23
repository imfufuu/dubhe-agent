import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { REASONING_LEVELS, reasoningControlFor, reasoningStrategy, withReasoningStrategy } from '../js/reasoning.js';
import { thinkingParamsFor } from '../js/config.js';
import { streamChat, __resetThinkingFallbackForTests, thinkingDisabledFor, effortDisabledFor, buildOpenAIMessages } from '../js/api.js';
import { syncMessageRhythm } from '../js/ui-message-rhythm.js';
import { demoCharacterDelay } from '../js/home-demo.js';
import { reasoningSummaryItems } from '../js/reasoning-summary.js';

const levels = REASONING_LEVELS;

test('reasoning UI emits progress-only labels, never raw chained bold reasoning', () => {
  const raw = '**示例：规划任务一****示例：规划任务二**';
  const short = reasoningSummaryItems(raw);
  assert.ok(short.length <= 3);
  assert.ok(short.every((item) => !item.includes('规划任务')));
  const longer = reasoningSummaryItems(`${raw}${'分析'.repeat(250)}`);
  assert.ok(longer.length >= short.length);
  assert.match(longer.at(-1), /组织清晰|organizing/i);
  const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(ui, /reasoningSummaryItems\(m\.reasoning\)/);
  assert.doesNotMatch(ui, /renderMarkdown\(m\.reasoning\)|think-stream/);
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
