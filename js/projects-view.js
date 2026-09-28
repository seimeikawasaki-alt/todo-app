/**
 * プロジェクト管理画面
 * - プロジェクトの一覧（作成した順）：タスク数・進み具合・期限切れ・操作
 * - 作成・編集（名前と色）、アーカイブ／元に戻す、削除（タスクは削除せず「プロジェクト未設定」に戻す）
 * - 「タスクを見る ›」：リスト画面をそのプロジェクトで絞り込んだ状態で開く
 */
(function (App) {
  'use strict';

  const { el, icon, clear, openModal, confirmDialog, toast } = App.UI;
  const T = App.Tasks;
  const D = App.DateUtils;

  let root = null;
  let uid = 0;

  function mount(container) {
    root = container;
  }

  function stats(project, now) {
    const list = T.getData().tasks.filter((t) => t.projectId === project.id);
    const done = list.filter((t) => t.completed).length;
    const overdue = list.filter((t) => D.isOverdue(t, now)).length;
    return { total: list.length, done, open: list.length - done, overdue, rate: list.length ? Math.round((done / list.length) * 100) : 0 };
  }

  function render() {
    const now = new Date();
    const projects = T.getData().projects.slice().sort((a, b) => a.createdAt - b.createdAt);
    const active = projects.filter((p) => !p.archived);
    const archived = projects.filter((p) => p.archived);

    clear(root);
    root.append(el('div', { class: 'page-head page-head--projects' },
      el('div', null,
        el('h1', { class: 'page-title', text: 'プロジェクト' }),
        el('p', { class: 'page-lead', text: 'プロジェクトは、カテゴリが「仕事」のタスクに設定できます' })),
      el('button', { class: 'btn btn--primary', type: 'button', onclick: () => openEditor(null) }, icon('plus'), '新しいプロジェクト')));

    if (!projects.length) {
      root.append(el('div', { class: 'card empty' }, icon('folder'), el('strong', { text: 'プロジェクトはまだありません' }),
        el('span', { text: 'カテゴリが「仕事」のタスクを、プロジェクトごとにまとめられます' }),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: () => openEditor(null) }, icon('plus'), '新しいプロジェクト')));
      return;
    }

    root.append(el('section', { class: 'card section', 'aria-labelledby': 'active-projects' },
      el('h2', { class: 'section-title', id: 'active-projects' }, '現在のプロジェクト', el('span', { class: 'count', text: `（${active.length}件・作成した順）` })),
      active.length ? projectTable(active, now, false) : el('p', { class: 'muted', text: '現在のプロジェクトはありません' })));

    if (archived.length) {
      root.append(el('details', { class: 'card section archive' },
        el('summary', null, 'アーカイブしたプロジェクト', el('span', { class: 'count', text: `（${archived.length}件）` })),
        projectTable(archived, now, true),
        el('p', { class: 'page-lead small-note', text: 'アーカイブしたプロジェクトは、タスクの登録・編集のときの選択欄に表示されません。' })));
    }
  }

  function projectTable(list, now, isArchive) {
    return el('table', { class: 'project-table' },
      el('thead', null, el('tr', null,
        el('th', { class: 'col-name', scope: 'col', text: 'プロジェクト名' }),
        el('th', { class: 'col-tasks', scope: 'col', text: 'タスク数' }),
        el('th', { class: 'col-progress', scope: 'col', text: '進み具合' }),
        el('th', { class: 'col-overdue', scope: 'col', text: '期限切れ' }),
        el('th', { scope: 'col', class: 'col-actions', text: '操作' }))),
      el('tbody', null, list.map((p) => {
        const s = stats(p, now);
        const name = p.name;
        const actions = isArchive
          ? [el('button', { class: 'btn btn--small btn--soft', type: 'button', 'aria-label': `「${name}」を元に戻す`, text: '元に戻す', onclick: () => { T.updateProject(p.id, { archived: false }); toast(`「${name}」を元に戻しました`); } }),
            el('button', { class: 'btn btn--small btn--danger-outline', type: 'button', 'aria-label': `「${name}」を削除`, text: '削除', onclick: () => remove(p, s) })]
          : [el('button', { class: 'btn btn--small btn--link', type: 'button', 'aria-label': `リストで「${name}」のタスクを見る`, onclick: () => toList(p.id) }, 'タスクを見る ›'),
            el('button', { class: 'btn btn--small btn--soft', type: 'button', 'aria-label': `「${name}」を編集`, text: '編集', onclick: () => openEditor(p) }),
            el('button', { class: 'btn btn--small', type: 'button', 'aria-label': `「${name}」をアーカイブ`, text: 'アーカイブ', onclick: () => { T.updateProject(p.id, { archived: true }); toast(`「${name}」をアーカイブしました`); } }),
            el('button', { class: 'btn btn--small btn--danger-outline', type: 'button', 'aria-label': `「${name}」を削除`, text: '削除', onclick: () => remove(p, s) })];
        return el('tr', { class: `pc-${p.color}` },
          el('td', { class: 'cell-name' }, el('h3', { class: 'project-name', text: name })),
          el('td', { class: 'tasks', 'data-label': 'タスク数' }, el('strong', { text: `${s.total}件` }), el('span', { text: `完了 ${s.done} / 未完了 ${s.open}` })),
          el('td', { class: 'cell-progress', 'data-label': '進み具合' },
            el('div', { class: 'progress' }, el('div', { class: 'bar', role: 'img', 'aria-label': `進み具合${s.rate}%` }, el('i', { style: { width: `${s.rate}%` } })), el('b', { text: `${s.rate}%` }))),
          el('td', { class: `cell-overdue ${s.overdue ? 'has-overdue' : ''}` },
            s.overdue ? el('span', { class: 'overdue', text: `⚠ 期限切れ ${s.overdue}件` })
              : s.total && s.done === s.total ? el('span', { class: 'done-all', text: '✓ すべて完了' })
                : el('span', { class: 'none', text: '期限切れ なし' })),
          el('td', { class: 'cell-actions' }, el('div', { class: 'actions' }, actions)));
      })));
  }

  function toList(projectId) {
    App.showView('list', { filters: { status: 'all', category: 'work', projectId, due: '', keyword: '' } });
  }

  async function remove(project, s) {
    const ok = await confirmDialog({
      title: 'このプロジェクトを削除しますか？',
      message: s.total
        ? `「${project.name}」を削除します。${s.total}件のタスクは削除されず、プロジェクト未設定になります。`
        : `「${project.name}」を削除します。`,
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;
    const S = App.State;
    if (S.filters.projectId === project.id) S.filters.projectId = '';
    T.deleteProject(project.id);
    toast(`「${project.name}」を削除しました`);
  }

  /** 作成・編集のモーダル（project が null なら作成） */
  function openEditor(project) {
    uid += 1;
    const titleId = `project-editor-${uid}`;
    let modal = null;
    const nameInput = el('input', {
      class: 'control', id: `${titleId}-name`, type: 'text', maxlength: '40', placeholder: '例）営業資料の刷新', 'aria-required': 'true', 'aria-describedby': `${titleId}-err`,
    });
    nameInput.value = project ? project.name : '';
    const error = el('p', { class: 'error-text', id: `${titleId}-err`, hidden: true });
    const current = project ? project.color : 'blue';
    const colors = el('fieldset', { class: 'colors' }, el('legend', { class: 'field__label', text: '色' }),
      Object.entries(T.PROJECT_COLORS).map(([key, label]) => el('label', { class: 'swatch' },
        el('input', { type: 'radio', name: `${titleId}-color`, value: key, checked: key === current }),
        el('i', { class: `pc-${key}`, 'aria-hidden': 'true' }), label)));

    function submit() {
      const message = T.validateProjectName(nameInput.value, project && project.id);
      error.hidden = !message;
      error.textContent = message ? `⚠ ${message}` : '';
      nameInput.classList.toggle('control--error', !!message);
      nameInput.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message) { nameInput.focus(); return; }
      const color = colors.querySelector('input:checked').value;
      if (project) { T.updateProject(project.id, { name: nameInput.value, color }); toast('プロジェクトを更新しました'); }
      else { T.addProject(nameInput.value, color); toast('プロジェクトを追加しました'); }
      modal.close();
    }

    const content = el('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
      el('div', { class: 'dialog-title' },
        el('h2', { id: titleId, text: project ? 'プロジェクトを編集' : 'プロジェクトを作成' }),
        el('button', { class: 'btn btn--icon', type: 'button', 'aria-label': '閉じる', onclick: () => modal.close() }, '×')),
      el('div', { class: 'editor__body' },
        el('div', { class: 'field' }, el('label', { class: 'field__label', for: `${titleId}-name` }, 'プロジェクト名', el('span', { class: 'required', 'aria-hidden': 'true', text: ' ＊' })), nameInput, error),
        colors),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', text: 'キャンセル', onclick: () => modal.close() }),
        el('button', { class: 'btn btn--primary', type: 'submit', text: '保存' })));
    modal = openModal({ content, labelledBy: titleId, className: 'modal--editor', initialFocus: nameInput });
  }

  App.ProjectsView = { mount, render };
})(window.TodoApp = window.TodoApp || {});
