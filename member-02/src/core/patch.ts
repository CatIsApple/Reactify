import { createDOM, setProp } from './dom.ts';
import type { DiffPlan, OperationType, PatchOperation } from './types.ts';

/** Snapshot child references BEFORE mutations. Keyed moves preserve DOM identity. */
export function patch(
  dom: Node | null,
  plan: DiffPlan,
  container: Element,
  operations: PatchOperation[] = [],
): Node | null {
  const record = (type: OperationType, detail = ''): void => {
    operations.push({ type, path: plan.path, detail });
  };
  if (plan.kind === 'NONE') return dom;
  if (plan.kind === 'CREATE') {
    const node = createDOM(plan.next, container.ownerDocument, container.namespaceURI);
    container.appendChild(node);
    record('CREATE', String(plan.next.type));
    return node;
  }
  if (!dom) throw new Error('Patch 대상 DOM이 없습니다.');
  if (plan.kind === 'REMOVE') {
    container.removeChild(dom);
    record('REMOVE', String(plan.previous.type));
    return null;
  }
  if (plan.kind === 'REPLACE') {
    const node = createDOM(plan.next, container.ownerDocument, container.namespaceURI);
    container.replaceChild(node, dom);
    record('REPLACE', `${plan.previous.type} → ${plan.next.type}`);
    return node;
  }
  if (plan.kind === 'TEXT') {
    dom.nodeValue = String(plan.next.props.nodeValue);
    record('TEXT', String(plan.next.props.nodeValue));
    return dom;
  }
  if (dom.nodeType !== 1) throw new TypeError('속성 Patch에는 Element가 필요합니다.');
  const element = dom as Element;
  // Defer value until children are committed (select/option semantics).
  for (const prop of plan.props.filter((prop) => prop.name !== 'value')) {
    setProp(element, prop.name, prop.previous, prop.value);
    record('PROPS', prop.name);
  }
  const oldChildren = [...dom.childNodes];
  for (const index of plan.removed) {
    oldChildren[index].remove();
    operations.push({
      type: 'REMOVE',
      path: `${plan.path}.${index}`,
      detail: String(plan.previous.children[index].type),
    });
  }
  plan.children.forEach(({ oldIndex, plan: childPlan }, index) => {
    const node = patch(
      oldIndex === -1 ? null : oldChildren[oldIndex],
      childPlan,
      element,
      operations,
    );
    if (node && dom.childNodes[index] !== node) {
      dom.insertBefore(node, dom.childNodes[index] ?? null);
      if (oldIndex !== -1)
        operations.push({ type: 'MOVE', path: childPlan.path, detail: `${oldIndex} → ${index}` });
    }
  });
  for (const prop of plan.props.filter((prop) => prop.name === 'value')) {
    setProp(element, prop.name, prop.previous, prop.value);
    record('PROPS', prop.name);
  }
  for (const name of ['value', 'checked']) {
    if (
      name in plan.next.props &&
      name in element &&
      String(Reflect.get(element, name)) !== String(plan.next.props[name])
    ) {
      setProp(element, name, plan.previous.props[name], plan.next.props[name]);
      record('PROPS', name);
    }
  }
  return dom;
}
