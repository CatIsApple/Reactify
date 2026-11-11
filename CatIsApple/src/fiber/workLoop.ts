import type { ElementChild, ReactifyElement } from '../element/types.js';
import { cloneChildFibers, reconcileChildren, type InspectElement } from './childReconciler.js';
import { createFiberFromElement, getNextFiberInSubtree } from './fiberNode.js';
import { Passive } from './flags.js';
import { commitFunctionHooks, detachFunctionHooks, hasHookStateChanged, renderWithHooks, stageMountingHooks } from './hooks.js';
import { NoLanes, type Lanes } from './lanes.js';
import type { ChildFiber, ElementFiber, Fiber, FunctionFiber, ParentFiber } from './types.js';

export { createFiberFromElement, markUpdateLaneFromFiberToRoot } from './fiberNode.js';

/** 긴 렌더에서만 주기적으로 깊이를 살펴본다. 넓은 목록은 Element 참조를 기록할 필요가 없다. */
const depthCheckInterval = 256;
const diagnosticDepth = 128;

/** 현재 가지가 충분히 깊을 때만 렌더가 끝날 때까지 순환 참조 진단을 켠다. */
function isDeepBranch(fiber: Fiber): boolean {
  let node: Fiber | null = fiber;
  for (let depth = 0; depth < diagnosticDepth; depth++) {
    if (node === null) return false;
    node = node.return;
  }
  return true;
}

/** 깊은 렌더에서 같은 입력 객체를 다시 만날 때만 조상을 확인한다. 형제 재사용은 허용한다. */
function createCycleInspector(): InspectElement {
  const seen = new WeakSet<ReactifyElement>();
  const inputs = new WeakMap<ChildFiber, ReactifyElement>();
  return function inspectElement(fiber, element) {
    if (seen.has(element)) {
      for (let parent = fiber.return; parent !== null && parent.tag !== 'root'; parent = parent.return) {
        if (inputs.get(parent) === element) throw new TypeError('Cycle in Element children');
      }
    } else {
      seen.add(element);
    }
    inputs.set(fiber, element);
  };
}

/** 부모의 입력이 같으면 자손에 이번 lane의 작업이 있는지 보고 자식들을 복제하거나 이미 커밋한 가지를 공유한다. */
function bailoutOnUnchangedFiber(
  parent: ParentFiber,
  current: ParentFiber,
  renderLanes: Lanes,
  reusedParents: ParentFiber[],
): ChildFiber | null {
  if ((current.childLanes & renderLanes) !== NoLanes) {
    parent.childLanes = NoLanes;
    return cloneChildFibers(parent, current);
  }
  parent.childLanes = current.childLanes;
  parent.child = current.child;
  if (parent.child !== null) reusedParents.push(parent);
  return null;
}

/** 루트 입력, 함수 컴포넌트의 반환값 또는 호스트의 children을 조정하고 다음에 처리할 첫 자식을 반환한다. */
function beginWork(
  fiber: Fiber,
  rootChildren: ElementChild,
  inspectElement: InspectElement | undefined,
  reusedParents: ParentFiber[],
  renderLanes: Lanes,
): ChildFiber | null {
  if (fiber.tag === 'root') {
    // 루트 자신의 남은 lane은 큐가 계산한다. 재적용 후 같은 화면이면 자식 입력을 다시 펼칠 필요가 없다.
    fiber.memoizedState = rootChildren;
    const current = fiber.alternate;
    if (current !== null && current.memoizedState === rootChildren) {
      return bailoutOnUnchangedFiber(fiber, current, renderLanes, reusedParents);
    }
    fiber.childLanes = NoLanes;
    return reconcileChildren(fiber, rootChildren, inspectElement);
  }
  const hasUpdate = (fiber.lanes & renderLanes) !== NoLanes;
  fiber.lanes &= ~renderLanes;
  if (fiber.tag === 'text') {
    fiber.memoizedProps = fiber.pendingProps;
    return null;
  }

  const { pendingProps } = fiber;
  const current = fiber.alternate;
  if (current !== null && current.memoizedProps === pendingProps && !hasUpdate) {
    return bailoutOnUnchangedFiber(fiber, current, renderLanes, reusedParents);
  }

  fiber.childLanes = NoLanes;
  let children: ElementChild;
  if (fiber.tag === 'function') {
    children = renderWithHooks(fiber, renderLanes);
    // 여러 갱신을 적용한 최종 상태가 같으면 이번 lane의 자손 작업만 계속한다.
    if (current?.tag === 'function' && current.memoizedProps === pendingProps &&
        !hasHookStateChanged(current.memoizedState, fiber.memoizedState)) {
      fiber.flags &= ~Passive;
      return bailoutOnUnchangedFiber(fiber, current, renderLanes, reusedParents);
    }
  } else if (Object.hasOwn(pendingProps, 'children')) {
    children = pendingProps.children;
    if (typeof children === 'string' || typeof children === 'number') {
      // 호스트 자신이 텍스트를 쓴다. 이전에 Fiber 자식이 있었다면 삭제와 Hook 정리를 예약한다.
      fiber.memoizedProps = pendingProps;
      return current?.child ? reconcileChildren(fiber, null) : null;
    }
  }
  const child = reconcileChildren(fiber, children, inspectElement);
  fiber.memoizedProps = pendingProps;
  return child;
}

/** 자식 처리를 마친 Fiber 하나에 대해 호출하는 콜백 타입. DOM 렌더러는 여기서 커밋할 변경을 준비한다. */
type CompleteWork = (fiber: Fiber) => void;

