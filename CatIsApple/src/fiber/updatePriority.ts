import { getEventPriority } from '../dom/index.js';
import { getHighestPriorityLane, laneForPriority, NoLane, type Lane, type Lanes, type RenderPriority } from './lanes.js';

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

/** DOM 커밋 콜백에서 요청하는 갱신은 동기 우선순위로 처리하고, 커밋이 끝나면 호출자의 문맥을 복원한다. */
export function runWithCommitPriority<T>(scope: () => T): T {
  const previousLane = currentRenderLane;
  const previousTransition = inTransition;
  currentRenderLane = NoLane;
  inTransition = false;
  try {
    return runWithPriority('sync', scope);
  } finally {
    currentRenderLane = previousLane;
    inTransition = previousTransition;
  }
}

/** 렌더 중인 lane, 전환, 지정한 문맥, 현재 DOM 이벤트 순으로 이번 갱신의 lane을 고른다. */
export function requestUpdateLane(view: Window | null): Lane {
  if (currentRenderLane !== NoLane) return currentRenderLane;
  if (inTransition) return laneForPriority('transition');
  if (currentPriority !== undefined) return laneForPriority(currentPriority);
  // 다른 문서의 루트를 갱신할 때는 이벤트가 발생한 호출 측 창에만 현재 이벤트가 있을 수 있다.
  const currentEvent = view?.event ?? (typeof window === 'undefined' ? undefined : window.event);
  return laneForPriority(currentEvent ? getEventPriority(currentEvent.type) : 'normal');
}
