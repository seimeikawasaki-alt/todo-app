/**
 * リスト表示（ホーム画面）
 * サマリーカード → 登録フォーム（PC）→ 絞り込みと並び替え → タスク一覧（期限ごとの見出し・完了済み）→ 詳細パネル
 */
(function (App) {
  'use strict';

  const { el, icon, clear, toast, media } = App.UI;
  const T = App.Tasks;
  const D = App.DateUtils;
  const Dialogs = App.TaskDialogs;

  let root = null;
  let quickForm = null;
  let refs = {};

  /* ========== 画面の骨組み（最初に1回だけ作る） ========== */

  function mount(container) {
    root = container;
    const S = App.State;

    // 登録フォーム（PC）
    quickForm = App.TaskForm.createTaskFields({
      weekStart: () => T.getData().settings.weekStart,
    });
    const f = quickForm.fields;
    const quickAdd = el('form', { class: 'card quick-add', 'aria-label': 'タスクを追加', novalidate: true, onsubmit: (e) => { e.preventDefault(); submitQuickAdd(); } },
      el('div', { class: 'quick-add__row' }, f.titleField, f.dateField, f.categoryField, f.priorityField,
        el('button', { class: 'btn btn--primary quick-add__submit', type: 'submit' }, icon('plus'), '追加')),
      // 「詳細」は要件の登録項目なので、最初から開いた状態で表示する（見出しを押すと閉じられる）
      el('details', { class: 'quick-add__details', open: true },
        el('summary', { text: '詳細・時刻・プロジェクトを入力（任意）' }),
        el('div', { class: 'quick-add__more' }, f.detailField, f.timeField, f.projectField)));

    // 絞り込み・並び替え
    const statusSelect = filterSelect('ステータス', 'status', [['all', 'すべて'], ['open', '未完了'], ['done', '完了']]);
    const categorySelect = filterSelect('カテゴリ', 'category', [['all', 'すべて'], ...Object.entries(T.CATEGORY_LABELS)]);
    const projectWrap = el('div', { class: 'field filter-project' });
    const sortSelect = filterSelect('並び替え', 'sort', [['created', '登録順（新しい順）'], ['due', '期限順'], ['priority', '優先度順']]);
    const filters = el('section', { class: 'card filters', 'aria-label': '絞り込みと並び替え' },
      statusSelect.field, categorySelect.field, projectWrap, sortSelect.field,
      el('button', { class: 'btn btn--small filters__clear', type: 'button', text: '条件をクリア', onclick: clearFilters }));

    refs = {
      summary: el('section', { class: 'summary', 'aria-label': 'タスクの件数' }),
      chips: el('div', { class: 'chips', 'aria-live': 'polite' }),
      list: el('section', { class: 'card task-list', 'aria-label': 'タスク一覧' }),
      panel: el('aside', { class: 'card detail-panel', 'aria-label': 'タスクの詳細' }),
      workspace: null,
      statusSelect: statusSelect.select,
      categorySelect: categorySelect.select,
      sortSelect: sortSelect.select,
      projectWrap,
    };
    refs.workspace = el('div', { class: 'workspace' }, refs.list, refs.panel);

    root.append(
      el('div', { class: 'page-head' },
        el('h1', { class: 'page-title' }, 'リスト', el('small', { class: 'page-date' })),
        searchBox('search-pc')),
      refs.summary,
      quickAdd,
      filters,
      refs.chips,
      refs.workspace,
    );

    function filterSelect(label, key, options) {
      const id = `filter-${key}`;
      const selectEl = el('select', { class: 'control', id }, options.map(([v, text]) => el('option', { value: v, text })));
      selectEl.value = key === 'sort' ? S.sort : S.filters[key];
      selectEl.addEventListener('change', () => {
        if (key === 'sort') S.sort = selectEl.value;
        else {
          S.filters[key] = selectEl.value;
          if (key === 'category' && selectEl.value !== 'work') S.filters.projectId = '';
        }
        App.render();
      });
      return { select: selectEl, field: el('div', { class: 'field' }, el('label', { class: 'field__label', for: id, text: label }), selectEl) };
    }
  }

  /** 検索欄（PCの上部・スマホの上部で共通の値を使う） */
  function searchBox(id) {
    const input = el('input', { type: 'search', id, placeholder: 'タスクを検索', 'aria-label': 'タスクを検索（タスク名と詳細）', autocomplete: 'off' });
    input.value = App.State.filters.keyword;
    input.addEventListener('input', () => {
      App.State.filters.keyword = input.value;
      document.querySelectorAll('input[type="search"]').forEach((other) => { if (other !== input) other.value = input.value; });
      App.render();
    });
    return el('label', { class: 'search' }, icon('search'), input);
  }

  function submitQuickAdd() {
    const values = quickForm.getValues();
    const errors = T.validateTask(values);
    quickForm.showErrors(errors);
    if (Object.keys(errors).length) return;
    T.addTask(values);
    quickForm.resetAfterAdd();
    toast('タスクを追加しました');
  }

  function clearFilters() {
    const S = App.State;
    S.filters = { status: 'all', category: 'all', projectId: '', due: '', keyword: '' };
    document.querySelectorAll('input[type="search"]').forEach((i) => { i.value = ''; });
    App.render();
  }

  /* ========== 描画（データや条件が変わるたびに呼ばれる） ========== */

  function render() {
    const S = App.State;
    const data = T.getData();
    const now = new Date();

    root.querySelector('.page-date').textContent = D.formatFullDate(now);
    refs.statusSelect.value = S.filters.status;
    refs.categorySelect.value = S.filters.category;
    refs.sortSelect.value = S.sort;
    quickForm.refreshProjects();

    renderSummary(data.tasks, now);
    renderProjectFilter();
    renderChips();
    renderList(data, now);
    renderPanel();
  }

  function renderSummary(tasks, now) {
    const S = App.State;
    const s = T.summary(tasks, now);
    const cards = [
      { key: 'open', label: '未完了', value: s.open, iconName: 'circle', active: S.filters.status === 'open' && !S.filters.due, apply: () => { S.filters.status = 'open'; S.filters.due = ''; } },
      { key: 'today', label: '今日', value: s.today, iconName: 'calendar', cls: 'summary-card--today', active: S.filters.due === 'today', apply: () => { S.filters.status = 'open'; S.filters.due = 'today'; S.sort = 'due'; } },
      { key: 'overdue', label: '期限切れ', value: s.overdue, iconName: 'alert', cls: s.overdue ? 'summary-card--overdue' : '', active: S.filters.due === 'overdue', apply: () => { S.filters.status = 'open'; S.filters.due = 'overdue'; S.sort = 'due'; } },
      { key: 'done', label: '完了', value: s.done, iconName: 'check', cls: 'summary-card--done', active: S.filters.status === 'done', apply: () => { S.filters.status = 'done'; S.filters.due = ''; } },
    ];
    clear(refs.summary).append(...cards.map((c) => el('button', {
      class: `summary-card ${c.cls || ''} ${c.active ? 'is-active' : ''}`, type: 'button', 'aria-pressed': c.active ? 'true' : 'false',
      'aria-label': `${c.label} ${c.value}件。押すと${c.label}のタスクだけを表示します`,
      onclick: () => { c.apply(); App.render(); },
    }, el('span', { class: 'summary-card__icon' }, icon(c.iconName)),
    el('span', null, el('span', { class: 'summary-card__label', text: c.label }), el('span', { class: 'summary-card__value' }, String(c.value), el('small', { text: '件' }))))));
  }

  /** カテゴリが「仕事」のときだけ、プロジェクトの絞り込み欄を表示する */
  function renderProjectFilter() {
    const S = App.State;
    clear(refs.projectWrap);
    const projects = T.getData().projects;
    if (S.filters.category !== 'work' || !projects.length) { refs.projectWrap.hidden = true; return; }
    refs.projectWrap.hidden = false;
    const select = el('select', { class: 'control', id: 'filter-project' },
      el('option', { value: '', text: 'すべて' }),
      projects.map((p) => el('option', { value: p.id, text: `${p.name}${p.archived ? '（アーカイブ済み）' : ''}` })));
    select.value = S.filters.projectId;
    select.addEventListener('change', () => { S.filters.projectId = select.value; App.render(); });
    refs.projectWrap.append(el('label', { class: 'field__label', for: 'filter-project', text: 'プロジェクト' }), select);
  }

  /** 使っている条件を「検索：資料 ×」のように表示する */
  function renderChips() {
    const S = App.State;
    const chips = [];
    const add = (label, onRemove) => chips.push(el('span', { class: 'chip' }, label,
      el('button', { type: 'button', 'aria-label': `「${label}」の条件を解除`, onclick: () => { onRemove(); App.render(); } }, '×')));
    if (S.filters.keyword.trim()) add(`検索：${S.filters.keyword.trim()}`, () => { S.filters.keyword = ''; document.querySelectorAll('input[type="search"]').forEach((i) => { i.value = ''; }); });
    if (S.filters.due === 'today') add('期限：今日', () => { S.filters.due = ''; });
    if (S.filters.due === 'overdue') add('期限：期限切れ', () => { S.filters.due = ''; });
    if (S.filters.status !== 'all') add(`ステータス：${S.filters.status === 'open' ? '未完了' : '完了'}`, () => { S.filters.status = 'all'; });
    if (S.filters.category !== 'all') add(`カテゴリ：${T.CATEGORY_LABELS[S.filters.category]}`, () => { S.filters.category = 'all'; S.filters.projectId = ''; });
    if (S.filters.projectId) {
      const p = T.getProject(S.filters.projectId);
      add(`プロジェクト：${p ? p.name : '不明'}`, () => { S.filters.projectId = ''; });
    }
    clear(refs.chips).append(...chips);
    refs.chips.hidden = !chips.length;
  }

  function renderList(data, now) {
    const S = App.State;
    const list = refs.list;
    clear(list);

    if (!data.tasks.length) {
      list.append(emptyState('inbox', 'タスクはまだありません', media.isMobile() ? '右下の「＋ タスクを追加」から、最初のタスクを追加しましょう' : '上のフォームから、最初のタスクを追加しましょう'));
      return;
    }

    const filtered = T.filterTasks(data.tasks, S.filters, now);
    if (!filtered.length) {
      const kw = S.filters.keyword.trim();
      list.append(emptyState('search', kw ? `「${kw}」に一致するタスクはありません` : '条件に一致するタスクはありません', '別のキーワードで検索するか、条件をクリアしてください',
        el('button', { class: 'btn btn--small', type: 'button', text: '条件をクリア', onclick: clearFilters })));
      return;
    }

    const weekStart = data.settings.weekStart;
    // ステータスが「すべて」のときは、完了済みを一覧の下にまとめる（その中も選んだ順番で並ぶ）
    const separateDone = S.filters.status === 'all';
    const openTasks = separateDone ? filtered.filter((t) => !t.completed) : filtered;
    const doneTasks = separateDone ? filtered.filter((t) => t.completed) : [];

    const groups = T.groupTasks(T.sortTasks(openTasks, S.sort), S.sort, now, weekStart);
    groups.forEach((g) => {
      const section = el('section', { class: `group group--${g.key}` });
      if (g.label) {
        section.append(el('h2', { class: 'group-head' }, g.key === 'overdue' ? '⚠ ' : '', g.label, el('span', { class: 'count', text: ` (${g.tasks.length})` })));
      }
      g.tasks.forEach((t) => section.append(taskRow(t, now)));
      list.append(section);
    });

    if (doneTasks.length) {
      const details = el('details', { class: 'group group--done', open: data.settings.completedOpen },
        el('summary', { class: 'group-head' }, '完了済み', el('span', { class: 'count', text: ` (${doneTasks.length})` })),
        T.sortTasks(doneTasks, S.sort).map((t) => taskRow(t, now)));
      details.addEventListener('toggle', () => {
        if (details.open !== data.settings.completedOpen) T.updateSettings({ completedOpen: details.open });
      });
      list.append(details);
    }
  }

  function emptyState(iconName, title, text, action) {
    return el('div', { class: 'empty' }, icon(iconName), el('strong', { text: title }), el('span', { text }), action || null);
  }

  /** タスク1行 */
  function taskRow(task, now) {
    const S = App.State;
    const overdue = D.isOverdue(task, now);
    const selected = S.selectedId === task.id;
    const row = el('article', {
      class: ['task-row', `task-row--${task.priority}`, overdue ? 'task-row--overdue' : '', task.completed ? 'task-row--completed' : '', selected ? 'task-row--selected' : ''].join(' '),
      dataset: { id: task.id },
    });

    // 左端の丸：今の状態（未完了／完了）を示す表示だけ。押しても切り替わらない（押し間違いを防ぐため）
    // 切り替えは「✓ 完了にする」「↺ 未完了に戻す」のボタンで行う
    const status = el('span', { class: `status-mark ${task.completed ? 'is-done' : ''}` },
      el('span', { class: 'status-mark__circle', 'aria-hidden': 'true' }),
      el('span', { class: 'status-mark__label', text: task.completed ? '完了' : '未完了' }));

    const open = el('button', {
      class: 'task-open', type: 'button', 'aria-label': `「${task.title}」の詳細を開く`,
      onclick: () => App.selectTask(task.id),
    }, el('span', { class: 'task-title-text', text: task.title }));

    const detailLines = task.detail ? task.detail.split('\n') : [];
    const detailText = detailLines[0] || '';
    const isLong = detailLines.length > 1 || detailText.length > 40;
    const detail = task.detail ? el('p', { class: 'task-detail' },
      el('span', { class: 'task-detail__text', text: detailText }),
      isLong ? el('button', { class: 'more-link', type: 'button', text: 'もっと見る', onclick: () => App.selectTask(task.id) }) : null) : null;

    const dueDateEl = el('span', { class: 'due__date' }, icon('calendar'), D.formatDue(task, now));
    const labels = el('div', { class: 'labels' },
      el('span', { class: 'badge badge--category', text: T.CATEGORY_LABELS[task.category] }),
      Dialogs.priorityBadge(task.priority),
      task.category === 'work' ? Dialogs.projectLabel(task.projectId) : null);

    row.append(
      status,
      el('div', { class: 'task-main' }, el('h3', { class: 'task-title' }, open), detail),
      el('div', { class: 'task-meta' },
        el('div', { class: 'due' }, dueDateEl, Dialogs.remainingLabel(task, now)),
        labels),
      el('div', { class: 'task-actions' },
        Dialogs.toggleButton(task, { small: true }),
        el('button', { class: 'btn btn--small btn--soft', type: 'button', 'aria-label': `「${task.title}」を編集`, text: '編集', onclick: () => Dialogs.openEditor({ mode: 'edit', task }) }),
        el('button', { class: 'btn btn--small btn--danger-outline', type: 'button', 'aria-label': `「${task.title}」を削除`, text: '削除', onclick: () => Dialogs.confirmDelete(task) })),
      el('button', { class: 'row-chevron', type: 'button', 'aria-label': `「${task.title}」の詳細を開く`, onclick: () => App.selectTask(task.id) }, '›'),
    );
    return row;
  }

  /** PC（1280px以上）では、選んだタスクの詳細を右側のパネルに表示する */
  function renderPanel() {
    const S = App.State;
    const task = S.selectedId && T.getTask(S.selectedId);
    const show = !!task && media.isWide() && S.view === 'list';
    refs.workspace.classList.toggle('has-panel', show);
    clear(refs.panel);
    if (show) {
      refs.panel.append(Dialogs.buildDetail(task, { onClose: () => App.selectTask(null), closeStyle: 'arrow', onDeleted: () => App.selectTask(null) }));
    }
  }

  App.ListView = { mount, render, searchBox };
})(window.TodoApp = window.TodoApp || {});
