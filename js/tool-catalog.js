// Compact tool catalog: one short human-readable line per capability. Full JSON
// schemas stay out of the prompt until a tool is selected or explicitly read.
export const TOOL_SUMMARIES = Object.freeze({
  browser_sandbox: ['在本地 Chromium 中启动并检查 Agent 项目页面。', 'Start and inspect Agent project pages in local Chromium.'],
  skill_library: ['搜索并读取按需加载的操作指南，不执行文档内容。', 'Search and read one on-demand workflow guide; does not execute it.'],
  document_tool: ['本地检查或生成 DOCX/PPTX，并检查、编辑 PDF。', 'Inspect or create DOCX/PPTX and inspect or edit PDFs locally.'],
  xlsx_tool: ['本地检查或生成 XLSX 工作簿；不运行公式或外部链接。', 'Inspect or create XLSX workbooks locally; formulas and links are not run.'],
  tool_library: ['搜索工具目录并读取单个完整 Schema，读取后自动挂载工作流组。', 'Search the tool catalog and read one full schema; reading mounts its workflow group.'],
  knowledge_search: ['按关键词检索内置项目知识库中的必要片段。', 'Search the bundled project knowledge base for relevant excerpts.'],
  execute_javascript: ['在受限浏览器 Worker 中运行 JavaScript 并访问沙箱文件。', 'Run JavaScript in a bounded browser Worker with sandbox-file access.'],
  execute_python: ['在受限浏览器 Worker 中运行 Python 代码。', 'Run Python code in a bounded browser Worker.'],
  execute_cpp: ['在浏览器本地 WASM Worker 中编译并运行 C/C++；不向远程编译器发送源码。', 'Compile and run C/C++ locally in a browser WASM Worker; source is not sent to a remote compiler.'],
  write_file: ['在允许的沙箱路径中创建或编辑文本文件。', 'Create or edit text files in allowed sandbox paths.'],
  read_file: ['读取沙箱文件内容或查看二进制文件信息。', 'Read sandbox file contents or inspect binary-file metadata.'],
  list_files: ['列出沙箱文件及其大小。', 'List sandbox files and their sizes.'],
  get_current_time: ['读取指定时区的当前日期和时间。', 'Get the current date and time in a selected timezone.'],
  get_browser_environment: ['读取粗略浏览器环境信息，不读取 Cookie 或定位。', 'Read coarse browser details without cookies or precise location.'],
  generate_image: ['按提示生成图片并保存到沙箱。', 'Generate an image from a prompt and save it in the sandbox.'],
  analyze_image: ['使用用户选择的视觉模型分析本地图片。', 'Analyze a local image with the user-selected vision model.'],
  analyze_svg: ['安全检查 SVG，提取文字或进行视觉分析。', 'Safely inspect SVG text or request a visual analysis.'],
  analyze_video: ['分析本地视频画面、字幕与语音。', 'Analyze local video frames, captions, and speech.'],
  analyze_audio: ['将本地音频转写或分析。', 'Transcribe or analyze local audio.'],
  analyze_pdf: ['提取 PDF 文本并按需进行页面视觉分析。', 'Extract PDF text and optionally analyze selected pages visually.'],
  zip_files: ['将沙箱文件打包为 ZIP。', 'Package sandbox files into a ZIP archive.'],
  unzip_file: ['安全解压 ZIP 到沙箱目录。', 'Safely extract a ZIP archive into the sandbox.'],
  convert_file: ['在支持范围内转换或压缩图片、音频和视频。', 'Convert or compress supported image, audio, and video files.'],
  patch_apply: ['把 unified diff 严格应用到沙箱文件；任一上下文不匹配则整体拒绝。', 'Apply a unified diff to a sandbox file; any context mismatch rejects the whole patch.'],
  dom_inspect: ['静态检查沙箱 HTML 的结构与可访问性问题（不启动浏览器）。', 'Statically inspect sandbox HTML for structure and accessibility issues (no browser).'],
  chart_render: ['把 CSV 的标签列与数值列渲染为 SVG 柱状图或折线图。', 'Render a CSV label/value pair as an SVG bar or line chart.'],
  search_web: ['通过可用网页中继搜索实时网页资料。', 'Search current web sources through an available relay.'],
  crawl_site: ['抓取同源站点的多页内容。', 'Crawl multiple pages from one same-origin site.'],
  fetch_url: ['读取单个网页并返回正文。', 'Fetch one web page and return its content.'],
  download_file: ['通过安全中继将远程文件下载到沙箱。', 'Download a remote file into the sandbox through the safe relay.'],
  pull_github_project: ['导入公开 GitHub 仓库源码快照到沙箱。', 'Import a public GitHub repository snapshot into the sandbox.'],
  run_git: ['检查并操作沙箱项目的本地 Git 仓库。', 'Inspect and operate a local Git repository in the sandbox.'],
  search_files: ['在沙箱文件中按关键词搜索。', 'Search sandbox files for matching text.'],
  diff_text: ['逐行比较两段文本或两个文件。', 'Compare two text blocks or files line by line.'],
  json_tool: ['解析、校验、格式化或查询 JSON 数据。', 'Parse, validate, format, or query JSON data.'],
  delete_file: ['删除允许路径内的沙箱文件，保留用户原件。', 'Delete sandbox files in allowed paths while preserving user originals.'],
  copy_file: ['在沙箱允许路径间复制文件。', 'Copy files between allowed sandbox paths.'],
  remember: ['保存、检索或忘记经用户请求的长期偏好。', 'Save, retrieve, or forget long-term preferences when requested.'],
  evaluate_expression: ['安全计算数学表达式、单位和统计量。', 'Safely evaluate mathematical expressions, units, and statistics.'],
  text_tool: ['执行正则、哈希、编码与常见文本转换。', 'Run regex, hashing, encoding, and common text transformations.'],
  data_tool: ['处理 CSV/TSV、日期、单位、二维码等结构化数据。', 'Process CSV/TSV, dates, units, QR codes, and structured data.'],
  execute_sql: ['查询或修改沙箱中的 SQLite 数据库。', 'Query or modify a SQLite database in the sandbox.'],
  render_mermaid: ['把 Mermaid 图表语法渲染为可下载 SVG。', 'Render Mermaid diagrams as downloadable SVG.'],
  render_dot: ['把 Graphviz DOT 图语法渲染为可下载 SVG。', 'Render Graphviz DOT diagrams as downloadable SVG.'],
  dispatch_subagent: ['并行委派独立子任务并汇总专家报告。', 'Delegate independent subtasks in parallel and combine specialist reports.'],
});

