import { h, text, COMMENT, matchChildren } from './vnode.ts';
import { diffSteps } from './diff.ts';
import { patch } from './patch.ts';
import { withHooks } from './hooks.ts';
import type {
  Component,
  ComponentOptions,
  Deadline,
  DiffStep,
  Fiber,
  Hook,
  HookOwner,
  PatchOperation,
  Props,
  RenderMetrics,
  RenderOutput,
  RenderWork,
  Scheduler,
  VNode,
} from './types.ts';

const schedule: Scheduler = (callback) => {
  // Interactive rendering must not depend on the browser finding idle time.
  // A fresh macrotask gets a bounded 5ms work slice; commit stays synchronous.
  const id = setTimeout(() => {
    const end = performance.now() + 5;
    callback({ timeRemaining: () => Math.max(0, end - performance.now()) });
  }, 0);
  return () => clearTimeout(id);
};

function fiber(vnode: VNode, parent: Fiber | null, alternate: Fiber | null = null): Fiber {
  return {
    type: vnode.type,
    key: vnode.key,
    vnode,
    return: parent,
    child: null,
    sibling: null,
    alternate,
    dom: alternate?.dom ?? null,
    output: null,
  };
}

function childrenOf(node: Fiber | null): Fiber[] {
  const children: Fiber[] = [];
  for (let child = node?.child; child; child = child.sibling) children.push(child);
  return children;
}

function normalizeOutput(value: RenderOutput): VNode {
  if (value === null || value === undefined || typeof value === 'boolean')
    return { type: COMMENT, key: null, props: { nodeValue: 'empty' }, children: [] };
  if (typeof value === 'string' || typeof value === 'number') return text(value);
  if (Array.isArray(value) || !value.type)
    throw new TypeError('컴포넌트는 하나의 VNode 또는 null을 반환해야 합니다.');
  return value;
}

function beginWork(node: Fiber, instance: HookOwner, isRoot: boolean): void {
  let children: VNode[];
  if (typeof node.type === 'function') {
    // h() checked props at the public boundary; this tree stores mixed component types.
    const component = node.type as Component<Props>;
    const evaluate = () => component({ ...node.vnode.props, children: node.vnode.children });
    const output = normalizeOutput(
      isRoot ? withHooks(instance, evaluate) : withHooks(null, evaluate),
    );
    children = [output];
  } else children = node.vnode.children;
  const previous = childrenOf(node.alternate);
  const { matches } = matchChildren(
    previous.map((f) => f.vnode),
    children,
  );
  let last: Fiber | null = null;
  children.forEach((vnode, index) => {
    const old = previous[matches[index]];
    const next = fiber(vnode, node, old?.type === vnode.type ? old : null);
    if (last) last.sibling = next;
    else node.child = next;
    last = next;
  });
}

function completeWork(node: Fiber): void {
  if (typeof node.type === 'function') {
    const output = node.child!.output!;
    node.output = { ...output, key: node.key ?? output.key };
  } else node.output = { ...node.vnode, children: childrenOf(node).map((child) => child.output!) };
}

function connectDOM(root: Fiber, dom: Node): void {
  // Iterative traversal avoids retaining a second recursive render stack.
  const stack: [Fiber, Node][] = [[root, dom]];
  while (stack.length) {
    const [node, host] = stack.pop()!;
    node.dom = host;
    if (node.alternate) node.alternate.alternate = null;
    if (typeof node.type === 'function') stack.push([node.child!, host]);
    else childrenOf(node).forEach((child, index) => stack.push([child, host.childNodes[index]]));
  }
}

function releaseOlderAlternates(root: Fiber | null): void {
  const stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop()!;
    node.alternate = null;
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
}

/** Teaching Fiber: interruptible render, double buffering, atomic synchronous commit. */
export class FunctionComponent<P extends object = Record<string, never>> {
  component: Component<P>;
  props: P;
  options: ComponentOptions;
  hooks: Hook[];
  draftHooks: Hook[] = [];
  hookIndex = 0;
  current: Fiber | null;
  tree: VNode | null;
  dom: Node | null;
  container: Element | null = null;
  mounted: boolean;
  pending: boolean;
  work: Generator<Fiber | DiffStep, RenderWork> | null;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
  commitCount: number;
  generation: number;
  error: Error | null;
  schedule: Scheduler;
  cancelScheduled: (() => void) | null = null;
  metrics: RenderMetrics = { units: 0, yields: 0, started: 0 };

  constructor(component: Component<P>, props: P = {} as P, options: ComponentOptions = {}) {
    this.component = component;
    this.props = props;
    this.options = options;
    this.hooks = [];
    this.current = null;
    this.tree = null;
    this.dom = null;
    this.mounted = false;
    this.pending = false;
    this.work = null;
    this.waiters = [];
    this.commitCount = 0;
    this.generation = 0;
    this.error = null;
    this.schedule = options.schedule ?? schedule;
  }

