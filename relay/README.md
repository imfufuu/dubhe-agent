# Dubhe Agent Cloudflare Relay

Cloudflare Worker 中继（module syntax），为静态站点提供单页抓取、有限网页搜索与同源小站点爬取。当前版本 **1.9.0**。

## 部署

### Wrangler（推荐）

```bash
cd relay
npx wrangler deploy
```

`wrangler.toml` 已指向 `worker.js`。部署前先在 `wrangler dev` 下做本地 smoke test；发布后记下 `https://<worker>.<account>.workers.dev`。

### Cloudflare Dashboard

在 Workers & Pages 创建 Worker，使用模块编辑器粘贴仓库中的 `worker.js` 全文并部署。`worker-dashboard.js` 是旧式 service-worker 语法的 **1.5 兼容版**，没有 Search/Crawl 路由；不要用它部署新功能。

## 在 Dubhe Agent 里启用

**方式 A：同源绑定（推荐）**：把 Pages/Worker 的 `/api/*` 路由绑定到这个 Worker。前端探测 `/api/health`，只有 health 声明 `capabilities: ["fetch", "search", "crawl"]` 才会提供对应工具。

**方式 B：配置 Worker URL**：在 Dubhe Agent 浏览器控制台执行：

```js
localStorage.setItem('dubhe-relay', 'https://<worker>.<account>.workers.dev');
location.reload();
```

如果本地 `server.py` 已运行，它仍优先处理单页抓取与 Git；新 Worker 的搜索/爬虫路由会按 health 能力单独探测，不会误打到旧服务的 404。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 版本与 `fetch/search/crawl` capabilities |
| GET | `/api/fetch?url=...&mode=text\|raw&max=...` | SSRF 护栏后的单页抓取；最大 4 MB |
| GET | `/api/search?q=...&limit=...` | SearXNG（配置时）优先；不可用则 DuckDuckGo HTML 回退；最多 10 条、搜索响应最多 600 KB |
| GET | `/api/crawl?url=...&max_pages=...&max_depth=...&max_bytes=...&max_chars=...` | 同源 BFS 爬取；默认 3 页/深度 1，硬上限 5 页/深度 2；每页最多 800 KB 输入、16,000 字正文 |

Search 响应包含 provider、fallback/warning、标题、URL、摘要和来源。Crawl 响应按页返回标题、描述、正文、深度、截断状态及失败项。Crawler 只跟随同源 HTTP(S) 文本链接，跳过常见二进制扩展；**不执行 JavaScript、不渲染浏览器、不遵循 robots.txt、不处理登录态，也不是通用全网爬虫**。

## 独立 curl / HTTP 工具（需重新部署并配置）

`curl` 是结构化 HTTP 工具，不执行 curl 命令或 shell。Worker 中 `/api/curl` **默认关闭**；为防止公开中继变成无验证的通用请求代理，必须同时在 Worker 配置 `CURL_ENABLED=true`、`TURNSTILE_SITE_KEY` 和 Secret `TURNSTILE_SECRET`。配置并重新部署仓库内 `relay/worker.js`；`worker-dashboard.js` 不支持此接口。

例如在 Cloudflare Dashboard 的 Worker → Settings → Variables and Secrets 中设置：

- 变量 `CURL_ENABLED`：`true`。
- 变量 `TURNSTILE_SITE_KEY`：自己的 Turnstile 站点 Site Key（公开值）；在该 widget 的 Hostname Management 添加**加载应用页面的域名**（例如 `imfufuu.github.io`、自定义站点域名，以及本地使用时的 `localhost` / `127.0.0.1`），而不只是 Worker 的 `relay.dubhe-agent.workers.dev`。110200 表示当前网页 hostname 未获授权，修改需在 Cloudflare 控制台完成。
- Secret `TURNSTILE_SECRET`：同一站点的 Secret Key。不要写进仓库或聊天。

或者用 Wrangler 的 `secret put` 管理 Secret，再使用 `wrangler.toml` 的 `[vars]` 或部署参数提供两个变量。部署时保留已有的其他环境变量，例如 `SEARXNG_URL`。部署完成后检查 `/api/health`：当 `CURL_ENABLED=true` 时会出现 `"curl"`；这只是能力声明，实际调用仍要求 Turnstile 配置完整，否则 `/api/curl` 返回 503。在应用中配置这个 Worker 的地址、打开「联网」并刷新或重探；每次请求都必须人工确认，Turnstile 首次访问时也可能要求验证。默认本地 `server.py` 不提供此接口，但前端会另行探测配置的 Worker。