const TOOL_KEYWORDS = Object.freeze({
  browser_sandbox: '浏览器 页面 网站 截图 chromium preview debug',
  skill_library: '技能 指南 skill guide workflow 文档音频',
  document_tool: 'word docx pptx pdf 文档 合同 简历 演示 幻灯片',
  xlsx_tool: 'xlsx excel spreadsheet workbook 电子表格 工作簿 表格',
  tool_library: '工具 schema catalog directory search read 挂载',
  knowledge_search: '知识库 项目 语法 知识 knowledge',
  execute_javascript: 'javascript js 代码 沙箱 worker',
  execute_python: 'python 代码 沙箱 worker',
  execute_cpp: 'cpp c++ 编译 compiler',
  write_file: '写入 创建 编辑 文件 file write',
  read_file: '读取 查看 文件 read',
  list_files: '列出 文件 目录 list',
  get_current_time: '时间 日期 时区 time date',
  get_browser_environment: '浏览器 环境 user agent timezone',
  generate_image: '生图 图片 生成 image draw',
  analyze_image: '识图 图片 图像 image vision',
  analyze_svg: 'svg 矢量图 图标',
  analyze_video: '视频 video 影片',
  analyze_audio: '音频 audio 转录 录音',
  analyze_pdf: 'pdf 论文 扫描件 OCR',
  zip_files: '压缩 打包 zip archive',
  unzip_file: '解压 unzip zip extract',
  convert_file: '转换 转码 压缩 ffmpeg image audio video',
  patch_apply: '补丁 patch diff apply 应用 unified',
  dom_inspect: '检查 html 结构 可访问性 a11y lint alt 标题 lang',
  chart_render: '图表 柱状图 折线图 chart bar line svg csv',
  search_web: '网页搜索 网络 search web',
  crawl_site: '网站 爬取 抓取 crawl sitemap',
  fetch_url: '网页 url fetch',
  download_file: '下载 文件 download remote',
  pull_github_project: 'github 仓库 项目 导入 repository',
  run_git: 'git 仓库 提交 分支 commit',
  search_files: '文件 搜索 查找 grep',
  diff_text: '比较 差异 diff compare',
  json_tool: 'json yaml toml 配置 parse',
  delete_file: '删除 文件 remove delete',
  copy_file: '复制 文件 copy',
  remember: '记住 偏好 记忆 remember forget',
  evaluate_expression: '计算 数学 单位 日期 expression math',
  text_tool: '文本 regex hash base64 编码 解码',
  data_tool: 'csv tsv 数据 表格 日期 单位 二维码',
  execute_sql: 'sql sqlite 数据库 database',
  render_mermaid: 'mermaid 流程图 时序图 架构图',
  render_dot: 'graphviz dot 依赖图',
  dispatch_subagent: '委派 专家 子任务 subagent delegate',
});

