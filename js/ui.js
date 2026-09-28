/**
 * 画面部品を作るための共通の処理
 * - el()：要素を作る（文字は必ず textContent で入れるので、入力内容にタグが含まれていても安全）
 * - Modal：モーダル・下から出る画面の開閉（Escキー・背景のクリックで閉じる、開く前の場所にフォーカスを戻す）
 * - confirmDialog()：確認の画面
 * - toast()：画面下に短いお知らせを出す
 */
(function (App) {
  'use strict';

  /**
   * 要素を作る
   * el('button', { class: 'btn', onclick: fn, 'aria-label': '...' }, '文字', 子要素...)
   */
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style' && typeof value === 'object') {
        // CSS変数（--p など）は setProperty でないと設定できない
        Object.entries(value).forEach(([prop, v]) => node.style.setProperty(prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v));
      }
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    });
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    children.flat(Infinity).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    });
  }

  /** SVGアイコン（index.html の <symbol> を参照する） */
  function icon(name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `icon ${cls || ''}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /* ========== モーダル ========== */

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const stack = [];

  /**
   * モーダルを開く
   * options: { content: 要素, labelledBy: 見出しのid, className, onClose, initialFocus: 要素 }
   * 戻り値の close() で閉じる
   */
  function openModal(options) {
    const previousFocus = document.activeElement;
    const backdrop = el('div', { class: 'modal-backdrop' });
    const dialog = el('div', {
      class: `modal ${options.className || ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': options.labelledBy,
    }, options.content);
    const layer = el('div', { class: 'modal-layer' }, backdrop, dialog);

    let closed = false;
    function close(result) {
      if (closed) return;
      closed = true;
      layer.remove();
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      document.body.classList.toggle('has-modal', stack.length > 0);
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      if (options.onClose) options.onClose(result);
    }

    backdrop.addEventListener('click', () => close());
    const entry = { layer, dialog, close };
    stack.push(entry);
    document.body.appendChild(layer);
    document.body.classList.add('has-modal');

    const first = options.initialFocus || dialog.querySelector(FOCUSABLE);
    if (first) first.focus();
    return entry;
  }

  function closeTopModal() {
    const top = stack[stack.length - 1];
    if (top) top.close();
  }

  // Escキーで一番上のモーダルを閉じる。Tabキーでフォーカスがモーダルの外に出ないようにする
  document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      // 期限入力用カレンダーが開いているときは、そちらが先に閉じる
      if (document.querySelector('.datepicker.is-open')) return;
      e.preventDefault();
      top.close();
    } else if (e.key === 'Tab') {
      const items = [...top.dialog.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /** 確認の画面。「はい」なら true を返す Promise */
  function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
    return new Promise((resolve) => {
      const titleId = `confirm-${Date.now()}`;
      let result = false;
      const ok = el('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', text: okLabel });
      const cancel = el('button', { class: 'btn', type: 'button', text: 'キャンセル' });
      const content = el('div', { class: 'confirm' },
        danger ? el('div', { class: 'confirm-icon', 'aria-hidden': 'true', text: '!' }) : null,
        el('h2', { class: 'dialog-title', id: titleId, text: title }),
        el('p', { class: 'confirm-text', text: message }),
        el('div', { class: 'dialog-actions' }, cancel, ok));
      const modal = openModal({
        content, labelledBy: titleId, className: 'modal--confirm', initialFocus: cancel,
        onClose: () => resolve(result),
      });
      ok.addEventListener('click', () => { result = true; modal.close(); });
      cancel.addEventListener('click', () => modal.close());
    });
  }

  /* ========== お知らせ ========== */

  let toastTimer = null;
  /**
   * お知らせを出す
   * action: { label, onClick } を渡すと、「元に戻す」などのボタンを付ける（表示時間も長くする）
   */
  function toast(message, type, action) {
    // 直前の保存に失敗しているときは、「追加しました」などの成功のお知らせでエラーを上書きしない
    if (type !== 'error' && App.Tasks && App.Tasks.isSaveFailed()) return;
    let box = document.getElementById('toast');
    if (!box) {
      box = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(box);
    }
    clear(box).append(el('span', { class: 'toast__text', text: message }));
    if (action) {
      box.append(el('button', {
        class: 'toast__action', type: 'button', text: action.label,
        onclick: () => { hide(); action.onClick(); },
      }));
    }
    box.className = `toast is-visible ${type === 'error' ? 'toast--error' : ''} ${action ? 'has-action' : ''}`;
    clearTimeout(toastTimer);
    function hide() { clearTimeout(toastTimer); box.className = 'toast'; }
    toastTimer = setTimeout(hide, type === 'error' || action ? 6000 : 2600);
  }

  /** 画面幅の判定（CSSのメディアクエリと同じ境目を使う） */
  const media = {
    isMobile: () => window.matchMedia('(max-width: 700px)').matches,
    isWide: () => window.matchMedia('(min-width: 1280px)').matches,
  };

  App.UI = { el, icon, clear, openModal, closeTopModal, confirmDialog, toast, media };
})(window.TodoApp = window.TodoApp || {});
