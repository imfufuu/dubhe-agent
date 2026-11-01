#!/usr/bin/env node
// 生成 docs.html 中的「价目表」分区（纯静态 HTML，页面无运行时依赖）。
// 数据直接来自 js/model-catalog.js、js/pricing.js 与 js/teamorouter-pricing.js，避免手工抄表漂移。
// 用法：node scripts/build-pricing-docs.mjs   → 写回 docs.html 的 pricing 标记区间
// tests/pricing-docs.test.mjs 会比对 docs.html 与本脚本输出是否一致。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODEL_CATALOG } from '../js/model-catalog.js';
import { GATEWAYS } from '../js/gateway-registry.js';
import {
  getModelPricing, normalizeModelKey, MODEL_PRICING, IMAGE_MODEL_PRICING, VISION_MODEL_PRICING,
} from '../js/pricing.js';
import { TEAMOROUTER_FAST_PRICING, TEAMOROUTER_GATEWAY_ID } from '../js/teamorouter-pricing.js';

export const PRICING_START = '<!-- pricing:start -->';
export const PRICING_END = '<!-- pricing:end -->';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `$${String(+Number(v).toFixed(6))}`);
const kTokens = (n) => `${Math.round(Number(n) / 1000)}K`;
const TYPE_LABEL = { chat: '对话', vision: '视觉', image: '图像' };

// 官方网关 = GATEWAYS 中 first-party 项，按 provider 名匹配目录条目；Xiaomi / MiniMax 无官方网关，只出现在 TeamoRouter 表。
const OFFICIAL_GATEWAYS = GATEWAYS.filter((g) => g.category === 'first-party');

function isExactOfficial(id) {
  const { base } = normalizeModelKey(id);
  return Boolean(MODEL_PRICING[base] || IMAGE_MODEL_PRICING[base] || VISION_MODEL_PRICING[base]);
}

function priceRow({ name, sub, type, p, notes }) {
  const perImage = p?.mode === 'tier' && p.tiers
    ? ['1K', '2K', '4K'].map((k) => `${k} ${fmt(p.tiers[k.toLowerCase()])}`).join(' · ')
    : '—';
  const cells = [
    `<td><strong>${esc(name)}</strong><br><code>${esc(sub)}</code></td>`,
    `<td>${esc(type)}</td>`,
    `<td>${fmt(p?.input)}</td>`,
    `<td>${fmt(p?.cachedInput)}</td>`,
    `<td>${fmt(p?.cacheCreation)}</td>`,
    `<td>${fmt(p?.output)}</td>`,
    `<td>${perImage}</td>`,
    `<td>${notes.map(esc).join('；') || '—'}</td>`,
  ];
  return `<tr>${cells.join('')}</tr>`;
}

function chatNotes(p) {
  const notes = [];
  if (p.contextTier && typeof p.contextTier === 'object') {
    const t = p.contextTier;
    notes.push(`输入超过 ${kTokens(t.thresholdTokens)} token 时，输入 ×${t.inputMultiplier ?? 1}、输出 ×${t.outputMultiplier ?? 1}`);
  } else if (p.contextTier) {
    notes.push('长上下文阶梯计费（本表未展开）');
  }
  if (p.fastMultiplier > 1) notes.push(`Fast 模式 ×${p.fastMultiplier}`);
  return notes;
}

function officialRows(gateway) {
  const rows = [];
  for (const m of MODEL_CATALOG.filter((x) => x.provider === gateway.provider)) {
    const p = getModelPricing(m.id);
    const notes = [];
    if (!p) notes.push('官方价未公开，请以官网为准');
    else {
      if (!isExactOfficial(m.id)) notes.push('同系估价（目录未精确列出）');
      if (p.kind !== 'image') notes.push(...chatNotes(p));
      if (p.kind === 'image' && p.mode === 'tier') notes.push('按张阶梯价 + 按 token 计费');
    }
    rows.push(priceRow({ name: m.displayName || m.id, sub: m.id, type: TYPE_LABEL[m.channel] || TYPE_LABEL[p?.kind] || '对话', p, notes }));
  }
  return rows;
}

