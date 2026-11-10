import { getDirectText } from '../element/directText.js';
import { ContentReset, Update } from '../fiber/flags.js';
import type { Fiber, HostElementFiber, TextFiber } from '../fiber/types.js';
import { readAttributes, setAttribute } from './attributes.js';
import { captureFocus } from './focus.js';
import { hostNodes } from './hostNodes.js';

const attributesByFiber = new WeakMap<HostElementFiber, Map<string, string>>();
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

/** 두 렌더에서 정규화한 HTML 속성을 비교해 바뀐 이름과 다음 값을 내놓는다. null은 삭제다. */
function* changedAttributes(
  previous: Map<string, string>,
  next: Map<string, string>,
): Generator<[string, string | null]> {
  for (const [name, before] of previous) {
    const after = next.get(name) ?? null;
    if (before !== after) yield [name, after];
  }
  for (const [name, after] of next) {
    if (!previous.has(name)) yield [name, after];
  }
}

/** 새 요소는 문서 밖에서 조립하고, 기존 요소는 최종 HTML 속성이 달라졌을 때 Update를 표시한다. */
function completeElement(fiber: HostElementFiber, doc: Document): void {
  const current = fiber.alternate;
  if (current !== null && current.memoizedProps === fiber.pendingProps) {
    // bailout한 작업도 다음 렌더의 비교 기준이 되므로 이전 속성 스냅샷을 그대로 물려받는다.
    attributesByFiber.set(fiber, attributesByFiber.get(current)!);
    return;
  }
  const { type } = fiber;
  const tag = type.toLowerCase();
  if (tag === 'svg' || tag === 'math' || tag === 'template') throw new TypeError(`Unsupported HTML host: ${tag}`);
  const text = getDirectText(fiber.pendingProps);
  if ((fiber.child || text !== null) && voidTags.has(tag)) throw new TypeError(`HTML element ${tag} cannot have children`);
  const next = readAttributes(fiber.pendingProps);
  attributesByFiber.set(fiber, next);

  if (current !== null) {
    const previous = attributesByFiber.get(current)!;
    if (!changedAttributes(previous, next).next().done) fiber.flags |= Update;
    if (text !== getDirectText(current.memoizedProps)) fiber.flags |= text === null ? ContentReset : Update;
    return;
  }

  const node = doc.createElement(type);
  for (const [name, value] of next) node.setAttribute(name, value);
  if (text !== null && text !== '') node.textContent = text;
  for (let child = fiber.child; child !== null; child = child.sibling) {
    for (const childNode of hostNodes(child)) node.appendChild(childNode);
  }
  fiber.stateNode = node;
}

/** 호스트 요소 또는 텍스트 노드를 준비하고 커밋할 변경을 표시한다. */
export function completeHostWork(fiber: Fiber, container: Element): void {
  if (fiber.tag === 'element') {
    completeElement(fiber, container.ownerDocument);
  } else if (fiber.tag === 'text') {
    if (fiber.stateNode === null) fiber.stateNode = container.ownerDocument.createTextNode(fiber.text);
    else if (fiber.alternate?.text !== fiber.text) fiber.flags |= Update;
  }
}

/** 기존 Text 노드를 그대로 갱신하고, 쓰기 전후 어느 시점에 실패하더라도 이전 문자열을 복구한다. */
function commitTextData(node: Text, text: string, undo: Array<() => void>): void {
  const before = node.data;
  if (before === text) return;
  undo.push(() => {
    if (node.data !== before) node.data = before;
  });
  node.data = text;
}

/** 호스트의 단일 텍스트를 쓰거나 비운다. 자식 교체를 되돌릴 때 원래 DOM 객체와 순서를 복원한다. */
export function commitTextContent(node: Element, text: string, undo: Array<() => void>): void {
  const first = node.firstChild;
  if (first === null && text === '') return;
  if (text !== '' && first !== null && first.nodeType === first.TEXT_NODE && first === node.lastChild) {
    commitTextData(first as Text, text, undo);
    return;
  }
  const previous = Array.from(node.childNodes);
  const restoreFocus = first === null ? null : captureFocus(node);
  undo.push(() => {
    if (node.childNodes.length !== previous.length || previous.some((child, index) => node.childNodes[index] !== child)) {
      if (node.firstChild !== null) node.replaceChildren();
      for (const child of previous) node.appendChild(child);
    }
    restoreFocus?.();
  });
  node.textContent = text;
}

/** Update가 표시된 노드에 렌더 결과를 반영한다. 쓰기 직전의 실제 DOM 값으로 커밋 실패 시 복구한다. */
export function commitHostUpdate(fiber: HostElementFiber | TextFiber, undo: Array<() => void>): void {
  if (fiber.tag === 'text') {
    commitTextData(fiber.stateNode!, fiber.text, undo);
    return;
  }

  const node = fiber.stateNode!;
  const previous = attributesByFiber.get(fiber.alternate!)!;
  const next = attributesByFiber.get(fiber)!;
  for (const [name, value] of changedAttributes(previous, next)) {
    const before = node.getAttribute(name);
    if (before === value) continue;
    // 같은 요소에서 뒤의 속성 쓰기가 실패해도 이미 바꾼 속성을 하나씩 되돌린다.
    undo.push(() => {
      if (node.getAttribute(name) !== before) setAttribute(node, name, before);
    });
    setAttribute(node, name, value);
  }
  const text = getDirectText(fiber.pendingProps);
  if (text !== null && text !== getDirectText(fiber.alternate!.memoizedProps)) commitTextContent(node, text, undo);
}
