import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{extractChoices}from'../js/choices.js';import{renderMarkdown}from'../js/ui-markdown.js';
import{deviceKinds}from'../js/ui-devices.js';import{effectiveModeration,MODERATION_ACK_VERSION}from'../js/ui-moderation-setting.js';
import{publicTaskPlan,publicPlanMarkdown}from'../js/publicplan.js';import{caretColorAt,CARET_COLORS,CARET_HOLD_MS,CARET_CYCLE_MS}from'../js/ui-caret.js';
import{systemPrompt,referenceSystemPrompt}from'../js/config.js';import{searchKnowledge,KNOWLEDGE_MAX_CHARS}from'../js/knowledge.js';
const kb=JSON.parse(fs.readFileSync(new URL('../assets/knowledge/index.json',import.meta.url)));
await test('refinement core contracts',async t=>{
 await t.test('the reported inline-closing choice renders all three actual options',()=>{const s=':::choice 需要我接着做什么？\n\n- 出一份「31秒重排节奏」分镜表\n- 查Remix BGM的版权\n- 处理水印/字幕 :::';const html=renderMarkdown(s);assert.equal((html.match(/data-choice-send=/g)||[]).length,3);assert.ok(!html.includes(':::</li>'));});
 await t.test('summary start/middle/end placement preserves exact prose order',()=>{const s='Before\n:::choice A\n- a\n- b\n:::\nBetween\n:::choice B\n* c\n* d\n:::\nAfter';const h=renderMarkdown(s);assert.equal((h.match(/class="choice-box/g)||[]).length,2);assert.ok(h.indexOf('Before')<h.indexOf('choice-box'));assert.ok(h.indexOf('Between')>h.indexOf('choice-box'));assert.ok(h.lastIndexOf('choice-box')<h.indexOf('After'));});
 await t.test('adjacent questions remain one sequential group',()=>{const h=renderMarkdown(':::choice A\n- a\n- b\n:::\n\n:::choice B\n- c\n- d\n:::');assert.equal((h.match(/class="choice-box/g)||[]).length,1);assert.match(h,/data-choice-count="2"/);});
 await t.test('unfinished, fenced and quoted marker examples are not interactive',()=>{for(const s of[':::choice A\n- a','```md\n:::choice A\n- a\n:::\n```','> :::choice A\n> - a\n> :::'])assert.ok(!renderMarkdown(s).includes('choice-box'),s);});
 await t.test('CRLF, numbered options and whitespace are supported',()=>{const x=extractChoices('  :::choice Options\r\n\r\n1. first\r\n2) second\r\n  :::');assert.equal(x.groups.length,1);assert.match(renderMarkdown(':::choice Q\n1. A\n2) B\n:::'),/data-choice-send="B"/);});
 await t.test('choice text is escaped, not HTML or execution',()=>{const h=renderMarkdown(':::choice <img onerror=alert(1)>\n- <script>alert(1)</script>\n- javascript:bad\n:::');assert.ok(!/<script>/.test(h));assert.ok(!/<img onerror/.test(h));});
 await t.test('no input devices means no mic/camera; outputs do not count',()=>{assert.deepEqual(deviceKinds([{kind:'audiooutput'}]),{microphone:false,camera:false});assert.deepEqual(deviceKinds([]),{microphone:false,camera:false});});
 await t.test('microphone/camera detection is independent and accepts unlabeled devices',()=>{assert.deepEqual(deviceKinds([{kind:'audioinput',label:''}]),{microphone:true,camera:false});assert.deepEqual(deviceKinds([{kind:'videoinput'}]),{microphone:false,camera:true});});
 await t.test('unacknowledged legacy false does not disable moderation',()=>{assert.equal(effectiveModeration({}),true);assert.equal(effectiveModeration({contentModeration:false}),true);assert.equal(effectiveModeration({contentModeration:false,moderationRiskAccepted:'old'}),true);});
 await t.test('confirmed off persists, and on is always effective',()=>{assert.equal(effectiveModeration({contentModeration:false,moderationRiskAccepted:MODERATION_ACK_VERSION}),false);assert.equal(effectiveModeration({contentModeration:true,moderationRiskAccepted:MODERATION_ACK_VERSION}),true);});
 await t.test('task plans are brief public actions, not hidden rationale',()=>{for(const q of['修复JavaScript网页bug并交付文件','Analyze the CSV and report statistics','研究最新版权状态']){const p=publicTaskPlan(q);assert.ok(p.direction.length<180);assert.ok(p.steps.length>=2&&p.steps.length<=5);assert.ok(publicPlanMarkdown(p).includes(p.steps[0]));assert.ok(!JSON.stringify(p).includes('reasoning'));}});
 await t.test('simple chat/question has a one-line direction, no forced workflow',()=>{for(const q of['你好','1+1','What is a tree?'])assert.equal(publicTaskPlan(q).steps.length,0);});
 await t.test('both live prompts are materially shorter than their moved references',()=>{for(const language of['zh','en']){const live=systemPrompt(new Date(),{language}),ref=referenceSystemPrompt(new Date(),{language});assert.ok(live.length<ref.length*.5,language);for(const key of['knowledge_search','browser_sandbox','write_file','sandbox://'])assert.ok(live.includes(key));}});
 await t.test('knowledge lookup is bounded and preserves relevant project rules',()=>{const out=searchKnowledge(kb,{query:'chart map choice',topic:'rendering',language:'en'});assert.ok(out.includes(':::chart')&&out.includes(':::choice'));assert.ok(out.length<=KNOWLEDGE_MAX_CHARS);assert.ok(!out.includes('only at the very end'));});
 await t.test('Chinese knowledge queries and unknown-query fallback are explicit',()=>{assert.match(searchKnowledge(kb,{query:'选择框 图表',language:'zh'}),/选择框|图表/);assert.match(searchKnowledge(kb,{query:'NONEXISTENTXYZ',language:'en'}),/No matching/);});
 await t.test('knowledge index contains authorship/history/format examples outside live core',()=>{const s=kb.records.map(r=>r.content).join('\n');assert.match(s,/imfufuu/);assert.match(s,/:::font/);assert.match(s,/Helix/);assert.ok(!systemPrompt(new Date(),{language:'zh'}).includes('上海初中'));});
 await t.test('the requested caret sequence includes both blue phases and loops',()=>{assert.deepEqual(CARET_COLORS,['#ef4444','#eab308','#3b82f6','#22c55e','#06b6d4','#2563eb','#a855f7']);assert.equal(CARET_HOLD_MS,1100);assert.equal(CARET_CYCLE_MS,7700);CARET_COLORS.forEach((c,i)=>assert.equal(caretColorAt(i*CARET_HOLD_MS),c));assert.equal(caretColorAt(CARET_CYCLE_MS),CARET_COLORS[0]);assert.equal(caretColorAt(CARET_HOLD_MS-1),CARET_COLORS[0],'每色至少停留 1.1s，不做高频闪烁');});
 await t.test('removed controls do not leave settings/bootstrap references',()=>{const app=fs.readFileSync(new URL('../app.html',import.meta.url),'utf8'),settings=fs.readFileSync(new URL('../js/settings.js',import.meta.url),'utf8');for(const id of['share-open','set-clear-chat','set-clear-all'])assert.ok(!app.includes(`id="${id}"`));assert.ok(!app.includes('data-language-toggle'));assert.ok(!settings.includes("$('#set-clear-chat').addEventListener"));assert.ok(app.includes('set-language')&&app.includes('set-moderation'));});
 await t.test('current navigation has no release-marketing section and archives are folded',()=>{const home=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),docs=fs.readFileSync(new URL('../docs.html',import.meta.url),'utf8');assert.ok(!home.includes('id="whats-new"'));assert.ok(home.includes('先给方向与计划'));assert.ok((docs.match(/class="release-archive"/g)||[]).length>=3);assert.ok(docs.includes('CURRENT BUILD'));});
 await t.test('model presets ship English tag/note so the English settings page never shows Chinese suffixes', async () => {
  const cfg = await import('../js/config.js');
  for (const list of [cfg.IMAGE_MODELS, cfg.VISION_MODELS, cfg.VIDEO_MODELS]) {
   for (const m of list) {
    assert.ok(m.label && m.tag && m.note, `${m.id} 缺基础文案`);
    assert.ok(m.tagEn && m.noteEn, `${m.id} 缺英文文案（英文界面会漏出中文）`);
    assert.ok(!/[\u4e00-\u9fff]/.test(m.tagEn + m.noteEn), `${m.id} 的英文文案仍含中文`);
   }
  }
 });
 await t.test('suggestion pool is large enough for four cards without repeating the previous round, in both languages', async () => {
  const zh = await import('../js/suggestions.js'); const en = await import('../js/suggestions-en.js');
  assert.ok(zh.SUGGESTIONS.length >= 24, `中文池应有 ≥24 条，实际 ${zh.SUGGESTIONS.length}`);
  assert.equal(new Set(zh.SUGGESTIONS.map((x) => x.title)).size, zh.SUGGESTIONS.length, '示例标题不得重复');
  const localized = zh.localizedSuggestions('en');
  assert.ok(localized.length >= 24, `英文界面也应有足够的示例，实际 ${localized.length}`);
  assert.equal(new Set(localized.map((x) => x.text)).size, localized.length);
  // 每轮 4 张卡：池子必须足够大，且能避开上一轮用过的那批
  const rnd = () => 0.42;
  const first = zh.pickSuggestions(localized, 4, rnd);
  const second = zh.pickSuggestions(localized, 4, rnd, first.map((x) => x.text));
  assert.equal(first.length, 4);
  assert.equal(second.length, 4);
  assert.equal(second.some((x) => first.some((y) => y.text === x.text)), false, '新一轮不应重复上一轮的示例');
 });
 await t.test('toast stack is click-through so it can never swallow taps on controls beneath it',()=>{const css=fs.readFileSync(new URL('../css/styles.css',import.meta.url),'utf8');const rule=/\.toasts\s*\{([^}]*)\}/.exec(css);assert.ok(rule,'.toasts rule must exist');assert.match(rule[1],/pointer-events:\s*none/);assert.ok(!/\.toast[^{]*\{[^}]*pointer-events:\s*auto/.test(css),'no toast is interactive in this project');});
});
