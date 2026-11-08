// 视频生成（generate_video）与子智能体附件（dispatch_subagent.files）的回归测试。
// 全部使用桩 fetch，不访问真实网关。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFS } from '../js/sandbox.js';
import { executeTool, TOOL_DEFS, buildSubagentAttachments, SUB_ATTACH_MAX } from '../js/tools.js';
import {
  VIDEO_GEN_MODELS, DEFAULT_VIDEO_GEN_MODEL, videoSizeFor, planVideoRequest, buildVideoBody,
  videoJobState, imageVariantOf, resolveVideoGenModel, VIDEO_GEN_MENU, videoMenuIdOf,
  pickVideoExtras, VIDEO_EXTRA_SPEC, buildVideoQuoteBody,
} from '../js/video-gen.js';
import { toolFamily } from '../js/toolflow.js';

const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';

test('视频目录：18 个基础模型 + Seedance 2.5 Flex 两个变体（同族），ID 唯一，六族各含文生/图生/参考图三种变体', () => {
  assert.equal(VIDEO_GEN_MODELS.length, 20);
  assert.equal(new Set(VIDEO_GEN_MODELS.map((m) => m.id)).size, 20);
  const flex = VIDEO_GEN_MODELS.filter((m) => m.variant === 'flex');
  assert.deepEqual(flex.map((m) => m.id).sort(), ['seedance-2-5-reference-to-video-flex', 'seedance-2-5-text-to-video-flex']);
  assert.ok(flex.every((m) => m.family === 'Seedance 2.5' && m.seconds[0] === 4 && m.seconds[1] === 30));
  assert.equal(planVideoRequest({ model: 'seedance-2-5-text-to-video-flex', prompt: 'x', seconds: 5, resolution: '720p', aspectRatio: '16:9' }).model, 'seedance-2-5-text-to-video-flex');
  assert.equal(planVideoRequest({ model: 'seedance-2-5-text-to-video-basic', prompt: 'x', seconds: 5, resolution: '720p', aspectRatio: '16:9' }).model, 'seedance-2-5-text-to-video-basic');
  const families = new Map();
  for (const m of VIDEO_GEN_MODELS) {
    if (!families.has(m.family)) families.set(m.family, new Set());
    families.get(m.family).add(m.mode);
  }
  assert.equal(families.size, 4, 'Seedance 2.0 Fast/Mini 已折叠进 2.0 家族');
  for (const [fam, modes] of families) assert.deepEqual([...modes].sort(), ['image', 'reference', 'text'], fam);
  assert.ok(VIDEO_GEN_MODELS.some((m) => m.id === 'seedance-2-5-text-to-video-basic'));
  assert.ok(VIDEO_GEN_MODELS.some((m) => m.id === 'minimax-h3-max-image-to-video'));
  assert.equal(resolveVideoGenModel('no-such-model'), DEFAULT_VIDEO_GEN_MODEL);
  assert.equal(imageVariantOf('seedance-2-0-mini-text-to-video-basic'), 'seedance-2-0-mini-image-to-video-basic');
});

test('设置菜单：每族一项（三种模式合并），仅默认模型标注「默认」', () => {
  assert.equal(VIDEO_GEN_MENU.length, 4);
  assert.equal(new Set(VIDEO_GEN_MENU.map((m) => m.family)).size, 4);
  assert.equal(VIDEO_GEN_MENU.filter((m) => m.tag === '默认').length, 1);
  assert.equal(VIDEO_GEN_MENU.find((m) => m.tag === '默认').id, DEFAULT_VIDEO_GEN_MODEL);
  for (const m of VIDEO_GEN_MENU) assert.ok(m.note.length <= 30, m.note);
  assert.equal(videoMenuIdOf('seedance-2-0-mini-image-to-video-basic'), DEFAULT_VIDEO_GEN_MODEL);
  assert.equal(videoMenuIdOf('minimax-h3-reference-to-video'), 'minimax-h3-text-to-video');
  assert.equal(videoMenuIdOf('no-such-model'), DEFAULT_VIDEO_GEN_MODEL);
});

