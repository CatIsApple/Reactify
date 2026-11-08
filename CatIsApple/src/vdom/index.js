export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const listeners = new WeakMap();
const booleanAttributes = new Set('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(' '));
const aliases = { className: 'class', htmlFor: 'for', readOnly: 'readonly', tabIndex: 'tabindex' };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function text(value) {
  return { type: '#text', props: { nodeValue: String(value) }, children: [], key: null };
}

export function normalizeChildren(value) {
  const result = [];
  const visit = (child) => {
    if (child == null || typeof child === 'boolean') return;
    if (Array.isArray(child)) return child.forEach(visit);
    if (typeof child === 'string' || typeof child === 'number') result.push(text(child));
    else if (typeof child === 'object' && (typeof child.type === 'string' || typeof child.type === 'function')) result.push(child);
    else throw new TypeError('자식은 VNode, 문자열, 숫자 또는 그 배열이어야 합니다.');
  };
  visit(value);
  return result;
}

export function h(type, props = null, ...children) {
  if (typeof type !== 'string' && typeof type !== 'function') throw new TypeError('VNode type이 올바르지 않습니다.');
  if (props != null && (typeof props !== 'object' || Array.isArray(props))) throw new TypeError('props는 객체여야 합니다.');
  const attributes = { ...(props ?? {}) };
  const key = attributes.key ?? null;
  if (key !== null && typeof key !== 'string' && typeof key !== 'number') throw new TypeError('key는 문자열 또는 숫자여야 합니다.');
  const normalized = normalizeChildren(children.length ? children : attributes.children);
  delete attributes.key;
  delete attributes.children;
  return { type, props: attributes, children: normalized, key };
}

function cloneValue(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : Object.create(proto);
  seen.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = cloneValue(value[key], seen);
  return copy;
}

export function cloneTree(tree) {
  return cloneValue(normalizeChildren(tree));
}

export function sameValue(a, b, seen = new WeakMap()) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (!Array.isArray(a) && Object.getPrototypeOf(a) !== Object.prototype && Object.getPrototypeOf(a) !== null) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => own(b, key) && sameValue(a[key], b[key], seen));
}

export function domToVNode(node) {
  if (!node) return null;
  if (node.nodeType === 3) return text(node.nodeValue ?? '');
  if (node.nodeType !== 1) return null;
  const props = Object.fromEntries([...node.attributes].map((attr) => [attr.name, attr.value]));
  const vnode = { type: node.localName, props, children: domToTree(node), key: node.getAttribute('data-key') };
  if (node.namespaceURI !== HTML_NAMESPACE) vnode.namespaceURI = node.namespaceURI;
  // Attributes preserve defaults; domProps preserves current values independently.
  if (node.namespaceURI === HTML_NAMESPACE) {
    if (node.localName === 'input') vnode.domProps = { value: node.value, checked: node.checked };
    if (node.localName === 'textarea') vnode.domProps = { value: node.value };
    if (node.localName === 'option') vnode.domProps = { selected: node.selected };
    if (node.localName === 'select' && !node.multiple) vnode.domProps = { value: node.value, selectedIndex: node.selectedIndex };
  }
  return vnode;
}

export function domToTree(container) {
  return [...container.childNodes].map(domToVNode).filter(Boolean);
}

export function nodeNamespace(vnode, parentNamespace = HTML_NAMESPACE) {
  return vnode.namespaceURI || (vnode.type === 'svg' ? SVG_NAMESPACE : parentNamespace);
}

function eventInfo(name) {
  if (!/^on[a-z]/i.test(name)) return null;
  const capture = name.endsWith('Capture');
  let event = name.slice(2, capture ? -7 : undefined).toLowerCase();
  if (event === 'doubleclick') event = 'dblclick';
  return { event, capture };
}

/** Validate supported prop contracts without creating or mutating DOM nodes. */
export function validateDOMProps(type, props = {}, domProps = {}, namespace = HTML_NAMESPACE) {
  for (const [name, value] of Object.entries(props)) {
    if (name === 'key' || name === 'children') continue;
    if (eventInfo(name)) {
      if (value != null && typeof value !== 'function') throw new TypeError(`${name} 이벤트에는 함수를 전달하세요.`);
      continue;
    }
    if (name === 'style' && value != null && typeof value !== 'string') throw new TypeError('style은 CSS 문자열로 전달하세요.');
    if (typeof value === 'function' || (value && typeof value === 'object')) throw new TypeError(`${name} 속성 값이 올바르지 않습니다.`);
  }
  const value = own(domProps, 'value') ? domProps.value : props.value;
  if (namespace === HTML_NAMESPACE && type === 'input' && String(props.type).toLowerCase() === 'file'
    && value != null && String(value) !== '') {
    throw new TypeError('파일 input의 value는 비워 두세요. 파일 선택 값은 코드로 복원할 수 없습니다.');
  }
}

