import type { ElementChild } from '../element/types.js';
import { commitMutationEffects, completeHostWork } from '../dom/index.js';
import { NoFlags, Snapshot } from './flags.js';
import type { FiberRoot, HostRootFiber } from './types.js';
import { performSyncWork } from './workLoop.js';

/** 전달받은 루트를 stateNode로 가리키는 빈 HostRoot Fiber를 만든다. */
function createHostRootFiber(root: FiberRoot): HostRootFiber {
  return {
    tag: 'root', stateNode: root, alternate: null, child: null, sibling: null, return: null,
    flags: NoFlags, subtreeFlags: NoFlags, deletions: null,
  };
}

/** 한 DOM 컨테이너의 현재 트리와 커밋 대기 중인 작업을 관리한다. */
class ReactifyRoot implements FiberRoot {
  current: HostRootFiber;
  private pending: HostRootFiber | null = null;
  private firstCommit = true;
  private busy = false;

  /** 컨테이너를 연결하고 빈 HostRoot를 최초의 current로 지정한다. */
  constructor(readonly container: Element) {
    this.current = createHostRootFiber(this);
  }

  /** 준비가 끝나 커밋을 기다리는 트리의 루트를 반환한다. 대기 중인 작업이 없으면 null이다. */
  get finishedWork(): HostRootFiber | null {
    return this.pending;
  }

  /** current의 alternate를 초기화하고, 새로 준비한 트리에 이번 커밋의 변경을 표시한다. */
  prepare(children: ElementChild): void {
    if (this.busy) throw new Error('This FiberRoot is already rendering or committing');
    this.busy = true;
    this.pending = null;
    try {
      const current = this.current;
      const work = current.alternate ?? createHostRootFiber(this);
      current.alternate = work;
      work.alternate = current;
      work.child = null;
      // 첫 커밋은 자식이 없어도 컨테이너에 이미 들어 있던 DOM을 비워야 한다.
      work.flags = this.firstCommit ? Snapshot : NoFlags;
      work.subtreeFlags = NoFlags;
      work.deletions = null;
      performSyncWork(work, children, fiber => {
        // 자식부터 새 DOM을 조립하고, 재사용할 DOM에서 값이 달라진 Fiber에 Update를 표시한다.
        completeHostWork(fiber, this.container);
      });
      this.pending = work;
    } finally {
      this.busy = false;
    }
  }

  /** 표시된 Fiber의 DOM 변경이 모두 성공하면 current를 교체한다. 실패하면 같은 작업을 재시도할 수 있다. */
  commit(): void {
    if (this.busy) throw new Error('This FiberRoot is already rendering or committing');
    const finishedWork = this.pending;
    if (finishedWork === null) return;
    this.busy = true;
    try {
      commitMutationEffects(finishedWork);
      this.current = finishedWork;
      this.pending = null;
      this.firstCommit = false;
    } finally {
      this.busy = false;
    }
  }

  /** 새 자식으로 작업 트리를 준비한 뒤 같은 호출 안에서 커밋까지 마친다. */
  render(children: ElementChild): void {
    this.prepare(children);
    this.commit();
  }
}

/** 지정한 DOM 컨테이너를 렌더 대상으로 삼는 독립적인 루트를 만든다. */
export function createRoot(container: Element): FiberRoot {
  return new ReactifyRoot(container);
}
