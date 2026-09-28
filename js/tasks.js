/**
 * タスクとプロジェクトのデータ操作（追加・更新・削除・完了切り替え）と、
 * 絞り込み・並び替え・グループ分け・件数の集計
 *
 * 画面の表示はここでは行わない。データが変わったら subscribe() で登録した関数を呼び出す。
 */
(function (App) {
  'use strict';

  const D = App.DateUtils;

  const CATEGORY_LABELS = { work: '仕事', private: 'プライベート', other: 'その他' };
  const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const PROJECT_COLORS = {
    blue: '青', purple: '紫', green: '緑', teal: '青緑', orange: 'オレンジ', brown: '茶', gray: '灰', navy: '紺',
  };

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /* ========== 入力チェック ========== */

  /** タスクの入力内容を確認し、エラーメッセージの一覧を返す（問題なければ空のオブジェクト） */
  function validateTask(input) {
    const errors = {};
    if (!input.title || !input.title.trim()) errors.title = 'タスク名を入力してください';
    else if (input.title.trim().length > 100) errors.title = 'タスク名は100文字以内で入力してください';
    if (input.detail && input.detail.length > 1000) errors.detail = '詳細は1000文字以内で入力してください';
    if (input.dueDate && !D.parseDate(input.dueDate)) errors.dueDate = '期限の日付が正しくありません';
    return errors;
  }

  /** フォームの値を、保存する形に整える */
  function normalizeTaskInput(input) {
    const dueDate = D.parseDate(input.dueDate) ? input.dueDate : '';
    const category = CATEGORY_LABELS[input.category] ? input.category : 'other';
    return {
      title: input.title.trim(),
      detail: (input.detail || '').trim(),
      dueDate,
      dueTime: dueDate && D.parseTime(input.dueTime) ? input.dueTime : '',
      category,
      priority: PRIORITY_LABELS[input.priority] ? input.priority : 'medium',
      // プロジェクトは「仕事」のタスクだけに設定できる
      projectId: category === 'work' && input.projectId ? input.projectId : '',
    };
  }

  /* ========== データの保持と変更 ========== */

  let data = null;
  const listeners = [];
  let saveFailed = false;

  function init(loaded) {
    data = loaded;
  }

  function getData() {
    return data;
  }

  function subscribe(fn) {
    listeners.push(fn);
  }

  function commit() {
    saveFailed = !App.Storage.save(data);
    listeners.forEach((fn) => fn());
  }

  function isSaveFailed() {
    return saveFailed;
  }

  function getTask(id) {
    return data.tasks.find((t) => t.id === id) || null;
  }

  function addTask(input) {
    const task = {
      id: createId(),
      ...normalizeTaskInput(input),
      completed: false,
      createdAt: Date.now(),
      completedAt: null,
    };
    data.tasks.push(task);
    commit();
    return task;
  }

  function updateTask(id, input) {
    const task = getTask(id);
    if (!task) return null;
    Object.assign(task, normalizeTaskInput(input));
    commit();
    return task;
  }

  function toggleTask(id) {
    const task = getTask(id);
    if (!task) return null;
    task.completed = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;
    commit();
    return task;
  }

  /** 完了の状態を指定した値に戻す（お知らせの「元に戻す」で使う。完了日時も元の値に戻す） */
  function restoreCompletion(id, completed, completedAt) {
    const task = getTask(id);
    if (!task) return null;
    task.completed = completed;
    task.completedAt = completed ? completedAt : null;
    commit();
    return task;
  }

  function deleteTask(id) {
    const before = data.tasks.length;
    data.tasks = data.tasks.filter((t) => t.id !== id);
    if (data.tasks.length !== before) commit();
  }

  function updateSettings(patch) {
    Object.assign(data.settings, patch);
    commit();
  }

  /* ========== プロジェクト ========== */

  function getProject(id) {
    return data.projects.find((p) => p.id === id) || null;
  }

  function activeProjects() {
    return data.projects.filter((p) => !p.archived).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** プロジェクト名の確認（同じ名前は登録できない。大文字・小文字と前後の空白は区別しない） */
  function validateProjectName(name, exceptId) {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'プロジェクト名を入力してください';
    if (trimmed.length > 40) return 'プロジェクト名は40文字以内で入力してください';
    const dup = data.projects.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === trimmed.toLowerCase());
    return dup ? '同じ名前のプロジェクトがあります' : '';
  }

  function addProject(name, color) {
    const project = {
      id: createId(),
      name: name.trim(),
      color: PROJECT_COLORS[color] ? color : 'blue',
      archived: false,
      createdAt: Date.now(),
    };
    data.projects.push(project);
    commit();
    return project;
  }

  function updateProject(id, patch) {
    const project = getProject(id);
    if (!project) return null;
    if (typeof patch.name === 'string') project.name = patch.name.trim();
    if (patch.color && PROJECT_COLORS[patch.color]) project.color = patch.color;
    if (typeof patch.archived === 'boolean') project.archived = patch.archived;
    commit();
    return project;
  }

  /** プロジェクトを削除する。タスクは削除せず「プロジェクト未設定」に戻す */
  function deleteProject(id) {
    data.projects = data.projects.filter((p) => p.id !== id);
    data.tasks.forEach((t) => { if (t.projectId === id) t.projectId = ''; });
    commit();
  }

  /* ========== 絞り込み・並び替え ========== */

  /**
   * 絞り込み
   * filters: { status: 'all'|'open'|'done', category: 'all'|'work'|..., projectId: ''|id, due: ''|'today'|'overdue', keyword: '' }
   */
  function filterTasks(tasks, filters, now) {
    const keyword = (filters.keyword || '').trim().toLowerCase();
    const today = D.startOfDay(now);
    return tasks.filter((t) => {
      if (filters.status === 'open' && t.completed) return false;
      if (filters.status === 'done' && !t.completed) return false;
      if (filters.category && filters.category !== 'all' && t.category !== filters.category) return false;
      if (filters.projectId && t.projectId !== filters.projectId) return false;
      if (filters.due === 'overdue' && !D.isOverdue(t, now)) return false;
      if (filters.due === 'today') {
        const date = D.parseDate(t.dueDate);
        if (t.completed || !date || D.diffDays(today, date) !== 0 || D.isOverdue(t, now)) return false;
      }
      if (keyword && !`${t.title}\n${t.detail}`.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }

  function compareDue(a, b) {
    const da = D.dueDateTime(a);
    const db = D.dueDateTime(b);
    if (da && db) return da - db;
    if (da) return -1; // 期限なしは最後
    if (db) return 1;
    return 0;
  }

  function comparePriority(a, b) {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }

  /** 並び替え。同じ順位のときは、次の条件→登録が新しい順で決めて、表示を安定させる */
  function sortTasks(tasks, sort) {
    const list = [...tasks];
    const byCreated = (a, b) => b.createdAt - a.createdAt;
    if (sort === 'due') {
      list.sort((a, b) => compareDue(a, b) || comparePriority(a, b) || byCreated(a, b));
    } else if (sort === 'priority') {
      list.sort((a, b) => comparePriority(a, b) || compareDue(a, b) || byCreated(a, b));
    } else {
      list.sort(byCreated);
    }
    return list;
  }

  /** 「今週」の最後の日（週の始まりの設定に合わせる） */
  function weekEnd(now, weekStartSetting) {
    const today = D.startOfDay(now);
    return D.addDays(D.weekStartOf(today, weekStartSetting, today), 6);
  }

  /**
   * 期限ごとのグループ分け（期限順のときに使う）
   * 期限切れ → 今日 → 明日 → 今週（明後日〜今週の終わり）→ それ以降 → 期限なし
   */
  function dueGroupKey(task, now, weekStartSetting) {
    const date = D.parseDate(task.dueDate);
    if (!date) return 'nodate';
    if (D.isOverdue(task, now)) return 'overdue';
    const days = D.diffDays(now, date);
    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (date <= weekEnd(now, weekStartSetting)) return 'week';
    return 'later';
  }

  const DUE_GROUPS = [
    { key: 'overdue', label: '期限切れ' },
    { key: 'today', label: '今日' },
    { key: 'tomorrow', label: '明日' },
    { key: 'week', label: '今週' },
    { key: 'later', label: 'それ以降' },
    { key: 'nodate', label: '期限なし' },
  ];
  const PRIORITY_GROUPS = [
    { key: 'high', label: '優先度：高' },
    { key: 'medium', label: '優先度：中' },
    { key: 'low', label: '優先度：低' },
  ];

  /** 並び替え済みの配列を、見出しごとのグループに分ける（空のグループは含めない） */
  function groupTasks(sorted, sort, now, weekStartSetting) {
    if (sort === 'due') {
      return DUE_GROUPS
        .map((g) => ({ ...g, tasks: sorted.filter((t) => dueGroupKey(t, now, weekStartSetting) === g.key) }))
        .filter((g) => g.tasks.length);
    }
    if (sort === 'priority') {
      return PRIORITY_GROUPS
        .map((g) => ({ ...g, tasks: sorted.filter((t) => t.priority === g.key) }))
        .filter((g) => g.tasks.length);
    }
    return sorted.length ? [{ key: 'all', label: '', tasks: sorted }] : [];
  }

  /** サマリーカードの件数 */
  function summary(tasks, now) {
    const open = tasks.filter((t) => !t.completed);
    return {
      open: open.length,
      today: filterTasks(tasks, { due: 'today' }, now).length,
      overdue: open.filter((t) => D.isOverdue(t, now)).length,
      done: tasks.length - open.length,
    };
  }

  App.Tasks = {
    CATEGORY_LABELS,
    PRIORITY_LABELS,
    PRIORITY_RANK,
    PROJECT_COLORS,
    validateTask,
    normalizeTaskInput,
    init,
    getData,
    subscribe,
    isSaveFailed,
    getTask,
    addTask,
    updateTask,
    toggleTask,
    restoreCompletion,
    deleteTask,
    updateSettings,
    getProject,
    activeProjects,
    validateProjectName,
    addProject,
    updateProject,
    deleteProject,
    filterTasks,
    sortTasks,
    groupTasks,
    dueGroupKey,
    weekEnd,
    summary,
  };
})(window.TodoApp = window.TodoApp || {});
