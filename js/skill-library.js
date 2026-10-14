// Extension skills are a separate, lazy library. Neither this module nor the
// system prompt imports skill bodies; the Agent explicitly searches/reads them.
import { getLanguage } from './locale.js';
import { knowledgeTokens } from './knowledge.js?v=2026.10.11.1';
const stored = new Map();
const BASE = new URL('../assets/skills/', import.meta.url);
export const SKILL_PAGE_CHARS = 6500;
async function asset(name, signal, json = false) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (stored.has(name)) return stored.get(name);
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 8000);
  try {
    const response = await fetch(new URL(name, BASE), { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw Error('Skill library HTTP ' + response.status);
    const result = json ? await response.json() : await response.text();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    stored.set(name, result); return result;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function searchSkills(records, query = '', language = 'zh') {
  const tokens = knowledgeTokens(String(query).slice(0, 300));
  return records.map(record => {
    const haystack = [record.id, record.title.zh, record.title.en, record.summary.zh, record.summary.en, record.tags].join(' ').toLowerCase();
    return { record, score: tokens.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0) };
  }).filter(r => !tokens.length || r.score > 0).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id)).slice(0, 12)
    .map(({ record }) => ({ id: record.id, title: record.title[language] || record.title.zh, summary: record.summary[language] || record.summary.zh, tools: record.tools }));
}
export async function retrieveSkill(args = {}, { signal } = {}) {
  const language = getLanguage() === 'en' ? 'en' : 'zh';
  const index = await asset('index.json', signal, true);
  if (!Array.isArray(index.skills)) throw Error('Invalid skill library index');
  if (!args.action || args.action === 'search') return JSON.stringify({ skills: searchSkills(index.skills, args.query, language), next: 'Use skill_library(action="read", id="...") for one guide. Runtime tool permissions remain authoritative.' }, null, 2);
  if (args.action !== 'read') throw Error('skill_library action must be search or read');
  const id = String(args.id || '');
  if (!/^[a-z0-9-]{1,64}$/.test(id) || !index.skills.some(s => s.id === id)) throw Error('Unknown skill ID; search the library first');
  const body = await asset(`${id}.${language}.md`, signal);
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0)), end = offset + SKILL_PAGE_CHARS;
  return `[Built-in extension skill: ${id}; only requested content loaded]\n${body.slice(offset, end)}${end < body.length ? `\n[Continue: skill_library action=read id=${id} offset=${end}]` : '\n[End of skill]'} `;
}
