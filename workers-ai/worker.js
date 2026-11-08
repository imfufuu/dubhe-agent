// Dedicated, keyless Workers AI gateway. Never forward to AI Gateway providers.
import { CF_CHAT_MODELS, CF_AGENT_CHAT_IDS, CF_DISABLED_PAID, CF_IMAGE_MODEL, CF_VISION_MODEL, CF_DECISION_MODELS, cfChatAvailable } from '../js/cloudflare-ai-catalog.js';
export const MODELS = CF_CHAT_MODELS;
// Legacy class retained solely for existing deployment migration history.
// No inference path uses it; existing stored data is not deleted.
export class Quota {
  async fetch() { return new Response('Quota retired', { status: 410 }); }
  async alarm() { /* retire any previously scheduled cleanup */ }
}
const MAX_BODY = 180000, MAX_OUTPUT = 2048;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: { message } }, status);
function sse(result, model) {
  const message = result.choices?.[0]?.message || result;
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map((c, index) => ({
    index, id: c.id || `call_${index}`, type: 'function', function: {
      name: c.function?.name || c.name || '',
      arguments: typeof (c.function?.arguments ?? c.arguments) === 'string' ? (c.function?.arguments ?? c.arguments) : JSON.stringify(c.function?.arguments ?? c.arguments ?? {}),
    },
  })) : [];
  const delta = { role: 'assistant', content: typeof message.content === 'string' ? message.content : (typeof result.response === 'string' ? result.response : ''), ...(calls.length ? { tool_calls: calls } : {}) };
  const event = { id: crypto.randomUUID(), object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: result.usage };
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
function inferenceFailure(error) {
  if (Number(error?.status ?? error?.statusCode) === 429) return fail('Cloudflare Workers AI 限流或账号额度不足；请查看 Cloudflare 控制台。', 429);
  return fail('Workers AI 推理失败；可能已产生费用，请查看 Cloudflare 日志，勿盲目重试。', 502);
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
  if (!body || body.model !== CF_IMAGE_MODEL || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 2048) return fail('仅支持 FLUX.1 Schnell，prompt 最长 2048 字符。');
  if ((body.n != null && body.n !== 1) || body.size || body.stream || body.quality || body.background || body.reference_paths) return fail('目前仅支持单张文生图与模型默认尺寸，不支持参考图或尺寸/质量参数。');
  const run = await specialized(() => env.AI.run(CF_IMAGE_MODEL, { prompt: body.prompt.trim(), steps: 4 }));
  if (run.error) return run.error;
  const info = imageInfo(run.result?.image);
  if (!info) return fail('图像生成结果无效；可能已产生费用，请勿自动重试。', 502);
  return json({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: info.raw, width: info.width, height: info.height }] });
}
async function handleVision(body, env) {
  if (!body || body.model !== CF_VISION_MODEL || typeof body.prompt !== 'string' || body.prompt.length > 5000) return fail('识图参数不合法。');
  const image = String(body.image || '');
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
  if (!match || match[1].length > Math.ceil(2 * 1024 * 1024 * 4 / 3) + 4) return fail('仅接受 2 MiB 内的 PNG/JPEG/WebP data URL，不接受远程地址。');
  const run = await specialized(() => env.AI.run(CF_VISION_MODEL, { task: 'query', question: body.prompt || 'Describe this image.', image, max_tokens: 1024, reasoning: false }));
  if (run.error) return run.error;
  if (typeof run.result?.answer !== 'string' || !run.result.answer.trim()) return fail('识图结果无效；请勿自动重试。', 502);
  return json({ text: run.result.answer, usage: run.result.metrics || null });
}
async function handleDecision(body, env) {
  const spec = body && Object.hasOwn(CF_DECISION_MODELS, body.model) ? CF_DECISION_MODELS[body.model] : null;
  if (!spec || typeof body.state !== 'string' || !body.state.trim() || body.state.length > 16000) return fail('决策模型或 state 无效。');
  const key = spec.extraction ? 'fields' : 'questions';
  const entries = body[key];
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || !Object.keys(entries).length || Object.keys(entries).length > 16) return fail(`${key} 必须是包含 1 至 16 项的对象。`);
  const inputs = { model: spec.selector, state: body.state, [key]: entries };
  const run = await specialized(() => env.AI.run(body.model, inputs));
  if (run.error) return run.error;
  if (!run.result?.answers || typeof run.result.answers !== 'object') return fail('决策结果无效；请勿自动重试。', 502);
  return json(run.result);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && url.pathname === '/v1/models') return json({ object: 'list', data: Object.keys(MODELS).filter(id => cfChatAvailable(id) && CF_AGENT_CHAT_IDS.includes(id)).map(id => ({ id, object: 'model', owned_by: 'cloudflare', planned_deprecation: MODELS[id].plannedDeprecation || null })) });
    if (request.method === 'GET' && url.pathname === '/v1/catalog') return json({ chat: Object.keys(MODELS).map(id => ({ id, available: cfChatAvailable(id), agent_tools: CF_AGENT_CHAT_IDS.includes(id), planned_deprecation: MODELS[id].plannedDeprecation || null })), image: [CF_IMAGE_MODEL], vision: [CF_VISION_MODEL], decision: Object.keys(CF_DECISION_MODELS), paid_only_disabled: CF_DISABLED_PAID });
    if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/images/generations', '/v1/vision', '/v1/decisions'].includes(url.pathname)) return fail('Not found', 404);
    if (!env.AI) return fail('Workers AI 未配置。', 503);
    const maxBody = url.pathname === '/v1/vision' ? 3 * 1024 * 1024 : MAX_BODY;
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
    if (url.pathname === '/v1/images/generations') return handleImage(body, env);
    if (url.pathname === '/v1/vision') return handleVision(body, env);
    if (url.pathname === '/v1/decisions') return handleDecision(body, env);
    if (!body || typeof body !== 'object' || !cfChatAvailable(body.model)) return fail('只允许此 Worker 明确列出的 Cloudflare Hosted Models。');
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 1000) return fail('messages 必须是非空数组。');
    if (body.messages.some(m => !m || !['system', 'user', 'assistant', 'tool'].includes(m.role) || (m.content != null && typeof m.content !== 'string'))) return fail('目前仅支持文本消息，不支持图像、音频或文件。');
    const messages = body.messages.map(m => {
      const out = { role: m.role, content: m.content ?? null };
      for (const key of ['name', 'tool_call_id', 'tool_calls']) if (m[key] != null) out[key] = m[key];
      return out;
    });
    if (body.tools != null && (!Array.isArray(body.tools) || body.tools.some(t => t?.type !== 'function' || !t.function?.name))) return fail('只支持 function tools。');
    if (body.tools?.length && !CF_AGENT_CHAT_IDS.includes(body.model)) return fail('此模型只开放纯文本聊天，尚未适配 Agent function calling；请选择 GPT-OSS 或 Llama 3.3。');
    const requested = body.max_tokens == null ? MAX_OUTPUT : Number(body.max_tokens);
    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_OUTPUT) return fail(`max_tokens 必须在 1–${MAX_OUTPUT} 之间。`);
    let result;
    try {
      const inputs = { messages, max_tokens: requested, stream: false };
      if (body.tools?.length) inputs.tools = body.tools.map(t => t.function);
      if (typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2) inputs.temperature = body.temperature;
      result = await env.AI.run(body.model, inputs);
    } catch (e) {
      return inferenceFailure(e);
    }
    if (!result || typeof result !== 'object' || result.error || (!result.response && !result.tool_calls && !result.choices)) return fail('Workers AI 返回了无效响应。', 502);
    return sse(result, body.model);
  },
};
