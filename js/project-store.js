// One persistent project per browser profile, independent of every chat sandbox.
// Project writes are explicit; opening or switching conversations never imports files.
import { isSafeFsPath, contentByteSize } from './sandbox.js';
import { SANDBOX_STORAGE_CAP } from './storagefmt.js';
import { blobsSupported } from './blobstore.js';

export function createProjectFS(store) {
  function project() {
    if (!store.state.project || typeof store.state.project !== 'object') store.state.project = { name: 'Project', files: {}, blobFiles: {} };
    const p = store.state.project;
    p.files ||= {}; p.blobFiles ||= {};
    return p;
  }
  function checkReady() {
    const p = project();
    // A missing IDB blob must not be mistaken for a deleted project file. Refuse
    // mutations until it can be restored, including when hydration itself failed.
    if (Object.keys(p.blobFiles).some(path => !Object.hasOwn(p.files, path))) throw new Error('项目文件仍在恢复或本地存储不可用；请等待恢复或修复浏览器存储后再写入。');
  }
  function validate(next) {
    const cap = blobsSupported() ? SANDBOX_STORAGE_CAP : 2 * 1024 * 1024;
    if (Object.keys(next).length > 5000 || Object.entries(next).some(([path, v]) => !isSafeFsPath(path) || typeof v !== 'string') || Object.values(next).reduce((n, v) => n + contentByteSize(v), 0) > cap) throw new Error(blobsSupported() ? '项目文件数量或容量超限' : '当前浏览器没有 IndexedDB，项目容量限制为 2 MB，避免数据丢失');
  }
  function blobKey(path) { return `p:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}:${path}`; }
  function setBlobIndex(p, path, value) { if (value.length > 16 * 1024) p.blobFiles[path] = blobKey(path); else delete p.blobFiles[path]; }
  function notify() { if (typeof store.notify === 'function') store.notify(); else store.save?.(); }
  const fs = {
    read(path) {
      const p = project(), key = String(path || '');
      if (!Object.hasOwn(p.files, key)) throw new Error(Object.hasOwn(p.blobFiles, key) ? `项目文件尚未恢复: ${key}` : `项目文件不存在: ${key}`);
      return p.files[key];
    },
    write(path, content) {
      checkReady(); const key = String(path || '');
      if (!isSafeFsPath(key)) throw new Error(`非法项目路径: ${key}`);
      const value = String(content ?? ''), p = project();
      const next = { ...p.files, [key]: value };
      validate(next);
      p.files = next; setBlobIndex(p, key, value); notify();
    },
    remove(path) {
      checkReady(); const key = String(path || ''); if (!isSafeFsPath(key)) throw new Error('非法项目路径');
      const p = project(), next = { ...p.files }; delete next[key]; p.files = next; delete p.blobFiles[key]; notify();
    },
    replaceAll(files) {
      checkReady(); const next = { ...files }; validate(next); const p = project(), old = p.files;
      for (const path of Object.keys(p.blobFiles)) if (!Object.hasOwn(next, path)) delete p.blobFiles[path];
      for (const [path, value] of Object.entries(next)) if (old[path] !== value) setBlobIndex(p, path, value);
      p.files = next; notify();
    },
    list() { return Object.entries(project().files).map(([path, value]) => ({ path, size: contentByteSize(value) })); },
    export() { checkReady(); return { ...project().files }; },
    has(path) { return Object.hasOwn(project().files, String(path)); },
    keys() { return Object.keys(project().files); },
  };
  project();
  return fs;
}
export function isProjectUserPath(path) {
  const p = String(path || '');
  return isSafeFsPath(p) && !p.split('/').some(part => part === '.git' || part === 'internal');
}
