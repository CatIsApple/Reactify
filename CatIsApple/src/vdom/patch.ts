import type { Patch } from './diff.js';
import { childContainer, type FormState, type VElement, type VNode } from './nodes.js';

/** 속성이나 자식 생성 후 브라우저가 가진 현재 폼 값을 필요한 경우에만 바꾼다. */
function applyForm(element: Element, form: FormState): void {
  const control = element as HTMLInputElement & HTMLOptionElement & HTMLSelectElement;
  if (form.value !== undefined && control.value !== form.value) control.value = form.value;
  if (form.checked !== undefined && control.checked !== form.checked) control.checked = form.checked;
  if (form.selected !== undefined && control.selected !== form.selected) control.selected = form.selected;
  if (form.selectedIndex !== undefined && control.selectedIndex !== form.selectedIndex) control.selectedIndex = form.selectedIndex;
}

/** 변경된 HTML 속성만 쓰고 기존 이벤트 리스너는 새 리스너를 달기 전에 해제한다. */
function applyAttributes(element: Element, previous: VElement | undefined, next: VElement): void {
  if (previous) {
    for (const name of Object.keys(previous.attrs)) {
      if (!Object.hasOwn(next.attrs, name)) element.removeAttribute(name);
    }
    for (const [name, listener] of Object.entries(previous.events)) {
      if (next.events[name] !== listener) element.removeEventListener(name, listener);
    }
  }
  for (const [name, value] of Object.entries(next.attrs)) {
    if (previous?.attrs[name] !== value) element.setAttribute(name, value);
  }
  for (const [name, listener] of Object.entries(next.events)) {
    if (previous?.events[name] !== listener) element.addEventListener(name, listener);
  }
}

/** 노드를 생성한 문서에 속하게 만들고, 폼의 선택값은 자식 옵션이 생긴 다음 설정한다. */
function createNode(node: VNode, doc: Document): Node {
  if (node.kind !== 'element') {
    return node.kind === 'text' ? doc.createTextNode(node.text) : doc.createComment(node.text);
  }
  const element = doc.createElementNS(node.namespace, node.tag);
  applyAttributes(element, undefined, node);
  const destination = childContainer(element);
  for (const child of node.children) destination.appendChild(createNode(child, doc));
  applyForm(element, node.form);
  return element;
}

/** diff가 낸 순서대로 지정된 실제 노드만 추가·삭제·교체하거나 내용을 수정한다. */
export function patch(parent: Node, changes: readonly Patch[]): void {
  for (const change of changes) {
    let container = childContainer(parent);
    for (const index of change.path.slice(0, -1)) container = childContainer(container.childNodes[index]);
    const index = change.path[change.path.length - 1];
    const target = container.childNodes.item(index);
    if (change.type === 'insert' || change.type === 'replace') {
      const doc = container.ownerDocument ?? container as Document;
      const child = createNode(change.node, doc);
      if (change.type === 'insert') container.insertBefore(child, target);
      else container.replaceChild(child, target!);
    } else if (change.type === 'remove') {
      container.removeChild(target!);
    } else if (change.type === 'text') {
      target!.nodeValue = change.text;
    } else if (change.type === 'props') {
      applyAttributes(target as Element, change.previous, change.next);
      applyForm(target as Element, change.next.form);
    }
  }
}
