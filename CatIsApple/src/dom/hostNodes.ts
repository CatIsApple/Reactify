import type { ChildFiber, HostElementFiber, ParentFiber } from '../fiber/types.js';

/** 한 Fiber가 부모 DOM에 직접 내놓는 요소와 텍스트를 순서대로 내보낸다. 함수의 자식만 더 내려간다. */
export function* iterateHostNodes(root: ChildFiber): Generator<Node> {
  let fiber = root;
  for (;;) {
    if (fiber.tag === 'function' && fiber.child !== null) {
      fiber = fiber.child;
      continue;
    }
    if (fiber.tag !== 'function') yield fiber.stateNode!;

    while (fiber !== root && fiber.sibling === null) {
      const parent: ParentFiber | null = fiber.return;
      if (parent?.tag !== 'function') return;
      fiber = parent;
    }
    if (fiber === root) return;
    fiber = fiber.sibling!;
  }
}

/** 마운트 때 함수 자식만 내려가며 부모 요소에 속한 DOM 자식을 순서대로 한 번씩 연결한다. */
export function appendHostChildren(node: Element, parent: HostElementFiber): void {
  let child = parent.child;
  while (child !== null) {
    if (child.tag === 'function' && child.child !== null) {
      child = child.child;
      continue;
    }
    if (child.tag !== 'function') node.appendChild(child.stateNode!);
    while (child.sibling === null) {
      if (child.return?.tag !== 'function') return;
      child = child.return;
    }
    child = child.sibling;
  }
}
