import { text as localizedText } from './locale.js';
// ─── 工具详情窗口：按实际输出显示 COMMAND / STDOUT / STDERR ───────────────────
// 有 stdout 才显示 STDOUT；有错误才显示 STDERR；无输出且无错误时在 COMMAND 下提示 No output。
// 每个窗口右上角各一枚复制按钮，复制本窗口原文。
import { esc } from './ui-markdown.js?v=2026.10.11.1';

/** execute_* 的结果正文里，错误段落的分隔标记（见 tools.js formatExecResult）。 */
export const WINDOW_ERROR_MARK = '── 错误 ──';
const COMMAND_PRIMARY_KEYS = Object.freeze(['code', 'command', 'query', 'url', 'path']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const prettyJson = (v) => {
  try { return JSON.stringify(v == null ? {} : v, null, 2); } catch { return String(v); }
};

/**
 * COMMAND 窗口：有代码 / 命令 / 查询词 / 地址 / 路径字段的，直接显示原文（多行代码不转义）；
 * 其余参数追加在下面的 JSON 里。没有任何主字段时整体显示格式化的入参 JSON。
 */
export function commandWindowText(args) {
  const a = isPlainObject(args) ? args : {};
  if (typeof a.__raw === 'string') return a.__raw;
  const key = COMMAND_PRIMARY_KEYS.find((k) => typeof a[k] === 'string' && a[k].trim());
  if (!key) return prettyJson(a);
  const rest = Object.fromEntries(Object.entries(a).filter(([k]) => k !== key));
  const head = String(a[key]).replace(/\s+$/, '');
  return Object.keys(rest).length ? `${head}\n\n${prettyJson(rest)}` : head;
}

// [command_source: …] 后面的文字是供模型修补长命令的提示，不是程序输出。
const stripCommandSourceNote = (body) => String(body == null ? '' : body)
  .replace(/\n\[command_source:[^\n]*\][\s\S]*$/i, '');

/** V1.8.1：失败归类只回喂模型，工具窗口里不显示。 */
export const stripFailureClassNote = (body) => String(body == null ? '' : body).replace(/\n*\[执行内核\] 失败归类：[^\n]*/g, '');
const stripInternalNotes = (body) => stripCommandSourceNote(stripFailureClassNote(body));

/**
 * 把工具结果正文拆成 STDOUT / STDERR：
 * · 「── 错误 ──」之后的段落 → STDERR；
 * · 以 `[error] ` 开头的控制台行 → STDERR（沙箱里 console.error / 错误输出的级别）；
 * · 其余 → STDOUT（保留控制台 / 返回值分段标题，便于对照原文）。
 */
export function splitToolStreams(body) {
  const text = stripInternalNotes(body);
  const mark = text.includes(WINDOW_ERROR_MARK) ? WINDOW_ERROR_MARK : '── Error ──';
  const at = text.indexOf(mark);
  const errorBlock = at >= 0 ? text.slice(at + mark.length).replace(/^\n/, '') : '';
  const main = at >= 0 ? text.slice(0, at) : text;
  const out = [];
  const err = [];
  for (const line of main.split('\n')) (/^\[error\] /.test(line) ? err : out).push(line);
  const stdout = out.join('\n').replace(/\s+$/, '').replace(/^\n+/, '');
  const stderr = [err.join('\n').trim(), errorBlock.trim()].filter(Boolean).join('\n');
  return { stdout, stderr };
}

// These lines are wrapper metadata, not visible stdout: they must not make an
// otherwise empty execution look successful (notably Completed without output).
function stripExecutionMetadata(text) {
  return String(text == null ? '' : text)
    .replace(/^\[[^\]\n]*\s(?:沙箱|sandbox)\]\s*$/gim, '')
    .replace(/^\[env:[^\n]*\]\s*$/gim, '')
    .replace(/^\[包缓存\][^\n]*$/gm, '')
    .replace(/^\[(?:执行耗时|Duration)\s+[^\]\n]*\]\s*$/gim, '')
    .replace(/^\s*──\s*(?:控制台输出|Console|返回值|Result|错误|Error)\s*──\s*$/gim, '')
    .replace(/^\s*(?:（执行完成，无输出）|\(Completed without output\))\s*$/gim, '')
    .replace(/^\[(?:log|info|warn|debug|trace|error)\]\s*$/gim, '');
}

/** True only when the result contains substantive program/tool output, excluding wrappers. */
export function hasSubstantiveToolOutput(body) {
  const split = splitToolStreams(body);
  return !!(stripExecutionMetadata(split.stdout).trim() || stripExecutionMetadata(split.stderr).trim());
}

const TOOL_RESULT_ERROR = /^(?:工具执行失败|图像模型调用失败|图像调用在发起前失败|未配置 TeamoRouter API Key|Python 沙箱不可用|(?:[A-Za-z][\w-]*)(?:\s+[A-Za-z][\w-]*)*\s+(?:失败|缺少|不可用|拒绝执行|错误)(?:[：:]|\b))/i;
export function toolResultHasError(text) {
  const body = String(text == null ? '' : text).trim();
  return TOOL_RESULT_ERROR.test(body) || /^\[git 退出码 (?!0\b)\d+\]/i.test(body)
    || /^fatal:|^error:/im.test(body) || /^\[error\]/mi.test(body)
    || /──\s*(?:错误|Error)\s*──|不是合法 JSON|未配置 TeamoRouter API Key|^⛔|执行内核在调用前拦截/.test(body);
}
export function toolResultNoOutput(text) { return !hasSubstantiveToolOutput(text) && !toolResultHasError(text); }
export function toolResultFailed(text) { return toolResultNoOutput(text) || toolResultHasError(text); }
export function classifyToolResult(body, current = {}, previous = {}) {
  const noOutput = toolResultNoOutput(body) && current.status !== 'error' && !current.errorNote;
  return {
    status: previous.status === 'error' || current.status === 'error' || toolResultFailed(body) ? 'error' : 'ok',
    note: previous.note || current.errorNote || (noOutput ? 'No output' : ''),
    noOutput: !!(previous.noOutput || noOutput),
  };
}

