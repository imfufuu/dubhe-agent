// Stable DOM fragments in persisted SSE order plus lightweight UI lifecycle helpers.
import { displayParts, toolFamily, adjacentToolMessages } from './toolflow.js?v=2026.10.25.1';
import { checklistComplete } from './checklist.js';
import { text as localeText } from './locale.js';
export function syncToolMenuCursor(chips, live) {
  if (!chips) return null;
  let cursor = chips.querySelector(':scope > .tool-menu-cursor');
  if (!live) { cursor?.remove(); return null; }
  if (!cursor) {
    cursor = chips.ownerDocument.createElement('span');
    cursor.className = 'cursor tool-menu-cursor';
    cursor.setAttribute('aria-hidden', 'true');
  }
  // Keep the busy caret after the entire tool menu even when streamed rows are re-ordered.
  chips.appendChild(cursor);
  return cursor;
}

export function persistTurnTiming(store, ms, msgNodes, paintFoot, syncShell, renderStats) {
  if (!(ms > 0)) return;
  const st = store.state.stats || (store.state.stats = { lastMs: 0, totalMs: 0 });
  st.lastMs = ms; st.totalMs += ms;
  const messages = store.state.messages || [];
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { lastUserIndex = i; break; }
  }
  // Never attach this task's completion time to an older answer if the current turn has no final text message.
  const turnAssistants = messages.slice(lastUserIndex + 1).filter((m) => m?.role === 'assistant');
  const last = [...turnAssistants].reverse().find((m) => !m.toolCalls?.length) || turnAssistants.at(-1);
  if (last) { last.durationMs = ms; last.ts = Date.now(); }
  // Persist independently of DOM paint: a detached/failed footer update must not lose the timestamp on refresh.
  try { store.notify(); } finally { store.save?.(true); }
  if (last) {
    const wrap = msgNodes.get(last.id);
    if (wrap) { try { paintFoot(wrap, last); syncShell(wrap); } catch { /* persistence is already complete */ } }
  }
  renderStats();
}
export function paintOrderedAssistant(wrap, m, { paintPart, paintMeta, paintFoot, syncShell, syncFolds, refreshActions }) {
  const parts = displayParts(m);
    if (!m._displayFragment && (parts.length > 1 || wrap._flowMode || m._sequentialPresentation)) {
      wrap._flowMode = true;
      wrap.classList.toggle('cancelled', !!m.cancelled);
      let flow = wrap.querySelector(':scope > .assistant-flow');
      if (!flow) {
        flow = document.createElement('div'); flow.className = 'assistant-flow';
        for (const child of [...wrap.children]) if (child.matches('.md-body,.tool-chips,.reasoning,.explored-files,.web-activity,.edited-files,.searched-library,.message-tail')) child.remove();
        const anchor = wrap.querySelector(':scope > .msg-foot') || wrap.querySelector(':scope > .msg-actions');
        wrap.insertBefore(flow, anchor || null);
      }
      const rows = parts.length ? parts : [{ kind: 'text', text: '', toolCalls: [] }];
      const seen = new Set();
      rows.forEach((part, index) => {
        const key = String(index); seen.add(key);
        let row = [...flow.children].find((n) => n.dataset.part === key);
        if (!row) {
          row = document.createElement('div'); row.className = 'assistant-fragment'; row.dataset.part = key;
          row.innerHTML = '<div class="md-body"></div><div class="tool-chips"></div>';
          flow.appendChild(row);
        }
        row.dataset.ownerId = m.id;
        row.dataset.family = part.kind;
        const last = index === rows.length - 1;
        paintPart(row, { ...m, ...part, _displayFragment: true, _partIndex: index,
          done: last ? m.done : true, thinkDone: m.done, cancelled: last && m.cancelled, error: last ? m.error : null,
          publicPlan: index === 0 ? m.publicPlan : null,
          reasoning: index === 0 ? m.reasoning : '', thoughtHidden: index === 0 && m.thoughtHidden,
          thinkingBlocks: index === 0 ? m.thinkingBlocks : [], usage: index === 0 ? m.usage : null,
          webSearch: last ? m.webSearch : null, tempCommit: last ? m.tempCommit : null,
        });
      });
      for (const row of [...flow.children]) if (!seen.has(row.dataset.part)) row.remove();
      paintMeta(wrap, m); paintFoot(wrap, m); syncShell(wrap);
      syncFolds();
      refreshActions();
      return true;
    }
  return false;
}

