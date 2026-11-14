# 漏翻文本对账（2026-11-14）

`node tools/i18n-coverage.mjs`（明细：`--json`；CI 门禁：`--check`）

## 方法与口径

1. **页面层**：`index.html` / `app.html` / `docs.html` 的中文文本节点，以及 `title` / `aria-label` / `placeholder` / `alt`。
2. **模块层**：所有 `import ... from './locale.js' | './i18n.js'` 的模块中的中文字面量。
3. **已译来源**：`js/i18n-packs/{en,ja,ko,es,fr,de,ru,ar}.js`、`js/ui-catalog.js`、`js/ui-strings.js`。
4. **不计入**：模型侧文本（`tools.js` / `config.js` / `prompt*.js` / `agent.js` / `subagents.js` / `suggestions*.js` / 审核词表 / `release-notes.js` 等——它们有 `*_en.js` 平行模块或只服务中文模型）、语言自身名称（中文 / 日本語 / 한국어）、以及由调用处统一包一层的拼接片段。

## 本轮结果

| 面 | 之前 | 现在 |
|---|---|---|
| 界面模块写死中文（--check 门禁） | 143 条（从未被审计过） | **0 条** |
| `docs.html` 未翻译条目 | 371 | 371（内容翻译，见下） |
| `index.html` 未翻译条目 | 9 | 9（示例区长文案） |

## 逐模块修复

| 模块 | 条数 |
|---|---|
| `photo-editor.js` | 45（模板 17 条文本 + 28 条属性） |
| `ui.js` | 34 |
| `pricing.js` | 16 |
| `settings.js` | 13 |
| `api.js` | 12 |
| `project-mode.js` | 10 |
| `gateway-registry.js` | 6 |
| `main.js` | 5 |
| `commandsource.js` / `quickmap.js` / `share-document.js` | 5 / 4 / 4 |
| `ui-model-picker.js` / `ui-attachments.js` / `ui-files-panel.js` / `ui-scanner.js` | 4 / 3 / 2 / 2 |
| `ui-capability.js` / `ui-popovers.js` / `ui-language.js` / `human-check.js`（新写文案） | 1 / 1 / 1 / 全部双语 |

## 待办（如实记账）

1. **`docs.html` 371 条**：法律四页（用户协议 / 使用规范 / 服务条款 / 隐私政策）已有手写英文平行版本（`js/docs-language.js` 的 `pages` 对象 + `[data-doc-language]` 切换）；剩下的是**技术文档与价目表的正文段落**，属内容级翻译，需要成段人工翻译而不是逐串映射。缺口上限已锁定在 371，不会继续变多。
2. **`index.html` 9 条**：导航页示例区的长句说明与 `iframe` 标题。
3. 其余 6 个语言包（ja / ko / es / fr / de / ru / ar）目前对新增条目走英文回退；如需本族语，请在 `js/i18n-packs/<lang>.js` 里按中文源文本加键值即可，无需改代码。

## 防回归

- `tools/i18n-coverage.mjs --check` 进入 CI（`.github/workflows/ci.yml`），界面模块一旦出现写死中文即失败。
- `tests/i18n-coverage.test.mjs`：界面零遗漏、页面缺口只降不升、原生语言名不误报、旧审计 `scripts/i18n-audit.mjs` 仍为 `[]`。
