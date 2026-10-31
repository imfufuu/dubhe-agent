// 生图家族 / 变体归并（TeamoRouter 实测报告 2026-10-31）与决策层（Jev）版本切换。
import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_MODELS, IMAGE_FAMILIES, imageFamilyOf, resolveImageVariant, DEFAULT_IMAGE_MODEL } from '../js/config.js';
import { JEV_MODEL, JEV_VERSIONS, setActiveJevModel, getActiveJevModel, buildSystemOneBody, choice } from '../js/jev.js';

test('生图菜单按家族归并：GPT Image 2 / GPT Image 2.5 / Nano Banana 三项', () => {
  assert.deepEqual(IMAGE_FAMILIES.map((f) => f.id), ['gpt-image-2', 'gpt-image-2.5', 'nano-banana']);
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
