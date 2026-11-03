// 本轮修复：MJ 不进对话菜单、失败的多模态命令不计费、项目模式（媒体/关闭确认/新建文件夹/侧栏）、
// PDF 公式排版、用户消息换行、输入框光标跟随、探索折叠的执行态。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isImageModel } from '../js/config.js';
import { summarizeTurnCost } from '../js/pricing.js';
import { layoutPdfText } from '../js/pdfpages.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('MJ 不进对话模型菜单：mj_* 与 midjourney 系列 ID 都视为生图模型', () => {
  assert.equal(isImageModel('midjourney'), true);
  assert.equal(isImageModel('mj_imagine'), true);
  assert.equal(isImageModel('midjourney-v7'), true);
  assert.equal(isImageModel('gpt-4o'), false);
});

test('失败的多模态命令不计费；成功的照常计费', () => {
  const user = { role: 'user', text: 'draw' };
  const asst = (status) => ({
    role: 'assistant', text: '', model: 'gpt-4o', done: true,
    toolCalls: [{ id: 't1', name: 'generate_image', status, args: {}, billing: { kind: 'image', model: 'gpt-image-2', count: 1, size: '1024x1024', quality: 'auto' } }],
  });
  const toolMsg = (content) => ({ role: 'tool', toolCallId: 't1', name: 'generate_image', content });
  const failed = summarizeTurnCost([user, asst('error'), toolMsg('图像接口报错')], { defaultModel: 'gpt-4o', defaultImageModel: 'gpt-image-2' });
  const ok = summarizeTurnCost([user, asst('ok'), toolMsg('已生成 outputs/image-001.png')], { defaultModel: 'gpt-4o', defaultImageModel: 'gpt-image-2' });
  assert.ok(!failed || !(failed.imageUsd > 0), '失败调用不应计生图费用');
  assert.ok(ok && ok.imageUsd > 0, '成功调用应计生图费用');
});

test('PDF 排版：上下标留在原行，数学片段包进 $…$，水平间隙补空格', () => {
  const styles = { F1: { fontFamily: 'Times' }, F2: { fontFamily: 'CMMI10' }, F3: { fontFamily: 'CMMI7' }, F4: { fontFamily: 'CMSY10' } };
  const items = [
    { str: 'Energy', transform: [10, 0, 0, 10, 72, 700], width: 40, height: 10, fontName: 'F1' },
    { str: 'E', transform: [10, 0, 0, 10, 120, 700], width: 7, height: 10, fontName: 'F2' },
    { str: '=', transform: [10, 0, 0, 10, 130, 700], width: 8, height: 10, fontName: 'F4' },
    { str: 'm', transform: [10, 0, 0, 10, 140, 700], width: 9, height: 10, fontName: 'F2' },
    { str: '2', transform: [10, 0, 0, 7, 149, 704], width: 5, height: 7, fontName: 'F3' },
    { str: 'c', transform: [10, 0, 0, 10, 160, 700], width: 6, height: 10, fontName: 'F2', hasEOL: true },
    { str: 'Next', transform: [10, 0, 0, 10, 72, 680], width: 30, height: 10, fontName: 'F1', hasEOL: true },
    { str: 'x', transform: [10, 0, 0, 10, 72, 660], width: 6, height: 10, fontName: 'F2' },
    { str: 'i', transform: [10, 0, 0, 7, 78, 656], width: 3, height: 7, fontName: 'F3' },
    { str: ' is set', transform: [10, 0, 0, 10, 82, 660], width: 30, height: 10, fontName: 'F1' },
  ];
  const out = layoutPdfText(items, styles);
  assert.equal(out, 'Energy $E = m^{2} c$\nNext\n$x_{i}$ is set');
  assert.equal(layoutPdfText([], styles), '');
});

test('项目模式：媒体预览 / 未保存三选一 / 新建文件夹 / 侧栏折叠', () => {
  const pm = read('js/project-mode.js');
  assert.match(pm, /kind: isBinaryContent\(content\) \? 'media' : 'text'/);
  assert.match(pm, /function renderMedia\(tab\)/);
  assert.match(pm, /h\('audio'/);
  assert.match(pm, /h\('iframe'/);
  assert.match(pm, /async function close\(\)/);
  assert.match(pm, /askUnsaved\(dirty\.map/);
  assert.match(pm, /'丢弃并关闭'/);
  assert.doesNotMatch(pm, /还要保存|win\.confirm\(T\(`还有/, '关闭不再用二选一的 confirm 静默丢弃');
  assert.match(pm, /function commitCreateFolder\(raw\)/);
  assert.match(pm, /'\/\.keep'/);
  assert.match(pm, /function toggleSide\(\)/);
  assert.match(pm, /ctrlKey \|\| e\.metaKey\) && \(e\.key === 'b'/);
  const css = read('css/styles.css');
  assert.match(css, /\.pm-root\.pm-side-collapsed \.pm-explorer \{ display: none; \}/);
});

test('探索折叠：绘制时不再引用未声明的 cluster；回合结束重算执行态', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /exploringInFlight\(fileCluster\(name\)\.length \? fileCluster\(name\) : \[m\]/);
  assert.doesNotMatch(ui, /exploringInFlight\(cluster\.length \? cluster : \[m\]/);
  assert.match(ui, /syncCompletedToolFolds\(\); flushDeferredAssistants\(\); scrollToBottom\(\)/);
});

test('用户消息保留换行；输入框仅在光标位于文末时跟随到底部', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /renderMarkdown\(String\(m\.text \|\| ''\)\.replace\(\/\^\\n\+\|\\n\+\$\/g, ''\), \{ userBreaks: true \}\)/);
  assert.match(ui, /autoGrow\(\{ follow: composer\.selectionEnd >= composer\.value\.length \}\)/);
  const md = read('js/ui-markdown.js');
  assert.match(md, /export function getMd\(\{ breaks = false \} = \{\}\)/);
  assert.match(md, /breaks: !!\(options && options\.userBreaks\)/);
});