import { toolWindowsOf, renderToolWindowsHtml } from './toolwindows.js?v=2026.10.25.1';
export function renderToolChipDetail(chip) {
    if (!chip || !chip._detail) return;
    const w = toolWindowsOf(chip);
    chip._win = w;
    const sig = JSON.stringify([w.command, w.stdout, w.stderr, w.thinking, w.missing, w.noOutput]);
    if (chip._detailSig !== sig) {
      chip._detailSig = sig;
      const expected = ['command', ...(w.thinking ? ['thinking'] : []), ...(w.stdout ? ['stdout'] : []), ...(w.stderr ? ['stderr'] : [])];
      const existing = [...chip._detail.querySelectorAll('[data-win]')].map((n) => n.dataset.win);
      const hasNoOutput = !!chip._detail.querySelector('.chip-no-output');
      if (expected.join() !== existing.join() || hasNoOutput !== !!w.noOutput) chip._detail.innerHTML = renderToolWindowsHtml(w);
      else for (const kind of expected) {
        const pre = chip._detail.querySelector(`[data-win="${kind}"] pre`);
        const text = w[kind] || '';
        if (pre && pre.textContent !== text) pre.textContent = text;
      }
    }
    // 子智能体思考流式增长：思考窗口始终贴住最新一行
    const thinkPre = chip._detail.querySelector('[data-win="thinking"] pre');
    if (thinkPre) thinkPre.scrollTop = thinkPre.scrollHeight;
  }


import { $, $$, el, esc, videoBlobUrl } from './ui-markdown.js?v=2026.10.25.1';
import { ICON } from './icons.js';

// 2026.10.21：知识库检索 = 独立消息块。检索中：英文进行时「Searching library」+ 与命令/文件行
// 同一套抛光扫光（is-working）；检索词在标签右侧持续可见。检索结果属于系统提示词素材，不在界面展示。
export function paintKnowledgeFold(wrap, m, afterEl, { msgsAll, msgNodes, syncFileFold, syncAssistantShell, decodeRawJsonString }) {
  const cluster = m._displayFragment ? [m] : adjacentToolMessages(msgsAll, m.id, (t) => toolFamily(t) === 'knowledge');
  const isHost = !!cluster.length && cluster[cluster.length - 1].id === m.id;
  const calls = isHost ? cluster.flatMap((x) => x.toolCalls || []).filter((c) => c && c.name === 'knowledge_search') : [];
  let node = $('.searched-library', wrap);
  // 没有检索调用（别的家族分段 / 纯文本消息 / 折叠归属集群里更早的消息）→ 不渲染，旧的收走
  if (!calls.length) {
    if (node) { node.remove(); syncAssistantShell(wrap); }
    return $('.searched-library', wrap) || afterEl;
  }
  const queries = [...new Set(calls.map((c) => {
    const args = c.args && typeof c.args === 'object' ? c.args : {};
    const q = String(args.query || '').trim() || decodeRawJsonString(String(args.__raw || ''), 'query');
    const topic = String(args.topic || '').trim();
    return topic ? `${q} · ${topic}` : q;
  }).filter(Boolean))];
  if (!node) {
    node = el('div', 'searched-library');
    afterEl.after(node);
  } else if (node.previousElementSibling !== afterEl) afterEl.after(node);
  // 检索词仅在内容变化时更新；在状态标签右侧保持可见，不复用可展开的结果窗口。
  const qSig = JSON.stringify(queries);
  if (node._querySig !== qSig) {
    node.innerHTML = `<span class="chip-ico">${ICON.search || ICON.file || ''}</span><span class="mono chip-name"></span><span class="searched-library-query mono"></span>`;
    node._querySig = qSig;
  }
  node.dataset.ownerId = m.id;
  node._activeCalls = calls;
  // 不绑 click、不写 _toggleKey/_userToggle：整行始终不可展开；只显示检索词，不显示检索结果。
  syncFileFold(node);
  const label = $('.chip-name', node);
  if (label) label.textContent = node._active ? 'Searching library' : (queries.length > 1 ? `Searched library ${queries.length}` : 'Searched library');
  const queryEl = $('.searched-library-query', node);
  if (queryEl) {
    queryEl.textContent = queries.join(' · ');
    queryEl.title = queries.join('\n');
  }
  if (!m._displayFragment) {
    for (const x of cluster.slice(0, -1)) {
      const w = msgNodes.get(x.id), old = w && $('.searched-library', w);
      if (old) { old.remove(); syncAssistantShell(w); }
    }
  }
  return $('.searched-library', wrap) || afterEl;
}

