import { text } from './locale.js';
// Source-file execution lets an Agent repair a failed long command with write_file(mode=replace), then rerun its path.
import { isSafeFsPath } from './sandbox.js';
export const SOURCE_TOOLS = new Set(['execute_javascript', 'execute_python']);
export function prepareCommandArgs(name, args, fs) {
  if (!SOURCE_TOOLS.has(name)) return args || {};
  const a = args || {};
  if (a.path != null) {
    if (typeof a.path !== 'string' || !a.path.trim()) throw new Error(text('path 必须是非空字符串', 'path must be a non-empty string'));
    const path = a.path.trim().replace(/^sandbox:\/\//i, '').replace(/^\.\//, '');
    if (!isSafeFsPath(path)) throw new Error(text('源码路径必须是合法的沙箱相对路径', 'The source path must be a valid sandbox-relative path'));
    const source = fs.read(path);
    if (source == null) throw new Error(`找不到源码文件：${path}`);
    if (typeof source !== 'string' || /^data:/i.test(source)) throw new Error(text('源码文件必须是文本', 'The source file must be text'));
    if (a.code != null && a.code !== source) throw new Error(text('源码在执行前发生变动或 code 与 path 不一致，请重新读取后再执行', 'The source changed before execution, or code no longer matches path; read it again before running'));
    return { ...a, path, code: source };
  }
  if (typeof a.code !== 'string' || !a.code.trim()) throw new Error(text('请提供 code 或已有源码文件 path', 'Provide code, or the path of an existing source file'));
  return a;
}
export function retainCommandSource(name, args, ctx, out) {
  if (ctx.signal?.aborted || out?.aborted || out?.bootstrapFailed || !['execute_javascript', 'execute_python', 'execute_cpp'].includes(name)) return '';
  if (args.path) return args.path;
  const code = String(args.code || '');
  if (code.length < 1200 && code.split('\n').length < 30) return '';
  const ext = name === 'execute_python' ? 'py' : name === 'execute_cpp' ? 'cpp' : 'js';
  const key = [ctx.execution?.turnId, ctx.callId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`].filter(Boolean).join('-').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  let path = `internal/commands/${key}.${ext}`, suffix = 1;
  while (ctx.fs.has(path) && ctx.fs.read(path) !== code) path = `internal/commands/${key}-${++suffix}.${ext}`;
  ctx.fs.write(path, code);
  return path;
}
export function commandRepairNote(path) {
  return path ? `\n[command_source: ${path}]\n` + text('长命令已保留。若只有变量名、语法或一小段逻辑错误，先核验副作用，再用 write_file(mode="replace", old_text, new_text) 局部修补此文件，随后以 path 执行；不要再次发送完整 code，不要为修一个名字重写整段程序。', 'Long source retained. For a small syntax/name/logic error, verify side effects, patch this file with write_file(mode=replace, old_text, new_text), then execute its path. Do not resend the entire code or rewrite a long command to fix one name.') : '';
}
