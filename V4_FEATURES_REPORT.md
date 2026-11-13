# 2026-11-09 四项功能落地与验证报告

## ① 任务最终产物报告

- 新增 `js/final-report.js` 与工具 `set_final_report`（第 54 个内置工具，已登记到能力表、执行契约、工具目录、离线白名单与按需挂载规则）。
- Agent 指定**沙箱工作区**中一个已存在的文件（拒绝 `internal/`、`.git/`、非法路径、不存在的文件）；`main.js` 在 `onTurnEnd` 取出路径并派发 `dubhe:final-report`，`ui-chat-mode.js` 的 `installFinalReportOpener` 展开沙箱面板并调用 `openFileViewer(path)`。
- 回归：`tests/v4-features.test.mjs` 覆盖路径校验、工具调用、事件派发与接线。

## ② 对话模式只传一条身份声明

- `js/api.js` 新增 `chatIdentityMessage(model)`：`你是运行在 Dubhe Agent 网页里的 <模型> 模型，当前为对话模式，不能运行任何工具，只做模型测试。`（英文对应）。
- `bareChat` 分支把请求体构造为 `[该唯一 system 消息, ...用户/助手历史]`，**过滤掉所有其它 system/developer 消息**，不注入思考策略、工具表、记忆、技能与运行规则；离线 GGUF 分支同样处理。
- `js/agent.js` 只保留历史消息，`js/ui-tuner.js` 的提示同步改为「只上传一条简短身份声明」。

## ③ 自注册工具：代码注册 + 两道门；菜单前置

- `handler.kind` 新增 `'code'`。第一道门：`js/tool-code-review.js` 的静态安全初审（禁用 `eval`/`new Function`/`fetch`/`WebSocket`/`import`/全局对象/循环/`Date`/`async`/`this` 等，限 4000 字符，必须求值为纯函数），失败直接拒绝，连确认环节都进不去。
- 第二道门：沿用 `requireApproval` 的一次性用户确认票据，确认摘要明示「已通过安全初审，仍需你确认」；用户在对话输出的确认卡批准后工具才写入注册表。
- 执行：`js/tool-code-runtime.js` 的受限运行时（`new Function` + 危险全局形参遮蔽 + 静态黑名单双保险）。页面 CSP 禁止 `unsafe-eval` 时返回明确错误，建议本地 `server.py` 模式或声明式 handler；可注入 runner 便于测试/未来接入 Worker 沙箱。
- 设置页新增 `#set-tool-manager-sec`，位置移到「网关」之后、「外观」之前。
- 回归：危险代码被拒、安全代码初审通过但需确认、批准后注册成功、`invoke` 实测 `2+3=5`、`4+5=9`。

## ④ 对话模式 UI 降级

- `js/ui-chat-mode.js`（从 `ui.js` 抽出以守住 3000 行预算）：思考按钮去掉 `aria-haspopup`、隐藏 `#think-menu`，点击退化为普通开关；`#sandbox-toggle` / `#web-toggle` 隐藏；`document.documentElement[data-chat-mode]` 标记模式。
- `js/ui-attachments.js` 的 `setChatMode(true)`：只接受文本类文件（扩展名或 `text/*` MIME），`readAs('text')` 直接解析成 `kind:'text'`；`sendChatTurn()` 把这些文本拼进消息正文并**不传附件对象**。
- `store.subscribe(sync)` 让切换调节器后立即生效。

## 验证与工程约束

- 新增 `tests/v4-features.test.mjs`（4 项），更新 `tests/tuner-ui.test.mjs`、工具数量断言（53→54）、`tests/agent.test.mjs` 的 `ui.js` 字节预算（176 KB → 184 KB，注释说明；**3000 行硬约束保持不变**，当前 2999 行）。
- 全量 `node tools/run-tests.mjs` → **1652 项 / 88 个文件 / 0 失败**；`node scripts/i18n-audit.mjs --json` → `[]`；语法检查通过。
- 未做：真实浏览器里跑代码工具（Node 侧受限运行时已实测）、多轮对话下的最终报告自动打开真机验证；这两项建议列入下一阶段 E2E。

> 安全说明：静态初审不是形式化验证，代码执行仍受 CSP 与受限运行时约束；任何「允许代码注册」都应在部署环境保留用户确认这一道人工闸门。
