import { h, FunctionComponent, useState, useMemo, useEffect } from '../core/index.ts';
import type { Fiber, VNode } from '../core/index.ts';
import { mustQuery, inputValue } from '../shared/dom.ts';
import { setupExecution } from './execution.ts';

interface Task {
  id: string;
  title: string;
  category: string;
  done: boolean;
}
interface TaskRowProps {
  task: Task;
  recent: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}
interface BoardRender {
  tasks: Task[];
  draft: string;
  feedback: string;
  visible: number;
  completed: number;
  batchResult: string;
}
interface BoardCommit extends BoardRender {
  memoRuns: number;
  effectRuns: number;
  commits: number;
}
type Filter = 'all' | 'active' | 'done';
const filters: [Filter, string][] = [
  ['all', '전체'],
  ['active', '진행 중'],
  ['done', '완료'],
];

function isTask(value: unknown): value is Task {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'done' in value &&
    typeof value.done === 'boolean' &&
    'category' in value &&
    typeof value.category === 'string'
  );
}

const STORAGE = 'fiber-lab-tasks-v1';
const initialTasks: Task[] = [
  { id: 'vdom', title: 'DOM에서 Virtual DOM 추출하기', category: 'ENGINE', done: true },
  { id: 'diff', title: '다섯 가지 Diff 케이스 구현하기', category: 'ENGINE', done: true },
  { id: 'fiber', title: 'Fiber 작업 루프 연결하기', category: 'ARCHITECTURE', done: false },
  { id: 'hooks', title: '나만의 Hooks 완성하기', category: 'HOOKS', done: false },
];

function loadTasks(): Task[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    if (
      Array.isArray(saved) &&
      saved.length <= 500 &&
      saved.every(isTask) &&
      new Set(saved.map((t) => t.id)).size === saved.length
    )
      return saved;
  } catch {
    /* Storage may be unavailable; the board remains usable in memory. */
  }
  return initialTasks.map((task) => ({ ...task }));
}

// Children are pure functions of props. All hooks below belong to Board only.
function TaskRow({ task, recent, onToggle, onDelete }: TaskRowProps): VNode {
  return h(
    'li',
    {
      className: ['task-row', task.done && 'task-done', recent && 'task-recent']
        .filter(Boolean)
        .join(' '),
      'data-task-id': task.id,
    },
    h(
      'button',
      {
        className: 'task-checkbox',
        'aria-label': `${task.title} ${task.done ? '미완료로' : '완료로'} 변경`,
        'aria-pressed': task.done,
        onClick: () => onToggle(task.id),
      },
      task.done ? '✓' : '',
    ),
    h(
      'div',
      { className: 'task-copy' },
      h('span', { className: 'task-title' }, task.title),
      h('small', {}, task.category),
    ),
    h(
      'span',
      { className: `task-status ${task.done ? 'done' : ''}` },
      task.done ? '완료' : '진행 중',
    ),
    h('span', { className: 'task-new', hidden: !recent }, '새 작업'),
    h(
      'button',
      {
        className: 'delete-task',
        'aria-label': `${task.title} 삭제`,
        onClick: () => onDelete(task.id),
      },
      '×',
    ),
  );
}

function ProgressCard({ completed, total }: { completed: number; total: number }): VNode {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return h(
    'aside',
    { className: 'progress-card' },
    h('h3', {}, `완료 ${completed} / ${total}`),
    h('div', { className: 'progress-number' }, String(percent), h('span', {}, '%')),
    h(
      'div',
      {
        className: 'progress-track',
        role: 'progressbar',
        'aria-label': '작업 완료율',
        'aria-valuenow': percent,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
      },
      h('div', { style: { width: `${percent}%` } }),
    ),
  );
}

