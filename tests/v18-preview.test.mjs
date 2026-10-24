import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { staticPreviewDocument } from '../js/file-preview.js';
import { RELEASE_HISTORY, releaseNotes } from '../js/release-notes.js';
import { animatedPopover, installSmoothDetails } from '../js/ui-motion.js';

function documentOf(html = '') { return new JSDOM(html).window.document; }
function preview(html, files = {}) {
  globalThis.DOMParser = new JSDOM('').window.DOMParser;
  return documentOf(staticPreviewDocument(html, 'site/index.html', { read(path) { if (!(path in files)) throw Error('Missing'); return files[path]; } }));
}
test('static preview removes executable/navigable content and puts restrictive CSP first', () => {
  const doc = preview(`<base href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com"><script>parent.pwned=1</script><iframe srcdoc="bad"></iframe><object data="bad"></object><form action="https://example.com"><input autofocus></form><a href="https://example.com" ping="https://example.com">link</a><img onerror="bad()" src="https://example.com/a.png"><p style="background:url(https://example.com/a.png)">Safe</p>`);
  assert.equal(doc.querySelectorAll('script,iframe,object,base,[onerror],[autofocus],[action],[ping]').length, 0);
  assert.equal(doc.querySelector('a').hasAttribute('href'), false);
  assert.equal(doc.querySelector('img').getAttribute('src'), '');
  assert.doesNotMatch(doc.querySelector('p').getAttribute('style'), /https:/);
  assert.equal(doc.head.firstElementChild.httpEquiv, 'Content-Security-Policy');
  for (const rule of ["default-src 'none'", "script-src 'none'", "frame-src 'none'", "form-action 'none'"]) assert.ok(doc.head.firstElementChild.content.includes(rule));
});
test('local linked styles resolve relative to their stylesheet; embedded fonts survive exactly once', () => {
  const doc = preview('<link rel="stylesheet" href="css/main.css"><img src="media/a.svg">', {
    'site/css/main.css': '@import "https://example.com/a.css"; @font-face{font-family:x;src:url(../media/a.woff2)} body{background:url(../media/a.svg)}',
    'site/media/a.woff2': 'data:font/woff2;base64,YWJj',
    'site/media/a.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  assert.match(doc.querySelector('style').textContent, /data:font\/woff2;base64,YWJj/);
  assert.match(doc.querySelector('style').textContent, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(doc.querySelector('style').textContent, /@import|https:\/\/example/);
  assert.match(doc.querySelector('img').src, /^data:image\/svg\+xml;base64/);
});
test('SVG shapes, local gradient references and data images remain; dynamic SVG cannot rewrite URLs', () => {
  const doc = preview('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="50"/><image href="data:image/png;base64,YQ=="/><a href="#g"><set attributeName="href" to="https://example.com"/>go</a></svg>');
  assert.equal(doc.querySelector('rect').getAttribute('fill'), 'url(#g)');
  assert.match(doc.querySelector('image').getAttribute('href'), /^data:image/);
  assert.equal(doc.querySelector('set'), null);
  assert.equal(doc.querySelector('a').getAttribute('href'), '#g');
});
test('bilingual archive is complete and only V1.4 is historically Stable', () => {
  assert.deepEqual(RELEASE_HISTORY.map(v => v[0]), ['V1.7','V1.6','V1.5','V1.4 Stable','V1.3','V1.2','V1.1','V1.0','Pre-V1.0']);
  for (const language of ['zh','en']) {
    const doc = documentOf(releaseNotes(language));
    assert.equal(doc.querySelector('.release-overview h3').textContent, 'V1.8 Stable');
    assert.equal(doc.querySelectorAll('.release-archive').length, 9);
    assert.deepEqual([...doc.querySelectorAll('summary>span')].filter(n=>n.textContent.includes('Stable')).map(n=>n.textContent), ['V1.4 Stable']);
    assert.equal(doc.querySelector('a[href*="pulls"],a[href*="CHANGELOG"]'), null);
  }
  const html = fs.readFileSync(new URL('../docs.html', import.meta.url),'utf8');
  assert.doesNotMatch(html, /完整仓库变更记录|合并记录|pulls\?q=/);
});
function stubMotion(doc) {
  doc.documentElement.dataset.motion='on'; const animations=[];
  doc.defaultView.Element.prototype.animate=function(frames,options) { const a={frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a; };
  return animations;
}
test('popover remains mounted while closing; a rapid reopen cancels stale completion', () => {
  const doc=documentOf('<button></button><div hidden></div>'), animations=stubMotion(doc);
  const menu=doc.querySelector('div'), button=doc.querySelector('button'); const pop=animatedPopover(menu,button);
  pop.set(true); animations[0].onfinish(); assert.equal(menu.hidden,false);
  pop.set(false); const closing=animations[1]; assert.equal(menu.hidden,false); assert.equal(menu.inert,true);
  pop.set(true); closing.onfinish(); assert.equal(menu.hidden,false); assert.equal(menu.inert,false);
  assert.equal(closing.cancelled,true); animations[2].onfinish();
  pop.set(false); animations[3].onfinish(); assert.equal(menu.hidden,true); assert.equal(button.getAttribute('aria-expanded'),'false');
});
test('shared accordion cancels reversal and clears clipping when motion is turned off', () => {
  const doc=documentOf('<details><summary>Archive</summary><p>Long summary</p></details>'), animations=stubMotion(doc);
  const detail=doc.querySelector('details'); detail.getBoundingClientRect=()=>({height:detail.open?150:45});
  installSmoothDetails(doc); installSmoothDetails(doc);
  detail.querySelector('summary').click(); assert.equal(animations.length,1); assert.equal(detail.open,true);
  const opening=animations[0]; detail.querySelector('summary').click(); assert.equal(opening.cancelled,true);
  opening.onfinish(); assert.equal(detail.open,true); animations[1].onfinish(); assert.equal(detail.open,false); assert.equal(detail.style.overflow,'');
  detail.querySelector('summary').click(); doc.documentElement.dataset.motion='off'; detail.querySelector('summary').click();
  assert.equal(detail.open,false); assert.equal(detail.style.overflow,'');
});
test('reduced-motion popover is immediate and does not create animations', () => {
  const doc=documentOf('<button></button><div hidden></div>'), animations=stubMotion(doc);doc.documentElement.dataset.motion='off';
  const menu=doc.querySelector('div'), pop=animatedPopover(menu,doc.querySelector('button'));
  pop.set(true);assert.equal(menu.hidden,false);pop.set(false);assert.equal(menu.hidden,true);assert.equal(animations.length,0);
});

test('live catalog snapshot includes TeamoRouter V4.1 Flash 1017 and evidence-based low-cost labels', async () => {
  const { MODEL_CATALOG, MODEL_CATALOG_BY_ID } = await import('../js/model-catalog.js');
  const { FALLBACK_MODELS, resolveModelAlias } = await import('../js/config.js');
  assert.equal(MODEL_CATALOG.length,60);assert.equal(new Set(MODEL_CATALOG.map(m=>m.id)).size,60);
  assert.deepEqual(MODEL_CATALOG.filter(m=>m.newlyListed).map(m=>m.id).sort(),['MiniMax-M3','claude-haiku-5-5','doubao-seed-2.0-lite','gemini-4-argon','grok-4.7','kimi-k3.1-pro','mimo-v2.6-flash','mimo-v2.6-pro']);
  assert.equal(FALLBACK_MODELS.length,53);assert.equal(FALLBACK_MODELS.some(m=>m.id.startsWith('kimi')),true);
  for(const [id,provider] of [['doubao-seed-2.1-pro','Doubao'],['kimi-k3','Kimi'],['MiniMax-M3','MiniMax'],['qwen3.8-max','Qwen']]) {
    const model=MODEL_CATALOG_BY_ID.get(id);assert.equal(model?.provider,provider,id);assert.ok(FALLBACK_MODELS.some(m=>m.id===id),id+' offline fallback');
  }
  assert.equal(MODEL_CATALOG_BY_ID.get('MiniMax-M3').contextWindow,1000000);
  assert.equal(MODEL_CATALOG_BY_ID.get('qwen3.8-max').contextWindow,1000000);
  const flash1017=MODEL_CATALOG_BY_ID.get('deepseek-flash-1017');
  assert.equal(flash1017.displayName,'DeepSeek V4.1 Flash 1017');
  assert.equal(flash1017.provider,'DeepSeek');
  assert.deepEqual(flash1017.listPrice,{currency:'USD',input:0.15,output:0.6,cached_input:0.003});
  assert.equal(flash1017.contextWindow,1000000);
  assert.equal(flash1017.cheap,true);
  for(const m of MODEL_CATALOG) {
    assert.equal(!!m.cheap,m.channel==='chat'&&m.listPrice.input<=1&&m.listPrice.output<=5,m.id);
    assert.equal('cost' in m,false);assert.equal('discount_rate' in m,false);
  }
  assert.equal(MODEL_CATALOG_BY_ID.get('deepseek-v4-pro').cheap,true);
  assert.equal(MODEL_CATALOG_BY_ID.get('gemini-3.5-flash').cheap,undefined);
  assert.equal(MODEL_CATALOG_BY_ID.get('doubao-seed-2.1-pro').cheap,true);
  assert.equal(MODEL_CATALOG_BY_ID.get('MiniMax-M3').cheap,true);
  assert.equal(MODEL_CATALOG_BY_ID.get('qwen3.8-max').cheap,undefined);
  assert.equal(resolveModelAlias('gemini-3.5-flash'),'gemini-3.5-flash','a catalog-listed choice must not be silently replaced');
});
test('DeepSeek fallback matches official /models, and the versioned TeamoRouter alias stays gateway-only', async () => {
  const { gatewayFallbackModelIds } = await import('../js/gateway-registry.js');
  assert.deepEqual(gatewayFallbackModelIds('deepseek').sort(),['deepseek-flash','deepseek-v4-pro']);
  assert.ok(gatewayFallbackModelIds('teamorouter').includes('deepseek-flash-1017'));
  assert.ok(!gatewayFallbackModelIds('deepseek').includes('deepseek-flash-1017'));
});
test('TeamoRouter user-confirmed IDs survive partial/empty price responses; offline fallback remains available', async()=>{
  const { mergeAvailableModels, TEAMOROUTER_CONFIRMED_MODEL_IDS }=await import('../js/model-catalog.js');
  const { FALLBACK_MODELS }=await import('../js/config.js');
  const expected = ['__smart_router__', ...TEAMOROUTER_CONFIRMED_MODEL_IDS];
  assert.deepEqual(mergeAvailableModels(['gemini-4-argon','gemini-4-argon'],FALLBACK_MODELS).map(m=>m.id),expected);
  assert.deepEqual(mergeAvailableModels([],FALLBACK_MODELS,true).map(m=>m.id),expected, 'an empty price response does not revoke the user-confirmed availability list');
  assert.equal(mergeAvailableModels([],FALLBACK_MODELS).length,FALLBACK_MODELS.length);
  assert.ok(mergeAvailableModels(['future-chat-model'],FALLBACK_MODELS).some(m=>m.id==='future-chat-model'),'live directory may introduce additional models');
  const kimiFallback=mergeAvailableModels(['kimi-k3','kimi-k3[1M]'],FALLBACK_MODELS).map(m=>m.id);
  assert.ok(kimiFallback.includes('kimi-k3'),'current Kimi K3 is available');
  assert.ok(!kimiFallback.includes('kimi-k3[1M]'),'historical 1M variant stays retired');
});
test('MiMo models from the user-confirmed list stay available when the public price snapshot omits them', async () => {
  const { mergeAvailableModels, MODEL_CATALOG_BY_ID, TEAMOROUTER_CONFIRMED_MODEL_IDS } = await import('../js/model-catalog.js');
  const { FALLBACK_MODELS } = await import('../js/config.js');
  const currentPublicIds = ['qwen3.7-flash', 'MiniMax-M3']; // 2026-10-23 pricing snapshot omitted MiMo IDs
  for (const id of ['mimo-v2.6-flash', 'mimo-v2.6-pro']) assert.ok(MODEL_CATALOG_BY_ID.has(id), `${id} remains in the catalog`);
  const listed = mergeAvailableModels(currentPublicIds, FALLBACK_MODELS).map(m => m.id);
  assert.deepEqual(listed, ['__smart_router__', ...TEAMOROUTER_CONFIRMED_MODEL_IDS]);
  assert.ok(listed.includes('mimo-v2.6-flash') && listed.includes('mimo-v2.6-pro'), 'the user-confirmed availability list supersedes a partial pricing snapshot');
  const offline = mergeAvailableModels([], FALLBACK_MODELS).map(m => m.id);
  assert.ok(offline.includes('mimo-v2.6-flash') && offline.includes('mimo-v2.6-pro'), 'offline fallback retains both entries too');
});

test('updated gateway list prices cover all visible catalog models, including MiniMax context tiers',async()=>{
  const { FALLBACK_MODELS }=await import('../js/config.js');
  const { getModelPricing }=await import('../js/pricing.js');
  for(const model of FALLBACK_MODELS.filter(m=>m.listPrice)) {
    const price=getModelPricing(model.id);assert.ok(price,model.id);
    assert.equal(price.input,model.listPrice.input,model.id+' input');assert.equal(price.output,model.listPrice.output,model.id+' output');
  }
  const { estimateChatCost }=await import('../js/pricing.js');
  const tiered=estimateChatCost('MiniMax-M3',{input_tokens:512001,output_tokens:1000});
  assert.equal(tiered.inRate,0.6);assert.equal(tiered.outRate,2.4);
});
test('Doubao estimate discloses that token-hour cache storage is excluded in both UI languages', async () => {
  const { estimateChatCost } = await import('../js/pricing.js');
  const { setLanguagePreference } = await import('../js/locale.js');
  try {
    setLanguagePreference('zh');
    const zh = estimateChatCost('doubao-seed-2.0-lite', { input: 1000, cached: 200, output: 20 });
    assert.match(zh.rateLabel, /token·小时/);
    assert.match(zh.rateLabel, /未计入估价/);
    setLanguagePreference('en');
    const en = estimateChatCost('doubao-seed-2.0-lite', { input: 1000, cached: 200, output: 20 });
    assert.match(en.rateLabel, /token-hour/);
    assert.match(en.rateLabel, /not included/);
  } finally { setLanguagePreference('zh'); }
});
test('thumb down has its own downward path, with no second CSS or SVG rotation',async()=>{
  const { ICON }=await import('../js/icons.js');
  const doc=documentOf(ICON.thumbUp+ICON.thumbDown);const paths=doc.querySelectorAll('path');
  assert.notEqual(paths[0].getAttribute('d'),paths[1].getAttribute('d'));
  assert.match(paths[1].getAttribute('d'),/M17 14l-4 7/);
  assert.equal(doc.querySelector('[transform]'),null);
  const css=fs.readFileSync(new URL('../css/styles.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/\.feedback-btn\[data-vote="down"\] svg\s*\{[^}]*rotate/);
  assert.doesNotMatch(css,/\.feedback-btn\[data-vote="(?:up|down)"\]\[aria-pressed="true"\]\s*\{[^}]*background:/, '赞/踩激活态不再绘制绿/红背景');
  assert.doesNotMatch(css,/\[data-theme="dark"\] \.feedback-btn\[data-vote="(?:up|down)"\]\[aria-pressed="true"\]\s*\{[^}]*background:/);
});

// ── 2026-10-24：目录热度复核（补齐 TeamoRouter 清单、供应商排序与价格标签） ──
test('2026-10-24 目录复核：热门按当前清单重排并补齐国产供应商标签', async () => {
  const { MODEL_CATALOG_BY_ID } = await import('../js/model-catalog.js');
  const hotIds = ['MiniMax-M3','claude-fable-5-1','claude-haiku-5-5','claude-opus-5-5','claude-sonnet-5-5','deepseek-flash','deepseek-v4-pro','doubao-seed-2.1-pro','gemini-3.8-flash','gemini-4-argon','glm-5.3','glm-5.3-flash','gpt-6-astra','gpt-6-luna','gpt-6.1-sol','grok-4.7','kimi-k3.1-pro','mimo-v2.6-pro','qwen3.8-max'];
  const { MODEL_CATALOG } = await import('../js/model-catalog.js');
  assert.deepEqual(MODEL_CATALOG.filter(m => m.hot).map(m => m.id).sort(), [...hotIds].sort(), '热门集合应与调研结论一致');
  assert.equal(MODEL_CATALOG_BY_ID.get('grok-4.6').hot, undefined, 'grok-4.6 已被 4.7 取代，不再标热门');
  const grok47 = MODEL_CATALOG_BY_ID.get('grok-4.7');
  assert.deepEqual(grok47.listPrice, { currency: 'USD', input: 2.0, output: 6.0, cached_input: 0.5 });
  assert.equal(grok47.contextWindow, 500000);
  const lite = MODEL_CATALOG_BY_ID.get('doubao-seed-2.0-lite');
  assert.deepEqual(lite.listPrice, { currency: 'USD', input: 0.089312295, output: 0.535873772, cached_input: 0.017862459 });
  assert.equal(lite.contextWindow, 256000);
  assert.equal(lite.cheap, true, '0.0857/0.5143 满足低价阈值');
  const picker = fs.readFileSync(new URL('../js/ui-model-picker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(picker, /badge ghost/, '模型菜单不再渲染 ghost 徽标');
  assert.doesNotMatch(picker, /localeText\('预览/, '预览档不再输出「预览 / 实验」徽标文案');
  assert.doesNotMatch(picker, /const preview = /, '不再按 ID 正则推断预览档');
});

test('文档页新增独立「使用规范」分区：四大条款齐备，成人文本不做跨模型屏蔽、CSAM/深伪绝对禁止', () => {
  const docs = fs.readFileSync(new URL('../docs.html', import.meta.url), 'utf8');
  const dom = new JSDOM(docs);
  const page = dom.window.document.getElementById('page-usage');
  assert.ok(page, '存在独立的 page-usage 分区');
  const heads = [...page.querySelectorAll('.legal-card h3')].map(h => h.textContent.replace(/^\d+/, ''));
  assert.deepEqual(heads, ['禁止性行为清单', '用户义务与操作要求', '鼓励性内容', '执行和后果条款'], '四个规定小节齐备且顺序正确');
  const text = page.textContent;
  assert.match(text, /独立于《用户协议》/, '明确与用户协议不是同一份文件');
  assert.match(text, /不做跨模型完全屏蔽/, '成人色情类文本创作不做跨模型完全屏蔽');
  assert.match(text, /深度伪造色情/, '深伪色情列为绝对禁止');
  assert.match(text, /即使声称为虚构创作/, '未成年人性描写即便虚构也绝对禁止');
  assert.match(text, /零容忍/, '执行条款含零容忍');
  const lang = fs.readFileSync(new URL('../js/docs-language.js', import.meta.url), 'utf8');
  assert.match(lang, /const usage = card\(\[/, '英文版使用规范存在');
  assert.match(lang, /usage: `<h2>Usage policy<\/h2>/, '英文页面已注册');
  assert.match(lang, /NOT blocked across all models/, '英文版同样写明不做跨模型屏蔽');
  assert.match(lang, /Deepfake pornography/, '英文版深伪色情绝对禁止');
});

test('提示词三层齐声禁止瞎猜应用内围栏语法：先 knowledge_search 再输出，检索失败退回纯 Markdown', async () => {
  const { coreSystemPrompt } = await import('../js/prompt-core.js');
  const zh = coreSystemPrompt(new Date(), { language: 'zh' });
  const en = coreSystemPrompt(new Date(), { language: 'en' });
  assert.match(zh, /禁止凭记忆或训练印象猜写应用内:::围栏语法/);
  assert.match(zh, /topic=rendering/);
  assert.match(zh, /退回纯Markdown表格\/列表/);
  assert.match(en, /Never guess app-internal ::: fence grammar/);
  assert.match(en, /fall back to plain Markdown tables\/lists/);
  const { formatRuntime } = await import('../js/prompt.js');
  assert.match(formatRuntime({ now: new Date(), language: 'zh' }), /输出:::chart\/map\/flow\/mind\/font围栏块前先检索对应精确语法，禁止凭记忆猜写/);
  assert.match(formatRuntime({ now: new Date(), language: 'en' }), /never guess fence syntax from memory/i);
  const { compactOutputSpec } = await import('../js/config.js');
  assert.match(compactOutputSpec('zh'), /禁止凭记忆猜写/);
  assert.match(compactOutputSpec('en'), /never guess fence syntax from memory/i);
});
