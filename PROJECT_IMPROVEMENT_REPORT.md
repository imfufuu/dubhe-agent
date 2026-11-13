# 全局大检查与改进建议（2026-11-08，12 项任务收尾）

## 1. 本次全局检查结果

| 检查项 | 命令 / 方法 | 结果 |
|---|---|---|
| 全量回归 | `node tools/run-tests.mjs` | **1652 项 / 88 个文件真跑 / 0 失败**（含 Python 侧 89 项） |
| 新增回归 | `tests/phase-b2.test.mjs`、`tests/tuner-ui.test.mjs` 重写 | 5 + 5 项全通过；修回 `agent-runtime` / `agent` / `document-skills` / `offline-model` 的旧断言 |
| 语法 | `node --check` 覆盖 Worker + 全部新增/修改 `js/*.js` + 新测试 | 全部通过 |
| 服务端语法 | `python -m py_compile server.py`（run-tests 内置） | 通过 |
| 国际化审计 | `node scripts/i18n-audit.mjs --json` | `[]`（新增静态中文全部登记） |
| CI 一致性 | `tests/agent.test.mjs` 断言 ci.yml 的 step 与 `tests/*.mjs` 一一对应 | 通过（82 / 82） |
| CSP 同步 | `app.html` 内联启动脚本 sha256 与 CSP、`js/offline-bootstrap.js` 离线 CSP | 三者一致（有测试断言） |
| 静态资源 | `parseFontFaces()` 全部分片本地可读；完整 TTF 9,751,032 字节 / TrueType magic | 通过 |
| 秘密扫描 | `git grep` 检索 `ghp_*` / `github_pat_*` / 明文 token 赋值 | 0 命中 |
| 文档一致性 | CHANGELOG / README / docs.html / workers-ai README / AUTH_MATRIX / SELF_REGISTERED_TOOLS 交叉引用 | 已同步 |

**未做**：真实浏览器端到端（当前是 jsdom / 静态断言）、Cloudflare 云端生图与识图推理、iOS/Android 真机、多用户并发压测、>2 GiB GGUF 与 >16 MB 附件的真实浏览器上传实测（只验证上限常量与代码路径）。这些是下一阶段重点。

## 2. 12 项任务落地情况

| # | 任务 | 关键改动 |
|---|---|---|
| 1 | TTF 自托管 | 仓库内 `tangut-yinchuan.ttf` 提升为 `@font-face` 首选源，catbox 降为第二回退 |
| 2 | 项目模式删除预览残留 | `js/project-preview-cleanup.js` 清空高亮/行号/标记/媒体 DOM/缓存；`removePath()` 复位 `state.active` |
| 3 | 全项目鉴权 | Workers AI 网关 `GATEWAY_TOKEN` + `ALLOWED_ORIGINS`；客户端按网关令牌不进导出；`AUTH_MATRIX.md` 14 类入口矩阵 |
| 4 | 加载屏 120s | `BOOT_TIMEOUT_MS=120000`，注释/文案/CSP 哈希同步 |
| 5 | 删除会话后网关/模型 BUG | **根因**：`state.js` 的 `validGatewayIds` 硬编码漏了 `cloudflare` → 改取 `GATEWAYS`；`deleteSession()` 先 `commit()`；UI 删除后刷新模型/网关 |
| 6 | Cloudflare 标签仅「流行 / 低价」 | `cfModelTags()`（人工精选 + Neurons 阈值），撤下原厂/AGENT/CHAT/FREE badge，能力信息移到 tooltip；`/v1/models.tags` 下发 |
| 7 | 本地模型 4096 报错 | 不再下发 `max_tokens`，由 wllama 按 `n_ctx` 自行决定 |
| 8 | "Searched for" 空标题/错误菜单名 | 组标题补真实搜索词（无词时 "Searched the web"），行名改 `Web search` / `Searching` |
| 9 | Worker AI 用量不完整 | 最后一个 SSE chunk 携带规范化 `usage`（prompt/completion/total，字段名兼容，缺省时估算并标 `estimated`） |
| 10 | 调节器 v2 | 独立 modal 页面 + 平滑展开；删温度自定义滑杆、删 Agent 思考等级；对话模式**不上传任何提示词**（`bareChat` 双保险）；工具管理迁到设置页；确认卡显示在输出中（执行内核同款）并修复「同意后返回拒绝」票据 BUG |
| 11 | 大文件 | 单个 GGUF 16 GiB；附件/音频/视频/中继下载 128 MB；提示词、UI、工具描述同步 |
| 12 | 全局检查 + 改进建议 | 即本报告 |