// Append newly-revealed calls without replacing earlier widgets or their windows.
export function paintCommandRows(chips, { groups, sig, scope, ownerId, commandToggle, callToggle, liveToolCallIds }) {
    if (chips.dataset.sig !== sig) {
      chips.dataset.sig = sig;
      if (!groups.length) chips.replaceChildren();
      else {
        const groupId = scope + ':' + String(groups[0]?.items[0]?.id || ownerId);
        let groupFold = $('.ran-commands', chips);
        if (!groupFold || groupFold.dataset.groupId !== groupId) {
          chips.replaceChildren(); groupFold = el('div', 'ran-commands');
          groupFold.dataset.ownerId = ownerId; groupFold.dataset.groupId = groupId;
          groupFold._userToggle = commandToggle.get(groupId) ?? null;
          groupFold.innerHTML = `<span class="chip-ico chip-ico-term">${ICON.terminal || ICON.tool || ''}</span><span class="mono chip-name"></span><span class="chip-state">…</span><div class="chip-detail"><div class="fold-inner"><div class="ran-command-items"></div></div></div>`;
          groupFold.addEventListener('click', (e) => {
            if (e.target.closest('.tool-call-chip, a, button, .chip-copy')) return;
            groupFold.classList.toggle('expanded'); groupFold._userToggle = groupFold.classList.contains('expanded');
            commandToggle.set(groupFold.dataset.groupId, groupFold._userToggle);
          });
          chips.appendChild(groupFold);
        }
        groupFold.dataset.sig = sig;
        const itemsBox = $('.ran-command-items', groupFold);
        const existing = new Map($$('.tool-call-chip', itemsBox).map((node) => [node.dataset.callId, node]));
        const wanted = new Set();
        groups.forEach((g, index) => {
          const ids = g.items.map((t) => t.id).filter(Boolean), id = String(ids[0] || ''); wanted.add(id);
          let child = existing.get(id);
          if (!child) {
            child = el('div', 'chip tool-call-chip'); child.dataset.callIds = ids.join(','); child.dataset.callId = id;
            child._toggleKey = scope + ':' + id; child._userToggle = callToggle.get(child._toggleKey) ?? null;
            child.innerHTML = `<span class="chip-ico">${ICON.tool || ''}</span><span class="mono chip-name">${esc(g.name)}</span><span class="chip-state">…</span>`;
            child.addEventListener('click', (e) => {
              if (e.target.closest('.chip-copy, button, a, .chip-win-b')) return;
              child.classList.toggle('expanded'); child._userToggle = child.classList.contains('expanded');
              callToggle.set(child._toggleKey, child._userToggle);
            });
            child._detail = el('div', 'chip-detail mono'); child.appendChild(child._detail);
            child._outs = {}; child._toolStates = {};
          }
          if (itemsBox.children[index] !== child) itemsBox.insertBefore(child, itemsBox.children[index] || null);
          child._items = g.items; child._args = g.items[0]?.args;
          for (const t of g.items) {
            if (t.id == null) continue;
            const key = String(t.id);
            if (t.status || Number.isFinite(Number(t.durationMs))) child._toolStates[key] = {
              status: t.status, settled: t.settled, note: t.errorNote || t.progressNote || '', durationMs: t.durationMs,
              progress: t.status === 'running' ? (t.progress ?? null) : null,
            };
            else if (liveToolCallIds.has(key) && !child._toolStates[key]) child._toolStates[key] = { status: 'running', settled: t.settled };
          }
        });
        for (const [id, child] of existing) if (!wanted.has(id)) child.remove();
      }
    }
}

