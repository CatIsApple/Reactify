import type { ElementChild, ReactifyElement } from '../element/types.js';
import type { Flags } from './flags.js';

/** 하나의 DOM 컨테이너에서 렌더와 커밋을 관리하는 객체. current로 현재 트리의 시작점을 가리킨다. */
export interface FiberRoot {
  readonly container: Element;
  /** 처음에는 빈 HostRoot이며, 커밋이 끝날 때마다 방금 완성한 HostRoot를 가리킨다. */
  readonly current: HostRootFiber;
  /** 렌더를 마치고 커밋을 기다리는 HostRoot. 대기 중인 작업이 없으면 null이다. */
  readonly finishedWork: HostRootFiber | null;
  /** 입력받은 자식으로 다음 트리를 만들고 DOM 변경이 필요한 Fiber를 표시한다. */
  prepare(children: ElementChild): void;
  /** 준비한 DOM 변경을 적용하고 현재 트리를 교체한다. */
  commit(): void;
  /** 준비와 커밋을 차례로 실행해 화면을 갱신한다. */
  render(children: ElementChild): void;
}

/** 커밋에서 처리할 변경과 그 변경이 있는 자손을 찾는 데 사용하는 공통 필드. */
interface FiberEffects {
  /** 이 Fiber 자체에서 처리할 변경. */
  flags: Flags;
  /** 직계 자식부터 가장 깊은 자손까지 필요한 변경을 모은 비트 마스크. */
  subtreeFlags: Flags;
  /** 이 부모 아래에서 제거할 기존 자식 Fiber. 삭제가 없으면 null이다. */
  deletions: ChildFiber[] | null;
}

/** Fiber 트리의 최상위 노드. child는 첫 자식이고, stateNode는 이 트리를 관리하는 FiberRoot다. */
export interface HostRootFiber extends FiberEffects {
  readonly tag: 'root';
  readonly stateNode: FiberRoot;
  readonly return: null;
  readonly sibling: null;
  child: ChildFiber | null;
  /** 다른 쪽 트리의 HostRoot. 첫 작업 트리를 준비할 때 서로 연결한다. */
  alternate: HostRootFiber | null;
}

/** 자식 Fiber의 순회 링크. return은 부모를, sibling은 같은 부모의 다음 자식을 가리킨다. */
interface ChildLinks extends FiberEffects {
  /** 중첩 배열을 펼치고 빈 값을 건너뛴 뒤의 형제 위치. 커밋된 트리의 값은 이동 판정에 쓴다. */
  index: number;
  return: ParentFiber | null;
  sibling: ChildFiber | null;
}

/** HTML 요소와 함수 컴포넌트 Fiber가 공통으로 보관하는 원본 Element, 렌더 입력, 첫 자식. */
interface ElementFiberFields extends ChildLinks {
  element: ReactifyElement;
  /** 이번 렌더에서 처리할 props. */
  pendingProps: ReactifyElement['props'];
  /** 이 Fiber가 마지막으로 처리한 props. 아직 한 번도 처리하지 않았으면 null이다. */
  memoizedProps: ReactifyElement['props'] | null;
  child: ChildFiber | null;
}

/** HTML 태그에 대응하는 Fiber. DOM을 준비하면 stateNode가 실제 Element를 가리킨다. */
export interface HostElementFiber extends ElementFiberFields {
  readonly tag: 'element';
  alternate: HostElementFiber | null;
  stateNode: Element | null;
}

/** 함수 컴포넌트의 반환값을 자식으로 연결하는 Fiber. 자체 DOM이 없어 stateNode는 항상 null이다. */
export interface FunctionFiber extends ElementFiberFields {
  readonly tag: 'function';
  alternate: FunctionFiber | null;
  readonly stateNode: null;
}

/** ReactifyElement에서 만드는 두 종류의 Fiber. type이 태그인지 함수인지에 따라 결정된다. */
export type ElementFiber = HostElementFiber | FunctionFiber;

/** 문자열과 숫자를 문자열로 보관하는 말단 Fiber. DOM을 준비하면 stateNode가 Text 노드를 가리킨다. */
export interface TextFiber extends ChildLinks {
  readonly tag: 'text';
  readonly text: string;
  pendingProps: string;
  memoizedProps: string | null;
  readonly child: null;
  alternate: TextFiber | null;
  stateNode: Text | null;
}

/** 자식 목록을 소유할 수 있는 Fiber로, 자식의 return이 가리킬 수 있다. */
export type ParentFiber = HostRootFiber | ElementFiber;
/** 부모의 child 또는 형제의 sibling 링크로 연결할 수 있는 Fiber. */
export type ChildFiber = ElementFiber | TextFiber;
/** 작업 루프가 방문하는 모든 노드의 합집합. tag로 루트·HTML 요소·함수·텍스트를 구분한다. */
export type Fiber = HostRootFiber | ChildFiber;
