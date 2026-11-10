import type { ElementChild } from '../element/types.js';
import { Passive } from './flags.js';
import { getHighestPriorityLane, NoLane, NoLanes, type Lane, type Lanes } from './lanes.js';
import type { Fiber, FiberRootInstance, FunctionFiber } from './types.js';
import { requestUpdateLane } from './updatePriority.js';

/** 다음 상태를 직접 주거나 이전 상태에서 다음 상태를 계산한다. */
export type SetStateAction<S> = S | ((previous: S) => S);
/** 업데이트 하나를 접수하는 함수다. 동일한 Hook은 커밋을 거쳐도 같은 함수를 반환한다. */
export type Dispatch<A> = (action: A) => void;

/** 의존성은 호출마다 같은 길이의 배열로 넘기며 각 항목을 Object.is로 비교한다. */
type Dependencies = readonly unknown[];
/** 커밋 후 실행할 설정 함수. 반환한 함수는 다음 설정 전이나 언마운트 때 호출한다. */
export type EffectCallback = () => void | (() => void);

/** 한 렌더의 설정 함수와 변경 여부. 두 Fiber가 공유하는 instance에는 실제 실행한 설정의 정리 함수가 남는다. */
export interface PassiveEffect {
  create: EffectCallback;
  instance: { destroy: (() => void) | undefined };
  changed: boolean;
}

/** 특정 lane에서 처리할 상태 변경. 큐가 비어 있을 때 미리 계산한 결과를 재사용할 수 있다. */
interface StateUpdate {
  lane: Lane;
  action: unknown;
  eager?: { previous: unknown; state: unknown };
  failed?: boolean;
}

/** current와 작업 트리가 공유하는 대기 목록의 노드다. */
interface PendingUpdate {
  update: StateUpdate;
  next: PendingUpdate | null;
}

/** 한 Hook의 setter와 대기 요청을 공유한다. current는 커밋된 Hook이고 owner는 DOM 삽입 중인 Fiber도 가리킬 수 있다. */
interface StateQueue {
  owner: FunctionFiber | null;
  current: StateHook | null;
  first: PendingUpdate | null;
  last: PendingUpdate | null;
  dispatch: Dispatch<unknown>;
}

/** 함수 Fiber의 memoizedState에서 호출 순서로 연결되는 Hook. 낮은 우선순위 갱신을 위해 기준 상태와 큐를 둔다. */
export interface StateHook {
  kind: 'state';
  memoizedState: unknown;
  baseState: unknown;
  baseQueue: StateUpdate[];
  queue: StateQueue;
  /** 이번 렌더가 읽은 마지막 대기 노드. 커밋은 이 위치까지만 소비한다. */
  pendingThrough: PendingUpdate | null;
  next: Hook | null;
}

/** 이 호출 위치에서 계산한 값과 그 계산에 사용한 의존성을 함께 보관한다. */
interface MemoHook {
  kind: 'memo';
  value: unknown;
  deps: Dependencies | null;
  next: Hook | null;
}

/** 이 호출 위치의 passive effect와 의존성을 보관한다. */
interface EffectHook {
  kind: 'effect';
  effect: PassiveEffect;
  deps: Dependencies | null;
  next: Hook | null;
}

/** 함수 Fiber의 memoizedState에 호출 순서대로 연결되는 Hook 슬롯. */
export type Hook = StateHook | MemoHook | EffectHook;

/** 한 컴포넌트 호출의 Hook 커서와 해당 렌더 안에서만 유효한 상태 요청들이다. */
interface HookRender {
  fiber: FunctionFiber;
  lanes: Lanes;
  mounting: boolean;
  rerendering: boolean;
  source: Hook | null;
  /** 렌더 중 재호출에도 effect의 비교 기준은 마지막으로 커밋된 슬롯이다. */
  committed: Hook | null;
  first: Hook | null;
  last: Hook | null;
  hasPassive: boolean;
  mounted: Set<StateQueue> | null;
  renderActions: Map<StateQueue, unknown[]> | null;
  nextActions: Map<StateQueue, unknown[]> | null;
}

/** 컴포넌트의 출력과 이전 커밋에서 실제로 바뀐 상태가 있는지를 작업 루프에 돌려준다. */
interface HookRenderResult {
  children: ElementChild;
  didReceiveUpdate: boolean;
}

let rendering: HookRender | null = null;
let evaluatingHookCallback = false;

/** 상태 초기화·갱신 함수나 메모 계산 함수를 실행하는 동안 중첩된 Hook 호출을 감지한다. */
function callHookCallback<T>(callback: () => T): T {
  const wasEvaluating = evaluatingHookCallback;
  evaluatingHookCallback = true;
  try {
    return callback();
  } finally {
    evaluatingHookCallback = wasEvaluating;
  }
}

