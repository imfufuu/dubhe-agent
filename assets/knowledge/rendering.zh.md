# 客户端渲染语法参考（Dubhe Agent）

## 使用范围与检索方式
关键词：渲染语法、Markdown、客户端语法、格式、排版、知识库、rendering syntax、Markdown syntax、fence grammar

本指南对应应用内 `js/ui-markdown.js`、`js/markdown-extensions.js`、`js/quickviz.js` 与安全清理器实际实现的语法，不等同于任意 Markdown 网站或 Mermaid 插件。默认用 Markdown；只有确实需要合并单元格、选择框、折叠、字体、颜色、SVG 统计图或流程/思维图时才用相应扩展。输出前可用 `knowledge_search(topic="rendering")` 搜索本指南；搜索支持中文/英文、别名、片段和轻微拼写偏差。若语法不匹配，退回普通 Markdown，不要臆造围栏。

## 基础 Markdown：标题、段落、列表、引用与分隔线
关键词：标题、段落、换行、无序列表、有序列表、嵌套列表、引用、分隔线、heading、paragraph、list、blockquote、horizontal rule

客户端使用本地 `markdown-it` 渲染 CommonMark 与表格扩展。支持 `#` 至 `######` 六级标题、普通段落、空行分段、无序列表（`-` / `*` / `+`）、有序列表（`1.` / `1)`）、缩进嵌套列表、`>` 引用块、`---` 水平分隔线。标题自动生成可用于同页目录的锚点；重复标题会加序号。默认 `breaks: false`，普通行内的单个换行不等于强制换行；需要新段落时留空行，需要同段换行可在行尾加两个空格。`linkify: true`，正文中的普通 HTTP(S) URL 会自动成为链接。

## 表格与合并单元格（重点）
关键词：合并单元格、单元格合并、跨行、跨列、横向合并、纵向合并、表头合并、HTML table、table cell、merge cells、merged cells、cell merge、colspan、rowspan、column span、row span、跨列合并、跨行合并

普通对照表用 Markdown 管道表格：

```markdown
| 模型 | 输入价 | 输出价 |
|---|---:|---:|
| A | 1 | 2 |
| B | 3 | 4 |
```

**Markdown 管道表格本身不支持合并格。** 本客户端专门允许经过安全清理的 HTML 表格；横向合并写在 `<th>` / `<td>` 上的 `colspan="N"`，纵向合并写 `rowspan="N"`。跨度必须是 1–1000 的整数。示例（可同时横向、纵向合并）：

```html
<table>
  <thead>
    <tr><th rowspan="2">地区</th><th colspan="2">销量</th></tr>
    <tr><th>线上</th><th>线下</th></tr>
  </thead>
  <tbody>
    <tr><td rowspan="2">华东</td><td>120</td><td>80</td></tr>
    <tr><td colspan="2">合计：200</td></tr>
  </tbody>
</table>
```

只在必须合并单元格时使用这段安全 HTML；`<table> / <thead> / <tbody> / <tr> / <th> / <td>` 可渲染，`colspan` 与 `rowspan` 会保留。事件属性（如 `onclick`）、非法跨度（0 或大于 1000）及不在白名单中的属性会被剥除。不要写 Markdown 管道表格里的 `colspan` 伪语法，也不要为了合并格改用代码块。

## 行内格式与化学下标
关键词：粗体、加粗、斜体、删除线、高亮、上标、下标、化学式、bold、italic、strikethrough、highlight、superscript、subscript

支持 `**粗体**`、`*斜体*`、`~~删除线~~` 和扩展高亮 `==重点==`。单侧误写的 `~~删除线~` 也有兼容修复；反斜杠转义的定界符按字面显示。上标使用 `x^2^`，下标使用 `H~2~O`；常见化学式还可用 `H_2O`（下标只转换已识别元素符号后的数字）。双波浪号是删除线，单波浪号包裹内容是下标。术语、变量、文件名和命令用反引号：`` `inline code` ``；转义符号可用反斜杠。

## 代码块与代码围栏属性
关键词：代码块、围栏代码、语法高亮、行内代码、Pandoc 属性、code fence、code block、syntax highlighting、fenced attributes

