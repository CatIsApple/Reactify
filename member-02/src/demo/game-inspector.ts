import type { PatchOperation, VNode } from '../core/index.ts';
import { mustQuery } from '../shared/dom.ts';

interface ValueChange {
  field: string;
  before: string;
  after: string;
}

interface PatchChange {
  type: PatchOperation['type'];
  path: string;
  field: string;
  values?: Pick<ValueChange, 'before' | 'after'>;
}

interface GameCommit {
  number: number;
  action: string;
  stateRequests: number;
  state: ValueChange[];
  props: ValueChange[];
  effect?: string;
  patches: PatchChange[];
}

function nodeAt(root: VNode | null, path: string): VNode | undefined {
  let node = root ?? undefined;
  for (const part of path.split('.').slice(1)) node = node?.children[Number(part)];
  return node;
}

function display(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'function') return 'ƒ';
  return JSON.stringify(value) ?? String(value);
}

export function capturePatches(
  operations: readonly PatchOperation[],
  before: VNode | null,
  after: VNode | null,
): PatchChange[] {
  return operations.map(({ type, path, detail }) => {
    const field = type === 'TEXT' ? 'nodeValue' : detail;
    const values =
      type === 'TEXT' || type === 'PROPS'
        ? {
            before: display(nodeAt(before, path)?.props[field]),
            after: display(nodeAt(after, path)?.props[field]),
          }
        : undefined;
    return { type, path, field, values };
  });
}

function code(text: string, className = ''): HTMLElement {
  const element = document.createElement('code');
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function changeValue({ before, after }: Pick<ValueChange, 'before' | 'after'>): HTMLElement {
  const values = document.createElement('span');
  values.className = 'inspector-values';
  values.append(code(before, 'inspector-before'), ' → ', code(after, 'inspector-after'));
  return values;
}

function valueGroup(title: string, changes: ValueChange[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'inspector-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  group.append(heading);
  if (!changes.length) {
    const empty = document.createElement('p');
    empty.textContent = '변경 없음';
    group.append(empty);
  } else {
    const rows = document.createElement('dl');
    for (const change of changes) {
      const field = document.createElement('dt');
      const value = document.createElement('dd');
      field.append(code(change.field));
      value.append(changeValue(change));
      rows.append(field, value);
    }
    group.append(rows);
  }
  return group;
}

export function setupGameInspector() {
  const toggle = mustQuery<HTMLButtonElement>('#game-inspector-toggle');
  const label = mustQuery('#game-inspector-toggle-label');
  const panel = mustQuery('#game-inspector');
  const close = mustQuery<HTMLButtonElement>('#game-inspector-close');
  const stateTab = mustQuery('#game-phase-state');
  const domTab = mustQuery('#game-phase-dom');
  const empty = mustQuery('#game-inspector-empty');
  const content = mustQuery('#game-inspector-record');
  const select = mustQuery<HTMLSelectElement>('#game-inspector-commit');
  const state = mustQuery('#game-inspector-state');
  const dom = mustQuery('#game-inspector-dom');
  const commits: GameCommit[] = [];
  const historyLimit = 20;

  function showPhase(showState: boolean): void {
    stateTab.setAttribute('aria-pressed', String(showState));
    domTab.setAttribute('aria-pressed', String(!showState));
    state.hidden = !showState;
    dom.hidden = showState;
  }

  function showPanel(open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    label.textContent = open ? '렌더링 검사기 접기' : '렌더링 검사기 열기';
    if (open) {
      renderCommit();
      close.focus();
    } else toggle.focus();
  }

  function renderCommit(): void {
    const commit = commits.find((entry) => String(entry.number) === select.value);
    if (!commit) return;
    const summary = document.createElement('p');
    summary.className = 'inspector-commit-summary';
    summary.textContent = `상태 변경 요청 ${commit.stateRequests}개 · 커밋 1회`;
    state.replaceChildren(
      summary,
      valueGroup('GameBoard · useState', commit.state),
      valueGroup('Card · Props', commit.props),
    );
    if (commit.effect) {
      const effect = document.createElement('p');
      effect.className = 'inspector-effect';
      effect.append(code('useEffect'), ' ', commit.effect);
      state.append(effect);
    }

    const heading = document.createElement('h3');
    heading.textContent = `Virtual DOM → Diff → Patch · ${commit.patches.length}개`;
    dom.replaceChildren(heading);
    if (!commit.patches.length) {
      const message = document.createElement('p');
      message.textContent = '이 커밋의 DOM 변경은 없습니다.';
      dom.append(message);
      return;
    }
    const list = document.createElement('ol');
    list.className = 'inspector-patches';
    for (const patch of commit.patches) {
      const item = document.createElement('li');
      const header = document.createElement('div');
      header.append(code(patch.type, 'inspector-operation'), code(patch.path, 'inspector-path'));
      const change = document.createElement('div');
      change.append(code(patch.field));
      if (patch.values) change.append(changeValue(patch.values));
      item.append(header, change);
      list.append(item);
    }
    dom.append(list);
  }

  toggle.addEventListener('click', () => showPanel(Boolean(panel.hidden)));
  close.addEventListener('click', () => showPanel(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') showPanel(false);
  });
  stateTab.addEventListener('click', () => showPhase(true));
  domTab.addEventListener('click', () => showPhase(false));
  select.addEventListener('change', renderCommit);

  return (commit: GameCommit): void => {
    const pinned =
      select.value !== String(commits[0]?.number) &&
      commits.some((entry) => String(entry.number) === select.value)
        ? select.value
        : null;
    commits.unshift(commit);
    if (commits.length > historyLimit) commits.pop();
    select.replaceChildren(
      ...commits.map((entry) => {
        const option = document.createElement('option');
        option.value = String(entry.number);
        option.textContent = `#${entry.number} · ${entry.action}`;
        return option;
      }),
    );
    if (pinned && commits.some((entry) => String(entry.number) === pinned)) select.value = pinned;
    empty.hidden = true;
    content.hidden = false;
    if (!panel.hidden) renderCommit();
  };
}
