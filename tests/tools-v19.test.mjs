// V1.9 新增工具：patch_apply / dom_inspect / chart_render 的纯函数行为与四处登记一致性。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { applyUnifiedPatch, inspectHtml, chartSvg, parseCsv } from '../js/tools-v19.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('patch_apply: 精确应用 unified diff，结果与预期一致', () => {
  const original = 'a\nb\nc\nd\n';
  const patch = '--- a\n+++ b\n@@ -2,2 +2,3 @@\n b\n-c\n+C\n+c2\n d\n';
  const r = applyUnifiedPatch(original, patch);
  assert.equal(r.text, 'a\nb\nC\nc2\nd\n');
  assert.equal(r.hunks, 1);
});

test('patch_apply: 上下文不一致时整体拒绝（抛错，不返回半成品）', () => {
  assert.throws(() => applyUnifiedPatch('a\nb\n', '@@ -1,1 +1,1 @@\n-zzz\n+y\n'), /已拒绝整个补丁/);
  assert.throws(() => applyUnifiedPatch('a\n', 'no hunks here'), /没有 @@ hunk 头/);
});

test('patch_apply: 行号漂移时仍能在附近精确定位', () => {
  const original = 'x\nx\nx\ntarget\n';
  const patch = '@@ -1,1 +1,1 @@\n-target\n+done\n';
  assert.equal(applyUnifiedPatch(original, patch).text, 'x\nx\nx\ndone\n');
});

test('dom_inspect: 报告常见结构问题，干净页面无警告', () => {
  const bad = '<!doctype html><html><head><title></title></head><body><h1>A</h1><h3>跳级</h3><img src="a.png"><a href="#"></a><button></button><input id="q"></body></html>';
  const r = inspectHtml(bad, { DOMParserImpl: new JSDOM('').window.DOMParser });
  const rules = r.issues.map((i) => i.rule);
  for (const rule of ['html-lang', 'title', 'heading-skip', 'img-alt', 'link-text', 'button-name', 'form-label']) {
    assert.ok(rules.includes(rule), `应报告 ${rule}`);
  }
  assert.ok(r.counts.warn >= 4);
  const good = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>T</title></head><body><h1>T</h1><h2>S</h2><img src="a.png" alt="图"><a href="/x">文档</a><button>保存</button><label for="q">名</label><input id="q"></body></html>';
  const g = inspectHtml(good, { DOMParserImpl: new JSDOM('').window.DOMParser });
  assert.equal(g.issues.length, 0, JSON.stringify(g.issues));
});

test('chart_render: 柱状图与折线图都生成合法 SVG；非数字列拒绝出图', () => {
  const csv = 'name,score\n甲,3\n乙,5.5\n"丙, 丁",2\n';
  assert.deepEqual(parseCsv(csv).rows[2], ['丙, 丁', '2'], '带逗号的引号字段');
  const bar = chartSvg(csv, { type: 'bar', label: 'name', value: 'score', title: '分数' });
  const line = chartSvg(csv, { type: 'line', label: 'name', value: 'score' });
  assert.match(bar, /^<svg[^>]*>/);
  assert.match(bar, /<rect x=/);
  assert.match(line, /<path d="M/);
  assert.throws(() => chartSvg('name,score\nA,x\n', { label: 'name', value: 'score' }), /不是有效数字/);
  assert.throws(() => chartSvg(csv, { label: 'nope', value: 'score' }), /找不到标签列/);
});

test('V1.9 工具在工具定义、目录、能力登记、挂载、契约中四处同步', async () => {
  const tools = read('../js/tools.js');
  const caps = read('../js/capabilities.js');
  const mount = read('../js/capabilities-mount.js');
  const exec = read('../js/execution.js');
  const catalog = read('../js/tool-catalog.js');
  for (const name of ['patch_apply', 'dom_inspect', 'chart_render']) {
    assert.match(tools, new RegExp(`name: '${name}'`), `${name} 定义`);
    assert.match(tools, new RegExp(`case '${name}'`), `${name} 执行分支`);
    assert.match(caps, new RegExp(`${name}: R\\(`), `${name} 能力登记`);
    assert.match(mount, new RegExp(`${name}: \\{ text:`), `${name} 挂载规则`);
    assert.match(exec, new RegExp(`${name}: contract\\(`), `${name} 契约`);
    assert.match(catalog, new RegExp(`${name}: \\[`), `${name} 目录说明`);
  }
});
