// 生图家族 / 变体归并（TeamoRouter 实测报告 2026-10-31）与决策层（Jev）版本切换。
import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_MODELS, IMAGE_FAMILIES, imageFamilyOf, resolveImageVariant, DEFAULT_IMAGE_MODEL } from '../js/config.js';
import { JEV_MODEL, JEV_VERSIONS, setActiveJevModel, getActiveJevModel, buildSystemOneBody, choice } from '../js/jev.js';

test('生图菜单按家族归并：GPT Image 2 / GPT Image 2.5 / Nano Banana 三项', () => {
  assert.deepEqual(IMAGE_FAMILIES.map((f) => f.id), ['gpt-image-2', 'gpt-image-2.5', 'nano-banana', 'midjourney']);
  for (const f of IMAGE_FAMILIES) {
    assert.ok(IMAGE_MODELS.some((m) => m.id === f.defaultModel), `${f.id} 默认变体必须在目录中`);
    assert.equal(imageFamilyOf(f.defaultModel), f.id, `${f.defaultModel} 归属 ${f.id}`);
  }
});

test('报告中的 4K 升采样变体已登记，并归入对应家族', () => {
  const up = {
    'gpt-image-2-4k-upscale': 'gpt-image-2',
    'gpt-image-2.5-sunburst-4k-upscale': 'gpt-image-2.5',
    'gpt-image-2.5-flare-4k-upscale': 'gpt-image-2.5',
    'gemini-3-pro-image': 'nano-banana',
  };
  for (const [id, fam] of Object.entries(up)) {
    assert.ok(IMAGE_MODELS.some((m) => m.id === id), `${id} 在目录中`);
    assert.equal(imageFamilyOf(id), fam);
  }
});

test('resolveImageVariant：家族 + 风格 → 具体变体', () => {
  assert.equal(resolveImageVariant('gpt-image-2'), 'gpt-image-2');
  assert.equal(resolveImageVariant('gpt-image-2.5'), 'gpt-image-2.5-sunburst', '默认写实');
  assert.equal(resolveImageVariant('gpt-image-2.5', { style: 'illustration' }), 'gpt-image-2.5-flare');
  assert.equal(resolveImageVariant('gpt-image-2.5', { style: '插画' }), 'gpt-image-2.5-flare', '中文风格词');
  assert.equal(resolveImageVariant('nano-banana'), 'gemini-3.1-flash-image');
  assert.equal(resolveImageVariant('nano-banana', { style: 'pro' }), 'gemini-3-pro-image');
  assert.equal(resolveImageVariant('nano-banana', { style: 'quality' }), 'gemini-nano-banana-2.1');
});

test('resolveImageVariant：4K 自动走升采样变体（比原生 4K 便宜）', () => {
  assert.equal(resolveImageVariant('gpt-image-2', { resolution: '4K' }), 'gpt-image-2-4k-upscale');
  assert.equal(resolveImageVariant('gpt-image-2', { size: '4096x4096' }), 'gpt-image-2-4k-upscale');
  assert.equal(resolveImageVariant('gpt-image-2.5', { resolution: '4K' }), 'gpt-image-2.5-sunburst-4k-upscale');
  assert.equal(resolveImageVariant('gpt-image-2.5', { resolution: '4K', style: 'illustration' }), 'gpt-image-2.5-flare-4k-upscale');
  assert.equal(resolveImageVariant('gpt-image-2', { resolution: '2K' }), 'gpt-image-2', '2K 不升采样');
});

test('resolveImageVariant：传入具体变体时保持其角色；未知输入回落默认', () => {
  assert.equal(resolveImageVariant('gpt-image-2.5-flare'), 'gpt-image-2.5-flare');
  assert.equal(resolveImageVariant('gpt-image-2.5-flare', { style: 'realistic' }), 'gpt-image-2.5-sunburst', '显式风格优先');
  assert.equal(resolveImageVariant('gpt-image-2.5-sunburst-4k-upscale'), 'gpt-image-2.5-sunburst-4k-upscale', '升采样变体不降级');
  assert.equal(resolveImageVariant('not-a-model'), DEFAULT_IMAGE_MODEL);
  assert.equal(resolveImageVariant(undefined), DEFAULT_IMAGE_MODEL);
});

test('决策层：提供 jev-1.14.0（默认）与 jev-1.13.0 两个版本，切换后影响回合规划与审核', () => {
  assert.deepEqual(JEV_VERSIONS.map((v) => v.id), ['jev-1.14.0', 'jev-1.13.0']);
  assert.equal(JEV_MODEL, 'jev-1.14.0');
  try {
    assert.equal(setActiveJevModel('jev-1.13.0'), 'jev-1.13.0');
    assert.equal(getActiveJevModel(), 'jev-1.13.0');
    assert.equal(buildSystemOneBody({ state: 's', questions: { q: choice('?', { a: 'x' }) } }).model, 'jev-1.13.0');
    assert.equal(setActiveJevModel('not-a-version'), JEV_MODEL, '未知版本回落默认');
    assert.equal(getActiveJevModel(), JEV_MODEL);
  } finally {
    setActiveJevModel(JEV_MODEL);
  }
});

