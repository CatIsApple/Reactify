// 구현 방식과 상관없이 쓸 수 있는 검증 도구. (/verify 스킬이 사용)

/**
 * DOM을 비교용 문자열로 만든다. 속성 순서는 정렬하고 주석은 뺀다.
 * innerHTML은 속성 순서까지 비교해서, 올바른 구현도 실패할 수 있다.
 */
export function canonical(node) {
  if (!node) return '∅';
  if (node.nodeType === 3) return JSON.stringify(node.nodeValue);
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const children = [...node.childNodes].map(canonical).join('');
  if (node.nodeType === 11) return children;
  const attrs = [...node.attributes]
    .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
    .sort()
    .join(' ');
  return `<${node.localName}${attrs ? ' ' + attrs : ''}>${children}</${node.localName}>`;
}

/** HTML 문자열 → DOM 노드 (첫 노드) */
export function parse(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstChild;
}

/** 객체를 깊게 얼린다. 얼린 값을 수정하면 TypeError가 난다. (불변성 검사) */
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** fn 실행 중 document / window에 접근하면 에러를 던진다. (비교 단계가 DOM을 안 건드리는지 검사) */
export function withoutDom(fn) {
  const saved = { document: globalThis.document, window: globalThis.window };
  const trap = (name) =>
    new Proxy({}, {
      get(_, prop) {
        throw new Error(`DOM 접근 감지: ${name}.${String(prop)}`);
      },
    });
  globalThis.document = trap('document');
  globalThis.window = trap('window');
  try {
    return fn();
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
}

/** root 아래 모든 노드를 [노드, 경로문자열] 목록으로. (patch 전후 노드 재사용 검사) */
export function collectNodes(root, path = '') {
  const list = [[root, path]];
  [...root.childNodes].forEach((child, i) => list.push(...collectNodes(child, `${path}/${i}`)));
  return list;
}

/** fn 실행 중 root 아래에서 일어난 DOM 변경 기록을 돌려준다. (변경 횟수 검사) */
export async function recordMutations(root, fn) {
  const records = [];
  const observer = new MutationObserver((r) => records.push(...r));
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  await fn();
  records.push(...observer.takeRecords());
  observer.disconnect();
  return records;
}
