/**
 * 週表示
 * PC：横軸に7日間、縦軸に時間（0:00〜24:00）の表。右側に詳細パネル
 *     1日の列の幅は最小130px。入りきらない分は表の中だけを横にスクロールする（日付の見出しと時間の列は固定）
 * スマホ：7日分の日付を横一列に並べ、選んだ日の1日分のタイムラインを表示する
 */
(function (App) {
  'use strict';

  const { el, icon, clear, toast, media } = App.UI;
  const T = App.Tasks;
  const D = App.DateUtils;
  const Dialogs = App.TaskDialogs;

  const HOUR_HEIGHT = 56;
  const FIRST_VISIBLE_HOUR = 8;

  let root = null;
  let refs = {};
  let anchor = null;        // 表示している週に含まれる日（Date）
  let customStart = null;   // 「前の日」「次の日」で1日ずつずらしたときの、表示の最初の日（Date）。null なら週の始まりの設定どおり
  let selectedDay = null;   // スマホで選んでいる日（"YYYY-MM-DD"）
  let needsInitialScroll = true;
  let mobileScrollPending = true; // スマホで日付を切り替えたら、8:00（今日なら現在時刻）まで移動する
  let popover = null;

  /* ========== 骨組み ========== */

  function mount(container) {
    root = container;
    const today = D.startOfDay(new Date());
    anchor = today;
    selectedDay = D.toDateStr(today);

    const weekStartSelect = el('select', { class: 'control', id: 'week-start', 'aria-label': '週の始まり' },
      el('option', { value: 'today', text: '週の始まり：今日' }),
      el('option', { value: 'mon', text: '週の始まり：月曜' }),
      el('option', { value: 'sun', text: '週の始まり：日曜' }));
    // 週の始まりを変えたときは、今日を含む週を表示する
    weekStartSelect.addEventListener('change', () => {
      customStart = null;
      anchor = D.startOfDay(new Date());
      selectedDay = D.toDateStr(anchor);
      T.updateSettings({ weekStart: weekStartSelect.value });
    });

    refs = {
      period: el('h1', { class: 'week-period', tabindex: '-1' }),
      weekStartSelect,
      noDate: el('button', { class: 'btn', type: 'button', onclick: showNoDateTasks }),
      chips: el('div', { class: 'chips' }),
      scroll: el('div', { class: 'week-scroll', tabindex: '0', 'aria-label': '週の予定の表。横と縦にスクロールできます' }),
      cueLeft: el('button', { class: 'scroll-cue scroll-cue--left', type: 'button', 'aria-label': '左側の日付を表示', text: '‹', onclick: () => scrollByDay(-1) }),
      cueRight: el('button', { class: 'scroll-cue scroll-cue--right', type: 'button', 'aria-label': '右側の日付を表示', text: '›', onclick: () => scrollByDay(1) }),
      panel: el('aside', { class: 'card week-detail', 'aria-label': 'タスクの詳細' }),
      panelToggle: el('button', { class: 'btn week-panel-open', type: 'button', 'aria-label': '詳細パネルを開く', onclick: () => setPanelOpen(true) }, '‹ 詳細パネルを開く'),
      mobile: el('div', { class: 'mweek' }),
    };
    refs.scroll.addEventListener('scroll', updateCues);

    const toolbar = el('div', { class: 'week-toolbar' },
      el('div', { class: 'week-nav', role: 'group', 'aria-label': '表示する日の移動' },
        el('button', { class: 'btn', type: 'button', onclick: () => moveWeek(-1), 'aria-label': '前の週へ移動' }, '« 前の週'),
        el('button', { class: 'btn', type: 'button', onclick: () => moveDay(-1), 'aria-label': '前の日へ移動' }, '‹ 前の日'),
        el('button', { class: 'btn btn--primary', type: 'button', text: '今日', onclick: goToday }),
        el('button', { class: 'btn', type: 'button', onclick: () => moveDay(1), 'aria-label': '次の日へ移動' }, '次の日 ›'),
        el('button', { class: 'btn', type: 'button', onclick: () => moveWeek(1), 'aria-label': '次の週へ移動' }, '次の週 »')),
      refs.period,
      weekStartSelect);

    const toolbar2 = el('div', { class: 'week-toolbar2' },
      App.ListView.searchBox('search-week'),
      el('button', { class: 'btn', type: 'button', onclick: () => App.openFilterDialog() }, icon('filter'), '絞り込み'),
      refs.noDate,
      refs.panelToggle);

    const board = el('div', { class: 'card week-card' }, refs.scroll, refs.cueLeft, refs.cueRight);
    refs.layout = el('div', { class: 'week-layout' }, board, refs.panel);

    root.append(toolbar, toolbar2, refs.chips, refs.layout, refs.mobile);
  }

  /* ========== 週の計算 ========== */

  function weekDays() {
    const today = D.startOfDay(new Date());
    const start = customStart || D.weekStartOf(anchor, T.getData().settings.weekStart, today);
    return Array.from({ length: 7 }, (_, i) => D.addDays(start, i));
  }

  function moveWeek(delta) {
    if (customStart) customStart = D.addDays(customStart, delta * 7);
    anchor = D.addDays(anchor, delta * 7);
    const days = weekDays();
    selectedDay = D.toDateStr(days[0]);
    mobileScrollPending = true;
    closePopover();
    render();
  }

  /**
   * 1日ずつ移動する
   * PC：表示している7日間を1日ずらす　スマホ：選んでいる日を1日ずらす（週の外に出たら週も切り替わる）
   */
  function moveDay(delta) {
    closePopover();
    if (media.isMobile()) { changeDay(delta); return; }
    customStart = D.addDays(weekDays()[0], delta);
    anchor = customStart;
    selectedDay = D.toDateStr(customStart);
    render();
  }

  function goToday() {
    customStart = null;
    anchor = D.startOfDay(new Date());
    selectedDay = D.toDateStr(anchor);
    mobileScrollPending = true;
    closePopover();
    render();
    scrollToNow();
  }

  function visibleTasks(now) {
    return T.filterTasks(T.getData().tasks, App.State.filters, now);
  }

  /** 日付と時間ごとにタスクを分ける：{ "YYYY-MM-DD": { allDay: [], hours: { 9: [] } } } */
  function bucketTasks(tasks) {
    const map = {};
    tasks.forEach((t) => {
      if (!t.dueDate) return;
      const b = map[t.dueDate] || (map[t.dueDate] = { allDay: [], hours: {} });
      const time = D.parseTime(t.dueTime);
      if (time) (b.hours[time.h] || (b.hours[time.h] = [])).push(t);
      else b.allDay.push(t);
    });
    const order = (a, b) => (a.dueTime || '').localeCompare(b.dueTime || '') || T.PRIORITY_RANK[a.priority] - T.PRIORITY_RANK[b.priority] || b.createdAt - a.createdAt;
    Object.values(map).forEach((b) => { b.allDay.sort(order); Object.values(b.hours).forEach((list) => list.sort(order)); });
    return map;
  }

  /* ========== 描画 ========== */

  function render() {
    const now = new Date();
    const settings = T.getData().settings;
    refs.weekStartSelect.value = settings.weekStart;
    const days = weekDays();
    const last = days[6];
    const sameYear = days[0].getFullYear() === last.getFullYear() && days[0].getFullYear() === now.getFullYear();
    const fmt = (d, withYear) => `${withYear ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日（${D.WEEKDAYS[d.getDay()]}）`;
    refs.period.textContent = `${fmt(days[0], true)}〜${fmt(last, !sameYear || days[0].getFullYear() !== last.getFullYear())}`;

    const tasks = visibleTasks(now);
    const noDate = tasks.filter((t) => !t.dueDate && !t.completed).length;
    refs.noDate.textContent = `期限なし：${noDate}件`;
    refs.noDate.setAttribute('aria-label', `期限なしのタスク ${noDate}件。押すとリスト表示の「期限なし」に移動します`);
    renderChips();

    const buckets = bucketTasks(tasks);
    if (!days.some((d) => D.toDateStr(d) === selectedDay)) selectedDay = D.toDateStr(days[0]);

    if (media.isMobile()) {
      renderMobile(days, buckets, now);
    } else {
      renderGrid(days, buckets, now);
      renderPanel();
      // パネルの開閉で表の幅が変わるので、描き終わってからスクロールボタンの表示を決める
      updateCues();
      requestAnimationFrame(updateCues);
    }
  }

  function renderChips() {
    const S = App.State;
    const chips = [];
    const add = (label, onRemove) => chips.push(el('span', { class: 'chip' }, label,
      el('button', { type: 'button', 'aria-label': `「${label}」の条件を解除`, onclick: () => { onRemove(); App.render(); } }, '×')));
    if (S.filters.keyword.trim()) add(`検索：${S.filters.keyword.trim()}`, () => { S.filters.keyword = ''; document.querySelectorAll('input[type="search"]').forEach((i) => { i.value = ''; }); });
    if (S.filters.status !== 'all') add(`ステータス：${S.filters.status === 'open' ? '未完了' : '完了'}`, () => { S.filters.status = 'all'; });
    if (S.filters.category !== 'all') add(`カテゴリ：${T.CATEGORY_LABELS[S.filters.category]}`, () => { S.filters.category = 'all'; S.filters.projectId = ''; });
    if (S.filters.projectId) { const p = T.getProject(S.filters.projectId); add(`プロジェクト：${p ? p.name : '不明'}`, () => { S.filters.projectId = ''; }); }
    if (S.filters.due) add(S.filters.due === 'today' ? '期限：今日' : '期限：期限切れ', () => { S.filters.due = ''; });
    clear(refs.chips).append(...chips);
    refs.chips.hidden = !chips.length;
  }

  function dayHeadClasses(date, todayStr) {
    const str = D.toDateStr(date);
    const holiday = App.Holidays.holidayName(date);
    return {
      str,
      holiday,
      cls: [str === todayStr ? 'is-today' : '', date.getDay() === 6 ? 'is-sat' : '', date.getDay() === 0 || holiday ? 'is-sun' : ''].join(' '),
    };
  }

  /* ----- PC：週の表 ----- */

  function renderGrid(days, buckets, now) {
    const keepTop = refs.scroll.scrollTop;
    const keepLeft = refs.scroll.scrollLeft;
    const todayStr = D.toDateStr(now);
    const grid = el('div', { class: 'week-grid', role: 'grid', 'aria-label': '週の予定' });

    grid.append(el('div', { class: 'wg-corner', style: { gridColumn: '1', gridRow: '1' } }));
    days.forEach((d, i) => {
      const info = dayHeadClasses(d, todayStr);
      const b = buckets[info.str];
      const count = b ? [...b.allDay, ...Object.values(b.hours).flat()].filter((t) => !t.completed).length : 0;
      grid.append(el('div', { class: `wg-head ${info.cls}`, role: 'columnheader', style: { gridColumn: String(i + 2), gridRow: '1' } },
        el('span', { class: 'wg-head__date' }, `${d.getMonth() + 1}/${d.getDate()}（${D.WEEKDAYS[d.getDay()]}）`, info.str === todayStr ? el('span', { class: 'today-badge', text: '今日' }) : null),
        el('span', { class: 'wg-head__count', text: `未完了 ${count}件` }),
        info.holiday ? el('span', { class: 'wg-head__holiday', text: info.holiday }) : null));
    });

    // 終日の行
    grid.append(el('div', { class: 'wg-time wg-time--allday', style: { gridColumn: '1', gridRow: '2' }, text: '終日' }));
    days.forEach((d, i) => {
      const info = dayHeadClasses(d, todayStr);
      const list = (buckets[info.str] && buckets[info.str].allDay) || [];
      grid.append(slotCell(info, i, '2', list, now, { date: info.str, time: '' }, 'wg-cell--allday'));
    });

    // 0:00〜23:00 の行
    for (let h = 0; h < 24; h += 1) {
      const row = String(h + 3);
      const timeCell = el('div', { class: 'wg-time', style: { gridColumn: '1', gridRow: row }, text: `${h}:00` });
      grid.append(timeCell);
      days.forEach((d, i) => {
        const info = dayHeadClasses(d, todayStr);
        const list = (buckets[info.str] && buckets[info.str].hours[h]) || [];
        const cell = slotCell(info, i, row, list, now, { date: info.str, time: `${D.pad2(h)}:00` });
        if (info.str === todayStr && now.getHours() === h) {
          const top = `${(now.getMinutes() / 60) * 100}%`;
          cell.append(el('div', { class: 'now-line', style: { top }, 'aria-hidden': 'true' }));
          timeCell.append(el('span', { class: 'now-label', style: { top }, text: `${now.getHours()}:${D.pad2(now.getMinutes())}` }));
        }
        grid.append(cell);
      });
    }

    clear(refs.scroll).append(grid);
    if (needsInitialScroll) {
      needsInitialScroll = false;
      refs.scroll.scrollTop = FIRST_VISIBLE_HOUR * HOUR_HEIGHT;
    } else {
      refs.scroll.scrollTop = keepTop;
      refs.scroll.scrollLeft = keepLeft;
    }
    updateCues();
  }

  /** 1つのマス。1件ならカード、2件以上なら1件目を小さなカード＋「+N件」ボタンにする */
  function slotCell(info, dayIndex, row, list, now, preset, extraClass) {
    const cell = el('div', {
      class: `wg-cell ${info.cls} ${extraClass || ''}`, role: 'gridcell',
      style: { gridColumn: String(dayIndex + 2), gridRow: row },
      dataset: { date: preset.date, time: preset.time },
    });
    if (list.length === 1) {
      cell.append(taskCard(list[0], now, false));
    } else if (list.length > 1) {
      const more = el('button', {
        class: 'wg-more', type: 'button', text: `+${list.length - 1}件`,
        'aria-label': `${D.formatInputDate(preset.date)}${preset.time ? ` ${Number(preset.time.slice(0, 2))}時` : ' 終日'}のタスク ${list.length}件を表示`,
        'aria-haspopup': 'dialog',
      });
      more.addEventListener('click', (e) => { e.stopPropagation(); openPopover(more, list, preset, now); });
      cell.append(el('div', { class: 'wg-stack' }, taskCard(list[0], now, true), more));
    }
    // 空いているところを押すと、その日時が入った状態で登録画面を開く
    cell.addEventListener('click', (e) => {
      if (e.target !== cell) return;
      App.TaskDialogs.openEditor({ mode: 'add', preset: { dueDate: preset.date, dueTime: preset.time, category: 'other', priority: 'medium' } });
    });
    return cell;
  }

  function taskCard(task, now, compact) {
    const overdue = D.isOverdue(task, now);
    const project = task.projectId && T.getProject(task.projectId);
    const time = D.parseTime(task.dueTime);
    const r = D.remaining(task, now);
    const label = `${task.title}、${D.formatDue(task, now)}、優先度 ${T.PRIORITY_LABELS[task.priority]}、${T.CATEGORY_LABELS[task.category]}${task.completed ? '、完了' : ''}${overdue ? '、期限切れ' : ''}`;
    const card = el('button', {
      class: ['wtask', `wtask--${task.priority}`, overdue ? 'wtask--overdue' : '', task.completed ? 'wtask--completed' : '', compact ? 'wtask--compact' : '', App.State.selectedId === task.id ? 'wtask--selected' : ''].join(' '),
      type: 'button', title: `${task.title}${time ? `（${task.dueTime}）` : ''}`, 'aria-label': label,
      onclick: (e) => { e.stopPropagation(); App.selectTask(task.id); },
    },
    el('span', { class: 'wtask__title' },
      overdue ? el('span', { 'aria-hidden': 'true', text: '⚠' }) : task.completed ? el('span', { 'aria-hidden': 'true', text: '✓' }) : null,
      el('span', { class: 'wtask__text', text: task.title }),
      task.priority === 'high' && !compact ? el('span', { class: 'badge badge--high', text: '高' }) : null,
      // 完了済みは「✓」と取り消し線で区別する（列の幅が狭いので「完了」ラベルは付けない。詳細パネルには状態を表示する）
      null));
    if (!compact) {
      const meta = overdue && r
        ? el('span', { class: 'wtask__meta wtask__meta--overdue', text: `期限切れ（${r.text}）` })
        : el('span', { class: 'wtask__meta' },
          [time ? `${time.h}:${D.pad2(time.m)}` : '終日', T.CATEGORY_LABELS[task.category]].join('・'),
          project ? el('span', { class: `project pc-${project.color}`, text: project.name }) : null);
      card.append(meta);
    }
    return card;
  }

  /* 「+N件」の一覧 */
  function openPopover(button, list, preset, now) {
    closePopover();
    popover = el('div', { class: 'wg-popover', role: 'dialog', 'aria-label': 'この時間のタスク' },
      el('h3', { text: `${Number(preset.date.slice(5, 7))}/${Number(preset.date.slice(8))}（${D.WEEKDAYS[D.parseDate(preset.date).getDay()]}）${preset.time ? ` ${Number(preset.time.slice(0, 2))}:00` : ' 終日'}のタスク（${list.length}件）` }),
      el('ul', null, list.map((t) => el('li', null, el('button', {
        class: `wg-popover__item wtask--${t.priority}`, type: 'button',
        onclick: () => { closePopover(); App.selectTask(t.id); },
      }, t.completed ? '✓ ' : D.isOverdue(t, now) ? '⚠ ' : '', el('span', { text: t.title }), t.priority === 'high' ? el('span', { class: 'badge badge--high', text: '高' }) : null)))),
      el('button', { class: 'btn btn--small', type: 'button', text: '閉じる', onclick: () => closePopover(true) }));
    popover.dataset.for = '1';
    document.body.append(popover);
    const rect = button.getBoundingClientRect();
    const width = 260;
    popover.style.left = `${Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)}px`;
    popover.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - popover.offsetHeight - 8)}px`;
    popover._button = button;
    const first = popover.querySelector('button');
    if (first) first.focus();
  }

  function closePopover(returnFocus) {
    if (!popover) return;
    const button = popover._button;
    popover.remove();
    popover = null;
    if (returnFocus && button && document.contains(button)) button.focus();
  }
  document.addEventListener('mousedown', (e) => { if (popover && !popover.contains(e.target)) closePopover(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popover) { e.preventDefault(); closePopover(true); } });
  window.addEventListener('resize', () => closePopover());

  /* スクロール */
  function dayWidth() {
    const head = refs.scroll.querySelector('.wg-head');
    return head ? head.getBoundingClientRect().width : 130;
  }
  function scrollByDay(delta) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    refs.scroll.scrollBy({ left: delta * dayWidth(), behavior: reduce ? 'auto' : 'smooth' });
  }
  function updateCues() {
    const s = refs.scroll;
    refs.cueLeft.hidden = s.scrollLeft <= 2;
    refs.cueRight.hidden = s.scrollLeft + s.clientWidth >= s.scrollWidth - 2;
  }
  function scrollToNow() {
    if (media.isMobile()) return;
    const now = new Date();
    refs.scroll.scrollTop = Math.max(0, (now.getHours() - 1)) * HOUR_HEIGHT;
    const todayHead = refs.scroll.querySelector('.wg-head.is-today');
    if (todayHead) refs.scroll.scrollLeft = Math.max(0, todayHead.offsetLeft - 58);
    updateCues();
  }

  /* ----- PC：詳細パネル ----- */

  function isPanelOpen() {
    return T.getData().settings.detailPanelOpen !== false;
  }
  function setPanelOpen(open) {
    T.updateSettings({ detailPanelOpen: open });
  }

  function renderPanel() {
    const open = isPanelOpen() && media.isWide();
    refs.layout.classList.toggle('has-panel', open);
    refs.panelToggle.hidden = open || !media.isWide();
    clear(refs.panel);
    if (!open) return;
    const task = App.State.selectedId && T.getTask(App.State.selectedId);
    if (task) {
      refs.panel.append(Dialogs.buildDetail(task, { onClose: () => setPanelOpen(false), closeStyle: 'arrow', onDeleted: () => App.selectTask(null) }));
    } else {
      refs.panel.append(el('div', { class: 'detail' },
        el('div', { class: 'detail-head' }, el('span', { class: 'detail-head__label', text: 'タスクの詳細' }),
          el('button', { class: 'btn btn--icon detail-close', type: 'button', 'aria-label': '詳細パネルを閉じる', onclick: () => setPanelOpen(false) }, '›')),
        el('div', { class: 'empty' }, icon('doc'), el('strong', { text: 'タスクを選ぶと詳細が表示されます' }), el('span', { text: '表のタスクを押してください' }))));
    }
  }

  /* ----- スマホ ----- */

  function renderMobile(days, buckets, now) {
    const todayStr = D.toDateStr(now);
    const strip = el('div', { class: 'mweek-strip' },
      el('button', { class: 'mweek-arrow', type: 'button', 'aria-label': '前の週', text: '‹', onclick: () => moveWeek(-1) }),
      days.map((d) => {
        const info = dayHeadClasses(d, todayStr);
        const b = buckets[info.str];
        const count = b ? [...b.allDay, ...Object.values(b.hours).flat()].filter((t) => !t.completed).length : 0;
        return el('button', {
          class: `mdate ${info.cls} ${info.str === selectedDay ? 'is-selected' : ''}`, type: 'button',
          'aria-pressed': info.str === selectedDay ? 'true' : 'false',
          'aria-label': `${D.formatFullDate(d)}${info.holiday ? ` ${info.holiday}` : ''}、未完了${count}件`,
          onclick: () => { selectedDay = info.str; mobileScrollPending = true; render(); },
        }, el('span', { class: 'mdate__w', text: D.WEEKDAYS[d.getDay()] }), el('span', { class: 'mdate__d', text: String(d.getDate()) }),
        info.str === todayStr ? el('span', { class: 'today-badge', text: '今日' }) : null,
        el('span', { class: 'mdate__c', text: `${count}件` }));
      }),
      el('button', { class: 'mweek-arrow', type: 'button', 'aria-label': '次の週', text: '›', onclick: () => moveWeek(1) }));

    const date = D.parseDate(selectedDay);
    const info = dayHeadClasses(date, todayStr);
    const b = buckets[selectedDay] || { allDay: [], hours: {} };
    const count = [...b.allDay, ...Object.values(b.hours).flat()].filter((t) => !t.completed).length;
    const next = D.addDays(date, 1);

    const title = el('div', { class: `mweek-title ${info.cls}` },
      el('span', { text: `${date.getMonth() + 1}月${date.getDate()}日（${D.WEEKDAYS[date.getDay()]}）` }),
      info.str === todayStr ? el('span', { class: 'today-badge', text: '今日' }) : null,
      info.holiday ? el('span', { class: 'wg-head__holiday', text: info.holiday }) : null,
      el('span', { class: 'mweek-title__count', text: `未完了 ${count}件` }));

    const timeline = el('div', { class: 'mtimeline' });
    const addRow = (label, list, preset) => {
      const slot = el('div', { class: 'mt-slot', dataset: preset });
      list.forEach((t) => slot.append(taskCard(t, now, false)));
      slot.addEventListener('click', (e) => {
        if (e.target !== slot) return;
        App.TaskDialogs.openEditor({ mode: 'add', preset: { dueDate: preset.date, dueTime: preset.time, category: 'other', priority: 'medium' } });
      });
      timeline.append(el('div', { class: 'mt-time', text: label }), slot);
      return slot;
    };
    addRow('終日', b.allDay, { date: selectedDay, time: '' });
    for (let h = 0; h < 24; h += 1) {
      const slot = addRow(`${h}:00`, b.hours[h] || [], { date: selectedDay, time: `${D.pad2(h)}:00` });
      if (info.str === todayStr && now.getHours() === h) {
        slot.append(el('div', { class: 'now-line', style: { top: `${(now.getMinutes() / 60) * 100}%` }, 'aria-hidden': 'true' },
          el('span', { class: 'now-line__label', text: `${now.getHours()}:${D.pad2(now.getMinutes())}` })));
      }
    }
    const peek = el('button', {
      class: `mweek-peek ${dayHeadClasses(next, todayStr).cls}`, type: 'button', 'aria-label': `次の日（${D.formatFullDate(next)}）を表示`,
      onclick: () => changeDay(1),
    }, `${next.getMonth() + 1}/${next.getDate()}（${D.WEEKDAYS[next.getDay()]}）`);

    const body = el('div', { class: 'mweek-body' }, timeline, peek);
    addSwipe(body);

    const keep = window.scrollY;
    clear(refs.mobile).append(el('div', { class: 'mweek-sticky' }, strip, title), body);
    if (mobileScrollPending) {
      mobileScrollPending = false;
      requestAnimationFrame(() => {
        const target = info.str === todayStr ? Math.max(0, now.getHours() - 1) : FIRST_VISIBLE_HOUR;
        const slot = timeline.querySelectorAll('.mt-slot')[target + 1];
        if (slot) window.scrollTo(0, slot.getBoundingClientRect().top + window.scrollY - 200);
      });
    } else {
      window.scrollTo(0, keep);
    }
  }

  function changeDay(delta) {
    const next = D.addDays(D.parseDate(selectedDay), delta);
    const days = weekDays().map(D.toDateStr);
    selectedDay = D.toDateStr(next);
    if (!days.includes(selectedDay)) {
      // 週の外に出たら、1週間分ずらす（「前の日」「次の日」でずらしていた場合も同じ幅で動く）
      if (customStart) customStart = D.addDays(customStart, delta > 0 ? 7 : -7);
      anchor = next;
    }
    mobileScrollPending = true;
    render();
  }

  /** 左右のスワイプで前日・翌日に移動する */
  function addSwipe(node) {
    let startX = 0;
    let startY = 0;
    node.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }, { passive: true });
    node.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) changeDay(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /** 「期限なし：○件」→ リスト表示の「期限なし」の見出しへ移動 */
  function showNoDateTasks() {
    App.State.sort = 'due';
    App.showView('list');
    requestAnimationFrame(() => {
      const group = document.querySelector('#view-list .group--nodate');
      if (group) { group.scrollIntoView({ block: 'start' }); group.querySelector('.task-open')?.focus({ preventScroll: true }); }
      else toast('表示の条件に合う期限なしのタスクはありません');
    });
  }

  /** スマホの「＋ タスクを追加」：選んでいる日付を入れておく */
  function presetForAdd() {
    return { dueDate: selectedDay, category: 'other', priority: 'medium' };
  }

  App.WeekView = { mount, render, isPanelOpen, presetForAdd };
})(window.TodoApp = window.TodoApp || {});
