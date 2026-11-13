import { JSDOM } from 'jsdom';
import { createDOM } from '../src/core/index.ts';
import type { VNode } from '../src/core/index.ts';

export function query<K extends keyof HTMLElementTagNameMap>(
  root: ParentNode,
  selector: K,
): HTMLElementTagNameMap[K];
export function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T;
export function query(root: ParentNode, selector: string): Element {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Missing test element: ${selector}`);
  return node;
}

/** Fixtures in these tests explicitly create element roots, never text roots. */
export function createElementDOM<T extends HTMLElement = HTMLElement>(
  vnode: VNode,
  document: Document,
): T {
  const node = createDOM(vnode, document);
  if (node.nodeType !== 1) throw new Error('Expected an element fixture');
  return node as T;
}

export function environment(html = '<div id="root"></div>') {
  const window = new JSDOM(html, { url: 'http://localhost/' }).window;
  return {
    window,
    document: window.document,
    container: query<HTMLDivElement>(window.document, '#root'),
  };
}
