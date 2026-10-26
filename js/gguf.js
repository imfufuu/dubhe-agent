import { formatByteSize } from './offline-model-config.js';

const GGUF_MAGIC = [0x47, 0x47, 0x55, 0x46];
const CURSOR_CHUNK_BYTES = 256 * 1024;
const MAX_DECODED_STRING_BYTES = 64 * 1024;
const MAX_METADATA_ENTRIES = 250_000;
const MAX_STRING_ARRAY_ITEMS = 2_000_000;
const MAX_TENSOR_DESCRIPTORS = 250_000;
const MAX_TENSOR_DIMS = 8;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const FIXED_TYPE_BYTES = new Map([
  [0, 1],  // UINT8
  [1, 1],  // INT8
  [2, 2],  // UINT16
  [3, 2],  // INT16
  [4, 4],  // UINT32
  [5, 4],  // INT32
  [6, 4],  // FLOAT32
  [7, 1],  // BOOL
  [10, 8], // UINT64
  [11, 8], // INT64
  [12, 8], // FLOAT64
]);

const META_SCALAR_SUFFIX = /\.(?:block_count|embedding_length|context_length|attention\.head_count|attention\.head_count_kv|attention\.key_length|attention\.value_length)$/;
const META_STRING_KEYS = new Set(['general.name', 'general.architecture']);

function safeLength(value, label, remaining) {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > remaining) throw new Error(`GGUF 文件结构无效：${label} 超出文件范围。`);
  return n;
}

class BlobCursor {
  constructor(blob, chunkBytes = CURSOR_CHUNK_BYTES) {
    this.blob = blob;
    this.chunkBytes = chunkBytes;
    this.position = 0;
    this.bufferStart = 0;
    this.buffer = new Uint8Array(0);
  }

  async ensure(length) {
    const count = Number(length);
    if (!Number.isSafeInteger(count) || count < 0 || count > this.blob.size - this.position) {
      throw new Error('GGUF 文件不完整或头部长度无效。');
    }
    const end = this.position + count;
    if (this.position >= this.bufferStart && end <= this.bufferStart + this.buffer.byteLength) return;
    const chunkLength = Math.max(this.chunkBytes, count);
    const chunkEnd = Math.min(this.blob.size, this.position + chunkLength);
    this.bufferStart = this.position;
    this.buffer = new Uint8Array(await this.blob.slice(this.position, chunkEnd).arrayBuffer());
    if (this.buffer.byteLength < count) throw new Error('GGUF 文件不完整或头部长度无效。');
  }

  async bytes(length) {
    const count = Number(length);
    await this.ensure(count);
    const offset = this.position - this.bufferStart;
    const result = this.buffer.subarray(offset, offset + count);
    this.position += count;
    return result;
  }

  async skip(length, label = '字段') {
    const count = safeLength(length, label, this.blob.size - this.position);
    this.position += count;
  }

