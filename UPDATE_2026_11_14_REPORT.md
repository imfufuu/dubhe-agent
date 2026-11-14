# 2026-11-14 增补：Turnstile 可用性核查、任务计时暂停、漏翻文本深挖

> 本轮三件事：① 部署前核查 Cloudflare 防人机验证（报错 300010）到底哪一层坏了；② 用户确认执行内核警告、完成人机验证时任务计时暂停；③ 继续深挖漏翻文本并补上防回归工具。

## 一、Cloudflare Turnstile：后端可用，300010 是客户端 widget 建不起来

### 实测证据（本轮现场探测）

| 探测 | 命令/接口 | 结果 | 说明 |
|---|---|---|---|
| 前端脚本可达 | `GET https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` | `302` → `/turnstile/v0/b/f8df4d4a0cd6/api.js`，跟随后返回 JS | 挑战脚本本身没有挂，网络与 CDN 正常 |
| 校验服务可达 | `POST /turnstile/v0/siteverify`（伪造 secret） | `400 {"error-codes":["invalid-input-secret"]}` | 服务在线；错误码能区分「密钥错」与「令牌错」 |
| 中继已启用防人机 | `GET https://relay.dubhe-agent.workers.dev/api/human/config` | `{"required":true,"siteKey":"0x4AAAAAAFzjcb2WK7YnbUYO","verifyPath":"/api/human/verify","ttl_s":1800}` | 部署中的 Worker 已开闸，站点密钥已注入 |
| 受保护接口确实在拦 | `GET /api/fetch?url=…`（无通行证） | `403 {"challenge":"turnstile","siteKey":"0x4AAAAAAFzjcb2WK7YnbUYO"}` | 客户端会因此弹窗 |
| 密钥有效性 | `POST /api/human/verify`（假 token） | `403 {"codes":["invalid-input-response"]}` | 只报「令牌无效」而不是 `invalid-input-secret`：**TURNSTILE_SECRET 有效**，Siteverify 往返通路正常 |
| 中继健康 | `GET /api/health` | `{"ok":true,…"capabilities":["fetch","search","crawl","file","curl"]}` | 中继本体正常 |

**结论**：Turnstile 的服务端链路（脚本分发、Siteverify、密钥、中继闸门）全部可用；`300010` 是 **客户端 widget 初始化失败**（Cloudflare 文档口径：widget could not be created / 通用执行失败），与「密钥无效」不是一回事。本轮环境无 Chromium，无法真机渲染 widget，因此改用「客户端可自愈 + 错误码可解释」的方式修。

### 客户端已修（`js/human-check.js`）

1. **等就绪再 render**：脚本改为 `api.js?render=explicit&onload=__dubheTurnstileReady`，并等待 `turnstile.ready()` 回调；此前可能在 API 尚未就绪时 `render()`，正是 300010 的常见来源。
2. **容器不再是 0×0**：`box.style.minWidth=300px/minHeight=65px`。零尺寸容器同样会让 widget 建不起来。
3. **自动退避重试**：`300xxx/600xxx` 失败先按 `[400ms, 1200ms]` 重画最多两次（隐私扩展拦脚本、瞬时故障多数一次重画即恢复）。
4. **错误码翻译成可照做的原因**（`turnstileErrorHint()`）：
   - `110200` → 点名当前网页域名，要求加入站点密钥的 Hostname Management（只加中继域名不够）；
   - `100xxx` → 站点密钥无效/不完整，核对 `TURNSTILE_SITE_KEY`；
   - `300xxx` → widget 未能初始化：隐私扩展/代理拦 `challenges.cloudflare.com`、脚本被延迟、Cloudflare 瞬时故障 → 重试 / 无痕窗口 / 关闭拦截；
   - `600xxx` → 挑战未通过：网络被判风险 → 换网络或稍后重试；
   - 其它 → 带代码的通用说明。裸数字不再直接丢给用户。
5. **脚本超时与加载失败分开报**：15s 超时说「加载超时」，脚本 error 说「可能被拦截」，两种情况都有「重新验证」按钮。
6. **文案双语化**：对话框标题、提示、状态、按钮全部走 `locale.js`，此前是写死中文。

> 仍需在 Cloudflare 控制台人工确认一项（本环境无 Cloudflare API Token，无法读站点密钥配置）：**Sitekey `0x4AAAAAAFzjcb2WK7YnbUYO` 的 Hostname Management 是否包含 `imfufuu.github.io`（以及自建/预览域名）**。若只加了中继域名，浏览器侧仍会以 110200/300010 失败——现在这两种情况都能在对话框里直接看到原因。

## 二、任务计时暂停：等人不算任务耗时

### 新增 `js/task-clock.js`

可暂停的计时器，支持多原因叠加（`confirm` = 执行内核高风险确认，`human` = 人机验证），提供 `pauseTaskClock/resumeTaskClock/resetTaskClock/taskClockWaitingMs/taskClockMark/taskClockSpan/onTaskClockChange`。纯模块级状态，不依赖 DOM，可单测。

### 接入点