test('生成模式：Agent 可在合并型号中指定 text / image / reference', () => {
  const base = { model: 'minimax-h3-text-to-video', prompt: 'a cat', seconds: 5, resolution: '768p', aspectRatio: '16:9' };
  assert.equal(planVideoRequest({ ...base, hasImage: false }).model, 'minimax-h3-text-to-video');
  assert.equal(planVideoRequest({ ...base, mode: 'text', hasImage: false }).mode, 'text');
  assert.equal(planVideoRequest({ ...base, mode: 'image', hasImage: true }).model, 'minimax-h3-image-to-video');
  const ref = planVideoRequest({ ...base, mode: 'reference', hasImage: true });
  assert.equal(ref.ok, true); assert.equal(ref.model, 'minimax-h3-reference-to-video'); assert.equal(ref.mode, 'reference');
  // 未指定模式：有参考图→图生；mode=text 却带参考图→按图生
  assert.equal(planVideoRequest({ ...base, hasImage: true }).model, 'minimax-h3-image-to-video');
  assert.equal(planVideoRequest({ ...base, mode: 'text', hasImage: true }).mode, 'image');
  // 缺参考图时图生 / 参考图模式给出明确错误
  const miss = planVideoRequest({ ...base, mode: 'reference', hasImage: false });
  assert.equal(miss.ok, false); assert.match(miss.error, /参考图/);
});

test('尺寸：分辨率档位的短边 + 比例推出 WIDTHxHEIGHT（偶数）', () => {
  assert.equal(videoSizeFor('720p', '16:9'), '1280x720');
  assert.equal(videoSizeFor('480p', '9:16'), '480x854');
  assert.equal(videoSizeFor('1080p', '1:1'), '1080x1080');
  assert.equal(videoSizeFor('720p', '4:3'), '960x720');
  assert.equal(videoSizeFor('720p', '21:9'), '1680x720');
  assert.equal(videoSizeFor('4k', '16:9'), '3840x2160');
  assert.equal(videoSizeFor('2k', '16:9'), '2560x1440');
  assert.equal(videoSizeFor('bogus', '16:9'), null);
});

test('参数校验：时长/分辨率/比例越界或缺参考图时在本地拦下', () => {
  const base = { model: 'seedance-2-0-fast-text-to-video-basic', prompt: '海浪', hasImage: false };
  assert.equal(planVideoRequest({ ...base, seconds: 30 }).ok, false, 'Fast 上限 15 秒');
  assert.equal(planVideoRequest({ ...base, resolution: '1080p' }).ok, false, 'Fast 不支持 1080p');
  assert.equal(planVideoRequest({ ...base, aspectRatio: '2:1' }).ok, false, '比例须在列表内');
  assert.equal(planVideoRequest({ ...base, prompt: '  ' }).ok, false);
  const img = planVideoRequest({ ...base, hasImage: true, seconds: 6, resolution: '720p', aspectRatio: '9:16' });
  assert.equal(img.ok, true);
  assert.equal(img.model, 'seedance-2-0-fast-image-to-video-basic', '文生模型收到参考图自动切到同族图生变体');
  assert.equal(img.size, '720x1280', '720p 竖版 9:16');
  const needImg = planVideoRequest({ model: 'minimax-h3-image-to-video', prompt: 'x', hasImage: false, seconds: 5 });
  assert.equal(needImg.ok, false, '图生模型无参考图时报错');
  assert.match(needImg.error, /input_image/);
  const dflt = planVideoRequest({ model: 'nope', prompt: 'x', hasImage: false });
  assert.equal(dflt.ok, true);
  assert.equal(dflt.model, DEFAULT_VIDEO_GEN_MODEL);
  assert.equal(dflt.seconds, 5, '默认 5 秒');
});

