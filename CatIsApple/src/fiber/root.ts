import type { ElementChild } from '../element/types.js';
import { commitMutationEffects, completeHostWork } from '../dom/index.js';
import { NoFlags, Snapshot } from './flags.js';
import { markUpdateLaneFromFiberToRoot } from './fiberNode.js';
import { NoLanes, SyncLane, type Lane, type Lanes } from './lanes.js';
import { RootScheduler } from './rootScheduler.js';
import { collectPassiveEffects, enqueuePassiveEffects, flushPassiveEffects } from './passiveEffects.js';
import type { FiberRoot, FiberRootInstance, FunctionFiber, HostRootFiber } from './types.js';
import {
  createRootUpdateQueue, discardRootUpdates, enqueueRootUpdate, getPendingRootLanes, processRootUpdateQueue,
  type ProcessedRootUpdates,
} from './updateQueue.js';
import { createRenderWork, type RenderWork } from './workLoop.js';
import { requestUpdateLane, runWithCommitPriority, runWithRenderLanes } from './updatePriority.js';

const nestedRenderLimit = 50;

/** 큐에서 선택한 입력, 작업 트리와 중단 위치를 한 렌더에 보관한다. */
interface RootRender {
  lanes: Lanes;
  tree: HostRootFiber;
  work: RenderWork;
  updates: ProcessedRootUpdates;
}

/** 빈 HostRoot를 만들고 최초 커밋 전 상태와 업데이트 큐를 연결한다. */
function createHostRootFiber(root: FiberRootInstance): HostRootFiber {
  return {
    tag: 'root', type: null, key: null, stateNode: root, alternate: null, child: null, sibling: null, return: null,
    flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
    lanes: NoLanes, childLanes: NoLanes, memoizedState: null, updateQueue: createRootUpdateQueue(),
  };
}

/** 한 DOM 컨테이너의 화면·Hook 업데이트를 예약하고 작업 트리의 렌더와 커밋을 관리한다. */
class ReactifyRoot implements FiberRootInstance {
  current: HostRootFiber;
  private pending: RootRender | null = null;
  private discardOnAbandon: number[] = [];
  private firstCommit = true;
  private busy = false;
  /** 현재 작업이 다음 화면을 직접 예약한 경우만 연속 렌더 횟수에 포함한다. */
  private scheduledNestedRender = false;
  private nestedRenderDepth = 0;
  /** 실패한 Hook 렌더는 같은 lane에 새 요청이 올 때까지 자동 재시도를 보류한다. */
  private failedStateLanes: Lanes = NoLanes;
  /** 현재 렌더가 양보하거나 수동 커밋을 기다릴 때 외부에서 들어온 Hook 요청이다. */
  private interleavedStateLanes: Lanes = NoLanes;
  private nextRequestId = 0;
  private readonly scheduler = new RootScheduler(this.createScheduledRenderSlice.bind(this));

  /** 컨테이너를 연결하고 빈 HostRoot를 최초의 current로 지정한다. */
  constructor(readonly container: Element) {
    this.current = createHostRootFiber(this);
  }

  /** 렌더할 업데이트가 남은 lane들이다. */
  get pendingLanes(): Lanes { return this.scheduler.pendingLanes; }
  /** 기한을 넘겨 다음 실행에서 양보 없이 처리할 lane들이다. */
  get expiredLanes(): Lanes { return this.scheduler.expiredLanes; }
  /** 렌더를 마치고 커밋을 기다리는 HostRoot. 양보 중에는 null이다. */
  get finishedWork(): HostRootFiber | null { return this.pending?.tree ?? null; }

  /** 같은 루트에서 동기 준비나 커밋이 중첩되는 것을 막는다. */
  private assertRootIsIdle(): void {
    if (this.busy) throw new Error('This FiberRoot is already rendering or committing');
  }

  /** 상태를 소유한 Fiber에 lane을 표시하고 조상의 childLanes를 통해 기존 루트 스케줄러를 깨운다. */
  scheduleStateUpdate(source: FunctionFiber, lane: Lane): void {
    markUpdateLaneFromFiberToRoot(source, lane);
    this.failedStateLanes &= ~lane;
    // 실패할 컴포넌트나 DOM 콜백이 매번 다른 setter를 호출해도 같은 오류를 자동으로 반복하지 않는다.
    if (!this.busy) this.interleavedStateLanes |= lane;
    this.scheduler.scheduleRootLane(lane);
  }

  /** 화면 큐와 커밋된 자손에 남은 lane을 합쳐 다음 작업을 예약한다. */
  private scheduleRemainingRootWork(rootLanes: Lanes): void {
    this.scheduler.finishRootWork(rootLanes | (this.current.childLanes & ~this.failedStateLanes));
  }

  /** current와 작업 트리가 공유하는 원형 큐에 넣고 루트에 lane을 표시한다. */
  private requestRootRender(children: ElementChild, lane: Lane): number {
    const id = ++this.nextRequestId;
    enqueueRootUpdate(this.current.updateQueue, lane, children, id);
    markUpdateLaneFromFiberToRoot(this.current, lane);
    this.failedStateLanes &= ~lane;
    this.scheduler.scheduleRootLane(lane);
    return id;
  }

  /** 수동 준비나 커밋 실패 후 보관하던 결과를 교체할 때, 해당 요청만 원본 큐에서 제거한다. */
  private discardPreparedRender(): void {
    if (this.pending === null) return;
    this.pending = null;
    this.current.lanes = discardRootUpdates(this.current.updateQueue, new Set(this.discardOnAbandon));
    this.discardOnAbandon = [];
  }

