import { scheduleCallback } from '../scheduler/index.js';
import { ChildDeletion, Passive, PassiveMask } from './flags.js';
import { nextInSubtree } from './fiberNode.js';
import { getPassiveEffects, type PassiveEffect } from './hooks.js';
import type { Lanes } from './lanes.js';
import type { ChildFiber, Fiber, HostRootFiber } from './types.js';
import { runWithPassivePriority } from './updatePriority.js';

/** 한 커밋에서 먼저 정리할 effect와 그 뒤에 실행할 effect를 순서대로 보관한다. */
interface PassiveWork {
  cleanups: PassiveEffect[];
  setups: PassiveEffect[];
}

/** DOM 쓰기가 성공하면 비울 플래그를 포함하는 커밋 준비 결과다. */
interface PassiveBatch extends PassiveWork {
  flagged: Fiber[];
}

/** 여러 루트가 커밋한 순서와 각 커밋의 우선순위를 함께 보관한다. */
const pending: Array<PassiveWork & { lanes: Lanes }> = [];
let cancelTask: (() => void) | null = null;
let flushing = false;

/** 삭제된 가지 안의 모든 effect는 이전 의존성과 무관하게 부모부터 정리한다. */
function collectDeletedEffects(deleted: ChildFiber, cleanups: PassiveEffect[]): void {
  for (let fiber: ChildFiber | null = deleted; fiber !== null; fiber = nextInSubtree(fiber, deleted)) {
    if (fiber.tag === 'function') {
      for (const effect of getPassiveEffects(fiber, false)) cleanups.push(effect);
    }
  }
}

/** 삭제 목록이 소모되기 전에 effect를 수집한다. 갱신한 함수는 자식부터, 한 함수 안에서는 Hook 호출 순서로 처리한다. */
export function collectPassiveEffects(tree: HostRootFiber): PassiveBatch | null {
  if (!((tree.flags | tree.subtreeFlags) & PassiveMask)) return null;
  const batch: PassiveBatch = { cleanups: [], setups: [], flagged: [] };
  let fiber: Fiber | null = tree;
  while (fiber !== null) {
    if ((fiber.flags | fiber.subtreeFlags) & Passive) batch.flagged.push(fiber);
    if ((fiber.flags & ChildDeletion) && fiber.deletions !== null) {
      for (const deleted of fiber.deletions) collectDeletedEffects(deleted, batch.cleanups);
    }
    if ((fiber.subtreeFlags & PassiveMask) && fiber.child !== null) {
      fiber = fiber.child;
      continue;
    }
    while (fiber !== null) {
      if ((fiber.flags & Passive) && fiber.tag === 'function') {
        for (const effect of getPassiveEffects(fiber, true)) {
          batch.cleanups.push(effect);
          batch.setups.push(effect);
        }
      }
      if (fiber.sibling !== null) {
        fiber = fiber.sibling;
        break;
      }
      fiber = fiber.return;
    }
  }
  return batch;
}

/** DOM과 current를 공개한 뒤에만 effect를 예약하고, 성공적으로 소비한 작업 트리의 표시를 지운다. */
export function enqueuePassiveEffects(batch: PassiveBatch | null, lanes: Lanes): void {
  if (batch === null) return;
  for (const fiber of batch.flagged) {
    fiber.flags &= ~Passive;
    fiber.subtreeFlags &= ~Passive;
  }
  if (batch.cleanups.length === 0 && batch.setups.length === 0) return;
  pending.push({ cleanups: batch.cleanups, setups: batch.setups, lanes });
  if (!flushing && cancelTask === null) cancelTask = scheduleCallback('normal', flushPassiveEffects);
}

/** 하나의 사용자 콜백에서 발생한 오류를 보고하고 같은 커밋의 나머지 effect 처리를 계속한다. */
function reportEffectError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
}

/** 이전 cleanup을 먼저 모두 호출하고, 새 setup이 반환한 cleanup을 다음 커밋에 공유한다. */
function runEffects(work: PassiveWork): void {
  for (const effect of work.cleanups) {
    const cleanup = effect.instance.destroy;
    effect.instance.destroy = undefined;
    try {
      cleanup?.();
    } catch (error) {
      reportEffectError(error);
    }
  }
  for (const { create, instance } of work.setups) {
    try {
      const cleanup = create();
      if (typeof cleanup === 'function') instance.destroy = cleanup;
      else if (cleanup !== undefined) {
        throw new TypeError('useEffect must return a cleanup function or undefined');
      }
    } catch (error) {
      reportEffectError(error);
    }
  }
}

/** 다음 렌더 전이나 예약된 호스트 태스크에서 이전 커밋의 effect를 비운다. 실행 중 추가한 커밋도 순서대로 처리한다. */
export function flushPassiveEffects(): void {
  if (flushing || pending.length === 0) return;
  cancelTask?.();
  cancelTask = null;
  flushing = true;
  try {
    for (const work of pending) {
      runWithPassivePriority(work.lanes, () => runEffects(work));
    }
  } finally {
    pending.length = 0;
    flushing = false;
  }
}
