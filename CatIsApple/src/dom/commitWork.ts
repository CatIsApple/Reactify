import { ChildDeletion, ContentReset, MutationMask, NoFlags, Placement, Snapshot, Update } from '../fiber/flags.js';
import type { ChildFiber, Fiber, FunctionFiber, HostRootFiber, ParentFiber } from '../fiber/types.js';
import { commitHostUpdate, commitTextContent } from './completeWork.js';
import { captureFocus } from './focus.js';
import { iterateHostNodes } from './hostNodes.js';
import { MutationJournal } from './mutationJournal.js';

/** 함수가 자식에게 물려준 부모 DOM 또는 호스트 자신이 소유하는 DOM을 반환한다. */
function getHostParent(parent: ParentFiber | null, functionParents: Map<FunctionFiber, Element>): Element {
  if (parent === null) throw new Error('Expected a host parent for the DOM mutation');
  if (parent.tag === 'function') return functionParents.get(parent)!;
  return parent.tag === 'root' ? parent.stateNode.container : parent.stateNode!;
}

/**
 * 배치할 Fiber 뒤에서 위치가 유지되는 첫 형제 DOM을 찾는다. 삽입·이동될 Placement 트리는 건너뛴다.
 * 연달아 삽입할 Fiber들은 같은 형제 앞에 들어가므로 한 번 찾은 위치를 이번 커밋 동안 공유한다.
 */
function findHostSibling(start: ChildFiber, anchors: Map<ChildFiber, Node | null>): Node | null {
  let cursor = start;
  const skipped: ChildFiber[] = [];
  let anchor: Node | null = null;
  for (;;) {
    const cached = anchors.get(cursor);
    if (cached !== undefined) {
      anchor = cached;
      break;
    }
    skipped.push(cursor);
    if (cursor.sibling === null) {
      const parent: ParentFiber | null = cursor.return;
      if (parent?.tag !== 'function') break;
      cursor = parent;
      continue;
    }

    cursor = cursor.sibling;
    while (cursor.tag === 'function' && (cursor.flags & Placement) === NoFlags && cursor.child !== null) {
      cursor = cursor.child;
    }
    if (cursor.tag !== 'function' && (cursor.flags & Placement) === NoFlags) {
      anchor = cursor.stateNode;
      break;
    }
  }
  for (const fiber of skipped) anchors.set(fiber, anchor);
  return anchor;
}

/** 삭제나 이동이 실패하면 자식을 커밋 전 부모의 원래 형제 앞에 돌려놓을 수 있게 한다. */
function recordHostNodePosition(parent: Node, node: Node, undo: MutationJournal): void {
  if (node.parentNode !== parent) return;
  const next = node.nextSibling;
  // DOM이 아직 원래 위치라면 쓰기 전 예외였으므로 그대로 둔다.
  undo.recordUndo(function restoreHostNodePosition() {
    if (node.parentNode !== parent || node.nextSibling !== next) parent.insertBefore(node, next);
  });
}

/** 이전 트리에서 빠진 자식의 DOM을 떼고, 같은 위치에 되돌릴 복구 작업을 남긴다. */
function removeHostNodes(parent: Element, deleted: ChildFiber, undo: MutationJournal): void {
  for (const node of iterateHostNodes(deleted)) {
    recordHostNodePosition(parent, node, undo);
    parent.removeChild(node);
  }
}

/** DOM 노드 하나를 기준점 앞에 배치하고 커밋이 실패하면 기존 위치를 복구한다. */
function placeHostNode(parent: Element, node: Node, anchor: Node | null, undo: MutationJournal): void {
  const previousParent = node.parentNode;
  if (previousParent === parent && node.nextSibling === anchor) return;
  if (previousParent !== null) {
    recordHostNodePosition(previousParent, node, undo);
  } else {
    undo.recordUndo(function removeInsertedHostNode() {
      if (node.parentNode === parent) parent.removeChild(node);
    });
  }
  parent.insertBefore(node, anchor);
}

/** 새 노드는 삽입하고 재사용한 노드는 이동한다. 여러 DOM을 내놓는 컴포넌트는 이미 정렬된 끝부분을 보존한다. */
function placeHostNodes(parent: Element, fiber: ChildFiber, anchors: Map<ChildFiber, Node | null>, undo: MutationJournal): void {
  const single = fiber.tag === 'function' ? fiber.child : fiber;
  if (single === null) return;
  if (single.tag !== 'function' && (single === fiber || single.sibling === null)) {
    placeHostNode(parent, single.stateNode!, findHostSibling(fiber, anchors), undo);
    return;
  }
  const nodes = Array.from(iterateHostNodes(fiber));
  if (nodes.length === 0) return;
  let anchor = findHostSibling(fiber, anchors);
  let end = nodes.length;
  while (end > 0) {
    const node = nodes[end - 1];
    if (node.parentNode !== parent || node.nextSibling !== anchor) break;
    anchor = node;
    end--;
  }
  for (let i = 0; i < end; i++) placeHostNode(parent, nodes[i], anchor, undo);
}

