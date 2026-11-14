// 2026-11-13 界面/提示词更新回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THINKING_LABEL, formatThoughtDuration } from '../js/thinking-labels.js';
import { extractChoices } from '../js/choices.js';
import { renderMarkdown } from '../js/ui-markdown.js?v=2026.10.25.1';
import { VISION_MODELS, VIDEO_MODELS, IMAGE_MODELS } from '../js/config.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('② Thinking 英文标签与时长格式', () => {
  assert.equal(THINKING_LABEL, 'Thinking…');
  assert.equal(formatThoughtDuration(0), 'Thought for 1 second');
  assert.equal(formatThoughtDuration(999), 'Thought for 1 second');
  assert.equal(formatThoughtDuration(1000), 'Thought for 1 second');
  assert.equal(formatThoughtDuration(2000), 'Thought for 2 seconds');
  assert.equal(formatThoughtDuration(60000), 'Thought for 1 minute');
  assert.equal(formatThoughtDuration(61000), 'Thought for 1 minute 1 second');
  assert.equal(formatThoughtDuration(122000), 'Thought for 2 minutes 2 seconds');
  assert.equal(formatThoughtDuration(120000), 'Thought for 2 minutes');
  assert.doesNotMatch(read('js/ui.js'), /思考摘要|思考过程/);
});

test('③ :::choice multi 多选语法', () => {
  const src = ':::choice multi 选语言\n- 中文\n- English\n- 日本語\n:::';
  const { groups } = extractChoices(src);
  assert.equal(groups.length, 1);
  assert.equal(groups[0][0].multi, true);
  assert.equal(groups[0][0].title, '选语言');
  const html = renderMarkdown(src);
  assert.match(html, /data-choice-multi="1"/);
  assert.match(html, /choice-checkbox/);
  assert.match(read('js/ui-choices.js'), /choiceMulti/);
});

test('④ 调节器无工具跳转 / ⑤ 思考设置同行 / ⑩ 对话模式隐藏五个按钮', () => {
  const app = read('app.html');
  assert.doesNotMatch(app, /id="tuner-open-tools"/);
  assert.match(app, /tuner-env-row/);
  const tuner = read('js/ui-tuner.js');
  assert.doesNotMatch(tuner, /openToolManager|tuner-open-tools/);
  const mode = read('js/ui-chat-mode.js');
  for (const id of ['sandbox-toggle','web-toggle','fast-toggle','project-toggle','panel-toggle']) assert.match(mode, new RegExp(id));
  assert.match(read('js/thinking-labels.js'), /Thinking/);
});

test('⑥ 工具能力栏目合并并前置 / ⑧ 网关过滤 / ⑨ 卡片样式 / ① flow 文本兜底', () => {
  const app = read('app.html');
  assert.ok(app.indexOf('id="set-capability-sec"') < app.indexOf('<h4>外观</h4>'));
  assert.ok(app.indexOf('id="tool-manager-root"') > app.indexOf('id="set-capability-sec"'));
  assert.doesNotMatch(app, /id="set-tool-manager-sec"/);
  assert.match(read('js/settings.js'), /cloudflare-flux/);
  const css = read('css/styles.css');
  assert.match(css, /tuner-tool-json \{ max-width: 100%/);
  assert.match(css, /overflow-x: hidden/);
  assert.match(read('js/ui-toolflow.js'), /part\.text/);
});

test('⑦ 多模态标签复原（聊天模型仍只有热门/低价）', () => {
  const pro = VISION_MODELS.find((m) => m.id === 'gemini-3.1-pro-preview');
  assert.equal(pro.tag, '高精度');
  assert.ok(VISION_MODELS.every((m) => m.tag));
  assert.ok(VIDEO_MODELS.every((m) => m.tag));
  assert.ok(IMAGE_MODELS.some((m) => m.tag === '写实'));
  const picker = read('js/ui-model-picker.js');
  assert.doesNotMatch(picker, /badge[^>]*>FREE|badge cf-agent/);
});

test('⑪ 设计准则与导航页 / ⑫ 功能知识库', () => {
  // 设计准则只进系统提示词/知识库，不抄进导航页；导航页前面按准则重排版。
  assert.doesNotMatch(read('index.html'), /design-manifesto/);
  assert.match(read('index.html'), /hero-spec|hero-grid-mark/);
  assert.match(read('css/home.css'), /hero-grid-mark/);
  assert.doesNotMatch(read('js/ui-chat-mode.js'), /thinkingToggle\.textContent/);
  assert.match(read('js/api.js'), /offline token accounting|localMessages.map/);
  assert.match(read('js/pricing.js'), /mode: 'local'/);
  assert.match(read('js/offline-model.js'), /loadedModelKey !== modelKey \|\| \(!isLoaded && !engine\.proxy\)/);
  const core = read('js/prompt-core.js');
  assert.match(core, /排版先行|typography first/i);
  const index = JSON.parse(read('assets/knowledge/index.json'));
  for (const id of ['guide-zh','guide-en']) assert.ok(index.records.some((r) => r.id === id), id);
  assert.match(read('assets/knowledge/dubhe-guide.zh.md'), /对话模式是纯净模型对话/);
});