// Scope repeated provider call IDs to their owning message/turn, not the first DOM match.
const toolOwners = new WeakMap();
export function ownerOfTool(messages, call, resultMessage) {
  if (resultMessage?.id) {
    const at = messages.findIndex((m) => m.id === resultMessage.id);
    if (at >= 0) {
      for (let i = at - 1; i >= 0 && !(messages[i].role === 'user' && !messages[i].silent); i--)
        if (messages[i].role === 'assistant' && messages[i].toolCalls?.some((c) => String(c.id) === String(call.id))) return messages[i];
      return null;
    }
  }
  // Remember the real owner before the kernel shallow-clones toolCalls. Deleted
  // turns/regeneration must not redirect a late event to a reused provider ID.
  if (toolOwners.has(call)) {
    const owner = toolOwners.get(call);
    return messages.includes(owner) ? owner : null;
  }
  const owner = messages.find((m) => m.role === 'assistant' && m.toolCalls?.includes(call))
    || messages.findLast((m) => m.role === 'assistant' && m.toolCalls?.some((c) => String(c.id) === String(call.id)
      && (!Object.hasOwn(call, 'args') || c.args === call.args)));
  if (owner && call && typeof call === 'object') toolOwners.set(call, owner);
  return owner;
}

export function paintVisibleTurn(messages, msgNodes, paint, skipId) {
  const start = messages.findLastIndex((m) => m.role === 'user' && !m.silent);
  for (const m of messages.slice(start + 1)) {
    const wrap = m.role === 'assistant' && m.id !== skipId && msgNodes.get(m.id);
    if (wrap) paint(wrap, m);
  }
}

export function activeToolOwner(messages, call, stopped) {
  if (stopped) return null;
  const owner = ownerOfTool(messages, call);
  return owner && !owner.cancelled && messages.indexOf(owner) > messages.findLastIndex((m) => m.role === 'user' && !m.silent) ? owner : null;
}

// 是否有生图 / 生视频（计费）调用正在运行：停止前需要二次确认。
export function hasMediaTaskRunning(messages, liveIds) {
  return (messages || []).some((m) => (m.toolCalls || []).some((t) => t
    && (t.name === 'generate_image' || t.name === 'generate_video')
    && (t.status === 'running' || (liveIds && liveIds.has(String(t.id))))));
}
// 联网折叠行标题（英文）。单一工具：生成中 / 已完成；多条同类：Generated 2 images；混合：Web tools · N。
const WEB_SPEC = {
  generate_image: { run: 'Generating', done: 'Generated', one: 'image', many: 'images' },
  generate_video: { run: 'Generating', done: 'Generated', one: 'video', many: 'videos' },
  search_web: { run: 'Searching for', done: 'Searched for', one: '', many: 'queries' },
  fetch_url: { run: 'Fetching', done: 'Fetched', one: 'page', many: 'pages' },
};
export function webGroupLabel(rows, running) {
  const names = [...new Set(rows.map((r) => r.name))];
  const n = rows.length;
  if (names.length === 1 && WEB_SPEC[names[0]]) {
    const spec = WEB_SPEC[names[0]];
    const verb = running ? spec.run : spec.done;
    if (n === 1) return spec.one ? `${verb} ${spec.one}` : verb;
    return `${verb} ${n} ${spec.many}`;
  }
  return running ? `Web tools · ${n}` : `Used ${n} web tools`;
}
// 生成类工具的行不再显示工具名：一个提示词即一个成品，标题已经表达了类别。
const HIDE_ROW_NAME = new Set(['generate_image', 'generate_video']);

