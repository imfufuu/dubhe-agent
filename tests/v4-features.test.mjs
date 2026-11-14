// 2026-11-09 四项：最终产物报告 / 对话模式唯一身份声明 / 代码注册双门 / 对话模式 UI 降级。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { chatIdentityMessage } from '../js/api.js';
import { TOOL_DEFS, executeTool } from '../js/tools.js';
import { createFS } from '../js/sandbox.js';
import { setFinalReport, takeFinalReport, peekFinalReport, clearFinalReport, announceFinalReport, validateFinalReportPath } from '../js/final-report.js';
import { reviewToolCode } from '../js/tool-code-review.js';
import { runToolCode } from '../js/tool-code-runtime.js';
import { resetRegistryForTests, registerTool, approvePending, invokeRegisteredTool, HANDLER_KINDS, listRegisteredTools } from '../js/tool-registry.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('① 最终产物报告：非内部路径校验、工具登记与回合事件', async () => {
  clearFinalReport();
  const box = createFS();
  box.write('report.md', '# done');
  assert.throws(() => validateFinalReportPath('internal/a.md', box), /内部路径/);
  assert.throws(() => validateFinalReportPath('.git/config', box), /内部路径/);
  assert.throws(() => validateFinalReportPath('missing.md', box), /不存在/);
  assert.equal(setFinalReport('report.md', box), 'report.md');
  assert.equal(peekFinalReport(), 'report.md');
  assert.equal(takeFinalReport(), 'report.md');
  assert.equal(takeFinalReport(), '');
  assert.ok(TOOL_DEFS.some((t) => t.name === 'set_final_report'));
  const out = await executeTool('set_final_report', { path: 'report.md' }, { fs: box, onUi: () => {} });
  assert.match(String(out), /最终产物报告/);
  assert.equal(takeFinalReport(), 'report.md');
  assert.match(String(await executeTool('set_final_report', { path: 'internal/x.md' }, { fs: box, onUi: () => {} })), /失败.*内部路径/);
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  let seen = '';
  dom.window.document.addEventListener('dubhe:final-report', (e) => { seen = e.detail.path; });
  assert.equal(announceFinalReport('report.md', dom.window.document), true);
  assert.equal(seen, 'report.md');
  dom.window.close();
  assert.match(read('js/main.js'), /takeFinalReport\(\)/);
  assert.match(read('js/main.js'), /takeFinalReport\(\)/);
  assert.match(read('js/ui.js'), /installFinalReportOpener\(/);
  assert.match(read('js/ui-chat-mode.js'), /dubhe:final-report/);
  assert.match(read('js/ui-chat-mode.js'), /openFileViewer\(path\)/);
});

test('② 对话模式零提示词：不注入任何 system/task 文本', () => {
  assert.equal(chatIdentityMessage('gpt-test-x'), null, '纯净模型对话不声明身份/工具能力');
  const api = read('js/api.js');
  assert.match(api, /bareChat\s*\?\s*cleanedMessages\.filter/);
  assert.match(api, /if \(bareChat\) \{ tools = \[\]; fastMode = false; thinking = false; \}/);
  assert.match(read('js/agent.js'), /纯净模型对话/);
  assert.match(read('js/ui-tuner.js'), /不上传任何提示词/);
});

test('③ 代码注册：安全初审拒绝危险代码，通过后仍需用户确认', () => {
  assert.ok(HANDLER_KINDS.includes('code'));
  assert.equal(reviewToolCode('fetch("https://evil")').approved, false);
  assert.equal(reviewToolCode('eval("1")').approved, false);
  assert.equal(reviewToolCode('globalThis.alert(1)').approved, false);
  assert.equal(reviewToolCode('while (true) {}').approved, false);
  const safe = '(args) => Number(args.a) + Number(args.b)';
  assert.equal(reviewToolCode(safe).approved, true);
  assert.equal(runToolCode(safe, { a: 2, b: 3 }), '5');
  const base = {
    description: '加法代码工具',
    parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
  };
  resetRegistryForTests();
  assert.throws(() => registerTool({ ...base, name: 'custom_bad', handler: { kind: 'code', code: 'fetch("x")' } }), /安全初审未通过/);
  assert.equal(listRegisteredTools().length, 0, '初审失败不得注册');
  const first = registerTool({ ...base, name: 'custom_add', handler: { kind: 'code', code: safe } });
  assert.equal(first.needsConfirmation, true, '初审通过后仍必须用户确认');
  assert.match(first.message, /安全初审|确认卡/);
  assert.equal(listRegisteredTools().length, 0);
  assert.equal(approvePending(first.confirmToken, { autoRun: true }), true);
  assert.ok(listRegisteredTools().some((t) => t.name === 'custom_add'));
  assert.equal(invokeRegisteredTool('custom_add', { a: 4, b: 5 }), '9');
  assert.match(read('js/tool-registry.js'), /安全初审未通过/);
  assert.match(read('js/tool-registry.js'), /runToolCode/);
  assert.match(read('js/tool-catalog.js'), /安全初审/);
  // 菜单移到设置页靠前
  const app = read('app.html');
  assert.ok(app.indexOf('id="set-capability-sec"') < app.indexOf('<h4>外观</h4>'), '自注册工具菜单应在外观之前');
  assert.ok(app.indexOf('<h4>网关</h4>') < app.indexOf('id="set-capability-sec"'));
});

test('④ 对话模式 UI：思考变普通按钮、隐藏沙箱/联网、附件仅文本直接解析', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /data-chat-mode/);
  assert.match(ui, /installChatModeUI\(/);
  const mode = read('js/ui-chat-mode.js');
  assert.match(mode, /removeAttribute\('aria-haspopup'\)/);
  assert.match(mode, /'sandbox-toggle', 'web-toggle'/);
  assert.match(mode, /setChatMode\(chat\)/);
  assert.match(mode, /kind === 'text'/);
  assert.match(mode, /send\(merged, \[\]\)/);
  assert.match(ui, /sendChatTurn\(/);
  const att = read('js/ui-attachments.js');
  assert.match(att, /addTextOnlyFiles/);
  assert.match(att, /setChatMode:/);
  assert.match(att, /对话模式仅支持文本类附件/);
  assert.match(att, /kind: 'text'/);
});
