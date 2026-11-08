import { cloneTree, normalizeChildren, sameValue } from '../vdom/index.js';

function validate(tree) {
  const keys = new Set();
  for (const node of tree) {
    if (typeof node.type !== 'string') throw new TypeError('Diff에는 평가가 끝난 DOM VNode를 전달하세요.');
    if (node.key != null) {
      if (keys.has(node.key)) throw new Error(`같은 형제 안에 중복 key가 있습니다: ${String(node.key)}`);
      keys.add(node.key);
    }
    validate(node.children ?? []);
  }
}

/** Pure comparison. Every existing-node path refers to the BEFORE tree. */
export function diff(previousTree, nextTree) {
  const previous = normalizeChildren(previousTree);
  const next = normalizeChildren(nextTree);
  validate(previous);
  validate(next);
  const patches = [];
  const snapshot = (node) => cloneTree([node])[0];

  function compareNode(before, after, path) {
    if (before.type !== after.type || before.namespaceURI !== after.namespaceURI) {
      patches.push({ type: 'REPLACE', path, vnode: snapshot(after) });
      return;
    }
    if (after.type === '#text') {
      if (before.props.nodeValue !== after.props.nodeValue) {
        patches.push({ type: 'TEXT', path, value: after.props.nodeValue });
      }
      return;
    }
    const propsChanged = !sameValue(before.props, after.props) || !sameValue(before.domProps, after.domProps);
    const childStart = patches.length;
    compareChildren(before.children, after.children, path);
    // A select/textarea value must be applied after option/text mutations too.
    const needsValueSync = patches.length !== childStart && ['select', 'textarea'].includes(after.type)
      && ('value' in after.props || 'value' in (after.domProps ?? {}));
    if (propsChanged || needsValueSync) {
      patches.push({ type: 'PROPS', path, previous: snapshot(before), next: snapshot(after) });
    }
  }

  function compareChildren(before, after, parentPath) {
    const keyed = new Map();
    const unkeyed = [];
    before.forEach((node, index) => node.key == null ? unkeyed.push(index) : keyed.set(node.key, index));
    let unkeyedCursor = 0;
    const matches = after.map((node) => node.key == null ? unkeyed[unkeyedCursor++] : keyed.get(node.key));
    const retained = new Set(matches.filter((index) => index !== undefined));
    for (let index = before.length - 1; index >= 0; index -= 1) {
      if (!retained.has(index)) patches.push({ type: 'REMOVE', path: [...parentPath, index] });
    }
    const order = before.map((_, index) => index).filter((index) => retained.has(index));
    after.forEach((node, index) => {
      const oldIndex = matches[index];
      if (oldIndex === undefined) {
        patches.push({ type: 'ADD', path: [...parentPath, index], parentPath, index, vnode: snapshot(node) });
        order.splice(index, 0, Symbol('new node'));
        return;
      }
      const position = order.indexOf(oldIndex);
      const path = [...parentPath, oldIndex];
      if (position !== index) {
        patches.push({ type: 'MOVE', path, parentPath, index });
        order.splice(position, 1);
        order.splice(index, 0, oldIndex);
      }
      compareNode(before[oldIndex], node, path);
    });
  }

  compareChildren(previous, next, []);
  return patches;
}
