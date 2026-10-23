# Client Rendering Syntax Reference (Dubhe Agent)

## Scope and how to search this guide
Keywords: rendering syntax, Markdown syntax, formatting, client renderer, Markdown extensions, merge cells, chart grammar, flowchart, mind map

This guide documents the syntax actually implemented by `js/ui-markdown.js`, `js/markdown-extensions.js`, `js/quickviz.js`, and the HTML sanitizer. It is not a promise that every Markdown website or Mermaid extension is available here. Use ordinary Markdown by default. Reach for an extension only when you need merged cells, choices, collapsible sections, fonts, colors, SVG charts, or flow/mind diagrams. Search the built-in knowledge with `knowledge_search(topic="rendering")`; English aliases, Chinese terms, code fragments, and small spelling mistakes are indexed. If unsure, fall back to plain Markdown rather than inventing a fence.

## Common Markdown: headings, paragraphs, lists, quotes, rules
Keywords: heading, paragraph, line break, unordered list, ordered list, nested list, blockquote, horizontal rule, 标题, 段落, 列表, 引用, 分隔线

The local `markdown-it` renderer supports CommonMark plus tables. Use `#` through `######` for six heading levels; blank lines separate paragraphs. Unordered lists use `-`, `*`, or `+`; ordered lists use `1.` or `1)`. Indented lists nest. Use `>` for a blockquote and `---` for a horizontal rule. Headings receive same-page anchors, with suffixes for duplicate titles. `breaks: false` is the default: a single newline inside a paragraph is not a hard line break. Use a blank line for a new paragraph or two trailing spaces for a hard break. `linkify: true` turns ordinary HTTP(S) URLs into links.

## Tables and merged cells (important)
Keywords: merged cells, merge cells, colspan, rowspan, column span, row span, horizontal merge, vertical merge, HTML table, table cell, 合并单元格, 跨行, 跨列, 单元格合并

For ordinary tables, use a Markdown pipe table:

```markdown
| Model | Input | Output |
|---|---:|---:|
| A | 1 | 2 |
| B | 3 | 4 |
```

**Markdown pipe tables do not support merged cells.** This client permits a narrowly sanitized HTML table for that purpose. Put `colspan="N"` on a `<th>` or `<td>` to span columns; put `rowspan="N"` on a `<th>` or `<td>` to span rows. Spans must be integer values from 1 through 1000. Example using both:

```html
<table>
  <thead>
    <tr><th rowspan="2">Region</th><th colspan="2">Sales</th></tr>
    <tr><th>Online</th><th>Retail</th></tr>
  </thead>
  <tbody>
    <tr><td rowspan="2">East</td><td>120</td><td>80</td></tr>
    <tr><td colspan="2">Total: 200</td></tr>
  </tbody>
</table>
```

Use this safe HTML only when a merge is necessary. `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, and `<td>` are allowed; valid `colspan` and `rowspan` survive sanitization. Event attributes such as `onclick`, invalid spans (zero or above 1000), and attributes outside the allow-list are removed. There is no `colspan` pseudo-syntax for pipe tables. Do not put the HTML in a code fence if you need it rendered.

## Inline formatting, code, superscript, and subscript
Keywords: bold, italic, strikethrough, highlight, superscript, subscript, chemical formula, 粗体, 斜体, 删除线, 高亮, 上标, 下标, 化学式

Use `**bold**`, `*italic*`, `~~strikethrough~~`, and the highlight extension `==important==`. A compatibility repair accepts one-sided `~~strike~`; escaped delimiters remain literal. Superscript uses `x^2^`; subscript uses `H~2~O`. A chemical-formula helper also recognizes `H_2O` by converting numeric suffixes after known element symbols. Double tildes are strikethrough; a single tilde around content is subscript. Use backticks for terms, variables, file names, and commands: `` `inline code` ``. Backslash escapes render delimiters literally.

## Fenced code blocks and Pandoc fence attributes
Keywords: code fence, code block, inline code, syntax highlighting, Pandoc attributes, fenced attributes, 围栏代码块, 代码块, 语法高亮, 属性

Use a single backtick for inline code and triple backticks or tildes for a multiline block. Include a language name, for example ` ```js `, ` ```python `, or ` ```json `. Fenced blocks render as safe code blocks with a copy control. An info string may end with limited Pandoc-style attributes:

````markdown
```js {#example .compact title="Sample code"}
console.log("hello");
```
````

