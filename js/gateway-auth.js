// 网关访问令牌：给「无 API Key 的自建网关」（Cloudflare Workers AI 等）补上服务端可校验的凭据。
//
// 边界（务必阅读 AUTH_MATRIX.md）：
//  · 静态 GitHub Pages 前端无法持有服务端秘密。这里的令牌保存在浏览器 localStorage，
//    只对「私有部署、由部署者把令牌分发给自己的浏览器」有意义；任何能打开页面的人都能从
//    DevTools 读到它，因此它不是多用户身份认证，也不能替代 Cloudflare Access / WAF。
//  · 令牌刻意不写进 store.state：会话导出、分享链接、快照与同步都不应携带它。
//  · 不在仓库、客户端 JS 或日志里硬编码任何令牌；服务端从 Worker secret 读取。
const PREFIX = 'dubhe-gateway-token:';
const MAX_TOKEN_LENGTH = 512;

export function gatewayTokenKey(gatewayId) {
  return PREFIX + String(gatewayId || '').replace(/[^\w.-]/gu, '').slice(0, 64);
}

/** 读取某个网关的访问令牌；storage 缺省用浏览器 localStorage，失败时安全降级为空。 */
export function readGatewayToken(gatewayId, storage) {
  const store = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  try {
    const raw = String(store?.getItem(gatewayTokenKey(gatewayId)) ?? '').trim();
    return raw.slice(0, MAX_TOKEN_LENGTH);
  } catch { return ''; }
}

/** 写入 / 清除（空串即删除）某个网关的访问令牌。 */
export function writeGatewayToken(gatewayId, token, storage) {
  const store = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  const value = String(token ?? '').trim().slice(0, MAX_TOKEN_LENGTH);
  try {
    if (value) store?.setItem(gatewayTokenKey(gatewayId), value);
    else store?.removeItem(gatewayTokenKey(gatewayId));
    return true;
  } catch { return false; }
}

export function gatewayAuthHeader(gatewayId, storage) {
  const token = readGatewayToken(gatewayId, storage);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'x-goog-api-key']);

/**
 * 只在该请求尚无鉴权头时注入网关令牌，永远不覆盖 API Key / Anthropic / Gemini 原生凭据。
 * 这样 streamChat、gatewayRequest、模型列表、vision 等所有经 request()/authHeaders() 的路径都一致。
 */
export function mergeGatewayAuth(headers, gatewayId, storage) {
  const base = headers && typeof headers === 'object' ? headers : {};
  if (Object.keys(base).some((k) => SENSITIVE_HEADERS.has(String(k).toLowerCase()))) return base;
  const auth = gatewayAuthHeader(gatewayId, storage);
  return Object.keys(auth).length ? { ...auth, ...base } : base;
}
