export type Child = VNode | string | number | boolean | null | undefined | readonly Child[];
export type RenderOutput = VNode | string | number | boolean | null | undefined;
export type Component<P extends object = Record<string, never>> = (
  props: P & { children?: VNode[] },
) => RenderOutput;
/** h() checks component props before they enter this heterogeneous tree. */
export type ComponentType = (props: never) => RenderOutput;
export type Props = Record<string, unknown>;
export interface KeyAttributes {
  key?: string | number | null;
}
export interface DOMProps extends Props, KeyAttributes {
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
  onSubmit?: (event: SubmitEvent) => void;
  style?: string | Record<string, string | number | undefined>;
}
export interface VNode {
  type: string | ComponentType;
  key: string | null;
  props: Props;
  children: VNode[];
  namespace?: string | null;
}
export interface PropChange {
  name: string;
  previous: unknown;
  value: unknown;
}
interface PlanBase {
  path: string;
}
export interface UpdatePlan extends PlanBase {
  kind: 'UPDATE';
  previous: VNode;
  next: VNode;
  props: PropChange[];
  children: { oldIndex: number; plan: DiffPlan }[];
  removed: number[];
}
export type DiffPlan =
  | (PlanBase & { kind: 'NONE'; previous: VNode | null; next: VNode | null })
  | (PlanBase & { kind: 'CREATE'; next: VNode })
  | (PlanBase & { kind: 'REMOVE'; previous: VNode })
  | (PlanBase & { kind: 'REPLACE'; previous: VNode; next: VNode })
  | (PlanBase & { kind: 'TEXT'; previous: VNode; next: VNode })
  | UpdatePlan;
export type DiffStep = DiffPlan | (PlanBase & { kind: 'VALIDATE' });
export type OperationType = 'CREATE' | 'REMOVE' | 'REPLACE' | 'TEXT' | 'PROPS' | 'MOVE';
export interface PatchOperation {
  type: OperationType;
  path: string;
  detail: string;
}
export type StateAction<T> = T | ((previous: T) => T);
export type StateSetter<T> = (action: StateAction<T>) => void;
export type Dependencies = readonly unknown[] | undefined;
export type Cleanup = () => void;
export type EffectSetup = () => void | Cleanup;
/** The private slot store erases T; useState<T> owns the typed boundary. */
export interface StateHook {
  kind: 'state';
  value: unknown;
  queue: ((previous: unknown) => unknown)[];
  setState?: (action: unknown) => void;
  consumed: number;
}
export interface MemoHook {
  kind: 'memo';
  value: unknown;
  deps: Dependencies;
}
export interface EffectHook {
  kind: 'effect';
  setup: EffectSetup;
  deps: Dependencies;
  cleanup?: Cleanup;
  changed: boolean;
}
export type Hook = StateHook | MemoHook | EffectHook;
export interface HookOwner {
  hooks: Hook[];
  draftHooks: Hook[];
  hookIndex: number;
  generation: number;
  mounted: boolean;
  update(): void;
}
export interface Fiber {
  type: VNode['type'];
  key: VNode['key'];
  vnode: VNode;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  dom: Node | null;
  output: VNode | null;
}
export interface Deadline {
  timeRemaining(): number;
}
export type Scheduler = (callback: (deadline: Deadline) => void) => () => void;
export interface RenderMetrics {
  units: number;
  yields: number;
  started: number;
}
export interface CommitMetrics extends RenderMetrics {
  operations: PatchOperation[];
  commits: number;
  commitMs: number;
  totalMs: number;
  root: Fiber;
}
export interface ComponentOptions {
  schedule?: Scheduler;
  onCommit?: (metrics: CommitMetrics) => void;
  onError?: (error: Error) => void;
}
export interface RenderWork {
  root: Fiber;
  plan: DiffPlan;
}
