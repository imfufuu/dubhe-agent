// Summary choices preserve their exact position. Code/quoted examples are not controls.
export function choiceOptions(body) {
  const lines = String(body || '').split('\n');
  const listed = lines.map(line => /^\s*(?:[-*+•]|\d+[.)]|[A-Za-z][.)])\s+(.+?)\s*$/.exec(line)?.[1]).filter(Boolean);
  return listed.length ? listed : lines.map(x => x.trim()).filter(Boolean);
}
export function extractChoices(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n'), output = [], groups = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], code = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (code) { if (!fence) fence = { char: code[1][0], length: code[1].length }; else if (code[1][0] === fence.char && code[1].length >= fence.length && /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*$/.test(line)) fence = null; output.push(line); continue; }
    if (fence) { output.push(line); continue; }
    const open = /^[ \t]{0,3}:::choice(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (!open) { output.push(line); continue; }
    let end = -1, body = [], following = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (/^[ \t]{0,3}:::[ \t]*(?:>.*)?$/.test(lines[j])) { end = j; following = /^[ \t]{0,3}:::[ \t]*(>.*)$/.exec(lines[j])?.[1] || ''; break; }
      const inline = /^(.*\S)[ \t]+:::[ \t]*$/.exec(lines[j]);
      if (inline && /^\s*(?:[-*+•]|\d+[.)]|[A-Za-z][.)])\s+/.test(inline[1])) { body.push(inline[1]); end = j; break; }
      if (/^\s*:::choice\b/.test(lines[j]) || /^\s*(`{3,}|~{3,})/.test(lines[j])) break;
      body.push(lines[j]);
    }
    if (end < 0 || !choiceOptions(body.join('\n')).length) { output.push(line); continue; }
    const block = { title: (open[1] || '').trim(), body: body.join('\n') };
    const previous = output.at(-1), match = /^\uE000CHOICE(\d+)\uE000$/.exec(previous || '');
    if (match) groups[Number(match[1])].push(block);
    else { groups.push([block]); output.push(`\uE000CHOICE${groups.length - 1}\uE000`); }
    if (following) output.push(following);
    i = end;
    while (i + 1 < lines.length && !lines[i + 1].trim() && /^\s*:::choice\b/.test(lines.slice(i + 2).find(x => x.trim()) || '')) i++;
  }
  return { rest: output.join('\n'), groups };
}
