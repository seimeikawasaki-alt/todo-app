/**
 * LocalStorage への保存と読み込み
 *
 * すべてのデータを1つのキーにまとめて保存する。
 * { version, tasks, projects, settings }
 * データの形式を変えたときは、version を上げて migrate() で古いデータを変換する。
 */
(function (App) {
  'use strict';

  const STORAGE_KEY = 'todo-app-data';
  const CURRENT_VERSION = 1;

  const DEFAULT_SETTINGS = {
    weekStart: 'today',      // 週表示の始まり：'today' / 'mon' / 'sun'
    lastView: 'list',        // 最後に開いた画面
    completedOpen: true,     // 「完了済み」の見出しを開いているか
    detailPanelOpen: true,   // 週表示の詳細パネルを開いているか
  };

  function emptyData() {
    return { version: CURRENT_VERSION, tasks: [], projects: [], settings: { ...DEFAULT_SETTINGS } };
  }

  /** 古い形式のデータを、現在の形式に変換する */
  function migrate(data) {
    // 現在は version 1 のみ。形式を変えたらここに変換処理を追加する
    return data;
  }

  const CATEGORIES = ['work', 'private', 'other'];
  const PRIORITIES = ['high', 'medium', 'low'];

  /** 壊れた値が混ざっていても画面が止まらないよう、1件ずつ形を整える */
  function sanitizeTask(t) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string') return null;
    const title = typeof t.title === 'string' ? t.title : '';
    if (!title.trim()) return null;
    return {
      id: t.id,
      title,
      detail: typeof t.detail === 'string' ? t.detail : '',
      dueDate: App.DateUtils.parseDate(t.dueDate) ? t.dueDate : '',
      dueTime: App.DateUtils.parseTime(t.dueTime) && App.DateUtils.parseDate(t.dueDate) ? t.dueTime : '',
      category: CATEGORIES.includes(t.category) ? t.category : 'other',
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
      projectId: typeof t.projectId === 'string' ? t.projectId : '',
      completed: t.completed === true,
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
      completedAt: t.completed === true && Number.isFinite(t.completedAt) ? t.completedAt : null,
    };
  }

  function sanitizeProject(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim()) return null;
    return {
      id: p.id,
      name: p.name,
      color: typeof p.color === 'string' ? p.color : 'blue',
      archived: p.archived === true,
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
    };
  }

  /**
   * 読み込み。失敗した場合は空のデータを返し、error に理由を入れる。
   * （壊れたデータは別のキーに退避して、上書きで消えないようにする）
   */
  function load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return { data: emptyData(), error: 'このブラウザでは保存機能を利用できません。登録した内容は、ページを閉じると消えます。' };
    }
    if (!raw) return { data: emptyData(), error: null };

    try {
      const parsed = migrate(JSON.parse(raw));
      const projects = (Array.isArray(parsed.projects) ? parsed.projects : []).map(sanitizeProject).filter(Boolean);
      const projectIds = new Set(projects.map((p) => p.id));
      const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).map(sanitizeTask).filter(Boolean)
        .map((t) => (t.projectId && !projectIds.has(t.projectId) ? { ...t, projectId: '' } : t));
      const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}) };
      if (!['today', 'mon', 'sun'].includes(settings.weekStart)) settings.weekStart = 'today';
      ['completedOpen', 'detailPanelOpen'].forEach((k) => { if (typeof settings[k] !== 'boolean') settings[k] = DEFAULT_SETTINGS[k]; });
      return {
        data: {
          version: CURRENT_VERSION,
          tasks,
          projects,
          settings,
        },
        error: null,
      };
    } catch (e) {
      try { window.localStorage.setItem(`${STORAGE_KEY}-broken-${Date.now()}`, raw); } catch (_) { /* 退避できなくても続ける */ }
      return { data: emptyData(), error: '保存データを読み込めなかったため、新しい状態で開きました。' };
    }
  }

  /** 保存。成功したら true */
  function save(data) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, version: CURRENT_VERSION }));
      return true;
    } catch (e) {
      return false;
    }
  }

  App.Storage = { load, save, STORAGE_KEY, DEFAULT_SETTINGS };
})(window.TodoApp = window.TodoApp || {});
