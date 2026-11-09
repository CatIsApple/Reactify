const booleanAttributes = new Set(
  ('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ' +
   'ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected').split(' '),
);

/** props에서 HTML 속성을 골라 DOM에 기록할 이름과 문자열 값으로 변환한다. */
export function readAttributes(props: object): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const prop of Object.keys(props)) {
    if (prop === 'children') continue;
    const name = prop === 'className' ? 'class' : prop === 'htmlFor' ? 'for' : prop.toLowerCase();
    if (!/^[a-z_:][a-z0-9_.:-]*$/.test(name) || name.startsWith('on') ||
        name === 'dangerouslysetinnerhtml' || name === 'ref') {
      throw new TypeError(`Unsupported HTML attribute: ${prop}`);
    }
    const value: unknown = Reflect.get(props, prop);
    if (value == null) continue;
    if (typeof value === 'boolean' && booleanAttributes.has(name)) {
      if (value) attributes.set(name, '');
    } else if (typeof value === 'string' || typeof value === 'number' ||
        (typeof value === 'boolean' && (name.startsWith('aria-') || name.startsWith('data-') ||
          name === 'contenteditable' || name === 'draggable' || name === 'spellcheck'))) {
      attributes.set(name, String(value));
    } else {
      throw new TypeError(`Unsupported HTML attribute value: ${prop}`);
    }
  }
  return attributes;
}

/** DOM 속성에 값을 쓰고, 값이 null이면 해당 속성을 제거한다. */
export function setAttribute(node: Element, name: string, value: string | null): void {
  if (value === null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}
