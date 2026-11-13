import { TEXT, COMMENT, assertUniqueKeys } from './vnode.ts';
import type { VNode } from './types.ts';

const isEvent = (name: string): boolean => /^on[A-Z]/.test(name);
const booleanProps = new Set([
  'checked',
  'disabled',
  'selected',
  'multiple',
  'required',
  'readOnly',
  'autofocus',
  'hidden',
]);
const aliases: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  readOnly: 'readonly',
};
const attributeName = (name: string): string => aliases[name] ?? name;

export function setProp(dom: Element, name: string, previous: unknown, value: unknown): void {
  if (name === 'children' || name === 'key') return;
  if (isEvent(name)) {
    const capture = name.endsWith('Capture');
    const event = name.slice(2, capture ? -7 : undefined).toLowerCase();
    if (typeof previous === 'function')
      dom.removeEventListener(event, previous as EventListener, capture);
    if (typeof value === 'function') dom.addEventListener(event, value as EventListener, capture);
  } else if (name === 'style' && (typeof value === 'object' || typeof previous === 'object')) {
    dom.removeAttribute('style');
    if (typeof value === 'string') dom.setAttribute('style', value);
    else if ('style' in dom)
      for (const [key, val] of Object.entries(value ?? {})) {
        const style = (dom as HTMLElement | SVGElement).style;
        if (key.startsWith('--') || key.includes('-'))
          style.setProperty(key, val == null ? '' : String(val));
        else Reflect.set(style, key, val);
      }
  } else if (name === 'value' && 'value' in dom) {
    const next = value == null ? '' : String(value);
    if (dom.value !== next) dom.value = next;
    if (value == null) dom.removeAttribute('value');
  } else if (booleanProps.has(name)) {
    const enabled = value !== false && value != null;
    if (name in dom) Reflect.set(dom, name, enabled);
    if (enabled) dom.setAttribute(attributeName(name), '');
    else dom.removeAttribute(attributeName(name));
  } else if (value === null || value === undefined || value === false) {
    if (name.startsWith('aria-') && value === false) dom.setAttribute(name, 'false');
    else dom.removeAttribute(attributeName(name));
  } else {
    dom.setAttribute(attributeName(name), String(value));
  }
}

export function createDOM(
  vnode: VNode,
  document: Document = globalThis.document,
  parentNamespace?: string | null,
): Node {
  if (vnode.type === TEXT) return document.createTextNode(String(vnode.props.nodeValue));
  if (vnode.type === COMMENT) return document.createComment(String(vnode.props.nodeValue));
  if (typeof vnode.type !== 'string')
    throw new TypeError('함수형 컴포넌트는 Fiber로 평가한 뒤 DOM으로 변환해야 합니다.');
  assertUniqueKeys(vnode.children);
  const namespace =
    vnode.namespace ?? (vnode.type === 'svg' ? 'http://www.w3.org/2000/svg' : parentNamespace);
  const dom =
    namespace && namespace !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(namespace, vnode.type)
      : document.createElement(vnode.type);
  for (const [name, value] of Object.entries(vnode.props))
    if (name !== 'value') setProp(dom, name, undefined, value);
  const childNS = vnode.type === 'foreignObject' ? 'http://www.w3.org/1999/xhtml' : namespace;
  for (const child of vnode.children) dom.appendChild(createDOM(child, document, childNS));
  if ('value' in vnode.props) setProp(dom, 'value', undefined, vnode.props.value);
  return dom;
}
