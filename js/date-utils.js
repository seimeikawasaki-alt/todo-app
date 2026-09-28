/**
 * 日付の計算をまとめたファイル
 *
 * 日付は "YYYY-MM-DD" の文字列で保存する。
 * new Date("2026-10-05") は世界標準時（UTC）として解釈され、日本時間では日付がずれることがあるため、
 * 文字列を年・月・日に分けてから、端末の時刻（ローカル時刻）の Date を作る。
 */
(function (App) {
  'use strict';

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** Date → "YYYY-MM-DD" */
  function toDateStr(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  /** "YYYY-MM-DD" → その日の0時（ローカル時刻）の Date。形式が正しくなければ null */
  function parseDate(str) {
    if (typeof str !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) return null;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // 2026-02-30 のような存在しない日付を弾く
    if (date.getMonth() !== Number(m[2]) - 1) return null;
    return date;
  }

  /** "HH:MM" → { h, m }。形式が正しくなければ null */
  function parseTime(str) {
    const m = /^(\d{2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    return { h: Number(m[1]), m: Number(m[2]) };
  }

  function addDays(date, days) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + days);
    return d;
  }

  /** 2つの日付の差（日数）。時刻は無視する。夏時間などの影響を避けるため丸める */
  function diffDays(from, to) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / DAY_MS);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /**
   * タスクの期限の日時。
   * 時刻がないタスク（終日）は、その日の終わりまでを期限とする。
   */
  function dueDateTime(task) {
    const date = parseDate(task.dueDate);
    if (!date) return null;
    const time = parseTime(task.dueTime);
    if (time) {
      date.setHours(time.h, time.m, 0, 0);
    } else {
      date.setHours(23, 59, 59, 999);
    }
    return date;
  }

  /** 表示用：今年なら「9月28日（月）」、今年以外なら「2028年4月20日（木）」。時刻があれば後ろに付ける */
  function formatDue(task, now) {
    const date = parseDate(task.dueDate);
    if (!date) return '期限なし';
    const base = date.getFullYear() === now.getFullYear()
      ? `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`
      : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
    const time = parseTime(task.dueTime);
    return time ? `${base}${time.h}:${pad2(time.m)}` : base;
  }

  /** 入力欄用：「2026/10/05（月）」 */
  function formatInputDate(str) {
    const date = parseDate(str);
    if (!date) return '';
    return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}（${WEEKDAYS[date.getDay()]}）`;
  }

  /** 作成日などの表示用：「2026年9月20日（日）」 */
  function formatFullDate(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
  }

  /** 期限を過ぎているか（未完了のタスクだけが対象） */
  function isOverdue(task, now) {
    if (task.completed) return false;
    const due = dueDateTime(task);
    return !!due && due < now;
  }

  /**
   * 残り時間の表示。
   * - 期限切れ：時刻ありで今日なら「4時間超過」「40分超過」、それ以外は「3日超過」
   * - 今日：時刻ありなら「あと40分」「あと4時間」（切り捨て）、時刻なしなら「今日まで」
   * - 明日：「明日まで」
   * - それ以外：「あと6日」
   * level は表示の色分けに使う（overdue＝赤、soon＝オレンジ、normal＝灰色）
   */
  function remaining(task, now) {
    const date = parseDate(task.dueDate);
    if (!date || task.completed) return null;
    const due = dueDateTime(task);
    const days = diffDays(now, date);

    if (due < now) {
      if (days === 0) {
        const minutes = Math.floor((now - due) / 60000);
        return { level: 'overdue', text: minutes < 60 ? `${minutes}分超過` : `${Math.floor(minutes / 60)}時間超過` };
      }
      return { level: 'overdue', text: `${-days}日超過` };
    }
    if (days === 0) {
      if (!parseTime(task.dueTime)) return { level: 'soon', text: '今日まで' };
      const minutes = Math.floor((due - now) / 60000);
      return { level: 'soon', text: minutes < 60 ? `あと${minutes}分` : `あと${Math.floor(minutes / 60)}時間` };
    }
    if (days === 1) return { level: 'normal', text: '明日まで' };
    return { level: 'normal', text: `あと${days}日` };
  }

  /**
   * 週の始まりの設定（'today' / 'mon' / 'sun'）に合わせて、基準日を含む週の最初の日を返す
   */
  function weekStartOf(date, setting, today) {
    const d = startOfDay(date);
    if (setting === 'mon') return addDays(d, -((d.getDay() + 6) % 7));
    if (setting === 'sun') return addDays(d, -d.getDay());
    // 'today'：今日を起点に7日ずつ区切る
    const offset = diffDays(today, d);
    const block = Math.floor(offset / 7);
    return addDays(startOfDay(today), block * 7);
  }

  App.DateUtils = {
    WEEKDAYS,
    pad2,
    toDateStr,
    parseDate,
    parseTime,
    addDays,
    diffDays,
    startOfDay,
    dueDateTime,
    formatDue,
    formatInputDate,
    formatFullDate,
    isOverdue,
    remaining,
    weekStartOf,
  };
})(window.TodoApp = window.TodoApp || {});
