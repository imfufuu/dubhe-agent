# 2026-11-13 十三项修复与验证报告

## ⑬ 头号问题：对话模式为什么一直没生效（已彻底修复）

**根因**：`js/agent-runtime.js` 的 `resolveTurnEnvironment()` 返回字段叫 `mode`，但 `js/agent.js`（`bareChat` 开关、`buildMessages` 裸聊分支）与 `js/ui-chat-mode.js`（工具条降级）判断的都是 `environment === 'chat'` —— **永远为 false**。因此调节器切到对话模式后：完整 2.1k 系统/任务提示词照发、工具表照传、UI 按钮也不隐藏。不是"改得不够短"，是开关从未闭合。

**修复**：
1. `resolveTurnEnvironment()` 同时返回 `environment: 'chat' | 'agent'`，三处判断全部生效。
2. 按你的要求改成**真正的纯净模型对话**：`chatIdentityMessage()` 返回 `null` 且不再注入；`streamChat(bareChat)` 的请求体只保留用户/助手历史，**零 system / developer / instructions / task 文本，零 tools 字段，零工具能力声明**；同时清空 `tools`、`fastMode`、思考专属参数。离线 GGUF 分支同样处理。

**硬证据**（`tests/chat-purity.test.mjs` 直接捕获 `streamChat` 发出的 `fetch` 请求体）：

```json
{"model":"gpt-6-sol","stream":true,"stream_options":{"include_usage":true},"messages":[{"role":"user","content":"hello"}],"temperature":0.65}
```

断言：`'system' in body === false`、`'instructions' in body === false`、`'task' in body === false`、`'tools' in body === false`、`messages` 无 system/developer、请求体 < 400 字节；Agent 模式对照仍保留完整系统层。测试 3/3 通过。

## 其余十二项

| # | 结果 |
|---|---|
| ① | flow 折叠分片：`paintOrderedAssistant` 在 `paintPart` 后按 `part.text` 兜底渲染 `.md-body`，文本块不再为空 |
| ② | 新增 `js/thinking-labels.js`：`Thinking…` + `Thought for N second(s)`；<1s→1s，>60s→`minute(s) + second(s)`，整分钟不带秒；UI 中文「思考摘要/思考过程/思考中」统一替换 |
| ③ | `:::choice multi 标题` 多选语法：解析器带 `multi` 标记、渲染 checkbox、点击多选、提交用顿号拼接 |
| ④ | 调节器删除「在设置中管理」跳转入口与相关文案 |
| ⑤ | 对话模式的思考开关与环境按钮放进同一行右侧（`.tuner-env-row`） |
| ⑥ | 「自注册工具」并入「工具能力」栏目，并把该栏目移到设置页靠前（外观之前） |
| ⑦ | 多模态模型标签复原为描述性（低价 / 通用 / 高精度 / 写实 / 插画 / 4K…），Gemini 3.1 Pro 从「预览版」改为「高精度」；**聊天模型选择器仍只有热门/低价** |
| ⑧ | 生图家族按网关过滤：Cloudflare FLUX 只在 Cloudflare 网关显示，TeamoRouter 下不再出现 |
| ⑨ | 工具卡片停用/删除按钮相邻、详情 JSON `overflow-x:auto` + 容器 `overflow-x:hidden`，设置页不再左右滑动 |
| ⑩ | 对话模式隐藏沙箱、联网、快速、项目、面板五个按钮。**2026-11-14 纠偏**：思考按钮不再改文案，SVG 图标与「思考」保留，对话模式仍是按下开/关（见 `V7_CORRECTIONS_REPORT.md`） |
| ⑪ | 设计准则写入中英核心系统提示词与知识库。**2026-11-14 纠偏**：导航页的「设计准则宣言」段落已删除；改为按排版先行 / 物理动效 / 克制定色 / 线性图标 / 破格布局 / 1px 细节重做首屏 `hero`（见 `V7_CORRECTIONS_REPORT.md`） |
| ⑫ | 新增双语知识库 `assets/knowledge/dubhe-guide.{zh,en}.md`，覆盖页面入口、网关、调节器、纯净对话模式、设置、工具与产物、设计准则；`tools/build-knowledge-index.mjs` 生成 `guide-zh` / `guide-en` 两条记录 |

## 验证

- 新增 `tests/chat-purity.test.mjs`（3 项）、`tests/v6-ui-updates.test.mjs`（6 项），同步更新旧断言（标签、网关过滤、知识库、行数预算等）。
- 全量 `node tools/run-tests.mjs` → **1666 项 / 91 个文件 / 0 失败**；`node scripts/i18n-audit.mjs --json` → `[]`；`node tools/build-knowledge-index.mjs --check` 一致。
- `ui.js` 保持 2999 行（<3000 硬预算）。

## 推送状态

本轮未提供一次性 GitHub PAT，上一枚已按约定弃用，因此改动**只在本地提交**，尚未 push / 部署。重新给 PAT 即可推送并触发 CI / Pages / Workers AI 部署。
