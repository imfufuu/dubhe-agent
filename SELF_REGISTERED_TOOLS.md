# Agent 自注册工具（2026-11-08）

Agent 现在可以在对话中用 `tool_registry` **创建、读取、更新、启用/停用、删除并调用自己的工具**，工具在之后的回合里会像内置工具一样出现在模型工具表中。所有变更都需要用户安全确认。

## 一次典型流程

1. Agent 调用：

```json
{"name":"tool_registry","arguments":{"action":"register","definition":{
  "name":"custom_greet",
  "description":"向指定的人打招呼",
  "parameters":{"type":"object","properties":{"who":{"type":"string"}},"required":["who"]},
  "handler":{"kind":"text_template","template":"你好，{{who}}！"}
}}}
```

2. 工具返回 `⏸ 需要用户安全确认：注册新工具 custom_greet（text_template）… confirm_token=…`，**此时工具没有被创建**，也没有任何副作用。
3. 对话输出里出现一张「执行内核」同款确认卡（操作 / 原因 / 影响 / 可逆性 / 票据前缀），列出动作、工具名、handler 类型和票据前缀。点「允许」会直接完成这次变更；点「拒绝」则票据作废。
4. 若走 Agent 重试路径，批准后的票据是一次性的（5 分钟有效），带 `confirm_token` 重发同一 action 即可完成。票据只能消费一次，Agent 侧**没有** `approve` action，无法自行批准。
5. 之后模型可以直接调用 `custom_greet({"who":"小明"})` → `你好，小明！`，也可以在「设置 → 自注册工具」里查看完整定义、停用或删除（删除需二次点击确认）。

## 安全模型

| 边界 | 实现 |
|---|---|
| 名称 | 强制 `custom_` 前缀（小写字母/数字/下划线），**不能覆盖或删除任何内置工具** |
| 执行 | handler 只能从声明式白名单选择：`constant` / `text_template` / `text_transform` / `calculator` / `timestamp` / `echo`。模型提供的 JS、命令、URL **永不执行**；算式用递归下降解析器，不用 `eval`/`Function` |
| 确认 | `register` / `update` / `delete` / `enable` / `disable` 均需一次性用户确认票据；中风险工具（`risk: "medium"`）每次调用都要确认 |
| 参数 | JSON Schema `object`，最多 16 个属性，类型限 string/number/integer/boolean；必填项与类型在执行前校验 |
| 容量 | 最多 24 个工具 / 64 KiB，本地 `localStorage` 持久化；读取完整定义（含 handler 配置）供审计 |
| 可见性 | 下发给模型的只有 `{name, description, parameters}`，handler 内部实现不下发 |

`action` 列表：`list`、`read`、`register`、`update`、`delete`、`enable`、`disable`、`invoke`、`pending`、`help`。内置工具请用 `tool_library` 查询或直接在工具表中调用。

## 接线位置

- `js/tool-registry.js`：注册表、确认门、声明式 handler、定义校验。
- `js/tools.js`：`TOOL_DEFS` 新增 `tool_registry`；`allToolDefinitions()` 合并动态工具；`executeTool()` 分发到注册表。
- `js/ui-tool-manager.js`：设置页里的工具管理（读取完整定义 / 启停 / 二次确认删除）。
- `js/tool-approval-card.js`：对话输出里的用户确认卡（复用执行内核 `.confirm-card` 样式）。
- 能力登记处、执行契约、按需挂载规则、离线白名单、工具目录摘要均已同步登记。
- 回归：`tests/tool-self-registration.test.mjs`（6 项）、`tests/tuner-ui.test.mjs`（5 项）、能力三方一致性自检。

## 边界

这是「声明式工具」而不是插件系统：不能执行任意代码、不能访问网络或本机文件、不能提权。临时托管的第三方字体、Worker 网关等外部依赖与本机制无关；用户仍需对批准的工具定义自行负责。
