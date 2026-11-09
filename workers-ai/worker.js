// Dedicated, keyless Workers AI gateway. Never forward to AI Gateway providers.
//
// 2026-11-08 hardening / repair:
//  · GET /v1/models now lists EVERY enabled chat model (agent_tools marks the tool-capable subset),
//    fixing the "model list incomplete" report. ?agent_tools=1 keeps the old behaviour for old clients.
//  · Function-calling requests no longer fail with HTTP 502: tool schemas are normalised from both
//    OpenAI-style and flat Workers AI styles, and a rejected schema is retried exactly once in the
//    other shape (parameter rejection only, never an ambiguous inference failure).
//  · HTTP 400 sources removed: case-insensitive model IDs, clamp (not reject) max_tokens/temperature,
//    text-part arrays accepted in messages, chat-only models degrade to a tool-free answer instead
//    of refusing the request when an Agent client sends tools.
//  · Upstream errors are surfaced in a short, redacted form so 502s are diagnosable.
//  · Optional gateway authentication (GATEWAY_TOKEN secret + ALLOWED_ORIGINS var); see AUTH_MATRIX.md.
import { CF_CHAT_MODELS, CF_AGENT_CHAT_IDS, CF_DISABLED_PAID, CF_IMAGE_MODEL, CF_VISION_MODEL, CF_DECISION_MODELS, cfChatAvailable, cfCanonicalModelId, cfModelCard, cfModelTags } from '../js/cloudflare-ai-catalog.js';
export const MODELS = CF_CHAT_MODELS;
// Legacy class retained solely for existing deployment migration history.
// No inference path uses it; existing stored data is not deleted.
export class Quota {
  async fetch() { return new Response('Quota retired', { status: 410 }); }
  async alarm() { /* retire any previously scheduled cleanup */ }
}
const MAX_BODY = 180000, MAX_OUTPUT = 8192, DEFAULT_OUTPUT = 2048;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dubhe-Gateway-Token', 'Cache-Control': 'no-store' };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
const fail = (message, status = 400) => json({ error: { message } }, status);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ── 网关鉴权（可选配置，但私有部署强烈建议启用）──
// GATEWAY_TOKEN 由 `wrangler secret put GATEWAY_TOKEN` 写入，绝不进仓库。
// ALLOWED_ORIGINS 是逗号分隔的 Origin 白名单（留空或 * 表示不限制）。
// 静态前端无法保守服务端秘密：见 AUTH_MATRIX.md，真正的多用户隔离请用 Cloudflare Access。
function allowedOrigins(env) {
  return String(env?.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function originIsAllowed(env, request) {
  const allow = allowedOrigins(env);
  const origin = String(request.headers.get('origin') || '').trim();
  return !allow.length || allow.includes('*') || !origin || allow.includes(origin);
}
// 定长比较，避免用 === 提前返回造成时序侧信道（长度仍会暴露，令牌本身不会）。
function safeEqual(a, b) {
  const A = String(a), B = String(b);
  let diff = A.length ^ B.length;
  for (let i = 0; i < Math.max(A.length, B.length); i++) diff |= (A.charCodeAt(i) || 0) ^ (B.charCodeAt(i) || 0);
  return diff === 0;
}
function presentedToken(request) {
  const bearer = /^Bearer\s+(.+)$/iu.exec(String(request.headers.get('authorization') || '').trim());
  const raw = bearer ? bearer[1] : String(request.headers.get('x-dubhe-gateway-token') || '');
  return raw.trim().slice(0, 512);
}
function authorize(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return originIsAllowed(env, request) ? null : json({ error: { message: 'Origin 不在允许列表。' } }, 403);
  // 健康检查不含任何秘密，保持无需令牌，便于部署探针。
  if (request.method === 'GET' && (path === '/health' || path === '/v1/health')) return null;
  if (!originIsAllowed(env, request)) return json({ error: { message: 'Origin 不在允许列表。' } }, 403);
  const expected = String(env?.GATEWAY_TOKEN || '').trim();
  if (!expected) return null; // 未配置 secret：保持公开，由部署者用 Cloudflare Access / WAF / 额度限制保护
  const got = presentedToken(request);
  if (!got || !safeEqual(got, expected)) {
    return json({ error: { message: '未授权：请提供网关访问令牌。', code: 'gateway_token_required' } }, 401,
      { 'WWW-Authenticate': 'Bearer realm="dubhe-workers-ai"' });
  }
  return null;
}
function withCors(response, env, request) {
  const allow = allowedOrigins(env);
  const origin = String(request.headers.get('origin') || '').trim();
  if (allow.length && !allow.includes('*') && origin && allow.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.append('Vary', 'Origin');
  }
  return response;
}

function upstreamDetail(error) {
  const raw = String(error?.message ?? error ?? '').replace(/\s+/gu, ' ').trim().slice(0, 220);
  // Never echo a credential-looking string from an upstream error into a public response.
  return raw.replace(/[A-Za-z0-9_-]{32,}/gu, '<redacted>');
}
function inferenceFailure(error) {
  if (Number(error?.status ?? error?.statusCode) === 429) return fail('Cloudflare Workers AI 限流或账号额度不足；请查看 Cloudflare 控制台。', 429);
  const detail = upstreamDetail(error);
  return fail(`Workers AI 推理失败${detail ? `（上游：${detail}）` : ''}；可能已产生费用，请查看 Cloudflare 日志，勿盲目重试。`, 502);
}

// ── OpenAI-compatible SSE wrapper around a single non-streaming inference ──
function normaliseCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((c, index) => {
    const fn = c?.function || c || {};
    const args = fn.arguments ?? c?.arguments ?? {};
    return {
      index,
      id: String(c?.id || `call_${index}`),
      type: 'function',
      function: {
        name: String(fn.name || c?.name || '').slice(0, 128),
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    };
  }).filter(c => c.function.name);
}
function sse(result, model) {
  const choice = Array.isArray(result?.choices) ? result.choices[0] : null;
  const message = choice?.message || result || {};
  const calls = normaliseCalls(message.tool_calls || result?.tool_calls);
  let content = typeof message.content === 'string' ? message.content
    : (typeof result?.response === 'string' ? result.response
      : (typeof result?.output_text === 'string' ? result.output_text : ''));
  // Reasoning-only models can spend the whole budget on hidden reasoning and return "".
  // Surface the reasoning text instead of an empty answer (the client also has an empty-body retry).
  if (!content && !calls.length) {
    const reasoning = message.reasoning_content || result?.reasoning_content || result?.reasoning;
    if (typeof reasoning === 'string' && reasoning.trim()) content = reasoning.trim();
  }
  const delta = { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) };
  const usage = normaliseUsage(result, choice, content);
  // 标准 OpenAI SSE：正文 chunk 不带 usage，最后一个空 choices chunk 携带完整用量。
  // 旧实现把 result.usage 原样塞进第一个 chunk，缺 total_tokens / 字段命名不一 / 上游无 usage 时全空。
  const event = {
    id: crypto.randomUUID(), object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta, finish_reason: calls.length ? 'tool_calls' : (choice?.finish_reason || 'stop') }],
  };
  const tail = {
    id: event.id, object: 'chat.completion.chunk', model, choices: [], usage,
  };
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify(tail)}\n\ndata: [DONE]\n\n`, { headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

// Cloudflare 不同模型返回的用量字段名不一致（usage / metrics / input_tokens / output_tokens…），
// 统一成 OpenAI 形状并补齐 total_tokens；完全没有用量时按输出长度估算并明确标注 estimated。
function normaliseUsage(result, choice, content) {
  const raw = result?.usage || result?.metrics || choice?.usage || null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const prompt = num(raw?.prompt_tokens ?? raw?.input_tokens ?? raw?.input ?? raw?.prompt);
  const completion = num(raw?.completion_tokens ?? raw?.output_tokens ?? raw?.output ?? raw?.completion);
  const total = num(raw?.total_tokens) || (prompt + completion);
  if (!prompt && !completion && !total) {
    const est = Math.max(1, Math.ceil(String(content || '').length / 4));
    return { prompt_tokens: 0, completion_tokens: est, total_tokens: est, estimated: true };
  }
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total || (prompt + completion) };
}
// The Worker owner controls access and billing; application-side daily quotas are disabled.
async function specialized(work) {
  try { return { result: await work() }; }
  catch (error) { return { error: inferenceFailure(error) }; }
}
// Decode only to inspect the returned image. Never fetch image URLs.
function imageInfo(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 8 * 1024 * 1024) return null;
  const raw = encoded.replace(/^data:image\/(?:png|jpeg|webp);base64,/i, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  let bytes; try { const s = atob(raw); bytes = Uint8Array.from(s, c => c.charCodeAt(0)); } catch { return null; }
  let width = 0, height = 0;
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes.length >= 24) {
    const view = new DataView(bytes.buffer); width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 9 < bytes.length) {
      if (bytes[p] !== 255) { p++; continue; }
      const marker = bytes[p + 1], len = (bytes[p + 2] << 8) | bytes[p + 3];
      if (len < 2 || p + 2 + len > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) { height = (bytes[p + 5] << 8) | bytes[p + 6]; width = (bytes[p + 7] << 8) | bytes[p + 8]; break; }
      p += 2 + len;
    }
  }
  if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096)) return null;
  return { raw, width, height };
}
async function handleImage(body, env) {
  const id = cfCanonicalModelId(body?.model, [CF_IMAGE_MODEL]);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!id || !prompt || prompt.length > 2048) return fail('仅支持 FLUX.1 Schnell，prompt 最长 2048 字符。');
  if ((body.n != null && body.n !== 1) || body.size || body.stream || body.quality || body.background || body.reference_paths) return fail('目前仅支持单张文生图与模型默认尺寸，不支持参考图或尺寸/质量参数。');
  const run = await specialized(() => env.AI.run(id, { prompt, steps: 4 }));
  if (run.error) return run.error;
  const info = imageInfo(run.result?.image);
  if (!info) return fail('图像生成结果无效；可能已产生费用，请勿自动重试。', 502);
  return json({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: info.raw, width: info.width, height: info.height }], usage: run.result?.usage || run.result?.metrics || null });
}
async function handleVision(body, env) {
  const id = cfCanonicalModelId(body?.model, [CF_VISION_MODEL]);
  if (!id || typeof body?.prompt !== 'string' || body.prompt.length > 5000) return fail('识图参数不合法。');
  const image = String(body.image || '');
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
  if (!match || match[1].length > Math.ceil(2 * 1024 * 1024 * 4 / 3) + 4) return fail('仅接受 2 MiB 内的 PNG/JPEG/WebP data URL，不接受远程地址。');
  const run = await specialized(() => env.AI.run(id, { task: 'query', question: body.prompt || 'Describe this image.', image, max_tokens: 1024, reasoning: false }));
  if (run.error) return run.error;
  if (typeof run.result?.answer !== 'string' || !run.result.answer.trim()) return fail('识图结果无效；请勿自动重试。', 502);
  return json({ text: run.result.answer, usage: run.result.metrics || null });
}
async function handleDecision(body, env) {
  const canonical = cfCanonicalModelId(body?.model, Object.keys(CF_DECISION_MODELS));
  const spec = canonical ? CF_DECISION_MODELS[canonical] : null;
  if (!spec || typeof body?.state !== 'string' || !body.state.trim() || body.state.length > 16000) return fail('决策模型或 state 无效。');
  const key = spec.extraction ? 'fields' : 'questions';
  const entries = body[key];
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || !Object.keys(entries).length || Object.keys(entries).length > 16) return fail(`${key} 必须是包含 1 至 16 项的对象。`);
  const inputs = { model: spec.selector, state: body.state, [key]: entries };
  const run = await specialized(() => env.AI.run(canonical, inputs));
  if (run.error) return run.error;
  if (!run.result?.answers || typeof run.result.answers !== 'object') return fail('决策结果无效；请勿自动重试。', 502);
  return json({ ...run.result, usage: run.result?.usage || run.result?.metrics || null });
}

// ── Request normalisation: accept what real OpenAI-compatible clients send ──
function textContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
    return '';
  }).filter(Boolean).join('\n');
  return '';
}
function normaliseMessages(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000) return null;
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null;
    const role = m.role === 'developer' ? 'system' : String(m.role || '');
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) return null;
    const message = { role, content: textContent(m.content) };
    for (const key of ['name', 'tool_call_id', 'tool_calls', 'tool_call']) if (m[key] != null) message[key] = m[key];
    out.push(message);
  }
  return out;
}
function normaliseTools(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') return null;
    const fn = (t.type === 'function' && t.function) ? t.function : t;
    const name = String(fn.name || '').trim().slice(0, 128);
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) return null;
    const parameters = (fn.parameters && typeof fn.parameters === 'object') ? fn.parameters : { type: 'object', properties: {} };
    out.push({ name, description: String(fn.description || '').slice(0, 2000), parameters });
  }
  return out;
}
function toolShapes(defs) {
  return {
    openai: defs.map(d => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } })),
    flat: defs.map(d => ({ name: d.name, description: d.description, parameters: d.parameters })),
  };
}
// Cloudflare's newer OpenAI-compatible models expect {type:'function',function:{…}} while the
// original function-calling models expect a flat {name,description,parameters}. A 4xx schema
// rejection is deterministic (no tokens generated) so a single retry in the other shape is safe.
async function runWithTools(env, id, inputs, defs) {
  if (!defs.length) return env.AI.run(id, inputs);
  const shapes = toolShapes(defs);
  const preferOpenai = /gpt-oss|glm-|qwen|llama-3\.3|mistral/i.test(id);
  const order = preferOpenai ? ['openai', 'flat'] : ['flat', 'openai'];
  let last;
  for (const shape of order) {
    try { return await env.AI.run(id, { ...inputs, tools: shapes[shape] }); }
    catch (error) {
      last = error;
      const status = Number(error?.status ?? error?.statusCode ?? 0);
      const message = String(error?.message ?? error ?? '');
      const schemaRejection = (status >= 400 && status < 500)
        || /tool|schema|invalid|unsupported|parameter|unexpected|bad request/i.test(message);
      if (!schemaRejection) throw error; // ambiguous failure: never replay
    }
  }
  throw last;
}
const TOOLS_DISABLED_NOTE = '当前模型不支持原生工具调用；本轮已切换为纯文本回答，请勿输出工具调用语法。';

async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'GET' && (path === '/health' || path === '/v1/health')) {
      const ids = Object.keys(MODELS).filter(id => cfChatAvailable(id));
      return json({ ok: true, ai: !!env.AI, models: ids.length, agent_models: CF_AGENT_CHAT_IDS.filter(id => cfChatAvailable(id)).length,
        auth_required: !!String(env.GATEWAY_TOKEN || '').trim(), origin_restricted: allowedOrigins(env).length > 0,
        now: new Date().toISOString() });
    }
    if (request.method === 'GET' && path === '/v1/models') {
      const agentOnly = url.searchParams.get('agent_tools') === '1';
      const ids = Object.keys(MODELS).filter(id => cfChatAvailable(id) && (!agentOnly || CF_AGENT_CHAT_IDS.includes(id)));
      return json({
        object: 'list',
        data: ids.map(id => {
          const card = cfModelCard(id) || {};
          return {
            id, object: 'model', owned_by: 'cloudflare',
            provider: card.provider || 'Cloudflare', vendor: card.vendor || '',
            display_name: card.displayName || id,
            agent_tools: CF_AGENT_CHAT_IDS.includes(id),
            tags: cfModelTags(id),
            planned_deprecation: MODELS[id].plannedDeprecation || null,
          };
        }),
      });
    }
    if (request.method === 'GET' && path === '/v1/catalog') return json({
      chat: Object.keys(MODELS).map(id => ({
        id, available: cfChatAvailable(id), agent_tools: CF_AGENT_CHAT_IDS.includes(id),
        provider: MODELS[id].provider || 'Cloudflare', vendor: MODELS[id].vendor || '',
        display_name: MODELS[id].label || id,
        pricing: { unit: 'neurons', input: MODELS[id].input, output: MODELS[id].output },
        planned_deprecation: MODELS[id].plannedDeprecation || null,
      })),
      image: [CF_IMAGE_MODEL], vision: [CF_VISION_MODEL], decision: Object.keys(CF_DECISION_MODELS),
      paid_only_disabled: CF_DISABLED_PAID,
    });
    if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/images/generations', '/v1/vision', '/v1/decisions'].includes(path)) return fail('Not found', 404);
    if (!env.AI) return fail('Workers AI 未配置。', 503);
    const maxBody = path === '/v1/vision' ? 3 * 1024 * 1024 : MAX_BODY;
    const length = Number(request.headers.get('content-length') || 0);
    if (length > maxBody) return fail('输入过长。', 413);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return fail('只接受 application/json。', 415);
    let raw = '', bytes = 0;
    try {
      const reader = request.body?.getReader(), decoder = new TextDecoder();
      if (!reader) return fail('请求体为空');
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBody) { await reader.cancel(); return fail('输入过长。', 413); }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } catch { return fail('读取请求失败'); }
    let body;
    try { body = JSON.parse(raw); } catch { return fail('请求不是有效 JSON'); }
    if (path === '/v1/images/generations') return handleImage(body, env);
    if (path === '/v1/vision') return handleVision(body, env);
    if (path === '/v1/decisions') return handleDecision(body, env);

    const id = cfCanonicalModelId(body?.model, Object.keys(MODELS));
    if (!id || !cfChatAvailable(id)) return fail('只允许此 Worker 明确列出的 Cloudflare Hosted Models。');
    const messages = normaliseMessages(body.messages);
    if (!messages) return fail('messages 必须是包含合法 role 的非空数组（最多 1000 条）。');
    const tools = normaliseTools(body.tools);
    if (tools === null) return fail('只支持 function tools，名称须为字母/数字/下划线，最多 64 个。');
    const toolCapable = CF_AGENT_CHAT_IDS.includes(id);
    const useTools = toolCapable && tools.length > 0;
    if (tools.length && !toolCapable) {
      // Old behaviour returned HTTP 400 here and broke Agent-mode clients on chat-only models.
      // Degrade gracefully: keep the turn usable, with an explicit instruction to the model.
      messages.unshift({ role: 'system', content: TOOLS_DISABLED_NOTE });
    }
    const requested = Number.isFinite(Number(body.max_tokens)) ? Math.trunc(Number(body.max_tokens)) : DEFAULT_OUTPUT;
    const inputs = { messages, max_tokens: clamp(requested || DEFAULT_OUTPUT, 1, MAX_OUTPUT), stream: false };
    if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) inputs.temperature = clamp(body.temperature, 0, 2);
    if (typeof body.top_p === 'number' && Number.isFinite(body.top_p)) inputs.top_p = clamp(body.top_p, 0, 1);
    if (body.tool_choice && typeof body.tool_choice === 'string') inputs.tool_choice = body.tool_choice.slice(0, 64);
    let result;
    try { result = await runWithTools(env, id, inputs, useTools ? tools : []); }
    catch (e) { return inferenceFailure(e); }
    const hasChoices = Array.isArray(result?.choices) && result.choices.length > 0;
    if (!result || typeof result !== 'object' || result.error
      || (!hasChoices && typeof result.response !== 'string' && !Array.isArray(result.tool_calls))) {
      return fail('Workers AI 返回了无效响应；可能已产生费用，请勿自动重试。', 502);
    }
    return sse(result, id);
}

export default {
  async fetch(request, env) {
    const denied = authorize(request, env);
    if (denied) return withCors(denied, env, request);
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204, headers: cors }), env, request);
    return withCors(await handle(request, env), env, request);
  },
};