/** 완료한 Fiber와 그 자손의 플래그를 부모에 합친다. 다음 형제가 없으면 부모로 올라가서 완료를 이어 간다. */
function completeUnitOfWork(
  fiber: Fiber,
  completeWork?: CompleteWork,
): ChildFiber | null {
  let completed: Fiber | null = fiber;
  while (completed !== null) {
    completeWork?.(completed);
    const parent: ParentFiber | null = completed.return;
    if (parent !== null) {
      parent.subtreeFlags |= completed.flags | completed.subtreeFlags;
      parent.childLanes |= completed.lanes | completed.childLanes;
    }
    if (completed.sibling !== null) return completed.sibling;
    completed = parent;
  }
  return null;
}

/** 한 렌더가 양보 후 이어서 실행할 작업과, 커밋할 때 기존 자식을 이어받을 부모 목록. */
export interface RenderWork {
  readonly reusedParents: readonly ParentFiber[];
  /** 새 컴포넌트의 DOM 연결 콜백에서 들어오는 상태 요청을 커밋 성공 여부에 따라 보존한다. */
  runWithMountingHooks(commitDOM: () => void): void;
  /** DOM 커밋에 성공한 뒤 삭제된 setter 연결을 끊고 새 트리의 Hook 상태를 공개한다. */
  commitRenderHooks(): void;
  /** Fiber 단위로 진행하고 양보하면 false, 전체 작업을 마치면 true를 반환한다. */
  performRenderWork(shouldYield?: () => boolean): boolean;
}

/** 삭제된 가지 안에서만 child·sibling·return을 따라가며 함수 컴포넌트의 setter 연결을 끊는다. */
function detachSubtreeHooks(deleted: ChildFiber): void {
  for (let fiber: ChildFiber | null = deleted; fiber !== null; fiber = getNextFiberInSubtree(fiber, deleted)) {
    if (fiber.tag === 'function') detachFunctionHooks(fiber);
  }
}

/** 다음 Fiber를 이 렌더에 보관해 여러 브라우저 태스크에서 순회를 이어간다. */
export function createRenderWork(
  root: ParentFiber,
  children?: ElementChild,
  completeWork?: CompleteWork,
  renderLanes: Lanes = NoLanes,
): RenderWork {
  let inspectElement: InspectElement | undefined;
  let untilDepthCheck = depthCheckInterval;
  const reusedParents: ParentFiber[] = [];
  const mountingHooks: FunctionFiber[] = [];
  const updatedHooks: FunctionFiber[] = [];
  const deletedChildren: ChildFiber[][] = [];
  let workInProgress: Fiber | null = root;
  return {
    reusedParents,
    /** 마운트 도중 받은 요청은 임시로 연결하고, DOM 롤백 뒤에는 그 마운트의 setter를 다시 비활성화한다. */
    runWithMountingHooks(commitDOM) {
      for (const fiber of mountingHooks) stageMountingHooks(fiber);
      try {
        commitDOM();
      } catch (error) {
        for (const fiber of mountingHooks) detachFunctionHooks(fiber);
        throw error;
      }
    },
    /** 처리한 함수와 삭제 목록만 순회한다. bailout으로 통째로 공유된 가지는 이미 현재 setter를 가진다. */
    commitRenderHooks() {
      for (const siblings of deletedChildren) {
        for (const deleted of siblings) detachSubtreeHooks(deleted);
      }
      for (const fiber of mountingHooks) commitFunctionHooks(fiber);
      for (const fiber of updatedHooks) commitFunctionHooks(fiber);
    },
    /** 작업 하나를 끝낸 뒤 예산을 확인해 짧은 시간 조각에서도 순회가 진행되도록 한다. */
    performRenderWork(shouldYield) {
      while (workInProgress !== null) {
        const fiber: Fiber = workInProgress;
        if (inspectElement === undefined && --untilDepthCheck === 0) {
          untilDepthCheck = depthCheckInterval;
          if (isDeepBranch(fiber)) inspectElement = createCycleInspector();
        }
        const child = beginWork(fiber, children, inspectElement, reusedParents, renderLanes);
        if (fiber.tag === 'function' && fiber.memoizedState !== null) {
          if (fiber.alternate === null) mountingHooks.push(fiber);
          // 목록까지 공유한 setter는 이전 소유자를 유지해도 두 Fiber에 같은 lane을 표시한다.
          else if (fiber.memoizedState !== fiber.alternate.memoizedState) updatedHooks.push(fiber);
        }
        if (fiber.deletions !== null) deletedChildren.push(fiber.deletions);
        workInProgress = child ?? completeUnitOfWork(fiber, completeWork);
        if (workInProgress !== null && shouldYield?.()) return false;
      }
      return true;
    },
  };
}

/** 양보 조건 없이 같은 작업 루프를 실행해 루트 이하의 Fiber를 한 번에 처리한다. */
export function performSyncRenderWork(root: ParentFiber, children?: ElementChild, completeWork?: CompleteWork): void {
  createRenderWork(root, children, completeWork).performRenderWork();
}

/** Element에서 시작해 DOM 연결 없이 독립적인 Fiber 트리를 구성하고 최상위 Fiber를 반환한다. */
export function buildFiberTree(element: ReactifyElement): ElementFiber {
  const root = createFiberFromElement(element);
  performSyncRenderWork(root);
  return root;
}
