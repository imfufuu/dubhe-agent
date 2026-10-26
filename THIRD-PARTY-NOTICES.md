# 第三方组件与许可声明

Dubhe Agent 本体以 MIT 许可发布（见 [LICENSE](./LICENSE)）。
本项目打包或运行时依赖以下第三方组件：

## 本地打包（随仓库分发，位于 `assets/`）

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| [jsdiff](https://github.com/kpdecker/jsdiff) | 9.0.0 | BSD-3-Clause | 文件增删行比较；仅打包 line/base/params ESM（`assets/vendor/jsdiff/`，含 LICENSE） |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 14.3.2 | MIT | Markdown 渲染（`assets/md/markdown-it.min.js`） |
| [KaTeX](https://katex.org/) | 0.16.21 | MIT | LaTeX 公式渲染（`assets/katex/`，含其 OFL/MIT 双许可字体） |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | 1.30.0 | MIT | 浏览器本地 NudeNet 图片审核运行时（`assets/vendor/ort.min.js`、`ort-wasm-simd-threaded.mjs/.wasm`） |
| [Wllama](https://github.com/ngxson/wllama) | 3.8.1 | MIT（随包 `assets/vendor/wllama/LICENSE`） | 浏览器本地 GGUF 推理运行时（`assets/vendor/wllama/wllama-3.8.1.js/.wasm`）；运行时资源随仓库发行，不依赖 Wllama CDN |
| [Browsercc](https://github.com/BertalanD/browsercc) | 0.1.1 | MIT wrapper；bundled LLVM/WASI/Emscripten notices 见 `assets/vendor/cpp/` | 本地 C++20 编译器（Clang/LLD WASM、压缩 WASI sysroot） |
| [browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) | 0.4.2 | MIT OR Apache-2.0（两个许可文本均随包） | 在浏览器 Worker 内运行编译出的 WASI Preview 1 程序 |
| [NudeNet](https://github.com/notAI-tech/nudenet) | 3.4.x model | 上游许可见项目 | 浏览器本地显式裸露检测模型（`assets/moderation/nudenet-320n/`） |

上述组件的完整许可文本可在其上游仓库取得；其版权归各自作者所有。

## 运行时经 CDN / 远程服务加载（不随仓库分发）

| 组件 | 版本 | 许可 / 条款 | 用途 |
|---|---|---|---|
| [Pyodide](https://pyodide.org/) | 0.26.4 | MPL-2.0 | Python 沙箱运行时（`cdn.jsdelivr.net`，Worker 内加载，无 SRI，见下） |

**供应链说明**：Pyodide 通过 `importScripts` 从 jsDelivr 加载，该机制无法附加
Subresource Integrity 校验。项目通过固定到精确版本（`v0.26.4`）缓解版本漂移风险；
且该脚本运行在无 DOM、不接触 API Key 的独立 Worker 中。

## 浏览器本地 C++ 编译器（随仓库发行）

C++ 编译、链接与 WASI 执行均在同源 module Worker 内完成；源码、附带文件、stdin 和程序参数不会发送到 Compiler Explorer 或其它远程编译/执行服务。运行时只从本站按需加载已压缩的 Clang/LLD/WASI 静态资产。程序没有预打开文件系统或网络接口，且 Worker 可在超时后终止。首次使用需下载约 30 MB 的压缩工具链资源（随后可由浏览器静态缓存复用）。WASI SDK 25 目标不支持 C++ exceptions 或 threading；其余已支持能力见 `assets/vendor/cpp/README.md`。

- `browsercc@0.1.1`: MIT wrapper (`assets/vendor/cpp/browsercc/LICENSE`); compiler binaries are LLVM/Clang/LLD 20.1.2 under Apache-2.0 WITH LLVM-exception (`LICENSE-LLVM.TXT`). Emscripten-generated JavaScript glue is covered by the included dual MIT/NCSA notice (`LICENSE-EMSCRIPTEN.txt`).
- WASI SDK 25.0 sysroot / `libclang_rt`: notices in `LICENSE-WASI-SDK.txt`, `LICENSE-LLVM.TXT`, and the included `wasi-libc-*` files. The wasi-libc notice lists Apache-2.0/Apache-2.0 WITH LLVM-exception/MIT plus dlmalloc (CC0), emmalloc (MIT), cloudlibc (BSD-2-Clause), musl (MIT), and musl-fts (BSD-3-Clause); corresponding license texts/notices are included.
- `@bjorn3/browser_wasi_shim@0.4.2`: MIT OR Apache-2.0; both texts are in `assets/vendor/cpp/browser-wasi-shim/`.

The upstream Browsercc build script removes the sysroot's `share/` directory and `VERSION` before creating its tarball. To avoid dropping notices, this project keeps the relevant upstream license texts alongside the vendored assets. The `.gz` files are compressed copies of the uncompressed npm distribution assets; no optional 19 MB precompiled header is included.

## 用户自选模型文件（不随仓库发行）

设置页可让用户选择本机 GGUF 文件并复制到浏览器 OPFS。项目不捆绑、不托管、也不从固定仓库下载任何权重；所选模型文件不会上传到网关。模型架构、量化、参数规模、许可、能力与安全特性取决于用户选择的上游文件，Dubhe Agent 不对其作独立权利审查或基准测评。使用或再分发前，请自行阅读对应模型卡、来源与许可条款。

## 商标与图标

`assets/icons/` 下的供应商图标为各公司商标，仅用于识别对应服务，不构成背书；相关商标归各自权利人所有。

- `qwen.svg`：按用户指定的 [Wikimedia Commons: Qwen logo.svg](https://commons.wikimedia.org/wiki/File:Qwen_logo.svg) 下载（原文件：[upload.wikimedia.org](https://upload.wikimedia.org/wikipedia/commons/6/69/Qwen_logo.svg)）。Commons 页面列出上传者 Mr. Ibrahem 的 CC0 1.0 声明，但同时标有「版权状态信息可能不正确」警告；此文件按用户指定保留，来源不声称为 Qwen/Alibaba 官方上传，许可状态仍应以 Commons 后续核查为准。
- `kimi.svg`、`doubao.svg`、`minimax.svg`：由用户上传、文件名标注为 Zonalogo.com 的 SVG 文本按用户指示原样改扩展名；不是 Wikimedia 下载文件。附件不含许可声明，项目不为其另行推断许可或官方品牌来源。
- `xiaomi.svg`：由用户上传的「XiaomiMiMo」单色 SVG 文本按用户指示原样改扩展名；不是 Wikimedia 下载文件。附件不含许可声明，项目不为其另行推断许可或官方品牌来源。
- 其余已有图标：按 README 中各自来源说明使用。所有图标仅用于识别对应服务，不构成背书。

自定义网关图标由最终用户自行上传，保存在其浏览器本地，不随项目源码发行。项目不为这些上传文件判断作者、来源或许可；请由上传者自行确认有权使用。含 SVG 源码的 `.txt` 只在本机经安全清理后内嵌使用，不会原样提交进 `assets/`。

## 按需本地文档组件（V1.8）

| 组件 | 固定版本 | 许可 | 本地发行文件 |
|---|---|---|---|
| docx | 9.5.1 | MIT | `assets/vendor/office/docx-9.5.1.js`、`docx-LICENSE.txt` |
| PptxGenJS | 3.12.0 | MIT | `assets/vendor/office/pptxgenjs-3.12.0.js`、`pptxgenjs-LICENSE.txt` |
| pdf-lib | 1.17.1 | MIT | `assets/vendor/office/pdf-lib-1.17.1.js`、`pdf-lib-LICENSE.txt` |

来源、npm tarball integrity 和文件 SHA-256 记录在 `assets/vendor/office/NOTICE.json`。下载时核验了 npm 发行包完整性，发行文件保留原始字节；运行时按需从本站加载，不把用户文档发送给这些库的上游站点。
