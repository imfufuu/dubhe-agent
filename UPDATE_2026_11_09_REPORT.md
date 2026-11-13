# 2026-11-09 十一项更新与真实 API 验证报告

## API 与官网调研（用用户提供的 TeamoRouter key 实测）

- `GET https://api.teamorouter.com/v1/models` → HTTP 200，**80 个模型 ID**；`.cn` 镜像 30 个。新出现的 ID：`claude-fable-5-2`、`gemini-4-carbon`、`gemini-4-hydrogen`、`gpt-image-2.6-{flare,sunburst}` 及两个 `4k-upscale` 变体。
- `GET /v1/models/pricing` → HTTP 200，81 条 `models`（含 `list_cost` 官方标价与 `cost` 折后价）：
  - GPT Image 2.6 四个变体：`billing_mode=per_image`，1K/2K/4K 均 **$0.02/张**（官方 list $0.20）。
  - `claude-fable-5-2`：官方 $8 / $40 每百万 token（折后 $2.416 / $12.08）。
  - `gemini-4-carbon`：$2 / $10（引入价，11-30 后 $4/$20）；`gemini-4-hydrogen`：$1.50 / $7.50。
  - 官网价目页与 Anthropic 官方价目文档一致（见 CHANGELOG 引用）。
- **真实生图探测**：`POST /v1/images/generations`（`gpt-image-2.6-flare`，1024×1024，n=1）→ HTTP 200，`data[0].b64_json` 正常返回。
- **真实识图探测**：`POST /v1/chat/completions`（`deepseek-v4-flash-vision-exp`，图 + 一问）→ HTTP 200，但 `content` 为空、`completion_thinking_tokens: 20`、`completion_tokens: 20`：输出预算全被隐藏思考吃掉 → 这就是「生图识图出问题」的根因。生图本身正常。

## 十一项落地

| # | 结果 |
|---|---|
| 1 | `MODEL_CATALOG` 补 3 个新聊天模型（官方价 / 官方来源 URL）与 `TEAMOROUTER_CONFIRMED_MODEL_IDS`；`IMAGE_MODELS` 补 GPT Image 2.6 四变体 + 新家族 + `resolveImageVariant` 分支；`IMAGE_MODEL_PRICING` 加 $0.02/张；模型标签收敛为**仅「热门」「低价」**（移除 FREE/自动/AGENT/CHAT/vendor 等自创 badge）；Midjourney 四宫格用 canvas 2×2 切分（`js/mj-quad.js`），失败回退原图 |
| 2 | 生图参数实测正常；识图增加 `reasoning_content` 兜底 + 一次「关闭思考、要求直接作答」重发，避免空正文被当成失败 |
| 3 | 调节器关闭先移除 `.open` 播放 .3s 淡出/位移，320ms 后才 `hidden`，与设置页一致 |
| 4 | Workers AI `cfModelCard().pricing = null`；`priceBadgeFor` 返回空；卡片/估算只说明「不计价，账单以 Cloudflare 控制台为准」，不再做 Neurons↔美元换算 |
| 5 | 删除会话前后保存并恢复 `gatewayId` / `model`，不再切换 |
| 6 | 项目模式导入按 `effectiveModeration(store.state.settings)`：关闭审核时跳过本地文本/图片审核 |
| 7 | 首次进入弹窗要求设置称谓（可点预设），预设名换成真实网名（阿泽/小北/橙子… / Alex/Sam/Jordan…） |
| 8 | 手动取消 Turnstile 派发 `dubhe:turnstile-cancelled`，决策写入下一轮提示词「不要重试该工具/不要再次弹验证」，消费一次后清除 |
| 9 | 一次性 PAT 用于 push / workflow dispatch，未写入仓库、报告或日志 |
| 10 | 调节器新增「个性化系统提示词」textarea（≤2000 字），作为独立补充层注入请求，不改写主提示词；对话模式只发身份声明，不下发个性化内容 |
| 11 | `OFFLINE_MODEL_CONTEXT_SIZE` 4096 → **8192**，预算 6144；新增 `fitMessagesToContext()` 在离线请求前按 token 粗估裁剪历史，修复 7248 token 超出上下文 |

## 验证

- 新增 `tests/v5-updates.test.mjs`（5 项），同步更新模型目录/价目表/标签/上下文/生图家族等旧断言。
- 全量 `node tools/run-tests.mjs` → **1657 项 / 89 个文件 / 0 失败**；`node scripts/i18n-audit.mjs --json` → `[]`；`node scripts/build-pricing-docs.mjs` 生成的 docs.html 价目表与测试一致。
- 两枚凭据仅用于本次 API 探测与推送，未落盘到仓库。

## 参考

- API：`https://api.teamorouter.com/v1/models`、`/v1/models/pricing`（本次实测）
- 官网价目页：<https://teamorouter.ai/models>；Anthropic 官方定价：<https://platform.claude.com/docs/en/about-claude/pricing>；Gemini 4 价格说明：<https://teamorouter.com/blogs/gemini-4-hydrogen-vs-carbon-argon>
