// A foreground workspace must not leave an invisible selection/focused input behind it.
// Do not intercept copy: selections and editable controls inside the workspace keep native behaviour.
export function focusForegroundWorkspace(root, doc = root.ownerDocument) {
  doc.getSelection?.()?.removeAllRanges();
  root.tabIndex = -1;
  root.focus({ preventScroll: true });
}