行内代码用单反引号；多行代码用三反引号或三个波浪号，并建议标明语言，例如 ` ```js `、` ```python `、` ```json `。围栏代码会转为安全的代码块并提供复制按钮。围栏信息串可在末尾带 Pandoc 属性：

````markdown
```js {#example .compact title="演示代码"}
console.log("hello");
```
````

属性支持受限的 `#id`、`.class`、`title="…"` 与安全 `style="…"`；最多 8 个类。CSS 只允许客户端白名单中的颜色、字号、对齐、尺寸、间距、边框等属性，危险值和未知属性会被忽略。不要写脚本或依赖不安全 HTML 属性。

## 数学公式（KaTeX）
关键词：公式、数学、LaTeX、行内公式、块级公式、KaTeX、math、equation、display math

数学由本地 KaTeX 渲染。行内支持 `$x^2$` 或 `\\(x^2\\)`；独立公式支持 `$$E=mc^2$$` 或 `\\[E=mc^2\\]`。用合法 LaTeX 命令，美元符号须成对；普通价格或文字里的 `$` 不要误包成公式。未闭合的流式 `$$` / `\\[` 会暂时作为正在输入的公式处理；行内未闭合单美元符号不猜测。

## 脚注、定义列表与 Pandoc 围栏容器
关键词：脚注、注释、定义列表、术语表、围栏容器、fenced div、footnote、definition list、Pandoc div

脚注引用写 `[^note]`，并在正文中提供定义 `[^note]: 注释内容`；脚注自动编号、可回链。定义列表写成“术语一行，下一行以冒号加空格开始释义”：

```markdown
术语
: 定义或说明
```

Pandoc 风格围栏容器可写 `::: {.notice #intro}`，容器内容，最后单独一行 `:::`；也可写 `::: notice` 作为类名容器。容器内继续按 Markdown 渲染，允许嵌套；未闭合容器保留为普通 Markdown，不会吞掉后续全文。标题、代码围栏也可用 `{#id .class title="…" style="…"}` 属性。

## 图片、链接、沙箱文件卡片与安全边界
关键词：图片、嵌入图像、Markdown 图片、sandbox 图片、链接、文件卡片、sandbox://、image、link、file card、download

网络图片可用 `![替代文字](https://example.com/picture.png)`；沙箱图片使用 `![示例](sandbox://outputs/example.png)`，本地加载沙箱里的图，不要写主机文件路径或 `file://`。图片 `src` 仅接受安全 HTTP(S)、允许的图片 data URL，或通过沙箱解析的相对路径；回复卡片中的图片桌面宽度上限为卡片的 70%，移动端可放宽到卡片宽度。

非图片交付物用 `[[file:outputs/report.xlsx]]`，可选显示名 `[[file:outputs/report.xlsx|月度报表]]`，渲染为可点击的沙箱文件卡片。普通链接用 `[说明](https://example.com)`；仅安全链接协议可点击。不要输出 HTML `<img>` 代替沙箱图片，也不要编造下载 URL。

## 安全原始 HTML 与属性白名单
关键词：原始 HTML、安全 HTML、HTML 白名单、标签清理、允许属性、raw HTML、sanitizer、safe HTML

默认 Markdown 引擎关闭任意 HTML 解析；客户端另行将原始标签逐个做白名单清理。可用的标签限于常见文本、列表、引用、`details/summary`、表格及图片（例如 `table`, `tr`, `td`, `th`, `details`, `summary`, `span`, `div`, `img`）。允许的通用属性限于 `class/id/title/style`；链接、图片、表格单元格与列表仅有各自受限属性。`style` 值还会经过 CSS 白名单过滤。`script/style/iframe/object/embed/svg/math/template` 等危险标签及其内容会移除，事件处理属性不会保留。合并表格单元格仅用前述合法 `colspan` / `rowspan`，不要依赖未列出的 HTML 特性。

## 折叠栏、选择框、对齐、字体与颜色围栏
关键词：折叠、折叠面板、选择框、选项按钮、居中、右对齐、字体、颜色块、:::fold、:::choice、:::align、:::font、:::color、summary choice、fold、font、color

以下扩展都是“开头一行 + 正文 + 单独结束行 `:::`”的块级围栏，围栏要单独占行：

- 折叠栏：`:::fold 标题`，正文，`:::`。正文继续渲染 Markdown，默认收起；适合次要细节，不要把整篇答案都折叠。
- 选择框：`:::choice 问题`，之后每行写一个 `- 选项`，最后 `:::`。也识别 `*`、`+`、`•`、`1.`、`1)`、`A)` 等列表标记。相邻的完整 choice 块可组成多步选择；只在最终回复中用于重要决策，不要在工具调用过程中输出。
- 对齐：`:::center` / `:::right`，或 `:::align center` / `:::align right` 包住 Markdown 段落。居中别名有 `center/centre/居中/居中对齐/中`；右对齐别名有 `right/右/右对齐/靠右`。没有左对齐专用围栏。
- 字体：优先用正式字体族名，例如 `:::font KaiTi`、`SimSun`、`FangSong`、`SimHei`、`Ma Shan Zheng`、`serif` 或 `Noto Serif JP`；中文兼容名仍可用。楷体当前字体族名为 `KaiTi`；旧别名 `KaiTi_GB2312`（GB2312，不是 GB2313）继续兼容。未知字体名回退到 serif。仅用于确有排版需求的短段落。
- 颜色：`:::color red` 包住正文；支持 red/红/红色/crimson/深红、blue/蓝/蓝色、green/绿/绿色、orange/橙/橙色、purple/紫/紫色、teal/青/青色/cyan、pink/粉/粉色、gold/yellow/黄/黄色/金/金色、gray/grey/灰/灰色、brown/棕/棕色/咖啡、olive/橄榄、accent/强调/高亮。颜色块内正文仍可用 Markdown；未知别名会保留普通文本而不伪装成颜色块。

## 快捷统计图（交互式内联 SVG）
关键词：统计图、图表、柱状图、条形图、折线图、面积图、饼图、环形图、堆叠图、直方图、箱线图、散点图、气泡图、漏斗图、桑基图、地图、:::chart、chart、bar、line、pie、sankey、map、plot

围栏格式为 `:::chart 类型 标题`、数据行、`:::`；也可直接用类型别名作围栏，如 `:::bar 标题`、`:::折线图 标题`。`:::chart` 的类型可写英文或对应中文。支持 15 类：`bar` 柱状图、`barh` 横向条形图、`line` 折线图、`area` 面积图、`pie` 饼图、`donut` 环形图、`stacked` 堆叠柱状图、`stacked-area/stackedarea` 堆叠面积图、`histogram` 直方图、`boxplot` 箱线/箱型/盒须图、`scatter` 散点图、`bubble` 气泡图、`funnel` 漏斗图、`sankey` 桑基图、`map` 地图。

数据规则：
- 柱状、条形、折线、面积、饼、环形、堆叠柱、堆叠面积、漏斗与地图：每行“标签, 数值”；多系列时首行写“维度, 系列A, 系列B”，数据行写“标签, 数值A, 数值B”。分隔符可用逗号、制表符或竖线；数值接受负数、小数与百分号。
- 直方图：直接提供一组原始数值；标题可写 `bins=8` 调整箱数。
- 箱线图：每行“组名, 原始值1, 原始值2, …”。
- 散点图：每行“x, y”或“名称, x, y”；可在末尾加非数字系列名分组。
- 气泡图：每行“名称, x, y, 大小”。
- 桑基图：每行“来源 -> 去向, 流量”；也接受 `A → B 30` 或 `A, B, 30`。
- 地图：每行“地区, 数值”；省级地区会匹配中国地图，国家会匹配世界地图；标题可写 `china` / `world` 或 `map=china` / `map=world` 指定底图。

标题还可带 `xlabel=…`、`ylabel=…`、`bins=…`、`map=…`、`unit=…`、`sort=…`、`legend=…` 等选项。类型别名很多，检索图表时可用 `chart/bar/柱状图/桑基/地图` 等关键词。不要把统计图改成生图或猜写 Mermaid `xychart-beta`。

## 流程图与思维导图
关键词：流程图、流程、箭头图、思维导图、脑图、:::flow、:::mind、:::diagram、flowchart、mindmap、diagram

流程图可用 `:::flow 标题`，也可用 `:::diagram flow 标题`；正文每行写节点链，例如 `开始 -> 校验 -> 完成`，支持 `->`、`-->`、`=>`、`→`，边标签可写 `A ->|通过| B`。也接受 `flowchart/流程图/流程` 别名。客户端将其绘为本地 SVG；最多 36 个节点、48 条边。

思维导图可用 `:::mind 标题` 或 `:::diagram mind 标题`；正文写缩进层级列表，例如：

```markdown
- 规划
  - 目标
  - 风险
- 执行
  - 验证
```

也接受 `mindmap`、`mind-map`、`思维导图`、`脑图`。标题是中心主题；无标题时可用正文首行作为根节点。节点文字较长会截短，图形由本地内联 SVG 绘制。不要把架构图误写成不支持的 `:::mermaid` 围栏；复杂 Mermaid/DOT 图需要明确调用对应工具，而不是假定普通 Markdown 会自动渲染 Mermaid。
