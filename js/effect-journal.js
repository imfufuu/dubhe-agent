// Small synchronous write-ahead record for potentially billable or irreversible
// calls. It contains no prompts, request bodies, credentials or file contents.
// Browser storage is not a cross-tab lock or a remote exactly-once guarantee.
import { STORAGE_KEY } from './config.js?v=2026.10.25.1';
import { LOCAL_DESKTOP_MUTATING } from './localmachine.js';
import { normalizeFsPath } from './fs-path.js';
export const EFFECT_JOURNAL_KEY = `${STORAGE_KEY}-effects-v1`;
const MAX_RECORDS = 96;

export function requiresEffectJournal(name, args = {}, contract = {}) {
  if (name === 'generate_image' && Array.isArray(args.compare_paths) && args.compare_paths.map(normalizeFsPath).filter(Boolean).length >= 2) return false;
  if (name === 'run_git' && args.scope === 'project') return false;
  if (name === 'pull_github_project') return false; // remote read, local-only extraction
  if (name === 'local_files') return ['write', 'mkdir', 'move', 'delete'].includes(String(args.action || '').toLowerCase());
  if (name === 'local_desktop') return LOCAL_DESKTOP_MUTATING.includes(String(args.action || '').toLowerCase());
  return name === 'run_shell' || (contract.external === true && contract.idempotent === false);
}

export function createEffectJournal({ storage } = {}) {
  function getStorage() {
    if (storage) return storage;
    try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* blocked */ }
    throw new Error('浏览器本地存储不可用，无法为外部副作用记录防重复日志');
  }
  function read() {
    const raw = getStorage().getItem(EFFECT_JOURNAL_KEY);
    if (!raw) return [];
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('外部副作用日志损坏，不能安全重发'); }
    if (!Array.isArray(data) || data.some(row => !row || typeof row.key !== 'string' || !['in-flight', 'succeeded', 'failed', 'uncertain'].includes(row.status))) throw new Error('外部副作用日志格式无效，不能安全重发');
    return data;
  }
  function write(rows) {
    // Unresolved entries may never be discarded just to make room for new ones.
    const unresolved = rows.filter(row => row.status === 'in-flight' || row.status === 'uncertain');
    if (unresolved.length > MAX_RECORDS) throw new Error('未核验的外部操作过多，无法安全记录新操作');
    const remaining = MAX_RECORDS - unresolved.length;
    const done = remaining ? rows.filter(row => row.status !== 'in-flight' && row.status !== 'uncertain').slice(-remaining) : [];
    getStorage().setItem(EFFECT_JOURNAL_KEY, JSON.stringify([...done, ...unresolved]));
  }
  return {
    lookup(key, { fingerprint = '', knownSessions = [] } = {}) {
      const rows = read();
      // If a brand-new session did not finish saving before a crash, its ID
      // can change on reload. Unresolved effects match across sessions; a
      // success also matches if its original session was lost before saving.
      const unresolved = fingerprint && rows.find(item => item.fingerprint === fingerprint && (item.status === 'in-flight' || item.status === 'uncertain'));
      const row = unresolved || rows.find(item => item.key === key) || (fingerprint && rows.find(item => item.fingerprint === fingerprint && item.status === 'succeeded' && item.sessionId && !knownSessions.includes(item.sessionId)));
      return row ? { ...row, status: row.status === 'in-flight' ? 'uncertain' : row.status } : null;
    },
    begin({ key, tool, turnId, sessionId = '', fingerprint = '' }) {
      const rows = read().filter(row => row.key !== key);
      rows.push({ key: String(key), ...(fingerprint ? { fingerprint: String(fingerprint) } : {}), ...(sessionId ? { sessionId: String(sessionId) } : {}), tool: String(tool), turnId: String(turnId), status: 'in-flight', at: Date.now() });
      write(rows);
    },
    settle(key, status) {
      if (!['succeeded', 'failed', 'uncertain'].includes(status)) throw new Error('Invalid journal status');
      const rows = read(), row = rows.find(item => item.key === key);
      if (!row) throw new Error('外部副作用日志丢失');
      row.status = status; row.at = Date.now(); write(rows);
    },
  };
}