export function validateTree(tree, parentNamespace = HTML_NAMESPACE) {
  for (const node of normalizeChildren(tree)) {
    if (typeof node.type !== 'string') throw new TypeError('함수 컴포넌트는 렌더러에서 먼저 평가해야 합니다.');
    if (node.type === '#text') continue;
    const namespace = nodeNamespace(node, parentNamespace);
    validateDOMProps(node.type, node.props, node.domProps, namespace);
    validateTree(node.children, namespace === SVG_NAMESPACE && node.type === 'foreignObject' ? HTML_NAMESPACE : namespace);
  }
}

function setAttribute(node, name, value) {
  const attribute = aliases[name] ?? name;
  const boolean = node.namespaceURI === HTML_NAMESPACE && booleanAttributes.has(attribute.toLowerCase());
  if (value == null || (value === false && boolean)) {
    if (node.hasAttribute(attribute)) node.removeAttribute(attribute);
    return;
  }
  const string = boolean && value === true ? '' : String(value);
  if (node.getAttribute(attribute) === string) return;
  if (attribute.startsWith('xlink:')) node.setAttributeNS(XLINK_NAMESPACE, attribute, string);
  else node.setAttribute(attribute, string);
}

// Shared by initial creation and Patch. Events are functions, never HTML strings.
export function applyDOMProps(node, previous = {}, next = {}) {
  for (const name of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (name === 'key' || name === 'children') continue;
    const oldValue = previous[name];
    const value = next[name];
    if (sameValue(oldValue, value) && own(previous, name) === own(next, name)) continue;
    const event = eventInfo(name);
    if (event) {
      if (value != null && typeof value !== 'function') throw new TypeError(`${name} 이벤트에는 함수를 전달하세요.`);
      let registered = listeners.get(node);
      if (!registered) listeners.set(node, registered = new Map());
      const oldListener = registered.get(name);
      if (oldListener) node.removeEventListener(event.event, oldListener, event.capture);
      registered.delete(name);
      if (value) {
        node.addEventListener(event.event, value, event.capture);
        registered.set(name, value);
      }
      continue;
    }
    if (name === 'style' && value != null && typeof value !== 'string') throw new TypeError('style은 CSS 문자열로 전달하세요.');
    if (typeof value === 'function' || (value && typeof value === 'object')) throw new TypeError(`${name} 속성 값이 올바르지 않습니다.`);
    if (name === 'value' && (node.localName === 'textarea' || node.localName === 'select')) continue;
    setAttribute(node, name, value);
  }
}

export function syncDOMProperties(node, previousProps = {}, props = {}, previousDomProps = {}, domProps = {}) {
  if (node.namespaceURI !== HTML_NAMESPACE) return;
  const previous = { ...previousProps, ...previousDomProps };
  const next = { ...props, ...domProps };
  const keys = node.localName === 'input' ? ['value', 'checked']
    : node.localName === 'select' ? ['value', 'selectedIndex'] : node.localName === 'textarea' ? ['value']
      : node.localName === 'option' ? ['selected'] : [];
  for (const key of keys) {
    if (!own(previous, key) && !own(next, key)) continue;
    // Only snapshots specify selectedIndex; removing snapshot metadata must not
    // override a new component-controlled value.
    if (key === 'selectedIndex' && !own(domProps, key)) continue;
    const value = key === 'selectedIndex' ? Number(domProps[key]) : key === 'value' ? String(next[key] ?? '') : own(domProps, key)
      ? Boolean(domProps[key]) : next[key] != null && next[key] !== false;
    if (node.localName === 'input' && node.type === 'file' && key === 'value' && value !== '') {
      throw new TypeError('파일 input의 value는 비워 두세요. 파일 선택 값은 코드로 복원할 수 없습니다.');
    }
    if (!Object.is(node[key], value)) node[key] = value;
  }
}

function buildDOM(vnode, doc, parentNamespace) {
  if (typeof vnode.type !== 'string') throw new TypeError('함수 컴포넌트는 렌더러에서 먼저 평가해야 합니다.');
  if (vnode.type === '#text') return doc.createTextNode(vnode.props.nodeValue);
  const namespace = nodeNamespace(vnode, parentNamespace);
  const node = namespace === HTML_NAMESPACE ? doc.createElement(vnode.type) : doc.createElementNS(namespace, vnode.type);
  applyDOMProps(node, {}, vnode.props);
  const childNamespace = namespace === SVG_NAMESPACE && vnode.type === 'foreignObject' ? HTML_NAMESPACE : namespace;
  for (const child of vnode.children) node.append(buildDOM(child, doc, childNamespace));
  syncDOMProperties(node, {}, vnode.props, {}, vnode.domProps);
  return node;
}

