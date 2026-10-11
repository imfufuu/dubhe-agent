export const CARET_COLORS = Object.freeze(['#ef4444','#eab308','#3b82f6','#22c55e','#06b6d4','#2563eb','#a855f7']);
export function caretColorAt(ms) { return CARET_COLORS[Math.floor(Math.max(0,Number(ms)||0)/360)%CARET_COLORS.length]; }
export function installCaretEffect(input, { win = window, doc = document }={}) {
  if(!input)return {stop(){}};let timer=0,start=0;
  const animated=()=>doc.documentElement.dataset.motion==='on'||doc.documentElement.dataset.motion!=='off'&&!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const stop=()=>{if(timer)win.clearInterval(timer);timer=0;};
  const paint=()=>{input.style.caretColor=caretColorAt(animated()?win.performance.now()-start:0);input.dataset.caretEffect='rainbow';};
  const begin=()=>{stop();start=win.performance.now();paint();if(animated())timer=win.setInterval(paint,120);};
  input.addEventListener('focus',begin);input.addEventListener('blur',stop);input.addEventListener('input',paint);
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)stop();else if(doc.activeElement===input)begin();});
  new win.MutationObserver(()=>{if(doc.activeElement===input)begin();}).observe(doc.documentElement,{attributes:true,attributeFilter:['data-motion']});
  input.style.caretColor=CARET_COLORS[0];return {stop};
}