## 3. 项目该如何改进（按优先级，具体可执行）

### P0 · 安全与成本（仍未收口）

1. **把公开 Worker 真正关起来**：`GATEWAY_TOKEN` 是可选 secret，线上为兼容保持公开。生产应配置 Wrangler secret + `ALLOWED_ORIGINS`，并叠加 **Cloudflare Access**、WAF 速率限制（每 IP 每分钟 20 次）与账单/额度告警。静态 Pages 前端无法保守秘密，**共享 Bearer 只能防匿名滥用，不是身份认证**。
2. **多用户改用短期票据或后端代理**：登录后换发 5–15 分钟票据（绑定 Origin / 设备），支持一键吊销与轮换；当前 localStorage 长期令牌无法抵御同源 XSS。
3. **结构化审计日志**（脱敏）：记录 401/403/429/502、模型、耗时、匿名化来源；现在滥用难以发现。
4. **对话模式裸聊的可控性**：现在不下发任何系统提示词，模型行为完全由用户历史与上游默认策略决定。建议为该模式保留一条**极简、可由用户编辑**的风格提示（默认关闭），并在 UI 明确提示「无系统提示词，输出可能不受应用规则约束」。

### P0 · 首包与体验

5. **把 9.75 MB 完整 TTF 转 WOFF2 子集**（fontTools + brotli，预计 < 1 MB），保留完整 TTF 按需下载。**120 秒阈值只是兜底，不是解决方案**。
6. **大文件真实压测**：16 GiB GGUF 受浏览器 OPFS 配额与内存限制，128 MB 附件抽帧/base64 在手机上可能卡数秒；建议补 Chrome/Safari 实测与分块读取、进度可取消、失败回滚。
7. **字体加载失败可见提示**：失败时提示「西夏文可能显示方框」，而不是静默回退旧子集。

### P1 · 工程质量

8. **真实浏览器 E2E**：jsdom 的 309 项不等于真机。建议 Playwright 跑 4 条黄金路径（发消息 / Agent 工具循环 / 项目模式删除目录 / 调节器→确认卡→工具生效），Chromium + WebKit，并把 CSP 报错、网络失败纳入断言。
9. **CI 提速与分层**：86 个测试文件串行约 3 分钟，按目录分片并行预计降到 ~50s；云端推理探测只在手动 workflow 跑。
10. **Worker 可观测性**：把 502 脱敏错误分类（参数 / 限流 / 额度 / 模型不可用）输出为指标；对「chat-only 带 tools 自动降级」计数；`usage.estimated` 也应单独计数，避免估算值被当账单。
11. **云端真实验证补缺口**：图像生成 / 识图 / 决策接口仍无真实云端推理验证；补一组低额度手动冒烟脚本。
12. **项目模式回收站 / 撤销删除**：目前删除不可逆（只有脏文件确认），本次只修了视觉残留；建议软删除 + 30 天恢复。
13. **编辑器大文件性能**：语法高亮 3000 行上限；超大文件建议虚拟滚动 + Web Worker 分词；`mediaView` 的 data URL 缓存加容量上限。
14. **导出前敏感串扫描**：网关令牌已排除，但用户可能把 API Key 粘在正文里；导出/分享前做模式扫描并二次确认。

### P2 · 维护成本

15. **收紧 CSP 与供应链**：移除不必要的 CDN 白名单或加 SRI 固定版本，考虑 Trusted Types。
16. **单一版本来源**：`build.json` / `APP_VERSION` / CHANGELOG / docs.html 手工同步，建议由 `version.json` 生成并加 CI 断言。
17. **i18n 维护**：9 种语言包要求「英文键全覆盖」，新增一条文案要改 8 个文件；建议引入提取脚本 + 未翻译标记。
18. **文档与代码同源**：模型目录、价目表、工具清单散落在多个 JS 与 README 表格，建议 JSON 单一来源生成文档表格与测试基线。本次「16MB → 128MB」需要改十几处文案，正是这一问题的体现。
19. **可访问性与窄屏**：补键盘导航（项目模式树、调节器 modal、确认卡）、读屏标签真机验证。

## 4. 一句话结论

功能面与回归覆盖已经扎实（1652 项零失败），**最值得投入的仍是「公开 Workers AI 网关的访问控制 + 可观测性」与「9.75 MB 字体 WOFF2 化」**；其次是为对话模式裸聊、16 GiB/128 MB 大文件补真实浏览器验证，避免「代码支持」与「真机可用」之间出现落差。
