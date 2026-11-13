/** Fail early if the static application shell does not match its selectors. */
export function mustQuery<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`필수 DOM 요소가 없습니다: ${selector}`);
  return element;
}

export function inputValue(event: Event): string {
  const target = event.currentTarget;
  if (!target || !('value' in target) || typeof target.value !== 'string')
    throw new TypeError('값을 읽을 수 없는 입력 이벤트입니다.');
  return target.value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
