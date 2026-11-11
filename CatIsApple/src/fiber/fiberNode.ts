import type { ElementType, ReactifyElement } from '../element/types.js';
import { NoFlags } from './flags.js';
import { NoLanes, type Lane } from './lanes.js';
import type { ChildFiber, ElementFiber, Fiber, HostRootFiber, ParentFiber, TextFiber } from './types.js';

/** 호스트와 함수 Fiber를 각각 하나의 객체로 할당한다. 마운트와 첫 alternate 생성이 같은 배치를 사용한다. */
function allocateElementFiber(
  type: ElementType, key: string | null, props: ReactifyElement['props'], parent: ParentFiber | null,
): ElementFiber {
  if (typeof type === 'string') {
    return {
      tag: 'element', type, key, index: 0, return: parent, child: null, sibling: null,
      alternate: null, stateNode: null, pendingProps: props, memoizedProps: null,
      lanes: NoLanes, childLanes: NoLanes, updateQueue: null,
      flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
    };
  }
  return {
    tag: 'function', type, key, index: 0, return: parent, child: null, sibling: null,
    alternate: null, stateNode: null, pendingProps: props, memoizedProps: null, memoizedState: null,
    lanes: NoLanes, childLanes: NoLanes, updateQueue: null,
    flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
  };
}

/** Element에서 type·key·props를 읽어 해당 위치의 Fiber를 만든다. */
export function createFiberFromElement(
  element: ReactifyElement,
  parent: ParentFiber | null = null,
): ElementFiber {
  const { type, key, props } = element;
  if ((typeof type !== 'string' && typeof type !== 'function') || props === null || typeof props !== 'object') {
    throw new TypeError('Expected an Element with a tag or component function and props');
  }
  return allocateElementFiber(type, key ?? null, props, parent);
}

/** 표시할 문자열을 담은 텍스트 Fiber를 만들고 부모를 연결한다. */
export function createTextFiber(text: string, parent: ParentFiber): TextFiber {
  return {
    tag: 'text', type: null, key: null, pendingProps: text, index: 0, return: parent, child: null, sibling: null,
    alternate: null, stateNode: null, memoizedProps: null,
    lanes: NoLanes, childLanes: NoLanes, updateQueue: null,
    flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
    /** 이 Fiber가 이번 렌더에서 표시할 문자열을 반환한다. */
    get text() { return this.pendingProps; },
  };
}

/** 매칭된 Fiber의 type·key를 유지하고 새 입력의 props를 받는다. bailout 복제에는 current의 입력을 쓴다. */
export function reuseElementFiber(current: ElementFiber, parent: ParentFiber, input?: ReactifyElement): ElementFiber {
  const props = input === undefined ? current.pendingProps : input.props;
  if (props === null || typeof props !== 'object') throw new TypeError('Expected an Element with props');
  const alternate = current.alternate ?? allocateElementFiber(current.type, current.key, props, parent);
  const work = prepareAlternateFiber(current, alternate, parent);
  work.pendingProps = props;
  if (work.tag === 'function' && current.tag === 'function') work.memoizedState = current.memoizedState;
  work.child = null;
  return work;
}

/** 두 Fiber를 서로의 alternate로 연결하고, 작업 Fiber에 마지막으로 처리한 props와 기존 DOM 참조를 복사한다. */
export function prepareAlternateFiber<F extends ChildFiber>(current: F, work: F, parent: ParentFiber): F {
  current.alternate = work;
  work.alternate = current;
  work.return = parent;
  work.sibling = null;
  work.flags = NoFlags;
  work.subtreeFlags = NoFlags;
  work.lanes = current.lanes;
  work.childLanes = current.childLanes;
  work.deletions = null;
  if (work.tag !== 'function') work.stateNode = current.stateNode;
  work.memoizedProps = current.memoizedProps;
  return work;
}

/** 가지의 자식을 먼저 방문하고, 마지막 자손 뒤에는 경계 밖 형제로 넘어가지 않는다. */
export function getNextFiberInSubtree(fiber: ChildFiber, boundary: ChildFiber): ChildFiber | null {
  if (fiber.child !== null) return fiber.child;
  let cursor: Fiber = fiber;
  while (cursor !== boundary && cursor.sibling === null) cursor = cursor.return!;
  return cursor === boundary ? null : cursor.sibling;
}

/** 업데이트를 받은 Fiber와 그 짝에 lane을 표시하고, 양쪽 조상의 childLanes를 거쳐 HostRoot를 찾는다. */
export function markUpdateLaneFromFiberToRoot(source: Fiber, lane: Lane): HostRootFiber | null {
  source.lanes |= lane;
  if (source.alternate !== null) source.alternate.lanes |= lane;
  let fiber = source;
  while (fiber.return !== null) {
    fiber = fiber.return;
    fiber.childLanes |= lane;
    if (fiber.alternate !== null) fiber.alternate.childLanes |= lane;
  }
  return fiber.tag === 'root' ? fiber : null;
}
