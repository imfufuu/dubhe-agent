// 2026-11-09 十一项更新回归（API 价目表、GPT Image 2.6、MJ 四宫格、识图空正文、不计价等）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { IMAGE_MODELS, IMAGE_FAMILIES, resolveImageVariant, VISION_MODELS, VIDEO_MODELS } from '../js/config.js';
import { MODEL_CATALOG, TEAMOROUTER_CONFIRMED_MODEL_IDS, MODEL_CATALOG_DATE } from '../js/model-catalog.js';
import { IMAGE_MODEL_PRICING, priceBadgeFor } from '../js/pricing.js';
import { cfModelCard } from '../js/cloudflare-ai-catalog.js';
import { quadCrops, expandMjResult, MJ_QUAD_COUNT } from '../js/mj-quad.js';
import { normalizeTuner } from '../js/agent-runtime.js';
import { fitMessagesToContext, estimateTokens } from '../js/offline-context.js';
import { OFFLINE_MODEL_CONTEXT_SIZE } from '../js/offline-model-config.js';
import { needsFirstVisit } from '../js/ui-first-visit.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('① 模型列表：GPT Image 2.6 四个变体、三个新聊天模型与官方价格', () => {
  for (const id of ['gpt-image-2.6-sunburst','gpt-image-2.6-flare','gpt-image-2.6-sunburst-4k-upscale','gpt-image-2.6-flare-4k-upscale']) {
    assert.ok(IMAGE_MODELS.some((m) => m.id === id), id);
    assert.ok(IMAGE_MODEL_PRICING[id], `${id} 价目`);
    assert.equal(IMAGE_MODEL_PRICING[id].tiers['1k'], 0.02);
  }
  assert.ok(IMAGE_FAMILIES.some((f) => f.id === 'gpt-image-2.6'));
  assert.equal(resolveImageVariant('gpt-image-2.6', { style: 'illustration' }), 'gpt-image-2.6-flare');
  assert.equal(resolveImageVariant('gpt-image-2.6', { style: 'realistic', resolution: '4K' }), 'gpt-image-2.6-sunburst-4k-upscale');
  for (const id of ['claude-fable-5-2','gemini-4-carbon','gemini-4-hydrogen']) {
    assert.ok(TEAMOROUTER_CONFIRMED_MODEL_IDS.includes(id), id);
    const card = MODEL_CATALOG.find((m) => m.id === id);
    assert.ok(card, `${id} 价目条目`);
    assert.equal(card.priceSource, 'official');
  }
  assert.equal(MODEL_CATALOG.find((m) => m.id === 'claude-fable-5-2').listPrice.input, 8);
  assert.equal(MODEL_CATALOG.find((m) => m.id === 'gemini-4-carbon').listPrice.output, 10);
  assert.equal(MODEL_CATALOG.find((m) => m.id === 'gemini-4-hydrogen').listPrice.input, 1.5);
  assert.equal(MODEL_CATALOG_DATE, '2026-11-09');
});

test('① 标签仅热门/低价；MJ 四宫格可分割', async () => {
  const picker = read('js/ui-model-picker.js');
  assert.doesNotMatch(picker, /badge[^>]*>FREE|自动<\/span>|badge model-tag|badge cf-agent|badge cf-chat/);
  assert.match(picker, /localeText\('热门', 'Popular'\)/);
  assert.match(picker, /localeText\('低价', 'Cheap'\)/);
  for (const list of [IMAGE_MODELS, IMAGE_FAMILIES, VISION_MODELS, VIDEO_MODELS]) {
    for (const m of list) if (m.tag) assert.ok(['热门','低价','Popular','Cheap'].includes(m.tag), `非法标签 ${m.tag}`);
  }
  assert.equal(MJ_QUAD_COUNT, 4);
  assert.deepEqual(quadCrops(100, 80).length, 4);
  const result = await expandMjResult({ images: [{ dataUrl: 'quad.png', mime: 'image/png' }], dataUrl: 'quad.png', usage: null },
    { splitter: async () => ['a','b','c','d'] });
  assert.equal(result.images.length, 4);
  assert.equal(result.quadSplit, true);
  assert.match(read('js/api.js'), /expandMjResult/);
});

test('② 识图空正文兜底 / ④ Cloudflare 不计价 / ③ 关闭动画', () => {
  const vision = read('js/vision.js');
  assert.match(vision, /reasoning_content/);
  assert.match(vision, /emptyRetry/);
  assert.equal(cfModelCard('@cf/openai/gpt-oss-20b').pricing, null);
  assert.equal(priceBadgeFor('@cf/openai/gpt-oss-20b', { language: 'zh', gatewayId: 'cloudflare' }), '');
  assert.doesNotMatch(read('js/pricing.js'), /Neurons · Cloudflare 计费/);
  assert.match(read('js/ui-tuner.js'), /setTimeout\(\(\) => \{ if \(!modal\.classList\.contains\('open'\)\)/);
});

test('⑤ 删除会话保留网关模型 / ⑥ 项目导入遵循审核开关 / ⑦ 首次用户名', () => {
  assert.match(read('js/ui.js'), /keptGateway = store\.state\.gatewayId, keptModel = store\.state\.model/);
  assert.match(read('js/project-mode.js'), /effectiveModeration\(store\.state\.settings\)/);
  const sal = read('js/user-salutation.js');
  assert.match(sal, /阿泽|小北|橙子/);
  assert.doesNotMatch(sal, /'小星', '青禾'/);
  assert.equal(needsFirstVisit({ getItem: () => null }), true);
  assert.equal(needsFirstVisit({ getItem: () => '阿泽' }), false);
  assert.match(read('js/main.js'), /installFirstVisit\(\)/);
});

test('⑧ 验证码取消决策 / ⑩ 个性化提示词 / ⑪ 本地上下文', () => {
  assert.match(read('js/human-check.js'), /dubhe:turnstile-cancelled/);
  assert.match(read('js/api.js'), /__dubheUserDecision/);
  assert.match(read('js/api.js'), /personalPrompt/);
  assert.equal(normalizeTuner({ personalPrompt: '偏好简短回答' }).personalPrompt, '偏好简短回答');
  assert.equal(normalizeTuner({ personalPrompt: 'x'.repeat(5000) }).personalPrompt.length, 2000);
  assert.match(read('app.html'), /id="tuner-personal-prompt"/);
  assert.equal(OFFLINE_MODEL_CONTEXT_SIZE, 8192);
  assert.match(read('js/api.js'), /fitMessagesToContext/);
  const msgs = [{ role: 'system', content: 'S' }, ...Array.from({ length: 100 }, (_, i) => ({ role: 'user', content: 'x'.repeat(400) + i }))];
  const fitted = fitMessagesToContext(msgs, 600);
  assert.ok(estimateTokens(fitted) <= 700 && fitted.length < msgs.length);
  assert.equal(fitted[0].role, 'system');
});
