// Presentation-only line diff. Full candidate content remains available to the kernel.
import { diffLines } from '../assets/vendor/jsdiff/diff/line.js';

export function changedLines(before, after) {
  const normalize = (s) => String(s ?? '').replace(/\r\n?/g, '\n');
  // Bound work during streamed parameter repaint. Never pretend a timed-out diff is
  // an exact +N/-N, nor fall back to exposing the full file as a "diff".
  const parts = diffLines(normalize(before), normalize(after), { timeout: 40 });
  if (!parts) return { changes: [], added: null, removed: null, diffUnavailable: true };
  let oldNo = 1, newNo = 1, added = 0, removed = 0, hunk = 0, gap = true;
  const changes = [];
  for (const part of parts) {
    if (!part.added && !part.removed) { oldNo += part.count; newNo += part.count; gap = true; continue; }
    if (gap) { hunk++; gap = false; }
    const lines = part.value.split('\n');
    if (lines.at(-1) === '') lines.pop();
    for (const text of lines) {
      const kind = part.added ? 'add' : 'del';
      changes.push({ kind, no: part.added ? newNo++ : oldNo++, text, hunk });
      if (part.added) added++; else removed++;
    }
  }
  return { changes, added, removed, diffUnavailable: false };
}
