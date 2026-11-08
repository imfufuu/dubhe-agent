# Agent 架构优化说明（2026-11-08）

本轮「自主优化 Agent 架构」不是重命名或挪文件，而是把**一轮请求的行为决策**从四个分散位置收敛成两个可测试的纯逻辑内核，并让工具表在运行时可扩展。

## 优化前的问题

| 决策 | 原来散落在 | 后果 |
|---|---|---|
| 思考开关 / 等级 | 设置页 `state.settings` → `agent.js` 多处直接读 | UI 显示与实际请求可能不一致 |
| 温度 | `api.js resolveTemperature`（自动）与调用方（手动）混用 | 没有统一的「手动档位」入口 |
| 工具表 | `tools.js TOOL_DEFS` 静态数组 + `agent.js` 本地副本 + `capabilities.js` 派生 | 新增一个工具要改 7 处；动态工具无法进入白名单 |
| 网关模型能力 | `gateway-registry.js` 与 Worker `/v1/models` 各有一份 | 模型列表不全 / 供应商显示错 |

## 优化后的结构

```
   输入框「调节器」(ui-tuner.js)        设置页 state.settings
            │  store.state.tuner              │
            └──────────────┬───────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  Turn Environment Kernel (agent-runtime.js) │  ← 纯函数，唯一决策点
        │  mode / thinking / reasoningLevel /         │
        │  temperature / toolsEnabled / model filter │
        └───────┬───────────────────────┬───────────┘
                ▼                       ▼
     agent.js（工具表、请求、       api.js（数值温度 / 智能自调节）
     幻觉 tool_calls 闸门）              │
                │                          │
                ▼                          ▼
     ┌────────────────────────────────────────────┐
     │ Tool Registry (tool-registry.js)            │ ← 内置 + 自注册工具唯一来源
     │ allToolDefinitions() / 声明式 handler /      │
     │ 一次性用户确认票据                          │
     └────────────────────────────────────────────┘
```

### 1. 回合环境内核 `js/agent-runtime.js`

- `resolveTurnEnvironment()` 一次算完全部策略：模式（Agent / 对话）、思考开关与等级、温度（数值或 `null` 表示智能自调节）、工具是否可用、模型能力过滤。
- **默认不劫持设置页**：`agentReasoningLevel: 'inherit'` 时沿用 `settings.thinking / reasoningLevel`，默认行为与优化前逐项一致（测试钉住「思考 Off」回归）。
- UI 只写 `store.state.tuner`；`agent.js` 与 `api.js` 只读解析结果，不再各自解释设置项。
- 对话模式有两道理闸门：`tools = []` 不下发工具表；`toolCallsForEnvironment()` 丢弃模型幻觉出的 `tool_calls`。

### 2. 工具注册表 `js/tool-registry.js` + `tools.js allToolDefinitions()`

- 内置定义与「用户已批准的自注册工具」合并为唯一来源；`agent.js` 的能力白名单、子智能体工具表、统计面板都从 `liveToolDefs()` 取。
- 用 namespace 访问新导出（`ToolRuntime.allToolDefinitions?.()`），旧版 `tools.js` 缺失该导出时自动回退 `TOOL_DEFS`，避免静态站点混版缓存 link 失败白屏。
- 新增工具按既有规范完整登记：`CAPABILITY_REGISTRY`（非核心、按需挂载）、`TOOL_CONTRACTS`、`TOOL_MOUNT_RULES_SOURCE`、`TOOL_SUMMARIES`、离线白名单。三方一致性自检仍然为 0 问题。

### 3. Workers AI 模型能力单例

- `cfModelCard()` 统一给出供应商（Cloudflare）、模型原厂、Neurons 费率、是否支持 function calling；`/v1/models` 直接返回这份元数据（20 个模型全部可见）。
- 客户端模型卡片不再把 `@cf/openai/...` 误归到 OpenAI，也不再用美元价目表渲染 Neurons 图表。

### 4. 性能与可观测性

- 审核词库正则预编译（`TERM_CACHE`）：多语言加固层从约 5 ms/次降到约 0.3 ms/次，1710 次重复验证可在十几秒内跑完。
- Worker 的 502 现在附带脱敏后的上游错误摘要（自动过滤长凭证串），不再是一个无法定位的黑盒。

## 不变量与验证

- 默认（Agent 模式 + 智能自调节 + 跟随设置）与优化前一致；`tests/agent.test.mjs` 477 项主单测、`tests/agent-runtime.test.mjs` 6 项、`tests/tuner-ui.test.mjs` 5 项钉住接线。
- 全量 `npm test`：1614 项、81 个文件，0 失败。
- 边界：环境内核是纯策略层，不保证模型原生思考 token 数；对话模式不调用工具也不代表模型不会自行编造工具名，策略门只负责丢弃。
