import type { Child, Component, DOMProps, KeyAttributes, Props, VNode } from './types.ts';

export const TEXT = '#text';
export const COMMENT = '#comment';

export function normalizeChildren(children: readonly Child[]): VNode[] {
  const result: VNode[] = [];
  const visit = (child: Child): void => {
    if (child == null || typeof child === 'boolean') return;
    if (Array.isArray(child)) child.forEach(visit);
    else if (typeof child === 'object') result.push(child as VNode);
    else result.push(text(child));
  };
  children.forEach(visit);
  return result;
}

export function text(value: string | number | null): VNode {
  return { type: TEXT, key: null, props: { nodeValue: String(value) }, children: [] };
}

export function h(type: string, props?: DOMProps | null, ...children: Child[]): VNode;
export function h(
  type: Component<object>,
  props?: KeyAttributes | null,
  ...children: Child[]
): VNode;
export function h<P extends object>(
  type: Component<P>,
  props: P & KeyAttributes,
  ...children: Child[]
): VNode;
export function h<P extends object>(
  type: string | Component<P>,
  props: (P & KeyAttributes) | DOMProps | null = {},
  ...children: Child[]
): VNode {
  props = props ?? {};
  const { key = null, ...rest } = props;
  return {
    type,
    key: key === null ? null : String(key),
    props: rest,
    children: normalizeChildren(children),
  };
}

/** Read live form properties as well as attributes; preserve whitespace and comments. */
export function domToVNode(node: Node): VNode {
  if (node.nodeType === 3) return text(node.nodeValue);
  if (node.nodeType === 8)
    return { type: COMMENT, key: null, props: { nodeValue: node.nodeValue }, children: [] };
  if (node.nodeType !== 1) throw new TypeError('Element, Text 또는 Comment 노드가 필요합니다.');
  const element = node as Element;
  const props: Props = Object.fromEntries(
    [...element.attributes].map((attr) => [attr.name, attr.value]),
  );
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (field.type !== 'file') props.value = field.value;
  }
  if (
    element.tagName === 'INPUT' &&
    ['checkbox', 'radio'].includes((element as HTMLInputElement).type)
  )
    props.checked = (element as HTMLInputElement).checked;
  if (element.tagName === 'OPTION') props.selected = (element as HTMLOptionElement).selected;
  return {
    type: element.localName,
    key: element.getAttribute('data-key'),
    props,
    namespace: element.namespaceURI,
    children: [...node.childNodes].map(domToVNode),
  };
}

export function assertUniqueKeys(children: readonly Pick<VNode, 'key'>[]): void {
  const keys = new Set<string>();
  for (const child of children) {
    if (child.key === null || child.key === undefined) continue;
    if (keys.has(child.key)) throw new Error(`중복 key: ${child.key}`);
    keys.add(child.key);
  }
}

export function matchChildren(
  previous: readonly Pick<VNode, 'key'>[],
  next: readonly Pick<VNode, 'key'>[],
): { matches: number[]; removed: number[] } {
  assertUniqueKeys(previous);
  assertUniqueKeys(next);
  const keyed = new Map<string, number>();
  previous.forEach((child, index) => {
    if (child.key != null) keyed.set(child.key, index);
  });
  const used = new Set<number>();
  const matches = next.map((child, index) => {
    const match =
      child.key != null
        ? keyed.get(child.key)
        : previous[index]?.key == null && index < previous.length
          ? index
          : undefined;
    if (match === undefined || used.has(match)) return -1;
    used.add(match);
    return match;
  });
  return {
    matches,
    removed: previous.map((_, index) => index).filter((index) => !used.has(index)),
  };
}