| 位置 | 行为 |
|---|---|
| `js/ui.js` 状态栏 | 进入 busy 时 `resetTaskClock()` 并打点；耗时显示改为 `performance.now() - busySince - (taskClockWaitingMs() - busyWaitMark)`，等待期间读数停住；状态文案在等待人机验证时显示「等待人机验证」，等待确认时保持「等待执行权限确认」 |
| `js/ui.js` 确认卡 | `onConfirmationRequest` → `pauseTaskClock('confirm')`；允许 / 拒绝 / 超时 / 回合结束 → `resumeTaskClock('confirm')`（三处恢复，避免卡死） |
| `js/human-check.js` | 弹出 Turnstile 即 `pauseTaskClock('human')`，成功 / 取消 / 失败 / abort 关闭对话框时 `resumeTaskClock('human')` |
| `js/toolrunner.js` | 工具 `durationMs` 扣除区间内的等待：`Date.now() - t0 - taskClockSpan(waitMark)`，工具芯片与「本轮 / 累计」统计不再把等人时间算进工具耗时 |
| 新一轮 | `setStatus()` 退出 busy 时清空暂停原因，跨轮不遗留 |

## 三、漏翻文本深挖：从「看着像翻了」到「逐条对账」

### 为什么之前没发现

旧审计 `scripts/i18n-audit.mjs` 只扫 `app.html` 与 `ui*.js`（返回值一直是 `[]`）。**`docs.html`、`index.html`、`settings.js`、`api.js`、`pricing.js`、`project-mode.js`、`photo-editor.js`、`quickmap.js`、`human-check.js` 等从未被扫过**，所以一批写死中文长期存在。

### 新增 `tools/i18n-coverage.mjs`

- 扫三个页面（`index.html` / `app.html` / `docs.html`）的中文文本节点与 `title/aria-label/placeholder/alt`；
- 扫所有 `import ... from './locale.js' | './i18n.js'` 的模块，排除模型侧文本（系统提示词、工具描述、子智能体提示、审核词表、任务示例源数据等，它们有 `*_en.js` 平行模块或本就只服务中文模型）；
- 对齐 `js/i18n-packs/*.js`、`ui-catalog.js`、`ui-strings.js` 的既有译文；
- `--check` 只对**界面模块**要求零遗漏（进入 CI），页面缺口用上限锁定，只降不升。

### 本轮修掉的写死中文（共 143 条，界面模块已清零）

| 模块 | 条数 | 例子 |
|---|---|---|
| `ui.js` | 34 | 「思考 Off」「导入失败：…」「已回滚，可点击「撤销回滚」恢复」、trunc-note / web-hint / cancelled-tag 的 HTML 片段 |
| `pricing.js` | 16 | 「本地模型不计价 · 仅统计上传/输出 token」「网关实时报价」「用量不完整」 |
| `photo-editor.js` | 45（模板内 17 文本 + 28 属性） | 「照片编辑」「应用裁剪」「画笔粗细」「向左旋转 90°（Shift+R）」 |
| `settings.js` | 13 | 「探测失败：」「手动添加模型 ID 仅适用于自定义网关」 |
| `api.js` | 12 | 「模型请求已中止」「（余额不足，请前往 TeamoRouter 控制台充值）」 |
| `project-mode.js` | 10 | 右键菜单「新建文件 / 导入文件夹 / 压缩为 ZIP / 解压缩」 |
| `gateway-registry.js` | 6 | 「GLM / 智谱 AI」「无需 API Key（请填写 Worker URL）」 |
| `main.js` | 5 | 「图片审核超时…」「连接瞬断」 |
| `commandsource.js` / `quickmap.js` / `share-document.js` | 5 / 4 / 4 | 源码校验报错、地图缩放 aria、分享样式/字体/地图边界加载失败 |
| `ui-model-picker.js` / `ui-attachments.js` / `ui-files-panel.js` / `ui-scanner.js` / `ui-capability.js` / `ui-popovers.js` / `ui-language.js` | 4/3/2/2/1/1/1 | `/system` 隐藏通道提示、链接拉取报错、摄像头等待、路由启发式说明 |

刻意保留：语言自身名称（中文 / 日本語 / 한국어）按各自语言显示，不算漏翻。

### 仍然存在的缺口（如实记录，已锁定上限）

| 面 | 剩余 | 说明 |
|---|---|---|
| `docs.html` | 371 | 技术文档与价目表正文。四个法律页（协议 / 使用规范 / 服务条款 / 隐私）早已有手写英文平行版本；剩下的是技术说明段落，属**内容翻译**而非界面串，需要成段人工翻译 |
| `index.html` | 9 | 导航页示例区的长文案与 iframe 标题 |
| 其它 | 0 | 界面模块全部清零 |

新增 `tests/i18n-coverage.test.mjs`（界面 0 遗漏 / 页面缺口 ≤ 上限 / 原生语言名不误报 / 旧审计仍为 0）与 `tests/task-clock.test.mjs`（8 项，含接线契约与 Turnstile 错误码语义）。

## 四、验证

| 检查 | 结果 |
|---|---|
| `node tools/run-tests.mjs` | **1680 项 / 93 个文件真跑 / 0 失败** |
| `node scripts/i18n-audit.mjs --json` | `[]` |
| `node tools/i18n-coverage.mjs --check` | 界面模块 0 条写死中文（退出码 0） |
| `node tools/build-knowledge-index.mjs --check` | 与双语 Markdown 一致 |
| `node --check` 全量 js/relay/sw/tools | 通过 |
