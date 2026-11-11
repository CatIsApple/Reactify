/** 확정한 스냅샷과 현재 읽고 있는 위치를 함께 보관한다. */
export class StateHistory<T> {
  private readonly entries: T[];
  private cursor = 0;

  /** 첫 상태도 뒤로가기의 목적지로 남긴다. */
  constructor(initial: T) {
    this.entries = [initial];
  }

  /** 현재 확정된 스냅샷을 반환한다. */
  get current(): T {
    return this.entries[this.cursor];
  }

  /** 첫 스냅샷부터 0으로 세는 현재 위치다. */
  get index(): number {
    return this.cursor;
  }

  /** 앞으로 이동할 수 있는 스냅샷까지 포함한 개수다. */
  get length(): number {
    return this.entries.length;
  }

  /** 현재 위치 뒤의 이력을 새 스냅샷으로 교체한다. */
  push(snapshot: T): void {
    this.entries.splice(this.cursor + 1, this.entries.length, snapshot);
    this.cursor++;
  }

  /** 앞뒤로 한 칸 이동하고 양 끝에서는 그 자리에 머문다. */
  move(step: -1 | 1): T {
    this.cursor = Math.max(0, Math.min(this.cursor + step, this.entries.length - 1));
    return this.current;
  }
}
