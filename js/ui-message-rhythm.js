// Match spacing across stored messages and streamed fragments. Hidden merge shells
// must not insert a phantom paragraph break between adjacent tool rows.
export function syncMessageRhythm(root) {
  let previous = null;
  for (const node of root.children) {
    node.classList.remove('tools-continue');
    if (!node.matches('.msg')) continue;
    if (node.classList.contains('msg-collapsed')) continue;
    if (!node.classList.contains('msg-assistant')) { previous = null; continue; }
    const surfaces = [];
    const visit = (container) => {
      for (const child of container.children) {
        if (child.hidden) continue;
        if (child.matches('.assistant-flow, .assistant-fragment')) visit(child);
        else if (child.matches('.md-body') && !child.classList.contains('empty') && child.textContent.trim()) surfaces.push('text');
        else if (child.matches('.tool-chips') && child.children.length) surfaces.push('tools');
        else if (child.matches('.edited-files, .explored-files, .web-activity, .reasoning, .md-fold')) surfaces.push('tools');
      }
    };
    visit(node);
    if (!surfaces.length) continue;
    if (previous?.tail === 'tools' && surfaces[0] === 'tools') previous.node.classList.add('tools-continue');
    previous = { node, tail: surfaces.at(-1) };
  }
}
