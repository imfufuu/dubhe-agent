// Historical summaries are derived from CHANGELOG.md and the V1.5 git release entries.
// Only V1.4 and V1.8 carry the Stable designation.
export const RELEASE_HISTORY = [
  ['V1.7', 'Helix 3.0 · 执行治理与完整工作台', 'Helix 3.0 · governed execution and workbenches',
    ['统一能力登记、按需工具、风险授权、预算、审计、检查点与恢复。', '本地数据/图表/照片工作台、持久文件、多语言、按轮分享与本地 Chromium 调试。', '工具顺序展示、编辑差异、按需 Python 依赖、真实发送动画与按型号适配的思考分级。'],
    ['Unified capabilities, on-demand tools, scoped authorization, budgets, audit, checkpoints and recovery.', 'Data/chart/photo workbenches, persistent files, bilingual UI, turn-level sharing and local Chromium debugging.', 'Ordered tool output, editing diffs, on-demand Python packages, send animations and model-aware effort levels.']],
  ['V1.6', '渲染与工作流阶段整合', 'Rendering and workflow consolidation',
    ['整合 V1.5 系列验收构建，完善消息渲染、工具展示、文件工作区与会话边界。', '加强协议适配、长历史分页与文件安全。'],
    ['Consolidated the V1.5 acceptance builds across rendering, tool display, workspace and turn boundaries.', 'Improved protocol handling, long-history paging and file safety.']],
  ['V1.5', '中继、设置与启动可靠性', 'Relay, settings and startup reliability',
    ['加入 Cloudflare Worker 中继与自动探测，静态部署可按实际中继能力联网。', '完善设置页、密钥校验、思考强度、SVG 尺寸、加载诊断与工作流渲染。'],
    ['Added Cloudflare Worker relay discovery for supported web capabilities on static hosting.', 'Expanded settings, key validation, effort controls, SVG sizing, boot diagnostics and workflow rendering.']],
  ['V1.4 Stable', 'Helix 2.5 · 天枢融合架构', 'Helix 2.5 · integrated architecture',
    ['正交能力掩码、路由与工具表一致性，软归档/Purge 双通道及审计链。', '执行状态机、工具契约、风险预算、幂等、恢复与记忆生命周期治理；本地审核及离线资源缓存。'],
    ['Aligned routing, orthogonal capabilities and tool tables; soft archive/Purge paths and audit chains.', 'Execution state machine, contracts, risk/budget controls, idempotency, recovery and memory lifecycle; local moderation and offline assets.']],
  ['V1.3', '2026-09-27 · 审核与结构化呈现', '2026-09-27 · moderation and structured presentation',
    ['本地文本与图片审核、结构化图表和移动端体验完善。'], ['Local text/image moderation, structured charts and mobile refinements.']],
  ['V1.2', '2026-09-26 · 推理与长期记忆', '2026-09-26 · reasoning and long-term memory',
    ['沙箱图像、深度思考与委派、长期记忆及 Markdown 体验。'], ['Sandbox images, reasoning/delegation, long-term memory and Markdown.']],
  ['V1.1', '2026-09-26 · 导航与本地工作台', '2026-09-26 · navigation and local workspace',
    ['产品介绍页、任务示例、本地工作台与基础安全加固。'], ['Product landing page, task examples, local workspace and initial security hardening.']],
  ['V1.0', '2026-09-22 · 首版智能体', '2026-09-22 · initial agent release',
    ['模型选择、多会话、代码沙箱、文件工作区、生图/图像编辑、公式与联网能力。'], ['Model selection, conversations, code sandbox, files, image generation/editing, formulas and web tools.']],
  ['Pre-V1.0', '2026-09-19—21 · 早期原型', '2026-09-19—21 · early prototypes',
    ['建立基础对话流、静态资源版本化、会话持久化、文件树、联网中继与触屏布局。'], ['Established the conversation stream, versioned assets, persisted sessions, file tree, web relay and touch layout.']],
];
export function releaseNotes(language = 'zh') {
  const en = language === 'en';
  const cards = en ? [
    ['SKILLS', 'Discover skills, process files locally', 'Twelve on-demand guides; local DOCX/PPTX creation and PDF page/form operations. No legacy DOC conversion or Office rendering claims.'],
    ['AUDIO', 'Audio analysis, explicit model choice', 'The same three Gemini models and file-input format as video. Original audio is sent to the gateway; incomplete usage is disclosed.'],
    ['CACHE', 'Incremental, hash-verified updates', 'Pre-cache core scripts; load large dependencies only when needed. Reuse unchanged files and remove obsolete app caches after safe activation.'],
    ['NAVIGATION', 'Stay on the page', 'The brand returns to the homepage, not the retired gate. Language changes preserve the visible reading position.'],
    ['WORKSPACE', 'More room for your files', 'Wide iPads and desktops dock the panel without a backdrop. Opening a file expands the workspace; HTML/SVG offer Code, Preview and Split modes.'],
    ['MOTION', 'Smooth closing, consistent spacing', 'Tool/file folds and attachments animate in both directions. Grayscale status polish moves left to right; tool names and paths stay static. Reduced-motion preferences are respected.'],
    ['AGENT', 'Measured control, honest boundaries', 'Model-specific native effort with graded verification fallback, on-demand Python dependencies, editing diffs and replayable agent demonstrations.'],
    ['PREVIEW', 'Static preview, isolated by default', 'HTML/SVG preview disables scripts and external requests; local styles and images can be embedded. Interactive Chromium execution remains an explicit local-companion action.'],
  ] : [
    ['SKILLS', '按需探索，本地处理文档', '12 项双语扩展技能按需读取，支持本地 DOCX/PPTX 生成与 PDF 页面/表单操作；不冒充旧版 DOC 转换或 Office 保真渲染。'],
    ['AUDIO', '新增音频分析', '同视频的三个 Gemini 模型及 file 请求格式；原音频上传网关，独立选择模型，用量缺失时明确标注。'],
    ['CACHE', '按哈希增量缓存', '站内脚本预缓存，大依赖首次使用才加载。复用未变文件，新版本安全激活后清理本应用旧缓存。'],
    ['NAVIGATION', '留在当前页面', '品牌图标回主页顶部，不再进入废除门页；中英文切换保持可视位置。'],
    ['WORKSPACE', '文件工作区更宽敞', '宽屏 iPad 与电脑端停靠右侧面板，不再覆盖遮罩。打开文件后继续向左扩展；HTML/SVG 可切换代码、预览或并排查看。'],
    ['MOTION', '收放连贯，间距统一', '工具、读写详情与附件菜单都有双向动画。黑白抛光从左向右扫过状态文案，工具名与路径保持静态；尊重减少动效设置。'],
    ['AGENT', '模型适配与可靠执行', '按型号映射原生思考档位并保留分级验证降级；Python 按需加载依赖，编辑仅显示差异，导航演示可重播。'],
    ['PREVIEW', '静态预览默认隔离', 'HTML/SVG 预览禁用脚本与外网，支持嵌入本地样式和图片；需要交互运行时，仍通过明确的本地 Chromium 操作。'],
  ];
  return `<h2>${en ? 'Changelog' : '更新日志'}</h2><p class="h-sub">${en ? 'Current release and every historical stage. Only V1.8 and V1.4 are designated Stable.' : '当前版本与完整历史阶段。仅 V1.8 与 V1.4 标记为 Stable。'}</p>`
    + `<div class="release-overview"><div><span class="release-label">CURRENT RELEASE · 2026-10-14</span><h3>V1.8 Stable</h3><p>${en ? 'A larger workspace, smoother motion and model-aware execution.' : '更大的工作区、更顺滑的交互与按模型适配的执行体验。'}</p></div><a href="./build.json">${en ? 'Deployment manifest ↗' : '部署清单 ↗'}</a></div>`
    + `<div class="change-grid">${cards.map(([tag,title,body]) => `<article><span>${tag}</span><h3>${title}</h3><p>${body}</p></article>`).join('')}</div>`
    + `<div class="archive-heading"><h3>${en ? 'Release history' : '历史版本摘要'}</h3><p>${en ? 'From the early prototypes through V1.7, without retroactive Stable labels.' : '从早期原型到 V1.7，按阶段完整归档，不追加稳定版称号。'}</p></div>`
    + RELEASE_HISTORY.map(([version,zh,enTitle,zhLines,enLines]) => `<details class="release-archive"><summary><span>${version}</span><b>${en ? enTitle : zh}</b><small>${en ? 'Summary' : '展开摘要'}</small></summary><ul>${(en ? enLines : zhLines).map(line=>`<li>${line}</li>`).join('')}</ul></details>`).join('')
    + `<div class="note">${en ? 'Results and skipped checks are reported by CI. WebKit emulation is not a physical iPad test. Native effort and soft guidance do not guarantee a fixed reasoning-token count.' : '测试执行与跳过以 CI 日志为准。WebKit 模拟不等于具体 iPad 真机实测；原生努力档位与软引导均不保证固定推理 token 数。'}</div>`;
}
