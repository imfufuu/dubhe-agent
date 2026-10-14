#!/usr/bin/env node
// 自动版本号（只在 Pages 部署时运行，仓库源码里不用手动改版本号）。
// 版本 = 北京时间日期 + 当天第 N 个提交，例如 2026.10.12.3。
// 部署时更新展示版本与 SW 版本；移除全局日期 query，避免未改动模块逐版本重下载。
//   node tools/stamp-version.mjs            # 原地改写
//   node tools/stamp-version.mjs --print    # 只打印将使用的版本号
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function computeVersion(now = new Date(), commitsToday = null, root = ROOT) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  const y = get('year'), m = get('month'), d = get('day');
  let n = commitsToday;
  if (n == null) {
    try {
      const since = `${y}-${m}-${d}T00:00:00+08:00`;
      n = parseInt(execSync(`git rev-list --count HEAD --since="${since}"`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 10);
    } catch { n = 1; }
  }
  if (!Number.isFinite(n) || n < 1) n = 1;
  return `${Number(y)}.${Number(m)}.${Number(d)}.${n}`;
}

function htmlAndJsFiles(root) {
  const out = [];
  for (const f of fs.readdirSync(root)) if (f.endsWith('.html')) out.push(f);
  // Embedded homepage demo has its own module/CSS entrypoints, stamped with the app.
  if (fs.existsSync(path.join(root, 'demo'))) {
    for (const f of fs.readdirSync(path.join(root, 'demo'))) if (f.endsWith('.html')) out.push(path.join('demo', f));
  }
  for (const f of fs.readdirSync(path.join(root, 'js'))) if (f.endsWith('.js')) out.push(path.join('js', f));
  return out;
}

export function stampFiles(version, root = ROOT) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid deployment version');
  const changed = [];
  const swPath = path.join(root, 'sw.js');
  if (fs.existsSync(swPath)) {
    const sw = fs.readFileSync(swPath, 'utf8');
    const next = sw.replace(/(const DEPLOY_VERSION = ')[^']*(')/, `$1${version}$2`);
    if (next !== sw) { fs.writeFileSync(swPath, next); changed.push('sw.js'); }
  }
  const cfgPath = path.join(root, 'js/config.js');
  const cfg = fs.readFileSync(cfgPath, 'utf8');
  const cfgNext = cfg.replace(/(APP_VERSION = ')[^']*(')/, `$1${version}$2`);
  if (cfgNext !== cfg) { fs.writeFileSync(cfgPath, cfgNext); changed.push('js/config.js'); }
  for (const rel of htmlAndJsFiles(root)) {
    const p = path.join(root, rel);
    const src = fs.readFileSync(p, 'utf8');
    const next = src
      .replace(/\?v=2026\.\d+\.\d+\.\d+/g, '')
      .replace(/(<meta name="app-version" content=")[^"]*(")/, `$1${version}$2`);
    if (next !== src) { fs.writeFileSync(p, next); changed.push(rel); }
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = computeVersion();
  if (process.argv.includes('--print')) {
    console.log(version);
  } else {
    const changed = stampFiles(version);
    console.log(`版本号 ${version}，已更新 ${changed.length} 个文件`);
  }
}
