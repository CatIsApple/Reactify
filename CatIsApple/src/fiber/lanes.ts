import type { SchedulerPriority } from '../scheduler/index.js';

/** 갱신 하나의 우선순위를 나타내는 단일 비트다. 재적용할 갱신에는 0을 쓴다. */
export type Lane = number;
/** 한 Fiber나 루트에서 처리할 lane들을 OR로 모은 비트 마스크다. */
export type Lanes = number;
/** 루트 렌더를 예약할 때 지정할 수 있는 우선순위다. background는 transition의 기존 이름이다. */
export type RenderPriority = 'sync' | 'user-blocking' | 'normal' | 'transition' | 'background' | 'idle';

// React의 클라이언트 갱신용 비트 위치를 따른다. 사이에 있는 hydration 등의 비트는 사용하지 않는다.
export const NoLane: Lane = 0;
export const NoLanes: Lanes = 0;
export const SyncLane: Lane = 1 << 1;
export const InputContinuousLane: Lane = 1 << 3;
export const DefaultLane: Lane = 1 << 5;
const FirstTransitionLane: Lane = 1 << 8;
export const TransitionLanes: Lanes = ((1 << 10) - 1) << 8;
export const IdleLane: Lane = 1 << 28;

const SyncUpdateLanes = SyncLane | InputContinuousLane | DefaultLane;
let nextTransitionLane = FirstTransitionLane;
let currentEventTransitionLane = NoLane;

/** 같은 이벤트의 전환에는 같은 비트를 배정하고, 다음 이벤트가 오면 열 개의 비트를 순환한다. */
function requestTransitionLane(): Lane {
  if (currentEventTransitionLane === NoLane) {
    currentEventTransitionLane = nextTransitionLane;
    nextTransitionLane <<= 1;
    if ((nextTransitionLane & TransitionLanes) === NoLanes) nextTransitionLane = FirstTransitionLane;
    // 같은 호출 스택의 전환 요청을 모은 뒤 다음 마이크로태스크부터 새 lane을 배정한다.
    queueMicrotask(() => { currentEventTransitionLane = NoLane; });
  }
  return currentEventTransitionLane;
}

/** 루트 API의 요청을 Fiber 갱신 큐에 남길 단일 lane으로 변환한다. */
export function laneForPriority(priority: RenderPriority): Lane {
  switch (priority) {
    case 'sync': return SyncLane;
    case 'user-blocking': return InputContinuousLane;
    case 'normal': return DefaultLane;
    case 'transition':
    case 'background': return requestTransitionLane();
    case 'idle': return IdleLane;
    default: throw new TypeError('Unknown render priority');
  }
}

/** 비트 위치가 가장 낮은 대기 lane을 고른다. 대기 중인 갱신이 없으면 0이다. */
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

/** 입력·기본 갱신을 함께 처리하고, 현재 렌더를 중단할 필요가 있을 때만 새 lane을 선택한다. */
export function getNextLanes(pending: Lanes, wip: Lanes = NoLanes): Lanes {
  if (pending === NoLanes) return NoLanes;
  const next = (pending & SyncUpdateLanes) || getHighestPriorityLane(pending);
  if (wip === NoLanes || (wip & pending) !== wip) return next;
  const nextLane = getHighestPriorityLane(next);
  const currentLane = getHighestPriorityLane(wip);
  if (nextLane >= currentLane || (nextLane === DefaultLane && (currentLane & TransitionLanes) !== NoLanes)) {
    return wip;
  }
  return next;
}

/** 이번 렌더에 시작 후 양보 없이 처리할 입력·기본 갱신이 있는지 확인한다. */
export function includesBlockingLane(lanes: Lanes): boolean {
  return (lanes & SyncUpdateLanes) !== NoLanes;
}

/** 루트가 해당 lane을 만료된 갱신으로 취급하기까지의 밀리초다. Idle 갱신은 만료되지 않는다. */
export function laneTimeout(lane: Lane): number {
  if (lane === SyncLane || lane === InputContinuousLane) return 250;
  if (lane === DefaultLane || (lane & TransitionLanes) !== NoLanes) return 5000;
  return Infinity;
}

/** 루트의 비동기 콜백에 쓸 호스트 우선순위다. Sync 작업은 루트에서 마이크로태스크로 처리한다. */
export function schedulerPriorityForLanes(lanes: Lanes): SchedulerPriority {
  const lane = getHighestPriorityLane(lanes);
  if (lane === SyncLane || lane === InputContinuousLane) return 'user-blocking';
  if (lane === IdleLane) return 'idle';
  return 'normal';
}