  mount(container: Element): this {
    if (this.mounted) throw new Error('이미 mount된 컴포넌트입니다.');
    if (container.childNodes.length) throw new Error('mount 컨테이너는 비어 있어야 합니다.');
    this.container = container;
    this.generation++;
    this.mounted = true;
    this.update();
    return this;
  }

  update(props?: P): void {
    if (!this.mounted) return;
    if (props !== undefined) this.props = props;
    this.pending = true;
    this.error = null;
    if (!this.cancelScheduled)
      this.cancelScheduled = this.schedule((deadline) => this.tick(deadline));
  }

  *renderSteps(): Generator<Fiber | DiffStep, RenderWork> {
    this.pending = false;
    this.draftHooks = [];
    this.hookIndex = 0;
    this.metrics = { units: 0, yields: 0, started: performance.now() };
    const root = fiber(h(this.component, this.props), null, this.current);
    let node: Fiber | null = root;
    while (node) {
      beginWork(node, this, node === root);
      this.metrics.units++;
      yield node;
      if (node.child) {
        node = node.child;
        continue;
      }
      while (node) {
        completeWork(node);
        if (node.sibling) {
          node = node.sibling;
          break;
        }
        node = node.return;
      }
    }
    if (this.current && this.hookIndex !== this.hooks.length)
      throw new Error('Hook 호출 개수가 변경되었습니다. 조건문 안에서 Hook을 호출하지 마세요.');
    const plan = yield* diffSteps(this.tree, root.output);
    return { root, plan };
  }

  tick(deadline: Deadline): void {
    this.cancelScheduled = null;
    if (!this.mounted) return;
    try {
      this.work ??= this.renderSteps();
      let result: IteratorResult<Fiber | DiffStep, RenderWork>;
      do {
        result = this.work.next();
      } while (!result.done && deadline.timeRemaining() > 1);
      if (result.done) {
        this.work = null;
        this.commit(result.value);
      } else this.metrics.yields++;
      if (this.work || this.pending) {
        if (!this.cancelScheduled) this.cancelScheduled = this.schedule((next) => this.tick(next));
      } else this.settle();
    } catch (error) {
      this.work = null;
      this.pending = false;
      this.error = error instanceof Error ? error : new Error(String(error));
      this.settle(this.error);
      this.options.onError?.(this.error);
    }
  }

  commit({ root, plan }: RenderWork): void {
    const start = performance.now();
    const operations: PatchOperation[] = [];
    if (!this.container) throw new Error('mount 컨테이너가 없습니다.');
    this.dom = patch(this.dom, plan, this.container, operations);
    this.tree = root.output;
    releaseOlderAlternates(this.current);
    this.current = root;
    if (!this.dom) throw new Error('루트 DOM을 생성하지 못했습니다.');
    connectDOM(root, this.dom);
    for (const hook of this.draftHooks)
      if (hook.kind === 'state') hook.queue.splice(0, hook.consumed);
    this.hooks = this.draftHooks;
    this.commitCount++;
    // Effects execute after DOM commit, before the next render (not a paint guarantee).
    for (const hook of this.hooks)
      if (hook.kind === 'effect' && hook.changed) {
        hook.changed = false;
        hook.cleanup?.();
        const cleanup = hook.setup();
        if (cleanup !== undefined && typeof cleanup !== 'function')
          throw new TypeError('effect는 cleanup 함수 또는 undefined만 반환할 수 있습니다.');
        hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
    this.options.onCommit?.({
      ...this.metrics,
      operations,
      commits: this.commitCount,
      commitMs: performance.now() - start,
      totalMs: performance.now() - this.metrics.started,
      root,
    });
  }

  whenIdle(): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    if (!this.pending && !this.work && !this.cancelScheduled) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  settle(error?: Error): void {
    for (const waiter of this.waiters.splice(0)) error ? waiter.reject(error) : waiter.resolve();
  }

  /** Deterministic tests and explicit synchronous integration only. */
  flushSync(): void {
    let attempts = 0;
    while ((this.pending || this.work || this.cancelScheduled) && this.mounted) {
      if (++attempts > 100)
        throw new Error('상태 업데이트가 반복됩니다. effect 의존성을 확인하세요.');
      this.cancelScheduled?.();
      this.tick({ timeRemaining: () => Infinity });
      if (this.error) throw this.error;
    }
  }

  unmount(): void {
    this.mounted = false;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.pending = false;
    this.work = null;
    for (const hook of this.hooks) if (hook.kind === 'effect') hook.cleanup?.();
    if (this.dom && this.container) this.container.removeChild(this.dom);
    this.dom = this.current = this.tree = null;
    this.hooks = [];
    this.settle();
  }
}
