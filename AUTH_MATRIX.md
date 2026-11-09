# 鉴权矩阵与安全边界（2026-11-08 全局检查）

本文是「给整个项目所有必要的鉴权」的落地清单：列出本项目每一处**能造成副作用、消耗额度或读取本机数据**的入口、它现在靠什么鉴权、还缺什么，以及如何启用。它不是渗透测试报告；静态站点的根本限制写在第 1 节，请先读。

## 1. 先说清楚一个根本限制

应用主体是 **GitHub Pages 上的纯静态前端**，没有自己的服务端会话。任何写进前端 JS、仓库文件或 localStorage 的「秘密」，访问者都能从 DevTools / 源码 / 网络面板读到。因此：

- **前端携带的网关令牌不是多用户身份认证**，它只是「私有部署时，部署者把令牌分发给自己的浏览器」，用来挡住扫描器和匿名滥用。
- 真正的多用户隔离只能靠 **Cloudflare Access**、WAF、速率限制，或一个持有凭据的自建后端（每位用户自己的 API Key）。
- 本项目所有「用户确认」「管理员别名」「审核策略」都是**客户端行为约束**，用于防误操作与提示注入，不能抵抗刻意修改前端代码的访问者；它们保护的是本机数据与用户注意力，不是服务端资源。

## 2. 逐层矩阵

| 入口 / 资产 | 现在的鉴权与保护 | 状态 | 剩余风险 / 建议 |
|---|---|---|---|
| 静态页面 `app.html` / Pages | CSP（`default-src 'self'`、内联脚本 sha256 白名单、`connect-src` 域名白名单、`frame-ancestors 'none'`、`object-src 'none'`）；Service Worker 资源校验；无服务端会话 | 已具备 | 静态页无身份；不要把任何长期密钥打进包里。CSP 仍允许 jsdelivr / challenges.cloudflare.com，可按需收紧 |
| **Workers AI 网关** `workers-ai/worker.js` | 新增可选 `GATEWAY_TOKEN`（Wrangler **secret**）：除 `OPTIONS` 与 `GET /health` 外，所有 `/v1/*` 需 `Authorization: Bearer …` 或 `X-Dubhe-Gateway-Token: …`，失败 401；定长比较；响应不回显令牌。可选 `ALLOWED_ORIGINS` 白名单，命中回显 Origin + `Vary`，否则 403；预检明确放行两个鉴权头。上游错误继续脱敏 | **本次新增** | 未配置 secret 时**保持公开**（兼容既有部署）。生产必须配置，并叠加 Cloudflare Access / WAF 速率限制 / 账单告警 |
| 网关令牌客户端 `js/gateway-auth.js` + 设置页 | 按网关隔离存 `localStorage`；**不写入 `store.state`**，会话导出 / 分享 / 快照都不携带；`js/api.js` 仅当请求尚无 `Authorization` / `x-api-key` / `x-goog-api-key` 时注入，绝不覆盖用户 API Key；长度上限 512；清除按钮 | **本次新增** | 同源 XSS 可读到令牌；令牌无过期/轮换。建议换成短期票据或后端代理 |
| 用户 API Key（各官方/自定义网关） | 按网关独立保存，仅存浏览器；第一方网关直连失败**不回退**到 TeamoRouter，避免 Key 泄露到第三方；CSP `connect-src` 限定域名 | 已具备 | 浏览器持有明文 Key 是静态应用的固有取舍；建议用户用额度受限的 Key |
| `js/adminkey.js` 管理员别名 | 客户端封存别名，仅用于 UI 便捷入口 | 已具备（非安全边界） | 不是权限系统，不要用它保护服务端操作；文档已明确 |
| 搜索中继 `relay/worker.js` | 可选 Cloudflare Turnstile 人机校验 + HMAC 签名 human pass；`/api/curl` 默认关闭且 opt-in；敏感请求头黑名单；不代理任意内网地址 | 已具备 | 若启用 `/api/curl`，建议再加调用频率限制与目标域名白名单 |
| 本机伴随服务 `server.py` | 每进程随机 `LOCAL_TOKEN` + `X-Dubhe-Local-Token`；Host / DNS-rebinding 检查；Origin 校验；`Sec-Fetch-Site` 跨站拒绝；只监听本机 | 已具备 | 令牌每次启动变化，前端需重新读取；建议补速率限制与结构化审计日志 |
| 危险 / 本机工具执行 | 逐次用户确认、等待期间重验风险与授权、一次性确认票据、幂等键、预算与恢复机制 | 已具备 | 属客户端治理；对提示注入仍建议保持「高风险操作默认拒绝」 |
| Agent 自注册工具 `js/tool-registry.js` | 注册/读取/更新/启停/删除/调用均需一次性用户确认票据；强制 `custom_` 前缀；handler 为声明式白名单，不执行模型代码 | 已具备 | 建议把确认票据与工具清单的哈希绑定，防 TOCTOU |
| 项目模式删除 / 关闭 | 删除、脏文件关闭、beforeunload 均有用户确认；本次修复删除选中目录后预览残留（见下） | 已具备 | 状态安全修复，非鉴权；建议补回收站而非不可逆删除 |
| 会话导出 / 离线分享 / 快照 | 导出只序列化 `store.state`；网关令牌刻意排除；离线 HTML 静态预览禁用脚本与外网；CSP 哈希与应用内联脚本同步 | 已具备 + 本次复核 | 用户若在正文里粘贴密钥，导出仍会带上；导出前建议做一次敏感串扫描 |
| GitHub Actions / 部署 | `CLOUDFLARE_API_TOKEN` 为仓库 secret，`CLOUDFLARE_ACCOUNT_ID` 为变量，仓库内无明文；Workers AI 部署为手动 workflow_dispatch；`deploy --keep-vars` 保留已写入的 Worker secret | 已具备 | 建议把 API Token 权限收窄到「仅该账号的 Workers 脚本编辑」，并定期轮换 |
| 静态资源 / 西夏文字体 | 本次改为**仓库自托管完整 TTF 首选**，`catbox` 临时链接降为第二回退；离线分享内嵌本地 woff2 | **本次修改** | 不再依赖第三方主机的可用性；但 9.75 MB TTF 建议后续转 WOFF2 子集以减小首包 |
| 敏感话题审核 | 本地多语言启发式 + 抗规避 + 3 轮重复验证（1710 次，0 漏拦 / 0 误伤） | 已具备 | 属内容策略而非鉴权；关闭审核不改变上游服务政策 |

