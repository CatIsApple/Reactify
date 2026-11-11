import type { MutationJournal } from './mutationJournal.js';

const booleanAttributes = new Set(
  ('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ' +
   'ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected').split(' '),
);

/** HTML 속성의 이름을 표준화하고 렌더러가 지원하지 않는 속성은 거부한다. */
function getHostAttributeName(prop: string): string {
  const name = prop === 'className' ? 'class' : prop === 'htmlFor' ? 'for' : prop.toLowerCase();
  if (!/^[a-z_:][a-z0-9_.:-]*$/.test(name) || name.startsWith('on') ||
      name === 'dangerouslysetinnerhtml' || name === 'ref') {
    throw new TypeError(`Unsupported HTML attribute: ${prop}`);
  }
  return name;
}

/** 표시할 속성값은 문자열로 정규화하고 생략할 값은 null로 표시한다. */
function getHostAttributeValue(prop: string, name: string, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'boolean' && booleanAttributes.has(name)) return value ? '' : null;
  if (typeof value === 'string' || typeof value === 'number' ||
      (typeof value === 'boolean' && (name.startsWith('aria-') || name.startsWith('data-') ||
        name === 'contenteditable' || name === 'draggable' || name === 'spellcheck'))) {
    return String(value);
  }
  throw new TypeError(`Unsupported HTML attribute value: ${prop}`);
}

/** 일반 호스트는 같은 속성이면 커밋을 생략한다. 접근자의 값은 커밋에서만 읽는다. */
export function hasHostAttributeChanges(previous: object, next: object): boolean {
  let matched = 0;
  for (const prop in next) {
    if (prop === 'children') continue;
    const after = Object.getOwnPropertyDescriptor(next, prop);
    if (after === undefined) continue;
    const before = Object.getOwnPropertyDescriptor(previous, prop);
    if (!before?.enumerable || 'get' in after || 'get' in before ||
        after.value !== before.value) return true;
    matched++;
  }
  // 새 속성이 모두 일치했다. 이전 속성이 하나라도 더 있으면 삭제가 필요하다.
  for (const prop in previous) {
    if (prop !== 'children' && Object.hasOwn(previous, prop) && --matched < 0) return true;
  }
  return false;
}

/** 첫 마운트에서는 원본 props의 속성을 문서 밖 DOM에 바로 설정한다. */
export function setInitialHostAttributes(node: Element, props: object): void {
  for (const prop in props) {
    if (prop === 'children' || !Object.hasOwn(props, prop)) continue;
    const name = getHostAttributeName(prop);
    const value = getHostAttributeValue(prop, name, Reflect.get(props, prop));
    if (value !== null) node.setAttribute(name, value);
  }
}

/** 실제 DOM 값이 달라질 때만 원래 값을 기록하고 속성을 쓴다. */
function commitAttribute(node: Element, name: string, value: string | null, undo: MutationJournal): void {
  const before = node.getAttribute(name);
  if (before === value) return;
  undo.recordAttribute(node, name, before);
  applyHostAttribute(node, name, value);
}

/** 커밋에서 빠진 prop을 제거한 다음 새롭거나 값이 달라진 prop만 반영한다. */
export function updateHostAttributes(node: Element, previous: object, next: object, undo: MutationJournal): void {
  for (const prop in previous) {
    if (prop === 'children' || !Object.hasOwn(previous, prop) ||
        Object.prototype.propertyIsEnumerable.call(next, prop)) continue;
    const name = getHostAttributeName(prop);
    if (getHostAttributeValue(prop, name, Reflect.get(previous, prop)) !== null) {
      commitAttribute(node, name, null, undo);
    }
  }
  for (const prop in next) {
    if (prop === 'children' || !Object.hasOwn(next, prop)) continue;
    const value = Reflect.get(next, prop);
    if (Object.prototype.propertyIsEnumerable.call(previous, prop) && Reflect.get(previous, prop) === value) continue;
    const name = getHostAttributeName(prop);
    commitAttribute(node, name, getHostAttributeValue(prop, name, value), undo);
  }
}

/** DOM 속성에 값을 쓰고, 값이 null이면 해당 속성을 제거한다. */
export function applyHostAttribute(node: Element, name: string, value: string | null): void {
  if (value === null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}
