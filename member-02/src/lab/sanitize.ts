// A deliberately bounded HTML playground, not a general purpose sanitizer library.
const tags = new Set(
  'div section article header footer main aside nav h1 h2 h3 h4 h5 h6 p span strong em b i u s small mark code pre blockquote ul ol li dl dt dd a button input textarea select option optgroup label fieldset legend form table thead tbody tfoot tr th td caption colgroup col br hr details summary figure figcaption img svg path circle rect line polyline polygon ellipse g title'.split(
    ' ',
  ),
);
const forbidden = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'template',
]);
const safeAttributes = new Set(
  'id class title role style data-key href target rel src alt width height viewbox d fill stroke stroke-width cx cy r x y x1 x2 y1 y2 points rx ry transform type value checked disabled selected multiple required readonly placeholder name for min max step rows cols open colspan rowspan scope'.split(
    ' ',
  ),
);

export function sanitizeHTML(
  source: string,
  document: Document = globalThis.document,
): { fragment: DocumentFragment; removed: number } {
  const template = document.createElement('template');
  template.innerHTML = source;
  let removed = 0;
  for (const element of [...template.content.querySelectorAll('*')]) {
    const tag = element.localName.toLowerCase();
    if (forbidden.has(tag)) {
      element.remove();
      removed++;
      continue;
    }
    if (!tags.has(tag)) {
      element.replaceWith(...element.childNodes);
      removed++;
      continue;
    }
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      const cleanURL = attr.value.replace(/[\s\u0000-\u001f]/g, '');
      const badURL =
        ['href', 'src'].includes(name) && !/^(https?:\/\/|#|\/[^/]|\.\/|\.\.\/)/i.test(cleanURL);
      // No remote CSS loading, positioning outside the preview, or CSS URL execution.
      const badStyle =
        name === 'style' &&
        /url\s*\(|expression|@import|position\s*:|behavior\s*:|-moz-binding|[\\{}<>]/i.test(
          attr.value,
        );
      if (
        (!safeAttributes.has(name) && !name.startsWith('aria-') && !name.startsWith('data-')) ||
        name.startsWith('on') ||
        badURL ||
        badStyle
      ) {
        element.removeAttribute(attr.name);
        removed++;
      }
    }
    if (tag === 'a') {
      element.setAttribute('rel', 'noopener noreferrer');
      element.removeAttribute('target');
    }
    if (tag === 'input' && element.getAttribute('type') === 'file') {
      element.setAttribute('type', 'text');
      removed++;
    }
  }
  return { fragment: template.content, removed };
}
