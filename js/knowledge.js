import { APP_VERSION } from './config.js?v=2026.10.11.1';
import { getLanguage } from './locale.js';

export const KNOWLEDGE_MAX_CHARS = 7500;
const cache = new Map();
const CJK_RUN = /[\u3400-\u9fff]+/g;
const LATIN_WORD = /[a-z0-9_]+/g;

export function knowledgeTokens(value) {
  const source = String(value || '').toLowerCase();
  const tokens = new Set(source.match(LATIN_WORD) || []);
  for (const run of source.match(CJK_RUN) || []) {
    tokens.add(run);
    // Chinese has no whitespace token boundaries. Keep overlapping bigrams and
    // trigrams as well as the complete run so both phrase and partial queries hit.
    for (const width of [2, 3]) {
      for (let i = 0; i + width <= run.length; i += 1) tokens.add(run.slice(i, i + width));
    }
  }
  return [...tokens];
}

function oneTypoApart(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (left.length === right.length) {
      // Treat one adjacent transposition as one fuzzy-search typo.
      if (left[i] === right[j + 1] && left[i + 1] === right[j]) { i += 2; j += 2; continue; }
      i += 1; j += 1;
    } else if (left.length > right.length) i += 1;
    else j += 1;
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

function fuzzyLatinHit(token, words) {
  if (!/^[a-z0-9_]{4,}$/.test(token)) return false;
  for (const word of words) {
    if (Math.abs(word.length - token.length) <= 1 && oneTypoApart(token, word)) return true;
  }
  return false;
}

function passageScore(text, tokens, latinWords = new Set(String(text || '').toLowerCase().match(LATIN_WORD) || [])) {
  const normalized = String(text || '').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) score += 2;
    else if (fuzzyLatinHit(token, latinWords)) score += 1;
  }
  return score;
}

function splitSections(content) {
  const sections = [];
  let lines = [];
  for (const line of String(content || '').split('\n')) {
    if (/^#{1,3}\s+/.test(line) && lines.length) {
      sections.push(lines.join('\n').trim());
      lines = [line];
    } else lines.push(line);
  }
  if (lines.length) sections.push(lines.join('\n').trim());
  return sections.filter(Boolean);
}

function relevantContent(record, tokens) {
  const content = String(record.content || '');
  if (!tokens.length) return content;
  const sections = splitSections(content).map((text, index) => ({ text, index, score: passageScore(text, tokens) }));
  const matches = sections.filter((section) => section.score > 0);
  if (!matches.length) return content;
  // Return matching sections, not an arbitrary prefix of a long article.
  return matches.sort((a, b) => a.index - b.index).map((section) => section.text).join('\n\n');
}

function scoreRecord(record, tokens) {
  if (!tokens.length) return { ...record, score: 0 };
  const title = `${record.title || ''} ${record.tags || ''}`.toLowerCase();
  const body = String(record.content || '').toLowerCase();
  const titleWords = new Set(title.match(LATIN_WORD) || []);
  const bodyWords = new Set(body.match(LATIN_WORD) || []);
  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 8;
    else if (fuzzyLatinHit(token, titleWords)) score += 5;
    if (body.includes(token)) score += 2;
    else if (fuzzyLatinHit(token, bodyWords)) score += 1;
  }
  return { ...record, score };
}

export function searchKnowledge(index, { query = '', topic = '', language = getLanguage(), offset = 0, maxChars = KNOWLEDGE_MAX_CHARS } = {}) {
  const tokens = knowledgeTokens(query).slice(0, 80);
  const limit = Math.min(KNOWLEDGE_MAX_CHARS, Math.max(500, Number(maxChars) || KNOWLEDGE_MAX_CHARS));
  const records = (index?.records || []).filter((record) => record.language === language && (!topic || record.topic === topic));
  const ranked = records.map((record) => scoreRecord(record, tokens))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const best = ranked.filter((record) => !tokens.length || record.score > 0).slice(0, 3);
  if (!best.length) return language === 'en'
    ? 'No matching built-in knowledge. Try a topic or different keywords.'
    : '未找到匹配的内置知识，请换关键词或指定主题。';

  let out = '[Built-in project knowledge; runtime capability masks and core instructions remain authoritative]\n';
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  for (const record of best) {
    const available = limit - out.length - 250;
    if (available <= 0) break;
    const relevant = relevantContent(record, tokens);
    const chunk = relevant.slice(start, start + available);
    out += `\n## ${record.title} [${record.id}]\n${chunk}\n${start + chunk.length < relevant.length
      ? `[continued: offset=${start + chunk.length}; topic=${record.topic}]`
      : ''}`;
  }
  return out.slice(0, limit);
}

export async function retrieveKnowledge(args = {}, { signal } = {}) {
  const language = ['zh', 'en'].includes(args.language) ? args.language : getLanguage();
  const url = new URL('../assets/knowledge/index.json', import.meta.url);
  url.searchParams.set('v', APP_VERSION);
  if (!cache.has(url.href)) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 8000);
    const abort = () => timeout.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) timeout.abort();
    cache.set(url.href, fetch(url, { signal: timeout.signal })
      .then((response) => {
        if (!response.ok) throw Error('Built-in knowledge HTTP ' + response.status);
        return response.json();
      })
      .catch((error) => { cache.delete(url.href); throw error; })
      .finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); }));
  }
  const index = await cache.get(url.href);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return searchKnowledge(index, { ...args, language });
}
