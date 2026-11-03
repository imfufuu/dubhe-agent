import { getLanguage, getIntlLocale, normalizeLanguage } from './locale.js';

// Display conversion only: model and usage rates remain USD internally. PBOC central parity, 2026-10-23.
export const USD_TO_CNY_RATE = 6.718;
export const USD_TO_CNY_RATE_DATE = '2026-10-23';
export const CURRENCY_KEY = 'dubhe-price-currency';
export const CURRENCY_PREFERENCES = Object.freeze(['auto', 'USD', 'CNY', 'EUR', 'JPY', 'GBP', 'HKD', 'KRW']);
// 每 1 USD 兑换的各币种数量（仅展示用，账单仍按 USD 内部计价）。
// CNY 沿用 PBOC 中间价；其余为 ECB 2026-11-02 欧元基准汇率（EUR/USD 1.1216、USD/JPY 等）交叉折算。
export const USD_RATES_DATE = '2026-11-02';
export const USD_RATES = Object.freeze({
  USD: 1,
  CNY: USD_TO_CNY_RATE,
  EUR: 0.891583,
  JPY: 157.8994,
  GBP: 0.745185,
  HKD: 7.846113,
  KRW: 1342.903,
});
const ZERO_DECIMAL_CCY = new Set(['JPY', 'KRW']);
const listeners = new Set();
let override = null;

export function usdToCurrency(amountUsd, currency) {
  const n = Number(amountUsd);
  const rate = USD_RATES[currency];
  return Number.isFinite(n) && Number.isFinite(rate) ? n * rate : NaN;
}

export function usdToCny(amountUsd) {
  const n = Number(amountUsd);
  return Number.isFinite(n) ? n * USD_TO_CNY_RATE : NaN;
}

export function getCurrencyPreference() {
  if (override) return override;
  try {
    const value = globalThis.localStorage?.getItem(CURRENCY_KEY);
    if (CURRENCY_PREFERENCES.includes(value)) return value;
  } catch { /* private storage */ }
  return 'auto';
}

export function setCurrencyPreference(value) {
  const next = CURRENCY_PREFERENCES.includes(value) ? value : 'auto';
  const changed = next !== getCurrencyPreference();
  override = next;
  try { globalThis.localStorage?.setItem(CURRENCY_KEY, next); } catch { /* usable for this page */ }
  if (changed) for (const fn of listeners) { try { fn(next); } catch { /* UI refresh cannot break preferences */ } }
  return next;
}

export function onCurrencyChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Auto keeps the established zh→CNY / en→USD behavior; all added locales default to USD. */
export function getDisplayCurrency(language = getLanguage()) {
  const preference = getCurrencyPreference();
  if (preference !== 'auto') return preference;
  return normalizeLanguage(language, 'zh') === 'zh' ? 'CNY' : 'USD';
}

function currencyParts(amountUsd, language, explicitCurrency) {
  const currency = CURRENCY_PREFERENCES.includes(explicitCurrency) && explicitCurrency !== 'auto'
    ? explicitCurrency
    : getDisplayCurrency(language);
  const numeric = Number(amountUsd);
  const amount = currency === 'USD' ? numeric : usdToCurrency(numeric, currency);
  return { currency, amount, locale: getIntlLocale(language) };
}

function formatAmount(amount, currency, locale, zero = false) {
  if (ZERO_DECIMAL_CCY.has(currency)) {
    // 日元 / 韩元没有小数位：大额取整，小额保留两位
    const max = zero || amount >= 10 ? 0 : 2;
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'symbol', minimumFractionDigits: 0, maximumFractionDigits: max }).format(amount);
  }
  const digits = zero || amount === 0 ? 4 : amount < 0.01 ? 4 : amount < 1 ? 4 : 2;
  const minimumFractionDigits = digits === 2 ? 2 : (amount < 0.01 || zero || amount === 0 ? 4 : 0);
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, currencyDisplay: 'symbol',
    minimumFractionDigits, maximumFractionDigits: digits,
  }).format(amount);
}

function normalizeFormatOptions(languageOrOptions) {
  if (languageOrOptions && typeof languageOrOptions === 'object') {
    const language = normalizeLanguage(languageOrOptions.language || languageOrOptions.locale || getLanguage(), 'zh');
    return { language, currency: languageOrOptions.currency };
  }
  return { language: normalizeLanguage(languageOrOptions || getLanguage(), 'zh'), currency: undefined };
}

function formatMoney(amountUsd, languageOrOptions) {
  const { language, currency: explicitCurrency } = normalizeFormatOptions(languageOrOptions);
  const { currency, amount, locale } = currencyParts(amountUsd, language, explicitCurrency);
  if (!Number.isFinite(amount) || amount < 0) return formatAmount(0, currency, locale, true);
  if (amount > 0 && amount < 0.0001) return `<${formatAmount(0.0001, currency, locale)}`;
  return formatAmount(amount, currency, locale);
}

/** Format a USD amount for the active UI locale/currency without changing stored billing values. */
export function formatCurrency(amountUsd, languageOrOptions = getLanguage()) {
  return formatMoney(amountUsd, languageOrOptions);
}

/** Format a USD price per million tokens (or another USD-denominated unit). */
export function formatRate(amountUsd, languageOrOptions = getLanguage()) {
  return formatMoney(amountUsd, languageOrOptions);
}
