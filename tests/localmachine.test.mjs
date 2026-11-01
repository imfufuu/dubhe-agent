// 本机能力（run_shell / take_screenshot / local_files）的前端契约：登记、门控、风险、强制确认、派生白名单、输出截断。
// 真正的 shell / 截图 / 文件执行在 tests/local_relay_checks.py（Python 端）中验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs';

const LM = await import('../js/localmachine.js');
const EX = await import('../js/execution.js');
const EC = await import('../js/executionContext.js');
const REG = await import('../js/capabilities.js');
const { TOOL_DEFS } = await import('../js/tools.js');

const LOCAL = ['run_shell', 'take_screenshot', 'local_files'];

test('登记：三个本机工具都在能力登记处（group=localMachine）、有契约、有 TOOL_DEFS 定义', () => {
  for (const name of LOCAL) {
    const cap = REG.capabilityOf(name);
    assert.ok(cap, `${name} 未登记`);
    assert.equal(cap.group, 'localMachine');
    assert.ok(EX.getToolContract(name), `${name} 缺契约`);
    assert.ok(TOOL_DEFS.some((t) => t.name === name), `${name} 缺 TOOL_DEFS`);
  }
  assert.ok(REG.CAPABILITY_GROUPS.includes('localMachine'));
  assert.deepEqual(LM.LOCAL_MACHINE_TOOLS, LOCAL);
});

test('契约：run_shell 为 L3 且强制确认；take_screenshot 只写沙箱；local_files 基线 L1', () => {
  const shell = EX.getToolContract('run_shell');
  assert.equal(shell.riskLevel, 'L3');
  assert.equal(shell.requiresConfirmation, true);
  assert.equal(shell.sideEffect, 'sandbox');
  assert.equal(EX.getToolContract('take_screenshot').sideEffect, 'filesystem');
  assert.equal(EX.getToolContract('local_files').riskLevel, 'L1');
});

test('风险分级：local_files 的写 / 删 / 移动升级，读取保持低风险；run_shell 不可自动恢复', () => {
  const lvl = (name, args) => EX.classifyToolRisk({ name, args, contract: EX.getToolContract(name) });
  assert.equal(lvl('local_files', { action: 'read', path: 'a.txt' }).level, 'L1');
  assert.equal(lvl('local_files', { action: 'list', path: '.' }).level, 'L1');
  assert.equal(lvl('local_files', { action: 'write', path: 'a.txt' }).level, 'L2');
  const del = lvl('local_files', { action: 'delete', path: 'a.txt' });
  assert.equal(del.level, 'L3');
  assert.equal(del.requiresConfirmation, true);
  assert.equal(del.irreversible, true);
  const mv = lvl('local_files', { action: 'move', path: 'a.txt', dest: 'b.txt' });
  assert.equal(mv.level, 'L3');
  const sh = lvl('run_shell', { command: 'echo hi' });
  assert.equal(sh.level, 'L3');
  assert.equal(sh.requiresConfirmation, true);
});

test('强制确认：shell 永远确认；本机文件仅写 / 建目录 / 移动 / 删除确认；读取与截图不确认', () => {
  assert.equal(EX.localMachineMustConfirm('run_shell', { command: 'ls' }), true);
  for (const action of ['write', 'mkdir', 'move', 'delete']) {
    assert.equal(EX.localMachineMustConfirm('local_files', { action }), true, action);
  }
  for (const action of ['list', 'stat', 'read']) {
    assert.equal(EX.localMachineMustConfirm('local_files', { action }), false, action);
  }
  assert.equal(EX.localMachineMustConfirm('take_screenshot', {}), false);
  assert.equal(EX.localMachineMustConfirm('read_file', { path: 'a' }), false);
});

test('门控：本机能力关闭时三个工具从派生白名单摘除（原因 local-machine-unavailable）；开启后放行', () => {
  const off = EC.deriveToolWhitelistFromBits({ relay: false, web: false, sandbox: true, localMachine: false }, TOOL_DEFS);
  const offNames = off.allowed.map(EC.toolName);
  for (const name of LOCAL) {
    assert.ok(!offNames.includes(name), `${name} 不应在关闭状态下放行`);
    assert.ok(off.dropped.some((d) => d.name === name && d.reason === 'local-machine-unavailable'));
  }
  const on = EC.deriveToolWhitelistFromBits({ relay: false, web: false, sandbox: true, localMachine: true }, TOOL_DEFS);
  const onNames = on.allowed.map(EC.toolName);
  for (const name of LOCAL) assert.ok(onNames.includes(name), `${name} 应在开启状态下放行`);
});

test('执行门控：能力未开时 checkCapabilityConstraints 直接拒绝（capability-local-machine-off）；开启后不因此拒绝', () => {
  const off = EX.checkCapabilityConstraints({
    name: 'run_shell', args: { command: 'ls' },
    capabilities: EX.buildCapabilityConstraints({ relayOk: false, localMachineEnabled: false }),
    toolNames: LOCAL,
  });
  assert.equal(off.allowed, false);
  assert.equal(off.constraintId, 'capability-local-machine-off');
  const on = EX.checkCapabilityConstraints({
    name: 'run_shell', args: { command: 'ls' },
    capabilities: EX.buildCapabilityConstraints({ relayOk: false, localMachineEnabled: true }),
    toolNames: LOCAL,
  });
  assert.notEqual(on.constraintId, 'capability-local-machine-off');
});

test('提示词与目录：三个工具都有中英文摘要与检索关键词，提示词中文 / 英文都提到', () => {
  const cfg = fsp.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
  const en = fsp.readFileSync(new URL('../js/prompt-en.js', import.meta.url), 'utf8');
  const catalog = fsp.readFileSync(new URL('../js/tool-catalog.js', import.meta.url), 'utf8');
  for (const name of LOCAL) {
    assert.ok(cfg.includes(name), `config.js 未提及 ${name}`);
    assert.ok(en.includes(name), `prompt-en.js 未提及 ${name}`);
    assert.ok(catalog.includes(`${name}:`), `tool-catalog 未登记 ${name}`);
  }
});

test('按需挂载：本机意图（截图 / 命令 / 本机文件）能挂载对应工具', () => {
  const mount = fsp.readFileSync(new URL('../js/capabilities-mount.js', import.meta.url), 'utf8');
  for (const name of LOCAL) assert.ok(mount.includes(`${name}: { text:`), `${name} 缺挂载规则`);
});

test('输出截断：超长 shell 输出被截断并注明原始长度；短输出原样返回', () => {
  const short = LM.clipLocalOutput('hello', 100);
  assert.deepEqual(short, { text: 'hello', clipped: false });
  const long = LM.clipLocalOutput('x'.repeat(5000), 1000);
  assert.equal(long.clipped, true);
  assert.ok(long.text.startsWith('x'.repeat(1000)));
  assert.ok(long.text.includes('原始 5000 字符'));
});

test('前端客户端：未探测到本机服务时直接报可读错误（不会向外发请求）', async () => {
  LM.resetLocalMachineProbe();
  assert.equal(LM.localMachineAvailable(), false);
  assert.equal(LM.localMachineInfo(), null);
});

test('安全：本机客户端只请求同源相对路径（/api/local/*），不走中继域名或第三方地址', () => {
  const src = fsp.readFileSync(new URL('../js/localmachine.js', import.meta.url), 'utf8');
  const urls = [...src.matchAll(/'(\/api\/local\/[a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(urls)].sort(), ['/api/local/fs', '/api/local/screenshot', '/api/local/session', '/api/local/shell']);
  assert.doesNotMatch(src, /https?:\/\//, '不得出现绝对 URL');
});
