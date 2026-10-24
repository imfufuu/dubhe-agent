export function installShiftEnterGuard(composer, onInput = () => {}) {
  let probe = null;
  composer.addEventListener('input', () => {
    if (probe) {
      const value = composer.value;
      const inserted = value.slice(probe.start, value.length - probe.suffix.length);
      if (value.startsWith(probe.prefix) && value.endsWith(probe.suffix) && /^\n{2,}$/u.test(inserted)) {
        composer.value = `${probe.prefix}\n${probe.suffix}`;
        const caret = probe.prefix.length + 1;
        composer.setSelectionRange(caret, caret);
      }
    }
    onInput();
  });
  composer.addEventListener('keyup', (event) => { if (event.key === 'Enter') probe = null; });
  return {
    capture() {
      const start = composer.selectionStart, end = composer.selectionEnd;
      probe = { start, prefix: composer.value.slice(0, start), suffix: composer.value.slice(end) };
    },
  };
}
