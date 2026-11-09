import { Update } from '../fiber/flags.js';
import type { Fiber, HostElementFiber, TextFiber } from '../fiber/types.js';
import { readAttributes, setAttribute } from './attributes.js';
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
  const { type } = fiber.element;
  if (typeof type !== 'string') throw new TypeError('DOM rendering requires an HTML element');
  const tag = type.toLowerCase();
  if (tag === 'svg' || tag === 'math' || tag === 'template') throw new TypeError(`Unsupported HTML host: ${tag}`);
  if (fiber.child && voidTags.has(tag)) throw new TypeError(`HTML element ${tag} cannot have children`);
  const next = readAttributes(fiber.pendingProps);
  attributesByFiber.set(fiber, next);

  if (fiber.alternate !== null) {
    const previous = attributesByFiber.get(fiber.alternate)!;
    if (!changedAttributes(previous, next).next().done) fiber.flags |= Update;
    return;
  }

  const node = doc.createElement(type);
  for (const [name, value] of next) node.setAttribute(name, value);
  for (let child = fiber.child; child !== null; child = child.sibling) {
    for (const childNode of hostNodes(child)) node.appendChild(childNode);
  }
  fiber.stateNode = node;
}

/** 자식 작업이 끝난 호스트 요소나 텍스트의 DOM을 준비하고 기존 노드의 변경 여부를 표시한다. */
export function completeHostWork(fiber: Fiber, container: Element): void {
  if (fiber.tag === 'element') {
    completeElement(fiber, container.ownerDocument);
  } else if (fiber.tag === 'text') {
    if (fiber.stateNode === null) fiber.stateNode = container.ownerDocument.createTextNode(fiber.text);
    else if (fiber.alternate?.text !== fiber.text) fiber.flags |= Update;
  }
}

/** Update가 표시된 노드에 렌더 결과를 반영한다. 쓰기 직전의 실제 DOM 값으로 커밋 실패 시 복구한다. */
export function commitHostUpdate(fiber: HostElementFiber | TextFiber, undo: Array<() => void>): void {
  if (fiber.tag === 'text') {
    const node = fiber.stateNode!;
    const before = node.data;
    if (before !== fiber.text) {
      // 커밋이 실패하면 이 텍스트 노드의 이전 문자열을 복원한다.
      undo.push(() => { if (node.data !== before) node.data = before; });
      node.data = fiber.text;
    }
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
}
