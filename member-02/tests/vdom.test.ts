import type { VNode, PatchOperation } from '../src/core/index.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, query, createElementDOM } from './helpers.ts';
import { h, domToVNode, createDOM, diff, patch } from '../src/core/index.ts';
import { sanitizeHTML } from '../src/lab/sanitize.ts';

function fixture<T extends HTMLElement = HTMLElement>(before: VNode) {
  const { document, container, window } = environment();
  const dom = createElementDOM<T>(before, document);
  container.append(dom);
  return {
    document,
    container,
    window,
    dom,
    update(next: VNode) {
      const operations: PatchOperation[] = [];
      const result = patch(container.firstChild, diff(before, next), container, operations);
      before = next;
      return { dom: result, operations };
    },
  };
}

test('h normalizes nested children, numbers, false and null without mutating props', () => {
  const props = { key: 4, className: 'x' };
  const vnode = h('p', props, ['a', [0, null, false, true, undefined, 'b']]);
  assert.equal(vnode.key, '4');
  assert.deepEqual(
    vnode.children.map((n) => n.props.nodeValue),
    ['a', '0', 'b'],
  );
  assert.deepEqual(props, { key: 4, className: 'x' });
});
test('DOM round trip preserves whitespace, comments, attributes and SVG namespaces', () => {
  const { document, container } = environment();
  container.innerHTML =
    '<article title="sample"> A <b>B</b><!-- C --><svg viewBox="0 0 10 10"><circle cx="5" r="2"></circle></svg></article>';
  const tree = domToVNode(container.firstChild!);
  const copy = createElementDOM(tree, document);
  assert.equal(copy.outerHTML, container.firstElementChild!.outerHTML);
  assert.equal(query(copy, 'circle').namespaceURI, 'http://www.w3.org/2000/svg');
});
test('DOM conversion captures live input, textarea, checkbox and multi-select state', () => {
  const { document, container } = environment();
  container.innerHTML =
    '<div><input value="old"><input type="checkbox" checked><textarea>old</textarea><select multiple><option>A</option><option>B</option><option>C</option></select></div>';
  query(container, 'input').value = 'new';
  query<HTMLInputElement>(container, '[type=checkbox]').checked = false;
  query(container, 'textarea').value = 'live';
  container.querySelectorAll('option')[0].selected = true;
  container.querySelectorAll('option')[2].selected = true;
  const restored = createElementDOM(domToVNode(container.firstChild!), document);
  assert.equal(query(restored, 'input').value, 'new');
  assert.equal(query<HTMLInputElement>(restored, '[type=checkbox]').checked, false);
  assert.equal(query(restored, 'textarea').value, 'live');
  assert.deepEqual(
    [...query(restored, 'select').selectedOptions].map((o) => o.value),
    ['A', 'C'],
  );
});
test('CREATE inserts a new tree; REMOVE removes it', () => {
  const { container } = environment();
  const tree = h('div', {}, 'hello');
  const operations: PatchOperation[] = [];
  const dom = patch(null, diff(null, tree), container, operations);
  assert.equal(container.textContent, 'hello');
  assert.equal(operations[0].type, 'CREATE');
  patch(dom, diff(tree, null), container);
  assert.equal(container.childNodes.length, 0);
  assert.equal(patch(null, diff(null, null), container), null);
});
test('TEXT mutates only nodeValue and preserves parent and sibling identity', () => {
  const f = fixture(h('div', {}, h('p', {}, 'old'), h('input', { value: 'stay' })));
  const p = f.dom.firstChild!,
    text = p.firstChild!,
    input = f.dom.lastChild;
  const { operations } = f.update(h('div', {}, h('p', {}, 'new'), h('input', { value: 'stay' })));
  assert.equal(f.dom.firstChild, p);
  assert.equal(p.firstChild, text);
  assert.equal(f.dom.lastChild, input);
  assert.deepEqual(
    operations.map((o) => o.type),
    ['TEXT'],
  );
  assert.equal(text.nodeValue, 'new');
});
test('PROPS updates, removes and handles boolean and ARIA false', () => {
  const f = fixture<HTMLButtonElement>(
    h('button', { title: 'old', disabled: true, className: 'a' }, 'go'),
  );
  f.update(h('button', { className: 'b', disabled: false, 'aria-pressed': false }, 'go'));
  assert.equal(f.dom.disabled, false);
  assert.equal(f.dom.hasAttribute('title'), false);
  assert.equal(f.dom.className, 'b');
  assert.equal(f.dom.getAttribute('aria-pressed'), 'false');
});
test('REPLACE handles incompatible tags and keys', () => {
  const f = fixture(h('p', { key: 'a' }, 'old'));
  let updated = f.update(h('section', { key: 'a' }, 'new'));
  assert.notEqual(updated.dom, f.dom);
  assert.equal(updated.operations[0].type, 'REPLACE');
  const previous = updated.dom;
  updated = f.update(h('section', { key: 'b' }, 'new'));
  assert.notEqual(updated.dom, previous);
});
test('keyed insertion, deletion, reorder and replacement keep matching DOM objects', () => {
  const list = (values: string[]) =>
    h(
      'ul',
      {},
      values.map((value) => h(value === 'x' ? 'div' : 'li', { key: value }, value)),
    );
  const f = fixture(list(['a', 'b', 'c']));
  const [a, b, c] = f.dom.children;
  const result = f.update(list(['c', 'd', 'a']));
  assert.deepEqual(
    [...f.dom.children].map((n) => n.textContent),
    ['c', 'd', 'a'],
  );
  assert.equal(f.dom.firstChild, c);
  assert.equal(f.dom.lastChild, a);
  assert.equal(b.isConnected, false);
  assert.ok(result.operations.some((o) => o.type === 'MOVE'));
  f.update(list([]));
  assert.equal(f.dom.childNodes.length, 0);
});
test('seeded keyed reconciliation agrees with fresh rendering across 120 sequences', () => {
  let seed = 8123;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const list = (values: string[]) =>
    h(
      'ul',
      { title: String(values.length) },
      values.map((value) => h('li', { key: value, 'data-key': value }, value)),
    );
  const f = fixture(list([]));
  for (let round = 0; round < 120; round++) {
    const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].filter(() => random() > 0.3);
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    const prior = new Map([...f.dom.children].map((node) => [node.getAttribute('data-key'), node]));
    f.update(list(values));
    assert.equal(f.dom.outerHTML, createElementDOM(list(values), f.document).outerHTML);
    for (const node of f.dom.children)
      if (prior.has(node.getAttribute('data-key')))
        assert.equal(node, prior.get(node.getAttribute('data-key')));
  }
});
test('duplicate keys reject reconciliation', () => {
  const tree = h('ul', {}, h('li', { key: 'a' }), h('li', { key: 'a' }));
  assert.throws(() => diff(h('ul'), tree), /중복 key/);
  assert.throws(() => createDOM(tree, environment().document), /중복 key/);
});
test('event handlers are replaced and removed, never accumulated', () => {
  let a = 0,
    b = 0;
  const first = () => a++,
    second = () => b++;
  const f = fixture<HTMLButtonElement>(h('button', { onClick: first }, 'go'));
  f.dom.click();
  f.update(h('button', { onClick: second }, 'go'));
  f.dom.click();
  f.update(h('button', {}, 'go'));
  f.dom.click();
  assert.equal(a, 1);
  assert.equal(b, 1);
});
test('style object removal and style string transitions work', () => {
  const f = fixture(h('div', { style: { color: 'red', backgroundColor: 'black', '--n': '1' } }));
  f.update(h('div', { style: { color: 'blue' } }));
  assert.equal(f.dom.style.backgroundColor, '');
  assert.equal(f.dom.style.color, 'blue');
  assert.equal(f.dom.style.getPropertyValue('--n'), '');
  f.update(h('div', { style: 'color: green' }));
  assert.equal(f.dom.style.color, 'green');
  f.update(h('div'));
  assert.equal(f.dom.getAttribute('style'), null);
});
test('controlled values restore edited properties and preserve input identity', () => {
  const tree = h('input', { value: 'controlled' });
  const f = fixture<HTMLInputElement>(tree);
  f.dom.value = 'user changed';
  f.update(tree);
  assert.equal(f.dom.value, 'controlled');
  assert.equal(f.container.firstChild, f.dom);
});
test('select value is applied after options exist and updates after child reconciliation', () => {
  const options = () => [h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')];
  const f = fixture<HTMLSelectElement>(h('select', { value: 'b' }, options()));
  assert.equal(f.dom.value, 'b');
  f.update(h('select', { value: 'a' }, options()));
  assert.equal(f.dom.value, 'a');
});
test('identical snapshots produce zero mutations', () => {
  const tree = h('div', { title: 'x' }, h('span', {}, 'same'));
  const f = fixture(tree);
  const result = f.update(structuredClone(tree));
  assert.deepEqual(result.operations, []);
  assert.equal(result.dom, f.dom);
});
test('HTML playground strips executable markup and unsafe URLs but preserves safe structures', () => {
  const { document } = environment();
  const { fragment, removed } = sanitizeHTML(
    '<script>alert(1)</script><p onclick="bad()">safe</p><a href="java\nscript:alert(1)">no</a><iframe src="https://example.com"></iframe><svg><circle r="5"/></svg>',
    document,
  );
  const box = document.createElement('div');
  box.append(fragment);
  assert.equal(box.querySelector('script,iframe'), null);
  assert.equal(query(box, 'p').hasAttribute('onclick'), false);
  assert.equal(query(box, 'a').hasAttribute('href'), false);
  assert.ok(query(box, 'circle'));
  assert.ok(removed >= 4);
});
