// ─── 自注册工具注册表 / Self-registering Tool Registry (2026-11-08) ──────────
// Agent 可以在运行时通过 `tool_registry` 工具注册、读取、更新、启用/停用和删除自己的工具，
// 并在之后的回合里像内置工具一样调用它们。安全边界（刻意保守）：
//   · 名称强制 custom_ 前缀，绝不能覆盖或删除任何内置工具；
//   · handler 是「声明式」白名单（模板 / 文本变换 / 安全算式 / 常量 / 时间 / 回显），
//     不接受 JS 源码、eval、URL 或任意 shell —— Agent 无法用它给自己造一个执行后门；
//   · 所有变更（register/update/delete/enable/disable）必须持一次性用户确认票据；
//     Agent 只能拿到「待确认请求」，批准动作只存在于 UI，工具侧不提供 approve；
//   · 最多 24 个工具 / 64 KiB，本地持久化，可按名称读取完整定义（含 handler 配置）审计。
// 纯逻辑模块：浏览器用 localStorage，Node 测试环境自动退回内存存储。
const STORAGE_KEY = 'dubhe.agent.self-tools.v1';
const MAX_TOOLS = 24;
const MAX_BYTES = 64 * 1024;
const APPROVAL_TTL_MS = 5 * 60 * 1000;
const NAME_RE = /^custom_[a-z0-9_]{1,48}$/;
export const HANDLER_KINDS = Object.freeze(['constant', 'text_template', 'text_transform', 'calculator', 'timestamp', 'echo']);
const TRANSFORM_OPS = Object.freeze(['upper', 'lower', 'trim', 'reverse', 'length', 'json']);