支持 GET、HEAD、POST、PUT、PATCH、DELETE，非敏感自定义头及 UTF-8 文本请求体。请求 JSON 最多 128 KiB，响应文本最多 256 KiB，上游超时 25 秒；HTTP 4xx/5xx 状态和文本保留，不自动重试、不自动跟随重定向。识别为二进制的响应不会放入文本，请用 `download_file` 下载公开文件。并非完整 curl：不支持 shell 命令、文件上传、内网、Cookie 或认证头；需要带凭据的私有 API 当前不可用。参数、响应会经过 Worker 和目标服务器，并可能保存进对话；不要在 URL、请求体或头中放密码、Token 或其他敏感信息。Worker 拒绝常见认证头，但无法识别所有形式的秘密。

Worker 对 URL 做字面私网检查，不自动跟随重定向；Cloudflare Workers 不能通用解析 DNS，不能保证防住所有私有 DNS 或 DNS 重绑定。Turnstile 是防滥用措施，不是私密认证；公开部署还应对 `/api/curl` 配置 WAF/Rate Limiting。写请求超时后目标可能已经执行，应先核验状态，不要盲目重试。

## 可选防人机（Cloudflare Turnstile）

公开部署的中继可以开启防人机，防止脚本批量消耗搜索、抓取与文件拉取额度。默认关闭，**只有同时配置两项才生效**：

```bash
cd relay
wrangler secret put TURNSTILE_SECRET        # Turnstile 站点的 Secret Key（服务端，不要放进仓库）
wrangler deploy --var TURNSTILE_SITE_KEY:0x4AAAA...   # Site Key（公开，可写进 wrangler.toml 的 [vars]）
```

启用后：

- `/api/search`、`/api/crawl`、`/api/file`、`/api/fetch` 在缺少有效通行证时返回 `403`，并带 `challenge: "turnstile"`。
- 应用端会自动弹出 Turnstile 验证框；通过后 Worker 签发 30 分钟的 HMAC 通行证（`x-dubhe-human` 头），期间无需再次验证。
- `/api/health`、`/api/human/config` 不受影响；`/api/human/verify`（POST）负责校验令牌。
- 通行证用 `TURNSTILE_SECRET` 做 HMAC 签名，密钥轮换后旧通行证自动失效。

未配置两项密钥时，行为与此前完全相同。

## 可选 SearXNG

无需部署自带搜索索引。若已有启用 JSON 格式的 SearXNG 实例，在 Cloudflare Worker 的 Settings → Variables 中设置 `SEARXNG_URL`（HTTPS 基址，例如 `https://search.example.org`）。Worker 会请求 `/search?q=…&format=json&language=all`；实例必须允许 JSON 输出。未配置、超时、格式错误或无有效结果时回退 DuckDuckGo HTML，并把降级原因写进响应。搜索词会发送给所选上游搜索服务；不要提交密码、密钥或个人敏感信息作为查询。

## 安全与公开部署

- URL 仅允许 HTTP(S)，拒绝用户信息、字面私网/环回/链路本地/保留 IP 和常见内部主机名；重定向逐跳校验。Cloudflare Worker 没有通用 DNS 解析 API，**不能宣称防住所有 DNS 重绑定/私有 DNS 解析**。
- Crawl 额外要求每次重定向保持与起始页相同 origin；每页、页数、深度、响应字节数、返回字符数和上游超时均有限制。
- CORS 为 `*`，Worker 本身没有鉴权。对公开部署，建议在 Cloudflare WAF/Rate Limiting 中为 `/api/search`、`/api/crawl`、`/api/fetch` 设请求限额；不要把它当成私密网络代理。
- 搜索结果和网页正文是不可信外部输入，模型提示词会要求将其视为资料而非指令；仍应在回答中核对原始 URL。

## 测试

```bash
cd ..
npm run test:worker
```

测试使用 mock fetch，不会实际请求外网。