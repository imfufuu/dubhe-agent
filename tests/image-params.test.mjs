// 生图官方参数接入的回归测试：只发送模型支持的字段，并用桩 fetch 捕获请求体，不访问真实网关。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateImage } from '../js/api.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function stubFetch() {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body });
    return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('GPT Image：moderation / output_compression 按官方规则发送，非法或不适用时省略', async () => {
  const s = stubFetch();
  try {
    await generateImage({ model: 'gpt-image-2', apiKey: 'k', prompt: 'p', format: 'jpeg', moderation: 'low', outputCompression: 80, n: 3 });
    const b = JSON.parse(s.calls[0].body);
    assert.equal(b.moderation, 'low');
    assert.equal(b.output_compression, 80);
    assert.equal(b.n, 3);
    await generateImage({ model: 'gpt-image-2', apiKey: 'k', prompt: 'p', format: 'png', moderation: 'auto', outputCompression: 80 });
    const c = JSON.parse(s.calls[1].body);
    assert.equal(c.moderation, undefined, 'auto 不发送');
    assert.equal(c.output_compression, undefined, 'png 不接受 output_compression');
  } finally { s.restore(); }
});

test('GPT Image：n 官方上限为 10，超出时截断为 10', async () => {
  const s = stubFetch();
  try {
    await generateImage({ model: 'gpt-image-2', apiKey: 'k', prompt: 'p', n: 25 });
    assert.equal(JSON.parse(s.calls[0].body).n, 10);
  } finally { s.restore(); }
});

function stubGemini() {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('Nano Banana：thinking_level 只发送该模型表内的取值', async () => {
  const s = stubGemini();
  try {
    await generateImage({ model: 'gemini-nano-banana-2.1', apiKey: 'k', prompt: 'p', gatewayId: 'gemini', thinkingLevel: 'medium' });
    assert.equal(JSON.parse(s.calls[0].body).generationConfig.thinkingConfig.thinkingLevel, 'medium');
    await generateImage({ model: 'gemini-3.1-flash-image', apiKey: 'k', prompt: 'p', gatewayId: 'gemini', thinkingLevel: 'medium' });
    assert.equal(JSON.parse(s.calls[1].body).generationConfig.thinkingConfig, undefined, '3.1 Flash 不支持 medium');
    await generateImage({ model: 'gemini-3.1-flash-image', apiKey: 'k', prompt: 'p', gatewayId: 'gemini', thinkingLevel: 'high' });
    assert.equal(JSON.parse(s.calls[2].body).generationConfig.thinkingConfig.thinkingLevel, 'high');
  } finally { s.restore(); }
});

test('GPT Image：safety_identifier 仅在非空时发送（截断到 128 字符）', async () => {
  const s = stubFetch();
  try {
    await generateImage({ model: 'gpt-image-2', apiKey: 'k', prompt: 'p', safetyIdentifier: 'u-'.repeat(100) });
    assert.equal(JSON.parse(s.calls[0].body).safety_identifier.length, 128);
    await generateImage({ model: 'gpt-image-2', apiKey: 'k', prompt: 'p', safetyIdentifier: '' });
    assert.equal(JSON.parse(s.calls[1].body).safety_identifier, undefined);
  } finally { s.restore(); }
});

function stubSSE(events) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body });
    const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    const bytes = new TextEncoder().encode(text);
    // 分两段推送，验证跨分块的事件拼接
    const mid = Math.floor(bytes.length / 2);
    const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, mid)); c.enqueue(bytes.slice(mid)); c.close(); } });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('GPT Image 流式：草稿逐张回调，终图按普通结果解析；请求带 stream 与 partial_images', async () => {
  const s = stubSSE([
    { type: 'image_generation.partial_image', partial_image_index: 0, b64_json: PNG_B64 },
    { type: 'image_generation.partial_image', partial_image_index: 1, b64_json: PNG_B64 },
    { type: 'image_generation.completed', b64_json: PNG_B64 },
  ]);
  const drafts = [];
  try {
    const out = await generateImage({ model: 'gpt-image-2.5-sunburst', apiKey: 'k', prompt: 'p', stream: true, partialImages: 2, onPartial: (d) => drafts.push(d.index) });
    assert.deepEqual(drafts, [0, 1]);
    const b = JSON.parse(s.calls[0].body);
    assert.equal(b.stream, true);
    assert.equal(b.partial_images, 2);
    assert.ok(out && (out.images || out.dataUrl), '终图应被解析');
  } finally { s.restore(); }
});

test('Nano Banana：google_search 仅对 2.1 与 3.1 Flash Image 发送，默认不发送', async () => {
  const s = stubGemini();
  try {
    await generateImage({ model: 'gemini-nano-banana-2.1', apiKey: 'k', prompt: 'p', gatewayId: 'gemini', googleSearch: true });
    assert.deepEqual(JSON.parse(s.calls[0].body).tools, [{ googleSearch: {} }]);
    await generateImage({ model: 'gemini-3.1-flash-image', apiKey: 'k', prompt: 'p', gatewayId: 'gemini', googleSearch: true });
    assert.ok(JSON.parse(s.calls[1].body).tools);
    await generateImage({ model: 'gemini-nano-banana-2.1', apiKey: 'k', prompt: 'p', gatewayId: 'gemini' });
    assert.equal(JSON.parse(s.calls[2].body).tools, undefined, '默认不开启');
    // 注：目录未收录 3.1 Flash Lite Image（且 Nano 识别不覆盖它）；若将来加入，需在 nanoGroundingSupported 中排除 lite
  } finally { s.restore(); }
});
