import { TEXT, COMMENT, matchChildren, assertUniqueKeys } from './vnode.ts';
import type { DiffPlan, DiffStep, UpdatePlan, VNode } from './types.ts';

/** Generator lets the Fiber scheduler pause between reconciliation units. No DOM writes. */
export function* diffSteps(
  previous: VNode | null,
  next: VNode | null,
  path = '0',
): Generator<DiffStep, DiffPlan> {
  const stack = next ? [next] : [];
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node.type !== 'string')
      throw new TypeError('Diff에는 Fiber 평가가 끝난 Virtual DOM이 필요합니다.');
    assertUniqueKeys(node.children);
    stack.push(...node.children);
    yield { kind: 'VALIDATE', path };
  }
  return yield* compareSteps(previous, next, path);
}

function* compareSteps(
  previous: VNode | null,
  next: VNode | null,
  path: string,
): Generator<DiffStep, DiffPlan> {
  let plan: DiffPlan;
  if (!previous && next) plan = { kind: 'CREATE', next, path };
  else if (previous && !next) plan = { kind: 'REMOVE', previous, path };
  else if (previous && next) {
    if (
      previous.type !== next.type ||
      previous.key !== next.key ||
      previous.namespace !== next.namespace
    )
      plan = { kind: 'REPLACE', previous, next, path };
    else if (next.type === TEXT || next.type === COMMENT)
      plan =
        previous.props.nodeValue !== next.props.nodeValue
          ? { kind: 'TEXT', previous, next, path }
          : { kind: 'NONE', previous, next, path };
    else {
      const update: UpdatePlan = {
        kind: 'UPDATE',
        previous,
        next,
        path,
        props: [],
        children: [],
        removed: [],
      };
      for (const name of new Set([...Object.keys(previous.props), ...Object.keys(next.props)])) {
        if (!Object.is(previous.props[name], next.props[name]))
          update.props.push({ name, previous: previous.props[name], value: next.props[name] });
      }
      const { matches, removed } = matchChildren(previous.children, next.children);
      update.removed = removed;
      yield update;
      for (let index = 0; index < next.children.length; index++) {
        const oldIndex = matches[index];
        const childPlan = yield* compareSteps(
          previous.children[oldIndex] ?? null,
          next.children[index],
          `${path}.${index}`,
        );
        update.children.push({ oldIndex, plan: childPlan });
      }
      return update;
    }
  } else plan = { kind: 'NONE', previous, next, path };
  yield plan;
  return plan;
}

export function diff(previous: VNode | null, next: VNode | null): DiffPlan {
  const iterator = diffSteps(previous, next);
  let result: IteratorResult<DiffStep, DiffPlan>;
  do {
    result = iterator.next();
  } while (!result.done);
  return result.value;
}
