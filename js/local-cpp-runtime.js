import { Clang, LLD, setUpSysroot } from '../assets/vendor/cpp/browsercc/runtime/index.js';
import { WASI, File, OpenFile, ConsoleStdout } from '../assets/vendor/cpp/browser-wasi-shim/runtime/index.js';

const BROWSERCC_DIST = new URL('../assets/vendor/cpp/browsercc/runtime/', import.meta.url);
const MAX_DIAGNOSTICS = 24000;
const MAX_OUTPUT_CHARS = 1024 * 1024;
const SOURCE_EXT = /\.(?:c|cc|cpp|cxx|c\+\+)$/i;

function safeRelativeCompilerPath(value) {
  const path = String(value || '').replace(/\\/g, '/');
  if (!path || path.length > 512 || path.startsWith('/') || path.includes('"') || path.includes("'")
      || /[\u0000-\u001f\u007f]/.test(path)) return '';
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('-')
      || ['__proto__', 'constructor', 'prototype'].includes(part))) return '';
  return path;
}

function quotedArgs(line) {
  const quoted = String(line || '').match(/"(?:\\.|[^"\\])*"/g) || [];
  const decoded = [];
  for (const token of quoted) {
    try { decoded.push(JSON.parse(token)); }
    catch { return []; }
  }
  return decoded.slice(1);
}

function trimDiagnostics(raw) {
  return String(raw || '').split(/\r?\n/u)
    .filter((line) => line && !line.includes('"-cc1"') && !line.includes('"wasm-ld"')
      && !/^clang version\b/u.test(line) && !/^Target: /u.test(line)
      && !/^Thread model: /u.test(line) && !/^InstalledDir: /u.test(line))
    .join('\n').slice(0, MAX_DIAGNOSTICS);
}

function captureStream() {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let value = '';
  let truncated = false;
  const append = (text) => {
    if (!text || value.length >= MAX_OUTPUT_CHARS) { if (text) truncated = true; return; }
    const remaining = MAX_OUTPUT_CHARS - value.length;
    value += text.slice(0, remaining);
    if (text.length > remaining) truncated = true;
  };
  return {
    fd: new ConsoleStdout((bytes) => append(decoder.decode(bytes, { stream: true }))),
    flush() { append(decoder.decode()); },
    value() { return value + (truncated ? '\n[…输出已截断…]' : ''); },
  };
}

function logText(logs, level, text) {
  const clean = String(text || '').trimEnd();
  if (clean) logs.push({ level, text: clean });
}

