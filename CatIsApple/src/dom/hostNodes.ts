import type { ChildFiber, ParentFiber } from '../fiber/types.js';

/** 한 Fiber가 부모 DOM에 직접 내놓는 요소와 텍스트를 순서대로 내보낸다. 함수의 자식만 더 내려간다. */
export function* hostNodes(root: ChildFiber): Generator<Node> {
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
