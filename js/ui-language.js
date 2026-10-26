import { preserveLanguageViewport } from './language-scroll.js';
import { motionAllowed, veilFade } from './page-fx.js?v=2026.10.25.1';
import { getLanguage, getIntlLocale, languagePreference, setLanguagePreference, onLanguageChange, setLanguageTransition } from './locale.js';
import { getCurrencyPreference, setCurrencyPreference, onCurrencyChange } from './currency.js';
import { translateUI } from './i18n.js?v=2026.10.25.1';
export { translateUI };
// Only UI chrome is translated. Message bodies, code, file names, model output and user content retain their exact values.
const PRIVATE = '.md-body,.chip-detail,.ep-tx,.ep-path,.tree-name,.fp-name,.file-path,.thought-text,.reasoning-text,.files-name,.file-name,.ft-name,.session-title,.sess-title,[data-i18n-ignore],textarea,pre,code,script,style';
const QUICK_TOGGLE_LANGUAGES = new Set(['zh', 'en']);

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
      const privateContent = node.closest(PRIVATE) && !node.matches('button,[role=button],.chip-copy,.cb-copy,textarea');
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
  // The veil reaches the theme background before language callbacks mutate visible UI labels.
  setLanguageTransition((run, changed) => {
    const doc = root.ownerDocument || root;
    if (changed && motionAllowed(doc) && doc.body) {
      void veilFade(doc, () => preserveLanguageViewport(doc, run)).catch(() => {});
    } else preserveLanguageViewport(doc, run);
  });
  const syncCurrencySelect = () => {
    const doc = root.ownerDocument || root;
    const select = doc.getElementById('set-currency');
    if (select) select.value = getCurrencyPreference();
  };
  const sync = () => {
    const doc = root.ownerDocument || root;
    const lang = getLanguage();
    doc.documentElement.lang = getIntlLocale(lang);
    doc.documentElement.dataset.uiLanguage = lang;
    observer.disconnect(); translate(root); watch();
    const select = doc.getElementById('set-language'); if (select) select.value = languagePreference();
    syncCurrencySelect();
    doc.querySelectorAll('[data-language-toggle]').forEach((b) => {
      const visible = QUICK_TOGGLE_LANGUAGES.has(lang);
      b.hidden = !visible;
      b.textContent = lang === 'en' ? '中文' : 'EN';
      b.setAttribute('aria-label', lang === 'en' ? 'Switch to Chinese' : 'Switch to English');
    });
  };
  root.addEventListener('click', (e) => {
    if (!e.target.closest?.('[data-language-toggle]')) return;
    const lang = getLanguage();
    if (lang === 'zh' || lang === 'en') setLanguagePreference(lang === 'en' ? 'zh' : 'en');
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'set-language') setLanguagePreference(e.target.value);
    else if (e.target.id === 'set-currency') setCurrencyPreference(e.target.value);
  });
  onLanguageChange(sync);
  onCurrencyChange(syncCurrencySelect);
  sync();
  return { sync, translate: (node) => { observer.disconnect(); translate(node); watch(); }, disconnect: () => observer.disconnect() };
}
