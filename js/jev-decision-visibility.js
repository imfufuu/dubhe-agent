// Dubhe Agent · Jev 初步决策提示的显隐（设置开关 showJevDecision，默认关闭）
// 通过根节点 class 控制，覆盖已渲染与之后新生成的 .jev-chip，不改动消息数据。
export const JEV_DECISION_CLASS = 'show-jev-decision';

export function syncJevDecisionVisibility(store) {
  const on = store?.state?.settings?.showJevDecision === true;
  document.documentElement.classList.toggle(JEV_DECISION_CLASS, on);
}

export function bindJevDecisionVisibility(store) {
  syncJevDecisionVisibility(store);
  store.subscribe(() => syncJevDecisionVisibility(store));
}
