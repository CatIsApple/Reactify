import { getEventPriority } from '../dom/index.js';
import { getHighestPriorityLane, IdleLane, getLaneForPriority, NoLane, type Lane, type Lanes, type RenderPriority } from './lanes.js';

let inTransition = false;
let currentPriority: RenderPriority | undefined;
let currentRenderLane: Lane = NoLane;

/** 콜백이 동기로 등록하는 갱신을 전환으로 표시한다. 반환하거나 예외를 던지면 바깥 문맥을 복원한다. */
export function startTransition<T>(scope: () => T): T {
  const previous = inTransition;
  inTransition = true;
  try {
    return scope();
  } finally {
    inTransition = previous;
  }
}

/** 콜백 실행 중 사용할 갱신 우선순위를 지정하고, 중첩 호출이나 예외 뒤에도 원래 값으로 복원한다. */
export function runWithPriority<T>(priority: RenderPriority, scope: () => T): T {
  const previous = currentPriority;
  currentPriority = priority;
  try {
    return scope();
  } finally {
    currentPriority = previous;
  }
}

/** 이번 Fiber 렌더 조각 안에서 발생한 갱신은 실행 중인 lane을 사용하고, 양보하면 이전 문맥으로 복원한다. */
export function runWithRenderLanes<T>(lanes: Lanes, scope: () => T): T {
  const previous = currentRenderLane;
  currentRenderLane = getHighestPriorityLane(lanes);
  try {
    return scope();
  } finally {
    currentRenderLane = previous;
  }
}

/** 커밋 콜백은 렌더 lane과 바깥 전환에서 분리해 실행하고 호출자의 문맥을 복원한다. */
function runCommitCallback<T>(priority: RenderPriority, scope: () => T): T {
  const previousLane = currentRenderLane;
  const previousTransition = inTransition;
  currentRenderLane = NoLane;
  inTransition = false;
  try {
    return runWithPriority(priority, scope);
  } finally {
    currentRenderLane = previousLane;
    inTransition = previousTransition;
  }
}

/** DOM 커밋 도중 요청한 갱신은 동기 우선순위로 처리한다. */
export function runWithCommitPriority<T>(scope: () => T): T {
  return runCommitCallback('sync', scope);
}

/** effect의 상태 요청에는 기본 우선순위를 주고, 유휴 커밋의 effect만 유휴 우선순위를 유지한다. */
export function runWithPassivePriority<T>(lanes: Lanes, scope: () => T): T {
  return runCommitCallback(getHighestPriorityLane(lanes) === IdleLane ? 'idle' : 'normal', scope);
}

/** 렌더 중인 lane, 전환, 지정한 문맥, 현재 DOM 이벤트 순으로 이번 갱신의 lane을 고른다. */
export function requestUpdateLane(view: Window | null): Lane {
  if (currentRenderLane !== NoLane) return currentRenderLane;
  if (inTransition) return getLaneForPriority('transition');
  if (currentPriority !== undefined) return getLaneForPriority(currentPriority);
  // 다른 문서의 루트를 갱신할 때는 이벤트가 발생한 호출 측 창에만 현재 이벤트가 있을 수 있다.
  const currentEvent = view?.event ?? (typeof window === 'undefined' ? undefined : window.event);
  return getLaneForPriority(currentEvent ? getEventPriority(currentEvent.type) : 'normal');
}
