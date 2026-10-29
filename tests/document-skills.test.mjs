import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUDIO_MODELS, VIDEO_MODELS, DEFAULT_AUDIO_MODEL, resolveAudioModel } from '../js/config.js';
import { normalizeAudioData, AUDIO_MAX_BYTES } from '../js/audio-format.js';
import { analyzeAudio } from '../js/vision.js';
import { executeTool, TOOL_DEFS } from '../js/tools.js';
import { createFS } from '../js/sandbox.js';
import { buildOpenAIMessages } from '../js/api.js';
import { attachmentKindOf, deriveToolWhitelistFromBits } from '../js/executionContext.js';
import { searchSkills, retrieveSkill } from '../js/skill-library.js';
import { coreSystemPrompt } from '../js/prompt-core.js';
import { selectSkillBodies } from '../js/skills.js';
import { documentPath, prepareDocumentRequest, runDocumentTool } from '../js/document-tools.js';
import { getToolContract, validateToolResultPost } from '../js/execution.js';
import { mergeAvailableModels, isRetiredModel } from '../js/model-catalog.js';
import { summarizeTurnCost } from '../js/pricing.js';
import { createZip } from '../js/zip.js';
import { unpackZip } from '../js/unzip.js';
import { createXlsxWorkbook, inspectXlsxWorkbook } from '../js/xlsx.js';
const index = JSON.parse(fs.readFileSync(new URL('../assets/skills/index.json', import.meta.url), 'utf8'));
const audio = 'data:audio/wav;base64,' + Buffer.from('RIFF0000WAVEfmt 000000000000data0000').toString('base64');
function apiReply(text = 'Speaker A: test transcript', usage = { prompt_tokens: 120, completion_tokens: 30 }, finish = 'stop') { return Response.json({ choices: [{ message: { content: text }, finish_reason: finish }], ...(usage ? { usage } : {}) }); }
test('audio selection is exactly the video Gemini trio, with a safe independent default', () => {
  assert.equal(AUDIO_MODELS.length, 3); assert.deepEqual(AUDIO_MODELS.map(m => m.id), VIDEO_MODELS.map(m => m.id));
  assert.ok(AUDIO_MODELS.every(m => m.id.startsWith('gemini-'))); assert.equal(resolveAudioModel('kimi-k3'), DEFAULT_AUDIO_MODEL);
  for (const m of AUDIO_MODELS) assert.equal(resolveAudioModel(m.id), m.id);
});
test('audio MIME normalization validates encoding, size and supported formats before upload', () => {
  assert.equal(normalizeAudioData(audio).mime, 'audio/wav');
  assert.equal(normalizeAudioData('data:application/octet-stream;base64,YWJj', 'voice.mp3').mime, 'audio/mpeg');
  for (const raw of ['plain text', 'data:audio/wav;base64,', 'data:audio/wav;base64,!!!', 'data:audio/wav;base64,YQ', 'data:text/plain;base64,YWJj']) assert.throws(() => normalizeAudioData(raw, 'voice.mp3'));
  assert.throws(() => normalizeAudioData('data:audio/mpeg;base64,' + 'AAAA'.repeat(Math.floor(AUDIO_MAX_BYTES / 3) + 1)), /16MB/);
});
test('audio request uses the same filename/file_data parts as video, never audio_url/input_audio', async () => {
  const old = globalThis.fetch, requests = []; let usage;
  globalThis.fetch = async (url, options) => { requests.push({ url, options, body: JSON.parse(options.body) }); return apiReply(); };
  try {
    const text = await analyzeAudio({ apiKey: 'test-only-key', dataUrl: audio, filename: 'voice.wav', model: AUDIO_MODELS[2].id, prompt: 'Transcribe', onUsage: u => { usage = u; } });
    assert.match(text, /transcript/); const r = requests[0]; assert.match(r.url, /\/v1\/chat\/completions$/);
    assert.equal(r.body.model, AUDIO_MODELS[2].id); assert.equal(r.body.stream, false);
    assert.deepEqual(r.body.messages[0].content[1], { type: 'file', file: { filename: 'voice.wav', file_data: audio } });
    assert.equal(r.body.messages[0].content[0].text, 'Transcribe'); assert.doesNotMatch(JSON.stringify(r.body), /input_audio|audio_url|video_url/);
    assert.equal(usage.input, 120); assert.equal(usage.output, 30); assert.equal(usage.inputUnavailable, false);
  } finally { globalThis.fetch = old; }
});
test('audio continuation joins full results and marks missing gateway usage as incomplete', async () => {
  const old = globalThis.fetch; let n = 0, usage;
  globalThis.fetch = async () => ++n === 1 ? apiReply('Part 1 ', undefined, 'length') : apiReply('Part 2', null);
  try {
    const text = await analyzeAudio({ apiKey: 'test-only-key', dataUrl: audio, onUsage: u => { usage = u; } });
    assert.equal(text, 'Part 1 Part 2'); assert.equal(n, 2); assert.equal(usage.inputUnavailable, true);
  } finally { globalThis.fetch = old; }
});
test('audio tool respects user model, writes full transcript and emits actual billing', async () => {
  const old = globalThis.fetch, vfs = createFS({ 'uploads/voice.wav': audio }), events = []; let model;
  globalThis.fetch = async (_, options) => { model = JSON.parse(options.body).model; return apiReply('Full transcript.'); };
  try {
    const result = await executeTool('analyze_audio', { path: 'uploads/voice.wav', model: 'kimi-k3' }, { fs: vfs, apiKey: 'test-only-key', audioModel: AUDIO_MODELS[1].id, onUi: e => events.push(e) });
    assert.match(result, /^\[音频识别完成\]/); assert.equal(model, AUDIO_MODELS[1].id); assert.equal(vfs.read('internal/ocr/voice.audio.md'), 'Full transcript.');
    const bill = events.find(e => e.billing)?.billing; assert.equal(bill.audioCount, 1); assert.equal(bill.usage.input, 120);
  } finally { globalThis.fetch = old; }
});
test('audio errors and cancellation do not create a successful transcript', async () => {
  const vfs = createFS({ 'uploads/voice.wav': 'not audio' });
  assert.match(await executeTool('analyze_audio', { path: 'uploads/voice.wav' }, { fs: vfs, apiKey: 'test-only-key', onUi() {} }), /失败/);
  assert.match(await executeTool('analyze_audio', {}, { fs: createFS(), onUi() {} }), /未配置/);
  const old = globalThis.fetch; globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
  try { await assert.rejects(analyzeAudio({ apiKey: 'test-only-key', dataUrl: audio, signal: AbortSignal.abort() }), { name: 'AbortError' }); } finally { globalThis.fetch = old; }
  assert.ok(!vfs.has('internal/ocr/voice.audio.md'));
});
test('text conversation only receives audio/Office attachment hints, not binary payloads', () => {
  const result = JSON.stringify(buildOpenAIMessages([{ role: 'user', text: 'Read these', attachments: [{ kind: 'file', source: 'audio', name: 'voice.wav', mime: 'audio/wav', dataUrl: audio }, { kind: 'file', source: 'office', name: 'report.docx', dataUrl: 'data:application/zip;base64,cHJpdmF0ZQ==' }] }]));
  assert.match(result, /analyze_audio/); assert.match(result, /document_tool/); assert.match(result, /xlsx_tool/); assert.match(result, /Office 文档组/); assert.doesNotMatch(result, /base64|cHJpdmF0ZQ/);
});
test('audio and Office attachments mount the right tools; audio WebM takes precedence over filename', () => {
  assert.equal(attachmentKindOf({ name: 'clip.webm', source: 'audio' }), 'audio');
  assert.equal(attachmentKindOf({ name: 'voice.mp3' }), 'audio'); assert.equal(attachmentKindOf({ name: 'deck.pptx' }), 'office'); assert.equal(attachmentKindOf({ name: 'budget.xlsx' }), 'office');
  for (const name of ['skill_library', 'tool_library', 'document_tool', 'xlsx_tool', 'analyze_audio']) assert.ok(TOOL_DEFS.some(t => t.name === name) && getToolContract(name));
  const allowed = deriveToolWhitelistFromBits({ sandboxEnabled: false, webEnabled: false }, TOOL_DEFS).allowed;
  for (const name of ['skill_library', 'tool_library', 'document_tool', 'xlsx_tool', 'analyze_audio']) assert.ok(allowed.some(t => (t.name || t.function?.name) === name));
});
test('twelve bilingual extension skills exist and search does not return their bodies', () => {
  assert.equal(index.skills.length, 12); assert.equal(new Set(index.skills.map(s => s.id)).size, 12);
  for (const item of index.skills) for (const lang of ['zh', 'en']) assert.ok(fs.readFileSync(new URL(`../assets/skills/${item.id}.${lang}.md`, import.meta.url), 'utf8').length > 250);
  const hits = searchSkills(index.skills, 'PPTX', 'en'); assert.ok(hits.some(s => s.id === 'slide-deck')); assert.ok(hits.every(s => !('body' in s) && !('content' in s)));
  assert.ok(searchSkills(index.skills, '表单', 'zh').some(s => s.id === 'pdf-forms'));
});
test('full extension skill bodies never enter core or automatic skill injection', () => {
  for (const language of ['zh', 'en']) {
    const prompt = coreSystemPrompt(new Date('2026-10-14'), { language }); assert.match(prompt, /skill_library/);
    assert.doesNotMatch(prompt, /slides\[\]\.images|内置 PDF 字体是|Built-in fonts are Latin/);
  }
  assert.doesNotMatch(selectSkillBodies({}, '处理 docx pptx pdf 水印 表单', []), /PDF watermark|幻灯片关系|latin-only|fields.*flatten/i);
});
test('skill fetching is lazy, validates IDs, and loads only the selected guide', async () => {
  const old = globalThis.fetch, requests = [];
  globalThis.fetch = async url => {
    const u = new URL(url); requests.push(u.pathname);
    if (u.pathname.endsWith('/index.json')) return Response.json(index);
    return new Response(fs.readFileSync(new URL('../assets/skills/' + u.pathname.split('/').pop(), import.meta.url), 'utf8'));
  };
  try {
    await retrieveSkill({ query: 'DOCX' }); assert.equal(requests.length, 1);
    const guide = await retrieveSkill({ action: 'read', id: 'word-docx' }); assert.match(guide, /document_tool/); assert.equal(requests.length, 2);
    await retrieveSkill({ action: 'read', id: 'word-docx' }); assert.equal(requests.length, 2);
    await assert.rejects(retrieveSkill({ action: 'read', id: '../private' }), /Unknown/); assert.equal(requests.length, 2);
    await assert.rejects(retrieveSkill({ query: 'PDF' }, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  } finally { globalThis.fetch = old; }
});
test('XLSX codec creates a real OOXML workbook and safely inspects cells without evaluating formulas', async () => {
  const bytes = await createXlsxWorkbook({ sheets: [
    { name: 'Summary', rows: [['Name', 'Value', 'Note'], ['Alpha', 12, ' <safe> & text '], ['Beta', true, '=SUM(B1:B2)']] },
    { name: '第二页', rows: [['城市', '数量'], ['波士顿', 3]] },
  ] });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 500);
  const zip = await unpackZip(bytes);
  assert.equal(zip.ok, true);
  assert.ok(zip.files.some(f => f.path === 'xl/workbook.xml'));
  assert.ok(zip.files.some(f => f.path === 'xl/worksheets/sheet2.xml'));
  const inspected = await inspectXlsxWorkbook(bytes);
  assert.equal(inspected.format, 'xlsx'); assert.equal(inspected.sheetCount, 2); assert.equal(inspected.formulaCount, 0);
  const workbook = JSON.parse(inspected.text);
  const cells = workbook.sheets[0].cells;
  assert.equal(cells.find(c => c.cell === 'B2').value, 12);
  assert.equal(cells.find(c => c.cell === 'C2').value, ' <safe> & text ');
  assert.equal(cells.find(c => c.cell === 'B3').value, true);
  assert.equal(cells.find(c => c.cell === 'C3').value, '=SUM(B1:B2)', 'formula-like strings are literal data');
  assert.equal(workbook.sheets[1].name, '第二页');
  assert.match(inspected.warnings.join(' '), /never evaluated/);
});

test('XLSX codec rejects invalid workbook names, duplicate sheets, DTDs, and relationships escaping the package', async () => {
  await assert.rejects(createXlsxWorkbook({ sheets: [] }), /Provide 1/);
  await assert.rejects(createXlsxWorkbook({ sheets: [{ name: 'Bad/Name', rows: [] }] }), /Invalid worksheet/);
  await assert.rejects(createXlsxWorkbook({ sheets: [{ name: 'A', rows: [] }, { name: 'a', rows: [] }] }), /Duplicate/);
  const dtd = createZip([
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>') },
    { name: 'xl/workbook.xml', bytes: Buffer.from('<!DOCTYPE workbook [<!ENTITY x "boom">]><workbook/>') },
  ]);
  await assert.rejects(inspectXlsxWorkbook(new Uint8Array(await dtd.arrayBuffer())), /DTD\/entity/);
  const escaping = createZip([
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>') },
    { name: 'xl/workbook.xml', bytes: Buffer.from('<workbook><sheets><sheet name="Bad" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', bytes: Buffer.from('<Relationships><Relationship Id="rId1" Target="../../outside.xml"/></Relationships>') },
  ]);
  await assert.rejects(inspectXlsxWorkbook(new Uint8Array(await escaping.arrayBuffer())), /relationship missing or unsupported/);
});

test('document request validation accepts XLSX inspect/create with bounded, correctly suffixed outputs', async () => {
  const bytes = await createXlsxWorkbook({ sheets: [{ name: 'Budget', rows: [['Year', 'Amount'], [2026, 10]] }] });
  const data = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(bytes).toString('base64')}`;
  const vfs = createFS({ 'uploads/budget.xlsx': data });
  const inspect = prepareDocumentRequest({ action: 'inspect', path: 'uploads/budget.xlsx' }, vfs);
  assert.equal(inspect.args.format, 'xlsx'); assert.deepEqual(Object.keys(inspect.files), ['uploads/budget.xlsx']);
  const create = prepareDocumentRequest({ format: 'xlsx', action: 'create', out: 'outputs/budget.xlsx', data: { sheets: [{ rows: [['A']] }] } }, vfs);
  assert.equal(create.args.format, 'xlsx'); assert.equal(create.args.out, 'outputs/budget.xlsx');
  assert.throws(() => prepareDocumentRequest({ format: 'xlsx', action: 'merge', path: 'uploads/budget.xlsx' }, vfs), /Unsupported/);
  assert.throws(() => prepareDocumentRequest({ format: 'xlsx', action: 'create', out: 'outputs/budget.docx', data: { sheets: [{ rows: [] }] } }, vfs), /correct extension/);
});

test('document requests reject traversal, protected inputs and accidental overwrites', () => {
  const vfs = createFS({ 'uploads/a.pdf': 'data:application/pdf;base64,YWJj', 'outputs/old.pdf': 'data:application/pdf;base64,YWJj' });
  for (const p of ['../a.pdf', '/a.pdf', 'outputs/../a.pdf', 'internal/a.pdf', '.git/config', 'https://x/a.pdf', 'outputs/a\\b.pdf']) assert.throws(() => documentPath(p));
  assert.throws(() => prepareDocumentRequest({ action: 'rotate', path: 'uploads/a.pdf', angle: 90, out: 'uploads/a.pdf' }, vfs));
  assert.throws(() => prepareDocumentRequest({ action: 'rotate', path: 'uploads/a.pdf', angle: 90, out: 'outputs/old.pdf' }, vfs), /exists/);
  assert.throws(() => prepareDocumentRequest({ action: 'inspect', path: 'uploads/old.doc' }, vfs), /docx/);
  assert.throws(() => prepareDocumentRequest({ format: 'pptx', action: 'rotate', path: 'uploads/x.pptx' }, vfs), /Unsupported/);
});
test('document requests use a minimal file snapshot and bounded structured data', () => {
  const vfs = createFS({ 'uploads/a.pdf': 'data:application/pdf;base64,YWJj', 'uploads/private.txt': 'secret' });
  const r = prepareDocumentRequest({ action: 'inspect', path: 'uploads/a.pdf' }, vfs);
  assert.deepEqual(Object.keys(r.files), ['uploads/a.pdf']); assert.equal(r.args.format, 'pdf');
  assert.throws(() => prepareDocumentRequest({ action: 'create', format: 'docx', data: { text: 'x'.repeat(1024 * 1024 + 1) } }, vfs), /1MB/);
});
test('cancelled local document work cannot write output', async () => {
  const vfs = createFS(); await assert.rejects(runDocumentTool({ action: 'create', format: 'docx' }, { fs: vfs, signal: AbortSignal.abort() }), { name: 'AbortError' }); assert.equal(vfs.list().length, 0);
});
test('read-only document inspection does not falsely demand filesystem side effects', () => {
  const r = validateToolResultPost({ name: 'document_tool', args: { action: 'inspect' }, result: '[Local document result]\n{"pageCount":2}', fsBefore: { digest: 'same' }, fsAfter: { digest: 'same' } });
  assert.equal(r.issues.length, 0);
  const write = validateToolResultPost({ name: 'document_tool', args: { action: 'create' }, result: 'done', fsBefore: { digest: 'same' }, fsAfter: { digest: 'same' } }); assert.ok(write.issues.some(i => i.id === 'side-effect-missing'));
});
test('current Kimi K3 is selectable while only the unlisted historical 1M alias stays retired', () => {
  assert.equal(isRetiredModel('kimi-k3'), false); assert.ok(isRetiredModel('kimi-k3[1M]'));
  const models = mergeAvailableModels(['kimi-k3', 'kimi-k3[1M]', 'gemini-3.8-flash'], []);
  assert.equal(models[0].id, '__smart_router__');
  assert.ok(models.some(m => m.id === 'kimi-k3') && models.some(m => m.id === 'gemini-3.8-flash'));
  assert.ok(!models.some(m => m.id === 'kimi-k3[1M]'), 'the retired historical alias stays hidden');
  assert.match(fs.readFileSync(new URL('../js/state.js', import.meta.url), 'utf8'), /isRetiredModel\(state\.model, state\.gatewayId\)/);
});
test('audio billing uses reported usage and labels missing input usage rather than inventing audio minutes', () => {
  const actual = summarizeTurnCost({ messages: [], toolCosts: [{ kind: 'vision', model: AUDIO_MODELS[0].id, audioCount: 1, usage: { input: 100, output: 20 } }] });
  assert.ok(Math.abs(actual.visionUsd - (100 * 0.3 + 20 * 2.5) / 1e6) < 1e-12);
  const missing = summarizeTurnCost({ messages: [], toolCosts: [{ kind: 'vision', model: AUDIO_MODELS[0].id, audioCount: 1, inputUnavailable: true, usage: { input: 0, output: 20 } }] });
  assert.equal(missing.incomplete, true); assert.equal(missing.formatted, '用量不完整'); assert.match(missing.tooltip, /不完整/);
});
test('shared tool headers have uniform, slightly wider vertical padding', () => {
  const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8'); assert.match(css, /\.chip, \.ran-commands, \.reasoning, \.md-fold, \.edited-files, \.explored-files, \.web-activity, \.searched-library \{\s*border: none; background: transparent; padding: 5px 0;/);
});
test('the real tool runner forwards independent audio selection and preserves billing only once', async () => {
  const { createToolRunner } = await import('../js/toolrunner.js');
  const vfs = createFS({ 'uploads/voice.wav': audio }), call = { id: 'audio-runner-1', name: 'analyze_audio', args: { path: 'uploads/voice.wav' } };
  const runner = createToolRunner({ store: { state: { memory: [], memoryArchive: [] } }, emit() {}, getFs: () => vfs });
  const ctx = runner.toolCtxFor(call, { apiKey: 'test-only-key', audioModel: AUDIO_MODELS[2].id, videoModel: AUDIO_MODELS[0].id, sandboxEnabled: false });
  assert.equal(ctx.audioModel, AUDIO_MODELS[2].id);
  const old = globalThis.fetch; let sent;
  globalThis.fetch = async (_, options) => { sent = JSON.parse(options.body); return apiReply(); };
  try { await executeTool(call.name, call.args, ctx); } finally { globalThis.fetch = old; }
  assert.equal(sent.model, AUDIO_MODELS[2].id); assert.equal(call.billing.audioCount, 1);
  const summary = summarizeTurnCost({ messages: [{ role: 'assistant', toolCalls: [call] }], toolCosts: [{ ...call.billing, id: call.id }] });
  assert.equal(summary.visionCount, 1);
});
test('retired gate has no click or keyboard route; language changes use viewport anchoring', () => {
  const home = fs.readFileSync(new URL('../js/home.js', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /openGate\(|classList\.add\('gate'\)|gateSkip/);
  assert.match(home, /openSite\(true\);\s*pinTop\(\);/);
  const language = fs.readFileSync(new URL('../js/ui-language.js', import.meta.url), 'utf8');
  assert.match(language, /veilFade\(doc, \(\) => preserveLanguageViewport\(doc, run\)\)/, 'V1.8.2：整页遮罩改为 page-fx.js 的 veilFade（配色在 CSS 里，深色渐黑）');
  assert.match(language, /else preserveLanguageViewport\(doc, run\)/);
  const scroll = fs.readFileSync(new URL('../js/language-scroll.js', import.meta.url), 'utf8');
  assert.match(scroll, /overflow-anchor/); assert.match(scroll, /pointerdown/); assert.match(scroll, /'instant'/);
});
