import {
  currentDispatcher, withDispatcher, copyDependencies, equalDependencies,
} from './context.js';

export function useState(initialValue) {
  const instance = currentDispatcher();
  const [slot, index] = instance._claimHook('state', () => ({
    value: typeof initialValue === 'function'
      ? withDispatcher(null, initialValue)
      : initialValue,
  }));
  slot.setter ??= (next) => instance._setState(index, next);
  return [slot.value, slot.setter];
}

export function useEffect(setup, dependencies) {
  const instance = currentDispatcher();
  if (typeof setup !== 'function') throw new TypeError('useEffect expects a function.');
  const deps = copyDependencies(dependencies);
  const [slot] = instance._claimHook('effect', () => ({ initialized: false }));
  slot.changed = !slot.initialized || !equalDependencies(slot.deps, deps);
  slot.setup = setup;
  slot.deps = deps;
  slot.initialized = true;
}

export function useMemo(calculate, dependencies) {
  const instance = currentDispatcher();
  if (typeof calculate !== 'function') throw new TypeError('useMemo expects a function.');
  const deps = copyDependencies(dependencies);
  const [slot] = instance._claimHook('memo', () => ({ initialized: false }));
  if (!slot.initialized || !equalDependencies(slot.deps, deps)) {
    slot.value = withDispatcher(null, calculate);
    slot.deps = deps;
    slot.initialized = true;
  }
  return slot.value;
}