function teamorouterRows() {
  const rows = [];
  for (const m of MODEL_CATALOG) {
    const p = getModelPricing(m.id, { gatewayId: TEAMOROUTER_GATEWAY_ID });
    const type = TYPE_LABEL[m.channel] || TYPE_LABEL[p?.kind] || '对话';
    if (!p || p.priceSource !== 'teamorouter') {
      rows.push(priceRow({ name: m.displayName || m.id, sub: m.id, type, p: null, notes: ['公开目录未给出价格，暂不估价'] }));
      continue;
    }
    const notes = ['TeamoRouter 折后价'];
    if (p.kind === 'image' && p.mode === 'tier') {
      // 报告只给出按张价；沿用的官方 token 数值不可信，token 列留空。
      notes.push('按张计费；报告未列 token 价，token 价待确认');
      rows.push(priceRow({ name: m.displayName || m.id, sub: m.id, type, p: { ...p, input: undefined, output: undefined, cachedInput: undefined }, notes }));
      continue;
    }
    if (p.kind === 'chat' || p.kind === 'vision') {
      if (p.contextTier == null) notes.push('报告未给出上下文分档，不套用官方长上下文加价');
      notes.push('缓存写入按普通输入价计');
    }
    rows.push(priceRow({ name: m.displayName || m.id, sub: m.id, type, p, notes }));
  }
  for (const [id, f] of Object.entries(TEAMOROUTER_FAST_PRICING)) {
    rows.push(priceRow({ name: `${id} · Fast`, sub: `${id}（service_tier: fast）`, type: '对话', p: { input: f.input, output: f.output }, notes: ['Fast 加速档（TeamoRouter 折后价，基础模型 ID 不变）'] }));
  }
  return rows;
}

const TABLE_HEAD = '<thead><tr><th>模型</th><th>类型</th><th>输入</th><th>缓存读</th><th>缓存写</th><th>输出</th><th>按张</th><th>说明</th></tr></thead>';
const table = (rows) => `<div class="price-wrap"><table class="price-table">${TABLE_HEAD}<tbody>${rows.join('')}</tbody></table></div>`;

export function renderPricingSection() {
  const parts = [];
  parts.push(`<section class="page" id="page-pricing">`);
  parts.push('<h2>价目表</h2>');
  parts.push('<p class="h-sub">按网关列出每个模型的 token 与按张单价，覆盖 TeamoRouter 与全部官方网关。</p>');
  parts.push('<div class="price-notes"><ul>');
  parts.push('<li><strong>单位</strong>：USD。文本与视觉模型为每 100 万 token；图像模型的按张价为每张图。界面会按语言换算显示。</li>');
  parts.push('<li><strong>TeamoRouter（默认网关）</strong>：采用实测报告（2026-10-31）的折后价，<strong>不是官方报价</strong>。报告未列缓存写入价的模型按输入价计；未给出上下文分档，不套用官方长上下文加价。</li>');
  parts.push('<li><strong>官方网关</strong>：采用供应商公开标准价（2026-10-24 复核）。标注「同系估价」的型号，目录中未精确列出，按同系基准价估算。</li>');
  parts.push('<li><strong>不含</strong>：促销价、账户折扣、区域账单。视频生成按 <code>POST /v1/videos/quote</code> 实时报价，本表不列静态价。</li>');
  parts.push('<li>本表仅供估算参考，实际扣费以供应商与网关账单为准。</li>');
  parts.push('</ul></div>');

  let n = 1;
  const no = () => String(n++).padStart(2, '0');
  const trRows = teamorouterRows();
  parts.push(`<h3 id="price-teamorouter"><span class="no">${no()}</span>TeamoRouter（默认网关 · 折后价）</h3>`);
  parts.push(table(trRows));

  for (const g of OFFICIAL_GATEWAYS) {
    const rows = officialRows(g);
    parts.push(`<h3 id="price-${esc(g.id)}"><span class="no">${no()}</span>${esc(g.name)}（官方价）</h3>`);
    parts.push(`<p class="price-src">官方文档：<a href="${esc(g.docsUrl)}" target="_blank" rel="noopener">${esc(g.docsUrl)}</a></p>`);
    parts.push(rows.length ? table(rows) : '<p class="price-src">本应用目录暂无该网关的型号。</p>');
  }
  parts.push('</section>');
  return parts.join('\n');
}

// 直接运行：把生成结果写回 docs.html 的标记区间。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const docsPath = fileURLToPath(new URL('../docs.html', import.meta.url));
  const html = readFileSync(docsPath, 'utf8');
  const s = html.indexOf(PRICING_START);
  const e = html.indexOf(PRICING_END);
  if (s < 0 || e < 0 || e < s) throw new Error('docs.html 缺少 pricing 标记区间');
  const next = `${html.slice(0, s)}${PRICING_START}\n${renderPricingSection()}\n${html.slice(e)}`;
  writeFileSync(docsPath, next);
  console.log('docs.html 价目表已更新');
}
