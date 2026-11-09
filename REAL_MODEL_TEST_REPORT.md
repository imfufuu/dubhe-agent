# 超轻量本地 LLM 真实推理测试报告（2026-11-09）

## 1. 结论

从 Hugging Face 拉取并真机（CPU）验证了 2 个超轻量 GGUF。**最终推荐 `Qwen2.5-0.5B-Instruct Q4_K_M`**：英文事实、代码生成、中文对话、简单推理 4 项全部产出正确结果。`SmolLM2-135M-Instruct Q4_K_M` 更轻（105 MB）但中文输出退化，仅建议英文场景。

模型文件**不随仓库分发**（105 MB / 469 MB，超过 Pages 单文件合理体积）；`js/recommended-models.js` 提供 HF 直链、字节数、SHA-256 与 GGUF 元数据，设置页给出下载入口，用户下载后在「设置 → 离线本地模型 → 选择 GGUF 文件」导入 OPFS，全程不上传。

## 2. 测试环境

| 项 | 值 |
|---|---|
| 推理引擎 | llama.cpp `b12212` / `0.9.0-dev` (commit d78f4255d)，Linux x86_64 CPU 预编译包 |
| 线程 / 采样 | `-t 4`，`--temp 0.2`，`--top-p 0.9`，`-n 64`，`-st`（单轮），`--no-warmup` |
| 提示模板 | ChatML：`<\|im_start\|>system … <\|im_end\|> … <\|im_start\|>assistant` |
| 复现 | `python3 tools/real-model-smoke.py --model-file <gguf> --llama-cli <path> --json /tmp/smoke.json` |
| 应用侧校验 | `js/gguf.js` 的 `readGGUFMetadata()` / `estimateGGUFMemory()` 用真实文件解析通过 |

## 3. 调试过程（发现问题 → 换模型）

**第一候选：`bartowski/SmolLM2-135M-Instruct-GGUF` · Q4_K_M**

- 文件 105,454,432 bytes，SHA-256 `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d`
- 应用侧解析：GGUF v3，134,515,008 参数，`Q4_K_M`，`llama`，上下文 8192；8 GiB 设备下估算工作集 ~738 MiB，`risk: ok`
- 英文/代码/推理正常，但中文样例输出为「你是一个英雄，你可以在这里提供一句话，你在这里提供一句话…」**循环退化**；把 `--temp 0 --repeat-penalty 1.15` 后变成英文自我介绍，仍不符合中文指令 → 判定中文不可用，换模型。

**最终：`Qwen/Qwen2.5-0.5B-Instruct-GGUF` · Q4_K_M**

- 文件 491,400,032 bytes（首次下载被 tmpfs 空间截断，改存磁盘缓存后完整校验通过），SHA-256 `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`
- 应用侧解析：GGUF v3，630,167,424 参数，`Q4_K_M`，`qwen2`，上下文 32768；8 GiB 设备下估算工作集 ~1.16 GiB，`risk: ok`

## 4. 测试样例与真实输出（Qwen2.5-0.5B-Instruct Q4_K_M）

| # | 类型 | 输入 | 模型输出 | 耗时 | Prompt / Generation |
|---|---|---|---|---|---|
| S1 | 英文事实 | `What is the capital of France? Answer in one short sentence.` | `The capital of France is Paris.` | 2.14 s | 133.8 / 19.1 t/s |
| S2 | 代码生成 | `Write a Python function add(a, b) that returns their sum. Output code only.` | ````python\ndef add(a, b):\n    return a + b\n```` | 2.40 s | 143.3 / 20.1 t/s |
| S3 | 中文对话 | `用一句话介绍你自己。`（系统：你是一个乐于助人的中文助手。） | `我是Qwen，由阿里云创建的AI助手，专门用于提供信息、解答问题、处理任务等。` | 2.65 s | 143.0 / 20.4 t/s |
| S4 | 简单推理 | `If all cats are animals and Tom is a cat, is Tom an animal? Answer yes or no.` | `Yes.` | 1.82 s | 108.9 / 20.3 t/s |

四个样例均 `exit=0` 且输出非空、语义正确。**调试到可用状态** ✓。

对照（SmolLM2 135M，同样 4 样例）：S1 `The capital of France is Paris.`、S2 同样的 `add` 函数、S4 `Yes` 均正确；S3 中文为重复退化（见第 3 节）。速度更快（Generation 34.7–45.1 t/s），适合纯英文轻量场景。

## 5. 部署与导入

1. 代码侧：`js/recommended-models.js`（直链 + 校验和 + 元数据）、设置页「推荐已验证的超轻量模型」下载入口、`tools/real-model-smoke.py`（可复现）、本报告 —— 随 `main` 推送并由 CI / Pages 部署。
2. 模型侧：用户点设置页链接从 Hugging Face 下载 GGUF（或命令行 `curl -L -O <downloadUrl>`），用 `sha256sum` 核对上表校验和。
3. 应用内：设置 → 离线本地模型 → 选择该 `.gguf` → 写入 OPFS；模型选择器出现「本地 GGUF」，断网后仍可推理。项目已有 wllama 3.8.1 WASM 运行时与 `max_tokens` 移除修复（不再报 4096 上限）。
4. 许可：上游模型卡（Qwen / SmolLM2）为准，本报告只验证技术可用性。

## 6. 局限

- 真机 CPU 推理验证；**未在浏览器 wllama WASM 里跑这两个文件**（浏览器 OPFS 配额与 WASM 内存行为需真浏览器 E2E 补测）。
- 单轮短输出（64 tokens）测试；长对话、工具调用、流式输出未覆盖。
- 0.5B 级别模型知识有限，仅用于连通性/轻量离线演示，不替代云端网关模型。
