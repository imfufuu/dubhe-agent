// 本机能力（shell / 截图 / 本机文件）的前端客户端。
// 只连接本地 server.py 的同源 /api/local/*，永不经 Cloudflare Worker 或第三方网关。
// token 由 /api/local/session 下发，只保存在内存里；服务端重启或返回 401 时自动作废并重新探测。
export const LOCAL_MACHINE_TOOLS = Object.freeze(['run_shell', 'take_screenshot', 'local_files', 'local_desktop']);
// local_desktop 中会改变桌面状态的动作：每次必须人工确认（只读动作：info / windows / processes / clipboard_read）
export const LOCAL_DESKTOP_MUTATING = Object.freeze(['focus', 'clipboard_write', 'open', 'mouse_move', 'click', 'scroll', 'key', 'type']);
export const LOCAL_DESKTOP_ACTIONS = Object.freeze(['info', 'windows', 'processes', 'clipboard_read', ...LOCAL_DESKTOP_MUTATING]);
export const LOCAL_MACHINE_OUTPUT_CHARS = 48 * 1024;

let available = false;
let session = null;
let lastProbe = 0;
let pending = null;

export const localMachineAvailable = () => available;
export const localMachineInfo = () => (session ? { platform: session.platform, fs: session.fs, screenshot: !!session.screenshot, desktop: session.desktop || null } : null);
export function resetLocalMachineProbe() { available = false; session = null; lastProbe = 0; pending = null; }

export async function probeLocalMachine({ signal, force = false } = {}) {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol || '')) return false;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (pending) return pending;
  if (!force && lastProbe && Date.now() - lastProbe < 30000) return available;
  pending = (async () => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    // 竞速兜底：即使 fetch 实现不响应中止信号，探测也必须在 9 秒内返回，绝不能卡住对话发送
    let timer = null;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => { abort(); resolve(null); }, 9000); });
    try {
      const response = await Promise.race([fetch('/api/local/session', { signal: controller.signal, cache: 'no-store' }), timeout]);
      const info = response && response.ok && /application\/json\b/i.test(response.headers?.get('Content-Type') || '')
        ? await response.json() : {};
      const ok = info.ok === true && typeof info.token === 'string' && info.token.length >= 32;
      available = ok && !!info.platform?.available;
      session = ok ? info : null;
      return available;
    } catch (err) {
      available = false; session = null;
      if (signal?.aborted) throw err;
      return false;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      lastProbe = Date.now(); pending = null;
    }
  })();
  return pending;
}

async function localCall(method, path, body, { signal } = {}) {
  if (!available || !session) await probeLocalMachine({ signal, force: true });
  if (!available || !session) throw new Error('本机能力不可用：请用 python3 server.py（或 Windows 上的 python server.py）在本机启动，且不要加 --no-local');
  const headers = { 'X-Dubhe-Local-Token': session.token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method, headers, cache: 'no-store', signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) { available = false; session = null; lastProbe = 0; }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `本机请求失败（HTTP ${response.status}）`);
  return data;
}

export const localShell = (args, opts) => localCall('POST', '/api/local/shell', args, opts);
export const localScreenshot = (opts) => localCall('GET', '/api/local/screenshot', undefined, opts);
export const localFsRequest = (args, opts) => localCall('POST', '/api/local/fs', args, opts);
export const localDesktopRequest = (args, opts) => localCall('POST', '/api/local/desktop', args, opts);

/** 截断工具输出，防止一次 shell 把上下文撑满；返回 { text, clipped }。 */
export function clipLocalOutput(text, limit = LOCAL_MACHINE_OUTPUT_CHARS) {
  const s = String(text || '');
  if (s.length <= limit) return { text: s, clipped: false };
  return { text: `${s.slice(0, limit)}\n…（已截断，原始 ${s.length} 字符）`, clipped: true };
}
