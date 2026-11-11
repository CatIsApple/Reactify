import type { ElementChild } from '../element/index.js';
import { diff, patch, readChildren, resolveChildren, type VNode } from '../vdom/index.js';

/** 상태 변경 시 다음 값이나 이전 값을 변환하는 함수를 받는다. */
type StateAction<T> = T | ((previous: T) => T);

/** 커밋 뒤 실행할 효과와, 효과가 반환할 수 있는 정리 함수. */
type Effect = () => void | (() => void);

/** Hook이 참조하는 값 목록. 생략하면 렌더마다 다시 실행한다. */
type Dependencies = readonly unknown[] | undefined;

/** 호출 순서에 따라 루트가 보관하는 상태, 계산 결과, 효과의 정리 함수. */
type Hook =
  | { kind: 'state'; value: unknown; dispatch: (action: unknown) => void }
  | { kind: 'memo'; value: unknown; deps: Dependencies }
  | { kind: 'effect'; cleanup?: () => void; deps: Dependencies };

/** 이번 렌더에서 다시 실행할 효과와 이전 효과의 정리 작업. */
type PendingEffect = { slot: Extract<Hook, { kind: 'effect' }>; setup: Effect; cleanup?: () => void };

/** 루트 함수 호출 중에만 열리는 Hook 호출 문맥. */
interface RenderContext {
  root: FunctionComponent;
  next: Hook[];
  effects: PendingEffect[];
  firstRender: boolean;
}

let current: RenderContext | null = null;
let rendering = false;

/** Hook을 호출한 위치가 루트인지, 이전 렌더와 같은 자리에 같은 종류가 있는지 검사한다. */
function nextHook<K extends Hook['kind']>(kind: K) {
  if (!current) throw new Error('Hook은 루트 컴포넌트의 최상위에서만 호출할 수 있습니다.');
  const index = current.next.length;
  const previous = current.root.hooks[index];
  if (!current.firstRender && previous?.kind !== kind) {
    throw new Error('렌더마다 같은 순서와 개수로 Hook을 호출해야 합니다.');
  }
  return { context: current, index, previous: previous as Extract<Hook, { kind: K }> | undefined };
}

/** 초기화 함수와 계산 함수에서 중첩 Hook을 호출할 수 없게 한다. */
function withoutHooks<T>(callback: () => T): T {
  const saved = current;
  current = null;
  try {
    return callback();
  } finally {
    current = saved;
  }
}

/** 길이와 각 위치의 값을 Object.is로 비교한다. */
function sameDeps(previous: Dependencies, next: Dependencies): boolean {
  return previous !== undefined && next !== undefined && previous.length === next.length
    && next.every((value, index) => Object.is(value, previous[index]));
}

/** 루트 인스턴스가 유지되는 동안 같은 상태와 setter를 사용한다. */
export function useState<T>(initial: T | (() => T)): [T, (action: StateAction<T>) => void] {
  const { context, index, previous } = nextHook('state');
  const root = context.root;
  const slot: Extract<Hook, { kind: 'state' }> = previous ?? {
    kind: 'state',
    value: typeof initial === 'function' ? withoutHooks(initial as () => T) : initial,
    dispatch(action) {
      if (rendering) throw new Error('렌더 도중에는 상태를 변경할 수 없습니다.');
      if (root.hooks[index] !== slot) return;
      const value = typeof action === 'function' ? action(slot.value) : action;
      if (Object.is(slot.value, value)) return;
      slot.value = value;
      root.update();
    },
  };
  context.next.push(slot);
  return [slot.value as T, slot.dispatch];
}

/** 의존성이 같으면 직전 계산 결과를 돌려준다. */
export function useMemo<T>(calculate: () => T, deps?: readonly unknown[]): T {
  const { context, previous } = nextHook('memo');
  const slot = previous && sameDeps(previous.deps, deps) ? previous : {
    kind: 'memo' as const, value: withoutHooks(calculate), deps: deps?.slice(),
  };
  context.next.push(slot);
  return slot.value as T;
}

/** 의존성이 달라지면 DOM 반영 후 이전 효과를 정리하고 새 효과를 실행한다. */
export function useEffect(setup: Effect, deps?: readonly unknown[]): void {
  const { context, previous } = nextHook('effect');
  if (previous && sameDeps(previous.deps, deps)) {
    context.next.push(previous);
    return;
  }
  const slot: Extract<Hook, { kind: 'effect' }> = { kind: 'effect', deps: deps?.slice() };
  context.next.push(slot);
  context.effects.push({ slot, setup, cleanup: previous?.cleanup });
}

/** 루트 하나의 Hook과 직전 VDOM을 소유하고 Phase 1의 Diff·Patch로 화면을 갱신한다. */
export class FunctionComponent {
  private committedHooks: Hook[] = [];
  private tree: VNode[] = [];
  private mounted = false;
  private committed = false;
  private busy = false;
  private pending = false;

  /** 화면을 그릴 DOM 컨테이너와 루트 함수를 연결한다. */
  constructor(private container: Element, private render: () => ElementChild) {}

  /** 마지막으로 DOM에 반영한 렌더의 Hook을 호출 순서대로 돌려준다. */
  get hooks(): readonly Hook[] { return this.committedHooks; }

  /** 컨테이너의 기존 DOM을 최초 비교 대상으로 삼아 루트를 그린다. */
  mount(): void {
    if (this.mounted) return;
    this.tree = readChildren(this.container);
    this.mounted = true;
    try {
      this.update();
    } catch (error) {
      if (!this.committed) this.mounted = false;
      throw error;
    }
  }

  /** 효과가 또 상태를 바꾸면 현재 커밋을 마친 뒤 다음 렌더를 진행한다. */
  update(): void {
    if (!this.mounted) return;
    this.pending = true;
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending && this.mounted) {
        this.pending = false;
        this.renderAndCommit();
      }
    } finally {
      this.busy = false;
    }
  }

  /** 루트 함수 호출이 끝나면 Hook 문맥을 닫고 자식 함수와 실제 DOM을 처리한다. */
  private renderAndCommit(): void {
    const context: RenderContext = { root: this, next: [], effects: [], firstRender: !this.committed };
    if (rendering) throw new Error('렌더 중에는 새 루트를 렌더할 수 없습니다.');
    rendering = true;
    current = context;
    let next: VNode[];
    try {
      const output = this.render();
      if (this.committed && context.next.length !== this.hooks.length) {
        throw new Error('렌더마다 같은 순서와 개수로 Hook을 호출해야 합니다.');
      }
      current = null;
      next = resolveChildren(output);
    } finally {
      current = null;
      rendering = false;
    }
    patch(this.container, diff(this.tree, next));
    this.tree = next;
    this.committedHooks = context.next;
    this.committed = true;
    for (const effect of context.effects) effect.cleanup?.();
    for (const effect of context.effects) {
      if (!this.mounted) break;
      const cleanup = effect.setup();
      if (typeof cleanup === 'function') {
        if (this.mounted) effect.slot.cleanup = cleanup;
        else cleanup();
      }
    }
  }

  /** 기존 setter를 무효화하고 DOM과 마지막으로 등록된 효과를 정리한다. */
  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.pending = false;
    const hooks = this.hooks;
    this.committedHooks = [];
    this.committed = false;
    patch(this.container, diff(this.tree, []));
    this.tree = [];
    for (const hook of hooks) {
      if (hook.kind === 'effect') hook.cleanup?.();
    }
  }
}
