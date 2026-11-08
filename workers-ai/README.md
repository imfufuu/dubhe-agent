# Cloudflare Workers AI 独立网关

此 Worker 与网页抓取中继分开部署；网页设置里选择 **Cloudflare Workers AI**，把部署得到的 `https://<name>.<account>.workers.dev` 填入网关基础 URL，不需要 API Key。可随时改用其他部署了本代码的 Worker URL。所有对话、工具定义与工具结果会发送给该 Worker 和 Cloudflare Workers AI；不要把不信任的 Worker 当作隐私安全的服务。

## 部署

在自己的 Cloudflare 账号启用 Workers AI，安装 Wrangler 后运行：

```sh
cd workers-ai
npx wrangler deploy
```

`wrangler.toml` 绑定 `AI`。旧配额 Durable Object 的迁移记录和存储保留，但不再绑定或用于推理，升级不会主动删除历史数据。首次部署需要创建 Worker 和绑定 Workers AI 的账号权限。本仓库的 relay 部署工作流**不会**部署本网关；可在 GitHub Actions 手动运行 `Deploy Workers AI gateway`，使用仓库的 Cloudflare Actions 密钥和账号变量。部署后才会有可用 URL。Cloudflare 的配额与模型可用性依账号和计划变化。

## 2026-11-08 修复与云端验证

部署后对 `https://dubhe-workers-ai.dubhe-agent.workers.dev` 做了真实请求验证：

| 问题 | 原因 | 修复 | 实测 |
|---|---|---|---|
| 带 `tools` 的请求 HTTP 502 | 旧脚本把 OpenAI 格式工具定义转成扁平 `{name,description,parameters}`；GPT-OSS 需要 `{type:'function',function:{…}}`，上游抛错被吞成 502 | `normaliseTools()` 统一入参，`runWithTools()` 按模型选首选格式，遇到**确定性 4xx schema 拒绝**时只重试另一种格式一次；非参数错误绝不重放 | POST `/v1/chat/completions` + tools → **200**，返回标准 `tool_calls` |
| 模型列表不全 | `/v1/models` 只返回 3 个 function-calling 模型，客户端把它当完整白名单 | 返回全部 20 个启用模型，每项带 `agent_tools` / `provider` / `vendor` / `display_name`；`?agent_tools=1` 保留旧行为 | `/v1/models` → **20** 个，`/health` → `models:20, agent_models:3` |
| 模型卡片供应商 / 费率图表异常 | `@cf/…` 被 `providerOf()` 归到「其他」，并被当成美元价目表模型 | 供应商统一 Cloudflare（原厂作 badge），Neurons 费率替代 `$0/NaN`；客户端 `cfModelCard()` 与 Worker 同一份元数据 | 卡片显示 Cloudflare + 原厂 + AGENT/CHAT |
| 偶发 HTTP 400 | 模型 ID 大小写不一致（vision `9B` vs `9b`）、`max_tokens` 超 2048 被拒、多模态 content 数组被拒、chat-only 模型带 tools 被拒 | ID 大小写不敏感解析；`max_tokens`(1–8192) / `temperature`(0–2) / `top_p` 钳制而不是拒绝；文本 part 数组转文本；chat-only 模型自动降级为纯文本回答并注入说明 | 各类参数 → **200**；chat-only + tools → **200** 纯文本 |
| 502 无法定位 | 旧脚本把所有上游错误替换成一句通用文案 | `inferenceFailure()` 附加脱敏后的上游错误摘要（自动过滤 ≥32 字符的凭证串），429 单独区分 | 错误信息可定位到参数/额度问题 |

`inferenceFailure` 只在**请求参数被确定性拒绝**时换一次工具 schema；对限流、超时、疑似已计费的模糊失败保持「不自动重试」，客户端也保留 `noReplay`。

## 配额和边界

- `GET /v1/models` 列出全部启用模型；`agent_tools: true` 的三个模型（GPT-OSS 20B / 120B、Llama 3.3 70B fast）可接收 function tools，其余仅供纯文本对话。在网页「调节器 → 对话模式」里会开放全部模型且不发送任何工具；Agent 模式请选 `agent_tools: true` 的模型。
- 只允许 `js/cloudflare-ai-catalog.js` 中显式启用的 Cloudflare Hosted 模型；`GET /v1/catalog` 列出各类型、Neurons 费率及禁用的 Paid-only ID。其余 ID、第三方代理、LoRA 和未适配的接口均拒绝。模型、价格和 Free 可用性可能变化，目录不代表账号有权访问；使用前请核对 [Cloudflare 官方定价](https://developers.cloudflare.com/workers-ai/platform/pricing/) 和模型说明。部分模型计划 2026-11-20 退役，到期自动拒绝。
- 图像通过单独的 `/v1/images/generations` 使用 FLUX.1 Schnell（每次一张，固定 4 steps 和默认尺寸）；识图通过 `/v1/vision` 的 Moondream 3.1（每次单图、PNG/JPEG/WebP、最大 2 MiB）；决策/提取模型只提供独立的 `/v1/decisions` 原生结构化接口。图像编辑、其他尺寸、批量、FLUX.2 和 Leonardo 尚未接通；没有真实云端生图/识图推理验证。
- **不设置应用侧每日用量上限**。Cloudflare 自身的免费额度、速率限制和账号账单规则仍然生效；免费 Neurons 为同账号共享，付费计划可能产生费用。请求失败或结果不明仍可能产生费用，不要盲目重试。
- Worker 默认没有身份认证或访问控制，公开 URL 会让任何人调用并可能造成费用；建议配置 Cloudflare Access、WAF 和速率限制。请勿向不信任者公开 Worker URL。
- API：`GET /health`、`GET /v1/models`、`GET /v1/catalog`、`POST /v1/chat/completions`、`POST /v1/images/generations`、`POST /v1/vision`、`POST /v1/decisions`。聊天内部使用非流式推理再封装为 SSE，首字可能较慢；仅函数工具格式、参数范围与模型白名单经过真实云端验证。
