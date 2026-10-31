// 语言包的底层存储：不依赖任何模块（locale.js 与 registry.js 都从这里读取，避免循环引用）。
const packs = new Map();

export function putPackEntries(lang, entries) {
  const bucket = packs.get(lang) || Object.create(null);
  for (const [source, translation] of Object.entries(entries)) bucket[String(source).trim()] = translation;
  packs.set(lang, bucket);
  return bucket;
}

export function getPackEntry(lang, source) {
  const bucket = packs.get(lang);
  const key = String(source ?? '').trim();
  return bucket && Object.hasOwn(bucket, key) ? bucket[key] : undefined;
}

export function packLanguages() {
  return [...packs.keys()];
}
