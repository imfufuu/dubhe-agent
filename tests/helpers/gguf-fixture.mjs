const encoder = new TextEncoder();

export function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Number(value), true);
  return bytes;
}

export function u64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

export function ggufString(value) {
  const bytes = encoder.encode(String(value));
  return concat(u64(bytes.length), bytes);
}

export function concat(...parts) {
  const arrays = parts.map((part) => part instanceof Uint8Array ? part : new Uint8Array(part));
  const result = new Uint8Array(arrays.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of arrays) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

export function makeGGUF({
  fileName = 'sample-1B-Q4_K_M.gguf',
  modelName = 'Sample Model',
  architecture = 'llama',
  parameterCount = 1_000_000_000n,
  includeParameterCount = true,
  tensorShapes = [[2, 4]],
  tokenArray = [],
  version = 3,
} = {}) {
  const entries = [
    concat(ggufString('general.architecture'), u32(8), ggufString(architecture)),
    concat(ggufString('general.name'), u32(8), ggufString(modelName)),
  ];
  if (includeParameterCount && parameterCount != null) {
    entries.push(concat(ggufString('general.parameter_count'), u32(10), u64(parameterCount)));
  }
  if (architecture) {
    entries.push(concat(ggufString(`${architecture}.block_count`), u32(4), u32(24)));
    entries.push(concat(ggufString(`${architecture}.embedding_length`), u32(4), u32(2048)));
    entries.push(concat(ggufString(`${architecture}.attention.head_count`), u32(4), u32(16)));
    entries.push(concat(ggufString(`${architecture}.attention.head_count_kv`), u32(4), u32(4)));
    entries.push(concat(ggufString(`${architecture}.context_length`), u32(4), u32(8192)));
  }
  if (tokenArray.length) {
    const tokenItems = tokenArray.map((token) => ggufString(token));
    entries.push(concat(
      ggufString('tokenizer.ggml.tokens'), u32(9), u32(8), u64(tokenItems.length), ...tokenItems,
    ));
  }
  const tensors = tensorShapes.map((shape, index) => concat(
    ggufString(`blk.${index}.weight`),
    u32(shape.length),
    ...shape.map((dimension) => u64(dimension)),
    u32(0),
    u64(0),
  ));
  const bytes = concat(
    encoder.encode('GGUF'),
    u32(version),
    u64(tensors.length),
    u64(entries.length),
    ...entries,
    ...tensors,
  );
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  Object.defineProperty(blob, 'name', { value: fileName, configurable: true });
  return blob;
}
