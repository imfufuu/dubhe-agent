// 视频生成（generate_video）与子智能体附件（dispatch_subagent.files）的回归测试。
// 全部使用桩 fetch，不访问真实网关。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFS } from '../js/sandbox.js';
import { executeTool, TOOL_DEFS, buildSubagentAttachments, SUB_ATTACH_MAX } from '../js/tools.js';
import {
  VIDEO_GEN_MODELS, DEFAULT_VIDEO_GEN_MODEL, videoSizeFor, planVideoRequest, buildVideoBody,
  videoJobState, imageVariantOf, resolveVideoGenModel,
} from '../js/video-gen.js';
import { toolFamily } from '../js/toolflow.js';

const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';

test('视频目录：文档表格共 18 个模型、ID 唯一、六族各含文生/图生/参考图三种变体', () => {
  assert.equal(VIDEO_GEN_MODELS.length, 18);
  assert.equal(new Set(VIDEO_GEN_MODELS.map((m) => m.id)).size, 18);
  const families = new Map();
  for (const m of VIDEO_GEN_MODELS) {
    if (!families.has(m.family)) families.set(m.family, new Set());
    families.get(m.family).add(m.mode);
  }
  assert.equal(families.size, 6);
  for (const [fam, modes] of families) assert.deepEqual([...modes].sort(), ['image', 'reference', 'text'], fam);
  assert.ok(VIDEO_GEN_MODELS.some((m) => m.id === 'seedance-2-5-text-to-video-basic'));
  assert.ok(VIDEO_GEN_MODELS.some((m) => m.id === 'minimax-h3-max-image-to-video'));
  assert.equal(resolveVideoGenModel('no-such-model'), DEFAULT_VIDEO_GEN_MODEL);
  assert.equal(imageVariantOf('seedance-2-0-mini-text-to-video-basic'), 'seedance-2-0-mini-image-to-video-basic');
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
  assert.equal(TOOL_DEFS.length, 46);
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
    const post = calls.find((c) => c.method === 'POST');
    assert.ok(post, '应发出创建请求');
    assert.equal(post.body.model, 'seedance-2-0-mini-image-to-video-basic', '参考图 → 图生变体');
    assert.equal(post.body.seconds, '4');
    assert.equal(post.body.size, '854x480');
    assert.deepEqual(post.body.input_reference, { image_url: PNG_URL });
    assert.match(post.headers['Idempotency-Key'] || post.headers['idempotency-key'] || '', /^dubhe-video-/, '带幂等键');
    assert.match(out, /^\[视频已生成\] outputs\/video-001\.mp4/);
    assert.match(fs.read('outputs/video-001.mp4'), /^data:video\/mp4;base64,/);
    assert.ok(updates.some((p) => p.status === 'ok' && p.video && p.video.path === 'outputs/video-001.mp4'));
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
});
