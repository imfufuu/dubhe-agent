// Canonical spelling shared by tool execution, authorization and scheduling.
export function normalizeFsPath(path) {
  const parts = String(path == null ? '' : path).trim().split('/').map(s => s.trim()).filter(s => s && s !== '.');
  if (!parts.length || parts.includes('..') || /[\u0000-\u001f]/.test(parts.join('/'))) return '';
  return parts.join('/');
}