export function setupBoard() {
  const diagnostics = { memoRuns: 0, effectRuns: 0, cleanupRuns: 0, storage: '저장 준비' };
  const showExecution = setupExecution();
  let lastAddedId: string | undefined;
  let rendered: BoardRender;
  let previousCommit: BoardCommit | undefined;
  function Board(): VNode {
    const [tasks, setTasks] = useState(loadTasks);
    const [draft, setDraft] = useState('');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [batchCount, setBatchCount] = useState(0);
    const [feedback, setFeedback] = useState('작업을 추가하거나 완료해 보세요.');
    const derived = useMemo(() => {
      diagnostics.memoRuns++;
      return {
        completed: tasks.filter((task) => task.done).length,
        visible: tasks.filter(
          (task) =>
            task.title.toLowerCase().includes(query.toLowerCase()) &&
            (filter === 'all' || (filter === 'done' ? task.done : !task.done)),
        ),
      };
    }, [tasks, query, filter]);
    useEffect(() => {
      diagnostics.effectRuns++;
      try {
        localStorage.setItem(STORAGE, JSON.stringify(tasks));
        diagnostics.storage = '브라우저에 저장됨';
      } catch {
        diagnostics.storage = '메모리에서 동작 중';
      }
      const previousTitle = document.title;
      document.title = `Fiber Lab · ${tasks.filter((task) => !task.done).length} tasks left`;
      return () => {
        diagnostics.cleanupRuns++;
        document.title = previousTitle;
      };
    }, [tasks]);
    const counter = instance.draftHooks.find(
      (hook) => hook.kind === 'state' && hook.setState === setBatchCount,
    );
    const requests = counter?.kind === 'state' ? counter.consumed : 0;
    // The counter and the result are patched together from this render.
    const batchResult = requests
      ? `상태 변경 요청 ${requests}개 · 커밋 1회`
      : (previousCommit?.batchResult ?? '');
    const addTask = (event: SubmitEvent): void => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const title = mustQuery<HTMLInputElement>('#new-task', form).value.trim();
      if (!title) {
        setFeedback('작업 이름을 입력해 주세요.');
        return;
      }
      if (tasks.length >= 500) {
        setFeedback('최대 500개까지 저장할 수 있습니다.');
        return;
      }
      const task = { id: crypto.randomUUID(), title, category: 'MY TASK', done: false };
      lastAddedId = task.id;
      setTasks((previous) => (previous.length < 500 ? [...previous, task] : previous));
      setDraft('');
      setFeedback('새 작업을 추가했습니다.');
    };
    rendered = {
      tasks,
      draft,
      feedback,
      visible: derived.visible.length,
      completed: derived.completed,
      batchResult,
    };
    return h(
      'div',
      { className: 'board' },
      h(
        'div',
        { className: 'board-grid' },
        h(
          'section',
          { className: 'panel task-panel' },
          h(
            'div',
            { className: 'board-heading' },
            h('div', {}, h('h2', {}, 'Hooks 작업 보드')),
            h('span', { className: 'count-badge' }, `작업 ${tasks.length}개`),
          ),
          h(
            'form',
            { className: 'add-form', onSubmit: addTask },
            h('input', {
              id: 'new-task',
              'aria-label': '새 작업',
              placeholder: '새 작업 입력',
              value: draft,
              maxLength: 120,
              onInput: (event) => setDraft(inputValue(event)),
            }),
            h('button', { type: 'submit', className: 'primary-button' }, '+ 추가'),
          ),
          h(
            'div',
            { className: 'task-tools' },
            h(
              'div',
              { className: 'filter-tabs', role: 'group', 'aria-label': '작업 필터' },
              ...filters.map(([value, label]) =>
                h(
                  'button',
                  {
                    key: value,
                    className: filter === value ? 'active' : '',
                    'aria-pressed': filter === value,
                    onClick: () => setFilter(value),
                  },
                  label,
                ),
              ),
            ),
            h('input', {
              className: 'search-input',
              type: 'search',
              'aria-label': '작업 검색',
              placeholder: '작업 검색…',
              value: query,
              onInput: (event) => setQuery(inputValue(event)),
            }),
          ),
          h(
            'ul',
            { className: 'task-list' },
            ...derived.visible.map((task) =>
              h(TaskRow, {
                key: task.id,
                task,
                recent: task.id === lastAddedId,
                onToggle: (id) =>
                  setTasks((previous) =>
                    previous.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
                  ),
                onDelete: (id) => {
                  setTasks((previous) => previous.filter((item) => item.id !== id));
                  setFeedback('작업을 삭제했습니다.');
                },
              }),
            ),
          ),
          derived.visible.length === 0
            ? h('div', { className: 'board-empty' }, '조건에 맞는 작업이 없습니다.')
            : null,
          h(
            'div',
            { className: 'board-bottom' },
            h('span', { role: 'status' }, feedback),
            h(
              'button',
              {
                className: 'text-button',
                onClick: () => setTasks((previous) => [...previous].reverse()),
                disabled: tasks.length < 2,
              },
              '순서 뒤집기 ↕',
            ),
          ),
        ),
        h(ProgressCard, { completed: derived.completed, total: tasks.length }),
      ),
      h(
        'section',
        { className: 'batch-card' },
        h(
          'div',
          {},
          h('h3', {}, '배칭 예제'),
          h(
            'p',
            { id: 'batch-result', role: 'status', className: batchResult ? 'batch-result' : '' },
            batchResult || '+1 요청을 모아서 커밋 횟수와 비교해 보세요.',
          ),
        ),
        h(
          'div',
          { className: 'batch-control' },
          h('output', { id: 'batch-value', 'aria-label': '배칭 카운터' }, String(batchCount)),
          h(
            'button',
            {
              className: 'dark-button',
              onClick: () => {
                setBatchCount((n) => n + 1);
                setBatchCount((n) => n + 1);
                setBatchCount((n) => n + 1);
              },
            },
            '+3 한 번에',
          ),
        ),
      ),
    );
  }
  const instance = new FunctionComponent(
    Board,
    {},
    {
      onCommit(metrics) {
        const current: BoardCommit = {
          ...rendered,
          memoRuns: diagnostics.memoRuns,
          effectRuns: diagnostics.effectRuns,
          commits: metrics.commits,
        };
        const previous = previousCommit;
        previousCommit = current;
        const oldIds =
          previous && previous.tasks !== current.tasks
            ? new Set(previous.tasks.map((task) => task.id))
            : null;
        const added = oldIds ? current.tasks.filter((task) => !oldIds.has(task.id)) : [];
        const lastAdded = added.at(-1);
        let addedRow: Fiber | undefined;
        const stats = mustQuery('#fiber-stats');
        const items: [string, string | number][] = [
          ['COMMITS', metrics.commits],
          ['FIBER UNITS', metrics.units],
          ['YIELDS', metrics.yields],
          ['PATCH OPS', metrics.operations.length],
          ['MEMO 계산', diagnostics.memoRuns],
          ['EFFECT / CLEANUP', `${diagnostics.effectRuns} / ${diagnostics.cleanupRuns}`],
        ];
        stats.replaceChildren(
          ...items.map(([label, value]) => {
            const node = document.createElement('div');
            const title = document.createElement('small');
            title.textContent = label;
            const number = document.createElement('strong');
            number.textContent = String(value);
            node.append(title, number);
            return node;
          }),
        );
        stats.title = `${diagnostics.storage} · Commit ${metrics.commitMs.toFixed(2)}ms`;
        const lines = [];
        const stack: [Fiber, number][] = [[metrics.root, 0]];
        while (stack.length) {
          const [fiber, depth] = stack.pop()!;
          if (lastAdded && fiber.type === TaskRow && fiber.key === lastAdded.id) addedRow = fiber;
          lines.push(
            `${'  '.repeat(depth)}${typeof fiber.type === 'function' ? fiber.type.name : fiber.type}${fiber.key == null ? '' : ` [key=${fiber.key}]`}${fiber.alternate ? ' ↔ alternate' : ' + new'}`,
          );
          if (fiber.sibling) stack.push([fiber.sibling, depth]);
          if (fiber.child) stack.push([fiber.child, depth + 1]);
        }
        mustQuery('#fiber-tree').textContent = lines.join('\n');
        if (!previous || !lastAdded) return;
        const commitSummary = `COMMITS ${previous.commits} → ${current.commits}`;
        const memo = current.memoRuns - previous.memoRuns;
        const effects = current.effectRuns - previous.effectRuns;
        const rowTask = addedRow?.vnode.props.task;
        const row = addedRow?.dom?.isConnected && isTask(rowTask) ? rowTask : undefined;
        const draftChange = current.draft === '' ? '입력칸 비움' : '입력값 유지';
        showExecution({
          summary: `“${lastAdded.title}” · ${commitSummary}`,
          steps: [
            {
              phase: 'render',
              title: 'useState',
              detail: `작업 ${previous.tasks.length} → ${current.tasks.length}개 · ${draftChange} · ${current.feedback}`,
            },
            {
              phase: 'render',
              title: 'useMemo',
              detail: `${memo ? '표시할 목록과 완료 수를 다시 계산' : '이전 계산 결과를 재사용'} · 표시 ${current.visible}개 · 완료 ${current.completed}개`,
            },
            {
              phase: 'render',
              title: 'Props',
              detail: row
                ? `TaskRow에 “${row.title}” 전달 · ${row.done ? '완료' : '미완료'}`
                : '검색 또는 필터 조건에 맞지 않아 새 작업을 TaskRow에 전달하지 않았어요.',
            },
            {
              phase: 'patch',
              title: 'Diff · Patch',
              detail: row
                ? '새 작업 행을 실제 DOM에 추가했어요.'
                : '현재 목록에는 새 행을 추가하지 않았어요.',
              operations: metrics.operations,
            },
            {
              phase: 'effect',
              title: 'useEffect',
              detail: effects
                ? `DOM 반영 후 실행 ${effects}회 · ${diagnostics.storage} · 탭 제목 갱신`
                : '의존성이 유지되어 다시 실행하지 않았어요.',
            },
          ],
        });
      },
      onError(error) {
        const box = mustQuery('#hooks-error');
        box.hidden = false;
        box.textContent = error.message;
      },
    },
  ).mount(mustQuery('#hooks-app'));
  const toggle = mustQuery<HTMLButtonElement>('#toggle-fiber');
  toggle.addEventListener('click', () => {
    const tree = mustQuery('#fiber-tree');
    tree.hidden = !tree.hidden;
    toggle.textContent = tree.hidden ? '트리 펼치기 ↓' : '트리 접기 ↑';
    toggle.setAttribute('aria-expanded', String(!tree.hidden));
  });
  return instance;
}