// 会话保存的是「系列」：2.5 系列不再被降成 sunburst；Agent 按描述在写实 / 插画变体之间自动选
import { resolveImageModel, isImageGenSelection, imageModelRuntimeDescription } from '../js/config.js';
test('生图系列：会话保存系列 ID，Agent 按描述自动选写实 / 插画变体', () => {
  assert.ok(isImageGenSelection('gpt-image-2.5'));
  assert.equal(resolveImageModel('gpt-image-2.5', DEFAULT_IMAGE_MODEL).id, 'gpt-image-2.5');
  assert.equal(resolveImageVariant('gpt-image-2.5', { prompt: '一只戴帽子的卡通插画猫' }), 'gpt-image-2.5-flare');
  assert.equal(resolveImageVariant('gpt-image-2.5', { prompt: '雨夜街头的写实人像照片' }), 'gpt-image-2.5-sunburst');
  assert.equal(resolveImageVariant('gpt-image-2.5', { style: 'illustration' }), 'gpt-image-2.5-flare', '显式 style 优先');
  assert.equal(resolveImageVariant('gpt-image-2.5', { prompt: '插画', resolution: '4K' }), 'gpt-image-2.5-flare-4k-upscale');
  // 历史变体 ID 仍按原行为
  assert.equal(resolveImageVariant('gpt-image-2.5-flare', { prompt: '写实照片' }), 'gpt-image-2.5-flare', '变体角色优先于描述');
  const desc = imageModelRuntimeDescription('gpt-image-2.5');
  for (const m of IMAGE_MODELS.filter(m => m.family === 'gpt-image-2.5')) assert.ok(desc.includes(m.id));
});


test('all image families resolve directly and their prompt includes only their own variants', () => {
  for (const family of IMAGE_FAMILIES) {
    assert.equal(resolveImageModel(family.id).id, family.id);
    const desc = imageModelRuntimeDescription(family.id);
    for (const model of IMAGE_MODELS) {
      if (model.family === family.id && family.id !== 'midjourney') assert.ok(desc.includes(model.id), `${family.id}: ${model.id}`);
      if (model.family !== family.id) assert.ok(!desc.includes(`${model.id} (`), `${family.id} must not include ${model.id}`);
    }
  }
  assert.match(imageModelRuntimeDescription('midjourney'), /midjourney/);
  assert.match(imageModelRuntimeDescription('midjourney', { gatewayId: 'openai' }), /仅支持 TeamoRouter/);
});

test('agent request carries the selected family variants, and the tool sends the selected 4K variant', async () => {
  const { createStore } = await import('../js/state.js');
  const { createAgent } = await import('../js/agent.js');
  const previousStorage = globalThis.localStorage; const effectData = new Map();
  globalThis.localStorage = { getItem: k => effectData.get(k) ?? null, setItem: (k,v) => effectData.set(k,String(v)), removeItem: k => effectData.delete(k) };
  const store = createStore();
  store.state.apiKey = 'test-key';
  store.state.model = 'gpt-5.6-sol';
  store.state.imageModel = 'gpt-image-2.5';
  Object.assign(store.state.settings, { webEnabled: false, jevEnabled: false, autoReview: false });
  const calls = [];
  const originalFetch = globalThis.fetch;
  const event = obj => `data: ${JSON.stringify(obj)}\n\n`;
  const sse = text => new Response(text + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const toolTurn = sse(event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_img', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'cartoon cat', variant: 'gpt-image-2.5-flare-4k-upscale' }) } }] } }] }) + event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
  const finalTurn = sse(event({ choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }));
  let chatCalls = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (String(url).includes('/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200 });
    return chatCalls++ === 0 ? toolTurn : finalTurn;
  };
  try {
    await createAgent(store, {}).send('画一张4K卡通插画猫');
    const chat = calls.find(c => c.url.includes('/chat/completions'));
    assert.ok(chat, 'actual chat request captured');
    assert.ok(chat.body.tools.find(t => t.function.name === 'generate_image').function.parameters.properties.variant);
    const prompt = JSON.stringify(chat.body.messages);
    const system = chat.body.messages.find(m => m.role === 'system').content;
    assert.match(system, /gpt-image-2\.5-flare/);
    assert.doesNotMatch(system, /gemini-3\.1-flash-image/);
    for (const m of IMAGE_MODELS.filter(m => m.family === 'gpt-image-2.5')) assert.ok(prompt.includes(m.id), m.id);
    assert.match(prompt, /:::chart bar/);
    const image = calls.find(c => c.url.includes('/images/generations'));
    assert.ok(image, JSON.stringify(calls));
    assert.equal(image.body.model, 'gpt-image-2.5-flare-4k-upscale');
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = previousStorage; }
});

test('session restore retains family selection and migrates the incorrect Kimi ID', async () => {
  const { createStore } = await import('../js/state.js');
  const store = createStore();
  const first = store.state.activeSessionId;
  store.state.imageModel = 'gpt-image-2.5';
  store.state.model = 'kimi-k3.1-pro[1M]';
  store.notify();
  const second = store.createSession();
  assert.ok(store.switchSession(first));
  assert.equal(store.state.imageModel, 'gpt-image-2.5');
  assert.equal(store.state.model, 'kimi-k3[1M]');
  assert.ok(store.switchSession(second.id));
});

test('explicit Flare variant reaches gateway; cross-family variant is rejected before network', async () => {
  const { executeTool } = await import('../js/tools.js');
  const { createFS } = await import('../js/sandbox.js');
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200 });
  };
  try {
    const ctx = { fs: createFS(), apiKey: 'test', imageModel: 'gpt-image-2.5', gatewayId: 'teamorouter' };
    await executeTool('generate_image', { prompt: 'a realistic photograph', variant: 'gpt-image-2.5-flare' }, ctx);
    assert.equal(calls[0].model, 'gpt-image-2.5-flare', 'explicit variant beats prompt heuristics');
    const result = await executeTool('generate_image', { prompt: 'a cat', variant: 'gpt-image-2' }, ctx);
    assert.match(result, /不属于当前选定系列/);
    assert.equal(calls.length, 1);
    assert.match(imageModelRuntimeDescription('gpt-image-2.5', { gatewayId: 'gemini' }), /没有可用变体/);
  } finally { globalThis.fetch = original; }
});
