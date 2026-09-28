/**
 * 期限入力用のカレンダー
 * - 年・月はプルダウンで選べる（数年先の期限もすぐに選べるようにするため）
 * - 曜日を表示し、土曜は青、日曜・祝日は赤。祝日は「祝」「休」の文字でも示す
 * - 「今日」「クリア」「閉じる」ボタン
 * - キーボード：矢印キーで日付を移動、Enterで選ぶ、Escで閉じる
 */
(function (App) {
  'use strict';

  const { el, clear } = App.UI;
  const D = App.DateUtils;

  let popover = null;
  let state = null; // { anchor, year, month, value, weekStart, onSelect }

  function ensurePopover() {
    if (popover) return popover;
    popover = el('div', { class: 'datepicker', role: 'dialog', 'aria-modal': 'false', 'aria-label': '期限を選ぶ' });
    document.body.appendChild(popover);
    document.addEventListener('mousedown', (e) => {
      if (!state) return;
      if (popover.contains(e.target) || state.anchor.contains(e.target)) return;
      close(false);
    });
    window.addEventListener('resize', () => { if (state) position(); });
    return popover;
  }

  function yearOptions(viewYear, valueYear) {
    const thisYear = new Date().getFullYear();
    const years = new Set();
    for (let y = thisYear - 1; y <= thisYear + 10; y += 1) years.add(y);
    years.add(viewYear);
    if (valueYear) years.add(valueYear);
    return [...years].sort((a, b) => a - b);
  }

  function render(focusDate) {
    const { year, month, value, weekStart } = state;
    const today = D.toDateStr(new Date());
    const first = new Date(year, month, 1);
    const startOffset = weekStart === 'mon' ? (first.getDay() + 6) % 7 : first.getDay();
    const gridStart = D.addDays(first, -startOffset);
    const weekdayOrder = weekStart === 'mon' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
    const valueDate = D.parseDate(value);

    const yearSelect = el('select', { class: 'control', 'aria-label': '年' },
      yearOptions(year, valueDate && valueDate.getFullYear()).map((y) => el('option', { value: y, selected: y === year, text: `${y}年` })));
    const monthSelect = el('select', { class: 'control', 'aria-label': '月' },
      Array.from({ length: 12 }, (_, i) => el('option', { value: i, selected: i === month, text: `${i + 1}月` })));
    yearSelect.addEventListener('change', () => { state.year = Number(yearSelect.value); render(); yearSelect.focus(); });
    monthSelect.addEventListener('change', () => { state.month = Number(monthSelect.value); render(); monthSelect.focus(); });

    const prev = el('button', { class: 'btn calendar__nav', type: 'button', 'aria-label': '前の月', text: '◀', onclick: () => moveMonth(-1, 'prev') });
    const next = el('button', { class: 'btn calendar__nav', type: 'button', 'aria-label': '次の月', text: '▶', onclick: () => moveMonth(1, 'next') });

    const headRow = el('tr', null, weekdayOrder.map((d) => el('th', {
      scope: 'col', class: d === 0 ? 'sun' : d === 6 ? 'sat' : '', text: D.WEEKDAYS[d],
    })));

    const rows = [];
    let focusTarget = null;
    for (let w = 0; w < 6; w += 1) {
      const cells = [];
      for (let i = 0; i < 7; i += 1) {
        const date = D.addDays(gridStart, w * 7 + i);
        const str = D.toDateStr(date);
        const holiday = App.Holidays.holidayName(date);
        const outside = date.getMonth() !== month;
        const classes = ['day'];
        if (outside) classes.push('day--outside');
        if (date.getDay() === 6) classes.push('sat');
        if (date.getDay() === 0 || holiday) classes.push('sun');
        if (str === today) classes.push('day--today');
        if (str === value) classes.push('day--selected');
        const label = `${D.formatFullDate(date)}${holiday ? ` ${holiday}` : ''}${str === today ? '（今日）' : ''}`;
        const button = el('button', {
          class: classes.join(' '), type: 'button', 'aria-label': label, 'aria-pressed': str === value ? 'true' : 'false',
          tabindex: '-1', dataset: { date: str },
          onclick: () => select(str),
        }, String(date.getDate()),
        holiday ? el('small', { text: /振替|国民/.test(holiday) ? '休' : '祝' }) : str === today ? el('small', { text: '今日' }) : null);
        if (focusDate && str === focusDate) focusTarget = button;
        cells.push(el('td', null, button));
      }
      rows.push(el('tr', null, cells));
    }

    const table = el('table', { role: 'grid' }, el('thead', null, headRow), el('tbody', null, rows));
    table.addEventListener('keydown', onGridKey);

    clear(popover);
    popover.append(
      el('div', { class: 'calendar__head' }, prev, yearSelect, monthSelect, next),
      table,
      el('div', { class: 'calendar__foot' },
        el('button', { class: 'btn btn--small', type: 'button', text: '今日', onclick: () => select(today) }),
        el('button', { class: 'btn btn--small', type: 'button', text: 'クリア', onclick: () => select('') }),
        el('button', { class: 'btn btn--small', type: 'button', text: '閉じる', onclick: () => close(true) })),
    );

    // 矢印キーで移動できるよう、選択中の日（なければ今日か1日）だけを Tab で選べるようにする
    const initial = focusTarget
      || popover.querySelector('.day--selected:not(.day--outside)')
      || popover.querySelector('.day--today:not(.day--outside)')
      || popover.querySelector('.day:not(.day--outside)');
    initial.tabIndex = 0;
    if (focusTarget) focusTarget.focus();
  }

  function moveMonth(delta, keepFocus) {
    const d = new Date(state.year, state.month + delta, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    render();
    if (keepFocus) popover.querySelector(`[aria-label="${keepFocus === 'prev' ? '前の月' : '次の月'}"]`).focus();
  }

  function onGridKey(e) {
    const current = e.target.closest('.day');
    if (!current) return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const nextDate = D.addDays(D.parseDate(current.dataset.date), moves[e.key]);
    const str = D.toDateStr(nextDate);
    const target = popover.querySelector(`.day[data-date="${str}"]`);
    if (target && !target.classList.contains('day--outside')) {
      popover.querySelectorAll('.day').forEach((b) => { b.tabIndex = -1; });
      target.tabIndex = 0;
      target.focus();
    } else {
      state.year = nextDate.getFullYear();
      state.month = nextDate.getMonth();
      render(str);
    }
  }

  function position() {
    const rect = state.anchor.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    popover.style.width = `${width}px`;
    const height = popover.offsetHeight;
    let left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 12 && rect.top - height - 6 > 12) top = rect.top - height - 6;
    if (top + height > window.innerHeight - 12) top = Math.max(12, window.innerHeight - height - 12);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function select(value) {
    const { onSelect } = state;
    close(true);
    onSelect(value);
  }

  /**
   * カレンダーを開く
   * anchor：開くきっかけのボタン（この下に表示する）
   * options：{ value: 'YYYY-MM-DD' | '', weekStart: 'mon' | 'sun' | 'today', onSelect(value) }
   */
  function open(anchor, options) {
    ensurePopover();
    const valueDate = D.parseDate(options.value);
    const base = valueDate || new Date();
    state = {
      anchor,
      year: base.getFullYear(),
      month: base.getMonth(),
      value: options.value || '',
      weekStart: options.weekStart === 'mon' ? 'mon' : 'sun', // 「今日」始まりのときは一般的な日曜始まりにする
      onSelect: options.onSelect,
    };
    anchor.setAttribute('aria-expanded', 'true');
    popover.classList.add('is-open');
    render();
    position();
    const focusTarget = popover.querySelector('.day[tabindex="0"]');
    if (focusTarget) focusTarget.focus();
  }

  function close(returnFocus) {
    if (!state) return;
    const { anchor } = state;
    state = null;
    popover.classList.remove('is-open');
    anchor.setAttribute('aria-expanded', 'false');
    if (returnFocus && document.contains(anchor)) anchor.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }, true);

  App.Datepicker = { open, close, isOpen: () => !!state };
})(window.TodoApp = window.TodoApp || {});
