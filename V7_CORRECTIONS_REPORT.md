# 2026-11-14 四项纠偏与回归报告

> 对应反馈：① 不要把设计导向页的文案抄进导航页；② 思考按钮不要改成「思考打开/关闭」，图标必须保留；③ 本地模型不显示计价，但要统计上传/输出 token；④ 本地模型第二次提问报错。

## ① 导航页：删掉宣言，重做「最前面的地方」

**撤销**：`index.html` 中整段 `#design-manifesto`（六条设计准则卡片及配套 CSS）已删除。设计导向页只作为设计语言来源，不再把它的正文搬进导航页；`grep design-manifesto index.html` 结果为 0。

**实际改动落在首屏**：重写 `#hero` 的结构与 `css/home.css` 的排版层，而不是新增说明段落。

- 版式：四列 1px 网格标记 `.hero-grid-mark`，顶部/底部等宽规格线 `.hero-spec` / `.hero-foot-spec`，`TYPE SCALE / 10XL → XS`、`GRID 8PT`、`STROKE 1PX` 作为排印标注，不变成宣言式文案。
- 字体：标题改用 `--display` 衬线族，`clamp(56px, 9vw, 132px)`、`line-height:.98`、`letter-spacing:-.055em`；破格偏移 `<em>` 与一条 `--hi` 下划线用 `cubic-bezier(.2,1.3,.3,1)` 展开。
- 动效：CTA 与能力卡片改为小幅弹簧位移（`translateY(-3px/-4px)` + 阴影），遵守 `prefers-reduced-motion` 的既有降级；不再堆装饰色。
- 细节：`.run-corner` 给右侧实时预览加 1px 规格角标；导航、章节标题、卡片边框统一为 1px 克制定色；图标仍为线性 SVG。
- 响应式：`max-width:900px` 时首屏收成单列、取消右侧预览的位移，避免大字号溢出。

设计准则的文字只保留在中英系统提示词与 `assets/knowledge/dubhe-guide.*.md` 知识库里，供 Agent 生成页面时参考，不出现在导航页正文。

## ② 思考按钮：SVG 图标恢复，分级菜单语义不变

- 删除 `js/ui-chat-mode.js` 中 `thinkingToggle.textContent = '思考打开/关闭'` 的赋值；`app.html` 的 `#thinking-toggle` 仍是「线性脑形 SVG + 思考」，`textContent` 不再被运行时覆盖。
- 点击路由保持两种语境：Agent 模式打开分级菜单（含 Off / Mini…Ultra 彩蛋），Chat 模式调用 `toggleChatThinking()` 直接翻转 `settings.thinking` 并同步 `aria-pressed`。
- `chatModeThinkingTitle()` 只写 `title` / 无障碍提示，不改按钮可见文字；`syncThinking()` 仍负责 `on` / `ultra` 状态类。
- 新增回归：禁止 `js/ui-chat-mode.js` 再出现 `thinkingToggle.textContent`，并断言首屏新结构存在。

## ③ 本地 GGUF：零价目，但上传/输出 token 照常入账

**计价层**：`js/pricing.js` 的 `getModelPricing()` 对离线模型返回 `{ mode:'local', unpriced:true, input:0, output:0 }`；`priceBadgeFor()` 对 `mode==='local'` 直接返回空字符串，模型卡片、价目表、图表不再显示 `$0.00` 或 `/M` 单价。`estimateChatCost()` 也新增 `mode==='local'` 分支，保持 `costUsd:0`、`unpriced:true`，但把 `inputTokens` / `outputTokens` 原样带入成本对象，供统计视图使用。

**统计层**：离线 GGUF 没有网关 `usage` 事件，因此 `js/api.js` 在本地流结束后主动发出与在线路径同构的 `usage` 事件：上传/输入 token 取 `estimateTokens(localMessages)`，输出 token 取流式正文字数按 `ceil(chars/2)` 保守折算（至少 1）。上层 token/费用面板无需区分来源，只是金额恒为 0。

