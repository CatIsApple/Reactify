import type { ElementChild, ReactifyElement } from '../element/types.js';
import { ChildDeletion, NoFlags, Placement } from './flags.js';
import type { ChildFiber, ElementFiber, Fiber, ParentFiber, TextFiber } from './types.js';

/** Element의 타입에 따라 호스트 또는 함수 Fiber를 만들고, 부모와 이번 렌더의 props를 기록한다. */
export function createFiberFromElement(
  element: ReactifyElement,
  parent: ParentFiber | null = null,
): ElementFiber {
  const { type, props } = element;
  if ((typeof type !== 'string' && typeof type !== 'function') || props === null || typeof props !== 'object') {
    throw new TypeError('Expected an Element with a tag or component function and props');
  }
  return {
    tag: typeof type === 'function' ? 'function' : 'element',
    element, index: 0, return: parent, child: null, sibling: null,
    alternate: null, stateNode: null, pendingProps: props, memoizedProps: null,
    flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
  };
}

/** 표시할 문자열을 담은 텍스트 Fiber를 만들고 부모를 연결한다. */
function createTextFiber(text: string, parent: ParentFiber): TextFiber {
  return {
    tag: 'text', pendingProps: text, index: 0, return: parent, child: null, sibling: null,
    alternate: null, stateNode: null, memoizedProps: null,
    flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
    /** 이 Fiber가 이번 렌더에서 표시할 문자열을 반환한다. */
    get text() { return this.pendingProps; },
  };
}

/** 자식 값이 배열인지 판별해 각 항목을 순회할 수 있게 한다. */
function isChildArray(value: ElementChild): value is readonly ElementChild[] {
  return Array.isArray(value);
}

/** 중첩 배열을 입력 순서대로 펼쳐 같은 부모의 자식을 하나씩 내보낸다. 순환 배열은 예외로 처리한다. */
function* flattenChildren(children: ElementChild): Generator<Exclude<ElementChild, readonly ElementChild[]>> {
  if (!isChildArray(children)) {
    yield children;
    return;
  }

  const activeArrays = new Set([children]);
  const levels = [{ array: children, items: children.values() }];
  while (levels.length > 0) {
    const level = levels[levels.length - 1];
    const next = level.items.next();
    if (next.done) {
      activeArrays.delete(level.array);
      levels.pop();
    } else if (isChildArray(next.value)) {
      const array = next.value;
      if (activeArrays.has(array)) throw new TypeError('Cycle in Element children');
      activeArrays.add(array);
      levels.push({ array, items: array.values() });
    } else {
      yield next.value;
    }
  }
}

/** 두 Fiber를 서로의 alternate로 연결하고, 작업 Fiber에 마지막으로 처리한 props와 기존 DOM 참조를 복사한다. */
function useAlternate<F extends ChildFiber>(current: F, work: F, parent: ParentFiber): F {
  current.alternate = work;
  work.alternate = current;
  work.return = parent;
  work.sibling = null;
  work.flags = NoFlags;
  work.subtreeFlags = NoFlags;
  work.deletions = null;
  if (work.tag !== 'function') work.stateNode = current.stateNode;
  work.memoizedProps = current.memoizedProps;
  return work;
}

/**
 * key 또는 위치로 찾은 후보와 새 Element의 타입이 같거나 양쪽 모두 텍스트면 기존 Fiber의 짝을 준비한다.
 * 후보가 없거나 타입이 바뀌면 새 Fiber를 만든다.
 */
function reconcileChild(
  parent: ParentFiber,
  current: ChildFiber | null,
  value: ReactifyElement | string | number,
): ChildFiber {
  if (typeof value === 'object') {
    if (!current || current.tag === 'text' || current.element.type !== value.type) {
      return createFiberFromElement(value, parent);
    }
    let work = current.alternate;
    if (work === null) {
      work = createFiberFromElement(value, parent);
    } else {
      work.element = value;
      work.pendingProps = value.props;
      work.child = null;
    }
    return useAlternate(current, work, parent);
  }

  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError('Unsupported child value');
  const text = String(value);
  if (current?.tag !== 'text') return createTextFiber(text, parent);
  const work = useAlternate(current, current.alternate ?? createTextFiber(text, parent), parent);
  work.pendingProps = text;
  return work;
}

/** 기존 자식을 부모의 삭제 목록에 넣고, 커밋이 이 부모에서 삭제를 처리하도록 표시한다. */
function deleteChild(parent: ParentFiber, child: ChildFiber): void {
  parent.flags |= ChildDeletion;
  (parent.deletions ??= []).push(child);
}

/** 기존 자식의 명시적 key를 읽는다. null이면 형제 위치를 사용한다. */
function fiberKey(child: ChildFiber): string | null {
  return child.tag === 'text' ? null : child.element.key ?? null;
}

/** 순차 비교가 중단된 위치부터 기존 자식을 명시적 key(문자열) 또는 형제 위치(숫자)로 찾을 수 있게 한다. */
function mapRemainingChildren(parent: ParentFiber, first: ChildFiber): Map<string | number, ChildFiber> {
  const remaining = new Map<string | number, ChildFiber>();
  for (let child: ChildFiber | null = first; child !== null; child = child.sibling) {
    const key = fiberKey(child) ?? child.index;
    // 중복 key는 마지막 후보를 보관하고, 가려지는 이전 Fiber도 커밋에서 제거한다.
    const duplicate = remaining.get(key);
    if (duplicate !== undefined) deleteChild(parent, duplicate);
    remaining.set(key, child);
  }
  return remaining;
}