// 联网折叠行：行集合变化才整体重建；状态/结果原地更新，避免已展开的行重播入场动画。
// 结果区是可平滑展开收起的折叠块（grid-rows 过渡，与 chip-detail 一致），展开状态按行保留。
export function paintWebActivity(node, { rows, label, icon, labels, stateText, readFile }) {
  const shape = JSON.stringify([label, rows.map((r) => [r.id, r.name, r.summary, r.videoPath ? 1 : 0])]);
  node._openResults ||= new Set();
  if (node._webShape !== shape) {
    node._webShape = shape;
    node.innerHTML = `<span class="chip-ico think-ico">${icon}</span><span class="mono chip-name">${esc(label)}</span>`
      + `<div class="chip-detail"><div class="fold-inner"><ul>${rows.map((r) => `<li class="web-row" data-call="${esc(r.id)}">`
      + (HIDE_ROW_NAME.has(r.name) ? '' : `<span class="web-name">${esc(labels[r.name]?.[0] || r.name)}</span>`)
      + `<span class="web-arg mono" title="${esc(r.summary)}">${esc(r.summary)}</span>`
      + `<span class="web-state"></span>`
      + (r.videoPath ? `<div class="web-video" data-path="${esc(r.videoPath)}"></div>` : '')
      + '</li>').join('')}</ul></div></div>`;
    hydrateWebVideos(node, readFile);
  }
  for (const r of rows) {
    const li = $$('li[data-call]', node).find((x) => x.dataset.call === r.id);
    if (!li) continue;
    li.className = `web-row ${r.status}`;
    const st = li.querySelector('.web-state');
    const text = stateText(r.status);
    if (st && st.textContent !== text) st.textContent = text;
    let det = li.querySelector(':scope > .web-result');
    if (r.body) {
      if (!det) {
        det = el('div', 'web-result');
        det.dataset.call = r.id;
        det.innerHTML = `<button type="button" class="web-result-toggle" aria-expanded="false"><span>${localeText('结果', 'Result')}</span></button>`
          + `<div class="web-result-body"><div><pre></pre></div></div>`;
        const anchor = li.querySelector(':scope > .web-video');
        if (anchor) li.insertBefore(det, anchor); else li.append(det);
        det.querySelector('.web-result-toggle').addEventListener('click', (e) => {
          e.stopPropagation();
          const open = !det.classList.contains('open');
          det.classList.toggle('open', open);
          det.querySelector('.web-result-toggle').setAttribute('aria-expanded', String(open));
          if (open) node._openResults.add(r.id); else node._openResults.delete(r.id);
        });
        if (node._openResults.has(r.id)) { det.classList.add('open'); det.querySelector('.web-result-toggle').setAttribute('aria-expanded', 'true'); }
      }
      const pre = det.querySelector('pre');
      const txt = r.body.slice(0, 6000);
      if (pre && pre.textContent !== txt) pre.textContent = txt;
    }
  }
}

// generate_video 折叠行里的视频预览：数据从沙箱读出 → Blob URL 就地播放（视频不进消息存储）
export function hydrateWebVideos(node, readFile) {
  for (const box of node.querySelectorAll('.web-video[data-path]')) {
    if (box.firstChild) continue;
    let url = '';
    try { url = videoBlobUrl(readFile(box.dataset.path)); } catch { url = ''; }
    if (!url) { box.textContent = localeText('视频文件不在沙箱中', 'Video file not found in sandbox'); continue; }
    const v = document.createElement('video');
    v.controls = true; v.preload = 'metadata'; v.src = url; v.className = 'web-video-player';
    box.appendChild(v);
  }
}

// ── 复杂任务清单 ──────────────────────────────────────────────────────────
// 完整清单放在沙箱面板的「任务」标签里（随 store 实时刷新）；消息内只保留一行摘要，点击即打开面板。
const ckEsc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ckLabel = () => ({ pending: localeText('待办', 'Pending'), in_progress: localeText('进行中', 'In progress'), done: localeText('已确认', 'Confirmed'), failed: localeText('失败，需处理', 'Failed') });

