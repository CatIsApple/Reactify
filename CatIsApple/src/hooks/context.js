// Only the root function receives a dispatcher. Child functions and Hook
// callbacks execute without one, so they cannot allocate Hook slots.
let dispatcher = null;

export function withDispatcher(next, callback) {
  const previous = dispatcher;
  dispatcher = next;
  try {
    return callback();
  } finally {
    dispatcher = previous;
  }
}

export function currentDispatcher() {
  if (!dispatcher) {
    throw new Error('Hooks can only be called while rendering the root component.');
  }
  return dispatcher;
}

export function equalDependencies(previous, next) {
  return previous !== undefined && next !== undefined
    && previous.length === next.length
    && previous.every((value, index) => Object.is(value, next[index]));
}

export function copyDependencies(dependencies) {
  if (dependencies !== undefined && !Array.isArray(dependencies)) {
    throw new TypeError('Hook dependencies must be an array or undefined.');
  }
  return dependencies === undefined ? undefined : [...dependencies];
}