Supported attributes are restricted to `#id`, `.class`, `title="…"`, and safe `style="…"`; at most eight classes are accepted. Inline CSS is filtered through an allow-list for properties such as colors, font size, alignment, dimensions, spacing, and borders. Dangerous values and unknown properties are ignored. Do not put scripts or rely on unsafe HTML attributes.

## Math formulas (KaTeX)
Keywords: math, formula, LaTeX, inline math, display math, equation, KaTeX, 数学公式, 行内公式, 块级公式

Formulas are rendered by local KaTeX. Inline delimiters are `$x^2$` and `\\(x^2\\)`. Display formulas use `$$E=mc^2$$` or `\\[E=mc^2\\]`. Use valid LaTeX commands and matched delimiters; do not wrap ordinary prices or dollar signs as math. An unfinished streaming `$$` or `\\[` block is temporarily handled as an open formula; an unmatched single-dollar inline expression is not guessed to be math.

## Footnotes, definition lists, and Pandoc fenced divs
Keywords: footnote, endnote, definition list, glossary, fenced div, Pandoc div, 脚注, 注释, 定义列表, 术语表, 围栏容器

Refer to a footnote as `[^note]` and define it elsewhere as `[^note]: Note text`. Footnotes are numbered automatically and receive backlinks. A definition list uses a term on one line followed by a colon and a space before its definition:

```markdown
Term
: Definition or explanation
```

A Pandoc-style fenced container can be written as `::: {.notice #intro}`, followed by Markdown content, and closed with a line containing only `:::`. `::: notice` is also accepted as a class container. Containers may contain Markdown and may nest; an unclosed container is left as ordinary Markdown instead of consuming the rest of the reply. Headings and code fences may also carry `{#id .class title="…" style="…"}` attributes.

## Images, links, sandbox file cards, and safety
Keywords: image, embedded image, Markdown image, sandbox image, link, file card, sandbox://, 图片, 嵌入图像, 链接, 文件卡片, 下载

A remote image uses `![alt text](https://example.com/picture.png)`. A sandbox image uses `![Example](sandbox://outputs/example.png)`; the client resolves it from the session sandbox. Do not use host file paths or `file://`. Image sources are restricted to safe HTTP(S), permitted image data URLs, or sandbox-resolved relative paths. Images inside reply cards are capped at 70% of card width on desktop; mobile may use the full card width.

For a non-image deliverable use `[[file:outputs/report.xlsx]]`, optionally with a display name: `[[file:outputs/report.xlsx|Monthly report]]`. This renders a clickable sandbox file card. Ordinary links use `[label](https://example.com)` and only safe protocols are clickable. Do not substitute raw HTML `<img>` for sandbox images or invent a download URL.

## Sanitized raw HTML and attribute allow-lists
Keywords: raw HTML, safe HTML, HTML allow-list, sanitizer, allowed attributes, merged table HTML, 原始 HTML, 安全 HTML, 白名单, 清理器

The default Markdown engine does not enable arbitrary HTML parsing. The client separately sanitizes raw tags against an allow-list. Allowed tags are limited to common text, list, quote, `details/summary`, table, and image elements (for example `table`, `tr`, `td`, `th`, `details`, `summary`, `span`, `div`, and `img`). Generic attributes are restricted to `class`, `id`, `title`, and safe `style`; links, images, table cells, and lists have their own limited attributes. CSS values are filtered again. Dangerous tags such as `script`, `style`, `iframe`, `object`, `embed`, `svg`, `math`, and `template` and their contents are removed; event-handler attributes are never retained. For merged tables, use only the documented `colspan` and `rowspan` syntax. Do not rely on unlisted HTML features.

## Fold, choice, alignment, font, and color fences
Keywords: fold, collapsible section, choice, option buttons, alignment, center, right, font, color, :::fold, :::choice, :::align, :::font, :::color, 折叠, 选择框, 对齐, 字体, 颜色

Each extension is a block fence: one opening line, Markdown body, and a closing line containing only `:::`. Keep the fence on its own line.

