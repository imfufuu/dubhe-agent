import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateGGUFMemory, formatGGUFMemoryWarning, formatParameterCount, readDeviceMemoryGB, readGGUFMetadata } from '../js/gguf.js';
import { makeGGUF } from './helpers/gguf-fixture.mjs';

test('GGUF parser extracts model identity, parameter count, architecture, context and quantization without loading tensor data', async () => {
  const file = makeGGUF({
    fileName: 'qwen-test-1.5B-Q4_K_M.gguf',
    modelName: 'Sample Qwen 1.5B',
    architecture: 'llama',
    parameterCount: 1_500_000_000n,
  });
  const parsed = await readGGUFMetadata(file);
  assert.equal(parsed.format, 'gguf');
  assert.equal(parsed.version, 3);
  assert.equal(parsed.displayName, 'Sample Qwen 1.5B');
  assert.equal(parsed.architecture, 'llama');
  assert.equal(parsed.parameterCount, 1_500_000_000);
  assert.equal(parsed.parameterCountSource, 'gguf-metadata');
  assert.equal(parsed.quantization, 'Q4_K_M');
  assert.equal(parsed.contextLength, 8192);
  assert.equal(parsed.blockCount, 24);
  assert.equal(parsed.embeddingLength, 2048);
  assert.equal(parsed.attentionHeads, 16);
  assert.equal(parsed.kvAttentionHeads, 4);
  assert.equal(parsed.fileSize, file.size);
});

test('GGUF parser skips large tokenizer string arrays and still reaches tensor descriptors', async () => {
  const file = makeGGUF({ tokenArray: ['hello', '世界', 'token-3'] });
  const parsed = await readGGUFMetadata(file);
  assert.equal(parsed.parameterCount, 1_000_000_000);
  assert.equal(parsed.displayName, 'Sample Model');
});

test('parameter count falls back to tensor-shape totals and clearly marks the estimate', async () => {
  const file = makeGGUF({ includeParameterCount: false, tensorShapes: [[10, 20], [5, 3]] });
  const parsed = await readGGUFMetadata(file);
  assert.equal(parsed.parameterCount, 215);
  assert.equal(parsed.parameterCountSource, 'tensor-shapes-estimate');
});

test('parameter count falls back to a model-name parameter suffix when tensor metadata is absent', async () => {
  const file = makeGGUF({
    fileName: 'llama-7B-Q4_K_M.gguf',
    modelName: 'A model without a count field',
    architecture: '',
    includeParameterCount: false,
    tensorShapes: [],
  });
  const parsed = await readGGUFMetadata(file);
  assert.equal(parsed.parameterCount, 7_000_000_000);
  assert.equal(parsed.parameterCountSource, 'filename-estimate');
});

test('GGUF parser rejects non-GGUF input, truncated headers and unsupported format versions', async () => {
  await assert.rejects(readGGUFMetadata(new Blob(['not a model file']), { fileName: 'wrong.bin' }), /有效的 GGUF/);
  await assert.rejects(readGGUFMetadata(new Blob([new Uint8Array(10)]), { fileName: 'short.gguf' }), /有效的 GGUF/);
  await assert.rejects(readGGUFMetadata(makeGGUF({ version: 99 })), /不支持 GGUF 版本/);
});

test('parameter-count and model-memory formatters stay explicit about estimates', () => {
  assert.equal(formatParameterCount(1_500_000_000, 'en'), '1.5B');
  assert.equal(formatParameterCount(70_000_000_000, 'en'), '70B');
  assert.equal(formatParameterCount(null, 'en'), 'unknown parameter count');
  const unknown = estimateGGUFMemory({ fileBytes: 900_000_000, metadata: {}, deviceMemoryGB: null });
  assert.equal(unknown.risk, 'unknown');
  assert.match(formatGGUFMemoryWarning(unknown, 'en'), /not expose an approximate device-memory value/);
});

test('memory estimate warns on a high working-set-to-device-memory ratio but treats navigator.deviceMemory as approximate', () => {
  const small = estimateGGUFMemory({
    fileBytes: 500 * 1024 ** 2,
    metadata: { blockCount: 24, embeddingLength: 2048, attentionHeads: 16, kvAttentionHeads: 4, contextLength: 8192 },
    deviceMemoryGB: 8,
  });
  const large = estimateGGUFMemory({
    fileBytes: 7 * 1024 ** 3,
    metadata: { blockCount: 80, embeddingLength: 8192, attentionHeads: 64, kvAttentionHeads: 8, contextLength: 32768 },
    deviceMemoryGB: 8,
  });
  assert.equal(small.risk, 'ok');
  assert.equal(large.risk, 'critical');
  assert.ok(large.estimatedWorkingSetBytes > small.estimatedWorkingSetBytes);
  assert.match(formatGGUFMemoryWarning(large, 'zh'), /很高/);
  assert.match(formatGGUFMemoryWarning(small, 'en'), /not a free-RAM measurement/);
});

test('device-memory capability returns only positive finite browser estimates', () => {
  assert.equal(readDeviceMemoryGB({ deviceMemory: 8 }), 8);
  assert.equal(readDeviceMemoryGB({ deviceMemory: 0 }), null);
  assert.equal(readDeviceMemoryGB({}), null);
});