export function toolSummary(name, language = 'zh') {
  const entry = TOOL_SUMMARIES[String(name || '')];
  if (!entry) return language === 'en' ? 'On-demand capability; read its schema before use.' : '按需能力；使用前读取其 Schema。';
  return entry[language === 'en' ? 1 : 0];
}

export function formatToolDirectory(tools, { language = 'zh', max = 48 } = {}) {
  const list = Array.isArray(tools) ? tools : [];
  const entries = list.map((tool) => {
    const name = typeof tool === 'string' ? tool : tool?.name;
    return name ? `- ${name}: ${toolSummary(name, language)}` : '';
  }).filter(Boolean);
  if (!entries.length) return '';
  const shown = entries.slice(0, max);
  if (entries.length > max) shown.push(language === 'en' ? `- …and ${entries.length - max} more; use tool_library search.` : `- …另有 ${entries.length - max} 项；用 tool_library 搜索。`);
  return `${language === 'en' ? 'Tool directory (compact descriptions only; schemas are not preloaded):' : '工具目录（仅简短说明，不预装完整 Schema）：'}\n${shown.join('\n')}`;
}

export function searchToolDirectory(tools, query = '', { language = 'zh', max = 10 } = {}) {
  const list = Array.isArray(tools) ? tools : [];
  const q = String(query || '').trim().slice(0, 300).toLowerCase();
  const tokens = [];
  for (const segment of q.match(/[a-z0-9_]+|[\u3400-\u9fff]+/gu) || []) {
    if (/^[a-z0-9_]+$/.test(segment) || segment.length < 3) tokens.push(segment);
    else {
      tokens.push(segment);
      for (let i = 0; i < segment.length - 1; i++) tokens.push(segment.slice(i, i + 2));
    }
  }
  const ranked = list.map((tool) => {
    const name = String(tool?.name || '');
    const summary = toolSummary(name, language);
    const haystack = `${name} ${summary} ${TOOL_KEYWORDS[name] || ''}`.toLowerCase();
    let score = 0;
    if (q && name.toLowerCase() === q) score += 100;
    if (q && haystack.includes(q)) score += 20;
    for (const token of tokens) if (haystack.includes(token)) score += 1;
    return { name, description: summary, score, _tool: tool };
  }).filter((item) => !q || item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return ranked.slice(0, max).map(({ name, description }) => ({ name, description }));
}

export function formatToolDefinitionRead(tool) {
  const payload = { name: tool.name, description: tool.description, parameters: tool.parameters };
  return `[Tool definition loaded: ${tool.name}]\n${JSON.stringify(payload, null, 2)}\n[/Tool definition loaded]`;
}

export function toolDefinitionFromResult(text) {
  const match = /^\[Tool definition loaded: ([a-z][a-z0-9_]{1,63})\]/.exec(String(text || ''));
  return match ? { name: match[1] } : null;
}