/** 单个窗口的 HTML。 */
function windowHtml({ kind, title, text, extraClass = '', copyLabel }) {
  const payload = String(text == null ? '' : text);
  return `<section class="chip-win chip-win-${kind}${extraClass}" data-win="${kind}">`
    + `<div class="chip-win-h"><span class="chip-win-t">${esc(title)}</span>`
    + `<button type="button" class="chip-copy" data-which="${kind}" aria-label="${localizedText('复制', 'Copy')} ${esc(copyLabel || title)}" title="${localizedText('复制', 'Copy')} ${esc(copyLabel || title)}">${localizedText('复制', 'Copy')}</button></div>`
    + `<pre class="chip-win-b${kind === 'command' ? '' : ' chip-result'}${kind === 'stderr' ? ' chip-result-err' : ''}">${esc(payload)}</pre>`
    + '</section>';
}

/**
 * 显示有内容的输出窗口；如果没有 stdout/stderr 则显示「No output」。
 * `noOutput: false` 可用于仍在执行、结果尚未返回的状态，避免提前出现空输出提示。
 */
export function renderToolWindowsHtml({ command = '', stdout = '', stderr = '', missing = false, noOutput } = {}) {
  const err = String(stderr || '');
  const out = String(stdout || '');
  const hasStdout = !!stripExecutionMetadata(out).trim();
  const hasStderr = !!stripExecutionMetadata(err).trim();
  const showNoOutput = noOutput === true || (noOutput == null && !hasStdout && !hasStderr);
  return `<div class="fold-inner tool-windows">`
    + windowHtml({ kind: 'command', title: 'COMMAND', text: command, copyLabel: 'COMMAND' })
    + (hasStdout ? windowHtml({ kind: 'stdout', title: 'STDOUT', text: out, extraClass: missing ? ' tool-result-missing' : '', copyLabel: 'STDOUT' }) : '')
    + (hasStderr ? windowHtml({ kind: 'stderr', title: 'STDERR', text: err, copyLabel: 'STDERR' }) : '')
    + (showNoOutput ? '<div class="chip-no-output" role="note">No output</div>' : '')
    + '</div>';
}

export function toolWindowsOf(chip) {
  const ids = String(chip?.dataset.callIds || chip?.dataset.callId || '').split(',').filter(Boolean);
  const items = chip._items || [];
  const commands = [];
  const outs = [];
  const errs = [];
  let missing = false;
  let noOutput = false;
  ids.forEach((id, i) => {
    const item = items.find((t) => String(t && t.id) === id) || items[i] || {};
    commands.push(commandWindowText(item.args !== undefined ? item.args : chip._args));
    const state = (chip._toolStates && chip._toolStates[id]) || {};
    if (chip._outs && Object.hasOwn(chip._outs, id)) {
      const body = stripInternalNotes(chip._outs[id]);
      const split = splitToolStreams(body);
      let stdout = split.stdout;
      let stderr = split.stderr;
      // Wrapper headings / env / duration are not output windows on their own.
      if (!stripExecutionMetadata(stdout).trim()) stdout = '';
      if (!stripExecutionMetadata(stderr).trim()) stderr = '';
      const hasErrorMarker = /──\s*(?:错误|Error)\s*──/.test(body) || /^\[error\]/mi.test(body);
      if (!hasSubstantiveToolOutput(body)) {
        if (state.note === 'No output' || state.noOutput || (state.status === 'ok' && !state.note)
          || (state.status !== 'error' && !hasErrorMarker && !state.note)) {
          noOutput = true;
        } else if (state.status === 'error' || hasErrorMarker) {
          errs.push(state.note || '工具失败，但未收到错误信息。');
        }
        return;
      }
      // 失败但正文里没有错误分隔段（如 fetch_url 的「工具执行失败：…」）：正文作为 STDERR。
      if (!stderr && state.status === 'error') {
        stdout = '';
        stderr = state.note && state.note !== 'No output' ? state.note : body.trim();
      }
      if (stdout) outs.push(stdout);
      if (stderr) errs.push(stderr);
    } else if (item.liveOutput) {
      if (item.liveOutput.stdout) outs.push(item.liveOutput.stdout);
      if (item.liveOutput.stderr) errs.push(item.liveOutput.stderr);
    } else if (state.status === 'ok') {
      // A settled call with no result is a failure, not an empty STDOUT window.
      noOutput = true;
      missing = true;
    } else if (state.status === 'error') {
      if (state.note === 'No output' || state.noOutput) noOutput = true;
      else errs.push(state.note || '工具失败，但未收到错误信息。');
    }
  });
  return {
    command: commands.join('\n\n'), stdout: outs.join('\n\n'), stderr: errs.join('\n\n'),
    missing, noOutput: noOutput && !outs.length && !errs.length,
  };
}
