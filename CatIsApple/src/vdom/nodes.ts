import type { ElementChild, ReactifyElement } from '../element/index.js';

const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATH = 'http://www.w3.org/1998/Math/MathML';

/** HTML 속성과 별도로 사용자가 편집한 현재 폼 값을 저장한다. */
export interface FormState {
  value?: string;
  checked?: boolean;
  selected?: boolean;
  selectedIndex?: number;
}

/** DOM 요소의 이름, 속성, 이벤트, 현재 입력 상태와 자식 스냅샷. */
export interface VElement {
  kind: 'element';
  tag: string;
  namespace: string | null;
  attrs: Record<string, string>;
  events: Record<string, EventListener>;
  form: FormState;
  children: VNode[];
}

/** 자식 목록은 요소, 텍스트, 주석을 실제 DOM 순서대로 담는다. */
export type VNode = VElement | { kind: 'text' | 'comment'; text: string };

/** template은 자식 노드를 별도의 DocumentFragment에 보관한다. */
export function childContainer(node: Node): Node {
  const template = node as HTMLTemplateElement;
  return template.localName === 'template' && template.content?.nodeType === 11 ? template.content : node;
}

/** 마크업 속성으로는 복원되지 않는 현재 입력값과 선택을 읽는다. */
function readForm(element: Element): FormState {
  switch (element.localName) {
    case 'input': {
      const input = element as HTMLInputElement;
      if (input.type === 'file') return {};
      const form: FormState = { value: input.value };
      if (input.type === 'checkbox' || input.type === 'radio') form.checked = input.checked;
      return form;
    }
    case 'textarea': return { value: (element as HTMLTextAreaElement).value };
    case 'select': {
      const select = element as HTMLSelectElement;
      return select.multiple ? {} : { selectedIndex: select.selectedIndex };
    }
    case 'option': return { selected: (element as HTMLOptionElement).selected };
    default: return {};
  }
}

/** 컨테이너의 자식을 읽어 독립된 트리를 만든다. 공백과 주석도 같은 위치에 남긴다. */
export function readChildren(parent: Node): VNode[] {
  const nodes: VNode[] = [];
  for (const node of Array.from(childContainer(parent).childNodes)) {
    if (node.nodeType === 3 || node.nodeType === 8) {
      nodes.push({ kind: node.nodeType === 3 ? 'text' : 'comment', text: node.nodeValue ?? '' });
    } else if (node.nodeType === 1) {
      const element = node as Element;
      nodes.push({
        kind: 'element', tag: element.localName, namespace: element.namespaceURI,
        attrs: Object.fromEntries(Array.from(element.attributes, attr => [attr.name, attr.value])),
        events: {}, form: element.namespaceURI === HTML ? readForm(element) : {},
        children: readChildren(element),
      });
    }
  }
  return nodes;
}

const booleanAttributes = new Set('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(' '));

/** 함수 컴포넌트의 호스트 props를 HTML 속성, DOM 이벤트, 폼 값으로 분리한다. */
function resolveProps(node: VElement, props: ReactifyElement['props']): void {
  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || value == null) continue;
    if (typeof value === 'function' && /^on[A-Za-z]/.test(name)) {
      node.events[name.slice(2).toLowerCase()] = value as EventListener;
      continue;
    }
    const attr = name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name;
    const normalized = node.namespace === HTML ? attr.toLowerCase() : attr;
    if (node.namespace === HTML) {
      if (name === 'value' && ['input', 'textarea', 'select'].includes(node.tag)) {
        if (node.tag !== 'input' || (props as { type?: string }).type !== 'file') node.form.value = String(value);
        if (node.tag !== 'input') continue;
      }
      if (name === 'checked' && node.tag === 'input') node.form.checked = Boolean(value);
      if (name === 'selected' && node.tag === 'option') node.form.selected = Boolean(value);
      if (booleanAttributes.has(normalized) && typeof value === 'boolean') {
        if (value) node.attrs[normalized] = '';
        continue;
      }
    }
    node.attrs[normalized] = String(value);
  }
}

/** Element와 중첩 배열을 호스트 트리로 펼친다. 자식 함수는 이 단계에서 전달받은 props로 호출된다. */
export function resolveChildren(value: ElementChild): VNode[] {
  /** 부모 네임스페이스를 전달하며 반환값을 현재 형제 목록에 이어 붙인다. */
  function collect(child: ElementChild, namespace: string, result: VNode[]): void {
    if (child == null || typeof child === 'boolean') return;
    if (typeof child === 'string' || typeof child === 'number') {
      result.push({ kind: 'text', text: String(child) });
      return;
    }
    if (Array.isArray(child)) {
      for (const item of child) collect(item, namespace, result);
      return;
    }
    const element = child as ReactifyElement;
    if (typeof element.type === 'function') {
      collect(element.type(element.props as never), namespace, result);
      return;
    }
    const tag = element.type;
    const ns = tag === 'svg' ? SVG : tag === 'math' ? MATH : namespace;
    const node: VElement = {
      kind: 'element', tag: ns === HTML ? tag.toLowerCase() : tag, namespace: ns,
      attrs: Object.create(null), events: Object.create(null), form: {}, children: [],
    };
    resolveProps(node, element.props);
    collect(element.props.children, ns === SVG && tag === 'foreignObject' ? HTML : ns, node.children);
    result.push(node);
  }
  const nodes: VNode[] = [];
  collect(value, HTML, nodes);
  return nodes;
}