export function createDOM(vnode, doc = globalThis.document, parentNamespace = HTML_NAMESPACE) {
  if (!doc) throw new TypeError('DOM document가 필요합니다.');
  validateTree([vnode], parentNamespace);
  return buildDOM(vnode, doc, parentNamespace);
}

export function mountTree(container, tree) {
  const namespace = container.namespaceURI === SVG_NAMESPACE && container.localName !== 'foreignObject' ? SVG_NAMESPACE : HTML_NAMESPACE;
  container.replaceChildren(...normalizeChildren(tree).map((vnode) => createDOM(vnode, container.ownerDocument, namespace)));
  return container;
}

const htmlTags = new Set('a abbr address article aside b bdi bdo blockquote br button caption cite code col colgroup data dd del details dfn div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img input ins kbd label legend li main mark menu nav ol optgroup option output p picture pre progress q rp rt ruby s samp section select small source span strong sub summary sup table tbody td template textarea tfoot th thead time tr u ul var video audio'.split(' '));
const svgTags = new Set('svg g path circle ellipse rect line polyline polygon title desc defs lineargradient radialgradient stop clippath mask symbol use'.split(' '));
const blockedTags = new Set('script style iframe object embed link meta base noscript'.split(' '));
const attributes = new Set('id class title role style lang dir hidden tabindex name type value checked selected disabled multiple required readonly placeholder min max step minlength maxlength pattern rows cols size for form action method enctype autocomplete autofocus accept alt width height src href target rel download media poster controls loop muted preload datetime open start reversed colspan rowspan scope headers span abbr label low high optimum max cite loading decoding xmlns viewBox preserveAspectRatio d fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity transform x y x1 x2 y1 y2 cx cy r rx ry points offset stop-color stop-opacity gradientUnits gradientTransform clip-path clip-rule mask xlink:href'.split(' '));
const urlAttributes = new Set(['href', 'src', 'action', 'poster', 'cite', 'xlink:href']);

function safeURL(value, name, svg) {
  const compact = value.trim().replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (svg && (name === 'href' || name === 'xlink:href')) return compact.startsWith('#');
  const protocol = /^([a-z][a-z\d+.-]*):/i.exec(compact)?.[1].toLowerCase();
  if (!protocol) return true;
  return protocol === 'http' || protocol === 'https' || (name === 'href' && (protocol === 'mailto' || protocol === 'tel'));
}

export function parseHTML(html, doc = globalThis.document) {
  if (!doc) throw new TypeError('DOM document가 필요합니다.');
  const template = doc.createElement('template');
  template.innerHTML = String(html);
  const warnings = new Set();
  const clean = (parent) => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === 8) { node.remove(); continue; }
      if (node.nodeType !== 1) continue;
      const tag = node.localName.toLowerCase();
      const svg = node.namespaceURI === SVG_NAMESPACE;
      const allowed = svg ? svgTags.has(tag) : node.namespaceURI === HTML_NAMESPACE && htmlTags.has(tag);
      if (!allowed) {
        warnings.add(`허용되지 않은 <${node.localName}> 요소를 제거했습니다.`);
        if (blockedTags.has(tag) || svg || tag === 'math') node.remove();
        else { clean(node); node.replaceWith(...node.childNodes); }
        continue;
      }
      // Templates need separate traversal and are not rendered preview content.
      if (tag === 'template') {
        clean(node.content);
        node.replaceWith(...node.content.childNodes);
        continue;
      }
      for (const attr of [...node.attributes]) {
        const name = attr.name;
        const lower = name.toLowerCase();
        let invalidEscape = false;
        const css = attr.value.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => {
          const code = parseInt(hex, 16);
          if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
            invalidEscape = true;
            return '\ufffd';
          }
          return String.fromCodePoint(code);
        }).replace(/\\(.)/g, '$1');
        const unsafe = lower.startsWith('on') || lower === 'srcdoc'
          || (!attributes.has(name) && !/^data-[\w-]+$/.test(name) && !/^aria-[\w-]+$/.test(name))
          || (urlAttributes.has(lower) && !safeURL(attr.value, lower, svg))
          || (lower === 'style' && (invalidEscape || /url\s*\(|expression\s*\(|@|behavior\s*:|-moz-binding/i.test(css)));
        if (unsafe) {
          node.removeAttribute(name);
          warnings.add(`<${node.localName}>의 ${name} 속성을 제거했습니다.`);
        }
      }
      if (node.getAttribute('target') === '_blank') {
        const rel = new Set((node.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean));
        rel.add('noopener'); rel.add('noreferrer');
        node.setAttribute('rel', [...rel].join(' '));
      }
      clean(node);
    }
  };
  clean(template.content);
  return { tree: domToTree(template.content), html: template.innerHTML, warnings: [...warnings] };
}
