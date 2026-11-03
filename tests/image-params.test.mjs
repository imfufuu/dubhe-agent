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
