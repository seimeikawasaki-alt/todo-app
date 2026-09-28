/**
 * 集計画面
 * 全体の数値 → プロジェクトの進み具合と改善のヒント → 期限内に完了できた割合・完了数の推移・未完了の内訳
 * すべて保存しているタスクから計算する（グラフはCSSだけで描く）
 */
(function (App) {
  'use strict';

  const { el, icon, clear } = App.UI;
  const T = App.Tasks;
  const D = App.DateUtils;

  let root = null;

  function mount(container) {
    root = container;
  }

  /* ========== 計算 ========== */

  /** 期限を設定して完了したタスクのうち、期限までに完了できた割合（該当がなければ null） */
  function onTimeRate(tasks) {
    const target = tasks.filter((t) => t.completed && t.dueDate && t.completedAt);
    if (!target.length) return null;
    const onTime = target.filter((t) => t.completedAt <= D.dueDateTime(t).getTime()).length;
    return { rate: Math.round((onTime / target.length) * 100), count: target.length };
  }

  function projectStats(project, tasks, now) {
    const list = tasks.filter((t) => t.projectId === project.id);
    const done = list.filter((t) => t.completed).length;
    const open = list.filter((t) => !t.completed);
    return {
      project,
      total: list.length,
      done,
      open: open.length,
      rate: list.length ? Math.round((done / list.length) * 100) : 0,
      overdue: open.filter((t) => D.isOverdue(t, now)).length,
      highOpen: open.filter((t) => t.priority === 'high').length,
      onTime: onTimeRate(list),
    };
  }

  /** 直近8週間（月曜始まり）の完了数 */
  function weeklyCompleted(tasks, now) {
    const thisMonday = D.weekStartOf(now, 'mon', now);
    return Array.from({ length: 8 }, (_, i) => {
      const start = D.addDays(thisMonday, (i - 7) * 7);
      const end = D.addDays(start, 7);
      const count = tasks.filter((t) => t.completedAt && t.completedAt >= start.getTime() && t.completedAt < end.getTime()).length;
      return { start, count, isThisWeek: i === 7 };
    });
  }

  function buildHints(stats, tasks, overall, now) {
    const hints = [];
    const open = tasks.filter((t) => !t.completed);
    const overdueAll = open.filter((t) => D.isOverdue(t, now));

    stats.filter((s) => s.overdue > 0).slice(0, 2).forEach((s) => hints.push({
      type: 'overdue', title: `${s.project.name}は期限切れが${s.overdue}件あります`,
      text: 'スケジュールの見直しや、タスクの分割を検討しましょう。', projectId: s.project.id,
    }));
    const inProjects = stats.reduce((n, s) => n + s.overdue, 0);
    if (overdueAll.length > inProjects) {
      hints.push({ type: 'overdue', title: `プロジェクト以外にも期限切れが${overdueAll.length - inProjects}件あります`, text: 'リストの「期限切れ」から確認しましょう。', due: 'overdue' });
    }

    const highOpen = open.filter((t) => t.priority === 'high');
    if (highOpen.length) {
      const highOverdue = highOpen.filter((t) => D.isOverdue(t, now)).length;
      hints.push({ type: 'priority', title: `優先度「高」の未完了が${highOpen.length}件あります${highOverdue ? `（うち期限切れ${highOverdue}件）` : ''}`, text: '重要なタスクから優先して進めましょう。' });
    }

    if (overall) {
      stats.filter((s) => s.onTime && s.onTime.count >= 3 && s.onTime.rate < overall.rate - 10).slice(0, 1).forEach((s) => hints.push({
        type: 'rate', title: `${s.project.name}の期限内完了率（${s.onTime.rate}%）が全体（${overall.rate}%）より低めです`, text: '期限の見積もりを見直しましょう。',
      }));
    }

    if (!hints.length) hints.push({ type: 'good', title: '期限切れのタスクはありません', text: 'この調子で進めましょう。' });
    return hints;
  }

  /* ========== 描画 ========== */

  function render() {
    const now = new Date();
    const data = T.getData();
    const tasks = data.tasks;
    clear(root);
    root.append(el('h1', { class: 'page-title dash-title' }, '集計', el('small', { text: `${D.formatFullDate(now)}時点` })));

    if (!tasks.length) {
      root.append(el('div', { class: 'card empty' }, icon('chart'), el('strong', { text: 'まだ集計できるタスクがありません' }),
        el('span', { text: 'リスト画面からタスクを追加すると、進み具合や改善のヒントが表示されます' }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'リストへ移動', onclick: () => App.showView('list') })));
      return;
    }

    const open = tasks.filter((t) => !t.completed);
    const done = tasks.length - open.length;
    const overdue = open.filter((t) => D.isOverdue(t, now)).length;
    const weekEnd = T.weekEnd(now, data.settings.weekStart);
    const dueThisWeek = open.filter((t) => {
      const d = D.parseDate(t.dueDate);
      return d && !D.isOverdue(t, now) && d <= weekEnd;
    }).length;
    const rate = Math.round((done / tasks.length) * 100);

    const stats = T.activeProjects().map((p) => projectStats(p, tasks, now))
      .sort((a, b) => b.overdue - a.overdue || a.project.createdAt - b.project.createdAt);
    const overall = onTimeRate(tasks);

    // 全体の数値
    root.append(el('section', { class: 'kpis', 'aria-label': '全体の数値' },
      kpi('doc', '全タスク', tasks.length, '件'),
      el('div', { class: 'card kpi' },
        el('span', { class: 'ring', role: 'img', 'aria-label': `完了率${rate}%`, style: { '--p': `${rate}%` } }, el('span', { text: `${rate}%` })),
        el('span', null, el('span', { class: 'kpi__label', text: '完了率' }), el('span', { class: 'kpi__value' }, String(rate), el('small', { text: '%' })), el('span', { class: 'kpi__sub', text: `完了 ${done}件` }))),
      kpi('alert', '期限切れ', overdue, '件', overdue ? 'kpi--overdue' : ''),
      kpi('calendar', '今週期限', dueThisWeek, '件', 'kpi--week', `${weekEnd.getMonth() + 1}/${weekEnd.getDate()}までの未完了`)));

    // プロジェクト＋改善のヒント
    const projectsCard = el('section', { class: 'card dash-projects', 'aria-labelledby': 'dash-projects-title' },
      el('div', { class: 'card-head' }, el('h2', { class: 'card-title', id: 'dash-projects-title', text: 'プロジェクトの進み具合' }), el('p', { class: 'card-note', text: '期限切れが多い順' })));
    if (!stats.length) {
      projectsCard.append(el('div', { class: 'empty' }, icon('folder'), el('strong', { text: 'プロジェクトはまだありません' }),
        el('span', { text: 'プロジェクト画面で作成すると、ここに進み具合が表示されます' }),
        el('button', { class: 'btn btn--small', type: 'button', text: 'プロジェクト画面へ', onclick: () => App.showView('projects') })));
    }
    stats.forEach((s) => projectsCard.append(projectRow(s)));

    const hintsCard = el('section', { class: 'card dash-hints', 'aria-labelledby': 'dash-hints-title' },
      el('h2', { class: 'card-title', id: 'dash-hints-title', text: '改善のヒント' }),
      buildHints(stats, tasks, overall, now).map(hintItem));

    // グラフ
    const weeks = weeklyCompleted(tasks, now);
    const charts = el('div', { class: 'charts' }, onTimeChart(overall, stats), trendChart(weeks), breakdownChart(open));

    root.append(el('div', { class: 'dash-flow' }, el('div', { class: 'focus-row' }, projectsCard, hintsCard), charts));
  }

  function kpi(iconName, label, value, unit, cls, sub) {
    return el('div', { class: `card kpi ${cls || ''}` },
      el('span', { class: 'kpi__icon' }, icon(iconName)),
      el('span', null, el('span', { class: 'kpi__label', text: label }), el('span', { class: 'kpi__value' }, String(value), el('small', { text: unit })), sub ? el('span', { class: 'kpi__sub', text: sub }) : null));
  }

  function toList(projectId) {
    App.showView('list', { filters: { status: 'all', category: 'work', projectId, due: '', keyword: '' } });
  }

  function projectRow(s) {
    const name = s.project.name;
    return el('article', { class: `project-row ${s.overdue ? 'project-row--alert' : ''} pc-${s.project.color}` },
      el('h3', { class: 'project-name', text: name }),
      el('div', { class: 'progress-box' },
        el('div', { class: 'progress__value' }, el('strong', { text: `${s.rate}%` }), el('span', { text: `完了 ${s.done} / ${s.total}件` })),
        bar(s.rate, `進み具合${s.rate}%`)),
      el('dl', { class: 'metrics' },
        el('div', null, el('dt', { text: '未完了' }), el('dd', null, String(s.open), el('small', { text: '件' }))),
        el('div', null, el('dt', { text: '期限切れ' }), el('dd', { class: s.overdue ? 'is-overdue' : 'is-zero' }, s.overdue ? '⚠ ' : '', String(s.overdue), el('small', { text: '件' }))),
        el('div', null, el('dt', { text: '「高」の未完了' }), el('dd', { class: s.highOpen ? '' : 'is-zero' }, String(s.highOpen), el('small', { text: '件' })))),
      el('button', { class: 'to-list', type: 'button', 'aria-label': `リストで「${name}」のタスクを見る`, onclick: () => toList(s.project.id) }, 'タスクを見る ›'));
  }

  function hintItem(h) {
    const icons = { overdue: 'alert', priority: 'flag', rate: 'bulb', good: 'check' };
    return el('div', { class: `dash-hint dash-hint--${h.type}` },
      el('span', { class: 'dash-hint__icon' }, icon(icons[h.type])),
      el('div', null,
        el('p', { class: 'dash-hint__title', text: h.title }),
        el('p', { class: 'dash-hint__text', text: h.text }),
        h.projectId ? el('button', { class: 'to-list', type: 'button', onclick: () => toList(h.projectId) }, 'タスクを見る ›') : null,
        h.due ? el('button', { class: 'to-list', type: 'button', onclick: () => App.showView('list', { filters: { status: 'open', category: 'all', projectId: '', due: h.due, keyword: '' } }) }, 'タスクを見る ›') : null));
  }

  function bar(percent, label, cls) {
    return el('div', { class: `bar ${cls || ''}`, role: 'img', 'aria-label': label }, el('i', { style: { width: `${Math.max(0, Math.min(100, percent))}%` } }));
  }

  function hbar(label, percent, valueText, cls) {
    return el('div', { class: `hbar ${cls || ''}` },
      el('span', { class: 'hbar__label', text: label }), bar(percent, `${label} ${valueText}`), el('span', { class: 'hbar__value', text: valueText }));
  }

  function onTimeChart(overall, stats) {
    const rows = [overall ? hbar('全体', overall.rate, `${overall.rate}%`, 'hbar--total') : el('p', { class: 'muted', text: '期限を設定して完了したタスクがまだありません' })];
    stats.forEach((s) => {
      rows.push(s.onTime
        ? hbar(s.project.name, s.onTime.rate, `${s.onTime.rate}%`, `pc-${s.project.color}`)
        : el('div', { class: 'hbar' }, el('span', { class: 'hbar__label', text: s.project.name }), el('span', { class: 'muted hbar__none', text: 'データなし' })));
    });
    return el('section', { class: 'card chart', 'aria-labelledby': 'rate-title' },
      el('h2', { class: 'card-title', id: 'rate-title', text: '期限内に完了できた割合' }), rows,
      el('p', { class: 'card-note', text: '期限を設定して完了したタスクのうち、期限までに完了できた割合' }));
  }

  function trendChart(weeks) {
    // 目盛り（最大・中間・0）が整数になるよう、最大値を偶数にそろえる
    const max = Math.max(4, ...weeks.map((w) => w.count));
    const scale = Math.ceil(max / 2) * 2;
    const label = `週ごとの完了数。${weeks.map((w) => `${w.start.getMonth() + 1}月${w.start.getDate()}日の週${w.count}件`).join('、')}`;
    return el('section', { class: 'card chart', 'aria-labelledby': 'trend-title' },
      el('h2', { class: 'card-title', id: 'trend-title', text: '完了数の推移（直近8週間）' }),
      el('div', { class: 'vbars', role: 'img', 'aria-label': label },
        el('div', { class: 'vbars__axis', 'aria-hidden': 'true' }, el('span', { text: String(scale) }), el('span', { text: String(scale / 2) }), el('span', { text: '0' })),
        el('div', { class: 'vbars__plot', 'aria-hidden': 'true' }, weeks.map((w) => el('div', { class: `vbar ${w.isThisWeek ? 'vbar--latest' : ''}` },
          el('b', { text: String(w.count) }), el('i', { style: { height: `${(w.count / scale) * 100}%` } }), el('span', { text: `${w.start.getMonth() + 1}/${w.start.getDate()}` }))))),
      el('p', { class: 'card-note', text: '週の初め（月曜日）の日付。単位：件。一番右が今週' }));
  }

  function breakdownChart(open) {
    const total = open.length || 1;
    const byCat = Object.entries(T.CATEGORY_LABELS).map(([k, label]) => [label, open.filter((t) => t.category === k).length]);
    const byPri = Object.entries(T.PRIORITY_LABELS).map(([k, label]) => [k, label, open.filter((t) => t.priority === k).length]);
    return el('section', { class: 'card chart', 'aria-labelledby': 'breakdown-title' },
      el('h2', { class: 'card-title', id: 'breakdown-title', text: `未完了の内訳（${open.length}件）` }),
      el('h3', { class: 'sub-title', text: 'カテゴリ別' }),
      byCat.map(([label, n]) => hbar(label, (n / total) * 100, `${n}件`, 'c-category')),
      el('h3', { class: 'sub-title', text: '優先度別' }),
      byPri.map(([k, label, n]) => hbar(label, (n / total) * 100, `${n}件`, `c-${k}`)));
  }

  App.DashboardView = { mount, render, onTimeRate, weeklyCompleted };
})(window.TodoApp = window.TodoApp || {});
