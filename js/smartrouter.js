// ─── 智能路由器：根据任务类型和难度自动选择最合适的模型 ─────────────────
// 用户可见服务提供商，但不暴露具体模型 ID（满足用户隐私/抽象需求）。
// 路由策略为本地启发式（0ms 决策），不需要额外网络请求。

import { SMART_ROUTER_ID } from './config.js?v=2026.10.11.1';

// 路由类别
const TASK_CATEGORY = {
  CODING: 'coding',
  MATH: 'math',
  WRITING: 'writing',
  ANALYSIS: 'analysis',
  CHAT: 'chat',
  SEARCH: 'search',
  IMAGE: 'image',
};

// 难度
const DIFFICULTY = { EASY: 'easy', MEDIUM: 'medium', HARD: 'hard' };

// 模型路由表：按 provider 选，不暴露具体模型 ID 给用户
// 实际 ID 在最后选定时解析，此处只是策略。
// 选模原则（简化启发式）：
//   - 代码任务（含多文件/调试/沙箱执行）→ Anthropic Claude 系（Sonnet / Opus 视难度）
//   - 数学/推理/复杂分析 → OpenAI GPT 或 DeepSeek（高难度用 Sol/Opus 级别）
//   - 多语言闲聊/快速问答 → 低价档（deepseek-v4-flash、gemini-flash、glm-flash）
//   - 生图 / 识图 相关 → 不改变生图模型，对话仍选普通模型
//   - 简单问题 → 低价快速模型

// 可用模型（从常用模型中选）——与 FALLBACK_MODELS 保持一致
function classifyTask(text) {
  const s = String(text || '').toLowerCase();
  const codeHints = /(?:代码|编程|写\s*(?:个|一)?\s*(?:函数|程序|脚本)|bug|调试|debug|implement|function|class\s+\w+|def\s+\w+|import\s+|const\s+\w+\s*=|python|javascript|typescript|rust|golang|c\+\+|java|html|css|react|vue|node\.js|沙箱|执行|写文件|代码|正则|regex|算法|algorithm|sql|数据库|api)/;
  const mathHints = /(?:数学|证明|计算|推导|公式|方程|积分|微分|求导|概率|统计|微积分|线性代数|几何|物理|化学|latex|katex|\$\$|\\frac|\\sum|\\int|proof|theorem|calculate|compute|math|equation|formula)/;
  const writingHints = /(?:写\s*(?:一)?(?:篇|段|个)?\s*(?:文章|作文|文案|邮件|信|报告|总结|摘要|故事|小说|诗|博客)|translate|翻译|润色|改写|写作|创作|文案|策划|邮件|信函|总结|汇报)/;
  const analysisHints = /(?:分析|解释|对比|比较|评价|评估|为什么|怎么|如何|原因|优缺点|优劣|review|分析|解读|评价|评论)/;
  const imageHints = /(?:生图|画图|图片|图像|生成图片|draw|generate.*image|画一?张|海报|插画)/;

  if (imageHints.test(s)) return { category: TASK_CATEGORY.IMAGE, difficulty: DIFFICULTY.MEDIUM };
  if (codeHints.test(s)) {
    // 代码难度判断：多文件/架构/复杂算法 → hard；简单片段/解释 → easy
    const hard = /(?:架构|设计|重构|优化|性能|并发|多线程|分布式|系统|项目|多个文件|全套|完整|全量|重构|refactor|architect|design pattern|scalable|concurrent|distributed|performance)/.test(s)
      || s.length > 800;
    const easy = /(?:解释|什么是|怎么用|简单|小|一行|帮我看|报错|error.*:)/.test(s) && s.length < 300;
    return { category: TASK_CATEGORY.CODING, difficulty: hard ? DIFFICULTY.HARD : (easy ? DIFFICULTY.EASY : DIFFICULTY.MEDIUM) };
  }
  if (mathHints.test(s)) {
    const hard = /(?:证明|复杂|高等|大学|竞赛|奥林匹克|研究生|推导|积分|微分方程|线性代数|prove|theorem|complicated)/.test(s)
      || s.length > 600;
    return { category: TASK_CATEGORY.MATH, difficulty: hard ? DIFFICULTY.HARD : DIFFICULTY.MEDIUM };
  }
  if (writingHints.test(s)) {
    return { category: TASK_CATEGORY.WRITING, difficulty: s.length > 500 ? DIFFICULTY.MEDIUM : DIFFICULTY.EASY };
  }
  if (analysisHints.test(s)) {
    return { category: TASK_CATEGORY.ANALYSIS, difficulty: s.length > 400 ? DIFFICULTY.MEDIUM : DIFFICULTY.EASY };
  }
  return { category: TASK_CATEGORY.CHAT, difficulty: DIFFICULTY.EASY };
}

