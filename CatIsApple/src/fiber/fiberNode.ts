import type { ReactifyElement } from '../element/types.js';
import { NoFlags } from './flags.js';
import { NoLanes, type Lane } from './lanes.js';
import type { ChildFiber, ElementFiber, Fiber, HostRootFiber, ParentFiber, TextFiber } from './types.js';

// Element 객체를 처음 만난 순서다. Fiber에는 번호만 남겨 원본 Element의 수명을 늘리지 않는다.
const elementIds = new WeakMap<ReactifyElement, number>();
let lastElementId = 0;

/** 같은 Element를 재사용하면 기존 번호를, 처음 보는 객체에는 이전보다 큰 번호를 준다. */
function getElementId(element: ReactifyElement): number {
  const previous = elementIds.get(element);
  if (previous !== undefined) return previous;
  if (lastElementId === Number.MAX_SAFE_INTEGER) throw new RangeError('Element identity limit exceeded');
  const id = ++lastElementId;
  elementIds.set(element, id);
  return id;
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
  const fields = {
    key: key ?? null, elementId: getElementId(element), maxPathId: 0,
    index: 0, return: parent, child: null, sibling: null,
    alternate: null, stateNode: null, pendingProps: props, memoizedProps: null,
    lanes: NoLanes, childLanes: NoLanes, updateQueue: null,
    flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
  };
  return typeof type === 'string'
    ? { ...fields, tag: 'element', type }
    : { ...fields, tag: 'function', type, memoizedState: null };
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
  const work = useAlternate(current, current.alternate ?? { ...current }, parent);
  work.pendingProps = props;
  if (work.tag === 'function' && current.tag === 'function') work.memoizedState = current.memoizedState;
  work.child = null;
  work.elementId = input === undefined ? current.elementId : getElementId(input);
  return work;
}

/** 두 Fiber를 서로의 alternate로 연결하고, 작업 Fiber에 마지막으로 처리한 props와 기존 DOM 참조를 복사한다. */
export function useAlternate<F extends ChildFiber>(current: F, work: F, parent: ParentFiber): F {
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
export function nextInSubtree(fiber: ChildFiber, boundary: ChildFiber): ChildFiber | null {
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
