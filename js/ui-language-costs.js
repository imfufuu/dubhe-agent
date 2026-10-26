import { onLanguageChange } from './locale.js';
import { onCurrencyChange } from './currency.js';

// Existing message footers hold localized price labels; repaint when locale or display currency changes.
export function installLanguageCostRefresh({ store, msgNodes, paintTurnMeta }) {
  const refresh = () => {
    for (const message of store.state.messages || []) {
      if (message.role !== 'assistant') continue;
      const wrap = msgNodes.get(message.id);
      if (wrap) paintTurnMeta(wrap, message);
    }
  };
  const offLanguage = onLanguageChange(refresh);
  const offCurrency = onCurrencyChange(refresh);
  return () => { offLanguage(); offCurrency(); };
}