let memoryStore = null;
let hooks = { onApprovalRequest: null };
const pending = new Map();   // token -> { action, summary, createdAt }
const approved = new Set();  // 一次性票据，消费即删除

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const id = () => (globalThis.crypto?.randomUUID?.() || `tok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
const storage = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};
function load() {
  const s = storage();
  try {
    const raw = s ? s.getItem(STORAGE_KEY) : memoryStore;
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x === 'object') : [];
  } catch { return []; }
}
function save(list) {
  const raw = JSON.stringify(list);
  if (raw.length > MAX_BYTES) throw new Error('自注册工具总量超过 64 KiB，请先删除一些工具。');
  const s = storage();
  if (s) s.setItem(STORAGE_KEY, raw); else memoryStore = raw;
  return true;
}
export function configureRegistryHooks(next = {}) { hooks = { ...hooks, ...next }; }
export function resetRegistryForTests() {
  memoryStore = null; pending.clear(); approved.clear(); hooks = { onApprovalRequest: null };
  try { storage()?.removeItem(STORAGE_KEY); } catch { /* private mode */ }
}

// ── 用户确认门 ────────────────────────────────────────────────────────────
function sweep() {
  const now = Date.now();
  for (const [token, item] of pending) if (now - item.createdAt > APPROVAL_TTL_MS) pending.delete(token);
}
export function pendingApprovals() {
  sweep();
  return [...pending].map(([token, item]) => ({ token, action: item.action, summary: item.summary, createdAt: item.createdAt }));
}
export function approvePending(token, { autoRun = false } = {}) {
  sweep();
  const key = String(token || '');
  const item = pending.get(key);
  if (!item) return false;
  pending.delete(key);
  if (autoRun && typeof item.operation === 'function') {
    // UI 点「允许」：直接完成这次变更（操作体只在注册时由本模块生成，不来自模型）。
    try { const list = load(); item.operation(list); save(list); } catch { approved.add(key); }
  } else {
    approved.add(key); // Agent 带同一票据重试时消费
  }
  return true;
}
export function denyPending(token) {
  sweep();
  return pending.delete(String(token));
}
function requireApproval(action, summary, confirmToken, operation = null) {
  const token = String(confirmToken || '');
  if (token && approved.has(token)) { approved.delete(token); return null; } // 一次性消费
  sweep();
  const existing = [...pending].find(([, item]) => item.action === action && item.summary === summary);
  const issued = existing ? existing[0] : id();
  if (!existing) {
    pending.set(issued, { action, summary, createdAt: Date.now(), operation });
    try { hooks.onApprovalRequest?.({ token: issued, action, summary }); } catch { /* UI 未挂载 */ }
  }
  return {
    needsConfirmation: true,
    confirmToken: issued,
    message: `⏸ 需要用户安全确认：${summary}。请在输入框「调节器 → 自注册工具 → 待确认」里点「允许」；批准后带 confirm_token=${issued} 重试同一操作。工具未被修改，也没有执行任何副作用。`,
  };
}

// ── 定义校验 ──────────────────────────────────────────────────────────────
function validateDefinition(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) throw new Error('definition 必须是对象');
  const name = String(def.name || '').trim();
  if (!NAME_RE.test(name)) throw new Error('工具名必须以 custom_ 开头，只含小写字母/数字/下划线（最长 48 字符），不能覆盖内置工具');
  const description = String(def.description || '').trim().slice(0, 600);
  if (!description) throw new Error('description 不能为空');
  const parameters = def.parameters && typeof def.parameters === 'object' && !Array.isArray(def.parameters)
    ? def.parameters : { type: 'object', properties: {} };
  if (parameters.type && parameters.type !== 'object') throw new Error('parameters.type 只能是 object');
  const props = parameters.properties && typeof parameters.properties === 'object' ? parameters.properties : {};
  if (Object.keys(props).length > 16) throw new Error('参数最多 16 个');
  for (const [key, spec] of Object.entries(props)) {
    if (!/^[a-z0-9_]{1,32}$/.test(key)) throw new Error(`参数名不合法：${key}`);
    if (!['string', 'number', 'integer', 'boolean'].includes(String(spec?.type || ''))) throw new Error(`参数 ${key} 的 type 不合法`);
  }
  const handler = def.handler && typeof def.handler === 'object' ? def.handler : null;
  if (!handler || !HANDLER_KINDS.includes(handler.kind)) throw new Error(`handler.kind 必须是 ${HANDLER_KINDS.join(' / ')} 之一`);
  if (handler.kind === 'text_template' && (typeof handler.template !== 'string' || handler.template.length > 2000)) throw new Error('text_template 需要不超过 2000 字符的 template');
  if (handler.kind === 'text_transform' && !TRANSFORM_OPS.includes(handler.op)) throw new Error(`text_transform.op 必须是 ${TRANSFORM_OPS.join(' / ')} 之一`);
  if (handler.kind === 'constant' && typeof handler.value !== 'string') throw new Error('constant 需要字符串 value');
  if (typeof handler.config === 'string' && handler.config.length > 2000) throw new Error('handler 配置过长');
  const risk = def.risk === 'medium' ? 'medium' : 'low';
  return {
    name, description,
    parameters: { type: 'object', properties: props, ...(Array.isArray(parameters.required) ? { required: parameters.required.filter((k) => typeof k === 'string').slice(0, 16) } : {}) },
    handler: { ...handler }, risk,
  };
}

// ── CRUD（全部经确认门）────────────────────────────────────────────────────
export function listRegisteredTools() { return load(); }
export function readRegisteredTool(name) { return load().find((t) => t.name === String(name || '').trim()) || null; }
export function registeredToolDefinitions() {
  return load().filter((t) => t.enabled !== false).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
export function isRegisteredToolName(name) { return !!readRegisteredTool(name); }

function mutate(action, summary, confirmToken, fn) {
  const gate = requireApproval(action, summary, confirmToken, fn);
  if (gate) return gate;
  const list = load();
  const result = fn(list);
  save(list);
  return { ok: true, ...result };
}
export function registerTool(def, { confirmToken = '', origin = 'agent' } = {}) {
  const clean = validateDefinition(def);
  if (load().some((t) => t.name === clean.name)) return { ok: false, error: `工具 ${clean.name} 已存在；请用 update 修改或先 delete。` };
  if (load().length >= MAX_TOOLS) return { ok: false, error: `最多 ${MAX_TOOLS} 个自注册工具。` };
  return mutate('register', `注册新工具 ${clean.name}（${clean.handler.kind}）`, confirmToken, (list) => {
    const now = new Date().toISOString();
    list.push({ ...clean, enabled: true, origin, createdAt: now, updatedAt: now });
    return { tool: clean.name };
  });
}
export function updateTool(name, patch, { confirmToken = '' } = {}) {
  const key = String(name || '').trim();
  const old = readRegisteredTool(key);
  if (!old) return { ok: false, error: `找不到自注册工具 ${key}` };
  const clean = validateDefinition({ ...old, ...(patch && typeof patch === 'object' ? patch : {}), name: key });
  return mutate('update', `更新工具 ${key} 的定义`, confirmToken, (list) => {
    const i = list.findIndex((t) => t.name === key);
    list[i] = { ...list[i], ...clean, updatedAt: new Date().toISOString() };
    return { tool: key };
  });
}
export function deleteTool(name, { confirmToken = '' } = {}) {
  const key = String(name || '').trim();
  if (!readRegisteredTool(key)) return { ok: false, error: `找不到自注册工具 ${key}` };
  return mutate('delete', `删除工具 ${key}（不可恢复）`, confirmToken, (list) => {
    const i = list.findIndex((t) => t.name === key);
    if (i >= 0) list.splice(i, 1);
    return { tool: key };
  });
}
export function setToolEnabled(name, enabled, { confirmToken = '' } = {}) {
  const key = String(name || '').trim();
  if (!readRegisteredTool(key)) return { ok: false, error: `找不到自注册工具 ${key}` };
  return mutate(enabled ? 'enable' : 'disable', `${enabled ? '启用' : '停用'}工具 ${key}`, confirmToken, (list) => {
    const t = list.find((x) => x.name === key);
    t.enabled = !!enabled; t.updatedAt = new Date().toISOString();
    return { tool: key, enabled: !!enabled };
  });
}

// ── 执行（声明式 handler，绝不执行模型提供的代码）────────────────────────────
function checkArgs(tool, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const required = Array.isArray(tool.parameters?.required) ? tool.parameters.required : [];
  for (const key of required) if (a[key] == null || a[key] === '') throw new Error(`缺少必填参数 ${key}`);
  for (const [key, spec] of Object.entries(tool.parameters?.properties || {})) {
    if (a[key] == null) continue;
    const type = String(spec?.type || '');
    if (type === 'number' || type === 'integer') { if (!Number.isFinite(Number(a[key]))) throw new Error(`参数 ${key} 必须是数字`); }
    else if (type === 'boolean') { if (typeof a[key] !== 'boolean') throw new Error(`参数 ${key} 必须是布尔值`); }
    else if (typeof a[key] !== 'string' && typeof a[key] !== 'number') throw new Error(`参数 ${key} 必须是字符串`);
  }
  return a;
}
function renderTemplate(template, args) {
  return String(template).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key) => esc(args[key] ?? ''));
}
// 递归下降的四则运算：没有 eval / Function / 变量名，模型提供的表达式不可能变成代码。
function safeArithmetic(expression) {
  const expr = String(expression || '').replace(/\s+/gu, '');
  if (!expr || expr.length > 200 || !/^[\d.+\-*/()%^]+$/.test(expr)) throw new Error('算式只允许数字与 + - * / ( ) % ^，最长 200 字符');
  const tokens = expr.match(/\d+(?:\.\d+)?|[()+\-*/%^]/gu) || [];
  if (tokens.join('') !== expr) throw new Error('算式包含无法解析的字符');
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  function primary() {
    const t = take();
    if (t === '(') { const v = parseExpr(); if (take() !== ')') throw new Error('括号不匹配'); return v; }
    if (t && /^\d/.test(t)) return Number(t);
    throw new Error('算式格式不合法');
  }
  function unary() {
    const t = peek();
    if (t === '-') { take(); return -unary(); }
    if (t === '+') { take(); return unary(); }
    return primary();
  }
  function power() {
    const base = unary();
    return peek() === '^' ? (take(), Math.pow(base, power())) : base;
  }
  function term() {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = take(), r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function parseExpr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = take(), r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const value = parseExpr();
  if (i !== tokens.length || !Number.isFinite(value)) throw new Error('算式无法求值或结果不是有限数字');
  return value;
}
export function invokeRegisteredTool(name, args = {}, { confirmToken = '' } = {}) {
  const tool = readRegisteredTool(name);
  if (!tool) throw new Error(`找不到自注册工具 ${name}`);
  if (tool.enabled === false) throw new Error(`工具 ${name} 已停用`);
  if (tool.risk === 'medium') {
    const gate = requireApproval('invoke', `调用中风险工具 ${name}`, confirmToken);
    if (gate) return { ...gate, pending: true };
  }
  const a = checkArgs(tool, args);
  const h = tool.handler || {};
  switch (h.kind) {
    case 'constant': return String(h.value || '');
    case 'text_template': return renderTemplate(h.template || '', a);
    case 'text_transform': {
      const text = String(a.text ?? a.value ?? '');
      switch (h.op) {
        case 'upper': return text.toUpperCase();
        case 'lower': return text.toLowerCase();
        case 'trim': return text.trim();
        case 'reverse': return [...text].reverse().join('');
        case 'length': return String([...text].length);
        case 'json': return JSON.stringify(a, null, 2);
        default: throw new Error('未知的 text_transform 操作');
      }
    }
    case 'calculator': return String(safeArithmetic(String(a.expression ?? '')));
    case 'timestamp': {
      const tz = String(a.timezone || '').trim();
      try { return tz ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeStyle: 'long', timeZone: tz }).format(new Date()) : new Date().toISOString(); }
      catch { return new Date().toISOString(); }
    }
    case 'echo': return JSON.stringify(a, null, 2);
    default: throw new Error('未知的 handler 类型');
  }
}

/** tool_registry 工具的统一入口；返回给模型的纯文本结果。 */
export function handleRegistryAction(args = {}, ctx = {}) {
  const action = String(args.action || '').trim().toLowerCase();
  const summary = (r) => (r && r.needsConfirmation ? r.message : JSON.stringify(r, null, 2));
  try {
    switch (action) {
      case 'list': {
        const tools = listRegisteredTools();
        return `自注册工具 ${tools.length}/${MAX_TOOLS}：\n` + (tools.length
          ? tools.map((t) => `- ${t.name} [${t.enabled === false ? '停用' : '启用'}] ${t.description}（${t.handler?.kind}）`).join('\n')
          : '（暂无；可用 action=register 创建，需用户确认）')
          + `\n内置工具由 tool_library 查询，不能用本接口删除或覆盖。`;
      }
      case 'read': return JSON.stringify(readRegisteredTool(args.name) || { error: `找不到 ${args.name}` }, null, 2);
      case 'pending': return JSON.stringify(pendingApprovals(), null, 2);
      case 'register': return summary(registerTool(args.definition, { confirmToken: args.confirm_token, origin: 'agent' }));
      case 'update': return summary(updateTool(args.name, args.patch || args.definition, { confirmToken: args.confirm_token }));
      case 'delete': return summary(deleteTool(args.name, { confirmToken: args.confirm_token }));
      case 'enable': return summary(setToolEnabled(args.name, true, { confirmToken: args.confirm_token }));
      case 'disable': return summary(setToolEnabled(args.name, false, { confirmToken: args.confirm_token }));
      case 'invoke': {
        const name = String(args.name || '').trim();
        if (!NAME_RE.test(name)) return '只能用 invoke 调用 custom_ 前缀的自注册工具；内置工具请直接调用。';
        const out = invokeRegisteredTool(name, args.args && typeof args.args === 'object' ? args.args : {}, { confirmToken: args.confirm_token });
        return typeof out === 'string' ? out : JSON.stringify(out, null, 2);
      }
      case 'help': return [
        'tool_registry：自注册工具的注册 / 读取 / 管理 / 调用。',
        '可用 action：list, read, register, update, delete, enable, disable, invoke, pending, help。',
        'register/update/delete/enable/disable 都需要用户确认：第一次调用返回 confirm_token，',
        '用户在「调节器 → 自注册工具 → 待确认」批准后，带同一个 confirm_token 重试即可（票据一次性、5 分钟有效）。',
        `名称必须 custom_ 开头；handler.kind：${HANDLER_KINDS.join(' / ')}；模型提供的代码永远不会被执行。`,
        'definition 示例：{name:"custom_greet",description:"打招呼",parameters:{type:"object",properties:{who:{type:"string"}},required:["who"]},handler:{kind:"text_template",template:"你好，{{who}}！"}}',
      ].join('\n');
      default: return `未知 action：${action}；用 action=help 查看用法。`;
    }
  } catch (err) {
    return `tool_registry 失败：${err?.message || err}`;
  }
}

/** UI 侧直接调用（已经过用户点击，不需要票据链）。 */
export function uiDeleteTool(name) {
  const key = String(name || '').trim();
  const list = load().filter((t) => t.name !== key);
  save(list);
  return true;
}
export function uiSetToolEnabled(name, enabled) {
  const list = load();
  const t = list.find((x) => x.name === String(name || '').trim());
  if (!t) return false;
  t.enabled = !!enabled; t.updatedAt = new Date().toISOString();
  save(list);
  return true;
}
