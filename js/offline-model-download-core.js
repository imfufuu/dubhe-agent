const META_PREFIX = '__metadata__';
const DEFAULT_CHECKPOINT_BYTES = 1024 * 1024;

function abortError() {
  if (typeof DOMException === 'function') return new DOMException('Aborted', 'AbortError');
  const error = new Error('Aborted'); error.name = 'AbortError'; return error;
}
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(); }
function contentRange(value) {
  const match = String(value || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  return match ? { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) } : null;
}
// Older Wllama CacheManager versions persisted ETags after removing quotes and punctuation.
// Accept that legacy representation while still rejecting two distinct raw entity tags.
function sameEtag(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right || left === right) return true;
  const unquote = (value) => value.replace(/^W\//i, '').replace(/^"(.*)"$/, '$1');
  if (unquote(left) === unquote(right)) return true;
  const legacyNormalized = /^[A-Za-z0-9]+$/;
  const stripPunctuation = (value) => value.replace(/[^A-Za-z0-9]/g, '');
  return ((legacyNormalized.test(left) && /[^A-Za-z0-9]/.test(right))
      || (legacyNormalized.test(right) && /[^A-Za-z0-9]/.test(left)))
    && stripPunctuation(left) === stripPunctuation(right);
}
async function cancelBody(response) { try { await response?.body?.cancel(); } catch { /* best effort */ } }

async function savePartialMetadata(cacheDir, metadataFileName, metadata) {
  const handle = await cacheDir.getFileHandle(metadataFileName, { create: true });
  const writable = await handle.createWritable();
  try { await writable.write(JSON.stringify(metadata)); }
  finally { await writable.close(); }
}

export async function downloadOpfsFile({
  url,
  fileName,
  metadataFileName = `${META_PREFIX}${fileName}`,
  totalBytes,
  etag = '',
  metadata = {},
  signal,
  storage = globalThis.navigator?.storage,
  fetchImpl = globalThis.fetch,
  checkpointBytes = DEFAULT_CHECKPOINT_BYTES,
  onProgress = () => {},
} = {}) {
  const expectedSize = Math.max(0, Number(totalBytes) || 0);
  if (!url || !fileName || !expectedSize) throw new Error('Missing pinned model download parameters.');
  if (typeof fetchImpl !== 'function') throw new Error('This browser cannot fetch the model file.');
  if (typeof storage?.getDirectory !== 'function') throw new Error('OPFS is unavailable in this browser.');
  throwIfAborted(signal);

  const root = await storage.getDirectory();
  const cacheDir = await root.getDirectoryHandle('cache', { create: true });
  const fileHandle = await cacheDir.getFileHandle(fileName, { create: true });
  if (typeof fileHandle.createSyncAccessHandle !== 'function') throw new Error('Resumable OPFS writes are unavailable in this browser.');
  const access = await fileHandle.createSyncAccessHandle();
  let response = null;
  let closed = false;
  try {
    let loaded = Math.max(0, Number(access.getSize()) || 0);
    if (loaded > expectedSize) { access.truncate(0); loaded = 0; }
    const resumeOffset = loaded;
    onProgress({ loaded, total: expectedSize, phase: 'download' });

    let remoteEtag = '';
    try {
      const head = await fetchImpl(url, { method: 'HEAD', cache: 'no-store', signal });
      if (head.ok) {
        remoteEtag = head.headers.get('etag') || '';
        const headSize = Number(head.headers.get('content-length')) || 0;
        if (headSize && headSize !== expectedSize) throw new Error(`Pinned model size changed: expected ${expectedSize}, received ${headSize}.`);
      }
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
      if (/Pinned model size changed/.test(String(error?.message || error))) throw error;
      // Some mirrors reject HEAD. GET (and the final byte count + SHA-256) remains authoritative.
    }

    let offset = resumeOffset;
    if (offset > 0 && etag && remoteEtag && !sameEtag(etag, remoteEtag)) {
      access.truncate(0); offset = 0;
    }
    const requestFile = (start) => fetchImpl(url, {
      cache: 'no-store',
      ...(start > 0 ? { headers: { Range: `bytes=${start}-` } } : {}),
      ...(signal ? { signal } : {}),
    });
    await savePartialMetadata(cacheDir, metadataFileName, {
      ...metadata, originalURL: url, originalSize: expectedSize,
      etag: remoteEtag || etag || '', downloadState: 'partial',
    });

    if (offset === expectedSize) {
      access.flush();
      return { loaded: offset, total: expectedSize, etag: remoteEtag || etag || '' };
    }

    response = await requestFile(offset);
    if (response.status === 416 && offset > 0) {
      await cancelBody(response);
      if (offset === expectedSize) {
        access.flush();
        return { loaded: offset, total: expectedSize, etag: remoteEtag || etag || '' };
      }
      access.truncate(0); offset = 0; response = await requestFile(0);
    }
    if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}.`);

    if (response.status === 206) {
      const range = contentRange(response.headers.get('content-range'));
      if (!range || range.start !== offset || range.total !== expectedSize || range.end < range.start) {
        if (offset === 0) throw new Error('Model server returned an invalid byte range.');
        await cancelBody(response);
        access.truncate(0); offset = 0; response = await requestFile(0);
        if (!response.ok || !response.body || response.status !== 200) throw new Error('Model server rejected a clean restart.');
      }
    } else if (response.status === 200) {
      // A mirror that ignores Range is safe: discard the old bytes and consume its full response.
      if (offset > 0) { access.truncate(0); offset = 0; }
    } else {
      throw new Error(`Model server returned unexpected HTTP ${response.status}.`);
    }

    let responseEtag = response.headers.get('etag') || remoteEtag || etag || '';
    if (offset > 0 && etag && responseEtag && !sameEtag(etag, responseEtag)) {
      await cancelBody(response);
      access.truncate(0); offset = 0; response = await requestFile(0);
      if (!response.ok || !response.body || response.status !== 200) throw new Error('Model version changed; a clean download could not be started.');
      responseEtag = response.headers.get('etag') || remoteEtag || '';
    }
    await savePartialMetadata(cacheDir, metadataFileName, {
      ...metadata, originalURL: url, originalSize: expectedSize,
      etag: responseEtag, downloadState: 'partial',
    });

    let position = offset;
    let sinceFlush = 0;
    let lastReportAt = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        if (position + bytes.byteLength > expectedSize) throw new Error('Model response exceeded the pinned file size.');
        const written = access.write(bytes, { at: position });
        if (written !== bytes.byteLength) throw new Error('Short write while saving the model to OPFS.');
        position += written;
        sinceFlush += written;
        const now = Date.now();
        if (sinceFlush >= checkpointBytes) { access.flush(); sinceFlush = 0; }
        if (now - lastReportAt >= 100) {
          lastReportAt = now;
          onProgress({ loaded: position, total: expectedSize, phase: 'download' });
        }
      }
    } finally {
      try { await reader.cancel(); } catch { /* stream closed */ }
    }
    access.flush();
    onProgress({ loaded: position, total: expectedSize, phase: 'download' });
    if (position !== expectedSize) throw new Error(`Incomplete model response: ${position} / ${expectedSize} bytes. Download again to resume.`);
    return { loaded: position, total: expectedSize, etag: responseEtag };
  } catch (error) {
    try { access.flush(); } catch { /* preserve as much progress as possible */ }
    throw error;
  } finally {
    try { access.flush(); } catch { /* best effort */ }
    try { access.close(); closed = true; } catch { /* best effort */ }
    if (!closed) { /* allow the OPFS handle to be reclaimed by the worker */ }
  }
}
