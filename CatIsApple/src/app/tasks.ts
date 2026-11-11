import { FunctionComponent, useEffect, useMemo, useState } from '../component/index.js';
import { createElement } from '../element/index.js';

/** 목록에서 한 항목을 식별하고 완료 여부를 기록한다. */
interface Task {
  id: number;
  title: string;
  done: boolean;
}

/** 입력 폼이 루트에서 받는 값과 변경 요청. */
interface TaskFormProps {
  draft: string;
  onDraft: (draft: string) => void;
  onAdd: () => void;
}

/** 목록이 루트에서 받는 할 일과 항목별 변경 요청. */
interface TaskListProps {
  tasks: Task[];
  onToggle: (id: number) => void;
  onRemove: (id: number) => void;
}

const initialTasks: Task[] = [
  { id: 1, title: '샘플 HTML 수정하기', done: true },
  { id: 2, title: 'Patch로 변경 사항 반영하기', done: false },
  { id: 3, title: '이전 상태로 돌아가기', done: false },
];

/** 입력을 루트에 전달하고, 버튼과 Enter 모두 브라우저의 폼 제출로 처리한다. */
function TaskForm({ draft, onDraft, onAdd }: TaskFormProps) {
  /** 기본 탐색을 막고 루트에서 할 일을 추가하도록 요청한다. */
  function submit(event: Event) {
    event.preventDefault();
    onAdd();
  }
  return createElement('form', { class: 'task-form', onSubmit: submit },
    createElement('label', { for: 'task-title' }, '새 할 일'),
    createElement('div', { class: 'task-entry' },
      createElement('input', {
        id: 'task-title', type: 'text', value: draft, placeholder: '할 일 입력', autocomplete: 'off',
        onInput: (event: Event) => onDraft((event.currentTarget as HTMLInputElement).value),
      }),
      createElement('button', { type: 'submit', disabled: !draft.trim() }, '추가'),
    ),
  );
}

/** 루트가 계산한 완료 개수와 전체 개수를 함께 표시한다. */
function TaskCount({ completed, total }: { completed: number; total: number }) {
  return createElement('p', { class: 'task-count', 'aria-live': 'polite' }, `완료 ${completed}개 / 전체 ${total}개`);
}

/** 각 항목을 체크박스와 삭제 버튼으로 표시하고 조작한 항목의 ID를 루트에 전달한다. */
function TaskList({ tasks, onToggle, onRemove }: TaskListProps) {
  if (!tasks.length) return createElement('p', { class: 'task-empty' }, '등록된 할 일이 없습니다.');

  return createElement('ul', { class: 'task-list' }, tasks.map(task =>
    createElement('li', { key: task.id, class: 'task-row' },
      createElement('label', { class: 'task-name' },
        createElement('input', {
          type: 'checkbox', checked: task.done, onChange: () => onToggle(task.id),
        }),
        createElement('span', null, task.title),
      ),
      createElement('button', {
        type: 'button', class: 'task-remove', 'aria-label': `${task.title} 삭제`,
        onClick: () => onRemove(task.id),
      }, '삭제'),
    ),
  ));
}

/** 루트의 상태로 할 일 페이지를 마운트하고, 호출자가 정리할 수 있게 인스턴스를 반환한다. */
export function mountTasks(container: HTMLElement): FunctionComponent {
  const page = container.ownerDocument;

  /** 입력과 목록 상태를 소유하고 두 상태를 사용하는 자식들에게 값과 콜백을 전달한다. */
  function App() {
    const [draft, setDraft] = useState('');
    const [tasks, setTasks] = useState(initialTasks);
    const completed = useMemo(() => tasks.filter(task => task.done).length, [tasks]);
    const remaining = tasks.length - completed;

    useEffect(() => {
      const previousTitle = page.title;
      page.title = `남은 할 일 ${remaining}개 · Reactify`;
      return () => { page.title = previousTitle; };
    }, [remaining]);

    /** 빈 입력을 제외하고 새 항목을 추가한 뒤 입력을 비운다. */
    function addTask() {
      const title = draft.trim();
      if (!title) return;
      setTasks(current => [...current, { id: (current.at(-1)?.id ?? 0) + 1, title, done: false }]);
      setDraft('');
    }

    return createElement('div', { class: 'task-app' },
      createElement(TaskForm, { draft, onDraft: setDraft, onAdd: addTask }),
      createElement(TaskCount, { completed, total: tasks.length }),
      createElement(TaskList, {
        tasks,
        onToggle: (id: number) => setTasks(current => current.map(task =>
          task.id === id ? { ...task, done: !task.done } : task)),
        onRemove: (id: number) => setTasks(current => current.filter(task => task.id !== id)),
      }),
    );
  }

  const root = new FunctionComponent(container, App);
  root.mount();
  return root;
}
