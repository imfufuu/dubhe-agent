// 首次进入网页：请用户设置称谓（可用预设），之后不再打扰。
import { text as t } from './locale.js';
import { USER_SALUTATION_KEY, validateUserSalutation, saveUserSalutation, getOrCreateUserSalutation, SALUTATION_PRESETS } from './user-salutation.js';

const PRESETS = SALUTATION_PRESETS;

export function needsFirstVisit(storage = globalThis.localStorage) {
  try { return !String(storage?.getItem(USER_SALUTATION_KEY) || '').trim(); } catch { return false; }
}

export function installFirstVisit({ doc = globalThis.document, storage = globalThis.localStorage } = {}) {
  if (!doc?.body || !needsFirstVisit(storage)) return null;
  const modal = doc.createElement('div');
  modal.className = 'modal first-visit-modal';
  modal.id = 'first-visit-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `<div class="modal-card first-visit-card">
    <div class="modal-head"><h3 id="first-visit-title"></h3></div>
    <p id="first-visit-hint" class="modal-desc"></p>
    <input id="first-visit-name" class="set-input" type="text" maxlength="16" autocomplete="off" spellcheck="false" />
    <div id="first-visit-presets" class="first-visit-presets"></div>
    <p id="first-visit-status" class="modal-desc" role="status"></p>
    <div class="modal-actions"><button id="first-visit-save" type="button" class="primary-btn"></button></div>
  </div>`;
  doc.body.appendChild(modal);
  const $ = (id) => doc.getElementById(id);
  $('first-visit-title').textContent = t('先给自己起个名字', 'Pick a display name');
  $('first-visit-hint').textContent = t('只保存在本机浏览器，可随时在设置里修改；也可以直接用下面的预设。', 'Stored only in this browser; you can change it in Settings, or pick a preset below.');
  $('first-visit-name').placeholder = t('输入昵称（最多 16 字）', 'Your nickname (max 16 chars)');
  $('first-visit-save').textContent = t('保存并开始', 'Save and continue');
  const presets = $('first-visit-presets');
  for (const name of PRESETS) {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'mini-btn first-visit-preset'; b.textContent = name;
    b.addEventListener('click', () => { $('first-visit-name').value = name; $('first-visit-status').textContent = ''; });
    presets.appendChild(b);
  }
  const close = () => { modal.classList.remove('open'); setTimeout(() => modal.remove(), 320); };
  const save = () => {
    const result = saveUserSalutation($('first-visit-name').value || getOrCreateUserSalutation());
    if (!result.ok) { $('first-visit-status').textContent = result.reason; return; }
    try { doc.defaultView?.dispatchEvent(new (doc.defaultView.CustomEvent || CustomEvent)('dubhe:user-salutation-changed', { detail: { salutation: result.value } })); } catch { /* noop */ }
    close();
  };
  $('first-visit-save').addEventListener('click', save);
  $('first-visit-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  requestAnimationFrame(() => modal.classList.add('open'));
  return { modal, close, save };
}
