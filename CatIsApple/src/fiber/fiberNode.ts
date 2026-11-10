import type { ReactifyElement } from '../element/types.js';
import { NoFlags } from './flags.js';
import { NoLanes, type Lane } from './lanes.js';
import type { ChildFiber, ElementFiber, Fiber, HostRootFiber, ParentFiber, TextFiber } from './types.js';

// 순환 검사용 표식만 공유한다. 약한 키와 symbol 값은 원본 Element를 붙잡지 않는다.
const cycleTokens = new WeakMap<ReactifyElement | ElementFiber, symbol>();

/** 같은 Element가 조상 경로에 다시 나타나는지 검사할 때 쓸 표식을 얻는다. */
export function getCycleToken(source: ReactifyElement | ElementFiber): symbol {
  let token = cycleTokens.get(source);
  if (token === undefined) {
    token = Symbol();
    cycleTokens.set(source, token);
  }
  return token;
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
    key: key ?? null, index: 0, return: parent, child: null, sibling: null,
    alternate: null, stateNode: null, pendingProps: props, memoizedProps: null,
    lanes: NoLanes, childLanes: NoLanes, updateQueue: null,
    flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
  };
  const fiber: ElementFiber = typeof type === 'string'
    ? { ...fields, tag: 'element', type }
    : { ...fields, tag: 'function', type, memoizedState: null };
  cycleTokens.set(fiber, getCycleToken(element));
  return fiber;
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
  cycleTokens.set(work, getCycleToken(input ?? current));
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
