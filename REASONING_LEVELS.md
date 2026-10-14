# 思考分级如何适配模型

2026-10-14 更新。分级采用「型号支持的原生控制 + 任务规模相称的验证策略」，不把答案长度当作努力程度。

| 模型 | 原生控制 | 六档适配 |
|---|---|---|
| Claude | thinking.budget_tokens | 1024 / 2048 / 4096 / 8192 / 16384 / 32768 |
| GPT 推理系列、Gemini、Grok | 网关 reasoning_effort | 沿用各家合法档位；o1/o3/o4 不发 minimal/xhigh |
| DeepSeek v4、flash/pro 别名 | thinking.type + reasoning_effort | low / low / high / high / max / max |
| GLM 5.3 系列 | thinking.type + reasoning_effort | low / low / high / high / max / max |
| GLM 5.2 | thinking.type + reasoning_effort | high / high / high / high / max / max；低档用软策略区别，避免 minimal 导致不思考 |
| 旧 DeepSeek、旧 GLM | 已有网关开关 | 六级验证引导，不伪造 budget_tokens |
| 未确认能力的模型 | 不发送未经确认的原生字段 | 六级验证引导 |

六级策略逐步增加：快速合理性检查、主要约束检查、关键结果验证、不同方案与边界／反例测试、独立方法复核、关键证据交叉检查与冲突消解。高档不要求简单题复杂化，不强制额外调用工具，不允许为了凑次数重复有副作用的动作；无法验证时如实标注。只输出结论、证据和限制，不要求展示隐藏推理链。

## 边界与降级

- 原生 effort 相同不代表六档完全相同：策略仍不同，但**软引导不能保证固定推理 token 或稳定的速度/准确率差异**。
- 不用 max_tokens 截断正文来伪装低努力。Claude 的既有预算/正文额度关系保留。
- 若网关只拒绝 effort，先剥离 effort 并保留 thinking。若拒绝整个 thinking，再仅使用策略。降级按模型在本次页面会话中记忆，界面会提示。
- Off 不发送思考参数、不注入分级策略；不能保证原生默认思考或强制思考的模型不思考（如 GLM 5.3）。
- 主模型、智能路由选中的实际模型和子智能体统一在 streamChat 请求边界适配。策略不写回消息历史；重试不重复追加。
- 已覆盖请求体、降级、历史不变和协议字段的自动测试；没有使用付费模型凭证做模型质量/推理量 A/B 评测。

## 官方参数依据

- [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [智谱深度思考](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)

浏览器布局回归：启动本地静态服务，安装 Playwright/Chromium，执行 `node tools/check-tool-ui.mjs`。
