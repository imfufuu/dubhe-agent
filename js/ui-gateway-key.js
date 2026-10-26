import { DEFAULT_GATEWAY_ID, getGateway, validateGatewayApiKey } from './gateway-registry.js?v=2026.10.25.1';

export function syncGatewayKeyModal(gatewayId, input, title, description) {
  const spec = getGateway(gatewayId || DEFAULT_GATEWAY_ID);
  title.textContent = spec.keyLabel || `${spec.name} API Key`;
  input.placeholder = spec.keyHint || 'API Key';
  if (!description) return;
  description.textContent = 'Key 仅保存在本机浏览器，按所选网关直连发送；不会回退到其他网关。 ';
  const href = spec.id === DEFAULT_GATEWAY_ID ? 'https://teamorouter.com/dashboard?tab=api-keys' : spec.docsUrl;
  if (!href) return;
  const link = document.createElement('a');
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = spec.id === DEFAULT_GATEWAY_ID ? '在 TeamoRouter 控制台创建' : `${spec.name} 官方文档`;
  description.appendChild(link);
}

export function validateGatewayKey(value, gatewayId, isAdminAlias) {
  const key = String(value || '').trim();
  if (isAdminAlias(key)) return gatewayId === DEFAULT_GATEWAY_ID
    ? { ok: true } : { ok: false, reason: '管理员别名只适用于 TeamoRouter' };
  return validateGatewayApiKey(gatewayId || DEFAULT_GATEWAY_ID, key);
}
