/** Compile-only contracts. tsc checks the expected errors; these functions never run. */
import { h, useState, useMemo, useEffect } from '../src/core/index.ts';
import type { Component, DiffPlan, VNode } from '../src/core/index.ts';

export function hookContracts(): void {
  const [count, setCount] = useState(0);
  const number: number = count;
  setCount(number + 1);
  setCount((previous) => previous + 1);
  // @ts-expect-error A number state cannot receive a string.
  setCount('1');
  // @ts-expect-error An updater must return the same state type.
  setCount(() => '1');
  const memo: { doubled: number } = useMemo(() => ({ doubled: count * 2 }), [count]);
  useEffect(() => {
    void memo;
    return () => {};
  }, [memo]);
  // @ts-expect-error Effect setup can only return a cleanup function or void.
  useEffect(() => 42, []);
}

export function componentContracts(): VNode {
  const Label: Component<{ value: number }> = ({ value }) => h('strong', {}, value);
  const valid = h(Label, { value: 3, key: 'label' });
  // @ts-expect-error Required props must be present.
  h(Label, {});
  // @ts-expect-error Component props retain their types through h().
  h(Label, { value: '3' });
  // @ts-expect-error A required-prop component cannot use the no-props overload.
  h(Label);
  return valid;
}

export function patchContracts(node: VNode): DiffPlan {
  // @ts-expect-error CREATE plans require their next node.
  const invalid: DiffPlan = { kind: 'CREATE', path: '0' };
  void invalid;
  return { kind: 'CREATE', path: '0', next: node };
}
