import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, createElementDOM } from './helpers.ts';
import type { Fiber, StateSetter } from '../src/core/index.ts';
import { h, diff, FunctionComponent, useState } from '../src/core/index.ts';

test('invalid key in new subtree fails during diff, before parent changes', () => {
  const before = h('main', { title: 'before' }, h('p', {}, 'original'));
  const next = h(
    'main',
    { title: 'after' },
    h('p', {}, 'changed'),
    h('ul', {}, h('li', { key: 'x' }), h('li', { key: 'x' })),
  );
  const { document, container } = environment();
  const dom = createElementDOM(before, document);
  container.append(dom);
  assert.throws(() => diff(before, next), /중복 key/);
  assert.equal(dom.title, 'before');
  assert.equal(dom.textContent, 'original');
});
test('stale setters from a previous mount do not schedule a new generation', () => {
  let set!: StateSetter<number>;
  const { container } = environment();
  const instance = new FunctionComponent(() => {
    const [n, s] = useState(0);
    set = s;
    return h('p', {}, n);
  }).mount(container);
  instance.flushSync();
  const stale = set;
  instance.unmount();
  instance.mount(container);
  instance.flushSync();
  const commits = instance.commitCount;
  stale(99);
  instance.flushSync();
  assert.equal(instance.commitCount, commits);
  assert.equal(container.textContent, '0');
  instance.unmount();
});
test('Fiber only retains one previous generation after deletions', () => {
  let set!: StateSetter<number>;
  const { container } = environment();
  const instance = new FunctionComponent(() => {
    const [n, s] = useState(3);
    set = s;
    return h(
      'ul',
      {},
      Array.from({ length: n }, (_, i) => h('li', { key: i }, i)),
    );
  }).mount(container);
  instance.flushSync();
  set(4);
  instance.flushSync();
  set(1);
  instance.flushSync();
  const stack: Fiber[] = [instance.current!.alternate!];
  while (stack.length) {
    const node = stack.pop()!;
    assert.equal(node.alternate, null);
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  instance.unmount();
});
