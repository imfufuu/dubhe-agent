import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeChecklist, checklistOpenItems, checklistComplete, checklistSummary, checklistReminder,
  CHECKLIST_MAX_ITEMS, CHECKLIST_MAX_NUDGES,
} from '../js/checklist.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('normalizeChecklist drops empty items, clamps status, fills ids and caps length', () => {
  const list = normalizeChecklist([
    { text: '  读取需求  ', status: 'done' },
    { text: '', status: 'done' },
    { text: '实现接口', status: 'bogus' },
    { id: 'x y!', title: '写测试', status: 'in_progress' },
  ]);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { id: 'c1', text: '读取需求', status: 'done' });
  assert.equal(list[1].status, 'pending');
  assert.equal(list[2].id, 'xy');
  assert.equal(list[2].status, 'in_progress');
  assert.deepEqual(normalizeChecklist(null), []);
  const many = normalizeChecklist(Array.from({ length: 50 }, (_, i) => ({ text: `步骤 ${i}`, status: 'pending' })));
  assert.equal(many.length, CHECKLIST_MAX_ITEMS);
});

test('gate predicates: failed / pending / in_progress keep the turn open; all done closes it', () => {
  const open = normalizeChecklist([{ text: 'a', status: 'done' }, { text: 'b', status: 'failed' }]);
  assert.equal(checklistComplete(open), false);
  assert.equal(checklistOpenItems(open).length, 1);
  const closed = normalizeChecklist([{ text: 'a', status: 'done' }, { text: 'b', status: 'done' }]);
  assert.equal(checklistComplete(closed), true);
  assert.equal(checklistOpenItems(closed).length, 0);
  // 空清单不算完成，也不阻止结束（非法调用不会把回合卡死）
  assert.equal(checklistComplete([]), false);
  assert.equal(checklistOpenItems([]).length, 0);
});

test('summary and reminder reflect remaining items; reminder is empty once complete', () => {
  const list = normalizeChecklist([{ id: 'c1', text: '验证', status: 'pending' }, { id: 'c2', text: '完成', status: 'done' }]);
  const s = checklistSummary(list);
  assert.match(s, /1\/2/);
  assert.match(s, /c1/);
  const r = checklistReminder(list);
  assert.match(r, /c1/);
  assert.match(r, /pending/);
  assert.equal(checklistReminder(normalizeChecklist([{ text: 'x', status: 'done' }])), '');
  assert.equal(checklistReminder(null), '');
});

test('nudge budget is finite so a stubborn model cannot hold the turn forever', () => {
  assert.ok(Number.isInteger(CHECKLIST_MAX_NUDGES) && CHECKLIST_MAX_NUDGES >= 1 && CHECKLIST_MAX_NUDGES <= 10);
});

test('wiring: tool definition, execution branch, contract, capability registry and prompt rule exist', () => {
  const tools = read('js/tools.js');
  assert.match(tools, /\{ name: 'checklist', description:/);
  assert.match(tools, /case 'checklist': return checklistSummary\(normalizeChecklist\(args && args\.items\)\);/);
  assert.match(read('js/execution.js'), /checklist: contract\(\{ sideEffect: 'none', idempotent: true/);
  assert.match(read('js/capabilities.js'), /checklist: R\('invariantCore', 'local', \{ core: 16 \}\)/);
  assert.match(read('js/prompt-core.js'), /call the checklist tool with 3-12 verifiable items/);
  assert.match(read('js/prompt-core.js'), /先调用 checklist 工具创建 3–12 个可验证项/);
});

test('wiring: agent loop gates turn end on open checklist items and resets per turn', () => {
  const agent = read('js/agent.js');
  assert.match(agent, /if \(!toolCalls\.length && !signal\.aborted && checklistBlocksEnd\(turnChecklist, checklistNudges\)\) \{ checklistNudges\+\+; continue; \}/);
  assert.match(agent, /checklistReminder\(turnChecklist\),/);
  assert.match(agent, /turnChecklist = recordChecklistCall\(store, assistantMsg\.id, call\.args\);/);
  assert.match(agent, /iterations = 0;\s*turnChecklist = null;\s*checklistNudges = 0;/);
});

test('wiring: checklist tool call stays out of the command menu and the card is painted', () => {
  assert.match(read('js/toolflow.js'), /if \(call\?\.name === 'checklist'\) return 'checklist';/);
  assert.match(read('js/ui.js'), /syncChecklistBlock\(wrap, m\); if \(paintOrderedAssistant/);
  assert.match(read('js/ui-toolflow.js'), /export function syncChecklistBlock/);
  assert.match(read('css/styles.css'), /\.agent-checklist \{/);
});

test('ui.js stays within the 3000-line budget', () => {
  assert.ok(read('js/ui.js').split('\n').length < 3000);
});

test('stable prompt layer carries no per-second timestamp (cache-friendly)', () => {
  const core = read('js/prompt-core.js');
  assert.doesNotMatch(core, /Current time: \$\{now\.toISOString\(\)\}/);
  assert.doesNotMatch(core, /当前时间：\$\{now\.toISOString\(\)\}/);
});
