import type { ElementChild, ElementType, ReactifyElement } from '../element/types.js';
import type { Flags } from './flags.js';
import type { Hook } from './hooks.js';
import type { Lane, Lanes } from './lanes.js';
import type { RootUpdateQueue } from './updateQueue.js';

/** 하나의 DOM 컨테이너에서 렌더와 커밋을 관리하는 객체. current로 현재 트리의 시작점을 가리킨다. */
export interface FiberRoot {
  readonly container: Element;
  /** 처음에는 빈 HostRoot이며, 커밋이 끝날 때마다 방금 완성한 HostRoot를 가리킨다. */
  readonly current: HostRootFiber;
  /** 렌더를 마치고 커밋을 기다리는 HostRoot. 대기 중인 작업이 없으면 null이다. */
  readonly finishedWork: HostRootFiber | null;
  /** 이 루트에서 아직 처리할 업데이트의 lane 집합. */
  readonly pendingLanes: Lanes;
  /** 기다릴 수 있는 시간을 넘겨 다음 렌더가 양보하지 않고 처리할 lane 집합. */
  readonly expiredLanes: Lanes;
  /** 입력받은 자식으로 다음 트리를 만들고 DOM 변경이 필요한 Fiber를 표시한다. */
  prepare(children: ElementChild): void;
  /** 준비한 DOM 변경을 적용하고 현재 트리를 교체한다. */
  commit(): void;
  /** 화면 입력을 호출 문맥에 맞는 우선순위로 예약한다. DOM은 스케줄러가 커밋할 때 갱신된다. */
  render(children: ElementChild): void;
}

/** HostRoot를 통해 컴포넌트의 상태 갱신을 같은 루트 스케줄러로 전달하는 내부 인터페이스. */
export interface FiberRootInstance extends FiberRoot {
  /** 상태를 소유한 Fiber에 lane을 표시하고 루트에 작업을 예약한다. */
  scheduleStateUpdate(source: FunctionFiber, lane: Lane): void;
}

/** Fiber마다 보관하는 렌더 작업의 우선순위와 커밋에서 처리할 변경 표시. */
interface FiberWork {
  /** 이 Fiber 자체에 남은 업데이트의 lane 집합. */
  lanes: Lanes;
  /** 직계 자식부터 가장 깊은 자손까지 남은 업데이트의 lane 집합. */
  childLanes: Lanes;
  /** 이 Fiber 자체에서 처리할 변경. */
  flags: Flags;
  /** 직계 자식부터 가장 깊은 자손까지 필요한 변경을 모은 비트 마스크. */
  subtreeFlags: Flags;
  /** 이 부모 아래에서 제거할 기존 자식 Fiber. 삭제가 없으면 null이다. */
  deletions: ChildFiber[] | null;
}

/** Fiber 트리의 최상위 노드. child는 첫 자식이고, stateNode는 이 트리를 관리하는 FiberRoot다. */
export interface HostRootFiber extends FiberWork {
  readonly tag: 'root';
  readonly type: null;
  readonly key: null;
  readonly stateNode: FiberRootInstance;
  readonly return: null;
  readonly sibling: null;
  child: ChildFiber | null;
  /** 이 트리의 루트 큐를 처리해 얻은 화면 입력. */
  memoizedState: ElementChild;
  /** 이 루트에 접수한 화면 업데이트와 다음 렌더에서 이어 처리할 목록. */
  updateQueue: RootUpdateQueue;
  /** 다른 쪽 트리의 HostRoot. 첫 작업 트리를 준비할 때 서로 연결한다. */
  alternate: HostRootFiber | null;
}

/** 자식 Fiber의 순회 링크. return은 부모를, sibling은 같은 부모의 다음 자식을 가리킨다. */
interface ChildLinks extends FiberWork {
  /** 함수 컴포넌트의 상태 업데이트 큐는 각 Hook이 소유한다. */
  readonly updateQueue: null;
  /** 중첩 배열을 펼친 뒤의 형제 위치. 빈 슬롯도 위치를 차지하며, 커밋된 값은 이동 판정에 쓴다. */
  index: number;
  return: ParentFiber | null;
  sibling: ChildFiber | null;
}

/** HTML 요소와 함수 Fiber가 자기 위치의 key, 렌더 입력과 첫 자식을 보관한다. */
interface ElementFiberFields extends ChildLinks {
  /** 같은 부모 아래에서 형제끼리 짝을 찾을 때 쓰는 key다. */
  readonly key: string | null;
  /** 이번 렌더에서 처리할 props. */
  pendingProps: ReactifyElement['props'];
  /** 이 Fiber가 마지막으로 처리한 props. 아직 한 번도 처리하지 않았으면 null이다. */
  memoizedProps: ReactifyElement['props'] | null;
  child: ChildFiber | null;
}

/** HTML 태그에 대응하는 Fiber. DOM을 준비하면 stateNode가 실제 Element를 가리킨다. */
export interface HostElementFiber extends ElementFiberFields {
  readonly tag: 'element';
  /** 비교와 DOM 생성에 직접 사용하는 태그 이름이다. */
  readonly type: string;
  alternate: HostElementFiber | null;
  stateNode: Element | null;
}

/** 함수 컴포넌트의 반환값을 자식으로 연결하는 Fiber. 자체 DOM이 없어 stateNode는 항상 null이다. */
export interface FunctionFiber extends ElementFiberFields {
  readonly tag: 'function';
  /** 비교와 컴포넌트 호출에 직접 사용하는 함수 참조다. */
  readonly type: Exclude<ElementType, string>;
  /** 이 컴포넌트가 호출 순서대로 연결한 state·effect·memo Hook 목록의 첫 노드. */
  memoizedState: Hook | null;
  alternate: FunctionFiber | null;
  readonly stateNode: null;
}

/** ReactifyElement에서 만드는 두 종류의 Fiber. type이 태그인지 함수인지에 따라 결정된다. */
export type ElementFiber = HostElementFiber | FunctionFiber;

/** 문자열과 숫자를 문자열로 보관하는 말단 Fiber. DOM을 준비하면 stateNode가 Text 노드를 가리킨다. */
export interface TextFiber extends ChildLinks {
  readonly tag: 'text';
  readonly type: null;
  readonly key: null;
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
