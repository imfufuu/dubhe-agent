import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  SUPPORTED_LANGUAGES, getIntlLocale, setLanguagePreference, text,
} from '../js/locale.js';
import {
  formatDate, formatDateTime, formatNumber, formatRelativeTime, pluralize, t, translateUI,
} from '../js/i18n.js?v=2026.10.25.1';
import { installLanguage } from '../js/ui-language.js?v=2026.10.25.1';
import {
  formatCurrency, getDisplayCurrency, setCurrencyPreference, USD_TO_CNY_RATE,
} from '../js/currency.js';

const englishTurns = { en: { one: '{count} turn', other: '{count} turns' } };

test('locale foundation supports the authorized UI languages without changing legacy prompt text', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'ru', 'ar']);
  assert.equal(getIntlLocale('ja'), 'ja-JP');
  assert.equal(getIntlLocale('ru'), 'ru-RU');
  setLanguagePreference('ja');
  assert.equal(text('中文提示词', 'English system prompt'), '中文提示词', 'new UI locales keep legacy zh/en prompt selection unchanged');
  assert.equal(translateUI('设置', 'ja'), '設定');
  assert.equal(translateUI('设置', 'es'), 'Configuración');
  assert.equal(translateUI('a user-authored sentence', 'fr'), 'a user-authored sentence', 'unknown conversation text is not translated');
  assert.equal(t('未思考', {}, 'de'), 'Keine Reasoning-Ausgabe');
});

test('Intl formats numbers, dates, relative time and CLDR plural categories', () => {
  assert.equal(formatNumber(12345.6, { maximumFractionDigits: 1 }, 'de'), '12.345,6');
  const fixed = new Date(Date.UTC(2026, 9, 25, 12));
  assert.ok(formatDate(fixed, 'ja').length > 0);
  assert.ok(formatDateTime(fixed, 'ar').length > 0);
  assert.equal(formatRelativeTime(fixed.getTime() - 86400000, 'en', fixed.getTime()), 'yesterday');
  assert.equal(pluralize(1, englishTurns, 'en'), '1 turn');
  assert.equal(pluralize(3, englishTurns, 'en'), '3 turns');
  assert.equal(pluralize(2, { ru: { one: 'one', few: 'few', many: 'many', other: 'other' } }, 'ru'), 'few');
  assert.equal(pluralize(2, { ar: { zero: 'zero', one: 'one', two: 'two', few: 'few', many: 'many', other: 'other' } }, 'ar'), 'two');
});

test('currency preference changes only display formatting and keeps the established CNY/USD auto rule', () => {
  setCurrencyPreference('auto');
  assert.equal(USD_TO_CNY_RATE, 6.718);
  assert.equal(getDisplayCurrency('zh'), 'CNY');
  assert.equal(getDisplayCurrency('ja'), 'USD');
  assert.equal(formatCurrency(1, 'en'), '$1.00');
  assert.equal(formatCurrency(1, 'zh'), '¥6.72');
  setCurrencyPreference('CNY');
  assert.match(formatCurrency(1, 'ja'), /6\.72/);
  setCurrencyPreference('auto');
});

test('language UI translation never rewrites conversation bodies or textarea values', async () => {
  const dom = new JSDOM('<!doctype html><html><body><button aria-label="设置">设置</button><div class="md-body">设置：user-authored text</div><textarea placeholder="你出想法，Duhbe来实现">原始用户输入</textarea></body></html>', {
    url: 'https://example.test/',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  document.documentElement.dataset.motion = 'off';
  setLanguagePreference('es');
  const i18n = installLanguage(document);
  try {
    assert.equal(document.querySelector('button').textContent, 'Configuración');
    assert.equal(document.querySelector('button').getAttribute('aria-label'), 'Configuración');
    assert.equal(document.querySelector('.md-body').textContent, '设置：user-authored text');
    const composer = document.querySelector('textarea');
    assert.equal(composer.value, '原始用户输入');
    assert.equal(composer.placeholder, 'Ideas in. Software out.');
    const dynamic = document.createElement('button');
    dynamic.textContent = '保存';
    document.body.append(dynamic);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(dynamic.textContent, 'Guardar');
  } finally {
    i18n.disconnect();
    dom.window.close();
    setLanguagePreference('zh');
    setCurrencyPreference('auto');
  }
});
