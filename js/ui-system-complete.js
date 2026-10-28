// ─── UI · /system 通道的实时命令候选菜单 ─────────────────────────────────────
// 输入以 / 开头且处于 /system 通道时，在输入框上方显示候选（随输入实时过滤）。
// 键位：↑/↓ 选择 · Tab 补全 · Enter 在「输入未完成」时补全、完成后发送 · Esc 关闭 · 鼠标点击补全。
import { getSystemCommandSuggestions, isSameCommandText } from './system-command-complete.js';
import { text as localeText } from './locale.js';

const MAX_ITEMS = 12;

export function installSystemCommandComplete({ composer, wrap, isActive, getModelIds = () => [] }) {
  if (!composer || !wrap) return { refresh() {}, handleKeydown: () => false, close() {} };

  const menu = document.createElement('div');
  menu.id = 'sys-cmd-menu';
  menu.className = 'sys-cmd-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', localeText('系统命令候选', 'System command suggestions'));
  menu.hidden = true;
  wrap.insertBefore(menu, wrap.firstChild);

  let items = [];
  let index = 0;
  let open = false;

  const locale = () => (document.documentElement.lang || navigator.language || 'zh');

  function close() {
    open = false;
    items = [];
    menu.hidden = true;
    menu.replaceChildren();
    composer.setAttribute('aria-expanded', 'false');
  }

  function render() {
    menu.replaceChildren();
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sys-cmd-item${i === index ? ' active' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', i === index ? 'true' : 'false');
      btn.dataset.index = String(i);
      const code = document.createElement('span');
      code.className = 'sys-cmd-insert mono';
      code.textContent = item.label;
      const hint = document.createElement('span');
      hint.className = 'sys-cmd-hint';
      hint.textContent = item.hint;
      btn.append(code, hint);
      // mousedown 阻止输入框失焦，保证点击能先于失焦完成补全
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => { index = i; accept(); });
      menu.appendChild(btn);
    });
    const active = menu.querySelector('.sys-cmd-item.active');
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
  }

  function refresh() {
    if (typeof isActive === 'function' && !isActive()) return close();
    const value = composer.value;
    const result = getSystemCommandSuggestions(value, { models: getModelIds(), locale: locale() });
    if (!result || !result.items.length) return close();
    items = result.items.slice(0, MAX_ITEMS);
    if (index >= items.length) index = 0;
    open = true;
    menu.hidden = false;
    composer.setAttribute('aria-expanded', 'true');
    render();
  }

  function setValue(next) {
    composer.value = next;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    try { composer.setSelectionRange(next.length, next.length); } catch { /* 忽略 */ }
  }

  function accept() {
    const item = items[index];
    if (!item) return false;
    setValue(item.insert);
    // 命令补全后立即刷新：带参数的命令会接着展示参数候选
    refresh();
    composer.focus();
    return true;
  }

  function move(delta) {
    if (!items.length) return;
    index = (index + delta + items.length) % items.length;
    render();
  }

  /** 返回 true 表示按键已被菜单消费（调用方应停止处理，例如不发送消息）。 */
  function handleKeydown(e) {
    if (!open || !items.length || e.isComposing) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return true; }
    if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
    if (e.key === 'Tab' && !e.shiftKey) {
      const item = items[index];
      if (item && !isSameCommandText(item.insert, composer.value)) { e.preventDefault(); return accept(); }
      return false;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const item = items[index];
      // 末尾是空格说明用户已在输入参数（或命令已完整），此时 Enter 直接发送
      const typingArgs = /\s$/u.test(composer.value);
      if (item && !typingArgs && !isSameCommandText(item.insert, composer.value)) { e.preventDefault(); return accept(); }
      return false;
    }
    return false;
  }

  composer.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== composer) close(); }, 120); });
  composer.setAttribute('aria-controls', menu.id);
  composer.setAttribute('aria-autocomplete', 'list');

  return { refresh, handleKeydown, close, isOpen: () => open };
}
