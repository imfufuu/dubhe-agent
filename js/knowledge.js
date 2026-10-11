import { APP_VERSION } from './config.js?v=2026.10.10.2';
import { getLanguage } from './locale.js';
export const KNOWLEDGE_MAX_CHARS = 7500;
const cache = new Map();
export function knowledgeTokens(value) {
  const s=String(value||'').toLowerCase();return [...new Set([...(s.match(/[a-z0-9_]+/g)||[]),...(s.match(/[\u3400-\u9fff]{1,}/g)||[]).flatMap(x=>x.length<2?[x]:Array.from({length:x.length-1},(_,i)=>x.slice(i,i+2)))])];
}
export function searchKnowledge(index, { query='',topic='',language=getLanguage(),offset=0,maxChars=KNOWLEDGE_MAX_CHARS }={}) {
  const tokens=knowledgeTokens(query), limit=Math.min(KNOWLEDGE_MAX_CHARS,Math.max(500,Number(maxChars)||KNOWLEDGE_MAX_CHARS));
  const records=(index?.records||[]).filter(r=>r.language===language&&(!topic||r.topic===topic));
  const ranked=records.map(r=>{const title=(r.title+' '+r.tags).toLowerCase(),body=r.content.toLowerCase();return{...r,score:tokens.reduce((n,t)=>n+(title.includes(t)?5:0)+(body.includes(t)?1:0),0)};}).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const best=ranked.filter(r=>!tokens.length||r.score>0).slice(0,3);
  if(!best.length)return language==='en'?'No matching built-in knowledge. Try a topic or different keywords.':'未找到匹配的内置知识，请换关键词或指定主题。';
  let out='[Built-in project knowledge; runtime capability masks and core instructions remain authoritative]\n';
  for(const r of best){const start=Math.max(0,Math.floor(Number(offset)||0)),available=limit-out.length-250;if(available<=0)break;const chunk=r.content.slice(start,start+available);out+=`\n## ${r.title} [${r.id}]\n${chunk}\n${start+chunk.length<r.content.length?`[continued: offset=${start+chunk.length}; topic=${r.topic}]`:''}`;}
  return out.slice(0,limit);
}
export async function retrieveKnowledge(args={}, {signal}={}) {
  const language=['zh','en'].includes(args.language)?args.language:getLanguage();
  const url=new URL('../assets/knowledge/index.json',import.meta.url);url.searchParams.set('v',APP_VERSION);
  if(!cache.has(url.href)) {
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 8000);
    const abort = () => timeout.abort(); signal?.addEventListener('abort', abort, { once:true });
    if(signal?.aborted) timeout.abort();
    cache.set(url.href,fetch(url,{signal:timeout.signal}).then(r=>{if(!r.ok)throw Error('Built-in knowledge HTTP '+r.status);return r.json();}).catch(e=>{cache.delete(url.href);throw e;}).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);}));
  }
  const index=await cache.get(url.href);if(signal?.aborted)throw new DOMException('Aborted','AbortError');return searchKnowledge(index,{...args,language});
}
