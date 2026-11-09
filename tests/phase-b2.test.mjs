// 2026-11-08 第二批：会话网关恢复、Cloudflare 标签/用量、搜索行名、容量上限、对话模式裸聊接线。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import worker from '../workers-ai/worker.js';
import { cfModelTags, cfModelCard } from '../js/cloudflare-ai-catalog.js';
import { webGroupLabel } from '../js/ui-toolflow.js';
import { ATTACHMENT_MAX_BYTES } from '../js/attachment-limits.js';
import { MAX_SINGLE_GGUF_BYTES } from '../js/offline-model-config.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const chatRequest = () => new Request('https://x.workers.dev/v1/chat/completions', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model: '@cf/openai/gpt-oss-20b', messages: [{ role: 'user', content: 'hi' }] }),
});

test('删除会话不再回滚当前会话的网关 / 模型选择', async () => {
  const dom = new JSDOM('', { url: 'https://example.test' });
  const prev = globalThis.localStorage;
  globalThis.localStorage = dom.window.localStorage;
  try {
    const { createStore } = await import('../js/state.js?b2=' + Date.now());
    const { DEFAULT_CHAT_MODEL } = await import('../js/config.js?v=2026.10.25.1');
    const store = createStore();
    const a = store.state.activeSessionId;
    const sa = store.state.sessions.find((s) => s.id === a);
    sa.gatewayId = 'cloudflare'; sa.model = '@cf/openai/gpt-oss-20b';
    store.state.gatewayId = 'cloudflare'; store.state.model = '@cf/openai/gpt-oss-20b';
    const b = store.createSession();
    const sb = store.state.sessions.find((s) => s.id === b.id);
    sb.gatewayId = 'teamorouter'; sb.model = DEFAULT_CHAT_MODEL;
    store.state.gatewayId = 'teamorouter'; store.state.model = DEFAULT_CHAT_MODEL;
    store.switchSession(a);
    assert.equal(store.state.gatewayId, 'cloudflare', '切回 A 应恢复 A 的网关');
    // 当前会话里刚换了网关（尚未 commit），此时删除另一条会话：修复前 hydrate 会把选择回滚。
    store.state.gatewayId = 'teamorouter'; store.state.model = DEFAULT_CHAT_MODEL;
    assert.equal(store.deleteSession(b.id), true);
    assert.equal(store.state.gatewayId, 'teamorouter', '删除后当前会话的网关必须保留');
    assert.equal(store.state.model, DEFAULT_CHAT_MODEL);
  } finally {
    if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev;
    dom.window.close();
  }
  assert.match(read('js/state.js'), /deleteSession\(id\) \{[\s\S]{0,400}commit\(\);/);
});

test('Cloudflare 模型标签只有「流行 / 低价」，且经 /v1/models 下发', async () => {
  for (const id of Object.keys((await import('../js/cloudflare-ai-catalog.js')).CF_CHAT_MODELS)) {
    const tags = cfModelTags(id);
    assert.ok(tags.every((t) => t === 'popular' || t === 'cheap'), `${id} 出现了不允许的标签 ${tags}`);
    assert.deepEqual(cfModelCard(id).tags, tags);
  }
  assert.ok(cfModelTags('@cf/openai/gpt-oss-20b').includes('popular'));
  assert.ok(cfModelTags('@cf/meta/llama-3.2-1b-instruct').includes('cheap'));
  const res = await worker.fetch(new Request('https://x.workers.dev/v1/models'), { env: {} });
  const list = (await res.json()).data;
  assert.ok(list.length > 3);
  assert.ok(list.every((m) => Array.isArray(m.tags) && m.tags.every((t) => ['popular', 'cheap'].includes(t))));
  const picker = read('js/ui-model-picker.js');
  assert.doesNotMatch(picker, /badge cf-agent|badge cf-chat/);
  assert.match(picker, /localeText\('流行', 'Popular'\)/);
  assert.match(picker, /localeText\('低价', 'Cheap'\)/);
});

test('Workers AI 用量完整：最后一个 SSE chunk 带规范化 usage', async () => {
  const env = { AI: { run: async () => ({ response: 'ok', usage: { prompt_tokens: 11, completion_tokens: 7 } }) } };
  const text = await (await worker.fetch(chatRequest(), env)).text();
  const chunks = text.split('\n\n').filter((x) => x.startsWith('data: ') && x !== 'data: [DONE]').map((x) => JSON.parse(x.slice(6)));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].usage, undefined, '正文 chunk 不带 usage，避免重复累计');
  assert.deepEqual(chunks[1].usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  assert.equal(chunks[1].choices.length, 0);
  // 上游完全不返回 usage 时用输出长度估算并标注
  const noUsage = { AI: { run: async () => ({ response: 'a'.repeat(40) }) } };
  const text2 = await (await worker.fetch(chatRequest(), noUsage)).text();
  const tail = JSON.parse(text2.split('\n\n').filter((x) => x.startsWith('data: ') && x !== 'data: [DONE]')[1].slice(6));
  assert.equal(tail.usage.estimated, true);
  assert.equal(tail.usage.total_tokens, tail.usage.prompt_tokens + tail.usage.completion_tokens);
  assert.match(read('workers-ai/worker.js'), /function normaliseUsage/);
});

test('「Searched for」不再出现空标题，行名改为 Web search', () => {
  const rows = [{ id: '1', name: 'search_web', summary: 'tangut font', status: 'ok' }];
  assert.equal(webGroupLabel(rows, false), 'Searched for tangut font');
  assert.equal(webGroupLabel(rows, true), 'Searching for tangut font');
  assert.equal(webGroupLabel([{ name: 'search_web', summary: '' }], false), 'Searched the web');
  assert.equal(webGroupLabel([{ name: 'search_web' }, { name: 'search_web' }], false), 'Searched for 2 queries');
  assert.match(read('js/ui.js'), /search_web: \['Web search', 'Searching'\]/);
});

test('容量：模型 16 GiB、附件 128 MiB，本地推理不再指定 max_tokens', () => {
  assert.equal(MAX_SINGLE_GGUF_BYTES, 16 * 1024 ** 3);
  assert.equal(ATTACHMENT_MAX_BYTES, 128 * 1024 * 1024);
  assert.doesNotMatch(read('js/offline-model.js'), /max_tokens:/);
  assert.match(read('js/offline-model.js'), /不传 max_tokens/);
  for (const rel of ['js/ui-attachments.js', 'js/audio-format.js', 'js/net.js', 'js/tools.js', 'js/video-gen.js', 'js/document-tools.js', 'js/ui-files-panel.js', 'app.html']) {
    assert.doesNotMatch(read(rel), /16MB|16 MB|<2 GiB/, `${rel} 还残留旧上限`);
  }
});
