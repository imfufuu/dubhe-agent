# Cloudflare Workers AI 独立网关

此 Worker 与网页抓取中继分开部署；网页设置里选择 **Cloudflare Workers AI**，把部署得到的 `https://<name>.<account>.workers.dev` 填入网关基础 URL，不需要 API Key。可随时改用其他部署了本代码的 Worker URL。所有对话、工具定义与工具结果会发送给该 Worker 和 Cloudflare Workers AI；不要把不信任的 Worker 当作隐私安全的服务。

## 部署

在自己的 Cloudflare 账号启用 Workers AI，安装 Wrangler 后运行：

```sh
cd workers-ai
npx wrangler deploy
```

`wrangler.toml` 绑定 `AI`。旧配额 Durable Object 的迁移记录和存储保留，但不再绑定或用于推理，升级不会主动删除历史数据。首次部署需要创建 Worker 和绑定 Workers AI 的账号权限。本仓库的 relay 部署工作流**不会**部署本网关；也可在 GitHub Actions 手动运行独立的 `Deploy Workers AI gateway`，使用现有 Cloudflare Actions 密钥和账号变量（令牌需具备创建相应资源的权限）。部署后才会有可用 URL。Cloudflare 的配额与模型可用性依账号和计划变化。检查 Worker 日志与 Cloudflare 控制台核实部署和真实请求。

## 配额和边界

- 只允许 `js/cloudflare-ai-catalog.js` 中显式启用的 Cloudflare Hosted 模型；`GET /v1/catalog` 列出各类型及禁用的 Paid-only ID。其余 ID、第三方代理、LoRA 和未适配的接口均拒绝。模型、价格和 Free 可用性可能变化，目录不代表账号有权访问；使用前请核对 [Cloudflare 官方定价](https://developers.cloudflare.com/workers-ai/platform/pricing/) 和模型说明。
- 文本目录包含 GPT-OSS、Llama、Qwen 等；目前仅 GPT-OSS 20B/120B 和 Llama 3.3 70B fast 接受 Agent 的 function tools，其余仅供不传 tools 的纯文本客户端使用，不列入网页 Agent 模型选择器；完整文本清单见 `/v1/catalog`。部分模型计划 2026-11-20 退役，到期自动拒绝；功能调用和模型可用性尚未进行真实云端验证。
- 图像通过单独的 `/v1/images/generations` 使用 FLUX.1 Schnell（每次一张，固定 4 steps 和默认尺寸），在设置中选择 `Cloudflare FLUX.1 Schnell` 生图系列。图像编辑、其他尺寸、批量、FLUX.2 和 Leonardo 尚未接通。识图通过 `/v1/vision` 的 Moondream 3.1（每次单图、PNG/JPEG/WebP、最大 2 MiB），切换到 Cloudflare 网关后识图工具使用该模型；不接收远程 URL。没有真实云端推理验证。
- 决策/提取模型 Clef、Clef Flash、Clef Omni、Clairic 仅提供独立的 `/v1/decisions` 原生结构化接口，并**未替代网页 Jev 决策层或加入 Agent 工具**。本实现只接收文本 state；多模态输入、其他视觉模型及未核实的免费模型仍禁用。付费计划专属模型列入禁用目录，不开放调用。
- **不再设置应用侧每日用量上限**。Cloudflare 自身的免费额度、速率限制和账号账单规则仍然生效；免费 Neurons 为同账号共享，付费计划可能产生费用，具体以 Cloudflare 控制台和定价为准。
- Worker 默认没有身份认证或访问控制，公开 URL 会让任何人调用并可能造成费用；建议配置 Cloudflare Access、WAF 和速率限制。请勿向不信任者公开 Worker URL。请求失败或结果不明仍可能产生费用，不要盲目重试。
- API 包括 `/v1/models`、`/v1/catalog`、`/v1/chat/completions`、`/v1/images/generations`、`/v1/vision`、`/v1/decisions`。聊天内部使用非流式推理再封装为 SSE，首字可能较慢。

## 决策接口示例

将 `WORKER_URL` 换为自己的 Worker 地址。请求使用官方结构化 schema，不应发送 OpenAI chat messages。与其他推理一样，它会消耗 Workers AI Neurons；失败后不要盲目重发。

```sh
curl "$WORKER_URL/v1/decisions" -H 'Content-Type: application/json' -d '{
  "model":"@cf/cloudflare/clef-flash",
  "state":"客户希望下周收到订单。",
  "questions":{"urgent":{"type":"noul","instructions":"是否有明确的交付期限？"}}
}'
```

Clairic 使用 `fields` 而非 `questions`，各项 schema 见 [Cloudflare Clairic 文档](https://developers.cloudflare.com/workers-ai/models/clairic/)。一次最多 16 个问题或字段，不支持图像、音频或视频。
