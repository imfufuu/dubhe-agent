import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{staticSite,openPage}from'./helpers/browser.js';let chromium,webkit;try{({chromium,webkit}=await import('playwright'));}catch{console.log('⏭ refinement-browser: Playwright unavailable');process.exit(0);}
if(![chromium,webkit].every(x=>fs.existsSync(x.executablePath()))){console.log('⏭ refinement-browser: Chromium/WebKit unavailable');process.exit(0);}
const site=await staticSite();
const fakeKey=()=>localStorage.setItem('dubhe-agent-state-v1',JSON.stringify({apiKey:'sk-teamo-QA-fake-xxxxxxxxxxxxxxxx',settings:{theme:'light'}}));
try{for(const engine of[chromium,webkit])await test(`real ${engine.name()} refinement`,async t=>{
 const browser=await engine.launch({headless:true,...(engine===chromium?{chromiumSandbox:false,args:['--disable-dev-shm-usage']}: {})});
 try{
  await t.test('removed chrome is absent; language lives in settings and footers',async()=>{const{context,page}=await openPage(browser,site.base,{main:true,init:fakeKey});try{await page.waitForFunction(()=>!document.getElementById('boot-screen'));for(const id of['share-open','set-clear-chat','set-clear-all'])assert.equal(await page.locator('#'+id).count(),0);assert.equal(await page.locator('.topbar [data-language-toggle]').count(),0);await page.click('#settings-btn');await page.selectOption('#set-language','zh');assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');await page.selectOption('#set-language','en');assert.equal(await page.locator('html').getAttribute('lang'),'en');}finally{await context.close();}});
  await t.test('device enumeration hides absent inputs, never invokes getUserMedia, and reacts to plug-in',async()=>{const{context,page}=await openPage(browser,site.base,{main:true,init:()=>{localStorage.setItem('dubhe-agent-state-v1',JSON.stringify({apiKey:'sk-QA-fake'}));window.__devices=[];window.__getMediaCalls=0;Object.defineProperty(navigator,'mediaDevices',{value:{enumerateDevices:async()=>window.__devices,getUserMedia(){window.__getMediaCalls++;throw Error('must not ask');},addEventListener(n,fn){if(n==='devicechange')window.__deviceChange=fn;}}});}});try{await page.waitForFunction(()=>!document.getElementById('boot-screen'));assert.equal(await page.locator('#voice-btn').isVisible(),false);await page.click('#attach-btn');assert.equal(await page.locator('#camera-btn').isVisible(),false);assert.equal(await page.evaluate(()=>window.__getMediaCalls),0);await page.evaluate(async()=>{window.__devices=[{kind:'audioinput'}];await window.__deviceChange();});assert.equal(await page.locator('#voice-btn').isVisible(),true);assert.equal(await page.locator('#camera-btn').isVisible(),false);await page.evaluate(async()=>{window.__devices=[{kind:'videoinput'}];await window.__deviceChange();});assert.equal(await page.locator('#voice-btn').isVisible(),false);assert.equal(await page.locator('#camera-btn').isVisible(),true);assert.equal(await page.evaluate(()=>window.__getMediaCalls),0);}finally{await context.close();}});
  await t.test('moderation off requires explicit risk acknowledgement, cancel keeps on, reload respects confirmed off',async()=>{const{context,page}=await openPage(browser,site.base,{main:true,init:fakeKey});try{await page.waitForFunction(()=>!document.getElementById('boot-screen'));await page.click('#settings-btn');assert.equal(await page.locator('#set-moderation').isChecked(),true);await page.locator('label.sw:has(#set-moderation)').click();assert.equal(await page.locator('#moderation-risk-modal').getAttribute('class'),'modal open');assert.equal(await page.locator('#moderation-risk-confirm').isDisabled(),true);await page.click('#moderation-risk-cancel');assert.equal(await page.locator('#set-moderation').isChecked(),true);await page.locator('label.sw:has(#set-moderation)').click();await page.locator('#moderation-risk-ack').check();await page.click('#moderation-risk-confirm');assert.equal(await page.locator('#set-moderation').isChecked(),false);await page.waitForTimeout(400);await page.reload();await page.waitForFunction(()=>!document.getElementById('boot-screen'));await page.click('#settings-btn');assert.equal(await page.locator('#set-moderation').isChecked(),false);await page.locator('label.sw:has(#set-moderation)').click();assert.equal(await page.locator('#set-moderation').isChecked(),true);}finally{await context.close();}});
  await t.test('reported inline-closing summary choice renders in place and remains actionable only on completed answer',async()=>{const{context,page}=await openPage(browser,site.base,{locale:'zh-CN'});try{const r=await page.evaluate(async()=>{const{createStore}=await import('./js/state.js');const{createAgent}=await import('./js/agent.js');const{mountUI}=await import('./js/ui.js?v=2026.10.11.1');const s=createStore();s.state.apiKey='sk-QA-fake';s.state.messages=[];let status='streaming';const a=createAgent(s);a.getStatus=()=>status;const ui=mountUI(s,a);s.pushMessage({role:'user',text:'Question'});const m=s.pushMessage({role:'assistant',model:'gpt-5.6-sol',text:'Before\n:::choice 需要我接着做什么？\n\n- 出分镜表\n- 查BGM版权\n- 处理字幕 :::\nAfter',done:false});ui.onAssistantStart(m);ui.onDelta(m,m.text);const before=document.querySelectorAll('.choice-box').length;s.updateMessage(m.id,{done:true});ui.onAssistantDone(m);status='done';ui.setStatus('done');await new Promise(r=>setTimeout(r,70));const count=document.querySelectorAll('.choice-opt').length;return{before,count,html:document.getElementById('messages').innerHTML};});assert.equal(r.before,0);assert.equal(r.count,3);assert.ok(r.html.indexOf('Before')<r.html.indexOf('choice-box'));assert.ok(r.html.indexOf('choice-box')<r.html.indexOf('After'));}finally{await context.close();}});
  await t.test('a real Agent exposes a public plan before its actual first tool without adding a planning network request',async()=>{const{context,page}=await openPage(browser,site.base,{locale:'zh-CN'});try{const r=await page.evaluate(async()=>{const{createStore}=await import('./js/state.js');const{createAgent}=await import('./js/agent.js');const{mountUI}=await import('./js/ui.js?v=2026.10.11.1');const s=createStore();s.state.apiKey='sk-QA-fake';s.state.model='gpt-5.6-sol';Object.assign(s.state.settings,{jevEnabled:false,webEnabled:false,thinking:false,contentModeration:false});s.state.messages=[];const old=fetch;let requests=0,ui,plannedBeforeTool=false;window.fetch=async(u,o)=>{if(String(u).includes('/v1/chat/completions')){requests++;const tc=requests===1?{tool_calls:[{index:0,id:'x',type:'function',function:{name:'evaluate_expression',arguments:'{"expression":"1+1"}'}}]}:{content:'The result is 2.'};return new Response('data: '+JSON.stringify({choices:[{delta:tc,finish_reason:requests===1?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});}return old(u,o);};try{const a=createAgent(s,{onStatus:x=>ui?.setStatus(x),onUserMessage:(_,m)=>ui?.onUserMessage(m),onAssistantStart:m=>ui?.onAssistantStart(m),onDelta:(m,x)=>ui?.onDelta(m,x),onToolDelta:m=>ui?.onToolDelta(m),onAssistantDone:m=>ui?.onAssistantDone(m),onToolStart:c=>{plannedBeforeTool=!!document.querySelector('.public-task-plan');ui?.onToolStart(c);},onToolResult:(c,r)=>ui?.onToolResult(c,r),onToolEvent:(c,p)=>ui?.onToolEvent(c,p)});ui=mountUI(s,a);await a.send('请计算并验证1+1，说明方法');await new Promise(r=>setTimeout(r,150));return{requests,plannedBeforeTool,plans:s.state.messages.filter(m=>m.publicPlan).length,text:document.getElementById('messages').textContent};}finally{window.fetch=old;}});assert.equal(r.requests,2);assert.equal(r.plans,1);assert.equal(r.plannedBeforeTool,true);assert.ok(r.text.includes('任务方向')&&r.text.includes('计划'));}finally{await context.close();}});
  await t.test('project knowledge is fetched locally on demand with current cache stamp and bounded relevant output',async()=>{const{context,page}=await openPage(browser,site.base);try{const r=await page.evaluate(async()=>{const{executeTool}=await import('./js/tools.js');const{createFS}=await import('./js/sandbox.js');return executeTool('knowledge_search',{query:'chart map syntax',topic:'rendering',language:'en'},{fs:createFS(),onUi(){}});});assert.ok(r.includes(':::chart')&&r.includes(':::choice'));assert.ok(r.length<=7500);}finally{await context.close();}});
  await t.test('caret visibly changes computed colors without changing draft/selection and stops when unfocused',async()=>{const{context,page}=await openPage(browser,site.base,{main:true,init:fakeKey});try{await page.waitForFunction(()=>!document.getElementById('boot-screen'));await page.fill('#composer-input','preserve text');await page.evaluate(()=>{const c=document.getElementById('composer-input');c.setSelectionRange(3,3);document.documentElement.dataset.motion='on';});const a=await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor);await page.waitForTimeout(1400);const b=await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor);assert.notEqual(a,b);assert.equal(await page.inputValue('#composer-input'),'preserve text');assert.equal(await page.locator('#composer-input').evaluate(n=>n.selectionStart),3);await page.locator('#composer-input').blur();const color=await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor);await page.waitForTimeout(550);assert.equal(await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor),color);}finally{await context.close();}});
  await t.test('Ultra gradient is visible without a negative-z pseudo layer and respects no-motion',async()=>{const{context,page}=await openPage(browser,site.base,{main:true,init:fakeKey});try{await page.waitForFunction(()=>!document.getElementById('boot-screen'));await page.click('#thinking-toggle');await page.locator('[data-think="ultra"]').click();const r=await page.locator('#thinking-toggle').evaluate(n=>({bg:getComputedStyle(n).backgroundImage,pseudo:getComputedStyle(n,'::before').display}));assert.ok(r.bg.includes('linear-gradient'));assert.equal(r.pseudo,'none');await page.evaluate(()=>document.documentElement.dataset.motion='off');assert.equal(await page.locator('#thinking-toggle').evaluate(n=>getComputedStyle(n).animationName),'none');}finally{await context.close();}});
  await t.test('reduced-motion device can open film and return only after explicit skip, with no mobile nav overflow',async()=>{const context=await browser.newContext({locale:'en-US',viewport:{width:390,height:844},reducedMotion:'reduce'});const p=await context.newPage();try{await p.goto(site.base+'/index.html');await p.waitForFunction(()=>document.documentElement.classList.contains('gate'));assert.equal(await p.locator('#gate').isVisible(),true);await p.locator('#gate .explore-cta').click();await p.waitForFunction(()=>document.documentElement.classList.contains('scoring'));assert.equal(await p.locator('#stage').isVisible(),true);await p.waitForTimeout(800);assert.equal(await p.locator('html').evaluate(n=>n.classList.contains('open')),false);await p.click('#film-skip');await p.waitForFunction(()=>document.documentElement.classList.contains('open'));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);}finally{await context.close();}});
  await t.test('missing IntersectionObserver still reveals text and sparse navigation fits 320px',async()=>{const context=await browser.newContext({locale:'en-US',viewport:{width:320,height:780}});await context.addInitScript(()=>{window.IntersectionObserver=undefined;});const p=await context.newPage();try{await p.goto(site.base+'/index.html?view=nav');await p.waitForFunction(()=>document.documentElement.classList.contains('open'));await p.locator('#capabilities h2').scrollIntoViewIfNeeded();await p.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#capabilities h2')).opacity)===1,null,{timeout:4000});const h=p.locator('#capabilities h2');assert.equal(await h.evaluate(n=>Number(getComputedStyle(n).opacity)),1);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.equal(await p.locator('#whats-new').count(),0);assert.ok(await p.locator('.nav-focus a:visible').count()<=2);}finally{await context.close();}});
  await t.test('English interface leaves no Chinese chrome text and no clipped buttons',async()=>{
   const{context,page}=await openPage(browser,site.base,{main:true,locale:'en-US',width:1280,init:()=>{localStorage.setItem('dubhe-ui-language','en');localStorage.setItem('dubhe-agent-state-v1',JSON.stringify({apiKey:'sk-teamo-QA-fake-xxxxxxxxxxxxxxxx',settings:{theme:'light'}}));}});
   try{
    await page.waitForFunction(()=>!document.getElementById('boot-screen'));
    const audit=async(label)=>{
     const r=await page.evaluate(()=>{
      const cjk=[];
      const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      let n;while((n=walk.nextNode())){const t=(n.nodeValue||'').trim();if(!t||!/[\u4e00-\u9fff]/.test(t))continue;const p=n.parentElement;if(!p)continue;
       // 语言选择器里「中文 / English」各自用母语书写，是有意为之，不算漏翻
       if(p.closest('.md-body,.chip-detail,textarea,pre,code,[data-i18n-ignore],.share-row-text,.session-title,.sess-title,#set-language'))continue;
       const st=getComputedStyle(p);if(st.display==='none'||st.visibility==='hidden')continue;cjk.push(t.slice(0,32));}
      const clipped=[...document.querySelectorAll('button:not([hidden]),select')].filter((el)=>{const rc=el.getBoundingClientRect();if(rc.width<2||rc.height<2)return false;const st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden')return false;return el.scrollWidth>el.clientWidth+2;}).map((el)=>el.id||el.className);
      return{cjk,clipped};});
     assert.deepEqual(r.cjk,[],`${label}：英文界面仍出现中文`);
     assert.deepEqual(r.clipped,[],`${label}：按钮文字被撑出容器`);
    };
    await audit('空状态');
    await page.click('#settings-btn');await page.waitForTimeout(300);await audit('设置面板');
    for(const sel of['#set-vision-model','#set-video-model','#set-image-model']){const noCjk=await page.evaluate(async(s)=>{const opts=[...document.querySelector(s).options].map(o=>o.textContent);return opts.filter((t)=>/[\u4e00-\u9fff]/.test(t));},sel);assert.deepEqual(noCjk,[],`${sel} 的档位文案仍有中文`);}
    await page.click('#settings-done');
   }finally{await context.close();}
  });
  await t.test('stopped turn keeps its actions and stop marker at the very end of the answer',async()=>{
   const seed=()=>localStorage.setItem('dubhe-agent-state-v1',JSON.stringify({apiKey:'sk-teamo-QA-fake-xxxxxxxxxxxxxxxx',settings:{theme:'light'},messages:[
    {id:'u1',role:'user',text:'把这段歌词的级进改成 ±1 半音并验证'},
    {id:'a1',role:'assistant',model:'gpt-5.6-sol',done:true,cancelled:true,text:'先核验当前文件状态，再重试一次执行：文件内容正确（级进已改为 ±1 半音）。重试执行：',
     outputOrder:[{kind:'text',start:0,end:14},{kind:'tools',indices:[0]},{kind:'text',start:14,end:40},{kind:'tools',indices:[1]}],
     toolCalls:[{id:'c1',name:'read_file',args:{path:'lyrics.py'},status:'ok'},{id:'c2',name:'execute_javascript',args:{code:'x'},status:'cancelled',cancelled:true}]}]}));
   const{context,page}=await openPage(browser,site.base,{main:true,locale:'zh-CN',width:900,init:seed});
   try{
    await page.waitForFunction(()=>!document.getElementById('boot-screen'));
    await page.waitForSelector('.msg-assistant > .message-tail');
    // 正文分段 + 工具穿插：动作条必须在整条回答之后，不能夹在中间（用户截图里的错位）
    const layout=await page.evaluate(()=>{const w=document.querySelector('.msg-assistant');const kids=[...w.children];const bar=w.querySelector(':scope > .msg-toolbar');const tail=w.querySelector(':scope > .message-tail');const chips=[...w.querySelectorAll('.tool-chips')].pop();return{last:kids.at(-1).className.indexOf('msg-toolbar')>=0,tailBeforeBar:tail.nextElementSibling===bar,barBefore:bar.previousElementSibling===tail,afterChips:chips.getBoundingClientRect().bottom<=bar.getBoundingClientRect().top+2,tails:w.querySelectorAll('.cancelled-tag').length,rows:[...w.querySelectorAll(':scope > .assistant-flow > *')].length};});
    assert.equal(layout.last,true,'动作条应是该条回答的最后一个元素');
    assert.equal(layout.tailBeforeBar,true,'「已停止」标记应紧贴在动作条上方');
    assert.equal(layout.afterChips,true,'动作条应排在全部工具芯片之后');
    assert.equal(layout.tails,1);
    assert.ok(layout.rows>=4,'分段的正文与工具块都应保留');
   }finally{await context.close();}
  });
  await t.test('language switch fades briefly, settles without leftover class, and skips under motion off',async()=>{
   const{context,page}=await openPage(browser,site.base,{main:true,init:fakeKey});
   try{
    await page.waitForFunction(()=>!document.getElementById('boot-screen'));
    await page.click('#settings-btn');
    await page.locator('#set-language').selectOption('zh');
    const during=await page.evaluate(()=>({cls:document.documentElement.classList.contains('lang-switching'),lang:document.documentElement.lang}));
    assert.equal(during.cls,true,'切换瞬间应进入过渡状态');
    await page.waitForTimeout(700);
    const after=await page.evaluate(()=>({cls:document.documentElement.className,op:getComputedStyle(document.body).opacity,lang:document.documentElement.lang}));
    assert.equal(/lang-switching/.test(after.cls),false,'过渡状态必须清掉，不能卡在过渡里');
    assert.equal(after.lang,'zh-CN');
    // 关掉设置面板后，页面不能因为过渡残留而半透明
    await page.click('#settings-done');await page.waitForTimeout(400);
    assert.equal(Number(await page.evaluate(()=>getComputedStyle(document.body).opacity)),1);
    // 关掉动效后不再做淡入淡出
    await page.locator('#set-motion button[data-motion=off],#set-motion [data-value=off]').first().click().catch(()=>{});
    await page.evaluate(()=>{document.documentElement.dataset.motion='off';});
    await page.locator('#set-language').selectOption('en');
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).opacity),'1');
   }finally{await context.close();}
  });
  await t.test('feedback marks state by colour only, toggles back, and adds no toast',async()=>{
   const{context,page}=await openPage(browser,site.base,{main:true,init:()=>localStorage.setItem('dubhe-agent-state-v1',JSON.stringify({apiKey:'sk-teamo-QA-fake-xxxxxxxxxxxxxxxx',settings:{theme:'light'},messages:[{id:'u',role:'user',text:'q'},{id:'a',role:'assistant',model:'gpt-5.6-sol',text:'正常回答',done:true,finishReason:'stop',execution:{state:'COMMITTED'},ts:Date.now()}]}))});
   try{
    await page.waitForFunction(()=>!document.getElementById('boot-screen'));
    await page.waitForSelector('.feedback-btn[data-vote=up]');
    const toasts=await page.locator('.toasts > .toast').count();
    await page.mouse.move(2,2);
    const idle=await page.locator('.feedback-btn[data-vote=up]').evaluate(n=>getComputedStyle(n).backgroundColor);
    await page.click('.feedback-btn[data-vote=up]');
    await page.mouse.move(2,2);
    await page.waitForTimeout(320);
    const on=await page.locator('.feedback-btn[data-vote=up]').evaluate(n=>({bg:getComputedStyle(n).backgroundColor,color:getComputedStyle(n).color}));
    assert.equal(await page.locator('.feedback-btn[data-vote=up]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.toasts > .toast').count(),toasts,'点赞只靠颜色/特效提示，不再弹 toast');
    assert.notEqual(on.bg,idle,'按下后必须看得出来（颜色变化）');
    await page.click('.feedback-btn[data-vote=up]');
    await page.mouse.move(2,2);
    await page.waitForTimeout(320);
    assert.equal(await page.locator('.feedback-btn[data-vote=up]').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('.feedback-btn[data-vote=up]').evaluate(n=>getComputedStyle(n).backgroundColor),idle);
   }finally{await context.close();}
  });
  await t.test('caret rainbow pauses during IME composition, never writes inline caretColor, and stops on blur',async()=>{
   const{context,page}=await openPage(browser,site.base,{main:true,init:fakeKey});
   try{
    await page.waitForFunction(()=>!document.getElementById('boot-screen'));
    await page.fill('#composer-input','保留草稿');
    await page.click('#composer-input');
    await page.evaluate(()=>{const c=document.getElementById('composer-input');c.setSelectionRange(2,2);document.documentElement.dataset.motion='on';});
    const a=await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor);
    await page.waitForTimeout(1400);
    const b=await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor);
    assert.notEqual(a,b,'彩虹光标应随时间变色');
    assert.equal(await page.locator('#composer-input').evaluate(n=>/caret/i.test(n.getAttribute('style')||'')),false,'不得用行内样式写 caretColor（会互相打架且重置原生闪烁）');
    // 输入法拼字期间：暂停变色，草稿与选区不受影响
    await page.evaluate(()=>{const c=document.getElementById('composer-input');c.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#composer-input').evaluate(n=>n.classList.contains('caret-rainbow-paused')),true,'拼字时应暂停彩虹动画');
    const held=await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor);
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor),held,'暂停期间颜色不再跳');
    await page.evaluate(()=>{const c=document.getElementById('composer-input');c.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
    assert.equal(await page.locator('#composer-input').evaluate(n=>n.classList.contains('caret-rainbow-paused')),false);
    assert.equal(await page.inputValue('#composer-input'),'保留草稿');
    await page.locator('#composer-input').blur();
    const off=await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#composer-input').evaluate(n=>getComputedStyle(n).caretColor),off,'失焦后光标不再变色');
   }finally{await context.close();}
  });
  await t.test('image-review row hides when local checks are off and returns when back on',async()=>{
   const{context,page}=await openPage(browser,site.base,{main:true,init:fakeKey});
   try{
    await page.waitForFunction(()=>!document.getElementById('boot-screen'));
    await page.click('#settings-btn');
    assert.equal(await page.locator('#row-image-review').isVisible(),true);
    await page.locator('label.sw:has(#set-moderation)').click();
    assert.equal(await page.locator('#moderation-risk-modal').getAttribute('class'),'modal open');
    // 关审核弹窗的两个按钮之间要有间距（第 5 条）
    const gaps=await page.evaluate(()=>[document.querySelector('#moderation-risk-modal .modal-actions'),document.querySelector('#share-modal .modal-actions')].map((n)=>{const cs=getComputedStyle(n);return{n:!!n,gap:parseFloat(cs.columnGap||cs.gap||'0')};}));
    gaps.forEach((g)=>assert.ok(g.n&&g.gap>=8,`底部按钮间距应 ≥8px（实测 ${g.gap}）`));
    await page.locator('#share-close').click().catch(()=>{});
    await page.locator('#moderation-risk-ack').check();
    await page.click('#moderation-risk-confirm');
    assert.equal(await page.locator('#set-moderation').isChecked(),false);
    assert.equal(await page.locator('#row-image-review').isVisible(),false,'关闭审核后不应再显示灰区远程复核设置');
    await page.locator('label.sw:has(#set-moderation)').click();
    assert.equal(await page.locator('#row-image-review').isVisible(),true);
   }finally{await context.close();}
  });
  await t.test('documentation current overview and folded stages are bilingual and preserve archive access',async()=>{const context=await browser.newContext({locale:'en-US',viewport:{width:390,height:844}});const p=await context.newPage();try{await p.goto(site.base+'/docs.html');await p.waitForFunction(()=>document.documentElement.lang==='en');assert.ok(await p.locator('[data-doc-language=en] .release-archive').count()>=3);await p.locator('[data-doc-language=en] .release-archive').first().locator('summary').click();assert.equal(await p.locator('[data-doc-language=en] .release-archive').first().evaluate(n=>n.open),true);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);}finally{await context.close();}});
 }finally{await browser.close();}
});}finally{await site.close();}
