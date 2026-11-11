import type { VElement, VNode } from './nodes.js';

/** 각 경로는 컨테이너에서 시작하는 자식 인덱스이며 앞선 변경을 적용한 시점을 기준으로 한다. */
export type Patch =
  | { type: 'insert' | 'replace'; path: number[]; node: VNode }
  | { type: 'remove'; path: number[] }
  | { type: 'text'; path: number[]; text: string }
  | { type: 'props'; path: number[]; previous: VElement; next: VElement };

/** 선언한 키의 개수와 값을 비교해 사라진 속성과 바뀐 이벤트 함수도 검출한다. */
function sameFields<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && a[key] === b[key]);
}

/** 자식과 별도로 비교하는 요소 자신의 속성·이벤트·폼 상태. */
function sameProps(a: VElement, b: VElement): boolean {
  return sameFields(a.attrs, b.attrs) && sameFields(a.events, b.events) && sameFields(a.form, b.form);
}

/** 길이가 달라진 형제 목록에서 그대로 남은 앞뒤 하위 트리를 찾는다. */
function sameTree(a: VNode, b: VNode): boolean {
  if (a === b) return true;
  if (a.kind !== 'element' || b.kind !== 'element') {
    return a.kind !== 'element' && b.kind !== 'element' && a.kind === b.kind && a.text === b.text;
  }
  return a.tag === b.tag && a.namespace === b.namespace && sameProps(a, b)
    && a.children.length === b.children.length && a.children.every((child, i) => sameTree(child, b.children[i]));
}

/** 두 스냅샷만 비교한다. 실제 DOM은 patch를 호출할 때 변경된다. */
export function diff(previous: readonly VNode[], next: readonly VNode[]): Patch[] {
  const changes: Patch[] = [];
  /** 형제 위치를 기준으로 바뀐 구간을 비교하고, 삭제는 뒤에서부터 기록한다. */
  function compareChildren(before: readonly VNode[], after: readonly VNode[], path: number[]): void {
    let start = 0;
    let oldEnd = before.length;
    let newEnd = after.length;
    if (oldEnd !== newEnd) {
      while (start < oldEnd && start < newEnd && sameTree(before[start], after[start])) start++;
      while (oldEnd > start && newEnd > start && sameTree(before[oldEnd - 1], after[newEnd - 1])) {
        oldEnd--;
        newEnd--;
      }
    }
    const sharedEnd = Math.min(oldEnd, newEnd);
    for (let i = start; i < sharedEnd; i++) {
      const a = before[i];
      const b = after[i];
      if (a === b) continue;
      const at = [...path, i];
      if (a.kind === 'element' && b.kind === 'element' && a.tag === b.tag && a.namespace === b.namespace) {
        // select.multiple 같은 속성은 자식 옵션의 선택 동작에 영향을 주므로 먼저 적용한다.
        if (!sameProps(a, b)) changes.push({ type: 'props', path: at, previous: a, next: b });
        const priorChanges = changes.length;
        compareChildren(a.children, b.children, at);
        if (changes.length !== priorChanges && (b.tag === 'select' || b.tag === 'textarea') && Object.keys(b.form).length) {
          // 브라우저가 자식 변경에 따라 선택이나 입력값을 바꿨다면 스냅샷의 현재값을 복원한다.
          changes.push({ type: 'props', path: at, previous: b, next: b });
        }
      } else if (a.kind !== 'element' && b.kind !== 'element' && a.kind === b.kind) {
        if (a.text !== b.text) changes.push({ type: 'text', path: at, text: b.text });
      } else {
        changes.push({ type: 'replace', path: at, node: b });
      }
    }
    for (let i = oldEnd - 1; i >= sharedEnd; i--) changes.push({ type: 'remove', path: [...path, i] });
    for (let i = sharedEnd; i < newEnd; i++) changes.push({ type: 'insert', path: [...path, i], node: after[i] });
  }
  compareChildren(previous, next, []);
  return changes;
}
