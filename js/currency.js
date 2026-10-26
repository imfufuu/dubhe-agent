import { getLanguage, getIntlLocale, normalizeLanguage } from './locale.js';

// Display conversion only: model and usage rates remain USD internally. PBOC central parity, 2026-10-23.
export const USD_TO_CNY_RATE = 6.718;
export const USD_TO_CNY_RATE_DATE = '2026-10-23';
export const CURRENCY_KEY = 'dubhe-price-currency';
export const CURRENCY_PREFERENCES = Object.freeze(['auto', 'USD', 'CNY']);
const listeners = new Set();
let override = null;

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
  if (preference === 'USD' || preference === 'CNY') return preference;
  return normalizeLanguage(language, 'zh') === 'zh' ? 'CNY' : 'USD';
}

function currencyParts(amountUsd, language, explicitCurrency) {
  const currency = CURRENCY_PREFERENCES.includes(explicitCurrency) && explicitCurrency !== 'auto'
    ? explicitCurrency
    : getDisplayCurrency(language);
  const numeric = Number(amountUsd);
  const amount = currency === 'CNY' ? usdToCny(numeric) : numeric;
  return { currency, amount, locale: getIntlLocale(language) };
}

function formatAmount(amount, currency, locale, zero = false) {
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