test('请求体：seconds 为字符串整数，size 为 WIDTHxHEIGHT，参考图作为 input_reference', () => {
  const plan = planVideoRequest({ model: 'seedance-2-0-mini-text-to-video-basic', prompt: ' 猫 ', seconds: 4, resolution: '480p', aspectRatio: '16:9', hasImage: false });
  const body = buildVideoBody(plan, ' 猫 ', '');
  assert.deepEqual(body, { model: 'seedance-2-0-mini-text-to-video-basic', prompt: '猫', seconds: '4', size: '854x480' });
  const withImg = buildVideoBody(plan, '猫', PNG_URL);
  assert.deepEqual(withImg.input_reference, { image_url: PNG_URL });
});

test('轮询判定：completed 结束；failed/cancelled/expired 失败；其它继续等待', () => {
  assert.equal(videoJobState({ status: 'completed' }), 'done');
  assert.equal(videoJobState({ status: 'failed' }), 'failed');
  assert.equal(videoJobState({ status: 'expired' }), 'failed');
  assert.equal(videoJobState({ status: 'in_progress' }), 'pending');
  assert.equal(videoJobState({ status: 'queued' }), 'pending');
});

test('TOOL_DEFS：generate_video 已登记，参数与文档一致', () => {
  const def = TOOL_DEFS.find((t) => t.name === 'generate_video');
  assert.ok(def, 'TOOL_DEFS 应含 generate_video');
  assert.deepEqual(def.parameters.required, ['prompt']);
  assert.equal(def.parameters.properties.seconds.maximum, 30);
  assert.ok(def.parameters.properties.resolution.enum.includes('768p'));
  assert.equal(def.parameters.properties.model, undefined, '不暴露 model 参数，统一用设置里的模型');
  assert.equal(TOOL_DEFS.length, 53);
});