/** 함수형 업데이트에는 직전 상태를 넘기고, 값 업데이트는 전달된 값으로 교체한다. */
function applyAction(action: unknown, previous: unknown): unknown {
  return typeof action === 'function' ? callHookCallback(() => action(previous)) : action;
}

/** setter를 소유한 Fiber의 return 링크를 따라 현재 루트를 찾는다. */
function findRoot(owner: FunctionFiber): FiberRootInstance | null {
  let root: Fiber = owner;
  while (root.return !== null) root = root.return;
  return root.tag === 'root' ? root.stateNode : null;
}

/** 같은 컴포넌트의 렌더 중 요청은 재호출에 모으고, 나머지는 소유 Fiber를 통해 기존 루트 스케줄러에 알린다. */
function dispatchState(queue: StateQueue, action: unknown): void {
  const owner = queue.owner;
  if (rendering !== null && (rendering.mounted?.has(queue) ||
      (owner !== null && (owner === rendering.fiber || owner === rendering.fiber.alternate)))) {
    const actionsByHook = rendering.nextActions ??= new Map();
    const actions = actionsByHook.get(queue);
    if (actions) actions.push(action);
    else actionsByHook.set(queue, [action]);
    return;
  }
  if (owner === null) return;
  const root = findRoot(owner);
  if (root === null) return;
  const lane = requestUpdateLane(root.container.ownerDocument.defaultView);
  const update: StateUpdate = { lane, action };
  if (root.pendingLanes === NoLanes && queue.first === null && queue.current?.baseQueue.length === 0) {
    try {
      const previous = queue.current.memoizedState;
      const state = applyAction(action, previous);
      if (Object.is(state, previous)) return;
      update.eager = { previous, state };
    } catch {
      // 렌더 안에서 다시 실행해 통상적인 렌더 오류 처리 경로로 전달한다.
    }
  }
  const pending: PendingUpdate = { update, next: null };
  if (queue.last === null) queue.first = pending;
  else queue.last.next = pending;
  queue.last = pending;
  // DOM 삽입 도중 받은 첫 마운트의 요청은 커밋이 성공했을 때만 예약한다.
  if (queue.current !== null) root.scheduleStateUpdate(owner, lane);
}

/** 최초 호출에만 초기 상태를 계산하고, 현재 트리와 작업 트리가 공유할 setter 하나를 만든다. */
function mountState(initial: unknown): StateHook {
  const state = typeof initial === 'function' ? callHookCallback(() => initial()) : initial;
  const queue: StateQueue = {
    owner: null, current: null, first: null, last: null,
    /** 렌더 사이에 공유하는 큐에 상태 변경을 추가한다. */
    dispatch(action) { dispatchState(queue, action); },
  };
  return { kind: 'state', memoizedState: state, baseState: state, baseQueue: [], queue, pendingThrough: null, next: null };
}

/** 재적용할 기준 목록 다음에, 렌더 시작 시점에 보이던 공유 대기 요청까지만 접수 순서로 읽는다. */
function* updatesThrough(hook: StateHook, last: PendingUpdate | null): Generator<StateUpdate> {
  yield* hook.baseQueue;
  if (last === null) return;
  for (let node = hook.queue.first; node !== null; node = node.next) {
    yield node.update;
    if (node === last) return;
  }
}

/** 이번 lane의 상태를 계산하고, 건너뛴 첫 요청 뒤에 적용한 요청은 NoLane으로 보존해 다음 렌더가 순서를 복원한다. */
function updateState(source: StateHook, frame: HookRender): StateHook {
  const pendingThrough = source.queue.last;
  const hook: StateHook = { ...source, pendingThrough, next: null };
  if (source.baseQueue.length === 0 && pendingThrough === null) return hook;
  hook.baseQueue = [];
  let state = source.baseState;
  for (const update of updatesThrough(source, pendingThrough)) {
    if (update.failed) continue;
    if ((frame.lanes & update.lane) !== update.lane) {
      if (hook.baseQueue.length === 0) hook.baseState = state;
      hook.baseQueue.push(update);
      frame.fiber.lanes |= update.lane;
      continue;
    }
    try {
      const eager = update.eager;
      state = eager !== undefined && Object.is(eager.previous, state) ? eager.state : applyAction(update.action, state);
    } catch (error) {
      // 이 updater 하나가 실패해도 이후 정상적인 상태 요청으로 다시 렌더할 수 있다.
      update.failed = true;
      throw error;
    }
    if (hook.baseQueue.length > 0) hook.baseQueue.push({ ...update, lane: NoLane });
  }
  hook.memoizedState = state;
  if (hook.baseQueue.length === 0) hook.baseState = state;
  return hook;
}

