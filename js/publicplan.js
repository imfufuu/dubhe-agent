// Public direction/action plan only; never expose hidden chain-of-thought or private planner rationale.
export function publicTaskPlan(userText, { language = /[\u3400-\u9fff]/.test(String(userText)) ? 'zh' : 'en' } = {}) {
  const raw = String(userText || '').trim();
  const short = raw.replace(/[`<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').slice(0, 140);
  const simple = raw.length < 100 && !/(?:写|创建|制作|开发|修复|优化|分析|调试|查找|查询|检索|搜索|研究|版权|数据|统计|计算|验证|检查|文件|项目|规划|实现|执行|测试|build|create|implement|fix|debug|analy[sz]e|research|search|file|project|plan|execute|test)/i.test(raw);
  const kind = /(?:代码|程序|函数|bug|网站|网页|沙箱|仓库|JS|Python|C\+\+|code|implement|debug|repo|software|html)/i.test(raw) ? 'code'
    : /(?:数据|统计|表格|CSV|回归|计算|data|statistic|csv|regression|calculate)/i.test(raw) ? 'data'
    : /(?:查找|查询|检索|最新|来源|研究|版权|search|research|latest|source|copyright)/i.test(raw) ? 'research' : 'task';
  const steps = {
    code: ['确认目标、相关文件与成功标准','按依赖小步修改，独立步骤并行','运行可用测试并核验实际产物、披露未验证部分'],
    data: ['检查输入结构、口径和单位','用可用工具计算与分析，保留可复现方法','抽样核验并给出结果、假设与限制'],
    research: ['明确问题范围、时间与核验标准','在能力允许时检索并读取原始来源','交叉核对证据，区分结论与未核实信息'],
    task: ['明确交付目标、约束和成功标准','分步骤完成，独立任务并行','核验实际结果并交付，说明限制'],
  };
  const en = {
    code: ['Confirm the goal, relevant files and success criteria','Make small dependency-aware changes; run independent steps concurrently','Run available checks, verify actual artifacts and disclose unverified parts'],
    data: ['Inspect the input structure, definitions and units','Compute and analyze with available tools; keep a reproducible method','Cross-check samples and report results, assumptions and limits'],
    research: ['Define the question, time scope and verification criteria','Search and read primary sources when available','Cross-check evidence and separate conclusions from unverified claims'],
    task: ['Define deliverables, constraints and success criteria','Work in steps; keep independent tasks concurrent','Verify actual outcomes and deliver them with limitations'],
  };
  return { version: 1, language, direction: simple ? (language === 'zh' ? '直接回答当前问题，必要时核对事实或计算。' : 'Answer the current question directly; check facts or calculations when needed.') : (language === 'zh' ? `完成目标：${short}` : `Deliver the requested outcome: ${short}`), steps: simple ? [] : language === 'zh' ? steps[kind] : en[kind] };
}
export function publicPlanMarkdown(plan) {
  if (!plan?.direction) return '';
  const title = plan.language === 'zh' ? '任务方向' : 'Direction', steps = plan.language === 'zh' ? '计划' : 'Plan';
  return `**${title}**：${String(plan.direction)}${plan.steps?.length ? `\n\n**${steps}**\n${plan.steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}` : ''}\n\n`;
}
