import type { ElementChild } from '../element/types.js';
import { NoLane, NoLanes, type Lane, type Lanes } from './lanes.js';

/** 루트 화면을 교체하는 요청. 재적용용 사본은 같은 요청 번호와 NoLane을 갖는다. */
interface RootUpdate {
  requestId: number;
  lane: Lane;
  children: ElementChild;
  next: RootUpdate | null;
}

/** current와 작업 트리가 함께 받는 새 요청들. pending은 원형 목록의 마지막 노드다. */
interface SharedQueue {
  pending: RootUpdate | null;
  pendingLanes: Lanes;
}

/** 첫 미처리 요청 직전의 화면과, 그 화면부터 접수 순서로 다시 적용할 요청들이다. */
export interface RootUpdateQueue {
  baseState: ElementChild;
  firstBaseUpdate: RootUpdate | null;
  lastBaseUpdate: RootUpdate | null;
  shared: SharedQueue;
}

/** 한 렌더가 계산한 화면과 남은 큐, 실패 시 제거할 수 있도록 기록한 처리 요청 번호들이다. */
export interface ProcessedRootUpdates {
  queue: RootUpdateQueue;
  children: ElementChild;
  processedIds: number[];
  remainingLanes: Lanes;
}

/** 주어진 초기 화면에서 시작하는 빈 HostRoot 업데이트 큐를 만든다. */
export function createUpdateQueue(initial: ElementChild = null): RootUpdateQueue {
  return {
    baseState: initial, firstBaseUpdate: null, lastBaseUpdate: null,
    shared: { pending: null, pendingLanes: NoLanes },
  };
}

/** 접수 순서를 지키며 새 요청을 공유 원형 목록 끝에 O(1)로 추가한다. */
export function enqueueUpdate(queue: RootUpdateQueue, lane: Lane, children: ElementChild, requestId: number): void {
  const update: RootUpdate = { requestId, lane, children, next: null };
  const tail = queue.shared.pending;
  if (tail === null) {
    update.next = update;
  } else {
    update.next = tail.next;
    tail.next = update;
  }
  queue.shared.pending = update;
  queue.shared.pendingLanes |= lane;
}

/** 이번 렌더가 큐를 읽은 뒤 새로 접수된 lane도 커밋 시점에 확인한다. */
export function getPendingLanes(queue: RootUpdateQueue): Lanes {
  return queue.shared.pendingLanes;
}

/** 새 요청을 current의 선형 목록에 붙여 작업 트리가 폐기돼도 다시 읽을 수 있게 한다. */
function transferPending(queue: RootUpdateQueue): void {
  const tail = queue.shared.pending;
  if (tail === null) return;
  const head = tail.next!;
  tail.next = null;
  if (queue.lastBaseUpdate === null) queue.firstBaseUpdate = head;
  else queue.lastBaseUpdate.next = head;
  queue.lastBaseUpdate = tail;
  queue.shared.pending = null;
  queue.shared.pendingLanes = NoLanes;
}

/** 원본 목록을 보존하면서 요청 하나를 지정한 lane으로 복사해 작업 큐에 붙인다. */
function appendBaseUpdate(queue: RootUpdateQueue, source: RootUpdate, lane: Lane): void {
  const copy: RootUpdate = { ...source, lane, next: null };
  if (queue.lastBaseUpdate === null) queue.firstBaseUpdate = copy;
  else queue.lastBaseUpdate.next = copy;
  queue.lastBaseUpdate = copy;
}

/** 이번 lane의 요청을 적용하고, 처음 건너뛴 위치부터 재적용할 작업 큐를 만든다. */
export function processUpdateQueue(current: RootUpdateQueue, renderLanes: Lanes): ProcessedRootUpdates {
  transferPending(current);
  const queue: RootUpdateQueue = { ...current, firstBaseUpdate: null, lastBaseUpdate: null };
  let children = current.baseState;
  let remainingLanes = NoLanes;
  const processedIds: number[] = [];
  for (let update = current.firstBaseUpdate; update !== null; update = update.next) {
    if ((renderLanes & update.lane) !== update.lane) {
      if (queue.firstBaseUpdate === null) queue.baseState = children;
      appendBaseUpdate(queue, update, update.lane);
      remainingLanes |= update.lane;
      continue;
    }
    children = update.children;
    if (update.lane !== NoLane) processedIds.push(update.requestId);
    // 먼저 건너뛴 요청이 나중에 적용되어도, 화면은 원래의 접수 순서대로 결정한다.
    if (queue.firstBaseUpdate !== null) appendBaseUpdate(queue, update, NoLane);
  }
  if (queue.firstBaseUpdate === null) queue.baseState = children;
  return { queue, children, processedIds, remainingLanes };
}

/** 실패하거나 취소한 미커밋 요청만 제거하고, 이미 커밋된 재적용 기록과 다른 lane은 유지한다. */
export function discardUpdates(queue: RootUpdateQueue, ids: ReadonlySet<number>): Lanes {
  transferPending(queue);
  const first = queue.firstBaseUpdate;
  queue.firstBaseUpdate = null;
  queue.lastBaseUpdate = null;
  let remainingLanes = NoLanes;
  for (let update = first; update !== null; update = update.next) {
    if (update.lane !== NoLane && ids.has(update.requestId)) continue;
    if (queue.firstBaseUpdate === null && update.lane === NoLane) {
      queue.baseState = update.children;
      continue;
    }
    appendBaseUpdate(queue, update, update.lane);
    remainingLanes |= update.lane;
  }
  return remainingLanes;
}