/** 새 위치를 기록하고 삽입·이동할 자식에 Placement를 표시한다. 반환값은 이동 없이 재사용한 자식 중 가장 큰 이전 인덱스다. */
function placeChild(child: ChildFiber, index: number, lastPlacedIndex: number, trackPlacement: boolean): number {
  child.index = index;
  if (!trackPlacement) return lastPlacedIndex;
  const current = child.alternate;
  if (current !== null && current.index >= lastPlacedIndex) return current.index;
  child.flags |= Placement;
  return lastPlacedIndex;
}

/**
 * 앞에서부터 key를 비교하다가 어긋나면 남은 형제들을 key 또는 위치로 찾아 연결한다.
 * null, undefined, 불리언은 형제 위치를 차지하지 않는다.
 */
function reconcileChildren(parent: ParentFiber, children: ElementChild): ChildFiber | null {
  let current = parent.alternate?.child ?? null;
  let remaining: Map<string | number, ChildFiber> | null = null;
  let previous: ChildFiber | null = null;
  let index = 0;
  let lastPlacedIndex = 0;
  for (const value of flattenChildren(children)) {
    if (value == null || typeof value === 'boolean') continue;
    const key = typeof value === 'object' ? value.key ?? null : null;
    if (current !== null && fiberKey(current) !== key) {
      remaining = mapRemainingChildren(parent, current);
      current = null;
    }
    const lookup = key ?? index;
    const candidate = remaining === null ? current : remaining.get(lookup) ?? null;
    const child = reconcileChild(parent, candidate, value);
    if (remaining !== null) {
      // 타입이 달라 재사용하지 못한 후보는 남겨 두고, 마지막까지 남은 항목만 한 번 삭제한다.
      if (child.alternate !== null) remaining.delete(lookup);
    } else if (current !== null) {
      if (child.alternate === null) deleteChild(parent, current);
      current = current.sibling;
    }
    lastPlacedIndex = placeChild(child, index, lastPlacedIndex, parent.alternate !== null);
    if (previous === null) parent.child = child;
    else previous.sibling = child;
    previous = child;
    index++;
  }
  if (remaining !== null) {
    for (const oldChild of remaining.values()) deleteChild(parent, oldChild);
  }
  while (current !== null) {
    deleteChild(parent, current);
    current = current.sibling;
  }
  return parent.child;
}

/** 루트 입력, 함수 컴포넌트의 반환값 또는 호스트의 children을 조정하고 다음에 처리할 첫 자식을 반환한다. */
function beginWork(fiber: Fiber, rootChildren: ElementChild, activeElements: Set<ReactifyElement>): ChildFiber | null {
  if (fiber.tag === 'root') return reconcileChildren(fiber, rootChildren);
  if (fiber.tag === 'text') {
    fiber.memoizedProps = fiber.pendingProps;
    return null;
  }

  const { element, pendingProps } = fiber;
  if (activeElements.has(element)) throw new TypeError('Cycle in Element children');
  activeElements.add(element);
  let children: ElementChild;
  if (fiber.tag === 'function') {
    // createElement 호출 시 컴포넌트별 props 타입을 검사한다. 여기서는 공통 Fiber 타입에 저장된 함수를 호출한다.
    const Component = element.type as (props: typeof pendingProps) => ElementChild;
    children = Component(pendingProps);
  } else if (Object.hasOwn(pendingProps, 'children')) {
    children = pendingProps.children;
  }
  const child = reconcileChildren(fiber, children);
  fiber.memoizedProps = pendingProps;
  return child;
}

/** 자식 처리를 마친 Fiber 하나에 대해 호출하는 콜백 타입. DOM 렌더러는 여기서 커밋할 변경을 준비한다. */
type CompleteWork = (fiber: Fiber) => void;

/** 완료한 Fiber와 그 자손의 플래그를 부모에 합친다. 다음 형제가 없으면 부모로 올라가서 완료를 이어 간다. */
function completeUnitOfWork(
  fiber: Fiber,
  activeElements: Set<ReactifyElement>,
  completeWork?: CompleteWork,
): ChildFiber | null {
  let completed: Fiber | null = fiber;
  while (completed !== null) {
    completeWork?.(completed);
    const parent: ParentFiber | null = completed.return;
    if (parent !== null) parent.subtreeFlags |= completed.flags | completed.subtreeFlags;
    if (completed.tag === 'element' || completed.tag === 'function') activeElements.delete(completed.element);
    if (completed.sibling !== null) return completed.sibling;
    completed = parent;
  }
  return null;
}

/** 루트부터 자식으로 내려가고 형제와 부모를 따라가며 모든 Fiber의 렌더 작업을 동기로 끝낸다. */
export function performSyncWork(root: ParentFiber, children?: ElementChild, completeWork?: CompleteWork): void {
  const activeElements = new Set<ReactifyElement>();
  let workInProgress: Fiber | null = root;
  while (workInProgress !== null) {
    workInProgress = beginWork(workInProgress, children, activeElements)
      ?? completeUnitOfWork(workInProgress, activeElements, completeWork);
  }
}

/** Element에서 시작해 DOM 연결 없이 독립적인 Fiber 트리를 구성하고 최상위 Fiber를 반환한다. */
export function buildFiberTree(element: ReactifyElement): ElementFiber {
  const root = createFiberFromElement(element);
  performSyncWork(root);
  return root;
}