/** 내려갈 때 부모의 삭제를 먼저 처리하고, 자식을 마치고 올라올 때 자신의 삽입·갱신을 적용한다. */
function commitSubtreeMutations(root: HostRootFiber, undo: MutationJournal, visited: Fiber[]): void {
  const anchors = new Map<ChildFiber, Node | null>();
  const functionParents = new Map<FunctionFiber, Element>();
  const needsHostParents = ((root.flags | root.subtreeFlags) & (Placement | ChildDeletion)) !== NoFlags;
  let fiber: Fiber | null = root;
  while (fiber !== null) {
    if (((fiber.flags | fiber.subtreeFlags) & MutationMask) !== NoFlags) {
      visited.push(fiber);
      if (needsHostParents && fiber.tag === 'function') functionParents.set(fiber, getHostParent(fiber.return, functionParents));
      if (fiber.tag === 'element' && (fiber.flags & ContentReset) !== NoFlags) {
        // 새 자식의 Placement가 실행되기 전에 이전 직접 텍스트를 제거한다.
        commitTextContent(fiber.stateNode!, '', undo);
      }
      if ((fiber.flags & ChildDeletion) !== NoFlags && fiber.tag !== 'text' && fiber.deletions !== null) {
        const parent = getHostParent(fiber, functionParents);
        for (const deleted of fiber.deletions) removeHostNodes(parent, deleted, undo);
      }
      if ((fiber.subtreeFlags & MutationMask) !== NoFlags && fiber.child !== null) {
        fiber = fiber.child;
        continue;
      }
    }
    while (fiber !== null) {
      if ((fiber.flags & Placement) !== NoFlags && fiber.tag !== 'root') {
        placeHostNodes(getHostParent(fiber.return, functionParents), fiber, anchors, undo);
      }
      if ((fiber.flags & Update) !== NoFlags && (fiber.tag === 'element' || fiber.tag === 'text')) {
        commitHostUpdate(fiber, undo);
      }
      if (fiber.sibling !== null) {
        fiber = fiber.sibling;
        break;
      }
      fiber = fiber.return;
    }
  }
}

/** 첫 커밋에서 기존 컨테이너를 비운다. 실패하면 원래 자식 노드와 순서를 복구한다. */
function clearRootContainer(container: Element, undo: MutationJournal): void {
  const previous = Array.from(container.childNodes);
  if (previous.length === 0) return;
  for (const node of previous) recordHostNodePosition(container, node, undo);
  container.replaceChildren();
}

/** 삭제가 커밋된 부모의 이전 자식 목록을 풀어, 살아 있는 Fiber의 짝이 삭제된 형제를 붙잡지 않게 한다. */
function detachAlternateSiblings(parent: ParentFiber): void {
  const previous = parent.alternate;
  if (previous === null) return;
  let child = previous.child;
  previous.child = null;
  while (child !== null) {
    const next = child.sibling;
    child.sibling = null;
    child = next;
  }
}

/** bailout으로 공유한 직계 자식만 작업 부모에 연결하고, 커밋 실패 시에는 기존 부모에 돌려놓는다. */
function linkReusedChildren(parents: readonly ParentFiber[], usePrevious: boolean): void {
  for (const parent of parents) {
    const owner = usePrevious ? parent.alternate! : parent;
    for (let child = parent.child; child !== null; child = child.sibling) child.return = owner;
  }
}

/** 부모의 삭제부터 DOM에 반영한다. 모든 작업이 성공하면 이번 커밋에서 소비한 표시를 지운다. */
export function commitMutationEffects(finished: HostRootFiber, reusedParents: readonly ParentFiber[] = []): void {
  const flags = finished.flags | finished.subtreeFlags;
  if ((flags & (MutationMask | Snapshot)) === NoFlags) {
    linkReusedChildren(reusedParents, false);
    return;
  }
  const undo = new MutationJournal();
  const visited: Fiber[] = [];
  const structuralEffects = flags & (Placement | ChildDeletion | ContentReset | Snapshot);
  const restoreFocus = structuralEffects === NoFlags ? null : captureFocus(finished.stateNode.container);
  try {
    linkReusedChildren(reusedParents, false);
    if ((finished.flags & Snapshot) !== NoFlags) clearRootContainer(finished.stateNode.container, undo);
    commitSubtreeMutations(finished, undo, visited);
    restoreFocus?.();
  } catch (error) {
    linkReusedChildren(reusedParents, true);
    const rollbackErrors = undo.rollback();
    try {
      restoreFocus?.();
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(rollbackErrors, 'DOM commit and rollback raised errors', { cause: error });
    }
    throw error;
  }

  finished.flags &= ~Snapshot;
  for (const fiber of visited) {
    if ((fiber.flags & ChildDeletion) !== NoFlags && fiber.tag !== 'text') detachAlternateSiblings(fiber);
    fiber.flags &= ~MutationMask;
    fiber.subtreeFlags &= ~MutationMask;
    fiber.deletions = null;
  }
}
