/**
 * アプリ全体の起動と、画面の切り替え
 * - App.State：表示中の画面・絞り込みの条件・選んでいるタスク（保存しない一時的な状態）
 * - App.render()：いま表示している画面を描き直す
 * - App.selectTask()：タスクの詳細を開く（PCは右側のパネル、それ以外はモーダル）
 */
(function (App) {
  'use strict';

  const { el, icon, clear, openModal, toast, media } = App.UI;
  const T = App.Tasks;

  const VIEWS = [
    { key: 'list', label: 'リスト', icon: 'list', module: () => App.ListView },
    { key: 'week', label: '週表示', icon: 'calendar', module: () => App.WeekView },
    { key: 'dashboard', label: '集計', icon: 'chart', module: () => App.DashboardView },
    { key: 'projects', label: 'プロジェクト', icon: 'folder', module: () => App.ProjectsView },
  ].filter((v) => v.module()); // まだ作っていない画面はメニューに出さない

  App.State = {
    view: 'list',
    filters: { status: 'all', category: 'all', projectId: '', due: '', keyword: '' },
    sort: 'due',
    selectedId: null,
  };

  const mounted = {};
  let detailModal = null;

  /* ========== 描画 ========== */

  function render() {
    const S = App.State;
    document.body.dataset.view = S.view;
    document.querySelectorAll('[data-view-link]').forEach((a) => {
      if (a.dataset.viewLink === S.view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    VIEWS.forEach((v) => {
      const section = document.getElementById(`view-${v.key}`);
      section.hidden = v.key !== S.view;
    });
    const view = VIEWS.find((v) => v.key === S.view);
    const section = document.getElementById(`view-${S.view}`);
    if (!mounted[S.view]) { view.module().mount(section); mounted[S.view] = true; }
    view.module().render();
    document.getElementById('fab').hidden = !(S.view === 'list' || S.view === 'week');
    if (detailModal) detailModal.redraw();
  }

  function showView(key, options) {
    const S = App.State;
    if (!VIEWS.some((v) => v.key === key)) key = 'list';
    if (S.view !== key && detailModal) detailModal.close();
    S.view = key;
    if (options && options.filters) {
      S.filters = { ...S.filters, ...options.filters };
      document.querySelectorAll('input[type="search"]').forEach((i) => { i.value = S.filters.keyword; });
    }
    // URLの「#」以降も合わせて変える（読み込み直したときに、同じ画面を開くため）
    try { window.history.replaceState(null, '', `#${key}`); } catch (e) { /* file:// で使えない環境でも動くようにする */ }
    if (T.getData().settings.lastView !== key) T.updateSettings({ lastView: key });
    else render();
    window.scrollTo(0, 0);
    const heading = document.querySelector(`#view-${key} h1`);
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  }

  /** タスクの詳細を開く（id が null なら閉じる） */
  function selectTask(id) {
    const S = App.State;
    S.selectedId = id;
    if (!id) { if (detailModal) detailModal.close(); render(); return; }
    // 1280px以上のリスト表示・週表示では、右側のパネルに表示する（週表示でパネルを閉じていたら開き直す）
    if (media.isWide() && (S.view === 'list' || S.view === 'week')) {
      if (S.view === 'week' && !App.WeekView.isPanelOpen()) T.updateSettings({ detailPanelOpen: true });
      else render();
      return;
    }
    render();
    if (detailModal) detailModal.close();
    detailModal = App.TaskDialogs.openDetailModal(id, () => {
      detailModal = null;
      if (App.State.selectedId === id) { App.State.selectedId = null; render(); }
    });
  }

  /* ========== スマホの絞り込み画面 ========== */

  function openMobileFilters() {
    const S = App.State;
    const titleId = 'mobile-filter-title';
    let modal = null;
    const make = (label, id, options, value) => {
      const select = el('select', { class: 'control', id }, options.map(([v, text]) => el('option', { value: v, text })));
      select.value = value;
      return { select, field: el('div', { class: 'field' }, el('label', { class: 'field__label', for: id, text: label }), select) };
    };
    const status = make('ステータス', 'm-status', [['all', 'すべて'], ['open', '未完了'], ['done', '完了']], S.filters.status);
    const category = make('カテゴリ', 'm-category', [['all', 'すべて'], ...Object.entries(T.CATEGORY_LABELS)], S.filters.category);
    const projects = T.getData().projects;
    const project = make('プロジェクト（カテゴリが「仕事」のとき）', 'm-project', [['', 'すべて'], ...projects.map((p) => [p.id, p.name])], S.filters.projectId);
    const sort = make('並び替え', 'm-sort', [['created', '登録順（新しい順）'], ['due', '期限順'], ['priority', '優先度順']], S.sort);
    const syncProject = () => { project.select.disabled = category.select.value !== 'work'; if (project.select.disabled) project.select.value = ''; };
    category.select.addEventListener('change', syncProject);
    syncProject();

    const content = el('div', null,
      el('div', { class: 'dialog-title' }, el('h2', { id: titleId, text: '絞り込みと並び替え' }),
        el('button', { class: 'btn btn--icon', type: 'button', 'aria-label': '閉じる', onclick: () => modal.close() }, '×')),
      el('div', { class: 'editor__body' }, status.field, category.field, projects.length ? project.field : null, S.view === 'list' ? sort.field : null),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', text: '条件をクリア', onclick: () => {
          S.filters = { status: 'all', category: 'all', projectId: '', due: '', keyword: S.filters.keyword };
          modal.close(); render();
        } }),
        el('button', { class: 'btn btn--primary', type: 'button', text: '表示する', onclick: () => {
          S.filters.status = status.select.value;
          S.filters.category = category.select.value;
          S.filters.projectId = category.select.value === 'work' ? project.select.value : '';
          S.sort = sort.select.value;
          modal.close(); render();
        } })));
    modal = openModal({ content, labelledBy: titleId, className: 'modal--editor' });
  }

  /* ========== 起動 ========== */

  function buildShell() {
    const nav = document.getElementById('nav-list');
    const tabs = document.getElementById('mobile-tabs');
    VIEWS.forEach((v) => {
      nav.append(el('a', { class: 'nav-item', href: `#${v.key}`, dataset: { viewLink: v.key }, onclick: (e) => { e.preventDefault(); showView(v.key); } }, icon(v.icon), v.label));
      tabs.append(el('a', { class: 'mobile-tab', href: `#${v.key}`, dataset: { viewLink: v.key }, onclick: (e) => { e.preventDefault(); showView(v.key); } }, icon(v.icon), v.label));
    });

    const mobileToolbar = document.getElementById('mobile-toolbar');
    mobileToolbar.append(
      App.ListView.searchBox('search-mobile'),
      el('button', { class: 'btn mobile-filter', type: 'button', onclick: openMobileFilters }, icon('filter'), '絞り込み'));

    document.getElementById('fab').addEventListener('click', () => {
      const preset = App.State.view === 'week' && App.WeekView ? App.WeekView.presetForAdd() : undefined;
      App.TaskDialogs.openEditor({ mode: 'add', preset });
    });
  }

  function start() {
    const { data, error } = App.Storage.load();
    T.init(data);
    T.subscribe(() => {
      if (T.isSaveFailed()) toast('保存できませんでした。ブラウザの保存領域がいっぱいか、保存が許可されていない可能性があります。', 'error');
      const S = App.State;
      if (S.selectedId && !T.getTask(S.selectedId)) S.selectedId = null;
      render();
    });

    buildShell();
    const hash = window.location.hash.replace('#', '');
    App.State.view = VIEWS.some((v) => v.key === hash) ? hash : (VIEWS.some((v) => v.key === data.settings.lastView) ? data.settings.lastView : 'list');
    render();
    if (error) toast(error, 'error');

    // 残り時間・現在時刻の線などを、1分ごとに更新する（入力中のモーダルがあるときは描き直さない）
    setInterval(() => { if (!document.body.classList.contains('has-modal')) render(); }, 60 * 1000);

    // 画面幅が区切り（1280px・700px）をまたいだら描き直す
    // （詳細の表示方法：パネル／モーダル、週表示：PC用の表／スマホ用のタイムライン が変わるため）
    // resize イベントではなく matchMedia を使う（スマホの回転などでも確実に検知できる）
    // どちらの合図でも反応するようにし、前回の状態と比べて、区切りをまたいだときだけ描き直す
    let lastLayout = `${media.isWide()}-${media.isMobile()}`;
    const onBreakpoint = () => {
      const layout = `${media.isWide()}-${media.isMobile()}`;
      if (layout === lastLayout) return;
      lastLayout = layout;
      const id = App.State.selectedId;
      if (detailModal) detailModal.close();
      if (id) selectTask(id); else render();
    };
    ['(min-width: 1280px)', '(max-width: 700px)'].forEach((query) => {
      const mq = window.matchMedia(query);
      if (mq.addEventListener) mq.addEventListener('change', onBreakpoint);
      else if (mq.addListener) mq.addListener(onBreakpoint); // 古いSafari向け
    });
    window.addEventListener('resize', onBreakpoint);
  }

  App.render = render;
  App.openFilterDialog = openMobileFilters;
  App.showView = showView;
  App.selectTask = selectTask;

  document.addEventListener('DOMContentLoaded', start);
})(window.TodoApp = window.TodoApp || {});
