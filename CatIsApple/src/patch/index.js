import { applyDOMProps, createDOM, HTML_NAMESPACE, SVG_NAMESPACE, syncDOMProperties, validateDOMProps, validateTree } from '../vdom/index.js';

const children = (node) => [...node.childNodes].filter((child) => child.nodeType === 1 || child.nodeType === 3);
const pathKey = (path) => path.join('/');
const namespaceOfChildren = (node) => node.namespaceURI === SVG_NAMESPACE && node.localName !== 'foreignObject'
  ? SVG_NAMESPACE : HTML_NAMESPACE;

/** Resolve old paths first so sibling removals/moves cannot shift later targets. */
export function patch(container, patches) {
  if (!patches.length) return container;
  const references = new Map();
  const visit = (node, path) => {
    references.set(pathKey(path), node);
    children(node).forEach((child, index) => visit(child, [...path, index]));
  };
  visit(container, []);
  const get = (path) => {
    const node = references.get(pathKey(path));
    if (!node) throw new Error(`Patch 경로에 DOM이 없습니다: /${pathKey(path)}`);
    return node;
  };
  const supported = new Set(['ADD', 'REMOVE', 'REPLACE', 'TEXT', 'PROPS', 'MOVE']);
  const operations = patches.map((operation) => {
    if (!supported.has(operation.type)) throw new TypeError(`알 수 없는 Patch: ${operation.type}`);
    return {
      ...operation,
      target: operation.type === 'ADD' ? null : get(operation.path),
      parent: operation.type === 'ADD' || operation.type === 'MOVE' ? get(operation.parentPath) : null,
    };
  });
  // A later invalid prop must not leave earlier text/structure edits committed.
  // This checks known API errors only; it does not allocate a second DOM tree.
  for (const operation of operations) {
    if (operation.type === 'PROPS') {
      for (const vnode of [operation.previous, operation.next]) {
        validateDOMProps(vnode.type, vnode.props, vnode.domProps, operation.target.namespaceURI);
      }
    } else if (operation.type === 'ADD' || operation.type === 'REPLACE') {
      const parent = operation.parent ?? operation.target.parentNode;
      validateTree([operation.vnode], namespaceOfChildren(parent));
    }
  }
  const properties = [];
  for (const operation of operations) {
    const { type, target, parent } = operation;
    if (type === 'ADD') {
      parent.insertBefore(createDOM(operation.vnode, container.ownerDocument, namespaceOfChildren(parent)), children(parent)[operation.index] ?? null);
    } else if (type === 'REMOVE') {
      target.remove();
    } else if (type === 'REPLACE') {
      target.replaceWith(createDOM(operation.vnode, container.ownerDocument, namespaceOfChildren(target.parentNode)));
    } else if (type === 'TEXT') {
      if (target.nodeValue !== operation.value) target.nodeValue = operation.value;
    } else if (type === 'MOVE') {
      const siblings = children(parent).filter((node) => node !== target);
      parent.insertBefore(target, siblings[operation.index] ?? null);
    } else if (type === 'PROPS') {
      applyDOMProps(target, operation.previous.props, operation.next.props);
      properties.push(operation);
    }
  }
  // Options finish first; their owning select gets the final say in its value.
  properties.sort((a, b) => b.path.length - a.path.length);
  for (const { target, previous, next } of properties) {
    syncDOMProperties(target, previous.props, next.props, previous.domProps, next.domProps);
  }
  return container;
}
