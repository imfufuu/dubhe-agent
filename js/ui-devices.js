// Capability detection never opens a media stream or asks for permission.
export function deviceKinds(devices) {
  const kinds = new Set((Array.isArray(devices) ? devices : []).map(d => d?.kind));
  return { microphone: kinds.has('audioinput'), camera: kinds.has('videoinput') };
}
export function installDeviceControls({ doc = document, nav = navigator } = {}) {
  const mic = doc.getElementById('voice-btn'), camera = doc.getElementById('camera-btn');
  const scan = doc.getElementById('scan-btn'); // 扫描入口只在「确认有摄像头且策略允许」时出现（V1.8.1）
  const media = nav.mediaDevices; let generation = 0;
  const allowed = (name) => { try { const policy = doc.permissionsPolicy || doc.featurePolicy; return !policy?.allowsFeature || policy.allowsFeature(name); } catch { return true; } };
  const apply = (state) => {
    if (mic) mic.hidden = !allowed('microphone') || state.microphone === false;
    if (camera) camera.hidden = !allowed('camera') || state.camera === false;
    if (scan) scan.hidden = !(allowed('camera') && state.camera === true);
  };
  const probe = async () => {
    const mine = ++generation;
    if (typeof media?.enumerateDevices !== 'function') { apply({}); return { unknown: true }; }
    try {
      const devices = await media.enumerateDevices(); if (mine !== generation) return;
      const state = deviceKinds(devices); apply(state); return state;
    } catch { if (mine === generation) apply({}); return { unknown: true }; }
  };
  if (media?.enumerateDevices) { if (mic) mic.hidden = true; if (camera) camera.hidden = true; }
  else if (scan) scan.hidden = true;
  media?.addEventListener?.('devicechange', probe);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) probe(); });
  const ready = probe(); return { ready, probe };
}