/** 직전 호출 도중 이 Hook에 들어온 요청만 적용한다. 최초 초기화나 기존 큐 처리는 반복하지 않는다. */
function rerenderState(source: StateHook, frame: HookRender): StateHook {
  const hook = { ...source, next: null };
  const actions = frame.renderActions?.get(source.queue);
  if (actions) {
    for (const action of actions) {
      hook.memoizedState = applyAction(action, hook.memoizedState);
    }
    if (hook.baseQueue.length === 0) hook.baseState = hook.memoizedState;
  }
  return hook;
}

/** 각 공개 Hook은 함수 컴포넌트를 실행 중인 프레임 안에서만 슬롯을 읽을 수 있다. */
function currentRender(name: string): HookRender {
  if (rendering === null || evaluatingHookCallback) {
    throw new Error(`${name} must be called at the top level of a function component`);
  }
  return rendering;
}

/** 갱신 시 직전 패스의 같은 위치에서 같은 종류의 Hook을 읽고 두 커서를 한 칸 이동한다. */
function takeHook<K extends Hook['kind']>(frame: HookRender, kind: K): Extract<Hook, { kind: K }> | null {
  if (frame.mounting) return null;
  const source = frame.source;
  if (source === null) throw new Error('Rendered more hooks than during the previous render');
  if (source.kind !== kind) throw new Error(`Hook order changed: expected ${source.kind}, received ${kind}`);
  frame.source = source.next;
  frame.committed = frame.committed?.next ?? null;
  return source as Extract<Hook, { kind: K }>;
}

/** 이번 호출에서 만든 슬롯을 작업 중인 Hook 목록 끝에 연결한다. */
function appendHook(frame: HookRender, hook: Hook): void {
  if (frame.last === null) frame.first = hook;
  else frame.last.next = hook;
  frame.last = hook;
}

/** React처럼 대응하는 항목을 Object.is로 비교하고 의존성 배열의 길이가 바뀌면 사용 오류를 알린다. */
function sameDependencies(previous: Dependencies | null, next: Dependencies | null): boolean {
  if (previous === null || next === null) return false;
  if (previous.length !== next.length) console.error('Hook dependency arrays must keep the same length between renders.');
  const length = Math.min(previous.length, next.length);
  for (let i = 0; i < length; i++) {
    if (!Object.is(previous[i], next[i])) return false;
  }
  return true;
}

/** 초기 상태를 생략한 Hook은 undefined에서 시작한다. */
export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
/** 초기값 또는 초기화 함수를 받아 현재 상태와 이 Hook의 setter를 반환한다. */
export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
/** 현재 함수의 Hook 호출 순서에 따라 새 슬롯을 만들거나 이전 슬롯을 이어받는다. */
export function useState(initial?: unknown): [unknown, Dispatch<unknown>] {
  const frame = currentRender('useState');
  const source = takeHook(frame, 'state');
  let hook: StateHook;
  if (source === null) {
    hook = mountState(initial);
    (frame.mounted ??= new Set()).add(hook.queue);
  } else {
    hook = frame.rerendering ? rerenderState(source, frame) : updateState(source, frame);
  }
  appendHook(frame, hook);
  return [hook.memoizedState, hook.queue.dispatch];
}

/** 같은 의존성이면 직전 패스의 값을 재사용하고, 새 계산 결과는 작업 중인 Fiber에만 기록한다. */
export function useMemo<T>(calculate: () => T, dependencies?: Dependencies | null): T {
  const frame = currentRender('useMemo');
  const source = takeHook(frame, 'memo');
  const deps = dependencies ?? null;
  if (source !== null && sameDependencies(source.deps, deps)) {
    appendHook(frame, { ...source, next: null });
    return source.value as T;
  }
  const value = callHookCallback(calculate);
  appendHook(frame, { kind: 'memo', value, deps, next: null });
  return value;
}

/** 마지막 커밋의 의존성과 비교해 설정 함수를 기록한다. 실행과 정리는 성공한 커밋에서 예약한다. */
export function useEffect(create: EffectCallback, dependencies?: Dependencies | null): void {
  const frame = currentRender('useEffect');
  const committed = frame.committed;
  const source = takeHook(frame, 'effect');
  const deps = dependencies ?? null;
  const changed = committed?.kind !== 'effect' || !sameDependencies(committed.deps, deps);
  const instance = source?.effect.instance ?? { destroy: undefined };
  appendHook(frame, { kind: 'effect', deps, effect: { create, instance, changed }, next: null });
  if (changed) frame.hasPassive = true;
}

