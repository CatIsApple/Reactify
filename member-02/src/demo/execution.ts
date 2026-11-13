import type { PatchOperation } from '../core/index.ts';
import { mustQuery } from '../shared/dom.ts';

interface ExecutionStep {
  phase: 'render' | 'patch' | 'effect';
  title: string;
  detail: string;
  operations?: readonly PatchOperation[];
}

interface ExecutionRecord {
  summary: string;
  steps: ExecutionStep[];
}

const phaseLabels = {
  render: 'Phase 2 · 렌더링',
  patch: 'Phase 1 · DOM 반영',
  effect: 'DOM 반영 후',
};

export function setupExecution() {
  const summary = mustQuery('#execution-summary');
  const list = mustQuery<HTMLOListElement>('#execution-steps');
  const toggle = mustQuery<HTMLButtonElement>('#execution-playback');
  const controls = mustQuery('#execution-controls');
  const previous = mustQuery<HTMLButtonElement>('#execution-prev');
  const next = mustQuery<HTMLButtonElement>('#execution-next');
  const position = mustQuery('#execution-position');
  let steps: ExecutionStep[] = [];
  let selected = -1;

  function select(index: number): void {
    selected = index;
    const playing = index >= 0;
    list.classList.toggle('is-playing', playing);
    controls.hidden = !playing;
    toggle.setAttribute('aria-pressed', String(playing));
    toggle.textContent = playing ? '전체 보기' : '단계별 보기';
    for (const [i, item] of [...list.children].entries()) {
      if (i === index) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    previous.disabled = index <= 0;
    next.disabled = index >= steps.length - 1;
    position.textContent = playing ? `${index + 1} / ${steps.length} · ${steps[index].title}` : '';
  }

  toggle.addEventListener('click', () => select(selected < 0 ? 0 : -1));
  previous.addEventListener('click', () => {
    if (selected > 0) select(selected - 1);
  });
  next.addEventListener('click', () => {
    if (selected < steps.length - 1) select(selected + 1);
  });

  return ({ summary: description, steps: entries }: ExecutionRecord): void => {
    steps = entries;
    summary.textContent = description;
    toggle.hidden = false;
    renderExecutionSteps(list, entries);
    select(-1);
  };
}

function renderExecutionSteps(list: HTMLOListElement, entries: readonly ExecutionStep[]): void {
  list.hidden = false;
  list.replaceChildren(
    ...entries.map((step, i) => {
      const item = document.createElement('li');
      item.className = `execution-step execution-step-${step.phase}`;
      const number = document.createElement('span');
      number.className = 'execution-number';
      number.textContent = String(i + 1);
      number.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div');
      const heading = document.createElement('h3');
      heading.textContent = step.title;
      const phase = document.createElement('small');
      phase.className = 'execution-phase';
      phase.textContent = phaseLabels[step.phase];
      const detail = document.createElement('div');
      detail.className = 'execution-detail';
      const message = document.createElement('p');
      message.textContent = step.detail;
      detail.append(message);
      if (step.operations?.length) {
        const operations = document.createElement('details');
        operations.className = 'execution-operations';
        const label = document.createElement('summary');
        label.textContent = `실제 Patch 작업 ${step.operations.length}개`;
        const rows = document.createElement('ul');
        const limit = 24;
        for (const operation of step.operations.slice(0, limit)) {
          const row = document.createElement('li');
          row.textContent = `${operation.type} · ${operation.path} · ${operation.detail}`;
          rows.append(row);
        }
        if (step.operations.length > limit) {
          const rest = document.createElement('li');
          rest.textContent = `외 ${step.operations.length - limit}개`;
          rows.append(rest);
        }
        operations.append(label, rows);
        detail.append(operations);
      }
      content.append(phase, heading, detail);
      item.append(number, content);
      return item;
    }),
  );
}
