// ─── DOM 冒烟测试（tests/dom-smoke.mjs）─────────────────────────────────
// 用 jsdom 真实挂载 index.html + mountUI，驱动关键交互路径，验证「接线」是否正确
// （元素 id、事件绑定、渲染分支、状态机动画、下载与文件面板）。
// 依赖 jsdom（npm ci 会装；CI 必跑本文件，未安装时本地自动跳过）。
//   node tests/dom-smoke.mjs          # 需 npm i -D jsdom
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('跳过 DOM 冒烟测试：未安装 jsdom（npm i -D jsdom 后可运行）');
  process.exit(0);
}

const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8000/', pretendToBeVisual: true });
const { window } = dom;
// Legacy Chinese contracts are explicit; separate feature/browser tests exercise auto English.
Object.defineProperty(window.navigator, 'language', { value: 'zh-CN', configurable: true });

for (const k of ['document', 'window', 'location', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'URL', 'Blob', 'FormData', 'File']) {
  // Node ≥ 21 自带只读 getter 的 globalThis.navigator，直接赋值会抛 TypeError（CI 跑 Node 22 时暴露）：改用 defineProperty 覆盖
  if (window[k] !== undefined) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true, enumerable: true });
}
globalThis.self = window;
globalThis.localStorage = window.localStorage;
// 破坏性操作都带 confirm()；测试里按需切换返回值
let confirmAnswer = true;
window.confirm = () => confirmAnswer;
globalThis.confirm = window.confirm;
// jsdom 未实现的浏览器 API 补齐（不影响被测代码路径的正确性）
if (!window.matchMedia) window.matchMedia = (q) => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = window.matchMedia;
if (!window.CSS?.escape) { window.CSS = window.CSS || {}; window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`); }
globalThis.CSS = window.CSS;
window.Element.prototype.scrollTo = function () {};
window.Element.prototype.scrollIntoView = function () {};
if (typeof window.URL.createObjectURL !== 'function') window.URL.createObjectURL = () => 'blob:jsdom-mock';
if (typeof window.URL.revokeObjectURL !== 'function') window.URL.revokeObjectURL = () => {};

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
};

const { createStore } = await import(path.join(ROOT, 'js/state.js'));
const { createAgent, copyAttachmentsToFS } = await import(path.join(ROOT, 'js/agent.js'));
const { mountUI } = await import(path.join(ROOT, 'js/ui.js'));
const { ROUTER_ICON_SVG } = await import(path.join(ROOT, 'js/smartrouter.js'));
const { createZip } = await import(path.join(ROOT, 'js/zip.js'));
const { createXlsxWorkbook } = await import(path.join(ROOT, 'js/xlsx.js'));

const store = createStore();
store.state.apiKey = 'sk-teamo-test';
// 复刻 main.js 的接线（agent hooks → ui 方法），用于验证「用户消息立刻上屏」
const lateUI = {};
const agent = createAgent(store, {
  onUserMessage: (text, msg) => lateUI.onUserMessage && lateUI.onUserMessage(text, msg),
});
let bootCompletionCount = 0;
window.__dubheBootGuard = { complete() { bootCompletionCount++; } };
const ui = mountUI(store, agent);
lateUI.onUserMessage = (text, msg) => ui.onUserMessage(msg);
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const click = (n) => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

console.log('\n挂载与初始状态');
ok('mountUI 返回 hooks 对象', ui && typeof ui.setStatus === 'function');
ok('UI 挂载成功时通知启动页关闭', bootCompletionCount === 1, `调用 ${bootCompletionCount} 次`);
ok('.33：模型菜单里不再有生图模型行（迁到设置页）', !$('#image-model') && !$('#model-menu .dd-foot'));
ok('设置页有生图模型选择器（挂载前为空，打开设置时填充）', !!$('#set-image-model'));
ok('默认模型卡片显示 smart_router', $('#model-btn-name').textContent === 'smart_router', $('#model-btn-name').textContent);
const expectedLogo = document.createElement('span'); expectedLogo.innerHTML = ROUTER_ICON_SVG;
ok('模型卡片使用 TeamoRouter 原生产品图标', $('#model-btn-icon svg')?.outerHTML === expectedLogo.querySelector('svg')?.outerHTML);
ok('文件面板 ZIP 按钮存在', !!$('#download-zip'));
ok('空沙箱工具栏仍显示 0.0KB/120.0MB 上限', /0\.0KB\/120\.0MB/.test($('#files-count').textContent), $('#files-count').textContent);

console.log('\n快捷导航不自动抢输入焦点');
const composer = $('#composer-input'), cmdInput = $('#cmd-input'), cmdPalette = $('#cmd-palette');
composer.focus();
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
ok('Ctrl+K 打开快捷导航', !cmdPalette.hidden);
ok('打开后不聚焦搜索框，也不继续聚焦聊天输入框', window.document.activeElement !== cmdInput && window.document.activeElement !== composer);
ok('打开后搜索框保持空白', cmdInput.value === '');
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
ok('Escape 可正常关闭快捷导航', cmdPalette.hidden);

console.log('\n② 生图模型不作为对话模型出现');
click($('#model-btn'));
const ddItems = () => $$('#model-menu .dd-item-id').map((n) => n.textContent);
ok('模型菜单已渲染分组', $$('#model-menu .dd-group').length >= 5, `分组 ${$$('#model-menu .dd-group').length}`);
ok('菜单中没有 gpt-image 系列', !ddItems().some((i) => i.includes('gpt-image')), ddItems().filter((i) => i.includes('image')).join(','));
ok('菜单不含识图专用模型 deepseek-v4-flash-vision-exp', !ddItems().includes('deepseek-v4-flash-vision-exp'));
ok('菜单中没有 nano-banana-2-1（生图模型，.33 起被 isImageModel 识别）', !ddItems().some((i) => /nano[-_]?banana/.test(i)), ddItems().filter((i) => i.includes('banana')).join(','));
ok('菜单不含已下线的 gemini-3.1-flash-lite-preview', !ddItems().includes('gemini-3.1-flash-lite-preview'));
ok('搜索框仍在菜单最前（DOM 顺序）', [...$('#model-menu').children][0].className.split(' ')[0] === 'dd-search-wrap', JSON.stringify([...$('#model-menu').children].map((c) => c.className)));
// ⑦ 层级：jsdom 不抓外链样式表 → 直接校验 CSS 源码声明
const cssText = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
const wrapZ = Number(/\.dd-search-wrap\s*\{[^}]*z-index:\s*(\d+)/.exec(cssText)?.[1] || 0);
const titleZ = Number(/\.dd-group-title\s*\{[^}]*z-index:\s*(\d+)/.exec(cssText)?.[1] ?? -1);
ok('⑦ 搜索框 z-index 高于分组图标层', wrapZ > titleZ && wrapZ > 0, `wrap=${wrapZ} title=${titleZ}`);
ok('⑦ 分组标题为定位元素（受 z-index 约束）', /\.dd-group-title\s*\{[^}]*position:\s*relative/.test(cssText));
$('#model-search').value = 'deepseek';
$('#model-search').dispatchEvent(new window.Event('input', { bubbles: true }));
ok('搜索后仅剩 DeepSeek 分组', $$('#model-menu .dd-group').length === 1 && $('#model-menu .dd-group-title').textContent.includes('DeepSeek'));
ok('搜索后菜单末尾是分组而不是别的残留', $('#model-menu').lastElementChild.className.startsWith('dd-group'));
$('#model-search').value = '';
$('#model-search').dispatchEvent(new window.Event('input', { bubbles: true }));

console.log('\n① 会话记录：第一条消息后才入列 + 切换会话恢复各自模型');
store.state.model = 'claude-opus-5';
store.state.imageModel = 'gpt-image-2.5-flare';
store.notify();
ui.renderSessions();
ok('空白的当前会话不进侧栏（显示引导语）', $$('.sess-item').length === 0 && !!$('#session-list .sess-empty-hint'),
  `${$$('.sess-item').length} 条`);
store.pushMessage({ role: 'user', text: 'A会话' }); // 第一条消息发出 → 立刻入列
ui.renderSessions();
ok('发出第一条消息后会话入列', $$('.sess-title').map((n) => n.textContent).join(',') === 'A会话',
  $$('.sess-title').map((n) => n.textContent).join(','));
const sessionsBefore = store.state.sessions.length;
click($('#new-session'));
ok('「＋ 新建」继承当前模型选择', store.state.model === 'claude-opus-5', store.state.model);
ok('新草稿仍不进列表（列表只剩 A）', $$('.sess-item').length === 1, `${$$('.sess-item').length} 条`);
click($('#new-session'));
ok('反复点「新建」复用同一个空草稿', store.state.sessions.length === sessionsBefore + 1, `${store.state.sessions.length} 个会话`);
store.pushMessage({ role: 'user', text: 'B会话' });
store.state.model = 'gpt-5.5';
store.notify();
ui.renderSessions();
const byTitle = (t) => $$('.sess-item').find((n) => n.querySelector('.sess-title').textContent === t);
ok('侧栏出现两个会话', !!byTitle('A会话') && !!byTitle('B会话'), $$('.sess-title').map((n) => n.textContent).join(','));
click(byTitle('A会话'));
ok('切到会话 A 恢复 claude-opus-5（互不污染）', store.state.model === 'claude-opus-5', store.state.model);
ok('按钮文案随之更新', $('#model-btn-name').textContent === 'claude-opus-5', $('#model-btn-name').textContent);
ok('切会话后会话级生图模型随之恢复 gpt-image-2.5-flare', store.state.imageModel === 'gpt-image-2.5-flare', store.state.imageModel);
click(byTitle('B会话'));
ok('切回会话 B 恢复 gpt-5.5', store.state.model === 'gpt-5.5', store.state.model);
const normalModel = store.state.model;
store.state.model = '__system__';
ui.renderSessions();
ok('/system 通道不让任何真实会话保留 active 选中态', $$('.sess-item.active').length === 0);
store.state.model = normalModel;
ui.renderSessions();

console.log('\n⑧ 会话改名（Agent 自动总结不覆盖用户手改）');
const rowB = byTitle('B会话');
ok('每条会话有改名按钮', !!rowB.querySelector('.sess-rename svg'), rowB.innerHTML.slice(0, 60));
click(rowB.querySelector('.sess-rename'));
const input = $('#session-list .sess-rename-input');
ok('点改名 → 出现就地输入框并带当前标题', !!input && input.value === 'B会话');
input.value = '手写标题';
input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok('Enter 提交后标题更新', byTitle('手写标题') !== undefined, $$('.sess-title').map((n) => n.textContent).join(','));
const activeId = store.state.activeSessionId;
ok('改名写进 store 并标记 titleSource=user', store.state.sessions.find((x) => x.id === activeId).titleSource === 'user');
ok('手改过的会话不再需要自动标题', store.needsTitle() === null);
store.state.sessions.find((x) => x.id !== activeId).titled = false; // A 会话仍可自动总结
ok('未改名的会话仍可被总结', store.needsTitle()?.sessionId !== activeId);
// A 的自动总结写回（不覆盖 B）
const aId = store.state.sessions.find((x) => x.id !== activeId).id;
ok('setAutoTitle 写入并置 titled', store.setAutoTitle(aId, '沙箱计算 π') && store.state.sessions.find((x) => x.id === aId).titleSource === 'auto');
ok('Agent 不会覆盖用户手改的标题', store.setAutoTitle(activeId, '又被总结了') === false);
ui.renderSessions();
ok('A 的标题显示为总结结果', byTitle('沙箱计算 π') !== undefined, $$('.sess-title').map((n) => n.textContent).join(','));

console.log('\n⑨ 一键清除所有会话记录');
confirmAnswer = false;
click($('#clear-sessions'));
ok('确认框取消时不动数据', store.state.sessions.length === 2 && $$('.sess-item').length === 2, `${$$('.sess-item').length} 条`);
confirmAnswer = true;
click($('#clear-sessions'));
ok('确认后所有会话被清空', store.state.sessions.length === 1 && $$('.sess-item').length === 0, `${store.state.sessions.length} / ${$$('.sess-item').length}`);
ok('清空后回到空状态引导语', !!$('#session-list .sess-empty-hint') && $$('#messages .empty-state').length === 1);
ok('清空后消息数组也是空的', store.state.messages.length === 0);

console.log('\n⑩ 删除会话：折叠沙箱、清理陈旧状态，但不打断其他活动会话');
store.pushMessage({ role: 'user', text: '待删除的旧会话' });
const toDeleteId = store.state.activeSessionId;
store.createSession();
store.pushMessage({ role: 'user', text: '当前仍打开的会话' });
ui.rebuildMessages();
ui.renderSessions();
const rowToDelete = $$('.sess-item').find((n) => n.dataset.id === toDeleteId || n.querySelector('.sess-title')?.textContent === '待删除的旧会话');
click($('#panel-toggle'));
const originalGetStatus = agent.getStatus;
agent.getStatus = () => 'streaming';
ui.setStatus('streaming');
click(rowToDelete.querySelector('.sess-del'));
ok('删除非活动会话保留当前活动会话内容', store.state.messages.some((m) => m.text === '当前仍打开的会话') && !$('#messages .empty-state'), JSON.stringify({ active: store.state.activeSessionId, messages: store.state.messages.map((m) => m.text), rows: $$('.sess-item').map((n) => [n.dataset.id, n.querySelector('.sess-title')?.textContent]) }));
ok('删除会话自动收起沙箱面板', $('#sandbox-panel').classList.contains('collapsed'));
ok('Agent 正在输出时删除其他会话不清除运行状态', $('#status-text').textContent.includes('生成中'));
agent.getStatus = originalGetStatus;
ui.setStatus('error');
click($('#panel-toggle'));
const preservedRow = $$('.sess-item').find((n) => n.querySelector('.sess-title')?.textContent === '当前仍打开的会话');
click(preservedRow);
click(preservedRow.querySelector('.sess-del'));
ok('删除活动会话回到空白主页', store.state.messages.length === 0 && !!$('#messages .empty-state') && $$('#welcome-quick-prompts .suggest').length > 0);
ok('删除后清空出错状态', $('#status-text').textContent === '' && $('#status-dot').className.includes('ok'));
ok('删除活动会话后面板也收起', $('#sandbox-panel').classList.contains('collapsed'));

console.log('\n③ 连接动画（状态栏 + 顶栏进度条）');
ui.setStatus('connecting');
ok('状态文案含「连接模型中」', $('#status-text').textContent.includes('连接模型中'), $('#status-text').textContent);
ok('状态点为 busy.connecting', $('#status-dot').className.includes('connecting'), $('#status-dot').className);
ok('三个跳动点已渲染', $('#status-text').querySelectorAll('.sdots i').length === 3);
ok('顶栏进度条亮起并处于 connecting 节奏', $('#turn-bar').classList.contains('on') && $('#turn-bar').classList.contains('connecting'));
ui.setStatus('streaming');
ok('生成中：进度条保留但节奏切换', $('#turn-bar').classList.contains('on') && !$('#turn-bar').classList.contains('connecting'));
ok('状态文案切到「生成中」', $('#status-text').textContent.includes('生成中'));
ui.setStatus('executing');
ok('沙箱执行中提示', $('#status-text').textContent.includes('沙箱执行中'));
ui.setStatus('done');
ok('完成后进度条熄灭', !$('#turn-bar').classList.contains('on'));

console.log('\n⑪ 拍照入口先编辑，再复用普通附件上传链路');
const cameraInputEl = $('#camera-input');
ok('相机入口收纳在附件菜单中且使用 environment capture', !!$('#camera-btn') && $('#attach-menu')?.contains($('#camera-btn')) && cameraInputEl?.getAttribute('capture') === 'environment' && $('#attach-input')?.hasAttribute('capture') === false);
ok('附件按钮可打开附件/拍照菜单', !!$('#attach-menu')?.hidden && $('#attach-btn')?.getAttribute('aria-expanded') === 'false');
click($('#attach-btn'));
ok('点击附件按钮展开附件菜单', $('#attach-menu')?.hidden === false && $('#attach-btn')?.getAttribute('aria-expanded') === 'true');
click($('#attach-btn'));
ok('再次点击附件按钮收起附件菜单', $('#attach-menu')?.hidden === true && $('#attach-btn')?.getAttribute('aria-expanded') === 'false');
const readUiSrc = () => ['js/ui.js', 'js/ui-common.js', 'js/ui-choices.js', 'js/ui-toolflow.js', 'js/ui-editpreview.js', 'js/ui-markdown.js', 'js/ui-model-picker.js', 'js/ui-popovers.js', 'js/ui-command-palette.js', 'js/ui-system-commands.js', 'js/ui-files-panel.js', 'js/ui-lightbox.js', 'js/ui-attachments.js', 'js/ui-capability.js', 'js/quickviz.js', 'js/ui-rollback-fx.js', 'js/ui-file-viewer.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const photoEditorSource = readUiSrc();
ok('保存后的相机照片回到 addFiles，普通附件 change 路径独立', /openPhotoEditor\(photo\)[\s\S]*?addFiles\(\[edited\]\)/.test(photoEditorSource) && /fileInput\.addEventListener\('change', \(\) => \{ addFiles\(fileInput\.files\)/.test(photoEditorSource));
const photoMath = await import(path.join(ROOT, 'js/photo-editor.js'));
ok('照片编辑尺寸与反向拖拽裁剪范围受限', photoMath.fitPhotoSize(8000, 4000, 2048).width === 2048 && photoMath.cropRectFromDrag(90, 90, 10, 10, 100, 100)?.x === 10);
ok('四边裁剪手柄可独立调整裁剪边界', photoMath.resizeCropRect({ x: 20, y: 20, width: 60, height: 40 }, 'w', { x: 10, y: 40 }, 100, 100)?.width === 70 && photoMath.resizeCropRect({ x: 20, y: 20, width: 60, height: 40 }, 's', { x: 50, y: 80 }, 100, 100)?.height === 60);

console.log('\n④ 附件自动进 uploads/ + ⑤ 单文件 / ZIP 下载');
const written = copyAttachmentsToFS(agent.fs, [
  { kind: 'text', name: 'spec.md', text: '# 规格' },
  { kind: 'image', name: 'cat.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
]);
store.state.files = agent.fs.export();
store.notify();
ui.renderFiles();
ok('uploads/ 下生成两条记录', written.length === 2 && written[0] === 'uploads/spec.md', JSON.stringify(written));
agent.fs.write('outputs/nested/deep.md', '# 深一层');
store.state.files = agent.fs.export();
ui.renderFiles();
const rowPath = (n) => n.dataset.path;
const paths = $$('#file-list .ft-file').map(rowPath);
const dirs = $$('#file-list .ft-dir').map(rowPath);
ok('文件行按 data-path 记录完整路径', paths.includes('uploads/cat.png') && paths.includes('uploads/spec.md'), paths.join(','));
ok('目录节点被识别（uploads / outputs / outputs/nested）', dirs.join(',') === 'outputs,outputs/nested,uploads', dirs.join(','));
ok('目录行带 aria-expanded', $$('#file-list .ft-dir').every((n) => n.getAttribute('aria-expanded') === 'true'));
ok('最外层目录显示文件总数目与总体积', (() => {
  const t = $$('#file-list .ft-dir').find((n) => rowPath(n) === 'uploads')?.querySelector('.ft-dir-count')?.textContent || '';
  return /^2 个文件 · \d/.test(t);
})(), $$('#file-list .ft-dir').map((n) => `${rowPath(n)}=${n.querySelector('.ft-dir-count')?.textContent}`).join(' | '));
ok('嵌套目录仍只显示精简的文件数，不让体积挤占行内空间', (() => {
  const t = $$('#file-list .ft-dir').find((n) => rowPath(n) === 'outputs/nested')?.querySelector('.ft-dir-count')?.textContent || '';
  return t === '1 个文件' && !/·/.test(t);
})());
ok('文件行显示文件名，整条路径挂到行 title', (() => {
  const row = $$('#file-list .ft-file').find((n) => rowPath(n) === 'uploads/cat.png');
  return !!row && row.querySelector('.ft-name').textContent === 'cat.png' && row.title === 'uploads/cat.png';
})());
ok('目录行 title 提示折叠与数量', (() => {
  const row = $$('#file-list .ft-dir').find((n) => rowPath(n) === 'uploads');
  return /共 2 个文件/.test(row.title) && /点击折叠/.test(row.title);
})(), $$('#file-list .ft-dir').map((n) => n.title).join(' | '));
ok('缩进由 --d 驱动', $$('#file-list .ft-row').some((n) => n.style.getPropertyValue('--d') === '2'), $$('#file-list .ft-row').map((n) => n.style.getPropertyValue('--d')).join(','));
ok('每个文件行有下载与复制按钮（均带无障碍名），下载在左、复制靠右', $$('#file-list .file-dl').length === 3 && $$('#file-list .ft-file').every((row) => {
  const acts = [...row.querySelectorAll('.ft-actions .files-icon-btn')].map((b) => b.className);
  return acts.length === 2 && acts[0].includes('file-dl') && acts[1].includes('ft-copy')
    && !!row.querySelector('.ft-copy[aria-label]') && !!row.querySelector('.file-dl[aria-label]');
}), $$('#file-list .ft-file').map((row) => [...row.querySelectorAll('.ft-actions .files-icon-btn')].map((b) => b.className).join(',')).join(' | '));
ok('目录行不显示复制按钮和下载按钮（也无目录级打包按钮）', $$('#file-list .ft-dir').every((row) => !row.querySelector('.ft-copy') && !row.querySelector('.file-dl') && !row.querySelector('.ft-zip')) && $$('#file-list .ft-zip').length === 0, `ft-zip=${$$('#file-list .ft-zip').length} 个`);
ok('目录/文件图标为内联 SVG', $$('#file-list .ft-ico').every((n) => !!n.querySelector('svg')));
ok('文件数单独显示', /3 个文件/.test($('#files-n').textContent), $('#files-n').textContent);
ok('容量单独显示已用/上限（按字节动态切换 KB/MB）', /\d+\.\d(?:KB|MB)\/120\.0MB/.test($('#files-count').textContent), $('#files-count').textContent);

// 折叠：点目录行收起整棵子树
const uploadsRow = () => $$('#file-list .ft-dir').find((n) => rowPath(n) === 'uploads');
click(uploadsRow());
ok('折叠时目录子行播放收起动画', $$('#file-list .ft-row-collapsing').length > 0);
ui.renderFiles();
ok('折叠后子文件不再渲染', !$$('#file-list .ft-file').map(rowPath).includes('uploads/cat.png'), $$('#file-list .ft-file').map(rowPath).join(','));
ok('折叠后 aria-expanded=false 且带 closed 类', uploadsRow().getAttribute('aria-expanded') === 'false' && uploadsRow().classList.contains('closed'));
ok('复制/下载按钮只在悬浮或聚焦时显示（无常显规则），文件名使用独立可收缩列', /\.ft-row:hover \.files-icon-btn, \.ft-row:focus-within \.files-icon-btn \{ opacity: 1; \}/.test(cssText) && !/\.ft-row\.ft-dir \.files-icon-btn, \.ft-row\.ft-file \.ft-copy \{ opacity: 1; \}/.test(cssText) && /\.ft-row\.ft-file \{[^}]*grid-template-columns: 12px 14px minmax\(0, 1fr\) auto/.test(cssText) && /\.ft-actions \{[^}]*justify-self: end/.test(cssText));
ok('目录行网格不再留操作按钮列', /\.ft-row\.ft-dir \{[^}]*grid-template-columns: 12px 14px minmax\(0, 1fr\) max-content;/.test(cssText));
ok('文件行复制按钮定位在操作区，不与文件名叠压', /\.ft-row\.ft-file \{[^}]*grid-template-columns: 12px 14px minmax\(0, 1fr\) auto/.test(cssText) && /\.ft-row \.files-icon-btn \{ width: 18px; height: 18px;/.test(cssText));
ok('触屏文件行紧凑至 36px，保留操作按钮触控目标', /\.file-item, \.ft-row \{ min-height: 36px; padding-top: 0; padding-bottom: 0; \}/.test(cssText) && /\.ft-row \.files-icon-btn, \.file-item \.file-dl \{ width: 36px; height: 36px; \}/.test(cssText));
ok('双视图滑块视觉轨道为 24px，透明触控区仍有 40px', /\.fv-actions \.fv-modes \{[^}]*height: 24px; min-height: 24px/.test(cssText) && /\.fv-actions \.fv-modes button \{[^}]*height: 18px; min-height: 0/.test(cssText) && /\.fv-actions \.fv-modes button::after \{ content:\s*["']{2}; position: absolute; inset: -11px 0; \}/.test(cssText));
click(uploadsRow());
ok('再点一次展开', $$('#file-list .ft-file').map(rowPath).includes('uploads/cat.png'));
ok('展开时目录子行播放进入动画', $$('#file-list .ft-row-expanding').length > 0);
click($$('#file-list .ft-file').find((n) => rowPath(n) === 'uploads/cat.png'));
ok('图片文件在查看器内预览', !!$('#file-viewer .fv-img img'));
ok('查看器带 SVG 下载按钮', !!$('#file-viewer #fv-dl svg') && /下载/.test($('#file-viewer #fv-dl').textContent));
ok('查看器关闭按钮为 SVG', !!$('#file-viewer #fv-close svg'));
click($('#fv-close'));
ok('查看器可关闭', !$('#file-viewer').classList.contains('open'));

let download = null, downloadName = null;
const origCreate = window.URL.createObjectURL;
const origRevoke = window.URL.revokeObjectURL;
const origClick = window.HTMLAnchorElement.prototype.click;
window.URL.createObjectURL = (b) => { download = b; return 'blob:fake'; };
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () { downloadName = this.getAttribute('download'); };
click($$('#file-list .file-dl').find((n) => n.closest('.ft-file').dataset.path === 'uploads/spec.md'));
ok('单文件下载触发且文件名正确', !!download && /spec\.md$/.test(downloadName || ''), String(downloadName));
ok('单文件下载按钮是 SVG 图标（不是 emoji）', !/⬇|↓/.test($$('#file-list .file-dl')[0].innerHTML) && !!$$('#file-list .file-dl')[0].querySelector('svg'));
ok('目录行点击展开/折叠而不是触发下载（无 ft-zip 按钮可点）', $$('#file-list .ft-zip').length === 0);
download = null; downloadName = null;
click($('#download-zip'));
ok('整包 ZIP 下载触发', !!download && download.size > 100, `size=${download?.size}`);
ok('ZIP 文件名规范', /^dubhe-workspace-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/.test(downloadName || ''), String(downloadName));
window.HTMLAnchorElement.prototype.click = origClick;
window.URL.createObjectURL = origCreate;
window.URL.revokeObjectURL = origRevoke;
const zipBlob = createZip([{ name: 'a.txt', bytes: new TextEncoder().encode('hi') }]);
ok('createZip 返回非空 Blob', zipBlob && zipBlob.size > 22, `size=${zipBlob?.size}`);

console.log('\n①⚡ 顶栏按钮风格一致性（SVG 图标 + 中文文案）');
const fast = $('#fast-toggle');
ok('快速按钮用 class="pill"（与思考/沙箱同结构）', fast.className.includes('pill'));
ok('快速按钮内联 SVG 图标', !!fast.querySelector('svg.pill-ico') && !!fast.querySelector('svg path'));
ok('文案为「快速」而非 ⚡ Fast', fast.textContent.trim() === '快速', JSON.stringify(fast.textContent));
for (const id of ['#thinking-toggle', '#sandbox-toggle', '#fast-toggle']) {
  ok(`${id} 三个按钮同风格（pill + pill-ico svg）`, !!$(id) && $(id).classList.contains('pill') && !!$(id).querySelector('svg.pill-ico'));
}
ok('整站按钮不再使用 ⚡/⬇ emoji', !/⚡|⬇/.test(html) && !/⚡|⬇/.test(readUiSrc()));
click(fast.querySelector('svg') || fast);
ok('点击快速按钮切换 on 状态', fast.classList.contains('on') !== (store.state.settings.fastMode === false));
store.state.settings.fastMode = false; fast.classList.remove('on');

console.log('\n② Agent 出图在工具芯片中展示');
const call = { id: 'call-img-1', name: 'generate_image', args: { prompt: '一只橘猫' } };
const imgMsg = store.pushMessage({ role: 'assistant', text: '好的，我来生成。', model: 'gpt-5.5', toolCalls: [call], done: false });
ui.onAssistantStart(imgMsg);
const chipSel = '.chip[data-call-id="call-img-1"]';
const chip = window.document.querySelector(chipSel);
ok('工具芯片已渲染', !!chip);
ui.onToolEvent(call, { status: 'running', note: '图像生成中（gpt-image-2 · 1024x1024）…' });
ok('芯片显示生图进度', chip.querySelector('.chip-state').textContent.includes('图像生成中'), chip.querySelector('.chip-state').textContent);
const imagePayload = 'data:image/png;base64,iVBORw0KGgo=';
const resultText = '[图像生成完成]\n- 模型：gpt-image-2\n- 输出：outputs/image-001.png';
ui.onToolEvent(call, { status: 'ok', image: imagePayload, imagePath: 'outputs/image-001.png' });
ok('图片 payload 与路径保存在工具调用记录（由消息正文引用，不塞进芯片）', call.image === imagePayload && call.imagePath === 'outputs/image-001.png');
store.pushMessage({ role: 'tool', toolCallId: call.id, content: resultText });
ui.onToolResult(call, resultText);
ok('回填结果后出参完整显示在芯片内', chip.querySelector('.chip-result')?.textContent.includes('outputs/image-001.png'));
ok('工具调用到达完成态，不再持续旋转', chip.classList.contains('done') && !chip.classList.contains('running'));
ui.onAssistantDone(imgMsg);
ok('重绘后从 Store 恢复出参', window.document.querySelector(`${chipSel} .chip-result`)?.textContent.includes('outputs/image-001.png'));
ok('消息头部显示该轮实际模型 gpt-5.5', window.document.querySelector(`${chipSel}`).closest('.msg-assistant').querySelector('.msg-model').textContent === 'gpt-5.5');

console.log('\n③ 未收到首字时气泡内的连接动画');
const priorGetStatus = agent.getStatus;
agent.getStatus = () => 'connecting';
ui.setStatus('connecting');
const waitMsg = store.pushMessage({ role: 'assistant', text: '', model: 'claude-opus-5', reasoningLevel: 'off', done: false });
ui.onAssistantStart(waitMsg);
const waitWrap = window.document.querySelector(`.msg[data-id="${waitMsg.id}"]`);
ok('显示「正在连接 claude-opus-5」', waitWrap.querySelector('.connect-line')?.textContent.includes('正在连接 claude-opus-5'), waitWrap.querySelector('.md-body')?.textContent);
ok('首字等待提示为深色呼吸点', !!waitWrap.querySelector('.connect-dot') && !waitWrap.querySelector('.connect-ring, .connect-mark'));
store.updateMessage(waitMsg.id, { text: '你好！', done: true });
ui.onAssistantDone(waitMsg);
ok('收到内容后连接动画消失', !waitWrap.querySelector('.connect-line'));
agent.getStatus = priorGetStatus;
ui.setStatus('done');

console.log('\n① 用户消息即时上屏（不必等 AI 输出完）');
const mainSrc = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
ok('main.js 已把 onUserMessage 接到 ui.onUserMessage(msg)', /onUserMessage:\s*\(text,\s*msg\)\s*=>\s*\{\s*ui && ui\.onUserMessage\(msg\)/.test(mainSrc), mainSrc.split('\n').find((l) => l.includes('onUserMessage')));
const origFetch = globalThis.fetch;
let releaseStream = null;
store.state.settings.webEnabled = false;
store.state.settings.jevEnabled = false;
globalThis.fetch = async (url) => {
  if (String(url).includes('/api/sandbox-web/health')) return new Response('{}', { status: 404 });
  if (/\/api\/health(?:\?|$)/.test(String(url))) {
    return new Response(JSON.stringify({ ok: true, relay: 'test-relay', capabilities: ['fetch'] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return new Promise((resolve) => {
    releaseStream = () => resolve(new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"已收到\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n",
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));
  });
};
const beforeCount = store.state.messages.length;
const sending = agent.send('这条输入应当立刻可见');
for (let i = 0; i < 20 && !releaseStream; i++) await new Promise((resolve) => setTimeout(resolve, 5));
const userNodes = $$('#messages .msg-user .bubble').map((n) => n.textContent.trim());
ok('发送后立即可见用户气泡', userNodes.some((t) => t.includes('这条输入应当立刻可见')), userNodes.join(' | '));
ok('用户消息已进入 state（其后才是 assistant 占位）', (() => {
  const list = store.state.messages;
  const lastUser = [...list].reverse().find((m) => m.role === 'user');
  return list.length > beforeCount && !!lastUser && lastUser.text.includes('这条输入应当立刻可见');
})());
ok('用户消息可复制', !!$('#messages .msg-user .act[data-act="copy"]'));
ok('用户气泡没有回滚（每轮回滚只出现在助手侧）', !$('#messages .msg-user .act[data-act="rollback"]'));
if (releaseStream) releaseStream();
await sending;
globalThis.fetch = origFetch;

console.log('\n② 空状态随机三条示例 + 换一批');
const sg = await import(path.join(ROOT, 'js/suggestions.js'));
ok('示例池 ≥12 条', sg.SUGGESTIONS.length >= 12, `${sg.SUGGESTIONS.length} 条`);
// 重挂空状态：清空消息后 rebuildMessages 会重新渲染
const savedMsgs = [...store.state.messages];
store.state.messages.length = 0;
ui.rebuildMessages();
const quickPrompts = $('#welcome-quick-prompts');
const cards = quickPrompts ? [...quickPrompts.querySelectorAll('.suggest')] : [];
ok('空状态展示 3 条示例卡片', cards.length === 3, `${cards.length} 张`);
const cmp = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return `${i}:${a.charCodeAt(i)}≠${b.charCodeAt(i)}`; return a.length === b.length ? 'eq' : `len ${a.length}/${b.length}`; };
ok('示例卡不再带「任务类型」标签，主题短于完整提示词', cards.every((c) => !c.querySelector('.suggest-tag') && c.textContent.trim() && c.dataset.prompt && c.textContent.trim() !== c.dataset.prompt && c.textContent.trim().length < c.dataset.prompt.length),
  cards.map((c) => `${cmp(c.textContent.trim(), c.dataset.prompt || '')}/${c.querySelector('.suggest-tag') ? '有标签' : '无标签'}`).join(' | '));
ok('CSS 里也没有 .suggest-tag 残留', !cssText.includes('.suggest-tag'));
ok('示例文本来自池子且本轮不重复', cards.every((c) => sg.SUGGESTIONS.some((x) => x.text === c.dataset.prompt)) && new Set(cards.map((c) => c.dataset.prompt)).size === 3);
ok('有「换一批」按钮', !!$('#welcome-quick-prompts .suggest-shuffle svg'));
const firstBatch = cards.map((c) => c.dataset.prompt).join('|');
// 连续重挂若干次，期望至少出现一次不同的组合（随机生效）
let sawDifferent = false;
for (let i = 0; i < 12 && !sawDifferent; i++) {
  click($('#welcome-quick-prompts .suggest-shuffle'));
  const now = [...window.document.querySelectorAll('#welcome-quick-prompts .suggest')].map((c) => c.dataset.prompt).join('|');
  if (now !== firstBatch) sawDifferent = true;
}
ok('换一批会换出不同组合', sawDifferent);
const cardEl = window.document.querySelector('#welcome-quick-prompts .suggest');
click(cardEl);
ok('点示例卡把完整提示词填进输入框', (() => {
  const v = $('#composer-input').value;
  return v === cardEl.dataset.prompt && v !== cardEl.textContent.trim() && v.length > 8;
})(), JSON.stringify($('#composer-input').value).slice(0, 60));
store.state.messages.push(...savedMsgs);
ui.rebuildMessages();

console.log('\n④ 侧栏 Logo 不再自转');
const logoRule = /\.logo-mark\s*\{[^}]*\}/.exec(cssText)?.[0] || '';
ok('.logo-mark 无 animation', !/animation/.test(logoRule), logoRule.trim());
ok('产品 Logo 全部静止，只有连接呼吸点在动', /\.empty-logo svg\s*\{[^}]*animation: none/.test(cssText)
  && /\.connect-dot\s*\{[^}]*animation: connectBreathe/.test(cssText)
  && !/@keyframes halfspin/.test(cssText));
ok('index.html 侧栏 Logo 无内联动画', !/logo-mark[^>]*style="[^"]*animation/.test(html));

console.log('\n③ 视图层故障不能 brick 发送');
const cfgMod = await import(path.join(ROOT, 'js/config.js'));
const cfgMod2 = cfgMod;
ok('侧栏展示构建版本', $('#build-stamp').textContent.includes(cfgMod.APP_VERSION), $('#build-stamp').textContent);
ok('index.html 入口资源已版本化', /css\/styles\.css\?v=/.test(html) && /js\/main\.js\?v=/.test(html));
// 旧调用方只传文本（缓存了旧 main.js 的情形）：UI 需自己找回那条用户消息
const oldStyle = store.pushMessage({ role: 'user', text: '旧式调用只给文本' });
ui.onUserMessage('旧式调用只给文本');
ok('旧式 onUserMessage(text) 仍能上屏', $$('#messages .msg-user .bubble').some((n) => n.textContent.includes('旧式调用只给文本')));
ok('不会重复插入同一节点', $$('#messages .msg[data-id="' + oldStyle.id + '"]').length === 1,
  `${$$('#messages .msg[data-id="' + oldStyle.id + '"]').length} 个节点`);
ui.onUserMessage('旧式调用只给文本');
ok('重复调用被去重', $$('#messages .msg[data-id="' + oldStyle.id + '"]').length === 1);

console.log('\n⑥ 新增供应商本地图标');
const { PROVIDER_ICON, providerIcon } = await import(path.join(ROOT, 'js/icons.js'));
for (const [provider, file] of [['Kimi', 'kimi.svg'], ['Doubao', 'doubao.svg'], ['Qwen', 'qwen.svg'], ['MiniMax', 'minimax.svg']]) {
  const iconPath = path.join(ROOT, 'assets/icons', file);
  ok(`providerIcon(${provider}) 指向本地 ${file}`, PROVIDER_ICON[provider]?.file === file
    && providerIcon(provider).includes(`assets/icons/${file}`)
    && fs.existsSync(iconPath) && fs.readFileSync(iconPath, 'utf8').includes('<svg'));
}

console.log('\n⑩ 操作条：输出结束才出现，复制按钮带 SVG 图标');
{
  const { renderMarkdown: _rm } = await import(path.join(ROOT, 'js/ui.js'));
  store.pushMessage({ role: 'user', text: '请写点东西' });
  const partial = store.pushMessage({ role: 'assistant', text: '写到一半', model: 'gpt-5.5', done: false });
  ui.rebuildMessages();
  const wrapOf = (id) => $(`#messages .msg[data-id="${id}"]`);
  const userMsg = store.state.messages[store.state.messages.length - 2];
  ok('流式期间：本轮 user 与 assistant 的操作条都隐藏',
    wrapOf(userMsg.id).classList.contains('actions-pending') && wrapOf(partial.id).classList.contains('actions-pending'));
  const cssText2 = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
  ok('隐藏由 .actions-pending + display:none 实现', /\.msg\.actions-pending \.msg-actions[^{]*\{[^}]*display: none/.test(cssText2));
  store.updateMessage(partial.id, { done: true });
  ui.setStatus('done'); // 真实链路：agent 的 onStatus → ui.setStatus → 刷新显隐
  ui.onAssistantDone(partial);
  ok('输出完成后操作条出现', !wrapOf(partial.id).classList.contains('actions-pending'));
  const acts = [...wrapOf(partial.id).querySelectorAll('.act')];
  ok('复制按钮是无文字 SVG 图标，保留可访问名称', acts.some((b) => b.dataset.act === 'copy' && b.querySelector('svg') && !b.textContent.trim() && /复制/.test(b.getAttribute('aria-label') || b.title)),
    acts.map((b) => b.innerHTML.slice(0, 24)).join(' | '));
  ok('回滚/重新生成同样带 SVG（同一视觉语言）',
    acts.filter((b) => b.dataset.act !== 'copy').every((b) => b.querySelector('svg')));
  ok('工具图标没有 emoji 残留', !/[⚡⬇◧◨◑⤺↻📄🖼]/.test(acts.map((b) => b.textContent).join('')), acts.map((b) => b.textContent.trim()).join(','));
  ok('「重新生成」只给最后一条 assistant', acts.find((b) => b.dataset.act === 'regen').style.display === '');
}

console.log('\n⑪ 沙箱面板：Workspace 卡片');
{
  ok('卡片标题是「沙箱」', $('.files-card-name')?.textContent.trim() === '沙箱');
  ok('容量与文件数分开显示', /0\.0(?:KB|MB)\/\d+\.\dMB/.test($('#files-count')?.textContent || '') && /个文件/.test($('#files-n')?.textContent || ''),
    `${$('#files-count')?.textContent} | ${$('#files-n')?.textContent}`);
  ok('打包/清空是卡片头图标按钮', !!$('#download-zip.files-icon-btn') && !!$('#clear-files.files-icon-btn'));
  const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
  ok('卡片有描边圆角', /\.files-card\s*\{[^}]*border-radius/.test(css));
  ok('空提示无虚线框', !/\.empty-hint\s*\{[^}]*dashed/.test(css));
}

console.log('\n⑫ 联网开关（无中继显示关闭态并可重试探测，有中继可开）');
{
  const web = await import(path.join(ROOT, 'js/websearch.js'));
  const pill = $('#web-toggle');
  ok('顶栏有「联网」pill（SVG + 中文）', !!pill && !!pill.querySelector('svg') && /联网/.test(pill.textContent), pill ? pill.textContent : '缺失');
  store.state.relayOk = false;
  ui.syncWeb();
  ok('无中继时保持关闭态并标记为可重试探测', !pill.classList.contains('on') && pill.classList.contains('degraded-off') && !pill.disabled);
  ok('提示语点明中继', /中继/.test(pill.title), pill.title);
  ok('webCapFor 恒为 null', web.webCapFor('gpt-5.5') == null && web.webCapFor('claude-opus-5') == null);
  click(pill);
  ok('无中继点击只重试探测且不能打开', !pill.classList.contains('on'));
  store.state.relayOk = true;
  store.state.settings.webEnabled = true;
  ui.syncWeb();
  ok('有中继时可点且能亮', !pill.disabled && pill.classList.contains('on'));
  click(pill);
  ok('有中继再点可关掉', !pill.classList.contains('on') && store.state.settings.webEnabled === false);
  store.state.settings.webEnabled = true;
  ui.syncWeb();
  const m = store.pushMessage({
    role: 'assistant', text: '根据来源回答', model: store.state.model, done: true,
    webSearch: { status: 'done', results: 2, queries: ['pyodide 0.26 版本'], sources: [{ url: 'https://pyodide.org/docs', title: 'Pyodide 文档' }, { url: 'https://a.test/b', title: 'B' }] },
  });
  ui.rebuildMessages();
  const note = $('#messages .msg[data-id="' + m.id + '"] .web-note');
  ok('历史来源条仍可渲染', !!note && /服务端检索到 2 条来源/.test(note.textContent) && /pyodide 0.26 版本/.test(note.textContent), note ? note.textContent : '缺失');
  ok('来源渲染成可点外链且带 noopener', [...note.querySelectorAll('a.web-src')].length === 2 && String(note.querySelector('a').getAttribute('rel')).includes('noopener') && note.querySelector('a').target === '_blank');
}

console.log('\n⑬ 余额显示已删除');
{
  const html2 = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  ok('markup 里没有 balance-badge', !/balance-badge/.test(html2));
  ok('UI 源码不再请求余额接口', !/fetchBalance|\/api\/user\/self/.test(readUiSrc()));
  const uiSrc = readUiSrc();
  ok('api.js 也不再导出余额函数', !/export async function fetchBalance/.test(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8')) && !/refreshBalance/.test(uiSrc));
}

console.log('\n⑭ 欢迎页在 y 轴居中');
{
  const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
  const rule = /\.empty-state\s*\{[^}]*\}/.exec(css)?.[0] || '';
  ok('empty-state 自己是 flex 纵向居中容器', /display: flex/.test(rule) && /align-items: center/.test(rule) && /justify-content: (?:safe )?center/.test(rule), rule);
  ok('靠 min-height:100% 占满视口而不是拍脑袋的 margin', /min-height: 100%/.test(rule) && !/margin: 9vh/.test(rule), rule);
  ok('内容超高时不裁顶（safe center）', /justify-content: safe center/.test(rule), rule);
  ok('有对话时布局不变（.messages 仍是普通滚动容器）', !/\.messages\s*\{[^}]*display: flex/.test(css));
}

console.log('\n⑮ 版本漂移自检（硬刷新前就能发现缓存不一致）');
{
  const uiSrc = readUiSrc();
  ok('入口自带 app-version meta', /<meta name="app-version" content="([\d.]+)"/.test(fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8')));
  ok('UI 比对入口版本与模块版本并提示', /meta\[name="app-version"\]/.test(uiSrc) && /资源缓存不一致|缓存不一致/.test(uiSrc));
  ok('侧栏版本号仍然显示', $('#build-stamp').textContent.includes(cfgMod2.APP_VERSION), $('#build-stamp').textContent);
}

console.log('\n⑯ 移动端布局：根因修复 + 密度重排（源码级护栏）');
{
  const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
  const uiSrc = readUiSrc();
  // 根因：窄屏时 sidebar / panel 变 position:fixed 脱离网格，若没有命名网格区，
  // 唯一的在流子项 .main 会被自动排进第一列（--sbw 收敛为 0px）→ 主区宽度 0、内容挤成一团
  ok('网格用命名区域钉住三块', /grid-template-areas:\s*"side main panel"/.test(css));
  ok('.main / .sidebar / #sandbox-panel 各自认领区域', /\.main\s*\{[^}]*grid-area:\s*main/.test(css)
    && /\.sidebar\s*\{[^}]*grid-area:\s*side/.test(css) && /#sandbox-panel\s*\{[^}]*grid-area:\s*panel/.test(css));
  const m720 = [...css.matchAll(/@media \(max-width: 720px\) \{([\s\S]*?)^\}/gm)].map((m) => m[1]).join('\n');
  ok('存在 ≤720px 的移动端排布层', m720.length > 400, `${m720.length} 字节`);
  ok('顶栏胶囊右对齐换行，面板入口保持可见', /\.topbar-right\s*\{[^}]*flex-wrap: wrap/.test(m720) && /\.topbar-right\s*\{[^}]*justify-content: flex-end/.test(m720));
  ok('输入框字号 16px（低于它 iOS 会放大整页）', /#composer-input\s*\{[^}]*font-size: 16px/.test(m720));
  const narrow380 = /@media \(max-width: 380px\) \{([\s\S]*?)^\}/m.exec(css)?.[1] || '';
  ok('移动端消息保留安全边距且不限制用户气泡宽度', /\.msg\s*\{[^}]*padding: 0 20px;[^}]*max-width: 100%/.test(m720)
    && /\.msg-user \.bubble\s*\{[^}]*max-width: 100%/.test(css) && /\.msg\s*\{[^}]*padding: 0 18px/.test(narrow380)
    && !/\.msg-user \.bubble\s*\{[^}]*max-width: 82%/.test(css));
  ok('窄屏消息操作与元信息分行，避免多轮工具栏重叠', /\.msg-actions\s*\{[^}]*flex: 1 1 100%;[^}]*flex-wrap: wrap;[^}]*overflow: visible/.test(m720)
    && /\.msg-foot\s*\{[^}]*flex: 1 1 100%/.test(m720));
  ok('长链接/代码块各自滚动不撑宽页面', /\.md-body pre\s*\{[^}]*font-size/.test(m720) && /\.md-body a\s*\{[^}]*overflow-wrap: anywhere/.test(m720));
  ok('输入区贴安全区（刘海屏不被遮挡）', /\.composer-wrap\s*\{[^}]*env\(safe-area-inset-bottom\)/.test(m720));
  const touch = /@media \(hover: none\), \(max-width: 720px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  ok('触屏设备（含平板）核心 pill/小按钮/图标按钮 ≥40px', /\.pill\s*\{[^}]*min-height: 40px/.test(touch)
    && /\.mini-btn\s*\{[^}]*min-height: 40px/.test(touch) && /\.icon-btn\s*\{[^}]*min-height: 40px/.test(touch), `${touch.length} 字节`);
  // 触屏层曾把字号/内边距一起放大：中文标签一换行，左下角四个按钮就被撑成两行高（58px）、
  // 模型菜单每行 44px 也长得不像话 —— 现在只抬到「够点得中」，并且按钮文字永不折行
  ok('触屏层的按钮文字不折行', /\.mini-btn\s*\{[^}]*white-space: nowrap/.test(touch) && /\.mini-btn\s*\{[^}]*white-space: nowrap/.test(css));
  ok('模型菜单行收敛到 38px（不再是 44px）', /\.dd-item, \.sess-item\s*\{\s*min-height: 38px/.test(touch) && !/\.dd-item[^{]*\{[^}]*min-height:\s*44px/.test(touch));
  ok('左下角按钮不再被换行撑高（内边距/字号不跟着触屏层放大）', !/\.mini-btn\s*\{[^}]*padding: 9px 12px/.test(touch));
  // 工具芯片：图标改 SVG（原先是 ⚙ 字符），且只有「没跑完」时才转动
  ok('工具芯片图标用 SVG 且跑完停转', /\.chip:not\(\.done\) \.chip-ico\s*\{[^}]*animation: spin/.test(css)
    && /\.chip\.done \.chip-ico\s*\{[^}]*animation: none/.test(css)
    && /chip-ico">\$\{ICON\.tool/.test(uiSrc) && !/chip-ico">⚙/.test(uiSrc));
  ok('刷新模型按钮只转箭头（不转整个按钮）', /\.icon-btn\.spin svg\s*\{[^}]*animation: spin/.test(css) && !/\.icon-btn\.spin\s*\{\s*animation/.test(css));
  ok('芯片完成时打上 .done', /classList\.(?:add\('done'\)|toggle\('done',\s*allDone\))/.test(uiSrc));
  // 图例统一：按钮里不许再出现图形字符（用户明确要求「SVG + 中文，不要 emoji/字符图形」）
  const htmlSrc = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  ok('顶栏/侧栏按钮图标全是 SVG（没有 ⟳ ⟨ ☰ ✕ 这类字符）', !/[\u27F3\u27E8\u2630\u2715\u21BB\u2699]/.test(htmlSrc) && /refresh-models[^>]*>\s*<svg/.test(htmlSrc)
    && /sidebar-toggle[^>]*>\s*<svg/.test(htmlSrc) && /sidebar-fab[^>]*>\s*<svg/.test(htmlSrc));
  // 顶栏 pill 的反色选中态必须与 :hover 写在同一条规则里：分开写时 .pill:hover:not(:disabled)
  // 特异度更高，会压住 .pill.on → 点开后指针没移开时文字与背景同色（用户报的「点了没反应」）
  ok('pill 选中态压得住 hover（写进同一条规则）', /\.pill\.on,\s*\n?\.pill\.on:hover:not\(:disabled\)/.test(cssText));
  const activePillStart = cssText.indexOf('.pill.on,');
  const activePillRule = cssText.slice(activePillStart, cssText.indexOf('}', activePillStart));
  ok('pill 启用态使用用户气泡前景/背景色', activePillRule.includes('background: var(--chat-user-bubble)')
    && activePillRule.includes('color: var(--chat-user-text)'), activePillRule);
  ok('桌面回复图片最大宽度为卡片的 70%', cssText.includes('.md-body img { max-width: 70% !important; height: auto;'));
  const svgStart = cssText.indexOf('.sb-img[src*="image/svg"], .md-body img[src*="image/svg"]');
  const svgEnd = cssText.indexOf('\n}', svgStart);
  const svgRule = cssText.slice(svgStart, svgEnd < 0 ? undefined : svgEnd);
  ok('SVG 图片覆写也受 70% 上限约束且没有增宽的最小宽度', svgRule.includes('max-width: min(70%, 640px) !important') && svgRule.includes('min-width: 0'));
  ok('移动端图片恢复卡片 100% 宽度', cssText.includes('.md-body img { max-width: 100% !important; height: auto;')
    && cssText.includes('@media (max-width: 720px) {\n  .sb-img[src*="image/svg"], .md-body img[src*="image/svg"] { max-width: min(100%, 640px) !important;'));
  ok('icon-btn 用 flex 居中图标', /\.icon-btn\s*\{[^}]*display: inline-flex/.test(cssText) && /\.icon-btn\s*\{[^}]*justify-content: center/.test(cssText));
  // 发布版本来自 config.js；app 与导航页共用 V 号，构建戳独立递增。
  const cfgSrc = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
  const release = cfgMod2.APP_RELEASE;
  const navHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('config.js 分开维护发布版本与构建戳', /APP_RELEASE = 'V\d+(?:\.\d+)*'/.test(cfgSrc) && /APP_VERSION = '\d{4}\.\d+\.\d+\.\d+'/.test(cfgSrc));
  ok('标题与 meta 标明当前发布版', htmlSrc.includes(`<title>Dubhe Agent ${release} `) && htmlSrc.includes(`<meta name="app-release" content="${release}"`));
  ok('侧栏 Logo 旁有当前版本徽章', htmlSrc.includes(`class="ver-badge" title="Dubhe Agent ${release}">${release}</span>`) && /\.ver-badge\s*\{/.test(cssText));
  ok('底部版本戳用 APP_RELEASE 标明当前版本', /Dubhe Agent \$\{APP_RELEASE\}/.test(uiSrc) && /APP_RELEASE\b/.test(uiSrc));
  const bootSrc = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  ok('控制台横幅跟随当前版本', /Dubhe Agent \$\{APP_RELEASE\}/.test(bootSrc) && /import \{ APP_RELEASE \}/.test(bootSrc));
  ok('导航页提供可访问的外观切换入口', /id="theme-toggle"[^>]*>外观<\/button>/.test(navHtml));
  const homeCss = fs.readFileSync(path.join(ROOT, 'css/home.css'), 'utf8');
  ok('导航页加载本地 Source Serif 字体并为中文保留系统回退', /href="fonts\/literary\.css\?v=/.test(navHtml) && /--serif: \"Dubhe Serif\"/.test(homeCss) && /Songti SC.*Noto Serif SC/.test(homeCss));
  ok('导航与正文排版启用字偶距/连字优化及平衡标题', /font-kerning: normal; font-optical-sizing: auto; text-rendering: optimizeLegibility/.test(homeCss) && /text-wrap: balance/.test(homeCss));
  ok('会话/附件删除键也是 SVG', /sess-del[^>]*>\$\{ICON\.x\}/.test(uiSrc) && /attach-chip-x[^>]*>\$\{ICON\.x\}/.test(uiSrc));
  // 刷新后「对话 + 附件 + 沙箱」都要在：重数据外置到 IndexedDB
  const stateSrc = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8');
  ok('重数据外置到 IndexedDB（附件图/沙箱图/生成图）', /extractBlobs/.test(stateSrc) && /applyBlobs/.test(stateSrc) && /hydrateBlobs/.test(stateSrc)
    && /createBlobPersistenceQueue/.test(stateSrc) && /blobPersistenceQueue\(entries, keep\)/.test(stateSrc), 'state.js 缺少外置逻辑或有序快照清理');
  ok('启动时水合并重绘界面', /hydrateBlobs\(\)\.then/.test(mainSrc || fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8'))
    && /afterHydrate/.test(uiSrc));
  // 侧栏面板按钮曾被 textContent='◧' 整体替换，丢掉 pill 的「图标 + 文字」统一外观并被压到 30 多像素宽
  ok('沙箱面板按钮保留图标+文字（没有 ◧ / ◨ 字符）', !/[◧◨]/.test(uiSrc));
  ok('它的状态改用 class + aria-pressed 表达', /setPanelCollapsed/.test(uiSrc) && /aria-pressed/.test(uiSrc) && /classList\.toggle\('on'/.test(uiSrc));
}

console.log('\n⑰ 工具折叠 / 出参回填 / 识图路径回归');
{
  const unicodeOutput = '中文，标点「全角」✅🔧 \\frac{a}{b}\n```nested';
  try { agent.fs.write('uploads/screenshot.png', 'data:image/png;base64,AA=='); } catch {}
  store.state.messages = [
    { id: 'ui-fold-user', role: 'user', text: '分析并整理附件' },
    {
      id: 'ui-fold-assistant', role: 'assistant', model: store.state.model, done: true, reasoningLevel: 'off', text: '',
      toolCalls: [
        { id: 'know-1', name: 'knowledge_search', args: { query: 'chart 围栏语法' } },
        { id: 'analyze-1', name: 'analyze_image', args: { path: 'uploads/screenshot.png' } },
        { id: 'list-1', name: 'list_files', args: {} },
        { id: 'list-2', name: 'list_files', args: { detail: true } },
        { id: 'copy-1', name: 'copy_file', args: { from: 'a.txt', to: 'b.txt' } },
        { id: 'empty-1', name: 'execute_javascript', args: { code: 'void 0' } },
        { id: 'read-1', name: 'read_file', args: { path: 'notes/source.md' } },
        { id: 'write-1', name: 'write_file', args: { path: 'notes/output.md', content: 'done' } },
        { id: 'fail-1', name: 'fetch_url', args: { url: 'https://example.com/' } },
      ],
    },
    { id: 'ui-fold-tool-know', role: 'tool', toolCallId: 'know-1', name: 'knowledge_search', content: '[知识检索结果] :::chart 围栏语法素材（系统提示词素材，不应出现在界面）' },
    { id: 'ui-fold-tool-analyze', role: 'tool', toolCallId: 'analyze-1', name: 'analyze_image', content: '[识图完成] 模型 vision · 文件 uploads/screenshot.png · 全文 9 字\n' + unicodeOutput },
    { id: 'ui-fold-tool-list-1', role: 'tool', toolCallId: 'list-1', name: 'list_files', content: unicodeOutput },
    { id: 'ui-fold-tool-list-2', role: 'tool', toolCallId: 'list-2', name: 'list_files', content: 'second output' },
    { id: 'ui-fold-tool-copy', role: 'tool', toolCallId: 'copy-1', name: 'copy_file', content: 'copied' },
    { id: 'ui-fold-tool-empty', role: 'tool', toolCallId: 'empty-1', name: 'execute_javascript', content: '' },
    { id: 'ui-fold-tool-read', role: 'tool', toolCallId: 'read-1', name: 'read_file', content: 'source text' },
    { id: 'ui-fold-tool-write', role: 'tool', toolCallId: 'write-1', name: 'write_file', content: 'written' },
    { id: 'ui-fold-tool-fail', role: 'tool', toolCallId: 'fail-1', name: 'fetch_url', content: '工具执行失败：测试错误提示' },
  ];
  ui.rebuildMessages();
  const ran = $('.ran-commands');
  const explored = $('.explored-files');
  const rans = $$('.ran-commands'), allCommandChips = $$('.tool-call-chip');
  ok('只有相邻同类命令合并，不能越过读取/修改文件', !!ran && rans.length === 2);
  ok('Ran Commands 计数按实际调用数统计', !!ran && ran.querySelector('.chip-name').textContent === 'Ran commands 4' && rans[1].querySelector('.chip-name').textContent === 'Ran command', ran && ran.querySelector('.chip-name').textContent);
  ok('analyze_image 不再作为命令 chip，图片路径进入 Explored Files', !!explored
    && /uploads\/screenshot\.png/.test(explored.textContent)
    && !ran.textContent.includes('analyze_image'));
  ok('2026.10.9.1：同名多次命令逐条展开（每条一行，不合并成 ×N），所有出参都能回读', !!ran && allCommandChips.length === 5
    && !ran.textContent.includes('×') && ran.textContent.includes(unicodeOutput) && ran.textContent.includes('second output'));
  const emptyChip = $$('.tool-call-chip', ran || document).find((n) => n.dataset.callIds === 'empty-1');
  ok('空字符串出参也算完成，判为失败并提示 No output', !!emptyChip && emptyChip.classList.contains('done')
    && emptyChip.classList.contains('fail') && emptyChip.querySelector('.chip-no-output')?.textContent === 'No output');
  const foldState = rans[1]?.querySelector(':scope > .chip-state');
  ok('折叠头只是菜单：不写成功 / 失败，失败数只进 title', !!foldState && !/成功|失败|failed/i.test(foldState.textContent) && /1 条失败/.test(foldState.title), foldState?.textContent + ' | ' + foldState?.title);
  const failChip = allCommandChips.find((n) => n.dataset.callIds === 'fail-1');
  const failState = failChip && failChip.querySelector('.chip-state');
  ok('失败命令行只显示 ✗ 图标 + 耗时，不出现中文「失败」或英文 failed', !!failState && /✗/.test(failState.textContent) && !/成功|失败|failed/i.test(failState.textContent) && !!failState.querySelector('.chip-fail') && failState.querySelector('.chip-fail').getAttribute('aria-label') === '失败', failState?.textContent);
  ok('失败原因仍通过原生悬浮提示提供', /工具执行失败：测试错误提示/.test(failState?.title || ''), failState?.title);
  const okChip = $$('.tool-call-chip', ran || document).find((n) => n.dataset.callIds === 'copy-1');
  ok('成功命令行只显示 ✓ 图标 + 耗时，不出现中文「成功」', !!okChip && /✓/.test(okChip.querySelector('.chip-state').textContent) && !/成功|失败/.test(okChip.querySelector('.chip-state').textContent) && !!okChip.querySelector('.chip-state .chip-ok'), okChip?.querySelector('.chip-state')?.textContent);
  ok('纯工具轮完成后自动折叠', !ran.classList.contains('expanded'));
  click(ran);
  ok('Ran Commands 可手动重新展开', ran.classList.contains('expanded'));
  click(ran);
  ok('Ran Commands 可手动折叠', !ran.classList.contains('expanded'));
  // 2026.10.21：知识库检索 = 独立消息块，完成后收起且不可展开，检索结果（系统提示词素材）不上屏
  const know = $('.searched-library');
  ok('知识库检索是独立消息块（不进 Ran command 菜单）', !!know && !ran.textContent.includes('knowledge_search')
    && !allCommandChips.some((n) => n.dataset.callIds === 'know-1'));
  ok('检索完成后标签为过去时 Searched library 且自动收起', !!know && know.querySelector('.chip-name').textContent === 'Searched library' && !know.classList.contains('expanded'));
  click(know);
  ok('检索行点不开（完成后不可展开）', !!know && !know.classList.contains('expanded'));
  ok('检索词显示在状态标签右侧，检索结果（系统提示词素材）不出现在界面', !!know
    && know.querySelector('.chip-name')?.nextElementSibling === know.querySelector('.searched-library-query')
    && know.querySelector('.searched-library-query')?.textContent === 'chart 围栏语法'
    && !document.body.textContent.includes('系统提示词素材'));
}

console.log('\n⑰b 知识库检索行：直播态（抛光 + 英文进行时 + 显示检索词）→ 完成收起');
{
  const priorGetStatus = agent.getStatus;
  agent.getStatus = () => 'executing';
  store.state.messages = [
    { id: 'know-user', role: 'user', text: '帮我画一张图表' },
    {
      id: 'know-assistant', role: 'assistant', model: store.state.model, reasoningLevel: 'off', text: '',
      toolCalls: [{ id: 'know-live-1', name: 'knowledge_search', status: 'running', args: { query: 'rendering chart', topic: 'rendering' } }],
    },
  ];
  ui.rebuildMessages();
  const live = $('.searched-library');
  ok('检索中：is-working（抛光扫光生效态）+ 英文进行时 Searching library', !!live && live.classList.contains('is-working')
    && live.querySelector('.chip-name').textContent === 'Searching library');
  ok('仅 knowledge_search 的助手消息壳不会被空壳规则隐藏', !!live?.closest('.msg-assistant') && !live.closest('.msg-assistant').classList.contains('msg-collapsed'));
  ok('检索中：状态标签右侧实时显示检索内容（query · topic）', !!live && live.classList.contains('expanded')
    && live.querySelector('.searched-library-query')?.textContent === 'rendering chart · rendering');
  agent.getStatus = priorGetStatus;
  store.state.messages = [
    ...store.state.messages,
    { id: 'know-tool-1', role: 'tool', toolCallId: 'know-live-1', name: 'knowledge_search', content: '[知识检索结果] 围栏语法细则（系统提示词素材）' },
  ];
  store.state.messages[1].done = true;
  ui.rebuildMessages();
  const done = $('.searched-library');
  ok('检索结束：保留右侧检索词、不可展开，结果内容不上屏', !!done && !done.classList.contains('expanded')
    && done.querySelector('.chip-name').textContent === 'Searched library'
    && done.querySelector('.searched-library-query')?.textContent === 'rendering chart · rendering'
    && !document.body.textContent.includes('围栏语法细则'));
}

console.log('\n⑱ 设置页字号 / 深度思考 / 本地会话数回归');
{
  const { mountSettings, openSettingsModal, applyFontSize } = await import(path.join(ROOT, 'js/settings.js'));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 404, headers: { 'content-type': 'application/json' } });
  try {
    mountSettings(store);
    store.state.sessions = [
      { id: 'sess-1', messages: [{ role: 'user', text: 'one' }] },
      { id: 'sess-2', messages: [{ role: 'user', text: 'two' }] },
      { id: 'sess-3', messages: [{ role: 'user', text: 'three' }] },
    ];
    window.localStorage.setItem('dubhe-agent-state-v1-v2', JSON.stringify({ sessions: store.state.sessions }));
    window.localStorage.setItem('dubhe-agent-state', JSON.stringify({ sessions: [] })); // 旧错 key：不得影响计数
    openSettingsModal({ store });
    ok('未引用文件自动清理设置默认关闭', $('#set-cleanup-unreferenced')?.checked === false && store.state.settings.cleanupUnreferencedFiles === false);
    $('#set-cleanup-unreferenced').checked = true; $('#set-cleanup-unreferenced').dispatchEvent(new window.Event('change', { bubbles: true }));
    ok('用户开启设置后保存 cleanupUnreferencedFiles=true', store.state.settings.cleanupUnreferencedFiles === true);
    $('#set-cleanup-unreferenced').checked = false; $('#set-cleanup-unreferenced').dispatchEvent(new window.Event('change', { bubbles: true }));
    ok('关闭设置后恢复默认保留模式', store.state.settings.cleanupUnreferencedFiles === false);
    ok('本地存储按 v2 实际显示会话数而非旧 key 的 0', $('#set-about-store').textContent.startsWith('3 个会话'), $('#set-about-store').textContent);
    const imgSel = $('#set-image-model');
    ok('.33：设置页生图模型选择器与目录一致（5 项，含 gemini-nano-banana-2.1）', imgSel.options.length === 5 && [...imgSel.options].some((o) => o.value === 'gemini-nano-banana-2.1'), `实际 ${imgSel.options.length}`);
    ok('设置页生图选择器显示当前会话的生图模型', imgSel.value === store.state.imageModel, `${imgSel.value} vs ${store.state.imageModel}`);
    imgSel.value = 'gemini-nano-banana-2.1'; imgSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    ok('改生图模型写入当前会话 store.state.imageModel', store.state.imageModel === 'gemini-nano-banana-2.1', store.state.imageModel);
    imgSel.value = 'gpt-image-2'; imgSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    window.localStorage.setItem('dubhe-fontsize', 'small');
    applyFontSize();
    click($('#set-fontsize [data-v="large"]'));
    ok('字号按钮确实切换 html[data-fontsize] 并保存偏好', document.documentElement.dataset.fontsize === 'large'
      && window.localStorage.getItem('dubhe-fontsize') === 'large');
    $('#set-thinking').checked = false;
    $('#set-thinking').dispatchEvent(new window.Event('change', { bubbles: true }));
    ok('深度思考关闭时隐藏推理强度行', $('#set-reason-row').hidden === true);
    click($('#set-theme [data-v="dark"]'));
    ok('设置页主题写入共享主题偏好', document.documentElement.dataset.theme === 'dark'
      && window.localStorage.getItem('dubhe-theme') === 'dark');
  } finally {
    globalThis.fetch = oldFetch;
  }
}

// ─── 能力表仅在设置页提供；状态栏只呈现运行状态 ───
console.log('\n⑲ 设置页工具能力表（状态栏不提供弹层入口）');
{
  const { renderCapabilityTableHtml } = await import(path.join(ROOT, 'js/ui-capability.js'));
  const { DROP_REASON_LABEL } = await import(path.join(ROOT, 'js/executionContext.js'));
  const capLine = $('#cap-line');
  const pop = $('#tok-pop');
  const details = $('#set-capability-details');
  const tableBody = $('#set-capability-table-body');
  store.state.settings.thinking = false;
  store.state.relayOk = false;
  store.state.settings.webEnabled = true;
  store.state.settings.sandboxEnabled = true;
  store.state.model = 'gpt-5.6-sol';
  ui.syncWeb();
  const labels = $$('#cap-line .cap-pill');
  ok('状态栏由静态标签组成，不可点击打开能力表', labels.length >= 2 && labels.every((node) => node.tagName === 'SPAN') && !capLine.querySelector('button'));
  ok('状态栏不显示「已禁用」计数', !/已禁用|未启用/.test(capLine.textContent), capLine.textContent);
  ok('能力表入口位于设置页 details 中', !!details && !!tableBody && /查看当前工具能力表/.test(details.textContent));
  const drops = agent.previewToolTable().dropped;
  ok('设置页列出的裁剪项与 previewToolTable().dropped 一致', $$('#set-capability-table-body .cap-drop').map((node) => node.dataset.tool).join(',') === drops.map((item) => item.name).join(','));
  const row = $('#set-capability-table-body .cap-drop[data-tool="dispatch_subagent"]');
  ok('设置页列出 dispatch_subagent 与同源原因文案', !!row && row.querySelector('.cap-why').textContent === DROP_REASON_LABEL['capability-dispatch-off']);
  ok('中继离线时 fetch_url / crawl_site 的原因也在设置页中可查', ['fetch_url', 'crawl_site'].every((tool) => {
    const item = $(`#set-capability-table-body .cap-drop[data-tool="${tool}"]`);
    return item && /网页中继未通过健康检查/.test(item.textContent);
  }));
  const fixBtn = row && row.querySelector('.cap-fix[data-fix="reasoning-max"]');
  ok('可从设置页能力表直接切到 Max', !!fixBtn && fixBtn.textContent === '切到 Max');
  click(fixBtn);
  await new Promise((resolve) => setTimeout(resolve, 0));
  ok('切到 Max 后 dispatch_subagent 从设置页表格中移除', store.state.settings.thinking === true
    && store.state.settings.reasoningLevel === 'max'
    && !$('#set-capability-table-body .cap-drop[data-tool="dispatch_subagent"]'));
  ok('更新状态仍然不在对话状态栏暴露裁剪计数', !/已禁用|未启用/.test(capLine.textContent));
  details.open = true;
  ok('设置页能力表可在 details 内展开', details.open && tableBody.textContent.length > 0);
  const allOkay = renderCapabilityTableHtml({ allowed: ['a', 'b'], dropped: [], total: 2, tier: { displayTier: 'Max', canDispatch: true } });
  ok('纯函数渲染全可用状态和工具总数', /全部工具均可用/.test(allOkay) && /2 \/ 2/.test(allOkay) && /Max（可委派）/.test(allOkay));
  ok('旧能力弹层入口已不再从状态栏打开', pop.hidden === true && pop.dataset.kind !== 'cap');
  const refreshedLabel = $('#cap-line .cap-pill');
  ui.syncWeb();
  ok('能力状态未变化时复用相同标签节点', $('#cap-line .cap-pill') === refreshedLabel);
}

console.log('\n⑳ 设置页能力表随开关变化刷新，能力状态栏不再承载弹层锚点');
{
  const details = $('#set-capability-details');
  const body = $('#set-capability-table-body');
  const capLine = $('#cap-line');
  store.state.settings.thinking = false;
  store.state.relayOk = false;
  store.state.settings.webEnabled = true;
  store.state.settings.sandboxEnabled = true;
  store.state.model = 'gpt-5.6-sol';
  ui.syncWeb();
  ok('有门控项时设置页显示原因与直达开关', $$('#set-capability-table-body .cap-drop').length > 0
    && !!$('#set-capability-table-body .cap-fix'));
  ok('对话状态栏无按钮、无禁用/未启用文案', !capLine.querySelector('button') && !/已禁用|未启用/.test(capLine.textContent));
  ok('表格属于设置页 details，不属于 token 弹层', body.closest('#set-capability-details') === details && $('#tok-pop').dataset.kind !== 'cap');
  details.open = false;
  ok('能力表默认可收起', details.open === false);
}

console.log('\n㉑ P8 单点依赖：失败态点「联网」胶囊 = 重置探测缓存并立刻重探；网关 5xx 错误框带「切换节点并重试」按钮');
{
  const net = await import(path.join(ROOT, 'js/net.js'));
  const ep = await import(path.join(ROOT, 'js/endpoint.js'));
  const oldFetch = globalThis.fetch;
  const health = [];
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (url.includes('/api/health')) { health.push(url); return new Response(JSON.stringify({ ok: true, capabilities: ['fetch', 'search', 'crawl', 'file'] }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('nf', { status: 404 });
  };
  try {
    // 先造一个「已失败且在 TTL 内」的缓存：此时 relayAvailable() 不会主动探，只有 resetRelayProbe() 才能让它再探
    net.resetRelayProbe();
    net.__setRelayClockForTests(() => 5_000_000);
    const saveFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('down', { status: 500 });
    ok('前置：中继探测失败', (await net.relayAvailable()) === false);
    globalThis.fetch = saveFetch;
    ok('前置：TTL 内再调不会探测（缓存 false）', (await net.relayAvailable()) === false && health.length === 0);
    store.state.relayOk = false;
    ui.syncWeb();
    const pill = $('#web-toggle');
    ok('失败态胶囊提示里写明「立即重新探测」与 TTL 秒数', /立即重新探测/.test(pill.title) && /秒后下次网页工具调用会自动重探/.test(pill.title), pill.title);
    click(pill);
    await new Promise((r) => setTimeout(r, 60));
    ok('点击胶囊 → resetRelayProbe 生效（TTL 内仍然发起了 health 探测）', health.length >= 1, `health 调用 ${health.length} 次`);
    ok('探测成功后 store.relayOk=true、联网自动开启、胶囊点亮', store.state.relayOk === true && store.state.settings.webEnabled !== false && pill.classList.contains('on'));
    // 网关 5xx：错误框带切换按钮；点击后域名切换
    const before = ep.gatewayBase();
    const other = ep.otherGatewayBase().replace(/^https?:\/\//, '');
    store.state.messages.push({ id: 'err-5xx', role: 'assistant', text: '', error: 'HTTP 503: upstream unavailable', done: true, ts: Date.now() });
    ui.rebuildMessages();
    const btn = $('#messages .msg[data-id="err-5xx"] .err-action[data-switch-gateway]');
    ok('5xx 错误框出现「切换到另一节点并重试」按钮', !!btn && btn.textContent.includes(other), btn ? btn.textContent : '缺失');
    let regenerated = 0; const oldRegen = agent.regenerate; agent.regenerate = () => { regenerated++; };
    click(btn);
    agent.regenerate = oldRegen;
    ok('点击后网关域名切换并触发重试', ep.gatewayBase() !== before && regenerated === 1, `${before} → ${ep.gatewayBase()}，regenerate ${regenerated}`);
    ep.setGatewayBase(before, 'manual');
    store.state.messages.push({ id: 'err-400', role: 'assistant', text: '', error: 'HTTP 400: bad request', done: true, ts: Date.now() });
    ui.rebuildMessages();
    ok('400 之类非节点问题不给切换按钮', !$('#messages .msg[data-id="err-400"] .err-action'));
  } finally {
    globalThis.fetch = oldFetch; net.__setRelayClockForTests(null); net.resetRelayProbe();
  }
}


console.log('\n⑫ 沙箱文件预览增强（V1.9）：Office/音频/ZIP + 全屏 + [[file:]] 卡片');
// —— xlsx 工作簿：真实查看器路径（含异步 office-preview 模块加载）——
const toDataUrl = (bytes, mime) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const xlsxBytes = await createXlsxWorkbook({ sheets: [{ name: '销量', rows: [['产品', '数量'], ['苹果', 7], ['香蕉', 3]] }, { name: '备注', rows: [['说明'], ['好']] }] });
agent.fs.write('outputs/report.xlsx', toDataUrl(xlsxBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
store.state.files = agent.fs.export();
store.notify();
ui.renderFiles();
click($$('#file-list .ft-file').find((n) => rowPath(n) === 'outputs/report.xlsx'));
await new Promise((r) => setTimeout(r, 30));
ok('xlsx 在查看器内渲染出表格与工作表标签', !!$('#file-viewer .fv-office .fv-sheet-tab') && /苹果/.test($('#file-viewer .fv-office')?.innerHTML || ''), ($('#file-viewer .fv-office')?.innerHTML || '空').slice(0, 80));
ok('xlsx 默认停在第一张表', $('#file-viewer .fv-sheet-tab.active')?.textContent === '销量', $('#file-viewer .fv-sheet-tab.active')?.textContent);
const secondTab = $$('#file-viewer .fv-sheet-tab').find((t) => t.textContent === '备注');
click(secondTab);
ok('切换工作表标签只显示对应表', secondTab.classList.contains('active') && /好/.test($$('#file-viewer .fv-sheet-pane').find((p) => !p.hidden)?.textContent || ''), $$('#file-viewer .fv-sheet-pane').map((p) => p.hidden).join(','));
ok('Office 预览时头部「下载」按钮仍在（兜底另存）', !!$('#file-viewer #fv-dl svg') && /下载/.test($('#file-viewer #fv-dl').textContent));

// —— 全屏预览：按钮切换 + Esc 只退全屏，再 Esc 关查看器 ——
ok('查看器头部带全屏按钮（SVG + 无障碍名）', !!$('#file-viewer #fv-full svg') && /全屏/.test($('#file-viewer #fv-full').getAttribute('title') || ''), $('#file-viewer #fv-full')?.getAttribute('title'));
click($('#fv-full'));
ok('点击全屏后查看器进入全屏态', $('#file-viewer').classList.contains('fv-fullscreen') && /退出全屏/.test($('#fv-full')?.getAttribute('title') || ''));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
ok('Esc 退出全屏但不关查看器', !$('#file-viewer').classList.contains('fv-fullscreen') && $('#file-viewer').classList.contains('open'));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
ok('再 Esc 关闭查看器', !$('#file-viewer').classList.contains('open'));
click($$('#file-list .ft-file').find((n) => rowPath(n) === 'uploads/spec.md'));
click($('#fv-full'));
ok('文本文件同样可全屏', $('#file-viewer').classList.contains('fv-fullscreen'));
click($('#fv-full'));
click($('#fv-close'));

// —— 音频与 ZIP 清单 ——
agent.fs.write('outputs/song.mp3', 'data:audio/mpeg;base64,AAAA');
store.state.files = agent.fs.export();
store.notify();
ui.renderFiles();
click($$('#file-list .ft-file').find((n) => rowPath(n) === 'outputs/song.mp3'));
await new Promise((r) => setTimeout(r, 10));
ok('音频文件用 <audio> 播放器预览', !!$('#file-viewer .fv-audio audio[controls]'), $('#file-viewer .fv-body')?.innerHTML.slice(0, 60));
click($('#fv-close'));
agent.fs.write('outputs/bundle.zip', toDataUrl(await (await createZip([{ name: 'a.txt', bytes: new TextEncoder().encode('hi') }, { name: 'b/c.md', bytes: new TextEncoder().encode('# c') }])).arrayBuffer(), 'application/zip'));
store.state.files = agent.fs.export();
store.notify();
ui.renderFiles();
click($$('#file-list .ft-file').find((n) => rowPath(n) === 'outputs/bundle.zip'));
await new Promise((r) => setTimeout(r, 30));
ok('ZIP 在查看器内列出条目清单', /a\.txt/.test($('#file-viewer .fv-office')?.innerHTML || '') && /b\/c\.md/.test($('#file-viewer .fv-office')?.innerHTML || ''), ($('#file-viewer .fv-office')?.innerHTML || '空').slice(0, 80));
click($('#fv-close'));

// —— 用户已上滚时，重绘与流入的新消息不应强制拽回底部 ——
{
  const box = $('#messages');
  const oldClient = Object.getOwnPropertyDescriptor(box, 'clientHeight');
  const oldHeight = Object.getOwnPropertyDescriptor(box, 'scrollHeight');
  Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 240 });
  Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 1800 });
  box.scrollTop = 450;
  box.dispatchEvent(new window.Event('scroll'));
  ui.rebuildMessages();
  ok('重绘保留当前消息区阅读位置', box.scrollTop === 450, String(box.scrollTop));
  const incoming = store.pushMessage({ role: 'user', text: '测试：保留上滚位置', ts: Date.now() });
  ui.onUserMessage(incoming);
  ok('新消息到达时不把已上滚的读者弹回底部', box.scrollTop === 450, String(box.scrollTop));
  if (oldClient) Object.defineProperty(box, 'clientHeight', oldClient); else delete box.clientHeight;
  if (oldHeight) Object.defineProperty(box, 'scrollHeight', oldHeight); else delete box.scrollHeight;
  box.scrollTop = 0;
}

// —— [[file:]] 文件小卡片：自动展开沙箱、切到文件标签并打开查看器 ——
click($('[data-panel-tab="memory"]'));
store.state.messages.push({ id: 'fc-1', role: 'assistant', text: '交付 [[file:uploads/spec.md|规格书]] 请查收', done: true, ts: Date.now() });
ui.rebuildMessages();
const card = $('#messages .sb-file-card');
ok('消息内渲染文件小卡片（图标 + 显示名）', !!card && card.dataset.sbOpen === 'uploads/spec.md' && /规格书/.test(card.textContent), $('#messages .msg[data-id="fc-1"] .md')?.innerHTML.slice(0, 100));
ok('卡片补上文件元信息（类型 · 体积）', /md · \d/.test(card.querySelector('[data-sb-meta]')?.textContent || ''), card?.querySelector('[data-sb-meta]')?.textContent);
click(card);
ok('卡片自动展开沙箱并切回文件标签', !$('#sandbox-panel').classList.contains('collapsed') && $('[data-panel-tab="files"]').classList.contains('on') && !$('#tab-files').hidden);
ok('点击卡片打开沙箱文件查看器', $('#file-viewer').classList.contains('open') && /规格/.test($('#file-viewer').textContent || ''));
click($('#fv-close'));
store.state.messages.push({ id: 'fc-2', role: 'assistant', text: '缺文件 [[file:outputs/nope.bin]] 一个', done: true, ts: Date.now() });
ui.rebuildMessages();
const miss = $('#messages .msg[data-id="fc-2"] .sb-file-card');
ok('沙箱里没有的文件标 missing 并提示', miss.classList.contains('missing') && /沙箱中没有这个文件/.test(miss.textContent));
store.state.messages = store.state.messages.filter((m) => !m.id.startsWith('fc-'));
ui.rebuildMessages();

// 模型感知思维区：GPT 只渲染链式粗体摘要，非 GPT 在展开区保留完整原始文本。
store.state.messages.splice(0, store.state.messages.length);
store.state.messages.push(
  { id: 'reason-u', role: 'user', text: '展示本轮思考过程', ts: Date.now() },
  { id: 'reason-claude', role: 'assistant', model: 'claude-sonnet-5', reasoningLevel: 'high', reasoning: '<step>完整过程</step>\n逐字保留', text: 'Claude answer', done: true, thinkDone: true, ts: Date.now() },
  { id: 'reason-gpt', role: 'assistant', model: 'gpt-5.6-sol', reasoningLevel: 'high', reasoning: '**Plan****Check constraints**', text: 'GPT answer', done: true, thinkDone: true, ts: Date.now() },
);
ui.rebuildMessages();
const claudeReason = $('#messages [data-id="reason-claude"] .reasoning');
const gptReason = $('#messages [data-id="reason-gpt"] .reasoning');
ok('非 GPT 的完整思考按纯文本写入详情区（标签不作为 HTML 执行）', !!claudeReason
  && claudeReason.querySelector('.think-full-text')?.textContent === '<step>完整过程</step>\n逐字保留'
  && !claudeReason.querySelector('.think-summary-item') && !claudeReason.querySelector('.think-full-text b'));
ok('GPT 只显示**…**摘要项，不回显原始推理全文', !!gptReason && gptReason.querySelectorAll('.think-summary-item').length === 2
  && [...gptReason.querySelectorAll('.think-summary-item')].map((n) => n.textContent).join('|') === 'Plan|Check constraints'
  && !gptReason.querySelector('.think-full-text'));

console.log(failures ? `\n${failures} 项失败 ❌` : '\nDOM 冒烟测试全部通过 ✅');
process.exit(failures ? 1 : 0);
