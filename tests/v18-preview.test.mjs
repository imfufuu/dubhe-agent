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

test('live catalog snapshot has 47 entries, two new models and evidence-based low-cost labels', async () => {
  const { MODEL_CATALOG, MODEL_CATALOG_BY_ID } = await import('../js/model-catalog.js');
  const { FALLBACK_MODELS, resolveModelAlias } = await import('../js/config.js');
  assert.equal(MODEL_CATALOG.length,47);assert.equal(new Set(MODEL_CATALOG.map(m=>m.id)).size,47);
  assert.deepEqual(MODEL_CATALOG.filter(m=>m.newlyListed).map(m=>m.id).sort(),['claude-haiku-5-5','gemini-4-argon']);
  assert.equal(FALLBACK_MODELS.length,40);assert.equal(FALLBACK_MODELS.some(m=>m.id.startsWith('kimi')),false);
  for(const m of MODEL_CATALOG) {
    assert.equal(!!m.cheap,m.channel==='chat'&&m.listPrice.input<=1&&m.listPrice.output<=5,m.id);
    assert.equal('cost' in m,false);assert.equal('discount_rate' in m,false);
  }
  assert.equal(MODEL_CATALOG_BY_ID.get('deepseek-v4-pro').cheap,true);
  assert.equal(MODEL_CATALOG_BY_ID.get('gemini-3.5-flash').cheap,undefined);
  assert.equal(resolveModelAlias('gemini-3.5-flash'),'gemini-3.5-flash','a catalog-listed choice must not be silently replaced');
});
test('a live model response is authoritative, including an empty result; offline fallback stays available', async()=>{
  const { mergeAvailableModels }=await import('../js/model-catalog.js');
  const { FALLBACK_MODELS }=await import('../js/config.js');
  assert.deepEqual(mergeAvailableModels(['gemini-4-argon','gemini-4-argon'],FALLBACK_MODELS).map(m=>m.id),['__smart_router__','gemini-4-argon']);
  assert.deepEqual(mergeAvailableModels([],FALLBACK_MODELS,true).map(m=>m.id),['__smart_router__']);
  assert.equal(mergeAvailableModels([],FALLBACK_MODELS).length,FALLBACK_MODELS.length);
  assert.ok(mergeAvailableModels(['future-chat-model'],FALLBACK_MODELS).some(m=>m.id==='future-chat-model'),'live directory may introduce new models');
  assert.ok(!mergeAvailableModels(['kimi-k3','kimi-k3[1M]'],FALLBACK_MODELS).some(m=>m.id.startsWith('kimi-')),'用户确认下线的 Kimi 不由旧目录复活');
});
test('updated gateway list prices cover all visible catalog models',async()=>{
  const { FALLBACK_MODELS }=await import('../js/config.js');
  const { getModelPricing }=await import('../js/pricing.js');
  for(const model of FALLBACK_MODELS.filter(m=>m.listPrice)) {
    const price=getModelPricing(model.id);assert.ok(price,model.id);
    assert.equal(price.input,model.listPrice.input,model.id+' input');assert.equal(price.output,model.listPrice.output,model.id+' output');
  }
});
test('thumb down has its own downward path, with no second CSS or SVG rotation',async()=>{
  const { ICON }=await import('../js/icons.js');
  const doc=documentOf(ICON.thumbUp+ICON.thumbDown);const paths=doc.querySelectorAll('path');
  assert.notEqual(paths[0].getAttribute('d'),paths[1].getAttribute('d'));
  assert.match(paths[1].getAttribute('d'),/M17 14l-4 7/);
  assert.equal(doc.querySelector('[transform]'),null);
  const css=fs.readFileSync(new URL('../css/styles.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/\.feedback-btn\[data-vote="down"\] svg\s*\{[^}]*rotate/);
});
