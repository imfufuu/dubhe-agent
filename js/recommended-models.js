// 经过真实 CPU 推理验证的超轻量 GGUF（2026-11-09，见 REAL_MODEL_TEST_REPORT.md）。
// 模型文件不随仓库分发（105 MB / 469 MB）：由用户从 Hugging Face 下载后在
// 「设置 → 离线本地模型 → 选择 GGUF 文件」导入 OPFS，全程不上传。
import { formatByteSize } from './offline-model-config.js';

export const RECOMMENDED_LIGHTWEIGHT_MODELS = Object.freeze([
  Object.freeze({
    id: 'qwen2.5-0.5b-instruct-q4_k_m',
    name: 'Qwen2.5 0.5B Instruct',
    quantization: 'Q4_K_M',
    fileName: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    repository: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    modelCardUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct',
    bytes: 491400032,
    sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
    parameterCount: 630167424,
    architecture: 'qwen2',
    contextLength: 32768,
    chatTemplate: 'chatml',
    languages: Object.freeze(['zh', 'en']),
    verified: true,
    noteZh: '推荐：中文、英文、代码与简单推理 4 项真实测试全部通过',
    noteEn: 'Recommended: all four real-inference checks passed (Chinese, English, code, reasoning)',
  }),
  Object.freeze({
    id: 'smollm2-135m-instruct-q4_k_m',
    name: 'SmolLM2 135M Instruct',
    quantization: 'Q4_K_M',
    fileName: 'SmolLM2-135M-Instruct-Q4_K_M.gguf',
    repository: 'bartowski/SmolLM2-135M-Instruct-GGUF',
    downloadUrl: 'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf',
    modelCardUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct',
    bytes: 105454432,
    sha256: '2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d',
    parameterCount: 134515008,
    architecture: 'llama',
    contextLength: 8192,
    chatTemplate: 'chatml',
    languages: Object.freeze(['en']),
    verified: 'english-only',
    noteZh: '最轻量（105 MB）；英文/代码/推理可用，中文输出会退化',
    noteEn: 'Smallest (105 MB); English/code/reasoning OK, Chinese output degrades',
  }),
]);

export function recommendedModelById(id) {
  return RECOMMENDED_LIGHTWEIGHT_MODELS.find((m) => m.id === String(id || '')) || null;
}
export function recommendedModelLabel(model) {
  return `${model.name} ${model.quantization}（${formatByteSize(model.bytes)}）`;
}