/** Compile and execute a local C/C++ job using Browsercc + a Preview 1 WASI shim. */
export async function compileAndRunCpp(job = {}, { onPhase = null } = {}) {
  const source = String(job.code || '');
  const mainPath = safeRelativeCompilerPath(job.mainPath || 'main.cpp');
  if (!source.trim()) return { ok: false, logs: [], error: { message: 'C++ 代码为空。' } };
  if (!mainPath || !SOURCE_EXT.test(mainPath)) {
    return { ok: false, logs: [], error: { message: 'C++ 主文件路径必须是安全的相对路径，并使用 .c/.cc/.cpp/.cxx/.c++ 扩展名。' } };
  }

  const files = new Map();
  for (const entry of Array.isArray(job.files) ? job.files : []) {
    const filename = safeRelativeCompilerPath(entry?.filename);
    if (!filename || filename === mainPath) continue;
    files.set(filename, { contents: String(entry?.contents ?? ''), compile: entry?.compile !== false });
  }
  files.set(mainPath, { contents: source, compile: true });

  const inputPaths = [...files.entries()]
    .filter(([filename, entry]) => filename === mainPath || (entry.compile && SOURCE_EXT.test(filename)))
    .map(([filename]) => filename);
  if (!inputPaths.includes(mainPath)) inputPaths.unshift(mainPath);

  let clangMessages = '';
  let lldMessages = '';
  const diagnostics = (target) => (line) => {
    const value = String(line || '');
    if (target === 'clang') clangMessages += `${value}\n`;
    else lldMessages += `${value}\n`;
  };

  try {
    onPhase?.('loading-assets');
    const [clangWasm, lldWasm, sysroot] = await Promise.all(['clang.wasm', 'lld.wasm', 'sysroot.tar'].map(async (name) => {
      const response = await fetch(new URL(name, BROWSERCC_DIST), { credentials: 'omit', cache: 'force-cache' });
      if (!response.ok) throw new Error(`工具链资源 ${name} 加载失败：HTTP ${response.status}`);
      return response.arrayBuffer();
    }));

    const clang = await Clang({
      thisProgram: 'clang++',
      noExitRuntime: true,
      wasmBinary: clangWasm,
      printErr: diagnostics('clang'),
    });
    setUpSysroot(clang, sysroot);
    for (const [filename, entry] of files) {
      const directory = filename.split('/').slice(0, -1).join('/');
      if (directory && !clang.FS.analyzePath(directory).exists) clang.FS.mkdirTree(directory);
      clang.FS.writeFile(filename, entry.contents);
    }

    onPhase?.('compiling');
    const flags = ['-std=c++20', '-O0', '-lc++abi'];
    const driverStart = clangMessages.length;
    const driverExit = clang.callMain([...inputPaths, ...flags, '-###']);
    const driverText = clangMessages.slice(driverStart);
    if (driverExit !== 0) {
      const detail = trimDiagnostics(driverText) || `Clang driver exited with code ${driverExit}`;
      return { ok: false, logs: [{ level: 'error', text: detail }], error: { message: 'C++ 编译器启动失败。' } };
    }

    const lines = driverText.split(/\r?\n/u);
    const compilerLines = lines.filter((line) => line.includes('"-cc1"'));
    const linkerLine = lines.find((line) => line.includes('"wasm-ld"')) || '';
    const compilerCommands = compilerLines.map(quotedArgs).filter((args) => args.length);
    const linkerArgs = quotedArgs(linkerLine);
    if (compilerCommands.length !== inputPaths.length || !linkerArgs.length) {
      const detail = trimDiagnostics(driverText) || 'Clang driver did not return a complete compile/link plan.';
      return { ok: false, logs: [{ level: 'error', text: detail }], error: { message: '无法解析本地 C++ 编译计划。' } };
    }

    for (const args of compilerCommands) {
      const exitCode = clang.callMain(args);
      if (exitCode !== 0) {
        const detail = trimDiagnostics(clangMessages.slice(driverStart + driverText.length)) || 'Clang compilation failed.';
        return { ok: false, logs: [{ level: 'error', text: detail }], error: { message: 'C++ 编译失败（详见本地诊断）。' } };
      }
    }

    const lld = await LLD({
      thisProgram: 'wasm-ld',
      wasmBinary: lldWasm,
      printErr: diagnostics('lld'),
    });
    setUpSysroot(lld, sysroot);
    for (const argument of linkerArgs) {
      if (!argument.endsWith('.o')) continue;
      try {
        if (clang.FS.analyzePath(argument).exists) {
          const directory = argument.split('/').slice(0, -1).join('/');
          if (directory && !lld.FS.analyzePath(directory).exists) lld.FS.mkdirTree(directory);
          lld.FS.writeFile(argument, clang.FS.readFile(argument, { encoding: 'binary' }));
        }
      } catch { /* linker will report a missing object with the actual path */ }
    }
    const linkExit = lld.callMain(linkerArgs);
    if (linkExit !== 0) {
      const detail = trimDiagnostics(lldMessages) || 'wasm-ld failed.';
      return { ok: false, logs: [{ level: 'error', text: detail }], error: { message: 'C++ 链接失败（详见本地诊断）。' } };
    }

    const artifact = linkerArgs[linkerArgs.indexOf('-o') + 1] || 'a.out';
    const wasmBytes = lld.FS.readFile(artifact, { encoding: 'binary' });
    const module = await WebAssembly.compile(wasmBytes);
    const stdout = captureStream();
    const stderr = captureStream();
    const stdin = new TextEncoder().encode(String(job.stdin || ''));
    const argv = [mainPath.split('/').pop() || 'main', ...(Array.isArray(job.args) ? job.args.map((value) => String(value)) : [])];
    const wasi = new WASI(argv, [], [
      new OpenFile(new File(stdin)),
      stdout.fd,
      stderr.fd,
    ], { debug: false });
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
    onPhase?.('program-start');
    let exitCode = 0;
    let runtimeError = null;
    try { exitCode = wasi.start(instance); } catch (error) { runtimeError = error; }
    stdout.flush();
    stderr.flush();

    const logs = [];
    const compilerOutput = trimDiagnostics(clangMessages.slice(driverStart + driverText.length));
    const linkerOutput = trimDiagnostics(lldMessages);
    if (compilerOutput) logText(logs, 'warn', compilerOutput);
    if (linkerOutput) logText(logs, 'warn', linkerOutput);
    logText(logs, 'log', stdout.value());
    logText(logs, 'error', stderr.value());
    if (runtimeError) logText(logs, 'error', `${runtimeError.name || 'RuntimeError'}: ${runtimeError.message || runtimeError}`);
    const ok = !runtimeError && exitCode === 0;
    return {
      ok,
      logs,
      exitCode,
      error: ok ? undefined : runtimeError
        ? { message: `WASI 运行时错误：${runtimeError.message || runtimeError}` }
        : { message: `进程退出码 ${exitCode}` },
    };
  } catch (error) {
    const message = String(error?.message || (error && typeof error === 'object' ? JSON.stringify(error) : error) || 'Unknown C++ runtime error').slice(0, MAX_DIAGNOSTICS);
    const extra = trimDiagnostics(clangMessages + lldMessages);
    return {
      ok: false,
      logs: extra ? [{ level: 'error', text: extra }] : [],
      error: { message: `本地 C++ 编译/运行失败：${message}` },
    };
  }
}