- **Fold:** `:::fold Title`, body, `:::`. The body is Markdown and starts collapsed. Use it for secondary details, not for hiding the entire answer.
- **Choice:** `:::choice Question`, one option per line, then `:::`. List markers `-`, `*`, `+`, `•`, `1.`, `1)`, `A)`, and similar are recognized; without markers, non-empty lines are options. Adjacent complete choice fences can form a multi-step choice. Use only for final-reply decisions, not during tool execution.
- **Alignment:** `:::center` / `:::right`, or `:::align center` / `:::align right`, wraps Markdown. Center aliases include `center`, `centre`, `居中`, `居中对齐`, `中`; right aliases include `right`, `右`, `右对齐`, `靠右`. There is no dedicated left-alignment fence.
- **Font:** prefer canonical font-family names, e.g. `:::font KaiTi`, `SimSun`, `FangSong`, `SimHei`, `Ma Shan Zheng`, `serif`, or `Noto Serif JP`; legacy Chinese aliases remain supported. `KaiTi` is the current family name; `KaiTi_GB2312` (GB2312, not GB2313) remains a legacy alias. Unknown names fall back to serif. Use only for short passages with a clear typographic need.
- **Color:** `:::color red` wraps Markdown. Aliases include `red/红/红色/crimson/深红`, `blue/蓝/蓝色`, `green/绿/绿色`, `orange/橙/橙色`, `purple/紫/紫色`, `teal/青/青色/cyan`, `pink/粉/粉色`, `gold/yellow/黄/黄色/金/金色`, `gray/grey/灰/灰色`, `brown/棕/棕色/咖啡`, `olive/橄榄`, and `accent/强调/高亮`. An unknown name is not converted into a color block.

## Quick charts (interactive inline SVG)
Keywords: chart, bar chart, line chart, area chart, pie chart, donut chart, stacked chart, histogram, box plot, scatter plot, bubble chart, funnel, Sankey, map, :::chart, 图表, 柱状图, 折线图, 散点图, 桑基图, 地图

Use `:::chart type Title`, data rows, `:::`; a chart type can also be used directly as the fence, such as `:::bar Title` or `:::折线图 标题`. `:::chart` accepts an English or Chinese type. Fifteen kinds are supported: `bar` (column/bar), `barh` (horizontal bar), `line`, `area`, `pie`, `donut`, `stacked` bars, `stacked-area` / `stackedarea`, `histogram`, `boxplot`, `scatter`, `bubble`, `funnel`, `sankey`, and `map`. Chinese aliases include 柱状图/柱状/柱形图, 条形图/横向柱状图, 折线图/趋势图, 面积图, 饼图, 环形图, 堆叠图/堆叠柱状图, 堆叠面积图, 直方图, 箱线图/箱型图/盒须图, 散点图, 气泡图, 漏斗图, 桑基图/桑吉图, and 地图/中国地图/世界地图.

Data formats:
- Bar, horizontal bar, line, area, pie, donut, stacked bar/area, funnel, and map: one row per “label, value”. For multiple series, use a header such as “category, series A, series B”, then “label, value A, value B”. Separators may be commas, tabs, pipes, Chinese commas, or repeated spaces; values may be negative, decimal, or percentages.
- Histogram: provide raw numeric values; add `bins=8` to the title to set the number of bins.
- Box plot: one row per group, followed by its raw values: “group, value 1, value 2, …”.
- Scatter: rows are `x, y` or `name, x, y`; an optional non-numeric series name may follow.
- Bubble: rows are `x, y, size` or `name, x, y, size`.
- Sankey: rows are `source -> target, value`; `A → B 30` and `A, B, 30` are also accepted.
- Map: one row per region and value. Recognized Chinese provinces/regions select the China map; otherwise the world map is used. Add `china`, `world`, `map=china`, or `map=world` to the title to choose the base map.

Titles may also include `xlabel=…`, `ylabel=…`, `bins=…`, `map=…`, `unit=…`, `sort=…`, and `legend=…`. When searching, try terms such as `chart`, `bar`, `柱状图`, `Sankey`, or `地图`. Do not turn a chart request into generated art or guess Mermaid `xychart-beta` syntax.

## Flowcharts and mind maps
Keywords: flowchart, flow diagram, mind map, :::flow, :::mind, :::diagram, workflow, 流程图, 思维导图, 脑图

A flowchart uses `:::flow Title`, or `:::diagram flow Title`. Write a chain on each line, such as `Start -> Validate -> Finish`. Connectors include `->`, `-->`, `=>`, and `→`; an edge label can use `A ->|yes| B`. `flowchart`, `流程图`, and `流程` are aliases. The renderer creates a local SVG, with limits of 36 nodes and 48 edges.

A mind map uses `:::mind Title` or `:::diagram mind Title`. Write a nested bullet list, for example:

```markdown
- Planning
  - Goals
  - Risks
- Delivery
  - Verification
```

Aliases include `mindmap`, `mind-map`, `思维导图`, and `脑图`. The title is the root topic; if omitted, the first plain-text line can become the root. Long labels are shortened in the drawing, which is generated as local inline SVG. Do not use an assumed `:::mermaid` fence: complex Mermaid/DOT diagrams need the corresponding tool explicitly; ordinary Markdown does not automatically render Mermaid.
