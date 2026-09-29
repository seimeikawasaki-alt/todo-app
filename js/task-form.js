/**
 * タスクの入力欄（登録フォーム・編集モーダル・スマホの登録画面で共通）
 *
 * createTaskFields(options) で入力欄をまとめて作り、
 * getValues() / setValues() / showErrors() / reset() で操作する。
 */
(function (App) {
  'use strict';

  const { el } = App.UI;
  const D = App.DateUtils;
  const T = App.Tasks;

  let uid = 0;

  function field(labelText, control, { required = false, hint = null, error = null, id } = {}) {
    return el('div', { class: 'field' },
      el('label', { class: 'field__label', for: id }, labelText, required ? el('span', { class: 'required', 'aria-hidden': 'true', text: ' ＊' }) : null),
      control, hint, error);
  }

  function select(id, options, value) {
    return el('select', { class: 'control', id }, options.map(([v, label]) => el('option', { value: v, selected: v === value, text: label })));
  }

  /**
   * options: { layout: 'inline' | 'stacked', weekStart: () => 設定値 }
   */
  function createTaskFields(options) {
    uid += 1;
    const p = `tf${uid}`;
    const state = { dueDate: '' };

    /* --- タスク名 --- */
    const titleInput = el('input', {
      class: 'control', id: `${p}-title`, type: 'text', maxlength: '100', autocomplete: 'off',
      placeholder: '例）企画書を作成する', 'aria-required': 'true', 'aria-describedby': `${p}-title-error`,
    });
    const titleError = el('p', { class: 'error-text', id: `${p}-title-error`, hidden: true });
    // Enter キーでは登録しない（押し間違いで登録されるのを防ぐため。登録は「追加」「保存」ボタンで行う）
    // フォームの中の入力欄で Enter を押すと、ブラウザが自動で送信するため、それを止める
    // （日本語入力の変換を確定する Enter は、文字の確定に使うのでそのままにする）
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) e.preventDefault();
    });
    titleInput.addEventListener('input', () => { if (titleInput.value.trim()) setError(titleInput, titleError, ''); });

    /* --- 期限（自作のカレンダー） --- */
    const dateText = el('span', { class: 'date-trigger__text', text: '日付を選ぶ' });
    const dateButton = el('button', {
      class: 'control date-trigger', id: `${p}-date`, type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    }, dateText, App.UI.icon('calendar'));
    dateButton.addEventListener('click', () => {
      App.Datepicker.open(dateButton, {
        value: state.dueDate,
        weekStart: options.weekStart ? options.weekStart() : 'sun',
        onSelect: (value) => setDate(value),
      });
    });

    /* --- 時刻（時・分のプルダウン） --- */
    const hourSelect = select(`${p}-hour`, [['', '--時'], ...Array.from({ length: 24 }, (_, h) => [D.pad2(h), `${h}時`])], '');
    const minuteSelect = select(`${p}-minute`, [['', '--分'], ['00', '00分'], ['15', '15分'], ['30', '30分'], ['45', '45分']], '');
    hourSelect.setAttribute('aria-label', '時');
    minuteSelect.setAttribute('aria-label', '分');
    hourSelect.addEventListener('change', () => { if (hourSelect.value && !minuteSelect.value) minuteSelect.value = '00'; if (!hourSelect.value) minuteSelect.value = ''; });
    minuteSelect.addEventListener('change', () => { if (minuteSelect.value && !hourSelect.value) hourSelect.value = '09'; if (!minuteSelect.value) hourSelect.value = ''; });
    const timeHint = el('p', { class: 'hint', text: '※期限を選ぶと設定できます' });
    const timeGroup = el('div', { class: 'time-selects', role: 'group', 'aria-labelledby': `${p}-time-label` }, hourSelect, el('span', { 'aria-hidden': 'true', text: ':' }), minuteSelect);

    /* --- カテゴリ・優先度 --- */
    const categorySelect = select(`${p}-category`, Object.entries(T.CATEGORY_LABELS), 'other');
    const prioritySelect = select(`${p}-priority`, Object.entries(T.PRIORITY_LABELS), 'medium');

    /* --- プロジェクト（カテゴリが「仕事」のときだけ選べる） --- */
    const projectSelect = el('select', { class: 'control', id: `${p}-project` });
    const projectHint = el('p', { class: 'hint', text: '※カテゴリが「仕事」のときに選べます' });
    const newProjectInput = el('input', { class: 'control', type: 'text', maxlength: '40', placeholder: '新しいプロジェクト名', 'aria-label': '新しいプロジェクト名', 'aria-describedby': `${p}-np-error` });
    const newProjectError = el('p', { class: 'error-text', id: `${p}-np-error`, hidden: true });
    const newProjectBox = el('div', { class: 'new-project', hidden: true },
      el('div', { class: 'new-project__row' }, newProjectInput,
        el('button', { class: 'btn btn--primary btn--small', type: 'button', text: '追加', onclick: addNewProject }),
        el('button', { class: 'btn btn--small', type: 'button', text: 'キャンセル', onclick: cancelNewProject })),
      newProjectError);
    newProjectInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); addNewProject(); }
    });

    function renderProjectOptions(selectedId) {
      const projects = T.activeProjects();
      const current = selectedId && T.getProject(selectedId);
      // アーカイブ済みのプロジェクトが設定されているタスクを編集するときは、その選択肢も残す
      const list = current && current.archived ? [...projects, current] : projects;
      App.UI.clear(projectSelect);
      projectSelect.append(
        el('option', { value: '', text: projects.length ? '選択しない' : 'プロジェクトはまだありません' }),
        ...list.map((pr) => el('option', { value: pr.id, selected: pr.id === selectedId, text: `${pr.name}${pr.archived ? '（アーカイブ済み）' : ''}` })),
        el('option', { value: '__new__', text: '＋ 新しいプロジェクト' }),
      );
      projectSelect.value = selectedId && list.some((pr) => pr.id === selectedId) ? selectedId : '';
    }

    function syncProjectEnabled() {
      const isWork = categorySelect.value === 'work';
      projectSelect.disabled = !isWork;
      projectHint.hidden = isWork;
      if (!isWork) { projectSelect.value = ''; newProjectBox.hidden = true; }
    }

    projectSelect.addEventListener('change', () => {
      if (projectSelect.value === '__new__') {
        newProjectBox.hidden = false;
        newProjectInput.value = '';
        setError(newProjectInput, newProjectError, '');
        newProjectInput.focus();
      } else {
        newProjectBox.hidden = true;
      }
    });
    categorySelect.addEventListener('change', syncProjectEnabled);

    function addNewProject() {
      const message = T.validateProjectName(newProjectInput.value);
      if (message) { setError(newProjectInput, newProjectError, message); newProjectInput.focus(); return; }
      const project = T.addProject(newProjectInput.value, 'blue');
      renderProjectOptions(project.id);
      newProjectBox.hidden = true;
      projectSelect.focus();
      App.UI.toast(`プロジェクト「${project.name}」を追加しました`);
    }
    function cancelNewProject() {
      newProjectBox.hidden = true;
      projectSelect.value = '';
      projectSelect.focus();
    }

    /* --- 詳細 --- */
    const detailInput = el('textarea', { class: 'control', id: `${p}-detail`, rows: '3', maxlength: '1000', placeholder: 'タスクの詳細を入力（任意）' });

    function setDate(value) {
      state.dueDate = value || '';
      dateText.textContent = value ? D.formatInputDate(value) : '日付を選ぶ';
      dateButton.classList.toggle('has-value', !!value);
      dateButton.setAttribute('aria-label', `期限：${value ? D.formatInputDate(value) : '未設定'}。押すとカレンダーが開きます`);
      hourSelect.disabled = !value;
      minuteSelect.disabled = !value;
      timeHint.hidden = !!value;
      if (!value) { hourSelect.value = ''; minuteSelect.value = ''; }
    }

    function setError(input, box, message) {
      box.hidden = !message;
      box.textContent = message ? `⚠ ${message}` : '';
      input.classList.toggle('control--error', !!message);
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    /* --- 組み立て --- */
    const titleField = field('タスク名', titleInput, { required: true, error: titleError, id: `${p}-title` });
    const dateField = field('期限', dateButton, { id: `${p}-date` });
    const timeField = el('div', { class: 'field' }, el('span', { class: 'field__label', id: `${p}-time-label`, text: '時刻' }), timeGroup, timeHint);
    const categoryField = field('カテゴリ', categorySelect, { id: `${p}-category` });
    const priorityField = field('優先度', prioritySelect, { id: `${p}-priority` });
    const projectField = el('div', { class: 'field' }, el('label', { class: 'field__label', for: `${p}-project`, text: 'プロジェクト' }), projectSelect, projectHint, newProjectBox);
    const detailField = field('詳細', detailInput, { id: `${p}-detail` });

    titleField.classList.add('field--title');

    renderProjectOptions('');
    syncProjectEnabled();
    setDate('');

    return {
      fields: { titleField, dateField, timeField, categoryField, priorityField, projectField, detailField },
      titleInput,
      getValues() {
        const time = hourSelect.value && minuteSelect.value ? `${hourSelect.value}:${minuteSelect.value}` : '';
        return {
          title: titleInput.value,
          detail: detailInput.value,
          dueDate: state.dueDate,
          dueTime: state.dueDate ? time : '',
          category: categorySelect.value,
          priority: prioritySelect.value,
          projectId: projectSelect.value === '__new__' ? '' : projectSelect.value,
        };
      },
      setValues(v) {
        titleInput.value = v.title || '';
        detailInput.value = v.detail || '';
        categorySelect.value = v.category || 'other';
        prioritySelect.value = v.priority || 'medium';
        renderProjectOptions(v.projectId || '');
        syncProjectEnabled();
        setDate(v.dueDate || '');
        const time = D.parseTime(v.dueTime);
        if (time) {
          hourSelect.value = D.pad2(time.h);
          // 15分刻み以外の時刻が保存されていた場合も、その値を選択肢に加えて保持する
          const mm = D.pad2(time.m);
          if (![...minuteSelect.options].some((o) => o.value === mm)) minuteSelect.append(el('option', { value: mm, text: `${mm}分` }));
          minuteSelect.value = mm;
        }
      },
      showErrors(errors) {
        setError(titleInput, titleError, errors.title || '');
        if (errors.title) titleInput.focus();
      },
      /** 登録後：タスク名・詳細・期限・時刻だけを空にし、カテゴリなどの選択は残す（続けて登録しやすくするため） */
      resetAfterAdd() {
        titleInput.value = '';
        detailInput.value = '';
        setDate('');
        setError(titleInput, titleError, '');
        titleInput.focus();
      },
      refreshProjects() {
        // 新しいプロジェクト名を入力している途中なら、選択欄と入力欄をそのまま残す
        const creating = projectSelect.value === '__new__';
        renderProjectOptions(creating ? '' : projectSelect.value);
        if (creating) projectSelect.value = '__new__';
        syncProjectEnabled();
      },
    };
  }

  App.TaskForm = { createTaskFields };
})(window.TodoApp = window.TodoApp || {});