**上下文估算优化**：`js/offline-context.js` 不再用「字符数 / 4」一刀切，改为 CJK 每字 1 token、ASCII 每 4 字符 1 token、每条消息额外 4 token 的保守估算；`OFFLINE_INPUT_CAP = 7168`（`n_ctx 8192 − 输出预留 1024`），`fitMessagesToContext()` 在预算内保留 system 与最近轮次。这样中文、代码、第二轮累积历史不会被低估后撑爆 `n_ctx`。

## ④ 第二次提问报错：模型实例复用 + 加载失败清理

**两个根因**：

1. `wllama` 的 `isModelLoaded()` 在上一轮 `createChatCompletion()` 之后可能短暂返回 `false`；旧逻辑据此 `exit() → loadModel()`，而旧 proxy 尚未释放，触发 `Module is already initialized`。
2. 历史消息按 `/4` 低估 token，第二轮裁剪不足，出现 `request exceeds the available context size`。

**架构改动**：`js/offline-model.js` 维护模块级 `loadedModelKey`，以 `metadata.fileName / file.name / size+importedAt` 作为模型指纹。只有「模型文件真的换了」或「`isModelLoaded()===false` 且 `engine.proxy` 已空」才重新 `exit()+loadModel()`；同一模型第二轮直接复用现有 Wllama proxy。`loadModel()` 失败时清空 `loadedModelKey` 并尽力 `exit()`，避免半初始化实例污染下一轮。`js/api.js` 在调用 `streamOfflineModel()` 前已经用 `fitMessagesToContext()` 裁剪到 7168 输入上限。

新增 `tests/offline-model.test.mjs` 两项真实回归：模拟 `isModelLoaded()` 第二轮误报 `false`，断言两次提问只调用一次 `loadModel()`；另外验证 CJK 估算不低于 1 字 1 token、40 轮长中文历史裁剪后仍低于 `OFFLINE_INPUT_CAP` 且保留 system。

## 同步修复的构建/工程问题

- `tools/build-knowledge-index.mjs` 之前按 4 个语言条目循环，每次都把全部非 rendering 记录追加一遍，导致 `assets/knowledge/index.json` 每跑一次就翻 4 倍且 `--check` 永远失败。现在 runtime 记录只保留一次，再追加 4 份 Markdown 派生记录；索引稳定为 20 条，`--check` 通过。
- `.github/workflows/ci.yml` 从快照恢复后漏掉新增测试 step；按 `tests/*.mjs` 排序重建 87 个 step，保留 `if: ${{ !cancelled() }}`、`npm ci`、语法检查、Python 护栏与计数汇总。
- `js/ui.js` 压回 2995 行 / 181 KB：移除 `gptSummaryOnly ? THINKING_LABEL : THINKING_LABEL` 冗余三元，并把启动屏收尾块压缩为单分支；行为不变，继续守住 3000 行 / 184 KB 预算。
- 更新 `tests/v6-ui-updates.test.mjs` 的过期断言：不再要求宣言段落，改查首屏重构与四项纠偏的静态契约；`CHANGELOG.md` 与 `V6_UI_REPORT.md` 中「导航页设计准则宣言」的旧表述一并更正。

## 验证结果

| 检查 | 结果 |
|---|---|
| `node tools/run-tests.mjs` 全量回归 | **1668 项 / 91 个文件真跑 / 0 失败** |
| `node scripts/i18n-audit.mjs --json` | `[]`，0 条缺失 |
| `node tools/build-knowledge-index.mjs --check` | 索引与双语 Markdown 一致 |
| `node --check` 覆盖 `js/*.js relay/*.js sw.js tools/*.mjs` | 全部通过 |
| `node --test tests/offline-model.test.mjs tests/v6-ui-updates.test.mjs` | 32/32 通过 |
| 预览 HTTP `GET /`、`/css/home.css` 及关键静态资源 | 200；响应 HTML 的 `frame-ancestors *` 仅用于预览，仓库 `index.html` 仍为 `'none'` |
| `priceBadgeFor('local/gguf')` | `''` |
| `grep design-manifesto index.html` | 0 命中 |

预览服务仍以 `Cache-Control: no-store` 提供当前文件，刷新即可看到首屏重排；无需重启。
