import type { ElementChild, ReactifyElement } from '../element/types.js';
import { createFiberFromElement, createTextFiber, reuseElementFiber, useAlternate } from './fiberNode.js';
import { ChildDeletion, Placement } from './flags.js';
import type { ChildFiber, ParentFiber } from './types.js';

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
    if (!current || current.tag === 'text' || current.type !== value.type) {
      return createFiberFromElement(value, parent);
    }
    return reuseElementFiber(current, parent, value);
  }

  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError('Unsupported child value');
  const text = String(value);
  if (current?.tag !== 'text') return createTextFiber(text, parent);
  const work = useAlternate(current, current.alternate ?? createTextFiber(text, parent), parent);
  work.pendingProps = text;
  return work;
}

/** 부모의 렌더를 건너뛰어도 자손 작업이 남아 있으면 직계 자식만 작업용 짝으로 만들어 이어 간다. */
export function cloneChildFibers(parent: ParentFiber, current: ParentFiber): ChildFiber | null {
  let previous: ChildFiber | null = null;
  for (let child = current.child; child !== null; child = child.sibling) {
    const copy = child.tag === 'text'
      ? reconcileChild(parent, child, child.text)
      : reuseElementFiber(child, parent);
    copy.index = child.index;
    if (previous === null) parent.child = copy;
    else previous.sibling = copy;
    previous = copy;
  }
  return parent.child;
}

/** 기존 자식을 부모의 삭제 목록에 넣고, 커밋이 이 부모에서 삭제를 처리하도록 표시한다. */
function deleteChild(parent: ParentFiber, child: ChildFiber): void {
  parent.flags |= ChildDeletion;
  (parent.deletions ??= []).push(child);
}

/** 첫 자식부터 마지막 형제까지 부모의 삭제 목록에 순서대로 기록한다. */
function deleteRemainingChildren(parent: ParentFiber, first: ChildFiber | null): void {
  for (let child = first; child !== null; child = child.sibling) deleteChild(parent, child);
}

/** 순차 비교가 중단된 위치부터 기존 자식을 명시적 key(문자열) 또는 형제 위치(숫자)로 찾을 수 있게 한다. */
function mapRemainingChildren(parent: ParentFiber, first: ChildFiber): Map<string | number, ChildFiber> {
  const remaining = new Map<string | number, ChildFiber>();
  for (let child: ChildFiber | null = first; child !== null; child = child.sibling) {
    const key = child.key ?? child.index;
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

/** 단일 Element는 key가 처음 일치한 형제에서 탐색을 멈추고, 타입까지 같으면 그 Fiber를 재사용한다. */
function reconcileSingleElement(parent: ParentFiber, current: ChildFiber | null, element: ReactifyElement): ChildFiber {
  const key = element.key ?? null;
  while (current !== null && current.key !== key) {
    deleteChild(parent, current);
    current = current.sibling;
  }
  const child = reconcileChild(parent, current, element);
  // 같은 타입이면 재사용한 형제 뒤부터, 타입이 다르면 교체할 형제부터 삭제한다.
  deleteRemainingChildren(parent, child.alternate === null ? current : child.alternate.sibling);
  placeChild(child, 0, 0, parent.alternate !== null);
  parent.child = child;
  return child;
}

/** 단일 Element는 형제의 key를 따라 찾고, 배열은 순차 비교가 어긋난 지점부터 key 또는 위치로 조회한다. */
export function reconcileChildren(parent: ParentFiber, children: ElementChild): ChildFiber | null {
  let current = parent.alternate?.child ?? null;
  if (children !== null && typeof children === 'object' && !isChildArray(children)) {
    return reconcileSingleElement(parent, current, children);
  }
  let remaining: Map<string | number, ChildFiber> | null = null;
  let previous: ChildFiber | null = null;
  let index = 0;
  let lastPlacedIndex = 0;
  for (const value of flattenChildren(children)) {
    if (value == null || typeof value === 'boolean') continue;
    const key = typeof value === 'object' ? value.key ?? null : null;
    if (current !== null && current.key !== key) {
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
  deleteRemainingChildren(parent, current);
  return parent.child;
}
