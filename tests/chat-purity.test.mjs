// 对话模式「纯净模型对话」硬验证：直接捕获 streamChat 发出的请求体。
import test from 'node:test';
import assert from 'node:assert/strict';
import { streamChat } from '../js/api.js';
import { resolveTurnEnvironment } from '../js/agent-runtime.js';

const SSE = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

test('环境开关：chat 模式必须同时暴露 environment 与 mode', () => {
  const chat = resolveTurnEnvironment({ tuner: { environment: 'chat' }, settings: {} });
  assert.equal(chat.environment, 'chat');
  assert.equal(chat.mode, 'chat');
  assert.equal(chat.toolsEnabled, false);
  const agent = resolveTurnEnvironment({ tuner: { environment: 'agent' }, settings: {} });
  assert.equal(agent.environment, 'agent');
});

test('实际请求体：对话模式零 system / instructions / task / tools，只有用户历史', async () => {
  const captured = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    captured.push(JSON.parse(opts.body));
    return new Response(SSE, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    await streamChat({
      model: 'gpt-6-sol', apiKey: 'test-key', gatewayId: 'teamorouter',
      bareChat: true, tools: [{ name: 'write_file' }], fastMode: true, thinking: true,
      temperature: 0.7, webEnabled: true,
      messages: [
        { role: 'system', text: 'SYSTEM PROMPT '.repeat(200) },
        { role: 'developer', text: 'TASK TABLE '.repeat(200) },
        { role: 'user', text: 'hello' },
      ],
      onEvent: () => {},
    });
  } finally { globalThis.fetch = prev; }
  assert.equal(captured.length, 1);
  const body = captured[0];
  assert.equal('system' in body, false);
  assert.equal('instructions' in body, false);
  assert.equal('task' in body, false);
  assert.equal('tools' in body, false);
  assert.equal('service_tier' in body, false);
  assert.ok(Array.isArray(body.messages));
  assert.ok(body.messages.every((m) => !['system', 'developer'].includes(m.role)));
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].content, 'hello');
  assert.ok(JSON.stringify(body).length < 400, `请求体不应含 2.1k 提示词，实际 ${JSON.stringify(body).length}`);
});

test('Agent 模式仍保留完整系统提示词（对照）', async () => {
  const captured = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { captured.push(JSON.parse(opts.body)); return new Response(SSE, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); };
  try {
    await streamChat({
      model: 'gpt-6-sol', apiKey: 'test-key', gatewayId: 'teamorouter',
      bareChat: false, messages: [
        { role: 'system', text: 'SYSTEM RULES '.repeat(100) },
        { role: 'user', text: 'hello' },
      ], onEvent: () => {},
    });
  } finally { globalThis.fetch = prev; }
  assert.ok(JSON.stringify(captured[0]).includes('SYSTEM RULES'));
});
