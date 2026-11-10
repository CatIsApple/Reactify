import { scheduleCallback, type SchedulerCallback } from '../scheduler/index.js';
import { flushPassiveEffects } from './passiveEffects.js';
import {
  getHighestPriorityLane, getNextLanes, includesBlockingLane, laneTimeout, NoLanes,
  schedulerPriorityForLanes, SyncLane, TransitionLanes, type Lane, type Lanes,
} from './lanes.js';

/** 선택한 lane으로 시작한 렌더를 이어 간다. true이면 해당 작업이 끝났다. */
type RenderSlice = (shouldYield?: () => boolean) => boolean;

/** 루트의 대기 lane을 모아 콜백을 예약한다. 화면과 요청의 순서는 HostRoot의 업데이트 큐가 관리한다. */
export class RootScheduler {
  private static readonly rootsToSchedule = new Set<RootScheduler>();
  private static microtaskScheduled = false;
  pendingLanes: Lanes = NoLanes;
  expiredLanes: Lanes = NoLanes;
  private deadlines = new Map<Lane, number>();
  private callbackLane: Lane = NoLanes;
  private renderLanes: Lanes = NoLanes;
  private slice: RenderSlice | null = null;
  private cancelTask: (() => void) | null = null;
  private paused = false;

  /** 선택된 lane의 업데이트 큐를 읽고 작업 트리를 만드는 함수를 받는다. */
  constructor(private readonly startRender: (lanes: Lanes) => RenderSlice) {}

  /** 새 lane의 최초 대기 시각으로 만료 기한을 정하고, 이번 호출 묶음 끝에 우선순위를 판단한다. */
  request(lane: Lane): void {
    this.pendingLanes |= lane;
    if (!this.deadlines.has(lane)) this.deadlines.set(lane, performance.now() + laneTimeout(lane));
    this.ensureScheduled();
  }

  /** 수동 prepare가 트리를 보유하는 동안 예약된 작업이 alternate를 덮어쓰지 않게 한다. */
  pause(): void {
    this.paused = true;
    this.cancelWork();
  }

  /** 커밋이나 실패 처리 후 큐에 남은 lane만 보존하고 다음 루트 작업을 예약한다. */
  finish(remaining: Lanes): void {
    this.cancelWork();
    this.paused = false;
    this.pendingLanes = remaining;
    this.expiredLanes &= remaining;
    for (const lane of this.deadlines.keys()) {
      if ((lane & remaining) === NoLanes) this.deadlines.delete(lane);
    }
    if (remaining !== NoLanes) this.ensureScheduled();
  }

  /** 콜백과 미완성 렌더 위치를 해제한다. 아직 커밋되지 않은 업데이트는 current 큐에서 다시 읽는다. */
  private cancelWork(): void {
    this.cancelTask?.();
    this.cancelTask = null;
    this.callbackLane = NoLanes;
    this.renderLanes = NoLanes;
    this.slice = null;
  }

  /** 갱신된 루트들을 공유 마이크로태스크 하나에 모아 콜백을 정한 뒤 Sync 작업을 비운다. */
  private ensureScheduled(): void {
    if (this.paused) return;
    RootScheduler.rootsToSchedule.add(this);
    if (RootScheduler.microtaskScheduled) return;
    RootScheduler.microtaskScheduled = true;
    queueMicrotask(() => {
      RootScheduler.microtaskScheduled = false;
      const syncRoots: RootScheduler[] = [];
      for (const root of RootScheduler.rootsToSchedule) {
        if (root.scheduleRoot() === SyncLane) syncRoots.push(root);
      }
      RootScheduler.rootsToSchedule.clear();
      for (const root of syncRoots) {
        // 앞선 루트의 커밋 콜백에서 다른 루트의 수동 prepare나 render를 요청할 수 있다.
        if (root.callbackLane === SyncLane) root.perform();
      }
    });
  }

  /** 현재 렌더를 유지할지 선점할지 판단하고, 우선순위가 바뀌었을 때만 호스트 콜백을 교체한다. */
  private scheduleRoot(): Lane {
    if (this.paused || this.pendingLanes === NoLanes) return NoLanes;
    const lanes = getNextLanes(this.pendingLanes, this.renderLanes);
    const highest = getHighestPriorityLane(lanes);
    if (this.callbackLane !== highest) {
      this.cancelWork();
      this.callbackLane = highest;
      if (highest !== SyncLane) {
        const callback: SchedulerCallback = (shouldYield, didTimeout) =>
          this.perform(shouldYield, didTimeout) ? undefined : callback;
        this.cancelTask = scheduleCallback(schedulerPriorityForLanes(lanes), callback);
      }
    }
    return highest;
  }

  /** 새 렌더는 같은 루트 큐의 대기 전환들을 함께 읽고, 양보한 렌더는 같은 lane과 Fiber에서 재개한다. */
  private perform(shouldYield?: () => boolean, didTimeout = false): boolean {
    // 직전 커밋의 effect가 새 요청을 넣거나 현재 콜백을 취소할 수 있다.
    const callbackLane = this.callbackLane;
    flushPassiveEffects();
    if (this.paused || this.callbackLane !== callbackLane) return true;
    if (getHighestPriorityLane(getNextLanes(this.pendingLanes, this.renderLanes)) !== callbackLane) {
      this.cancelWork();
      this.ensureScheduled();
      return true;
    }
    if (!this.slice) {
      this.renderLanes = getNextLanes(this.pendingLanes);
      if ((this.renderLanes & TransitionLanes) !== NoLanes) {
        this.renderLanes |= this.pendingLanes & TransitionLanes;
      }
      this.slice = this.startRender(this.renderLanes);
    }
    const now = performance.now();
    for (const [lane, deadline] of this.deadlines) {
      if (deadline <= now) this.expiredLanes |= lane;
    }
    const blocking = didTimeout || includesBlockingLane(this.renderLanes) ||
      (this.renderLanes & this.expiredLanes) !== NoLanes;
    return this.slice(blocking ? undefined : shouldYield);
  }
}