  async uint8() { return (await this.bytes(1))[0]; }
  async int8() {
    const bytes = await this.bytes(1);
    return new DataView(bytes.buffer, bytes.byteOffset, 1).getInt8(0);
  }
  async uint16() {
    const bytes = await this.bytes(2);
    return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true);
  }
  async int16() {
    const bytes = await this.bytes(2);
    return new DataView(bytes.buffer, bytes.byteOffset, 2).getInt16(0, true);
  }
  async uint32() {
    const bytes = await this.bytes(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  async int32() {
    const bytes = await this.bytes(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true);
  }
  async float32() {
    const bytes = await this.bytes(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true);
  }
  async uint64() {
    const bytes = await this.bytes(8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
  }
  async int64() {
    const bytes = await this.bytes(8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true);
  }
  async float64() {
    const bytes = await this.bytes(8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }

  async string({ decode = true, maxBytes = MAX_DECODED_STRING_BYTES } = {}) {
    const lengthBig = await this.uint64();
    const length = safeLength(lengthBig, '字符串', this.blob.size - this.position);
    if (!decode || length > maxBytes) {
      await this.skip(length, '字符串');
      return '';
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(await this.bytes(length));
  }
}

function shouldKeepMetadata(key) {
  return META_STRING_KEYS.has(key)
    || key === 'general.parameter_count'
    || key === 'general.file_type'
    || META_SCALAR_SUFFIX.test(key);
}

async function skipArray(cursor) {
  const elementType = await cursor.uint32();
  const countBig = await cursor.uint64();
  const count = safeLength(countBig, '数组项数', Number.MAX_SAFE_INTEGER);
  if (elementType === 8) {
    if (count > MAX_STRING_ARRAY_ITEMS) throw new Error('GGUF 元数据字符串数组过大，无法安全解析。');
    for (let i = 0; i < count; i++) {
      const lengthBig = await cursor.uint64();
      await cursor.skip(lengthBig, '数组字符串');
    }
    return;
  }
  const width = FIXED_TYPE_BYTES.get(elementType);
  if (!width) throw new Error(`GGUF 元数据包含不支持的数组类型 ${elementType}。`);
  const bytes = countBig * BigInt(width);
  if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GGUF 元数据数组超出安全解析范围。');
  await cursor.skip(Number(bytes), '元数据数组');
}

async function readMetadataValue(cursor, type, keep) {
  switch (type) {
    case 0: return cursor.uint8();
    case 1: return cursor.int8();
    case 2: return cursor.uint16();
    case 3: return cursor.int16();
    case 4: return cursor.uint32();
    case 5: return cursor.int32();
    case 6: return cursor.float32();
    case 7: return (await cursor.uint8()) !== 0;
    case 8: return cursor.string({ decode: keep });
    case 9: await skipArray(cursor); return undefined;
    case 10: return cursor.uint64();
    case 11: return cursor.int64();
    case 12: return cursor.float64();
    default: throw new Error(`GGUF 元数据包含不支持的值类型 ${type}。`);
  }
}

function finiteNumber(value) {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value === 'string' && value.trim()) value = Number(value.replace(/[,_\s]/g, ''));
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function valueFrom(metadata, architecture, suffix) {
  if (!architecture) return null;
  return finiteNumber(metadata[`${architecture}.${suffix}`]);
}

function parseParameterCountFromFilename(fileName = '') {
  const matches = [...String(fileName).matchAll(/(?:^|[-_.\s])(\d+(?:[._]\d+)?)\s*([bmk])(?=$|[-_.\s])/ig)];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  const value = Number(match[1].replace('_', '.'));
  const multiplier = match[2].toLowerCase() === 'b' ? 1e9 : match[2].toLowerCase() === 'm' ? 1e6 : 1e3;
  const result = Math.round(value * multiplier);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function parseQuantizationFromFilename(fileName = '') {
  const match = String(fileName).match(/(?:^|[-_.\s])((?:IQ|Q)\d+(?:_[A-Z0-9]+)+|F16|BF16|F32)(?=$|[-_.\s])/i);
  return match ? match[1].toUpperCase() : '';
}

function basename(value = '') {
  return String(value).split(/[\\/]/).pop() || '';
}

async function countTensorParameters(cursor, tensorCount) {
  if (tensorCount > MAX_TENSOR_DESCRIPTORS) return null;
  let total = 0n;
  for (let i = 0; i < tensorCount; i++) {
    const nameLength = await cursor.uint64();
    await cursor.skip(nameLength, '张量名称');
    const dimensions = await cursor.uint32();
    if (dimensions > MAX_TENSOR_DIMS) throw new Error('GGUF 张量维度数无效。');
    let count = dimensions === 0 ? 1n : 1n;
    for (let d = 0; d < dimensions; d++) count *= await cursor.uint64();
    await cursor.skip(12, '张量类型与偏移'); // uint32 type + uint64 offset
    total += count;
  }
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

/**
 * Read GGUF metadata without loading the full model into memory. Large strings and token arrays are skipped in bounded chunks.
 * Parameter count prefers the GGUF general.parameter_count field; tensor-shape and filename fallbacks are explicitly marked approximate.
 */
export async function readGGUFMetadata(file, { fileName = file?.name || '', maxMetadataEntries = MAX_METADATA_ENTRIES } = {}) {
  if (!file || typeof file.slice !== 'function' || !Number.isFinite(Number(file.size)) || file.size < 24) {
    throw new Error('请选择有效的 GGUF 模型文件。');
  }
  const cursor = new BlobCursor(file);
  const magic = await cursor.bytes(4);
  if (!GGUF_MAGIC.every((byte, index) => magic[index] === byte)) throw new Error('文件头不是 GGUF；请选择有效的 .gguf 模型文件。');
  const version = await cursor.uint32();
  if (![1, 2, 3].includes(version)) throw new Error(`不支持 GGUF 版本 ${version}。`);
  const tensorCountBig = await cursor.uint64();
  const metadataCountBig = await cursor.uint64();
  const tensorCount = safeLength(tensorCountBig, '张量数', Number.MAX_SAFE_INTEGER);
  const metadataCount = safeLength(metadataCountBig, '元数据项数', Number.MAX_SAFE_INTEGER);
  if (metadataCount > maxMetadataEntries) throw new Error('GGUF 元数据项数异常，拒绝解析该文件。');

  const metadata = Object.create(null);
  for (let i = 0; i < metadataCount; i++) {
    const key = await cursor.string({ decode: true, maxBytes: 4096 });
    const type = await cursor.uint32();
    const value = await readMetadataValue(cursor, type, shouldKeepMetadata(key));
    if (shouldKeepMetadata(key) && value !== undefined) metadata[key] = value;
  }

  const architecture = String(metadata['general.architecture'] || '').trim().slice(0, 80);
  let parameterCount = finiteNumber(metadata['general.parameter_count']);
  let parameterCountSource = parameterCount ? 'gguf-metadata' : 'unknown';
  if (!parameterCount && tensorCount > 0 && tensorCount <= MAX_TENSOR_DESCRIPTORS) {
    const tensorEstimate = await countTensorParameters(cursor, tensorCount);
    if (tensorEstimate > 0) {
      parameterCount = tensorEstimate;
      parameterCountSource = 'tensor-shapes-estimate';
    }
  }
  if (!parameterCount) {
    parameterCount = parseParameterCountFromFilename(fileName);
    if (parameterCount) parameterCountSource = 'filename-estimate';
  }

  const rawName = String(metadata['general.name'] || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
  const sourceName = basename(fileName).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240);
  const displayName = rawName || sourceName.replace(/\.gguf$/i, '') || '本地 GGUF';
  const contextLength = valueFrom(metadata, architecture, 'context_length');
  const blockCount = valueFrom(metadata, architecture, 'block_count');
  const embeddingLength = valueFrom(metadata, architecture, 'embedding_length');
  const attentionHeads = valueFrom(metadata, architecture, 'attention.head_count');
  const kvAttentionHeads = valueFrom(metadata, architecture, 'attention.head_count_kv') || attentionHeads;
  const keyLength = valueFrom(metadata, architecture, 'attention.key_length');
  const valueLength = valueFrom(metadata, architecture, 'attention.value_length');
  const quantization = parseQuantizationFromFilename(sourceName);

  return {
    format: 'gguf', version, fileName: sourceName, fileSize: Number(file.size),
    displayName, architecture,
    parameterCount, parameterCountSource,
    quantization,
    contextLength, blockCount, embeddingLength, attentionHeads, kvAttentionHeads, keyLength, valueLength,
  };
}

export function formatParameterCount(value, language = 'zh') {
  const count = finiteNumber(value);
  if (!count) return language === 'en' ? 'unknown parameter count' : '参数量未知';
  if (count >= 1e12) return `${(count / 1e12).toFixed(count >= 10e12 ? 0 : 1).replace(/\.0$/, '')}T`;
  if (count >= 1e9) return `${(count / 1e9).toFixed(count >= 10e9 ? 0 : 1).replace(/\.0$/, '')}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(count >= 100e6 ? 0 : 1).replace(/\.0$/, '')}M`;
  return Math.round(count).toLocaleString(language === 'en' ? 'en' : 'zh-CN');
}

/**
 * Conservative browser-side estimate, not a measurement of free RAM. navigator.deviceMemory is coarse and may be unavailable/capped.
 */
export function estimateGGUFMemory({ fileBytes = 0, metadata = {}, deviceMemoryGB = null, contextSize = 4096 } = {}) {
  const size = Math.max(0, Number(fileBytes) || 0);
  const layers = finiteNumber(metadata.blockCount);
  const embd = finiteNumber(metadata.embeddingLength);
  const heads = finiteNumber(metadata.attentionHeads);
  const kvHeads = finiteNumber(metadata.kvAttentionHeads) || heads;
  const keyLength = finiteNumber(metadata.keyLength) || (embd && heads ? embd / heads : null);
  const valueLength = finiteNumber(metadata.valueLength) || keyLength;
  const activeContext = Math.max(1, Number(contextSize) || 4096);
  const hasKvMetadata = layers > 0 && kvHeads > 0 && keyLength > 0 && valueLength > 0;
  const fallbackKvBytes = Math.max(256 * MIB, (finiteNumber(metadata.parameterCount) || 0) * 0.008);
  const kvCacheBytes = hasKvMetadata
    ? Math.ceil(layers * activeContext * kvHeads * (keyLength + valueLength) * 2)
    : Math.ceil(fallbackKvBytes);
  const runtimeOverheadBytes = 512 * MIB;
  const estimatedWorkingSetBytes = Math.ceil(size * 1.35 + kvCacheBytes + runtimeOverheadBytes);
  const ram = Number(deviceMemoryGB);
  const systemMemoryGB = Number.isFinite(ram) && ram > 0 ? ram : null;
  let risk = 'unknown';
  if (systemMemoryGB != null) {
    const ratio = estimatedWorkingSetBytes / (systemMemoryGB * GIB);
    risk = ratio >= 0.8 ? 'critical' : ratio >= 0.5 ? 'warning' : 'ok';
  }
  return {
    risk,
    estimatedWorkingSetBytes,
    kvCacheBytes,
    runtimeOverheadBytes,
    systemMemoryGB,
    contextSize: activeContext,
    source: hasKvMetadata ? 'gguf-hyperparameters' : 'conservative-fallback',
  };
}

export function readDeviceMemoryGB(navigatorImpl = globalThis.navigator) {
  const value = Number(navigatorImpl?.deviceMemory);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function formatGGUFMemoryWarning(estimate, language = 'zh') {
  const required = formatByteSize(estimate?.estimatedWorkingSetBytes || 0, language);
  const memory = estimate?.systemMemoryGB;
  if (language === 'en') {
    if (estimate?.risk === 'critical') return `High memory risk: estimated working set ${required} vs roughly ${memory} GiB device memory. Available RAM is lower than total RAM, so model loading is likely to fail.`;
    if (estimate?.risk === 'warning') return `Memory warning: estimated working set ${required} vs roughly ${memory} GiB device memory. Other apps and the browser need memory too; loading may fail.`;
    if (estimate?.risk === 'ok') return `Rough estimate: ${required} working set; browser-reported device memory is about ${memory} GiB. This is not a free-RAM measurement.`;
    return `Cannot assess RAM: this browser does not expose an approximate device-memory value. Estimated working set is ${required}; loading is not guaranteed.`;
  }
  if (estimate?.risk === 'critical') return `内存风险很高：模型工作集粗估约 ${required}，浏览器报告设备总内存约 ${memory} GiB。可用内存会低于总内存，加载很可能失败。`;
  if (estimate?.risk === 'warning') return `内存提示：模型工作集粗估约 ${required}，设备总内存约 ${memory} GiB；系统和浏览器也需要占用内存，加载可能失败。`;
  if (estimate?.risk === 'ok') return `粗略估算工作集约 ${required}；浏览器报告设备总内存约 ${memory} GiB。此值不是可用内存测量。`;
  return `无法评估 RAM：此浏览器未提供设备内存粗略值。模型工作集估算约 ${required}，不能保证加载成功。`;
}