// 消息内摘要：挂在消息头之后，随 m.checklist 实时更新
export function syncChecklistBlock(wrap, m) {
  if (!wrap) return;
  const list = Array.isArray(m?.checklist) ? m.checklist : [];
  let pill = wrap.querySelector(':scope > .agent-checklist');
  if (!list.length) { pill?.remove(); return; }
  if (!pill) {
    pill = wrap.ownerDocument.createElement('button');
    pill.type = 'button';
    pill.className = 'agent-checklist';
    pill.dataset.openTasks = '1';
    const head = wrap.querySelector(':scope > .msg-head');
    if (head) head.after(pill); else wrap.prepend(pill);
  }
  const done = list.filter((item) => item.status === 'done').length;
  pill.classList.toggle('incomplete', !checklistComplete(list));
  pill.title = localeText('在沙箱面板的「任务」标签中查看', 'Open the Tasks tab in the sandbox panel');
  pill.innerHTML = `<span class="ck-pill-mark" aria-hidden="true"></span><span class="ck-pill-text">${ckEsc(localeText('任务清单', 'Checklist'))} <b class="mono">${done}/${list.length}</b></span><span class="ck-pill-go">${ckEsc(localeText('在面板查看', 'View in panel'))} ›</span>`;
}

// 面板：完整清单（列表 + 进度条 + 标签徽标）。sig 未变时不重绘，流式期间保持轻量。
let lastPanelSig = '';
export function paintChecklistPanel(list) {
  const pane = document.getElementById('tab-tasks');
  if (!pane) return;
  const sig = JSON.stringify(list || []);
  if (sig === lastPanelSig) return;
  lastPanelSig = sig;
  const items = Array.isArray(list) ? list : [];
  const done = items.filter((item) => item.status === 'done').length;
  const total = items.length;
  const label = ckLabel();
  const ol = pane.querySelector('#task-list');
  const empty = pane.querySelector('#task-empty');
  const count = pane.querySelector('#task-count');
  const fill = pane.querySelector('#task-progress-fill');
  const badge = document.querySelector('[data-panel-tab="tasks"] .tab-badge');
  if (ol) ol.innerHTML = items.map((item) => `<li class="ck-${ckEsc(item.status)}" title="${ckEsc(label[item.status] || item.status)}"><span class="ck-mark" aria-hidden="true"></span><span class="ck-text">${ckEsc(item.text)}</span><span class="ck-state">${ckEsc(label[item.status] || item.status)}</span></li>`).join('');
  if (empty) empty.hidden = total > 0;
  if (count) count.textContent = total ? `${done}/${total}` : '—';
  if (fill) fill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  if (badge) {
    const open = total > 0 && !checklistComplete(items);
    badge.hidden = !open;
    badge.textContent = open ? `${done}/${total}` : '';
  }
}

function openTasksPanel() {
  const panel = document.getElementById('sandbox-panel');
  if (panel?.classList.contains('collapsed')) document.getElementById('panel-toggle')?.click();
  document.querySelector('[data-panel-tab="tasks"]')?.click();
}

let checklistPanelInstalled = false;
// 启动时调用一次：订阅 store、绑定「任务」标签的显隐与摘要点击
export function installChecklistPanel(store) {
  if (checklistPanelInstalled || !store) return;
  checklistPanelInstalled = true;
  const latest = () => {
    const messages = store.state.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (Array.isArray(messages[i]?.checklist) && messages[i].checklist.length) return messages[i].checklist;
    }
    return [];
  };
  store.subscribe(() => paintChecklistPanel(latest()));
  document.querySelectorAll('[data-panel-tab]').forEach((b) => b.addEventListener('click', () => {
    const pane = document.getElementById('tab-tasks');
    if (pane) pane.hidden = b.dataset.panelTab !== 'tasks';
  }));
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-open-tasks]')) openTasksPanel();
  });
  paintChecklistPanel(latest());
}