test('generate_video 端到端（桩网关）：提交 → 轮询 → 下载 → 写入 outputs/，带幂等键', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  let polls = 0;
  const mp4 = Buffer.from('0000001866747970', 'hex');
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ u, method, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.endsWith('/v1/videos') && method === 'POST') return new Response(JSON.stringify({ id: 'vid_test_1', status: 'queued' }), { status: 200 });
    if (u.endsWith('/v1/videos/vid_test_1/content')) return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } });
    if (u.endsWith('/v1/videos/vid_test_1')) {
      polls++;
      return new Response(JSON.stringify({ id: 'vid_test_1', status: polls > 0 ? 'completed' : 'in_progress' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const fs = createFS({ 'uploads/ref.png': PNG_URL });
    const updates = [];
    const out = await executeTool('generate_video',
      { prompt: '海边日落', seconds: 4, resolution: '480p', aspect_ratio: '16:9', input_image: 'uploads/ref.png' },
      { fs, apiKey: 'sk-teamo-test', videoGenModel: 'seedance-2-0-mini-text-to-video-basic', onUi: (p) => updates.push(p) });
    const post = calls.find((c) => c.method === 'POST' && c.u.endsWith('/v1/videos'));
    assert.ok(post, '应发出创建请求');
    assert.equal(post.body.model, 'seedance-2-0-mini-image-to-video-basic', '参考图 → 图生变体');
    assert.equal(post.body.seconds, '4');
    assert.equal(post.body.size, '854x480');
    assert.deepEqual(post.body.input_reference, { image_url: PNG_URL });
    assert.match(post.headers['Idempotency-Key'] || post.headers['idempotency-key'] || '', /^dubhe-video-/, '带幂等键');
    assert.match(out, /^\[视频已生成\] outputs\/video-001\.mp4/);
    assert.match(fs.read('outputs/video-001.mp4'), /^data:video\/mp4;base64,/);
    assert.ok(updates.some((p) => p.status === 'ok' && p.video && p.video.path === 'outputs/video-001.mp4'));
    // 提交前先实时报价（POST /v1/videos/quote，duration 为 "4s"）；报价 404 时不阻断生成，计费行标记未计价
    const quoteCall = calls.find((c) => c.u.endsWith('/v1/videos/quote'));
    assert.ok(quoteCall && quoteCall.method === 'POST' && quoteCall.body.duration === '4s', '提交前应报价');
    assert.ok(updates.some((p) => p.billing && p.billing.kind === 'video_gen' && p.billing.costUsd === null), '报价失败时计费行记为未计价');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('generate_video：非 TeamoRouter 渠道与缺少 Key 时直接拒绝，不发请求', async () => {
  const realFetch = globalThis.fetch;
  let hit = false;
  globalThis.fetch = async () => { hit = true; return new Response('{}', { status: 200 }); };
  try {
    const fs = createFS();
    const a = await executeTool('generate_video', { prompt: 'x' }, { fs, apiKey: 'k', gatewayId: 'openai', onUi: () => {} });
    assert.match(a, /只支持 TeamoRouter/);
    const b = await executeTool('generate_video', { prompt: 'x' }, { fs, apiKey: '', onUi: () => {} });
    assert.match(b, /未配置 TeamoRouter/);
    const c = await executeTool('generate_video', { prompt: 'x', input_image: 'uploads/none.png' }, { fs, apiKey: 'k', onUi: () => {} });
    assert.match(c, /找不到参考图/);
    assert.equal(hit, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('子智能体附件：文本内联、图片只给路径、缺失/超量报错', () => {
  const fs = createFS({ 'uploads/notes.md': '# 需求\n- 支持导出', 'uploads/shot.png': PNG_URL });
  const ok = buildSubagentAttachments(fs, ['uploads/notes.md', 'uploads/shot.png']);
  assert.ok(!ok.error);
  assert.match(ok.block, /【附件：uploads\/notes\.md】\n# 需求/);
  assert.match(ok.block, /uploads\/shot\.png/);
  assert.match(ok.block, /analyze_image/);
  assert.doesNotMatch(ok.block, /iVBORw0KGgo/, '图片内容不得内联进子任务');
  const long = createFS({ 'uploads/big.txt': 'x'.repeat(70000) });
  const trimmed = buildSubagentAttachments(long, ['uploads/big.txt']);
  assert.match(trimmed.block, /已截断，全文 70000 字符/);
  assert.equal(buildSubagentAttachments(fs, []).block, '');
  const missing = buildSubagentAttachments(fs, ['uploads/nope.txt']);
  assert.match(missing.error, /附件不存在/);
  const many = buildSubagentAttachments(fs, Array.from({ length: SUB_ATTACH_MAX + 1 }, (_, i) => `uploads/f${i}.txt`));
  assert.match(many.error, /最多 5 个/);
});

test('dispatch_subagent：附件拼进子任务，思考增量经 onThink 以 thinking 流上报', async () => {
  const fs = createFS({ 'uploads/spec.txt': '接口约定 v2' });
  const updates = [];
  let seenTask = '';
  const ctx = {
    fs,
    onUi: (p) => updates.push(p),
    dispatch: async (agent, task, onNote, opts) => {
      seenTask = task;
      opts.onThink('先看接口');
      opts.onThink('再写结论');
      return '子智能体报告';
    },
  };
  const out = await executeTool('dispatch_subagent', { agent: 'reviewer', task: '审查', files: ['uploads/spec.txt'] }, ctx);
  assert.match(out, /^子智能体报告/, '执行器会追加耗时标注');
  assert.match(seenTask, /^审查/);
  assert.match(seenTask, /接口约定 v2/);
  const thinks = updates.filter((p) => p.stream === 'thinking').map((p) => p.delta);
  assert.deepEqual(thinks, ['先看接口', '再写结论']);
});

test('工具分类：generate_video 与 generate_image 同属 web 折叠（不再是命令芯片）', () => {
  assert.equal(toolFamily({ name: 'generate_video' }), 'web');
  assert.equal(toolFamily({ name: 'generate_image' }), 'web');
  assert.equal(toolFamily({ name: 'search_web' }), 'web');
  assert.equal(toolFamily({ name: 'fetch_url' }), 'web');
  assert.equal(toolFamily({ name: 'curl' }), 'web');
});

test('负面提示词：未登记为支持的模型不发送 negative_prompt，并标记为已丢弃', () => {
  const plan = planVideoRequest({ model: 'seedance-2-0-mini-text-to-video-basic', prompt: 'a dog', seconds: 5, resolution: '720p', aspectRatio: '16:9', negativePrompt: 'blurry' });
  assert.equal(plan.ok, true);
  assert.equal(plan.negativePrompt, '');
  assert.equal(plan.negativePromptDropped, true);
  assert.equal('negative_prompt' in buildVideoBody(plan, 'a dog', ''), false);
  const none = planVideoRequest({ model: 'seedance-2-0-mini-text-to-video-basic', prompt: 'a dog', seconds: 5, resolution: '720p', aspectRatio: '16:9' });
  assert.equal(none.negativePromptDropped, false);
});

test('其余生成参数：范围 / 枚举 / 类型校验，合法值进入请求体，非法值在发起前报错', () => {
  const ok = pickVideoExtras({ target_fps: 24, slowdown_factor: 2, grain: 0.05, h264_output: true, output_format: 'mp4', camera_trajectory: [{ time: 0, azimuth: 0, elevation: 0, distance: 1 }, { time: 1, azimuth: 45, elevation: 10, distance: 1 }], keyframes: [{ image_url: 'https://x/a.png', frame_index: 0 }, { image_url: 'https://x/b.png', frame_index: 48 }], consents: { a: 1 } }, { resolveMedia: (v) => v });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.extras.target_fps, 24);
  assert.equal(ok.extras.keyframes[1].frame_index, 48);
  const bad = pickVideoExtras({ target_fps: 200, slowdown_factor: 3, grain: 0.5, output_format: 'avi', keyframes: [{ image_url: 'a', frame_index: 1 }, { image_url: 'b', frame_index: 1 }], camera_trajectory: [{ time: 0 }] }, { resolveMedia: (v) => v });
  assert.equal(bad.errors.length, 6);
  assert.equal(bad.extras.target_fps, undefined);
});

test('其余生成参数：媒体路径经 resolveMedia 解析，无法读取时报错；数组上限生效', () => {
  const r = pickVideoExtras({ reference_image_urls: ['uploads/a.png', 'https://x/b.png'], reference_document_urls: ['a.pdf', 'b.pdf'] }, { resolveMedia: (v) => (v.startsWith('uploads/') ? 'data:image/png;base64,AAA' : v.startsWith('http') ? v : '') });
  assert.deepEqual(r.extras.reference_image_urls, ['data:image/png;base64,AAA', 'https://x/b.png']);
  assert.ok(r.errors.some((e) => /reference_document_urls：最多 1 项|最多 1 项/.test(e)));
  const missing = pickVideoExtras({ scene_image_urls: ['nope.png'] }, { resolveMedia: () => '' });
  assert.match(missing.errors[0], /scene_image_urls：无法读取/);
});

test('其余生成参数：规范化进入创建与报价请求体，但不覆盖 model / prompt / seconds / size', () => {
  const plan = planVideoRequest({ model: 'seedance-2-5-text-to-video-basic', prompt: 'x', seconds: 5, resolution: '720p', aspectRatio: '16:9' });
  const body = buildVideoBody(plan, 'x', '', { extras: { target_fps: 30, model: 'evil', seconds: '99', size: '1x1' } });
  assert.equal(body.target_fps, 30);
  assert.equal(body.model, plan.model);
  assert.equal(body.seconds, '5');
  assert.notEqual(body.size, '1x1');
  const quote = buildVideoQuoteBody(plan, '', { extras: { softness: 3 } });
  assert.equal(quote.softness, 3);
});

test('generate_video 工具 schema 暴露全部其余参数，且 consents 为对象', () => {
  const def = TOOL_DEFS.find((t) => t.function?.name === 'generate_video') || TOOL_DEFS.find((t) => t.name === 'generate_video');
  const props = (def.function || def).parameters.properties;
  for (const k of Object.keys(VIDEO_EXTRA_SPEC)) assert.ok(k in props, k + ' 未进入 schema');
  assert.equal(props.consents.type, 'object');
});

test('折叠变体：Seedance 2.0 Fast / Mini 不单独占菜单项，归入 Seedance 2.0 家族', async () => {
  const { VIDEO_GEN_MENU, VIDEO_GEN_MODELS, videoMenuIdOf } = await import('../js/video-gen.js');
  assert.deepEqual(VIDEO_GEN_MENU.map((m) => m.label), ['Seedance 2.5', 'Seedance 2.0', 'MiniMax H3 Max', 'MiniMax H3']);
  const fast = VIDEO_GEN_MODELS.filter((m) => m.variant === 'fast');
  const mini = VIDEO_GEN_MODELS.filter((m) => m.variant === 'mini');
  assert.equal(fast.length, 3); assert.equal(mini.length, 3);
  assert.ok([...fast, ...mini].every((m) => m.family === 'Seedance 2.0'));
  assert.equal(videoMenuIdOf('seedance-2-0-fast-text-to-video-basic'), 'seedance-2-0-text-to-video-basic');
  assert.equal(videoMenuIdOf('seedance-2-0-mini-image-to-video-basic'), 'seedance-2-0-text-to-video-basic');
});

test('video runtime lists only selected family, including folded variants, and respects unsupported gateways', async () => {
  const { videoModelRuntimeDescription } = await import('../js/video-gen.js');
  for (const family of VIDEO_GEN_MENU) {
    const desc = videoModelRuntimeDescription(family.id);
    for (const m of VIDEO_GEN_MODELS) {
      assert.equal(desc.includes(`${m.id} (`), m.family === family.family, `${family.family} vs ${m.id}`);
    }
    assert.match(videoModelRuntimeDescription(family.id, { gatewayId: 'openai' }), /没有可用变体/);
  }
});

test('agent system prompt directly includes selected video family models', async () => {
  const { createStore } = await import('../js/state.js');
  const { createAgent } = await import('../js/agent.js');
  const store = createStore(); store.state.apiKey = 'test'; store.state.model = 'gpt-5.6-sol';
  store.state.settings.videoGenModel = 'seedance-2-5-text-to-video-basic';
  Object.assign(store.state.settings, { webEnabled: false, jevEnabled: false, autoReview: false });
  const original = globalThis.fetch; let request;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    await createAgent(store, {}).send('请生成视频');
    const sys = request.messages.find(m => m.role === 'system').content;
    for (const m of VIDEO_GEN_MODELS) assert.equal(sys.includes(`${m.id} (`), m.family === 'Seedance 2.5', m.id);
    assert.ok(request.tools.find(t => t.function.name === 'generate_video').function.parameters.properties.variant);
  } finally { globalThis.fetch = original; }
});

test('explicit video variant reaches quote and creation, cross-family variant is rejected', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith('/v1/videos/quote')) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ id: 'vid_test', status: 'failed', error: { message: 'test failure' } }), { status: 200 });
  };
  try {
    const ctx = { fs: createFS(), apiKey: 'test', videoGenModel: DEFAULT_VIDEO_GEN_MODEL, onUi() {} };
    const variant = 'seedance-2-0-fast-text-to-video-basic';
    await executeTool('generate_video', { prompt: 'a cat', variant }, ctx);
    assert.equal(calls.find(c => c.url.endsWith('/v1/videos')).body.model, variant);
    const count = calls.length;
    const fail = await executeTool('generate_video', { prompt: 'a cat', variant: 'minimax-h3-text-to-video' }, ctx);
    assert.match(fail, /不属于当前选定/); assert.equal(calls.length, count);
    const mismatch = await executeTool('generate_video', { prompt: 'a cat', variant, mode: 'image' }, ctx);
    assert.match(mismatch, /参考图/); assert.equal(calls.length, count);
  } finally { globalThis.fetch = original; }
});
