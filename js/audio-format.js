// Audio containers accepted by the dedicated Gemini file-input tool.
export const AUDIO_EXT_RE = /\.(mp3|mpga|wav|m4a|aac|ogg|oga|opus|flac|weba)$/i;
export const AUDIO_MIME_RE = /^audio\/(mpeg|mp3|wav|wave|x-wav|mp4|x-m4a|aac|ogg|opus|flac|x-flac|webm)$/i;
export const AUDIO_MAX_BYTES = 16 * 1024 * 1024;
export function audioMimeOf(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  return ({ mp3:'audio/mpeg', mpga:'audio/mpeg', wav:'audio/wav', m4a:'audio/mp4', aac:'audio/aac', ogg:'audio/ogg', oga:'audio/ogg', opus:'audio/ogg', flac:'audio/flac', weba:'audio/webm', webm:'audio/webm' })[ext] || '';
}
export function normalizeAudioData(dataUrl, filename = '') {
  const match = /^data:([^;,]*);base64,([a-zA-Z0-9+/\r\n]*={0,2})$/.exec(String(dataUrl || ''));
  if (!match || !match[2]) throw Error('音频必须是非空的 base64 data URL');
  const mime = AUDIO_MIME_RE.test(match[1]) ? match[1].toLowerCase() : (['', 'application/octet-stream'].includes(match[1]) ? audioMimeOf(filename) : '');
  if (!mime) throw Error('不支持的音频类型，请使用 MP3、WAV、M4A、AAC、OGG、FLAC 或 WebM Audio');
  const base64 = match[2].replace(/[\r\n]/g, '');
  if (base64.length % 4 !== 0) throw Error('音频 base64 数据不完整');
  const bytes = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > AUDIO_MAX_BYTES) throw Error('音频超过 16MB，请裁剪或压缩后再传');
  return { dataUrl: `data:${mime};base64,${base64}`, mime, bytes };
}
