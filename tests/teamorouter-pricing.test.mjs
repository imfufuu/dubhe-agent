// TeamoRouter 折后价与音视频 / 视频生成计费分桶
import test from 'node:test';
import assert from 'node:assert/strict';
import { getModelPricing, estimateChatCost, estimateImageCost, summarizeTurnCost, turnCostTipParts } from '../js/pricing.js';

const TR = 'teamorouter';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('官方网关保持官方报价', () => {
  assert.equal(getModelPricing('claude-opus-5-5', { gatewayId: '' }).input, 4.0);
  assert.notEqual(getModelPricing('claude-opus-5-5').priceSource, 'teamorouter');
});

test('TeamoRouter 使用报告折后价', () => {
  const p = getModelPricing('claude-opus-5-5', { gatewayId: TR });
  near(p.input, 1.144); near(p.output, 5.72); assert.equal(p.priceSource, 'teamorouter');
  near(estimateChatCost('jev-1.14.0', { input: 1e6, output: 0 }, { gatewayId: TR }).costUsd, 0.042);
  near(getModelPricing('gpt-6-astra (fast)', { gatewayId: TR }).input, 4.26);
  near(getModelPricing('kimi-k3[1M]', { gatewayId: TR }).input, 1.578);
});

test('生图折后价按张阶梯', () => {
  near(estimateImageCost({ model: 'gpt-image-2', size: '4k', gatewayId: TR }).costUsd, 0.0858);
  near(estimateImageCost({ model: 'gpt-image-2-4k-upscale', size: '4k', gatewayId: TR }).costUsd, 0.02);
  near(getModelPricing('gemini-nano-banana-2.1', { gatewayId: TR }).output, 15.0);
});

test('summarizeTurnCost 把音视频分析与视频生成拆成独立行', () => {
  const s = summarizeTurnCost({
    gatewayId: TR, model: 'claude-sonnet-5',
    messages: [{ role: 'assistant', model: 'claude-sonnet-5', done: true, usage: { input: 1000, output: 500 } }],
    toolCosts: [
      { kind: 'vision', media: 'video', model: 'gemini-3.8-flash', usage: { input: 4200, output: 300 } },
      { kind: 'video_gen', model: 'seedance-2-0-mini-text-to-video-basic', seconds: 4, costUsd: 0.2271 },
      { kind: 'video_gen', model: 'x', seconds: 4, costUsd: null },
    ],
  });
  assert.ok(s.avUsd > 0);
  near(s.videoGenUsd, 0.2271);
  assert.equal(s.visionUsd, 0);
  near(s.totalUsd, s.chatUsd + s.avUsd + s.videoGenUsd);
  assert.ok(turnCostTipParts(s).some((x) => x.startsWith('含视频生成')));
});
