import type {
  Dependencies,
  EffectSetup,
  Hook,
  HookOwner,
  StateAction,
  StateHook,
  StateSetter,
} from './types.ts';

let owner: HookOwner | null = null;

export function withHooks<T>(component: HookOwner | null, callback: () => T): T {
  const previous = owner;
  owner = component;
  try {
    return callback();
  } finally {
    owner = previous;
  }
}

function slot<K extends Hook['kind']>(
  kind: K,
): { instance: HookOwner; index: number; previous?: Extract<Hook, { kind: K }> } {
  if (!owner)
    throw new Error('Hook은 최상위 FunctionComponent의 렌더링 중에만 사용할 수 있습니다.');
  const instance = owner;
  const index = instance.hookIndex++;
  const previous = instance.hooks[index];
  if (previous && previous.kind !== kind) throw new Error('Hook 호출 순서가 변경되었습니다.');
  // The discriminator check above is the boundary for heterogeneous hook storage.
  return { instance, index, previous: previous as Extract<Hook, { kind: K }> | undefined };
}

function depsChanged(previous: Dependencies, next: Dependencies): boolean {
  if (next !== undefined && !Array.isArray(next))
    throw new TypeError('의존성은 배열 또는 undefined여야 합니다.');
  return (
    !previous ||
    !next ||
    previous.length !== next.length ||
    next.some((value, i) => !Object.is(value, previous[i]))
  );
}

export function useState<T>(initialValue: T | (() => T)): [T, StateSetter<T>] {
  const { instance, index, previous } = slot('state');
  const source: StateHook = previous ?? {
    kind: 'state',
    value: typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue,
    queue: [],
    consumed: 0,
  };
  const generation = instance.generation;
  if (!source.setState)
    source.setState = (action: unknown): void => {
      if (!instance.mounted || instance.generation !== generation) return;
      if (owner === instance) throw new Error('렌더링 중 setState를 호출할 수 없습니다.');
      const committed = instance.hooks[index];
      if (
        !source.queue.length &&
        typeof action !== 'function' &&
        Object.is(action, committed?.kind === 'state' ? committed.value : source.value)
      )
        return;
      // T is erased only in storage. The public setter accepts StateAction<T>.
      source.queue.push(
        typeof action === 'function'
          ? (value) => (action as (previous: T) => T)(value as T)
          : () => action,
      );
      instance.update();
    };
  const consumed = source.queue.length;
  const value = source.queue
    .slice(0, consumed)
    .reduce((state, transition) => transition(state), source.value);
  instance.draftHooks[index] = { ...source, value, consumed };
  return [value as T, source.setState as (action: StateAction<T>) => void];
}

export function useMemo<T>(factory: () => T, deps?: Dependencies): T {
  const { instance, index, previous } = slot('memo');
  const value = depsChanged(previous?.deps, deps) ? factory() : previous!.value;
  instance.draftHooks[index] = { kind: 'memo', value, deps: deps?.slice() };
  return value as T;
}

export function useEffect(setup: EffectSetup, deps?: Dependencies): void {
  const { instance, index, previous } = slot('effect');
  if (typeof setup !== 'function') throw new TypeError('effect에는 함수가 필요합니다.');
  const changed = depsChanged(previous?.deps, deps);
  instance.draftHooks[index] = {
    kind: 'effect',
    setup,
    deps: deps?.slice(),
    cleanup: previous?.cleanup,
    changed,
  };
}
