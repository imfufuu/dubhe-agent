# 提示词限制条款「作用域 / 反例 / 禁止外推 / 先实测」落地报告（2026-11-09）

## 1. 问题

原中文核心提示词写的是「**Worker不能写internal/和.git/**」（英文对应 `internal/ and .git/ are protected from worker writes`）。这是一句含糊的否定句：没有点明"谁不能写"，Agent 容易把它外推成「`internal/` 是全局受保护目录」，进而拒绝用 `write_file` 写 `internal/`、或对未列出的工具/路径下同样的「禁止」判断。

## 2. 先实测（对应建议 3，也作为回归测试）

按「写探针文件 → 验证 → 清理」做了最小实测，结论写进提示词前先确认：

| 探针 | 结果 |
|---|---|
| `executeTool('write_file', {path:'internal/scope-probe.txt', content:'probe-ok'})` | 返回「已写入 internal/scope-probe.txt（8 字符）」；`fs.read()` 读回 `probe-ok`；随后 `fs.remove()` 清理成功 |
| `sanitizeWorkerFiles({'internal/keep.txt':'original','files/a.txt':'a'}, {'internal/keep.txt':'HACKED','internal/new.txt':'x','.git/config':'y','files/a.txt':'b'})` | `internal/keep.txt` 保留 `original`；`internal/new.txt`、`.git/config` 被拒；`files/a.txt` 正常同步为 `b`；`rejected` 三条 `reason:'protected'` |

即：**限制只存在于 Worker 回写通道，`write_file` 不受限**。反例是实测成立的，不是推测。

## 3. 三条建议的落地

| 建议 | 落地 |
|---|---|
| ① 作用域 + 反例 | 中英核心提示词改为：`execute_javascript` 的 `files` 字典 / `execute_python` 的 `FILES` 字典（两个沙箱 Worker 回写通道）不能写 `internal/` 与 `.git/`；**此限制仅作用于上述通道**；**反例：`write_file` 工具不受此限制，可写 `internal/`（除非另有明确限制）** |
| ② 元规则（防外推） | 在工具使用规则区各加一条：能力限制按字面作用域理解、禁止外推；每条限制只约束明确写出的对象与通道，未写出的默认允许；下「受保护/禁止/不可写/只读」这类全局判断前必须实测确认过该对象，不得套用到未列出的工具或路径 |
| ③ 边界存疑先实测 | 各加一条：有疑问时先做最小代价实测（写探针文件 → 验证 → 清理），不依据描述推断后下结论；禁止用全局性词汇描述未经实测的限制范围 |

中英两套核心提示词（`js/prompt-core.js`，实际注入请求）都加了；`js/config.js` 的参考系统提示词、`js/tools.js` 的两个工具描述、`js/ui-strings.js` 的设置页说明、`js/sandbox.js` 的实现注释、`assets/knowledge/index.json` 的历史参考材料也同步，避免 Agent 从其它通道读到旧的全局句。

## 4. 改动文件

- `js/prompt-core.js`：中英边界句改写 + 4 条规则（作用域/反例/禁止外推/先实测）。
- `js/config.js`、`js/tools.js`、`js/ui-strings.js`、`js/sandbox.js`、`assets/knowledge/index.json`：同步作用域表述；知识库索引经 `node tools/build-knowledge-index.mjs --check` 校验一致。
- `tests/prompt-boundaries.test.mjs`：新增回归，含上述实测探针与全部文案断言。
- `CHANGELOG.md`、`README.md`：记录。

## 5. 验证

- `node --test tests/prompt-boundaries.test.mjs`：实测探针 + 中英核心提示词 + 工具描述/参考提示词/设置页/注释/知识库断言，全通过。
- `node tools/build-knowledge-index.mjs --check` → `Knowledge index matches the Markdown sources.`
- `node scripts/i18n-audit.mjs --json` → `[]`。
- 全量 `node tools/run-tests.mjs` → **1648 项 / 87 个文件 / 0 失败**（新增 `tests/prompt-boundaries.test.mjs` 4 项）。

## 6. 边界

本轮实测在 Node 侧调用 `sanitizeWorkerFiles` 与 `executeTool`，未在真实浏览器 Worker（Pyodide / WASM）里跑；但保护逻辑正是 `sanitizeWorkerFiles` 这一处，工具侧路径由 `createFS().write` 决定，两者都已覆盖。历史 KB 只同步了这一句限制表述，其余旧参考内容仍以「当前运行时规则优先」为准。