// 实际映射：(category, difficulty) → 真实模型 ID
// 路由表（2026-10-12 核对公开发布信息；方案版本号经核实后修正）
// 各系列当前最新：Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5（10-07）/ Fable 5.1；
// GPT-6 Astra（09-03，当前旗舰）、GPT-6 Sol / Luna（09-22）；Gemini 3.8 Flash（09-02，GA 最新）；
// DeepSeek V4.1-Flash（API 名 deepseek-flash，09-10）、V4-Pro-0813；Kimi K3（07-16）；GLM-5.3（08-14）。
// 未核实：grok-4.6、gpt-6.1-sol（公开来源中查不到，只留作候选，网关列表里有才会被选中）。
// 候选按顺序尝试，网关模型列表里没有的直接跳过。
const ROUTE_TABLE = {
  [TASK_CATEGORY.CODING]: {
    [DIFFICULTY.HARD]: ['claude-opus-5-5', 'gpt-6-astra', 'deepseek-v4-pro', 'glm-5.3', 'deepseek-flash'],
    [DIFFICULTY.MEDIUM]: ['claude-sonnet-5-5', 'deepseek-v4-pro', 'gpt-6-sol', 'glm-5.3'],
    [DIFFICULTY.EASY]: ['deepseek-flash', 'gemini-3.8-flash', 'glm-5.3-flash', 'claude-haiku-5-5'],
  },
  [TASK_CATEGORY.MATH]: {
    [DIFFICULTY.HARD]: ['gpt-6-astra', 'deepseek-v4-pro', 'claude-opus-5-5', 'gpt-6-sol'],
    [DIFFICULTY.MEDIUM]: ['gpt-6-sol', 'deepseek-flash', 'claude-sonnet-5-5', 'gemini-3.8-flash'],
    [DIFFICULTY.EASY]: ['gpt-6-sol', 'deepseek-flash', 'claude-sonnet-5-5', 'gemini-3.8-flash'],
  },
  [TASK_CATEGORY.WRITING]: {
    [DIFFICULTY.MEDIUM]: ['claude-fable-5-1', 'gpt-6-luna', 'claude-sonnet-5-5', 'gemini-3.8-flash'],
    [DIFFICULTY.EASY]: ['deepseek-flash', 'gemini-3.8-flash', 'glm-5.3-flash', 'gpt-6-luna'],
  },
  [TASK_CATEGORY.ANALYSIS]: {
    [DIFFICULTY.MEDIUM]: ['claude-sonnet-5-5', 'gpt-6-sol', 'deepseek-v4-pro', 'gemini-3.8-flash'],
    [DIFFICULTY.EASY]: ['deepseek-flash', 'gemini-3.8-flash', 'gpt-6-luna', 'glm-5.3-flash'],
  },
  [TASK_CATEGORY.IMAGE]: {
    [DIFFICULTY.MEDIUM]: ['gemini-3.8-flash', 'gpt-6-astra', 'claude-sonnet-5-5'],
  },
  [TASK_CATEGORY.CHAT]: {
    [DIFFICULTY.EASY]: ['claude-haiku-5-5', 'gemini-3.8-flash', 'gpt-5.4-mini', 'deepseek-flash'],
  },
};
// 跨类兜底：某类候选全部不在网关列表里时，按这个顺序找第一个可用模型
const ROUTE_FALLBACK = ['claude-sonnet-5-5', 'gpt-6-sol', 'gemini-3.8-flash', 'deepseek-flash', 'glm-5.3', 'claude-haiku-5-5', 'gpt-5.6-sol'];

