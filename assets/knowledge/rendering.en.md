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

## Gradient, motion text, micro-interaction cards and colour fences
Keywords: gradient, motion, animation, fx, shimmer, glow, wave, typewriter, neon, rainbow, card, hover, tilt, ripple, custom motion, colour, color, :::gradient, :::fx, :::card, :::color

Each of these is a block fence: an opening line, the body, and a closing line that is only `:::`. The fence must sit on its own line. The body is still rendered as Markdown.

- Gradient text: `:::gradient preset [angle]`, body, `:::`. Presets: sunset, ocean, aurora, forest, gold, neon, candy, mono (greyscale). You can also pass 2 to 4 colours directly, for example `:::gradient #ff7a18 #af002d 45`; the angle is optional. Presets can take an angle too, for example `:::gradient ocean 120`. Prefer the multi-line form (arguments on the opening line, body on the next lines, a closing `:::` alone on its own line); a one-line form `:::gradient ocean 120 body :::` also works, with the arguments before the body.
- Motion text: `:::fx name`, body, `:::`. Names: shimmer, glow, wave, typewriter, neon, rainbow. Use it for titles, poster lines and short phrases, not for long running text.
- Custom motion: `:::fx custom`. The first part is CSS that applies only to this block. Only whitelisted properties are allowed; `url()`, `@import`, variables, escapes, `<` and `>` are rejected. Then a single `===` line, then the body.
- Micro-interaction cards: `:::card lift`, `:::card tilt`, `:::card ripple` or `:::card glow`, body, `:::`. They react on hover or click.
- Text colour: `:::color #rrggbb`, body, `:::`. The colour is checked for contrast; if it is too low it is shifted towards neutral grey so the text stays readable.

Guidance: use gradient or motion text for titles and posters, micro-interaction cards for highlighted points, and keep ordinary body text as plain Markdown.

## Inline flag directives (BabelStone Flags 4.13)
Keywords: ::flag, flag, national flag, subdivision, ZWJ, PUA, private use, BabelStone

Use `::flag[code|accessible name]::` in prose, or omit the name: `::flag[us|United States]::`, `::flag[gb-sct|Scotland]::`, `::flag[rainbow|Rainbow flag]::`. The name is for assistive technology, not visible text. IDs are case-insensitive; literal code spans, code blocks and escaped directives are not rendered. The app emits the Unicode sequence internally; do not type ordinary letters as flag glyphs or manually construct invisible tags.

- Country, regional and organisation flags: use a supported two-letter code listed below, such as `us`, `cn`, `su` (or `ussr`), `eu`, `un`, `aq`; these emit regional indicators.
- Subdivisions: use supported IDs below, such as `gb-sct`, `gb-eng`, `gb-wls`, `iq-kr`, `us-ca`, `at-1`. They emit a complete Unicode flag tag sequence.
- ZWJ: `rainbow`, `transgender`, `pirate`, `aboriginal` (Australian Aboriginal flag), `refugee-nation`; aliases `rainbow-flag`, `transgender-flag`, `pirate-flag`, `australian-aboriginal-flag`, `refugee-nation-flag` also work. Flag designs may have separate rights.
- Main-font PUA: `mr-old` (Mauritania 1959–2017, U+F000), `hn-old` (Honduras 1949–2022, U+F001), `sy-old` (Syria 1980–2024, U+F002), `de-by-alt` (alternate Bavaria, U+F400). Codes `f000`, `f001`, `f002`, `f400` also work. These are font-specific, not standard Unicode flag mappings.
- PUA-only font: `pua-us`, `pua-gb-sct`, `pua-rainbow`, `pua-mr-old`, or a supported code such as `pua-e21a`; these use the separate BabelStone Flags PUA face. Its E000–E43F mapping is not the main font's F000 mapping. The available PUA IDs are listed below; the upstream mapping also lists slots that are absent from the actual font.

BabelStone 4.13 has no `nato`, `hre`, `prussia`, `ru-empire` or `true-south` flag glyph/encoding; these remain literal rather than being mapped to an unrelated character. `aq` uses the font's Antarctic map design, not True South. Unsupported or unknown codes remain literal; not all ISO flags are available. The local flag fonts are included in the offline core cache and embedded in standalone shares.

**Supported regional IDs:** ad ae af ag al am ao aq ar at au aw ax az ba bb bd be bf bg bh bi bj bl bn bo bq br bs bt bv bw by ca cc cd cf cg ch ci ck cl cm cn co cp cq cr cs cu cv cw cx cy cz dd de dj dk dz ee eg er es et eu fi fo fr gb ge gf gg gi gl gp gr gy hk hn hr hu id ie il im in iq ir is it je jm jo jp kg kh kp kr kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mk ml mm mn mo mq mr mt my na ne ng nl no np nu nz pa pe pf pg ph pl pm pr ps pt qa re ro rs ru sa sd se sg si sj sk sm so sr ss su sx sy tf th tj tm tr tw ua um un us uz va vn wf xe xk xn xs xw ye yt yu za zw

