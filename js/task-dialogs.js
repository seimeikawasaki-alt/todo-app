/**
 * タスクの操作に使う画面（リスト表示・週表示で共通）
 * - openEditor()：登録・編集のモーダル（スマホでは下から出てくる画面）
 * - confirmDelete()：削除の確認
 * - buildDetail()：タスクの詳細（PCの右側のパネル／モーダル／スマホの下から出る画面の中身）
 * - openDetailModal()：詳細をモーダルで開く（画面幅が1280px未満のとき）
 */
(function (App) {
  'use strict';

  const { el, icon, openModal, confirmDialog, toast } = App.UI;
  const T = App.Tasks;
  const D = App.DateUtils;

  let uid = 0;

  /**
   * 登録・編集のモーダル
   * mode: 'add' | 'edit'
   * task: 編集するタスク（mode が 'edit' のとき）
   * preset: 登録するときの初期値（週表示の空いたマスから開いたときの日時など）
   */
  function openEditor({ mode, task, preset }) {
    uid += 1;
    const titleId = `editor-title-${uid}`;
    let modal = null;
    const form = App.TaskForm.createTaskFields({
      layout: 'stacked',
      weekStart: () => T.getData().settings.weekStart,
      onSubmit: submit,
    });
    const f = form.fields;

    function submit() {
      const values = form.getValues();
      const errors = T.validateTask(values);
      form.showErrors(errors);
      if (Object.keys(errors).length) return;
      if (mode === 'edit') {
        T.updateTask(task.id, values);
        toast('タスクを更新しました');
      } else {
        T.addTask(values);
        toast('タスクを追加しました');
      }
      modal.close();
    }

    const content = el('form', { class: 'editor', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
      el('div', { class: 'dialog-title' },
        el('h2', { id: titleId, text: mode === 'edit' ? 'タスクを編集' : 'タスクを追加' }),
        el('button', { class: 'btn btn--icon', type: 'button', 'aria-label': '閉じる', onclick: () => modal.close() }, '×')),
      el('div', { class: 'editor__body' },
        f.titleField,
        el('div', { class: 'editor__two' }, f.dateField, f.timeField),
        el('div', { class: 'editor__two' }, f.categoryField, f.priorityField),
        f.projectField,
        f.detailField),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: () => modal.close() }),
        el('button', { class: 'btn btn--primary', type: 'submit', text: mode === 'edit' ? '保存' : '追加' })));

    form.setValues(mode === 'edit' ? task : { category: 'other', priority: 'medium', ...(preset || {}) });
    modal = openModal({ content, labelledBy: titleId, className: 'modal--editor', initialFocus: form.titleInput });
  }

  /** 削除の確認。削除したら true */
  async function confirmDelete(task) {
    const ok = await confirmDialog({
      title: 'このタスクを削除しますか？',
      message: `「${task.title}」を削除します。この操作は取り消せません。`,
      okLabel: '削除',
      danger: true,
    });
    if (ok) {
      T.deleteTask(task.id);
      toast('タスクを削除しました');
    }
    return ok;
  }

  /** 残り時間のラベル */
  function remainingLabel(task, now) {
    const r = D.remaining(task, now);
    if (!r) return null;
    const prefix = r.level === 'overdue' ? '⚠ ' : r.level === 'soon' ? '◷ ' : '';
    return el('span', { class: `due__rest due__rest--${r.level}`, text: prefix + r.text });
  }

  function priorityBadge(priority) {
    return el('span', { class: `badge badge--${priority}`, text: T.PRIORITY_LABELS[priority] });
  }

  function projectLabel(projectId) {
    const project = projectId && T.getProject(projectId);
    if (!project) return null;
    return el('span', { class: `project pc-${project.color}`, text: project.name });
  }

  /**
   * 完了⇔未完了を切り替える（確認画面は出さず、お知らせの「元に戻す」で取り消せるようにする）
   */
  function toggleWithUndo(taskId) {
    const before = T.getTask(taskId);
    if (!before) return;
    const prev = { completed: before.completed, completedAt: before.completedAt };
    const updated = T.toggleTask(taskId);
    toast(updated.completed ? `「${updated.title}」を完了にしました` : `「${updated.title}」を未完了に戻しました`, null, {
      label: '元に戻す',
      onClick: () => {
        T.restoreCompletion(taskId, prev.completed, prev.completedAt);
        toast('元に戻しました');
      },
    });
  }

  /**
   * 完了／未完了を切り替える、文字付きのボタン
   * 未完了のとき「✓ 完了にする」、完了のとき「↺ 未完了に戻す」
   */
  function toggleButton(task, options) {
    const small = options && options.small;
    return el('button', {
      class: `btn ${small ? 'btn--small' : ''} ${task.completed ? 'btn--undo' : 'btn--complete'}`, type: 'button',
      'aria-label': task.completed ? `「${task.title}」を未完了に戻す` : `「${task.title}」を完了にする`,
      onclick: () => toggleWithUndo(task.id),
    }, task.completed ? '↺ 未完了に戻す' : '✓ 完了にする');
  }

  /**
   * 詳細の中身
   * options: { onClose, closeStyle: 'arrow'（PCの右側のパネル） | 'x'（モーダル）, onDeleted }
   * 閉じるボタンはタイトルに重ならないよう、上の行に独立して置く
   */
  function buildDetail(task, options) {
    const now = new Date();
    uid += 1;
    const titleId = `detail-title-${uid}`;
    const created = new Date(task.createdAt);

    const rows = [
      ['状態', el('span', { class: `badge ${task.completed ? 'badge--done' : 'badge--open'}`, text: task.completed ? '完了' : '未完了' })],
      ['カテゴリ', el('span', { text: T.CATEGORY_LABELS[task.category] })],
      ['優先度', priorityBadge(task.priority)],
      task.category === 'work' ? ['プロジェクト', projectLabel(task.projectId) || el('span', { class: 'muted', text: '未設定' })] : null,
      ['期限', el('span', { text: D.formatDue(task, now) })],
      task.dueDate && !task.completed ? ['残り時間', remainingLabel(task, now)] : null,
      ['作成日', el('span', { text: D.formatFullDate(created) })],
    ].filter(Boolean);

    const head = el('div', { class: `detail-head ${options.closeStyle === 'x' ? 'detail-head--x' : ''}` },
      el('span', { class: 'detail-head__label', text: 'タスクの詳細' }),
      options.onClose ? el('button', {
        class: 'btn btn--icon detail-close', type: 'button',
        'aria-label': options.closeStyle === 'x' ? '詳細を閉じる' : '詳細パネルを閉じる', onclick: options.onClose,
      }, options.closeStyle === 'x' ? '×' : '›') : null);

    return el('div', { class: 'detail', role: 'region', 'aria-labelledby': titleId },
      head,
      el('h2', { class: `detail-title ${task.completed ? 'is-done' : ''}`, id: titleId, text: task.title }),
      toggleButton(task),
      el('dl', { class: 'detail-list' }, rows.map(([label, value]) => el('div', { class: 'detail-row' }, el('dt', { text: `${label}：` }), el('dd', null, value)))),
      el('section', { class: 'detail-section' },
        el('h3', { text: '詳細' }),
        task.detail ? el('p', { class: 'detail-text', text: task.detail }) : el('p', { class: 'muted', text: '詳細はありません' })),
      el('div', { class: 'detail-actions' },
        el('button', { class: 'btn btn--soft', type: 'button', text: '編集', onclick: () => openEditor({ mode: 'edit', task }) }),
        el('button', { class: 'btn btn--danger', type: 'button', text: '削除', onclick: async () => { if (await confirmDelete(task) && options.onDeleted) options.onDeleted(); } })));
  }

  /** 詳細をモーダル（スマホでは下から出る画面）で開く。データが変わったら中身を描き直す */
  let detailModal = null;
  function openDetailModal(taskId, onClose) {
    const holder = el('div', { class: 'detail-holder' });
    function draw() {
      const task = T.getTask(taskId);
      if (!task) { if (detailModal) detailModal.close(); return; }
      App.UI.clear(holder).appendChild(buildDetail(task, { onClose: () => detailModal.close(), closeStyle: 'x', onDeleted: () => detailModal && detailModal.close() }));
    }
    draw();
    const titleId = holder.querySelector('.detail-title').id;
    detailModal = openModal({
      content: holder, labelledBy: titleId, className: 'modal--detail',
      onClose: () => { detailModal = null; if (onClose) onClose(); },
    });
    return { redraw: draw, close: () => detailModal && detailModal.close() };
  }

  App.TaskDialogs = { openEditor, confirmDelete, buildDetail, openDetailModal, remainingLabel, priorityBadge, projectLabel, toggleButton, toggleWithUndo, icon };
})(window.TodoApp = window.TodoApp || {});
