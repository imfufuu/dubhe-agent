# Dubhe Agent 图标方案（待选）

名字来源：Dubhe（天枢）是北斗七星斗勺的顶端星，与 Merak（天璇）一起构成“指极星”，指向北极星。三套方案都围绕这一意象展开。

| 方案 | 文件 | 思路 | 小尺寸（16px） | 结论 |
|------|------|------|----------------|------|
| A 指极 | `A-pointer-icon.svg`、`A-pointer-wordmark.svg` | 黑色圆角方块中一个 V 形指向上方，顶端一颗金色星点（指向北极星） | 清晰，轮廓单一 | **推荐**：最简、最易辨认，适合 favicon 与应用图标 |
| B 斗勺 | `B-bowl-icon.svg`、`B-bowl-wordmark.svg` | 深蓝底上还原北斗斗勺与柄的星点连线 | 16px 时退化为色块，细节丢失 | 辨识度最高，但更适合大尺寸的海报与启动页 |
| C 星光对话 | `C-bubble-icon.svg`、`C-bubble-wordmark.svg` | 白底上的黑色对话气泡，三颗点中一颗金色 | 清晰，但与常见聊天应用图标相似 | 贴合“智能体对话”，辨识度偏弱 |

## 文件说明

- `*-icon.svg`：64×64 视图，可直接用作应用图标。
- `*-wordmark.svg`：图标加文字名，文字使用 Inter / Helvetica Neue，正式采用前应转换为轮廓（outline）以免在无字体的设备上变形。
- `previews/`：由 @resvg/resvg-js 渲染的 PNG，`compare.png` 为三套图标的 128px 与 16/32px 对比，`wordmarks.png` 为文字标对比。

## 未做的事（待你选定后再做）

- 替换 `assets/app-icon-192.png`、`assets/app-icon-512.png`、`manifest.webmanifest` 与 `app.html` 中的 favicon 数据 URI。
- 替换 `apple-touch-icon` 与 `og:image` 所用的图片。
- 生成真正的 favicon.ico 与多尺寸 PNG。