**Supported subdivision IDs:** at-1 at-2 at-3 at-4 at-5 at-6 at-7 at-8 at-9 be-bru be-vlg be-wal bq-bo bq-sa bq-se ca-nl ca-nu ca-qc ch-fr ch-lu ch-ne ch-so ch-sz ch-ti ch-vs ch-zg ch-zh cn-hk cn-mo de-by es-ct es-pv fr-bre gb-agy gb-bmg gb-bnf gb-con gb-cym gb-dev gb-dor gb-eng gb-ffl gb-fln gb-fyn gb-mon gb-nbl gb-nir gb-ork gb-pem gb-sct gb-sry gb-vgl gb-wls gb-xbr gb-xca gb-xcr gb-xkd gb-xme gb-ynm gb-zet ie-c ie-l ie-m ie-u iq-kr nl-aw nl-bq1 nl-bq2 nl-bq3 nl-cw nl-fr nl-sx us-ak us-al us-az us-ca us-co us-dc us-hi us-in us-md us-nm us-pr us-sc us-tn us-tx us-um

**Supported PUA-face IDs:** pua-ad pua-ae pua-af pua-ag pua-al pua-am pua-ao pua-aq pua-ar pua-at pua-au pua-aw pua-ax pua-az pua-ba pua-bb pua-bd pua-be pua-bf pua-bg pua-bh pua-bi pua-bj pua-bl pua-bn pua-bo pua-bq pua-br pua-bs pua-bt pua-bv pua-bw pua-by pua-ca pua-cc pua-cd pua-cf pua-cg pua-ch pua-ci pua-ck pua-cl pua-cm pua-cn pua-co pua-cp pua-cq pua-cr pua-cs pua-cu pua-cv pua-cw pua-cx pua-cy pua-cz pua-dd pua-de pua-dj pua-dk pua-dz pua-ee pua-eg pua-er pua-es pua-et pua-eu pua-fi pua-fo pua-fr pua-gb pua-ge pua-gf pua-gg pua-gi pua-gl pua-gp pua-gr pua-gy pua-hk pua-hn pua-hr pua-hu pua-id pua-ie pua-il pua-im pua-in pua-iq pua-ir pua-is pua-it pua-je pua-jm pua-jo pua-jp pua-kg pua-kh pua-kp pua-kr pua-kz pua-la pua-lb pua-lc pua-li pua-lk pua-lr pua-ls pua-lt pua-lu pua-lv pua-ly pua-ma pua-mc pua-md pua-me pua-mf pua-mg pua-mk pua-ml pua-mm pua-mn pua-mo pua-mq pua-mr pua-mt pua-my pua-na pua-ne pua-ng pua-nl pua-no pua-np pua-nu pua-nz pua-pa pua-pe pua-pf pua-pg pua-ph pua-pl pua-pm pua-pr pua-ps pua-pt pua-qa pua-re pua-ro pua-rs pua-ru pua-sa pua-sd pua-se pua-sg pua-si pua-sj pua-sk pua-sm pua-so pua-sr pua-ss pua-su pua-sx pua-sy pua-tf pua-th pua-tj pua-tm pua-tr pua-tw pua-ua pua-um pua-un pua-us pua-uz pua-va pua-vn pua-wf pua-xk pua-ye pua-yt pua-yu pua-za pua-zw pua-mr-old pua-hn-old pua-sy-old pua-australian-aboriginal-flag pua-refugee-nation-flag pua-pirate-flag pua-rainbow-flag pua-transgender-flag pua-at-1 pua-at-2 pua-at-3 pua-at-4 pua-at-5 pua-at-6 pua-at-7 pua-at-8 pua-at-9 pua-be-bru pua-be-vlg pua-be-wal pua-bq-bo pua-bq-sa pua-bq-se pua-ca-nl pua-ca-nu pua-ca-qc pua-ch-fr pua-ch-lu pua-ch-ne pua-ch-so pua-ch-sz pua-ch-ti pua-ch-vs pua-ch-zg pua-ch-zh pua-de-by pua-de-by-alt1 pua-es-ct pua-es-pv pua-fr-bre pua-gb-agy pua-gb-con pua-gb-dev pua-gb-dor pua-gb-eng pua-gb-fln pua-gb-mon pua-gb-nbl pua-gb-nir pua-gb-ork pua-gb-pem pua-gb-sct pua-gb-sry pua-gb-vgl pua-gb-wls pua-gb-xbr pua-gb-xca pua-gb-xcr pua-gb-xkd pua-gb-xme pua-gb-zet pua-ie-c pua-ie-l pua-ie-m pua-ie-u pua-iq-kr pua-nl-fr pua-us-ak pua-us-al pua-us-az pua-us-ca pua-us-co pua-us-dc pua-us-hi pua-us-in pua-us-md pua-us-nm pua-us-sc pua-us-tn pua-us-tx
