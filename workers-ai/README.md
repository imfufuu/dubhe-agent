# Cloudflare Workers AI 独立网关

此 Worker 与网页抓取中继分开部署；网页设置里选择 **Cloudflare Workers AI**，把部署得到的 `https://<name>.<account>.workers.dev` 填入网关基础 URL，不需要 API Key。可随时改用其他部署了本代码的 Worker URL。所有对话、工具定义与工具结果会发送给该 Worker 和 Cloudflare Workers AI；不要把不信任的 Worker 当作隐私安全的服务。

## 部署

在自己的 Cloudflare 账号启用 Workers AI 和 Durable Objects（SQLite），安装 Wrangler 后运行：

```sh
cd workers-ai
npx wrangler deploy
```

`wrangler.toml` 绑定 `AI` 和单个 SQLite Durable Object；不可移除，否则聊天请求 fail closed。首次部署需要能创建 Worker、AI 和 Durable Object 的账号权限。本仓库的 relay 部署工作流**不会**部署本网关；也可在 GitHub Actions 手动运行独立的 `Deploy Workers AI gateway`，使用现有 Cloudflare Actions 密钥和账号变量（令牌需具备创建相应资源的权限）。部署后才会有可用 URL。Cloudflare 的配额与模型可用性依账号和计划变化。检查 Worker 日志与 Cloudflare 控制台核实部署和真实请求。

## 配额和边界

- 只允许 `js/cloudflare-ai-catalog.js` 中显式启用的 Cloudflare Hosted 模型；`GET /v1/catalog` 列出各类型及禁用的 Paid-only ID。其余 ID、第三方代理、LoRA 和未适配的接口均拒绝。模型、价格和 Free 可用性可能变化，目录不代表账号有权访问；使用前请核对 [Cloudflare 官方定价](https://developers.cloudflare.com/workers-ai/platform/pricing/) 和模型说明。
- 文本目录包含 GPT-OSS、Llama、Qwen 等；目前仅 GPT-OSS 20B/120B 和 Llama 3.3 70B fast 接受 Agent 的 function tools，其余仅供不传 tools 的纯文本客户端使用，不列入网页 Agent 模型选择器；完整文本清单见 `/v1/catalog`。部分模型计划 2026-11-20 退役，到期自动拒绝；功能调用和模型可用性尚未进行真实云端验证。
- 图像通过单独的 `/v1/images/generations` 使用 FLUX.1 Schnell（每次一张，固定 4 steps 和默认尺寸），在设置中选择 `Cloudflare FLUX.1 Schnell` 生图系列。图像编辑、其他尺寸、批量、FLUX.2 和 Leonardo 尚未接通。识图通过 `/v1/vision` 的 Moondream 3.1（每次单图、PNG/JPEG/WebP、最大 2 MiB），切换到 Cloudflare 网关后识图工具使用该模型；不接收远程 URL。没有真实云端推理验证。
- 决策/提取模型 Clef、Clef Flash、Clef Omni、Clairic 仅提供独立的 `/v1/decisions` 原生结构化接口，并**未替代网页 Jev 决策层或加入 Agent 工具**。本实现只接收文本 state；多模态输入、其他视觉模型及未核实的免费模型仍禁用。付费计划专属模型列入禁用目录，不开放调用。
- Durable Object 原子预留并结算 **单 IP 每 UTC 日 1000 Neurons、此 Worker 每日 10000 Neurons 的应用侧预算**。IP 来自 `CF-Connecting-IP`，不信任 `X-Forwarded-For`；NAT 用户共享 IP，换 IP 可获得另一份，不能替代账号认证或防滥用。建议另配 Cloudflare WAF/速率限制。IP 按日期哈希后存储，不存明文；哈希不等同匿名化，旧日数据在定时清理。
- 计量依据代码固定的模型单价与模型返回的 token 使用量计算，是**应用估算而非 Cloudflare 账单**。请求前按输入字节、模板余量和最大输出做保守预留；剩余额不足时可能提前拒绝；缺少 usage、超时、失败、取消或结算中断时保留预留额至当日结束，避免盲目释放。估算可能与真实用量不同，定价变化、模板额外 token 和其他调用会使实际用量超过预算，本功能不能保证费用上限。
- Cloudflare 免费 10000 Neurons/日是**整个账号共享**，不是每个 Worker 一份；其他 Worker、AI Gateway 和 API 的消费不会被这里看到。付费计划超过免费额度可能计费。要避免计费请使用 Free 计划并关注账号官方用量/限额；切换不同账号的 Worker 不会共享此 Worker 的配额，不能用多个同账号 Worker 扩大免费额度。每日 00:00 UTC 重置，剩余额不累积。
- API 包括 `/v1/models`、`/v1/catalog`、`/v1/chat/completions`、`/v1/images/generations`、`/v1/vision`、`/v1/decisions`。聊天内部使用非流式推理再封装为 SSE，首字可能较慢。专业接口调用期间原子预留该 IP 和 Worker 剩余额：生图需要至少 350、识图及决策至少 250 Neurons 的剩余额；成功后根据模型用量或图片尺寸与步数结算，失败或用量不明保留整笔预留。因是保守估算，剩余不足预留时会提前拒绝。没有身份认证或访问控制；公开发布代表允许任何人使用剩余额。

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