/** 업데이트는 바뀐 effect만, 삭제는 해당 컴포넌트의 모든 effect를 원래 호출 순서로 읽는다. */
export function* getPassiveEffects(fiber: FunctionFiber, changedOnly: boolean): IterableIterator<PassiveEffect> {
  for (let hook = fiber.memoizedState; hook !== null; hook = hook.next) {
    if (hook.kind === 'effect' && (!changedOnly || hook.effect.changed)) yield hook.effect;
  }
}

/** useState의 최종 값이 이전 커밋과 같은지 확인한다. 메모와 effect는 스스로 렌더를 예약하지 않는다. */
function stateChanged(previous: Hook | null, next: Hook | null): boolean {
  while (previous !== null && next !== null) {
    if (previous.kind === 'state' && next.kind === 'state' && !Object.is(previous.memoizedState, next.memoizedState)) return true;
    previous = previous.next;
    next = next.next;
  }
  return previous !== next;
}

/** 함수 Fiber에 Hook 목록을 구성한다. 렌더 중 자기 setter를 부르면 자식을 조정하기 전에 해당 함수만 다시 호출한다. */
export function renderWithHooks(fiber: FunctionFiber, renderLanes: Lanes): HookRenderResult {
  const previous = rendering;
  const previousState = fiber.alternate?.memoizedState ?? null;
  const frame: HookRender = {
    fiber, lanes: renderLanes, mounting: fiber.alternate === null, rerendering: false,
    source: previousState, committed: previousState, first: null, last: null,
    hasPassive: false, mounted: null, renderActions: null, nextActions: null,
  };
  const Component = fiber.type as (props: typeof fiber.pendingProps) => ElementChild;
  rendering = frame;
  try {
    for (let pass = 0; pass <= 25; pass++) {
      const children = Component(fiber.pendingProps);
      if (frame.source !== null) throw new Error('Rendered fewer hooks than during the previous render');
      if (frame.nextActions === null) {
        fiber.memoizedState = frame.first;
        if (frame.hasPassive) fiber.flags |= Passive;
        return { children, didReceiveUpdate: stateChanged(previousState, frame.first) };
      }
      frame.mounting = false;
      frame.rerendering = true;
      frame.source = frame.first;
      frame.committed = previousState;
      frame.hasPassive = false;
      frame.first = frame.last = null;
      frame.renderActions = frame.nextActions;
      frame.nextActions = null;
    }
    throw new Error('Too many re-renders');
  } finally {
    rendering = previous;
  }
}

/** 새 DOM의 연결 콜백에서 발생하는 상태 요청을 첫 마운트의 Hook 큐에 임시 보관한다. */
export function stageMountHooks(fiber: FunctionFiber): void {
  if (fiber.alternate !== null) return;
  for (let hook = fiber.memoizedState; hook !== null; hook = hook.next) {
    if (hook.kind === 'state') hook.queue.owner = fiber;
  }
}

/** DOM 커밋에 성공한 Hook만 setter의 소유자로 지정하고, 그 렌더 이후에 들어온 대기 요청은 남겨 둔다. */
export function commitHooks(fiber: FunctionFiber): void {
  let mountLanes = NoLanes;
  for (let hook = fiber.memoizedState; hook !== null; hook = hook.next) {
    if (hook.kind !== 'state') continue;
    const { queue, pendingThrough } = hook;
    if (queue.current === null) {
      for (let node = queue.first; node !== null; node = node.next) mountLanes |= node.update.lane;
    }
    queue.owner = fiber;
    queue.current = hook;
    if (pendingThrough !== null) {
      queue.first = pendingThrough.next;
      if (queue.last === pendingThrough) queue.last = null;
      hook.pendingThrough = null;
    }
  }
  if (mountLanes !== NoLanes) {
    const root = findRoot(fiber);
    while (mountLanes !== NoLanes) {
      const lane = getHighestPriorityLane(mountLanes);
      root?.scheduleStateUpdate(fiber, lane);
      mountLanes &= ~lane;
    }
  }
}

/** 제거된 컴포넌트의 setter가 이전 트리를 붙잡거나 루트에 새 작업을 예약하지 않도록 큐 연결을 해제한다. */
export function detachHooks(fiber: FunctionFiber): void {
  for (let hook = fiber.memoizedState; hook !== null; hook = hook.next) {
    if (hook.kind !== 'state') continue;
    const queue = hook.queue;
    queue.owner = null;
    queue.current = null;
    queue.first = queue.last = null;
  }
}
