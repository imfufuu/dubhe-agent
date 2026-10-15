// Real-browser V1.8 checks. Run against a local static server with Playwright installed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MODEL_CATALOG } from '../js/model-catalog.js';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
for (const engine of (process.env.BROWSERS || 'chromium,webkit').split(',')) {
  const browser = await engines[engine].launch(); let checks = 0;
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1024},locale:'zh-CN'});
    const previewRequests=[];page.on('request',r=>{if(r.url().includes('example.invalid'))previewRequests.push(r.url());});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*', route => {
      const url=route.request().url();
      if (/https:\/\/api\.teamorouter\.(com|cn)\/v1\/models$/.test(url)) return route.fulfill({contentType:'application/json',body:JSON.stringify({data:MODEL_CATALOG.map(m=>({id:m.id}))})});
      if(!url.startsWith(base+'/'))return route.abort();
      if(url.includes('/js/main.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../js/main.js',import.meta.url),'utf8')+'\nglobalThis.__uiTest={store,agent,ui};'});
      return route.continue();
    });
    await page.goto(base+'/app.html');await page.waitForFunction(()=>globalThis.__uiTest?.ui);
    await page.locator('#key-modal.open').waitFor();await page.locator('#key-close').evaluate(n=>n.click());await page.waitForTimeout(450);
    await page.evaluate(()=>{document.querySelector('#key-modal').classList.remove('open');document.documentElement.dataset.motion='on';});
    // Real tool rows, including a nested command, read-list and edit folds.
    await page.evaluate(()=>{
      const {store,ui}=__uiTest;
      const calls=[{id:'c1',name:'execute_javascript',args:{code:'console.log(1)'},durationMs:80},{id:'c2',name:'write_file',args:{path:'result.txt',content:'one\ntwo\nthree'},editPreviewBase:{path:'result.txt',content:''},editPreviewSnapshot:{path:'result.txt',content:'one\ntwo\nthree'}},{id:'c3',name:'read_file',args:{path:'result.txt'}}].map(c=>({...c,status:'ok',settled:true}));
      store.state.messages=[{id:'u',role:'user',text:'Check folds'},{id:'a',role:'assistant',text:'Done',done:true,toolCalls:calls},...calls.map(c=>({id:'t'+c.id,role:'tool',toolCallId:c.id,content:'one\ntwo\nthree'}))];ui.rebuildMessages();
    });
    await page.waitForTimeout(400);
    for (const selector of ['.ran-commands','.tool-call-chip','.edited-files','.explored-files']) {
      const result=await page.locator('#messages '+selector).first().evaluate(async node=>{
        const detail=node.querySelector(':scope > .chip-detail'),label=node.querySelector(':scope > .chip-name');
        const wait=ms=>new Promise(r=>setTimeout(r,ms)),h=()=>detail.getBoundingClientRect().height;
        const sample = async () => {
          label.click(); h();
          const transition = detail.getAnimations().find(a=>a.transitionProperty==='grid-template-rows');
          if (!transition) throw Error('Missing grid transition');
          transition.pause(); transition.currentTime=90;
          const middle=h(); transition.finish();h();await wait(400);return middle;
        };
        const before=h(), opening=await sample(), full=h(), closing=await sample(), after=h();
        // Leave the group open so its nested command can be exercised next.
        if(node.classList.contains('ran-commands')) {label.click();await wait(330);}
        return {before,opening,full,closing,after};
      });
      assert.equal(result.before,0,selector+JSON.stringify(result));assert.ok(result.opening>0&&result.opening<result.full,selector+JSON.stringify(result));assert.ok(result.closing>0&&result.closing<result.full,selector+JSON.stringify(result));assert.equal(result.after,0,selector+JSON.stringify(result));checks++;
    }
    const names=await page.evaluate(()=>{
      document.querySelectorAll('#messages .tool-call-chip,#messages .edited-files,#messages .explored-files').forEach(n=>n.classList.add('is-working'));
      return [...document.querySelectorAll('#messages .tool-call-chip > .chip-name,#messages .edit-path,#messages .explored-files .file-path')].map(n=>({text:n.textContent,animation:getComputedStyle(n).animationName,fill:getComputedStyle(n).webkitTextFillColor}));
    });assert.ok(names.length>0);assert.ok(names.every(n=>!n.animation.includes('tool-ink-polish')&&n.fill!=='rgba(0, 0, 0, 0)'),JSON.stringify(names));checks++;
    await page.evaluate(()=>{const {store,ui}=__uiTest;store.state.messages=[{id:'feedback-user',role:'user',text:'Review'},{id:'feedback-answer',role:'assistant',text:'A completed answer.',done:true,completion:'normal'}];ui.rebuildMessages();ui.setStatus('done');});
    await page.locator('.feedback-btn[data-vote="down"]').waitFor();
    for (const theme of ['light','dark']) for (const motion of ['on','off']) {
      await page.evaluate(({theme,motion})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.motion=motion;}, {theme,motion});
      const up=page.locator('.feedback-btn[data-vote="up"]'),down=page.locator('.feedback-btn[data-vote="down"]');
      assert.notEqual(await up.locator('path').getAttribute('d'),await down.locator('path').getAttribute('d'));
      assert.equal(await down.locator('svg').evaluate(n=>getComputedStyle(n).transform),'none');
      await down.evaluate(n=>n.click());assert.equal(await down.getAttribute('aria-pressed'),'true');assert.equal(await up.getAttribute('aria-pressed'),'false');
      assert.equal(await page.evaluate(()=>__uiTest.store.state.messages.at(-1).feedback.vote),'down');
      await up.evaluate(n=>n.click());assert.equal(await up.getAttribute('aria-pressed'),'true');assert.equal(await down.getAttribute('aria-pressed'),'false');
      await up.evaluate(n=>n.click());assert.equal(await up.getAttribute('aria-pressed'),'false');checks++;
    }
    await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.dataset.motion='on';__uiTest.store.state.apiKey='sk-teamo-ui-fixture';});
    await page.locator('#refresh-models').evaluate(n=>n.click());
    await page.waitForFunction(()=>__uiTest.store.state.modelsFetchedAt&&__uiTest.store.state.models.length===47);
    await page.locator('#model-btn').click();
    const menu=page.locator('#model-menu');
    const haiku=menu.locator('.dd-item').filter({has:page.locator('.dd-item-id',{hasText:'claude-haiku-5-5'})});
    assert.equal(await haiku.count(),1);assert.match(await haiku.innerText(),/推荐/);assert.match(await haiku.innerText(),/新收录/);assert.match(await haiku.innerText(),/低价/);
    assert.equal(await menu.locator('.dd-item-id').filter({hasText:'gemini-4-argon'}).count(),1);
    assert.equal(await menu.locator('.dd-item-id').filter({hasText:'kimi-k3'}).count(),0);
    assert.equal(await menu.locator('.dd-item-id').filter({hasText:'-free'}).count(),0);
    assert.equal(await menu.locator('.dd-item-id').filter({hasText:'deepseek-v4-flash-vision-exp'}).count(),0);
    assert.equal(await menu.locator('.dd-item').count(),39);
    await page.locator('#model-btn').click();checks++;
    const pop=await page.evaluate(async()=>{
      const b=document.querySelector('#attach-btn'),m=document.querySelector('#attach-menu'),wait=ms=>new Promise(r=>setTimeout(r,ms));
      b.click();await wait(450);b.click();const a=m.getAnimations().at(-1);a.pause();a.currentTime=60;const mid={hidden:m.hidden,opacity:+getComputedStyle(m).opacity,inert:m.inert};
      b.click();await wait(450);const reopened=!m.hidden&&!m.inert;b.click();await wait(450);return {mid,reopened,closed:m.hidden};
    });assert.equal(pop.mid.hidden,false);assert.ok(pop.mid.opacity>0&&pop.mid.opacity<1,JSON.stringify(pop));assert.equal(pop.mid.inert,true,JSON.stringify(pop));assert.equal(pop.reopened,true,JSON.stringify(pop));assert.equal(pop.closed,true,JSON.stringify(pop));checks++;
    for (const width of [768,820,1024,1180,1440,375]) {
      await page.setViewportSize({width,height:1024});await page.evaluate(()=>{if(document.querySelector('#sandbox-panel').classList.contains('collapsed'))document.querySelector('#panel-toggle').click();});await page.waitForTimeout(400);
      const panel=await page.evaluate(()=>({position:getComputedStyle(document.querySelector('#sandbox-panel')).position,backdrop:document.querySelector('#overlay-backdrop').classList.contains('show'),width:document.querySelector('#sandbox-panel').getBoundingClientRect().width}));
      if(width>760){assert.notEqual(panel.position,'fixed');assert.equal(panel.backdrop,false);}else{assert.equal(panel.position,'fixed');assert.equal(panel.backdrop,true);assert.equal(panel.width,width);}checks++;
      await page.locator('#panel-close').click();await page.waitForTimeout(350);
    }
    await page.setViewportSize({width:1440,height:1024});await page.locator('#panel-toggle').click();await page.waitForTimeout(350);
    await page.waitForFunction(()=>Math.abs(document.querySelector('#sandbox-panel').getBoundingClientRect().width-320)<.1);
    const narrow=await page.locator('#sandbox-panel').evaluate(n=>n.getBoundingClientRect().width);
    await page.evaluate(()=>{
      const {agent,ui}=__uiTest;
      agent.fs.write('preview.html','<!doctype html><link rel="stylesheet" href="preview.css"><h1 id="safe">Static preview</h1><script>parent.__pwned=1</script><img src="https://example.invalid/x"><iframe src="https://example.invalid/y"></iframe><button onclick="parent.__pwned=2">No script</button>');
      agent.fs.write('preview.css','h1{color:rgb(20, 40, 60)}');
      agent.fs.write('shape.svg','<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="180" height="100" fill="orange"/></svg>');
      agent.fs.write('encoded.svg','data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text y="20">Encoded SVG</text></svg>'));
      agent.fs.write('notes.txt','ordinary file');agent.fs.write('large.html','a'.repeat(1024*1024+8));ui.renderFiles();
    });
    await page.locator('.ft-row[data-path="preview.html"]').click();await page.waitForTimeout(400);
    const wide=await page.locator('#sandbox-panel').evaluate(n=>n.getBoundingClientRect().width);assert.ok(wide>narrow+150,{narrow,wide});checks++;
    assert.equal(await page.locator('.fv-static iframe').getAttribute('sandbox'),'');
    const frame=page.frameLocator('.fv-static iframe');await frame.locator('#safe').waitFor();assert.equal(await frame.locator('#safe').evaluate(n=>getComputedStyle(n).color),'rgb(20, 40, 60)');
    assert.equal(await frame.locator('script,iframe,[onclick]').count(),0);assert.equal(await page.evaluate(()=>globalThis.__pwned),undefined);checks++;
    // V1.8.1：并排模式已移除，只剩「代码 / 预览」，默认预览；两层交叉淡入（隐藏层 visibility:hidden）
    assert.equal(await page.locator('[data-view-mode="split"]').count(),0);assert.equal(await page.locator('.fv-dual').getAttribute('data-mode'),'preview');
    for(const mode of ['code','preview']){
      await page.locator(`[data-view-mode="${mode}"]`).click();await page.waitForTimeout(350);assert.equal(await page.locator('.fv-dual').getAttribute('data-mode'),mode);
      assert.equal(await page.locator('.fv-code').isVisible(),mode==='code');assert.equal(await page.locator('.fv-static').isVisible(),mode==='preview');checks++;
    }
    await page.screenshot({path:`/home/user/task4-${engine}-viewer.png`});
    await page.locator('#fv-close').click();await page.waitForFunction(()=>Math.abs(document.querySelector('#sandbox-panel').getBoundingClientRect().width-320)<.1);assert.equal(await page.locator('.fv-static iframe').count(),0);assert.ok(Math.abs(await page.locator('#sandbox-panel').evaluate(n=>n.getBoundingClientRect().width)-narrow)<.1);checks++;
    for (const path of ['shape.svg','encoded.svg']) {
      await page.locator(`.ft-row[data-path="${path}"]`).click();await page.frameLocator('.fv-static iframe').locator('svg').waitFor();assert.match(await page.locator('.fv-code').textContent(),/<svg/);await page.locator('#fv-close').click();checks++;
    }
    for(const path of ['notes.txt','large.html']){await page.locator(`.ft-row[data-path="${path}"]`).click();assert.equal(await page.locator('.fv-modes').count(),0);assert.equal(await page.locator('.fv-static iframe').count(),0);await page.locator('#fv-close').click();checks++;}
    await page.locator('.ft-row[data-path="preview.html"]').click();await page.locator('[data-panel-tab="memory"]').click();assert.equal(await page.locator('#file-viewer').evaluate(n=>n.classList.contains('open')),false);assert.equal(await page.locator('.fv-static iframe').count(),0);checks++;
    await page.goto(base+'/docs.html#changelog');await page.waitForFunction(()=>document.querySelector('.release-archive')?._smoothDetails);
    for(const language of ['zh','en']){
      await page.evaluate(async lang=>{const l=await import('./js/locale.js');l.setLanguagePreference(lang);document.documentElement.dataset.motion='on';},language);await page.waitForTimeout(250);
      const scope=page.locator(`#page-changelog [data-doc-language="${language}"]`);assert.equal(await scope.locator('.release-archive').count(),9);assert.equal(await scope.locator('.release-overview h3').textContent(),'V1.8 Stable');
      await scope.locator('details').first().waitFor({state:'visible'});
      const result=await scope.locator('details').first().evaluate(async n=>{
        const h=()=>n.getBoundingClientRect().height,w=ms=>new Promise(r=>setTimeout(r,ms)),b=h();
        const sample=async()=>{n.querySelector('summary').click();const a=n.getAnimations()[0];if(!a)throw Error('Missing accordion animation');a.pause();a.currentTime=90;const m=h();a.finish();await w(400);return m;};
        const m=await sample(),f=h(),c=await sample();return {b,m,f,c,end:h(),open:n.open};
      });
      assert.ok(result.m>result.b&&result.m<result.f,JSON.stringify(result));assert.ok(result.c>result.b&&result.c<result.f,JSON.stringify(result));assert.equal(result.end,result.b);assert.equal(result.open,false);checks++;
    }
    await page.screenshot({path:`/home/user/task4-${engine}-docs.png`});
    await page.goto(base+'/index.html?view=nav');
    await page.waitForFunction(()=>document.querySelector('.faq details')?._smoothDetails);
    await page.locator('.faq details').first().scrollIntoViewIfNeeded();
    const faq=await page.locator('.faq details').first().evaluate(async n=>{
      document.documentElement.dataset.motion='on';const h=()=>n.getBoundingClientRect().height,b=h();n.querySelector('summary').click();const a=n.getAnimations().find(a=>a.effect.getKeyframes().some(k=>'height' in k));
      if(!a)throw Error('Missing FAQ height animation');a.pause();a.currentTime=90;const mid=h();a.finish();await new Promise(r=>setTimeout(r,400));const full=h();
      document.documentElement.dataset.motion='off';n.querySelector('summary').click();return {b,mid,full,closed:!n.open,clipped:n.style.overflow};
    });assert.ok(faq.mid>faq.b&&faq.mid<faq.full,JSON.stringify(faq));assert.equal(faq.closed,true);assert.equal(faq.clipped,'');checks++;
    assert.deepEqual(previewRequests,[], 'Static parsing/preview must not issue remote requests');
    assert.deepEqual(errors,[]);console.log(`${engine}: ${checks} V1.8 browser checks passed`);
  }finally{await browser.close();}
}
