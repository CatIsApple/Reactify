import { applyHostAttribute } from './attributes.js';

/** DOM 쓰기 직전의 값을 커밋 순서대로 보관한다. 텍스트와 속성은 복구 함수 없이 값만 기록한다. */
export class MutationJournal {
  private readonly entries: Array<Text | Element | (() => void)> = [];
  private readonly previousValues: Array<string | null> = [];
  private readonly attributeNames: string[] = [];

  /** 텍스트를 변경하기 전의 실제 DOM 값을 기록한다. */
  recordText(node: Text, before: string): void {
    this.entries.push(node);
    this.previousValues.push(before);
  }

  /** 속성을 쓰거나 제거하기 직전의 값과 이름을 기록한다. */
  recordAttribute(node: Element, name: string, before: string | null): void {
    this.entries.push(node);
    this.previousValues.push(before);
    this.attributeNames.push(name);
  }

  /** 노드 이동이나 자식 교체처럼 위치와 포커스까지 복구하는 작업을 같은 순서에 끼운다. */
  recordUndo(restore: () => void): void {
    this.entries.push(restore);
  }

  /** 쓰기가 섞여 있어도 역순으로 복구하고, 한 복구가 실패해도 남은 작업을 시도한다. */
  rollback(): unknown[] {
    const errors: unknown[] = [];
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      try {
        if (typeof entry === 'function') {
          entry();
        } else if (entry.nodeType === 3) {
          const before = this.previousValues.pop()!;
          const text = entry as Text;
          if (text.data !== before) text.data = before;
        } else {
          const before = this.previousValues.pop() ?? null;
          const name = this.attributeNames.pop()!;
          const element = entry as Element;
          if (element.getAttribute(name) !== before) applyHostAttribute(element, name, before);
        }
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }
}
