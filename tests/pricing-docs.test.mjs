// docs.html 价目表分区：与生成器同步、覆盖 TeamoRouter 与全部官方网关、同系估价需标注
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { MODEL_CATALOG } from '../js/model-catalog.js';
import { GATEWAYS } from '../js/gateway-registry.js';
import { TEAMOROUTER_FAST_PRICING } from '../js/teamorouter-pricing.js';
import { renderPricingSection, PRICING_START, PRICING_END } from '../scripts/build-pricing-docs.mjs';

const docs = await fsp.readFile(new URL('../docs.html', import.meta.url), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

test('docs.html 价目表与 scripts/build-pricing-docs.mjs 输出一致（重新运行生成器即可更新）', () => {
  const s = docs.indexOf(PRICING_START);
  const e = docs.indexOf(PRICING_END);
  assert.ok(s >= 0 && e > s, 'docs.html 必须包含 pricing 标记区间');
  const embedded = docs.slice(s + PRICING_START.length, e).trim();
  assert.equal(embedded, renderPricingSection().trim());
});

test('文档页新增「价目表」标签与分区，并登记到 PAGES', () => {
  assert.match(docs, /<a class="nav-link doc-tab" href="#pricing" data-page="pricing"/);
  assert.match(docs, /<section class="page" id="page-pricing">/);
  assert.match(docs, /var PAGES = \[[^\]]*'pricing'\]/);
});

test('价目表覆盖 TeamoRouter 与全部官方网关（first-party）', () => {
  const sec = docs.slice(docs.indexOf('id="page-pricing"'));
  assert.ok(sec.includes('id="price-teamorouter"'));
  for (const g of GATEWAYS.filter((x) => x.category === 'first-party')) {
    assert.ok(sec.includes(`id="price-${g.id}"`), `缺少官方网关 ${g.id}`);
    assert.ok(sec.includes(esc(g.docsUrl)), `缺少 ${g.id} 官方文档链接`);
  }
});

test('目录中每个模型都出现在价目表里（TeamoRouter 表）', () => {
  const sec = docs.slice(docs.indexOf('id="price-teamorouter"'), docs.indexOf('id="price-anthropic"'));
  for (const m of MODEL_CATALOG) assert.ok(sec.includes(`<code>${esc(m.id)}</code>`), `TeamoRouter 表缺少 ${m.id}`);
  for (const id of Object.keys(TEAMOROUTER_FAST_PRICING)) assert.ok(sec.includes(`${id}（service_tier: fast）`), `缺少 Fast 档 ${id}`);
});

test('TeamoRouter 行使用折后价，官方行使用官方报价', () => {
  const sec = docs.slice(docs.indexOf('id="price-teamorouter"'), docs.indexOf('id="price-anthropic"'));
  const opus = sec.match(/<code>claude-opus-5-5<\/code>[\s\S]*?<\/tr>/)[0];
  assert.ok(opus.includes('<td>$1.144</td>') && opus.includes('<td>$5.72</td>'), 'TeamoRouter claude-opus-5-5 应为折后价 $1.144 / $5.72');
  const official = docs.slice(docs.indexOf('id="price-anthropic"'));
  const opusOfficial = official.match(/<code>claude-opus-5-5<\/code>[\s\S]*?<\/tr>/)[0];
  assert.ok(opusOfficial.includes('<td>$4</td>') && opusOfficial.includes('<td>$20</td>'), '官方 claude-opus-5-5 应为官方价 $4 / $20');
});

test('同系估价与未公开价格必须标注，不得冒充官方价', () => {
  assert.match(docs, /同系估价（目录未精确列出）/);
  assert.match(docs, /公开目录未给出价格，暂不估价/);
});
