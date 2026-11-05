// Keep moderation-only video frames out of persisted messages and the sandbox,
// without mutating attachments owned by the composer or another caller.
export function prepareTurnAttachments(input = []) {
  const attachments = [], forModeration = [];
  for (const item of input) {
    if (item && Array.isArray(item.frames)) {
      const { frames, ...stored } = item;
      attachments.push(stored);
      forModeration.push({ ...stored, frames });
    } else {
      attachments.push(item);
      forModeration.push(item);
    }
  }
  return { attachments, forModeration };
}
