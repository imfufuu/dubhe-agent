/** Keep controls on the final assistant node while preserving each completed assistant's own metadata line. */
export function settleTurnToolbars(root, messages) {
  if (!root || !Array.isArray(messages)) return;
  const nodes = [...root.querySelectorAll('.msg[data-id]')];
  const byId = new Map(nodes.map((node) => [String(node.dataset.id), node]));

  // Within one message the cancellation marker must stay immediately above the toolbar.
  for (const node of nodes) {
    const bar = node.querySelector(':scope > .msg-toolbar');
    if (!bar) continue;
    const tail = node.querySelector(':scope > .message-tail');
    if (tail && tail.nextElementSibling !== bar) node.insertBefore(tail, bar);
    if (node.lastElementChild !== bar) node.append(bar);
  }

  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role !== 'user') continue;
    let end = i + 1;
    while (end < messages.length && messages[end]?.role !== 'user') end++;
    const assistants = messages.slice(i + 1, end)
      .filter((message) => message?.role === 'assistant' && !message.transientModeration && !message.moderation?.blocked)
      .map((message) => byId.get(String(message.id)))
      .filter(Boolean);
    if (!assistants.length) continue;

    const last = assistants.at(-1);
    const bars = assistants.map((node) => node.querySelector(':scope > .msg-toolbar')).filter(Boolean);
    if (!bars.length) continue;
    // The last assistant's bar carries its own click-handler closures and the finished-turn footer.
    // Fall back to the last available bar only when the final assistant node has no toolbar yet.
    const keep = last.querySelector(':scope > .msg-toolbar') || bars.at(-1);
    for (const bar of bars) {
      if (bar === keep) continue;
      bar.querySelector(':scope > .msg-actions')?.remove();
      const foot = bar.querySelector(':scope > .msg-foot');
      if (!foot || foot.hidden || !foot.textContent.trim()) bar.remove();
    }
    if (keep.parentElement !== last) last.append(keep);
    else if (last.lastElementChild !== keep) last.append(keep);
    const tail = last.querySelector(':scope > .message-tail');
    if (tail && tail.nextElementSibling !== keep) last.insertBefore(tail, keep);
  }
}
