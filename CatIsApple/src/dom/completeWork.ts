import { FactoryHostProps } from '../element/createElement.js';
import { getDirectText, toDirectText } from '../element/directText.js';
import { ContentReset, Update } from '../fiber/flags.js';
import type { Fiber, HostElementFiber, TextFiber } from '../fiber/types.js';
import { hasHostAttributeChanges, setInitialHostAttributes, updateHostAttributes } from './attributes.js';
import { captureFocus } from './focus.js';
import { appendHostChildren } from './hostNodes.js';
import type { MutationJournal } from './mutationJournal.js';

const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

/** 자식 노드나 직접 텍스트를 처음 받는 void 요소를 거부한다. */
function assertHostAllowsChildren(tag: string): void {
  if (voidTags.has(tag)) throw new TypeError(`HTML element ${tag} cannot have children`);
}

/** 일반 props의 자식·속성을 비교한다. 외부 객체와 getter는 기존 렌더·커밋 순서로 읽는다. */
function prepareHostUpdate(fiber: HostElementFiber, current: HostElementFiber): void {
  const previous = current.memoizedProps!;
  const props = fiber.pendingProps;
  if (previous === props) return;
  if (FactoryHostProps.canCompare(previous, props) && !hasHostAttributeChanges(previous, props)) {
    const after = Object.getOwnPropertyDescriptor(props, 'children');
    if (!after || !('get' in after)) {
      const text = toDirectText(after?.value);
      if (text === null) {
        if (fiber.child !== null && current.child === null) assertHostAllowsChildren(fiber.type.toLowerCase());
        if (getDirectText(previous) !== null) fiber.flags |= ContentReset;
        return;
      }
      // 기존 자식 Fiber가 있으면 직접 텍스트로의 전환이다. 이전 children을 미리 읽지 않는다.
      if (current.child !== null) {
        fiber.flags |= Update;
        return;
      }
      const before = Object.getOwnPropertyDescriptor(previous, 'children');
      if (!before || !('get' in before)) {
        const oldText = toDirectText(before?.value);
        if (oldText === null) assertHostAllowsChildren(fiber.type.toLowerCase());
        if (oldText !== text) fiber.flags |= Update;
        return;
      }
    }
  }

  // 외부 props·접근자·속성 변경은 원본을 커밋에서 비교한다. 기존 자식이 있던 태그는 이미 검증됐다.
  const text = getDirectText(props);
  if (current.child === null && (fiber.child !== null || text !== null)) assertHostAllowsChildren(fiber.type.toLowerCase());
  fiber.flags |= Update;
  if (text === null && getDirectText(previous) !== null) fiber.flags |= ContentReset;
}

/** 마운트는 새 DOM을 조립하고, 기존 호스트는 재사용할 DOM의 변경만 준비한다. */
function completeHostElement(fiber: HostElementFiber, container: Element): void {
  if (fiber.alternate !== null) {
    prepareHostUpdate(fiber, fiber.alternate);
    return;
  }
  const props = fiber.pendingProps;
  const { type } = fiber;
  const tag = type.toLowerCase();
  if (tag === 'svg' || tag === 'math' || tag === 'template') throw new TypeError(`Unsupported HTML host: ${tag}`);
  const text = getDirectText(props);
  if (fiber.child !== null || text !== null) assertHostAllowsChildren(tag);
  const node = container.ownerDocument.createElement(type);
  setInitialHostAttributes(node, props);
  if (text !== null && text !== '') node.textContent = text;
  if (fiber.child !== null) appendHostChildren(node, fiber);
  fiber.stateNode = node;
}

/** 호스트 요소 또는 텍스트 노드를 준비하고 커밋할 변경을 표시한다. */
export function completeHostWork(fiber: Fiber, container: Element): void {
  if (fiber.tag === 'element') {
    completeHostElement(fiber, container);
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
