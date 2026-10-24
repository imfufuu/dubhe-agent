import { onLanguageChange } from './locale.js';

// Existing message footers hold localized price labels; repaint them when the UI currency changes.
export function installLanguageCostRefresh({ store, msgNodes, paintTurnMeta }) {
  return onLanguageChange(() => {
    for (const message of store.state.messages || []) {
      if (message.role !== 'assistant') continue;
      const wrap = msgNodes.get(message.id);
      if (wrap) paintTurnMeta(wrap, message);
    }
  });
}
