import { getLanguage, text, onLanguageChange } from './locale.js';

// Native SpeechRecognition is the sole microphone owner: requesting getUserMedia
// here as well produces a second browser permission prompt on some engines.
export function installSpeechInput({ composer, toast, onInput, win = window }) {
  const doc = composer?.ownerDocument || document;
  const button = doc.getElementById('voice-btn'), status = doc.getElementById('voice-status');
  const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!button) return { stop() {} };

  // The recording orb is CSS-animated; it intentionally does not open a second mic stream for a volume meter.
  const orb = doc.createElement('span');
  orb.className = 'voice-orb';
  orb.setAttribute('aria-hidden', 'true');
  button.appendChild(orb);

  let recognition = null, generation = 0, lastValue = '', before = '', after = '', active = false;
  let audioContext = null, recordingBegan = false;

  const ensureAudio = () => {
    const AC = win.AudioContext || win.webkitAudioContext;
    if (!AC) return null;
    try {
      if (!audioContext || audioContext.state === 'closed') audioContext = new AC();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return audioContext;
    } catch { return null; }
  };
  const playCue = (kind) => {
    const ctx = ensureAudio();
    if (!ctx) return;
    const notes = kind === 'start'
      ? [{ f: 659.25, at: 0, d: .12 }, { f: 880, at: .065, d: .16 }]
      : [{ f: 783.99, at: 0, d: .11 }, { f: 587.33, at: .065, d: .17 }];
    const t0 = ctx.currentTime;
    for (const note of notes) {
      try {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        const startAt = t0 + note.at;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note.f, startAt);
        gain.gain.setValueAtTime(.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(.045, startAt + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, startAt + note.d);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(startAt); osc.stop(startAt + note.d + .02);
      } catch { /* Audio is an enhancement; dictation still works when unavailable. */ }
    }
  };
  const finishCue = () => {
    if (!recordingBegan) return;
    recordingBegan = false;
    playCue('stop');
  };
  const paint = () => {
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('listening', active);
    button.title = button.ariaLabel = active ? text('停止语音输入', 'Stop dictation') : text('语音输入', 'Dictate');
  };
  const stop = () => {
    generation++;
    active = false;
    finishCue();
    try { recognition?.abort(); } catch { /* already ended */ }
    recognition = null;
    if (status) status.textContent = '';
    paint();
  };

  const supported = !!Ctor && win.isSecureContext !== false;
  button.disabled = !supported;
  if (!supported) {
    const unavailable = () => { button.title = text('当前浏览器不支持原生语音识别', 'This browser does not support native speech recognition'); };
    onLanguageChange(unavailable); unavailable();
    return { stop };
  }

  button.addEventListener('click', () => {
    if (active) { stop(); return; }
    const mine = ++generation;
    before = composer.value.slice(0, composer.selectionStart ?? composer.value.length);
    after = composer.value.slice(composer.selectionEnd ?? composer.value.length);
    lastValue = composer.value;
    recognition = new Ctor();
    recognition.lang = getLanguage() === 'en' ? 'en-US' : 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    // Create/resume audio within the click gesture so short cues can play after recognition starts.
    ensureAudio();
    recognition.onstart = () => {
      if (mine !== generation || !active) return;
      recordingBegan = true;
      playCue('start');
    };
    recognition.onresult = (e) => {
      if (!active || mine !== generation) return;
      if (composer.value !== lastValue) { stop(); return; }
      const values = Array.from(e.results || [], (r) => String(r[0]?.transcript || '').trim());
      const transcript = values.filter(Boolean).join(recognition.lang.startsWith('en') ? ' ' : '');
      if (!transcript) return;
      lastValue = before + transcript + after;
      composer.value = lastValue;
      const cursor = before.length + transcript.length;
      composer.setSelectionRange(cursor, cursor);
      composer.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
      onInput?.();
      if (status) status.textContent = text('正在听…点击麦克风结束', 'Listening… click the microphone to stop');
    };
    recognition.onerror = (e) => {
      if (mine !== generation) return;
      const reason = e.error;
      stop();
      if (reason === 'aborted') return;
      toast(reason === 'not-allowed' || reason === 'service-not-allowed'
        ? text('麦克风或语音识别权限被拒绝', 'Microphone or speech recognition permission denied')
        : reason === 'network' ? text('浏览器语音服务连接失败，请检查网络', 'The browser speech service could not connect. Check your network.')
        : reason === 'no-speech' ? text('未识别到语音，请重试', 'No speech detected. Try again.')
        : text('语音识别失败：', 'Speech recognition failed: ') + String(reason || 'unknown'), 'warn');
    };
    recognition.onend = () => {
      if (mine !== generation) return;
      active = false;
      recognition = null;
      finishCue();
      paint();
      if (status) status.textContent = '';
    };
    active = true;
    paint();
    if (status) status.textContent = text('请说话，识别结果不会自动发送', 'Speak now. Dictation never sends automatically.');
    try { recognition.start(); }
    catch (err) { stop(); toast(text('无法启动语音识别：', 'Could not start dictation: ') + err.message, 'warn'); }
  });

  // Sending, cancellation, manual edits, locale changes and backgrounding must never let late speech overwrite another draft.
  doc.getElementById('send-btn')?.addEventListener('click', stop, true);
  composer.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) stop(); }, true);
  composer.addEventListener('input', () => { if (active && composer.value !== lastValue) stop(); });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) stop(); });
  onLanguageChange(() => { stop(); paint(); });
  paint();
  return { stop };
}
