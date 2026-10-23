import { downloadOpfsFile } from './offline-model-download-core.js';

let activeController = null;
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'abort') { activeController?.abort(); return; }
  if (data.type !== 'download' || activeController) return;
  const controller = new AbortController();
  activeController = controller;
  downloadOpfsFile({ ...data, signal: controller.signal, onProgress: (progress) => self.postMessage({ type: 'progress', ...progress }) })
    .then((result) => self.postMessage({ type: 'done', ...result }))
    .catch((error) => self.postMessage({ type: error?.name === 'AbortError' ? 'aborted' : 'error', name: error?.name || 'Error', message: String(error?.message || error) }))
    .finally(() => { activeController = null; });
});
