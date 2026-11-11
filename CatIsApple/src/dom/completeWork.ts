import { getDirectText } from '../element/directText.js';
import { ContentReset, Update } from '../fiber/flags.js';
import type { Fiber, HostElementFiber, TextFiber } from '../fiber/types.js';
import { setInitialHostAttributes, updateHostAttributes } from './attributes.js';
import { captureFocus } from './focus.js';
import { appendHostChildren } from './hostNodes.js';
import type { MutationJournal } from './mutationJournal.js';

const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

/** 마운트는 새 DOM을 조립하고, 업데이트는 원본 props의 참조가 바뀐 호스트에 표시한다. */
function completeHostElement(fiber: HostElementFiber, doc: Document): void {
  const current = fiber.alternate;
  const props = fiber.pendingProps;
  if (current !== null && current.memoizedProps === props) return;

  const { type } = fiber;
  const tag = type.toLowerCase();
  if (tag === 'svg' || tag === 'math' || tag === 'template') throw new TypeError(`Unsupported HTML host: ${tag}`);
  const text = getDirectText(props);
  if ((fiber.child || text !== null) && voidTags.has(tag)) throw new TypeError(`HTML element ${tag} cannot have children`);

  if (current !== null) {
    fiber.flags |= Update;
    // 직접 텍스트에서 자식 Fiber로 전환할 때는 Placement 전에 기존 텍스트를 비운다.
    if (text === null && getDirectText(current.memoizedProps) !== null) fiber.flags |= ContentReset;
    return;
  }

  const node = doc.createElement(type);
  setInitialHostAttributes(node, props);
  if (text !== null && text !== '') node.textContent = text;
  if (fiber.child !== null) appendHostChildren(node, fiber);
  fiber.stateNode = node;
}

/** 호스트 요소 또는 텍스트 노드를 준비하고 커밋할 변경을 표시한다. */
export function completeHostWork(fiber: Fiber, container: Element): void {
  if (fiber.tag === 'element') {
    completeHostElement(fiber, container.ownerDocument);
  } else if (fiber.tag === 'text') {
    if (fiber.stateNode === null) fiber.stateNode = container.ownerDocument.createTextNode(fiber.text);
    else if (fiber.alternate?.text !== fiber.text) fiber.flags |= Update;
  }
}

/** 기존 Text 노드를 그대로 갱신하고, 쓰기 전후 어느 시점에 실패하더라도 이전 문자열을 복구한다. */
function commitTextData(node: Text, text: string, undo: MutationJournal): void {
  const before = node.data;
  if (before === text) return;
  undo.recordText(node, before);
  node.data = text;
}

/** 호스트의 단일 텍스트를 쓰거나 비운다. 자식 교체를 되돌릴 때 원래 DOM 객체와 순서를 복원한다. */
export function commitTextContent(node: Element, text: string, undo: MutationJournal): void {
  const first = node.firstChild;
  if (first === null && text === '') return;
  if (text !== '' && first !== null && first.nodeType === first.TEXT_NODE && first === node.lastChild) {
    commitTextData(first as Text, text, undo);
    return;
  }
  const previous = Array.from(node.childNodes);
  const restoreFocus = first === null ? null : captureFocus(node);
  undo.recordUndo(function restoreHostChildren() {
    function hasChildMoved(child: ChildNode, index: number): boolean {
      return node.childNodes[index] !== child;
    }
    if (node.childNodes.length !== previous.length || previous.some(hasChildMoved)) {
      if (node.firstChild !== null) node.replaceChildren();
      for (const child of previous) node.appendChild(child);
    }
    restoreFocus?.();
  });
  node.textContent = text;
}

/** Update가 표시된 노드에 렌더 결과를 반영한다. 쓰기 직전의 실제 DOM 값으로 커밋 실패 시 복구한다. */
export function commitHostUpdate(fiber: HostElementFiber | TextFiber, undo: MutationJournal): void {
  if (fiber.tag === 'text') {
    commitTextData(fiber.stateNode!, fiber.text, undo);
    return;
  }

  const node = fiber.stateNode!;
  const current = fiber.alternate!;
  updateHostAttributes(node, current.memoizedProps!, fiber.pendingProps, undo);
  const text = getDirectText(fiber.pendingProps);
  if (text !== null && text !== getDirectText(current.memoizedProps)) commitTextContent(node, text, undo);
}
