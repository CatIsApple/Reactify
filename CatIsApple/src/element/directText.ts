import type { ReactifyElement } from './types.js';

/** 호스트가 직접 표시할 문자열을 반환한다. 배열·Element·빈 자식은 일반 자식 조정이 처리한다. */
export function getDirectText(props: ReactifyElement['props'] | null): string | null {
  if (props === null || !Object.hasOwn(props, 'children')) return null;
  const child = props.children;
  return typeof child === 'string' || typeof child === 'number' ? String(child) : null;
}
