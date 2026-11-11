/** 호스트 콜백에 배정할 다섯 가지 Scheduler 우선순위다. */
export type SchedulerPriority = 'immediate' | 'user-blocking' | 'normal' | 'low' | 'idle';

/** 양보 여부를 확인할 함수와 콜백 만료 여부를 받는다. 다음 콜백을 반환하면 다음 태스크에서 재개한다. */
export type SchedulerCallback = (shouldYield: () => boolean, didTimeout: boolean) => SchedulerCallback | void;

/** 만료 시각과 등록 순서를 유지하며, 작업을 재개할 때는 콜백만 교체한다. */
interface ScheduledTask {
  priority: SchedulerPriority;
  expiresAt: number;
  sequence: number;
  callback: SchedulerCallback | null;
}

const sliceMs = 5;
const timeouts: Record<SchedulerPriority, number> = {
  immediate: -1,
  'user-blocking': 250,
  normal: 5000,
  low: 10000,
  idle: 0x3fffffff,
};
const queues: Record<SchedulerPriority, Set<ScheduledTask>> = {
  immediate: new Set(),
  'user-blocking': new Set(),
  normal: new Set(),
  low: new Set(),
  idle: new Set(),
};
const priorityQueues = Object.values(queues);
let nextSequence = 0;
let currentPriority: SchedulerPriority = 'normal';
let hostTaskScheduled = false;
let channel: MessageChannel | undefined;
const { setImmediate } = globalThis as typeof globalThis & {
  setImmediate?: (callback: () => void) => unknown;
};

/** 실행 중인 호스트 콜백의 우선순위를 읽는다. 콜백 밖에서는 기본 우선순위다. */
export function getCurrentPriorityLevel(): SchedulerPriority {
  return currentPriority;
}

/** 같은 우선순위 안에서는 등록 순서가 만료 순서이므로 각 대기열의 맨 앞 작업만 비교한다. */
function getNextScheduledTask(): ScheduledTask | undefined {
  let next: ScheduledTask | undefined;
  for (const queue of priorityQueues) {
    const task = queue.values().next().value;
    if (task && (!next || task.expiresAt < next.expiresAt ||
        (task.expiresAt === next.expiresAt && task.sequence < next.sequence))) {
      next = task;
    }
  }
  return next;
}

/** 브라우저에는 메시지, Node에는 즉시 콜백, 둘 다 없는 환경에는 타이머로 실행권을 요청한다. */
function postHostTask(): void {
  if (typeof setImmediate === 'function') {
    setImmediate(runHostTask);
  } else if (typeof MessageChannel === 'function') {
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = runHostTask;
    }
    channel.port2.postMessage(null);
  } else {
    setTimeout(runHostTask, 0);
  }
}

/** 하나의 호스트 태스크에서 작업 하나를 실행한다. 예외나 취소 뒤에도 다른 루트의 예약을 이어 간다. */
function runHostTask(): void {
  const task = getNextScheduledTask();
  if (!task) {
    hostTaskScheduled = false;
    return;
  }
  const queue = queues[task.priority];
  const callback = task.callback;
  const start = performance.now();
  const deadline = start + sliceMs;
  task.callback = null;
  const previousPriority = currentPriority;
  try {
    currentPriority = task.priority;
    // 취소됐거나 이번 실행에 배정된 시간을 넘기면 콜백이 브라우저에 양보할 수 있다.
    const continuation = callback?.(function shouldYieldToHost() {
      return performance.now() >= deadline || !queue.has(task);
    }, task.expiresAt <= start);
    if (continuation && queue.has(task)) task.callback = continuation;
  } finally {
    currentPriority = previousPriority;
    if (!task.callback) queue.delete(task);
    if (getNextScheduledTask()) postHostTask();
    else hostTaskScheduled = false;
  }
}

/** 작업을 등록하고 취소 함수를 돌려준다. 만료 시각이 이른 작업부터 실행하며, 같은 시각이면 등록 순서를 따른다. */
export function scheduleCallback(priority: SchedulerPriority, callback: SchedulerCallback): () => void {
  const queue = queues[priority];
  const task: ScheduledTask = {
    priority, expiresAt: performance.now() + timeouts[priority], sequence: nextSequence++, callback,
  };
  queue.add(task);
  if (!hostTaskScheduled) {
    hostTaskScheduled = true;
    postHostTask();
  }
  /** 대기 중인 작업과 아직 실행되지 않은 후속 콜백을 모두 취소한다. */
  return function cancelScheduledTask(): void {
    task.callback = null;
    queue.delete(task);
  };
}
