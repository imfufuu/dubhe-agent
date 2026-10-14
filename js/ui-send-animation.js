// Shared composer → message flight. Presentation only: never delays sending/API work.
export function animateMessageSend(bubble, origin, { reducedMotion } = {}) {
  const doc = bubble?.ownerDocument;
  const preference = doc?.documentElement.dataset.motion;
  const reduce = reducedMotion ?? (preference === 'off' || (preference !== 'on' && doc?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  if (!bubble?.isConnected || !origin || reduce || typeof bubble.animate !== 'function') return null;
  const target = bubble.getBoundingClientRect();
  const animation = bubble.animate([
    { transform: `translate(${origin.left - target.left}px, ${origin.top - target.top}px) scale(.96)`, opacity: .5 },
    { transform: 'translate(0, -5px) scale(1.01)', opacity: 1, offset: .8 },
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
  ], { duration: 560, easing: 'cubic-bezier(.22,.8,.24,1)' });
  return animation;
}