## 3. 本次修复的三处具体缺口

1. **Workers AI 网关此前完全没有鉴权**：`CORS *` 且只放行 `Content-Type`，任何人拿到 URL 都能消耗账号 Neurons。现在支持 `GATEWAY_TOKEN` + `ALLOWED_ORIGINS`，并把鉴权头加入 CORS 允许列表；`/health` 明确报告是否启用鉴权。
2. **客户端无法为无 API Key 的自建网关提供凭据**：`noKey` 网关（Cloudflare）此前 `authHeaders()` 直接返回 `{}`。现在设置页可填令牌，`js/api.js` 统一注入但不覆盖任何已有凭据。
3. **删除选中目录后预览残留**（状态安全）：`showEmpty()` 原先只清 `textarea.value` / 行号，底层 `hlCode.innerHTML`、`codeWrap.hl-on`、媒体预览 DOM 与缓存仍在，旧文件内容叠在空状态背景上。现由 `js/project-preview-cleanup.js` 集中清空全部叠层，并在 `removePath()` 里用 `isActiveUnderPath()` 复位 `state.active`；`tests/project-preview-cleanup.test.mjs` 有 jsdom 集成回归。

## 4. 私有部署启用步骤

```sh
# 1) 生成并写入 Worker secret（不要提交到仓库）
cd workers-ai
openssl rand -hex 32            # 复制输出
npx wrangler secret put GATEWAY_TOKEN
npx wrangler secret put ALLOWED_ORIGINS   # 例如 https://imfufuu.github.io

# 2) 部署（GitHub Actions 手动运行 Deploy Workers AI gateway 亦可，--keep-vars 保留 secret）
npx wrangler deploy

# 3) 网页端：设置 → 选择 Cloudflare Workers AI → 填 Worker HTTPS URL → 「网关访问令牌（可选）」填同一个令牌
# 4) 验证
curl -i https://<worker>/health                     # auth_required: true
curl -i https://<worker>/v1/models                 # 401
curl -i -H "Authorization: Bearer <令牌>" https://<worker>/v1/models   # 200
```

**不要**把令牌写进 `app.html`、`js/*.js`、`wrangler.toml` 或任何会被 Pages 发布的文件。`ALLOWED_ORIGINS` 只是缓解（Origin 可被非浏览器客户端伪造），不能代替令牌。

## 5. 检查清单（每次发布前）

- `node tools/run-tests.mjs`（全量回归，CI 中每个测试文件有独立 step）
- `node scripts/i18n-audit.mjs --json` 应返回 `[]`
- `node --check` 覆盖 Worker、新增/修改的 `js/*.js`
- `curl -i <worker>/health` 检查 `auth_required` / `origin_restricted`
- 确认 Pages 静态产物里没有 `GATEWAY_TOKEN`、`CLOUDFLARE_API_TOKEN` 等明文
- 检查 `app.html` 内联脚本 sha256 与 CSP、`js/offline-bootstrap.js` 里的离线 CSP 三者一致（有测试断言）

## 6. 仍未解决 / 下一步优先级

1. **多用户场景**：上 Cloudflare Access（或把推理改走持有凭据的后端），前端令牌只能防匿名滥用。
2. **滥用防护**：WAF 速率限制、每 IP/每令牌配额、账单告警；当前 Worker 没有应用侧每日额度。
3. **令牌生命周期**：改用短期票据 / 自动轮换；把令牌与设备绑定；提供一键吊销。
4. **审计**：把 401/403/502 与工具确认事件写入结构化日志（脱敏），便于发现滥用。
5. **CSP 收紧**：移除不必要的 CDN 白名单，考虑 Trusted Types。
6. **资源体积**：把 9.75 MB 完整 TTF 转 WOFF2 子集，降低弱网启动时间（120 秒阈值只是兜底，不是解决方案）。