function pickRealModel(category, difficulty, availableModels) {
  const ids = (availableModels || []).map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
  const available = new Set(ids);
  const pick = (candidates) => (candidates || []).find((id) => available.has(id)) || null;
  const own = ROUTE_TABLE[category] && (ROUTE_TABLE[category][difficulty] || Object.values(ROUTE_TABLE[category])[0]);
  return pick(own) || pick(ROUTE_FALLBACK) || ids.find((id) => !isSmartRouter(id)) || 'gemini-3.8-flash';
}

// 路由记录：每轮记录一次选择，供用户事后查看
const ROUTE_LABELS = {
  [TASK_CATEGORY.CODING]: '代码',
  [TASK_CATEGORY.MATH]: '推理/数学',
  [TASK_CATEGORY.WRITING]: '写作',
  [TASK_CATEGORY.ANALYSIS]: '分析',
  [TASK_CATEGORY.CHAT]: '对话',
  [TASK_CATEGORY.SEARCH]: '检索',
  [TASK_CATEGORY.IMAGE]: '图像',
};
const DIFF_LABELS = {
  [DIFFICULTY.EASY]: '简单',
  [DIFFICULTY.MEDIUM]: '中等',
  [DIFFICULTY.HARD]: '困难',
};

export function routeModel(userText, availableModels) {
  const { category, difficulty } = classifyTask(userText);
  const modelId = pickRealModel(category, difficulty, availableModels);
  return {
    router: true,
    category,
    difficulty,
    categoryLabel: ROUTE_LABELS[category] || '对话',
    difficultyLabel: DIFF_LABELS[difficulty] || '简单',
    chosenModel: modelId,
    chosenProvider: providerOfForRouter(modelId),
  };
}

// 独立的 providerOf（避免循环依赖）
function providerOfForRouter(id) {
  const m = String(id || '').toLowerCase();
  if (m.startsWith('claude')) return 'Anthropic';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')) return 'OpenAI';
  if (m.startsWith('gemini')) return 'Google';
  if (m.startsWith('deepseek')) return 'DeepSeek';
  if (m.startsWith('glm')) return 'GLM';
  if (m.startsWith('kimi') || m.startsWith('moonshot')) return 'Kimi';
  if (m.startsWith('grok')) return 'Grok';
  return '其他';
}

export function isSmartRouter(modelId) {
  return modelId === SMART_ROUTER_ID;
}

// 路由器徽章的图标 & 显示名
// 路由器图标 = 方案 B「轨道枢纽」（2026.10.9.2 定稿）：中心路由 + 三个 120° 卫星模型节点。
// 单色 currentColor、viewBox 32、无渐变与品牌色。取自候选稿 git 历史 d259a28 的 design/smart-router-icon/candidate-b-hub.svg，
// 旧版是 TeamoRouter 产品 LOGO 的重绘，已弃用；改坐标请直接改这里并同步 tests/agent.test.mjs。
export const SMART_ROUTER_LABEL = 'smart_router';
export const SMART_ROUTER_PROVIDER_LABEL = 'TEAMOROUTER';
// 任何要把模型 ID 给用户看的地方都走这里：路由器统一显示 smart_router（用户要求：所有位置都用这个名字，不用中文「智能」），/system 显示 system-commands，其余原样
export function modelDisplayName(modelId) {
  if (modelId === SMART_ROUTER_ID) return SMART_ROUTER_LABEL;
  if (modelId === '__system__') return 'system-commands';
  return String(modelId || '');
}
export const ROUTER_ICON_SVG = '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="16.0" cy="16.0" r="3.6" stroke-width="2"/><circle cx="16.0" cy="16.0" r="1.3" fill="currentColor" stroke="none"/><path d="M16.00 11.60 L16.00 8.70" stroke-width="1.9" stroke-opacity=".7"/><circle cx="16.00" cy="5.40" r="2.5" stroke-width="2"/><path d="M19.81 18.20 L22.32 19.65" stroke-width="1.9" stroke-opacity=".7"/><circle cx="25.18" cy="21.30" r="2.5" stroke-width="2"/><path d="M12.19 18.20 L9.68 19.65" stroke-width="1.9" stroke-opacity=".7"/><circle cx="6.82" cy="21.30" r="2.5" stroke-width="2"/></svg>';
