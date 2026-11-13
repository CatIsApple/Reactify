import type { VNode } from '../core/types.ts';

export interface HistoryEntry {
  tree: VNode;
  label: string;
}

export class StateHistory {
  readonly limit: number;
  entries: HistoryEntry[];
  index: number;
  constructor(initial: VNode, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError('history limit은 1 이상의 정수여야 합니다.');
    this.limit = limit;
    this.entries = [{ tree: structuredClone(initial), label: '최초 렌더링' }];
    this.index = 0;
  }
  get current() {
    return structuredClone(this.entries[this.index].tree);
  }
  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.entries.length - 1;
  }
  push(tree: VNode, label = 'Patch'): boolean {
    const snapshot = structuredClone(tree);
    if (JSON.stringify(snapshot) === JSON.stringify(this.entries[this.index].tree)) return false;
    this.entries.splice(this.index + 1);
    this.entries.push({ tree: snapshot, label });
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }
  go(index: number): VNode {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length)
      throw new RangeError('존재하지 않는 이력입니다.');
    this.index = index;
    return this.current;
  }
  undo() {
    return this.go(Math.max(0, this.index - 1));
  }
  redo() {
    return this.go(Math.min(this.entries.length - 1, this.index + 1));
  }
}
