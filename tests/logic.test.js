/**
 * データ処理（日付・祝日・絞り込み・並び替え・保存）の自動テスト
 * 実行方法：Node.js がある環境で、todo-app フォルダから  node tests/logic.test.js
 * （アプリの動作には Node.js は不要。このテストは確認用）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ブラウザの代わりになる最低限の環境を用意して、アプリのファイルを読み込む
const store = {};
const context = {
  console,
  window: {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    crypto: require('crypto'),
  },
};
vm.createContext(context);
['date-utils.js', 'holidays.js', 'storage.js', 'tasks.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
});
const { DateUtils: D, Holidays: H, Tasks: T, Storage: S } = context.window.TodoApp;
const plain = (x) => JSON.parse(JSON.stringify(x));
const same = (actual, expected, message) => assert.deepStrictEqual(plain(actual), plain(expected), message);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 現在＝2026年9月26日（土）13:20 とする
const now = new Date(2026, 8, 26, 13, 20);
let seq = 1;
const task = (title, dueDate, dueTime, category, priority, completed = false) => ({
  id: `t${seq}`, title, detail: '', dueDate, dueTime, category, priority, projectId: '', completed, createdAt: seq++, completedAt: completed ? 1 : null,
});
const tasks = [
  task('企画書の修正', '2026-09-23', '10:00', 'work', 'high'),
  task('見積書の送付', '2026-09-26', '09:00', 'work', 'medium'),
  task('会議資料の作成', '2026-09-26', '14:00', 'work', 'high'),
  task('買い物', '2026-09-26', '18:00', 'private', 'medium'),
  task('ジムに行く', '2026-09-27', '19:00', 'private', 'medium'),
  task('定例会議', '2026-09-28', '10:00', 'work', 'medium'),
  task('資料確認', '2026-09-28', '10:00', 'work', 'medium'),
  task('顧客との打ち合わせ', '2026-09-28', '10:00', 'work', 'medium'),
  task('デザイン確認', '2026-09-29', '09:00', 'work', 'medium'),
  task('ブログ記事の執筆', '2026-10-02', '', 'other', 'low'),
  task('家族旅行の計画', '2027-01-09', '', 'private', 'medium'),
  task('本を読む', '', '', 'other', 'low'),
  task('資格の勉強', '', '', 'other', 'low'),
  task('メールの返信', '2026-09-26', '11:00', 'work', 'low', true),
  task('部屋の掃除', '2026-09-20', '', 'private', 'medium', true),
];

console.log('日付');
test('残り時間の表示', () => {
  const text = Object.fromEntries(tasks.map((t) => [t.title, (D.remaining(t, now) || {}).text]));
  same(
    [text['企画書の修正'], text['見積書の送付'], text['会議資料の作成'], text['買い物'], text['ジムに行く'], text['定例会議'], text['ブログ記事の執筆'], text['家族旅行の計画']],
    ['3日超過', '4時間超過', 'あと40分', 'あと4時間', '明日まで', 'あと2日', 'あと6日', 'あと105日'],
  );
});
test('期限の表示（今年は年を省略、今年以外は年を付ける）', () => {
  assert.strictEqual(D.formatDue(tasks[5], now), '9月28日（月）10:00');
  assert.strictEqual(D.formatDue(tasks[10], now), '2027年1月9日（土）');
  assert.strictEqual(D.formatInputDate('2026-10-05'), '2026/10/05（月）');
});
test('存在しない日付・うるう年・年またぎ', () => {
  assert.ok(D.parseDate('2028-02-29'));
  assert.strictEqual(D.parseDate('2027-02-29'), null);
  assert.strictEqual(D.parseDate('2026-13-01'), null);
  assert.strictEqual(D.toDateStr(D.addDays(D.parseDate('2026-12-31'), 1)), '2027-01-01');
});
test('週の始まり（今日／月曜／日曜）', () => {
  const today = new Date(2026, 8, 26);
  assert.strictEqual(D.toDateStr(D.weekStartOf(today, 'today', today)), '2026-09-26');
  assert.strictEqual(D.toDateStr(D.weekStartOf(today, 'mon', today)), '2026-09-21');
  assert.strictEqual(D.toDateStr(D.weekStartOf(today, 'sun', today)), '2026-09-20');
  assert.strictEqual(D.toDateStr(D.weekStartOf(new Date(2026, 9, 5), 'today', today)), '2026-10-03');
});

console.log('祝日（内閣府の公表と一致するか）');
test('2026年', () => same([...H.holidaysOfYear(2026).keys()].sort(), ['2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23']));
test('2027年', () => same([...H.holidaysOfYear(2027).keys()].sort(), ['2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23']));

console.log('絞り込み・並び替え・件数');
test('サマリーカードの件数', () => same(T.summary(tasks, now), { open: 13, today: 2, overdue: 2, done: 2 }));
test('期限ごとのグループ分け', () => {
  const open = T.filterTasks(tasks, { status: 'open' }, now);
  const groups = T.groupTasks(T.sortTasks(open, 'due'), 'due', now, 'today');
  same(groups.map((g) => `${g.label}(${g.tasks.length})`), ['期限切れ(2)', '今日(2)', '明日(1)', '今週(5)', 'それ以降(1)', '期限なし(2)']);
});
test('期限順：期限なしは最後、優先度順：高→中→低', () => {
  const byDue = T.sortTasks(tasks, 'due').map((t) => t.title);
  same(byDue.slice(-2).sort(), ['本を読む', '資格の勉強'].sort());
  const ranks = T.sortTasks(tasks, 'priority').map((t) => T.PRIORITY_RANK[t.priority]);
  same(ranks, [...ranks].sort((a, b) => a - b));
});
test('ステータス・カテゴリ・キーワードの組み合わせ', () => {
  assert.strictEqual(T.filterTasks(tasks, { status: 'done' }, now).length, 2);
  assert.strictEqual(T.filterTasks(tasks, { status: 'open', category: 'work' }, now).length, 7);
  same(T.filterTasks(tasks, { keyword: '資料' }, now).map((t) => t.title), ['会議資料の作成', '資料確認']);
});

console.log('入力チェック');
test('タスク名が空・空白だけならエラー', () => {
  assert.strictEqual(T.validateTask({ title: '' }).title, 'タスク名を入力してください');
  assert.strictEqual(T.validateTask({ title: '   ' }).title, 'タスク名を入力してください');
  same(T.validateTask({ title: 'OK' }), {});
});
test('仕事以外のタスクにはプロジェクトを設定しない', () => {
  const n = T.normalizeTaskInput({ title: ' x ', category: 'private', projectId: 'p1', dueDate: '', dueTime: '10:00', priority: '?' });
  same([n.title, n.projectId, n.dueTime, n.priority], ['x', '', '', 'medium']);
});

console.log('保存と読み込み');
test('壊れた保存データでも止まらない（元のデータは退避する）', () => {
  store['todo-app-data'] = '{壊れた';
  const r = S.load();
  assert.ok(r.error);
  assert.strictEqual(r.data.tasks.length, 0);
  assert.ok(Object.keys(store).some((k) => k.startsWith('todo-app-data-broken')));
});
test('追加・完了・削除が保存される', () => {
  store['todo-app-data'] = JSON.stringify({ version: 1, tasks: [], projects: [], settings: {} });
  T.init(S.load().data);
  const t = T.addTask({ title: '新規', category: 'work', priority: 'high', dueDate: '2026-10-01', dueTime: '09:15' });
  T.toggleTask(t.id);
  assert.ok(JSON.parse(store['todo-app-data']).tasks[0].completedAt);
  T.toggleTask(t.id);
  assert.strictEqual(JSON.parse(store['todo-app-data']).tasks[0].completedAt, null);
  T.deleteTask(t.id);
  assert.strictEqual(JSON.parse(store['todo-app-data']).tasks.length, 0);
});
test('プロジェクトを削除してもタスクは残る', () => {
  const p = T.addProject('社内業務', 'blue');
  assert.strictEqual(T.validateProjectName(' 社内業務 '), '同じ名前のプロジェクトがあります');
  const t = T.addTask({ title: 'A', category: 'work', projectId: p.id });
  T.deleteProject(p.id);
  assert.strictEqual(T.getTask(t.id).projectId, '');
});

console.log(`\nすべて成功（${passed}件）`);
