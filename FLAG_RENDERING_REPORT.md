# 旗帜「切换标签页后短暂显现又整批隐身」研究与修复（2026-11-09）

## 1. 现象

页面里的旗帜（`::flag[us]::` 等指令）在切换浏览器标签页再切回来时，先短暂显示彩色旗帜，随即一瞬间**全部不可见**（不是变成方框或字母，而是整片消失）。BabelStone 官网的旗帜展示页也有类似观感，因此先去核对了上游实现。

## 2. 上游（BabelStone Fonts）研究结论

来源：[BabelStone Fonts : BabelStone Flags](https://www.babelstone.co.uk/Fonts/Flags.html)、官网样式表 [BabelStone.css](https://www.babelstone.co.uk/BabelStone.css)、[Unicode Emoji TR#51](https://www.unicode.org/reports/tr51/)。

- **BabelStone Flags 4.13（2025-05-28）不是普通轮廓字体**：它用 **COLR/CPAL 分层彩色字形**（并附 SVG 表）渲染旗帜，靠 OpenType **`ccmp`（Glyph Composition/Decomposition）** 把「Regional Indicator 序列 / Flag Emoji Tag 序列 / ZWJ 序列」整段替换成一个彩色旗形字形。官网明确写：「Substitution colour glyphs for flag sequences」。
- **官网自己给出了问题与 workaround**：「If you have difficulty displaying or printing some or all of the flag glyphs then you may wish to try the *BabelStone Flags PUA* font **which does not use OpenType features to render character sequences as glyphs**, but maps all the flag glyphs to the Private Use Area (PUA) only.」——这句话几乎就是本次 BUG 的处方。
- **官网页面本身没有任何字体加载保护**：`BabelStone.css` 的 `@font-face` 只有 `local(...)` + `url(...WOFF/WOFF2)`，**没有 `font-display`、没有 `preload`、没有 `document.fonts` 逻辑**；`Flags.html` 把 263 个旗帜字符（含大量 RI / tag / ZWJ 序列）直接铺在 HTML 表格里，完全依赖浏览器「渲染到该字符时才按需下载」。这正是用户觉得「官网上好像也有这个问题」的原因：同一套机制，同样在后台标签页 / 重绘时不可靠。
- **序列本身有两个天然脆弱点**（官网也写明）：
  - RI 序列没有编码层面的边界，相邻序列可能错配；
  - **Tag 字符是 default-ignorable、默认不可见**：「if a flag tag sequence is not supported on a particular system it will fallback to displaying as a waving black flag」，而在 shaping 完全失败时连黑旗都可能不画 → 整段「隐身」。

## 3. 浏览器侧机制（为什么会「先显现、后消失」）

1. **Emoji_Presentation 的字体回退启发式**：RI（U+1F1E6–1F1FF）、ZWJ 旗帜、tag 序列属于 emoji 呈现。浏览器会优先去找**系统彩色 emoji 字体**（Twemoji Mozilla / Apple Color Emoji / Segoe UI Emoji），CSS 里写的 `font-family: "BabelStone Flags"` 可能被跳过。Mozilla Bug [1970980](https://bugzilla.mozilla.org/show_bug.cgi?id=1970980) 的标题就是「Always prefer to search for a color font for Regional Indicator codepoints, unless text presentation is explicitly requested」。标准解法是 CSS `font-variant-emoji: text`（Chrome 131+ / Edge 131+ / Firefox 141+；Safari 暂不支持）。
2. **后台标签页会暂停/取消字体下载**：`unicode-range` 分片字体只在真正渲染到该码位时才下载；如果旗帜是在后台标签页里插入的（Agent 回复在后台到达），或浏览器在后台把 FontFace 置为 `unloaded`/`error`，`font-display: swap` 的 CSS 声明**不会自动重试**。
3. **切回时的重绘竞态**：浏览器先用缓存的彩色字形图层画了一帧（用户看到「短暂显现」），接着重新 shaping/光栅化时发现字体不可用，序列回退到 default-ignorable 的 tag 字符或系统 emoji 字体（Windows 上不给 RI 旗形）→ 一瞬间整批不可见。
4. **`font-display: optional` / `fallback` 会放大问题**：它们有约 3 秒的 swap period；在后台标签页计时结束后字体**永久不再交换**。本项目旗帜面用的 `swap`，所以这次不是元凶，但绝不能「顺手改成 optional」。

## 4. 本项目原来的路径

```
::flag[us]:: → flagSequence() → "🇺🇸"（两个 RI 码位）
            → <span class="md-flag">🇺🇸</span>
            → .md-flag { font-family: "BabelStone Flags", sans-serif; font-feature-settings:"ccmp" 1 }
            → assets/fonts-lazy/index.css 中 font-display: swap + unicode-range 懒下载
```

`subdivisionFlags`（如 `gb-sct`）更脆弱：`🏴` + 5 个 tag 字符 + cancel tag，整段依赖 `ccmp`，字体不可用时 tag 字符全部 default-ignorable → 完全空白。项目里虽然已经打包了 `flags-pua.ttf` 和 263 个 PUA 映射，但只有显式写 `::flag[pua-us]::` 才会用到。

## 5. 修复（四层，互相兜底）

| 层 | 改动 | 解决什么 |
|---|---|---|
| ① 渲染改用单码位 PUA | `js/flag-directive.js` 新增 `puaCodeFor(id)`（含别名归一），`regionalFlags` / `subdivisionFlags` **默认输出 PUA 码位 + `.md-flag-pua`**；270/274 个旗帜命中，4 个无映射的伪代码（`xe/xn/xs/xw`）与 5 个 ZWJ 旗帜保留原序列 | 不依赖 `ccmp` 序列合成、不是 Emoji_Presentation，浏览器不会用系统 emoji 字体抢走，重绘后不会整批消失。这是官网推荐的稳定路径 |
| ② 显式加载与可见性恢复 | 新增 `js/flag-fonts.js`：启动即 `document.fonts.load()` 两个旗帜面；`visibilitychange` 重新可见时 `check()` 复查、缺失即重载，并在 `pending → ready` 之间强制一次 reflow 让彩色字形重新光栅化；`main.js` 安装 | 不再依赖「渲染到该字符才下载」，后台切回后字体一定可用 |
| ③ 阻止 emoji 字体抢占 | `.md-flag` / `.md-flag-pua` 加 `font-variant-emoji: text`；字体回退链同时列出两个旗帜面（兼容旧消息里的 RI / ZWJ 序列） | 让 CSS 指定的字体在支持该属性的浏览器上真正生效 |
| ⑤ 复制语义还原 | `js/flag-copy.js`：`copy` 事件把 PUA 字符还原为 Unicode emoji；无 Unicode 表示时用 `[flag]` 占位；`text/plain` 与 `text/html` 都处理 | 显示层用 PUA 不影响用户复制出来的文本 |
| ④ 可见占位，绝不「隐身」 | `flagMarkup()` 输出 `data-code="US"`；CSS 在 `html[data-flags-ready="pending"]` 时隐藏字形、用 `::after { content: attr(data-code) }` 显示两字母代码。静态分享页无该属性，永远显示真实旗帜 | 字体加载失败/被丢弃时用户看到 `US` / `GB-SCT`，而不是空白 |

**刻意保留** `font-display: swap`：换成 `optional`/`fallback` 会让后台标签页的 swap period 过期后字体永不交换，症状会更严重。

## 6. 取舍与残留风险

- PUA 是私用区码位，但**复制语义已还原**：`js/flag-copy.js` 在 `copy` 事件里把有 Unicode 对应的 PUA 字符换成标准 emoji（RI / tag / ZWJ），纯 PUA 设计换成占位符 `[flag]`；`aria-label` 与 `data-code` 保留可读名称。
- `font-variant-emoji: text` 在 Safari 尚未支持；但 PUA 字符不受影响，Safari 上主要走 PUA 路径 ✓。
- 5 个 ZWJ 旗帜（彩虹、跨性别、海盗、澳大利亚原住民、难民国旗）没有 PUA 映射，仍用序列 + `BabelStone Flags`；它们由 ②③ 兜底，字体不可用时显示代码占位。
- 彩色字体（COLR/CPAL）在个别旧浏览器/打印路径仍可能退化；官网同样建议这种场景用 PUA 版。
- 未做真浏览器（Chrome/Safari/Firefox）的标签页切换实测；回归测试覆盖纯逻辑、mock `FontFaceSet` 的加载/恢复流程、DOM 输出与静态接线。

## 7. 验证

- `node --test tests/flag-fonts.test.mjs`：两个字体面、PUA 覆盖率、默认渲染、`FontFaceSet` 首次加载 / 后台丢弃后重载 / 失败保持 pending / 无 FontFaceSet 降级 / `visibilitychange` 触发恢复 / CSS 与启动接线。
- `node --test tests/flag-directive.test.mjs`：更新为断言 187 个 RI + 87 个 subdivision 的 PUA 单码位输出、4 个伪代码回退、ZWJ 序列不变、263 个 PUA 映射、分享导出仍内嵌两个字体。
- 全量 `node tools/run-tests.mjs`。

## 8. 参考

- <https://www.babelstone.co.uk/Fonts/Flags.html>（4.13 说明、OpenType Features、PUA 建议、Download）
- <https://www.babelstone.co.uk/BabelStone.css>（官网 `@font-face`：无 `font-display`、无预加载）
- <https://www.unicode.org/reports/tr51/>（RI / tag / ZWJ 序列定义）
- <https://bugzilla.mozilla.org/show_bug.cgi?id=1970980>（RI 码位优先找彩色字体，除非显式请求 text presentation）
- <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variant-emoji>、<https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display>
