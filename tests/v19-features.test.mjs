// V1.9 增量回归：DeepSeek/第一方直连 CSP、网关切换不弹 Key 框、文件面板按钮行为、
// Office/音频/ZIP 沙箱预览、[[file:]] 文件卡片、查看器全屏、链接预览元数据、音视频模型合并。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createZip } from '../js/zip.js';
import { createXlsxWorkbook } from '../js/xlsx.js';
import { xlsxPreviewHtml, docxPreviewHtml, pptxPreviewHtml, zipListHtml } from '../js/office-preview.js';
import { renderMarkdown, hydrateSandboxMedia } from '../js/ui-markdown.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const enc = (s) => new TextEncoder().encode(s);

test('直连修复：app.html CSP connect-src 放行全部第一方网关域名（DeepSeek 直连不再被页面 CSP 拦截）', () => {
  const app = read('../app.html');
  const csp = /connect-src[^;"]*/.exec(app)?.[0] || '';
  for (const host of [
    'https://api.deepseek.com', 'https://api.anthropic.com', 'https://api.openai.com',
    'https://generativelanguage.googleapis.com', 'https://open.bigmodel.cn', 'https://api.x.ai',
    'https://api.moonshot.ai', 'https://ark.cn-beijing.volces.com', 'https://dashscope.aliyuncs.com',
  ]) assert.ok(csp.includes(host), `CSP connect-src 缺少 ${host}`);
  assert.ok(csp.includes('https://api.teamorouter.com') && csp.includes('https://api.teamorouter.cn'), 'TeamoRouter 双域名保留');
  const api = read('../js/api.js');
  assert.match(api, /页面 CSP 未放行该域名/, '直连失败提示点名 CSP，排障不再只写 CORS');
});

test('网关切换不弹出 API Key 输入框；真正需要时才提示', () => {
  const main = read('../js/main.js');
  assert.doesNotMatch(main, /onGatewayChanged[\s\S]{0,400}openKeyModal\(\)/, '切换网关后不得自动弹出 Key 输入界面');
  assert.match(main, /onNeedKey: \(\) => \{ window\.openKeyModal && window\.openKeyModal\(\);/, '发送消息缺 Key 时仍会提示');
});

test('文件面板：目录行无复制/下载按钮；最外层目录显示总数与体积；复制按钮悬浮才显示且靠右', () => {
  const panel = read('../js/ui-files-panel.js');
  const css = read('../css/styles.css');
  assert.doesNotMatch(panel, /ft-zip/, '目录行不再挂打包/下载按钮');
  assert.doesNotMatch(panel, /复制文件夹名/, '目录行不再有复制文件夹名按钮');
  assert.match(panel, /const meta = r\.depth === 0\s*\n\s*\? `\$\{countLabel\} · \$\{fmtSize\(Number\(r\.size\) \|\| 0\)\}`/, '最外层目录显示文件总数目和体积');
  assert.match(panel, /下载在左、复制靠右[\s\S]{0,400}file-dl[\s\S]{0,200}ft-copy/, '文件行按钮顺序：下载在左、复制靠右');
  assert.match(css, /\.ft-row:hover \.files-icon-btn, \.ft-row:focus-within \.files-icon-btn \{ opacity: 1; \}/, '按钮仅悬浮/聚焦显示');
  assert.doesNotMatch(css, /\.ft-row\.ft-dir \.files-icon-btn, \.ft-row\.ft-file \.ft-copy \{ opacity: 1; \}/, '不得有常显规则');
});

test('Office 预览：XLSX 多表表格 / DOCX 标题段落列表表格 / PPTX 按页 / ZIP 清单', async () => {
  const wb = await createXlsxWorkbook({ sheets: [
    { name: '销量', rows: [['产品', '数量'], ['苹果', 5], ['香蕉', 12]] },
    { name: '备注', rows: [['说明'], ['好吃']] },
  ] });
  const xh = await xlsxPreviewHtml(wb);
  assert.match(xh, /fv-sheet-tabs/);
  assert.ok(xh.includes('苹果') && xh.includes('销量') && xh.includes('香蕉'));
  const zh = await zipListHtml(wb);
  assert.match(zh, /xl\/workbook\.xml/);

  const docXml = `<w:document xmlns:w='w'><w:body>
    <w:p><w:pPr><w:pStyle w:val='Heading1'/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p>
    <w:p><w:r><w:t>正文 &amp; A</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:numId w:val='1'/></w:numPr></w:pPr><w:r><w:t>要点</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>单元</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
  const docx = createZip([{ name: '[Content_Types].xml', bytes: enc('<Types/>') }, { name: 'word/document.xml', bytes: enc(docXml) }]);
  const dh = await docxPreviewHtml(new Uint8Array(await docx.arrayBuffer()));
  assert.ok(dh.includes('fv-docx-h') && dh.includes('第一章'), '标题识别');
  assert.ok(dh.includes('正文 &amp; A') && !dh.includes('&amp;amp;'), '实体反转义，不双重转义');
  assert.ok(dh.includes('要点') && dh.includes('fv-docx-list'), '列表识别');
  assert.ok(dh.includes('<td>单元</td>'), '表格按表格渲染');

  const slide = (t) => `<p:sld xmlns:p='p' xmlns:a='a'><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`;
  const pptx = createZip([
    { name: '[Content_Types].xml', bytes: enc('<Types/>') },
    { name: 'ppt/presentation.xml', bytes: enc('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>') },
    { name: 'ppt/_rels/presentation.xml.rels', bytes: enc('<Relationships><Relationship Id="rId2" Target="slides/slide2.xml"/><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>') },
    { name: 'ppt/slides/slide1.xml', bytes: enc(slide('第一页标题')) },
    { name: 'ppt/slides/slide2.xml', bytes: enc(slide('第二页内容')) },
  ]);
  const ph = await pptxPreviewHtml(new Uint8Array(await pptx.arrayBuffer()));
  assert.ok(ph.indexOf('第一页标题') < ph.indexOf('第二页内容'), '跟随 presentation.xml 顺序');
  assert.match(ph, /fv-slide/);

  // 非法输入给说明而不是抛出
  for (const fn of [xlsxPreviewHtml, docxPreviewHtml, pptxPreviewHtml, zipListHtml]) {
    assert.ok((await fn(new Uint8Array([1, 2, 3]))).includes('fv-office-note'));
  }
});

test('更多常见文件预览：音频播放器、旧版 Office 提示、查看器路由与16MB 上限', () => {
  const panel = read('../js/ui-files-panel.js');
  assert.match(panel, /<div class="fv-audio"><audio controls preload="metadata"/, '音频文件用 <audio> 预览');
  assert.ok(panel.includes(String.raw`/\.(mp3|wav|m4a|aac|ogg|oga|flac|weba)$/i.test(lower)`), '音频后缀路由');
  assert.match(panel, /isLegacyOffice/, '旧版 .doc/.ppt/.xls 给另存为提示');
  assert.match(panel, /officeKind && byteLen <= FV_OFFICE_MAX/, 'Office 预览有体积上限');
  assert.match(panel, /data-office="\$\{officeKind\}"/);
  assert.match(panel, /await import\('\.\/office-preview\.js\?v=2026\.10\.11\.1'\)/, 'office-preview 按需加载');
});

test('[[file:路径]] 文件小卡片：渲染可点卡片、非法路径保持原文、点击打开查看器、分享文档转下载', async () => {
  const html = renderMarkdown('交付 [[file:outputs/report.xlsx|月度报表]] 请查收');
  assert.ok(html.includes('sb-file-card') && html.includes('data-sb-open="outputs/report.xlsx"') && html.includes('月度报表'));
  const unsafe = renderMarkdown('x [[file:../etc/passwd]] y');
  assert.ok(!unsafe.includes('sb-file-card') && unsafe.includes('[[file:'), '非法路径不生成卡片');
  const inCode = renderMarkdown('`[[file:a.txt]]`');
  assert.ok(!inCode.includes('sb-file-card'), '行内代码里的字面量不生成卡片');
  const multi = renderMarkdown('[[file:uploads/a.png]] 和 [[file:uploads/b.pdf]]');
  assert.equal((multi.match(/class="sb-file-card"/g) || []).length, 2, '同段多张卡片');

  // 水合：补体积 / 缺失标记（jsdom 环境由测试 runner 提供 document 时跳过，纯函数结果已覆盖）
  if (typeof document !== 'undefined') {
    const root = document.createElement('div');
    root.innerHTML = html;
    hydrateSandboxMedia(root, { read: (p) => (p === 'outputs/report.xlsx' ? 'data:application/octet-stream;base64,AAAABBBBCCCC' : '') });
    assert.ok(root.querySelector('[data-sb-meta]').textContent.includes('xlsx'));
    assert.ok(!root.querySelector('.sb-file-card').classList.contains('missing'));
  }
  const ui = read('../js/ui.js');
  assert.match(ui, /const sbOpen = e\.target\.closest\('\[data-sb-open\]'\);/, '点击卡片打开 openFileViewer');
  assert.match(ui, /openFileViewer\(path\)/);
  const share = read('../js/share-document.js');
  assert.match(share, /\.sb-file-card\[data-sb-open\]/, '导出分享文档时卡片转为下载链接');
  const prompt = read('../js/prompt-core.js');
  assert.match(prompt, /\[\[file:relative\/path\]\]/);
  assert.match(prompt, /\[\[file:相对路径\]\]/);
});

test('全屏预览：所有沙箱文件可用；按钮可切换；Esc 退出；CSS 全屏不依赖 Fullscreen API', () => {
  const panel = read('../js/ui-files-panel.js');
  const css = read('../css/styles.css');
  assert.match(panel, /id="fv-full"/);
  assert.match(panel, /viewer\.classList\.toggle\('fv-fullscreen'\)/);
  assert.match(panel, /viewer\.classList\.remove\('fv-fullscreen'\)/);
  assert.match(css, /\.file-viewer\.fv-fullscreen \{[^}]*position: fixed; inset: 0;/);
});

test('聊天平台链接预览：og/twitter 标题简介图标齐全（三页）', () => {
  for (const [file, url] of [['../index.html', ''], ['../app.html', 'app.html'], ['../docs.html', 'docs.html']]) {
    const html = read(file);
    assert.match(html, /<meta property="og:title"/, file);
    assert.match(html, /<meta property="og:description"/, file);
    assert.match(html, /<meta property="og:image" content="https:\/\/imfufuu\.github\.io\/dubhe-agent\/assets\/app-icon-512\.png"/, file);
    assert.match(html, /<meta name="twitter:card" content="summary"/, file);
    assert.ok(html.includes(`https://imfufuu.github.io/dubhe-agent/${url}`), `${file} canonical/og:url`);
  }
});

test('音视频解析模型设置合并：单下拉、videoModel/audioModel 同档、旧快照收敛', () => {
  const app = read('../app.html');
  const settings = read('../js/settings.js');
  const state = read('../js/state.js');
  assert.match(app, /<div class="set-title">音视频解析模型<\/div>/);
  assert.doesNotMatch(app, /id="set-video-model"|id="set-audio-model"/);
  assert.match(settings, /store\.state\.settings\.videoModel = id;\s*store\.state\.settings\.audioModel = id;/);
  assert.match(state, /state\.settings\.audioModel = state\.settings\.videoModel \|\| 'gemini-3\.5-flash-lite';/);
});
