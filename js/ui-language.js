import { getLanguage, languagePreference, setLanguagePreference, onLanguageChange, setLanguageTransition } from './locale.js';
import { UI_STRINGS } from './ui-strings.js?v=2026.10.12.1';
// Only UI chrome is translated. Message bodies, code, file names, model output and user content retain their exact values.
const PRIVATE = '.md-body,.chip-detail,.ep-tx,.ep-path,.tree-name,.fp-name,.file-path,.thought-text,.reasoning-text,.files-name,.file-name,.session-title,.sess-title,[data-i18n-ignore],textarea,pre,code,script,style';
export function translateUI(value, language = getLanguage()) {
  const raw = String(value ?? ''); if (language !== 'en') return raw;
  const key = raw.trim(), exact = Object.hasOwn(UI_STRINGS, key) ? UI_STRINGS[key] : null;
  if (exact) return raw.replace(key, exact);
  const rules = [
    [/^(Dubhe Agent) · 构建 (.+)$/, '$1 · Build $2'],
    [/^(Dubhe Agent V1\.7) · 构建 (.+) · 独立项目，与 TeamoRouter 互不隶属$/, '$1 · Build $2 · Independent of TeamoRouter'], [/^(Dubhe Agent V1\.7) · 构建 (.+)$/, '$1 · Build $2'],
    [/^思考 (.+)$/, 'Reasoning $1'], [/^已禁用 (\d+)$/, '$1 disabled'], [/^(\d+) 个会话 · (.+)$/, '$1 conversations · $2'],
    [/^剩余 (.+)$/, 'Remaining $1'], [/^已用 (.+)$/, 'Used $1'],
    [/^(\d+) 个文件$/, '$1 files'], [/^已选 (\d+) 条$/, '$1 selected'],
    [/^思考 ([\d.]+s)$/, 'Thinking $1'], [/^耗时 (.+)$/, 'Duration $1'],
    [/^已复制 (.+)$/, 'Copied $1'], [/^已删除 (\d+) .+$/, 'Deleted $1 items'],
    [/^共 (\d+) .+$/, 'Total: $1'], [/^无匹配模型$/, 'No matching models'],
    [/^未找到 (.+)$/, 'Not found: $1'], [/^加载更早的消息.*$/, 'Load earlier messages'],
    [/^显示最近 (\d+) 条.*$/, 'Showing the latest $1 messages'],
    [/^当前沙箱 (.+)$/, 'Workspace: $1'], [/^已连接：(.+)$/, 'Connected: $1'],
    [/^自定义地址不可用：(.+)$/, 'Custom relay unavailable: $1'],
  ];
  for (const [re, replacement] of rules) if (re.test(key)) return raw.replace(key, key.replace(re, replacement));
  return raw;
}
export function installLanguage(root = document) {
  const texts = new WeakMap(), attrs = new WeakMap();
  let observer, queued = false;
  const pending = new Set();
  const isPrivate = (n) => !!n.parentElement?.closest(PRIVATE) && !n.parentElement?.closest('[data-i18n-ui]');
  const translate = (node) => {
    if (node.nodeType === 3) {
      if (isPrivate(node) || !node.nodeValue?.trim()) return;
      const old = texts.get(node), original = old && node.nodeValue === old.output ? old.original : node.nodeValue;
      const output = translateUI(original); texts.set(node, { original, output });
      if (node.nodeValue !== output) node.nodeValue = output; return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9) return;
    if (node.nodeType === 1) {
      if (node.matches('script,style,[data-i18n-ignore]')) return;
      // Localized accessible labels are UI; never touch href, src, values, IDs or tool arguments.
      let record = attrs.get(node); if (!record) { record = {}; attrs.set(node, record); }
      const privateContent = node.closest(PRIVATE) && !node.matches('button,[role=button],.chip-copy,.cb-copy');
      for (const attr of privateContent ? [] : ['title', 'aria-label', 'placeholder']) {
        if (!node.hasAttribute(attr)) continue;
        const current = node.getAttribute(attr), previous = record[attr];
        const original = previous && previous.output === current ? previous.original : current;
        const output = translateUI(original); record[attr] = { original, output };
        if (current !== output) node.setAttribute(attr, output);
      }
    }
    for (const child of [...node.childNodes]) translate(child);
  };
  const watch = () => observer.observe(root.documentElement || root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
  const flush = () => {
    queued = false; observer?.disconnect();
    for (const node of pending) if (node.isConnected || node === root) translate(node);
    pending.clear(); watch();
  };
  observer = new (root.ownerDocument || root).defaultView.MutationObserver((records) => {
    for (const r of records) { if (r.type === 'childList') for (const n of r.addedNodes) pending.add(n); else pending.add(r.target); }
    if (!queued && pending.size) { queued = true; queueMicrotask(flush); }
  });
  // 语言切换：整页慢慢渐白 → 全白时执行所有语言回调（替换文案）→ 缓缓隐出界面。
  // 遮罩先出现、回调放在全白时执行：卡顿发生在看不见的时候，而不是点击后画面冻住。
  // 白色遮罩盖住整个视口（含弹层），动画结束即移除；关闭动效时直接执行回调。
  const whiteFade = (doc, run) => {
    const veil = doc.createElement('div');
    veil.setAttribute('aria-hidden', 'true');
    veil.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#fff;opacity:0;pointer-events:none;will-change:opacity;';
    doc.body.appendChild(veil);
    const ease = 'cubic-bezier(.45,0,.25,1)';
    const fadeIn = veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1000, easing: ease, fill: 'forwards' });
    fadeIn.finished.then(() => {
      run(); // 全白时执行回调（替换文案、刷新各面板）
      return veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1300, easing: ease, fill: 'forwards' }).finished;
    }).catch(() => {}).finally(() => veil.remove());
  };
  setLanguageTransition((run, changed) => {
    const doc = root.ownerDocument || root;
    const reduce = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches && doc.documentElement.dataset.motion !== 'on';
    const motionOn = doc.documentElement.dataset.motion !== 'off' && !reduce;
    if (changed && motionOn && doc.body) whiteFade(doc, run);
    else run();
  });
  const sync = () => {
    const doc = root.ownerDocument || root; doc.documentElement.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
    doc.documentElement.dataset.uiLanguage = getLanguage();
    observer.disconnect(); translate(root); watch();
    const select = doc.getElementById('set-language'); if (select) select.value = languagePreference();
    doc.querySelectorAll('[data-language-toggle]').forEach((b) => { b.textContent = getLanguage() === 'en' ? '中文' : 'EN'; b.setAttribute('aria-label', getLanguage() === 'en' ? 'Switch to Chinese' : 'Switch to English'); });
  };
  root.addEventListener('click', (e) => { if (e.target.closest?.('[data-language-toggle]')) setLanguagePreference(getLanguage() === 'en' ? 'zh' : 'en'); });
  root.addEventListener('change', (e) => { if (e.target.id === 'set-language') setLanguagePreference(e.target.value); });
  onLanguageChange(sync); sync();
  return { sync, translate: (node) => { observer.disconnect(); translate(node); watch(); }, disconnect: () => observer.disconnect() };
}
