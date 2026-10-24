import { getLanguage } from './locale.js';

// Display conversion only: model and usage rates remain USD internally. PBOC central parity, 2026-10-23.
export const USD_TO_CNY_RATE = 6.718;
export const USD_TO_CNY_RATE_DATE = '2026-10-23';

export function usdToCny(amountUsd) {
  const n = Number(amountUsd);
  return Number.isFinite(n) ? n * USD_TO_CNY_RATE : NaN;
}

function formatNumber(n) {
  if (!Number.isFinite(n) || n < 0) return '0.0000';
  if (n === 0) return '0.0000';
  if (n < 0.01) return n.toFixed(4);
  if (n < 1) return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');
  return n.toFixed(2);
}

function currencyParts(amountUsd, language) {
  const isEnglish = language === 'en';
  const amount = isEnglish ? Number(amountUsd) : usdToCny(amountUsd);
  return { symbol: isEnglish ? '$' : '¥', amount };
}

/** Format a USD amount for the active interface language without changing stored billing values. */
export function formatCurrency(amountUsd, language = getLanguage()) {
  const { symbol, amount } = currencyParts(amountUsd, language);
  if (!Number.isFinite(amount) || amount < 0) return `${symbol}0.0000`;
  if (amount === 0) return `${symbol}0.0000`;
  if (amount < 0.0001) return `<${symbol}0.0001`;
  return `${symbol}${formatNumber(amount)}`;
}

/** Format a USD price per million tokens (or another USD-denominated unit). */
export function formatRate(amountUsd, language = getLanguage()) {
  const { symbol, amount } = currencyParts(amountUsd, language);
  if (!Number.isFinite(amount) || amount < 0) return `${symbol}0.0000`;
  if (amount < 0.0001) return `<${symbol}0.0001`;
  return `${symbol}${formatNumber(amount)}`;
}
