// Project imports are deliberately reviewed before any project write. Text
// checks are local policy rules (not a promise of comprehensive detection);
// raster images require a successful local image model. Unsupported binary
// formats fail closed rather than being silently treated as reviewed.
import { moderateText, moderateImages } from './moderation.js?v=2026.10.25.1';
import { sniffImage, bytesToDataUrl } from './api.js?v=2026.10.25.1';
import { sanitizeSvgMarkup } from './svg-safety.js';

export async function reviewProjectImport(file, { textReview = moderateText, imageReview = moderateImages } = {}) {
  if (!file || file.size > 20 * 1024 * 1024) return { ok: false, reason: 'size' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = sniffImage(bytes);
  let text = null;
  if (!signature.mime && bytes.length <= 1024 * 1024 && !bytes.includes(0)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* binary */ }
  }
  if (!signature.mime && text == null) return { ok: false, reason: 'unreviewable-binary' };
  if (text != null) {
    for (let at = 0; at < text.length; at += 7800) {
      const decision = await textReview({ text: text.slice(at, at + 8000), apiKey: '' });
      if (!decision || decision.blocked || decision.error) return { ok: false, reason: 'text-review' };
    }
    if (/\.svg$/i.test(String(file.name || ''))) {
      const safe = sanitizeSvgMarkup(text);
      if (!safe) return { ok: false, reason: 'svg-invalid' };
      const image = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(safe);
      const decision = await imageReview({ attachments: [{ kind: 'image', name: file.name, dataUrl: image }], text: '', apiKey: '', remoteReview: false });
      if (!decision || decision.blocked || decision.degraded || decision.uncertain || decision.error || decision.skipped) return { ok: false, reason: 'image-review' };
    }
    return { ok: true, content: text, review: 'local-text-rules' };
  }
  const dataUrl = bytesToDataUrl(bytes, signature.mime);
  const decision = await imageReview({ attachments: [{ kind: 'image', name: file.name, dataUrl }], text: '', apiKey: '', remoteReview: false });
  if (!decision || decision.blocked || decision.degraded || decision.uncertain || decision.error || decision.skipped) return { ok: false, reason: 'image-review' };
  return { ok: true, content: dataUrl, review: 'local-image-model' };
}