  /** 이번 lane의 큐 결과를 alternate에 기록하며 원래 큐는 렌더가 중단돼도 다시 읽을 수 있다. */
  private prepareRootRender(lanes: Lanes): RootRender {
    this.discardPreparedRender();
    this.nestedRenderDepth = this.scheduledNestedRender ? this.nestedRenderDepth + 1 : 0;
    this.scheduledNestedRender = false;
    this.interleavedStateLanes = NoLanes;
    const current = this.current;
    const updates = processRootUpdateQueue(current.updateQueue, lanes);
    const tree = current.alternate ?? createHostRootFiber(this);
    current.alternate = tree;
    tree.alternate = current;
    tree.child = null;
    tree.flags = this.firstCommit ? Snapshot : NoFlags;
    tree.subtreeFlags = NoFlags;
    tree.deletions = null;
    tree.updateQueue = updates.queue;
    tree.lanes = updates.remainingLanes;
    tree.childLanes = current.childLanes;
    tree.memoizedState = updates.children;
    const root = this;
    const work = createRenderWork(tree, updates.children, function completeHostFiberInContainer(fiber) {
      completeHostWork(fiber, root.container);
    }, lanes);
    return { lanes, tree, work, updates };
  }

  /** 수동 커밋 전에는 다른 콜백이 준비한 트리를 덮지 않도록 예약을 보류한다. */
  prepare(children: ElementChild): void {
    this.assertRootIsIdle();
    flushPassiveEffects();
    this.discardPreparedRender();
    this.scheduler.pauseRootWork();
    const id = this.requestRootRender(children, SyncLane);
    const render = this.prepareRootRender(SyncLane);
    this.busy = true;
    try {
      runWithRenderLanes(SyncLane, render.work.performRenderWork);
      this.pending = render;
      this.discardOnAbandon = [id];
    } catch (error) {
      this.handleRootRenderFailure(render);
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /** 표시된 DOM 변경이 성공하면 current를 교체하고 커밋 도중 접수된 요청까지 다시 예약한다. */
  commit(): void {
    this.assertRootIsIdle();
    if (this.pending === null) return;
    flushPassiveEffects();
    const render = this.pending;
    if (render === null) return;
    this.busy = true;
    try {
      // DOM 커밋이 deletions를 비우기 전에 정리할 Hook을 찾는다. 실패한 트리의 effect는 예약하지 않는다.
      const passive = collectPassiveEffects(render.tree);
      render.work.runWithMountingHooks(function commitRootAtSyncPriority() {
        runWithCommitPriority(function applyRootMutationEffects() {
          commitMutationEffects(render.tree, render.work.reusedParents);
        });
      });
      const { remainingLanes, queue } = render.updates;
      render.tree.lanes = remainingLanes | getPendingRootLanes(queue);
      this.current = render.tree;
      render.work.commitRenderHooks();
      this.firstCommit = false;
      this.pending = null;
      this.discardOnAbandon = [];
      this.scheduleRemainingRootWork(render.tree.lanes);
      enqueuePassiveEffects(passive, render.lanes);
    } finally {
      this.busy = false;
    }
    if (render.lanes & SyncLane) flushPassiveEffects();
  }

  /** 호출 문맥의 lane으로 새 화면을 예약한다. 렌더나 커밋 도중의 요청은 다음 작업에서 읽는다. */
  render(children: ElementChild): void {
    if (this.busy && this.nestedRenderDepth >= nestedRenderLimit) {
      throw new Error('Maximum nested root render depth exceeded');
    }
    this.scheduledNestedRender = this.busy;
    const lane = requestUpdateLane(this.container.ownerDocument.defaultView);
    if (!this.busy && this.pending !== null) {
      this.discardPreparedRender();
      this.scheduleRemainingRootWork(this.current.lanes);
    }
    this.requestRootRender(children, lane);
  }

  /** 실패한 요청을 분리하고 남은 작업을 예약한다. 커밋에 실패한 트리는 수동으로 재시도할 수 있다. */
  private handleRootRenderFailure(render: RootRender): void {
    const { processedIds, remainingLanes, queue } = render.updates;
    // 실패한 화면 요청은 큐에서 버릴 수 있다. Hook만 실행한 경우에는 요청이 다시 올 때까지 그 lane을 보류한다.
    if (processedIds.length === 0) this.failedStateLanes |= render.lanes & ~this.interleavedStateLanes;
    if (this.pending === render) {
      this.discardOnAbandon = processedIds;
      this.scheduleRemainingRootWork(remainingLanes | getPendingRootLanes(queue));
    } else {
      this.current.lanes = discardRootUpdates(this.current.updateQueue, new Set(processedIds));
      this.scheduleRemainingRootWork(this.current.lanes);
    }
  }

  /** 루트 스케줄러가 고른 lane을 동일한 작업 위치에서 이어가고 전체 트리가 완성되면 커밋한다. */
  private createScheduledRenderSlice(lanes: Lanes): (shouldYield?: () => boolean) => boolean {
    const render = this.prepareRootRender(lanes);
    const root = this;
    return function performScheduledRenderSlice(shouldYield) {
      try {
        root.busy = true;
        try {
          const completed = runWithRenderLanes(lanes, function performRenderWorkForLanes() {
            return render.work.performRenderWork(shouldYield);
          });
          if (!completed) return false;
          root.pending = render;
        } finally {
          root.busy = false;
        }
        root.commit();
      } catch (error) {
        root.handleRootRenderFailure(render);
        if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
        else console.error(error);
      }
      return true;
    };
  }
}

/** 지정한 DOM 컨테이너를 렌더 대상으로 삼는 독립적인 루트를 만든다. */
export function createRoot(container: Element): FiberRoot {
  return new ReactifyRoot(container);
}
