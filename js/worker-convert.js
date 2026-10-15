// ─── convert_file 的 ffmpeg 执行体（V1.8.1）───────────────────────────────────────
// 独立 classic Worker：首次使用时 importScripts 固定版本 UMD core（jsDelivr，immutable 缓存），
// 之后同一页面内复用；一次只跑一个任务（core 的 MEMFS 是共享的，排队避免互相覆盖 in.bin）。
// 崩溃 / 加载失败都向上报 fatal，由主线程把引擎标记为不可用，绝不静默重试打满流量。
const PKG_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
const CORE_URL = `${PKG_BASE}/ffmpeg-core.js`;
const CORE_WASM_URL = `${PKG_BASE}/ffmpeg-core.wasm`;

let corePromise = null;
function loadCore() {
  corePromise ||= (async () => {
    importScripts(CORE_URL);
    const factory = self.createFFmpegCore;
    if (typeof factory !== 'function') throw new Error('core 未暴露 createFFmpegCore');
    // UMD 版相对「宿主脚本」找 wasm（会打到本站 404 页面上），所以显式取回字节再喂给 Module
    let wasmBinary = null;
    try {
      const res = await fetch(CORE_WASM_URL);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 4));
        if (buf.byteLength > 1_000_000 && head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d) wasmBinary = buf;
      }
    } catch { /* 走下面的统一报错 */ }
    if (!wasmBinary) throw new Error(`下载 ffmpeg-core.wasm 失败（需要网络放行 ${PKG_BASE.replace('https://', '')}）`);
    const core = await factory({ wasmBinary });
    core.setLogger && core.setLogger(() => { /* 进度噪声不进 UI；错误行在任务里单独取 */ });
    return core;
  })().catch((err) => { corePromise = null; throw err; });
  return corePromise;
}

let chain = Promise.resolve();
const queue = [];
let started = false;

function handle(job) {
  return (async () => {
    const { id, bytes, args } = job;
    let core;
    try {
      core = await loadCore();
    } catch (err) {
      self.postMessage({ id, ok: false, fatal: true, error: `加载 ffmpeg.wasm 失败：${(err && err.message) || err}（检查网络是否放行 cdn.jsdelivr.net）` });
      throw err; // 断开后续队列
    }
    const logs = [];
    core.setLogger && core.setLogger(({ type, message }) => { if (type === 'stderr' || type === 'error' || type === 2 || type === 'info') logs.push(String(message || '')); });
    core.setProgress && core.setProgress((p) => {
      const v = Number((p && typeof p === 'object' ? p.progress : p) || 0);
      self.postMessage({ id, progress: Math.max(0, Math.min(99, Math.round(v * 100))) });
    });
    try {
      core.FS.writeFile('in.bin', new Uint8Array(bytes));
      const code = await core.exec(...args.map((a) => String(a)));
      const outFile = String(args[args.length - 1]);
      if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}：${logs.slice(-4).join(' | ').slice(0, 400) || '无错误输出'}`);
      const out = core.FS.readFile(outFile);
      for (const f of ['in.bin', outFile]) { try { core.FS.unlink(f); } catch { /* 已清理 */ } }
      self.postMessage({ id, ok: true, bytes: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) }, [out.buffer]);
    } catch (err) {
      try { core.FS.unlink('in.bin'); } catch { /* 已清理 */ }
      const tail = logs.slice(-6).join(' | ').slice(0, 400);
      const base = String((err && err.message) || (err && String(err) !== '[object Object]' && String(err)) || '').slice(0, 300);
      const msg = [base, base && base.includes(tail) ? '' : tail].filter(Boolean).join(' · ') || 'ffmpeg 任务异常（无更多信息）';
      self.postMessage({ id, ok: false, error: msg.slice(0, 700) });
    } finally {
      core.setProgress && core.setProgress(() => {});
    }
  })();
}

self.onmessage = (e) => {
  const job = e.data || {};
  if (job.op === 'ping') { self.postMessage({ id: job.id, ok: true }); return; }
  queue.push(job);
  chain = chain.then(() => handle(queue.shift()).catch(() => { /* 已回报 */ }));
};
void started;
