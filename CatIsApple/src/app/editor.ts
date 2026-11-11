import { StateHistory } from '../history/index.js';
import { diff, patch, readChildren, type VNode } from '../vdom/index.js';

/** 페이지가 제공해야 하는 버튼과 편집 영역을 찾는다. */
function requiredElement<T extends HTMLElement>(doc: Document, id: string): T {
  const element = doc.getElementById(id);
  if (!element) throw new Error(`편집 화면에 #${id} 요소가 필요합니다.`);
  return element as T;
}

/** 두 영역에서 같은 id의 라벨과 같은 name의 라디오가 각각 자기 입력만 가리키게 한다. */
function isolateSample(region: HTMLElement): void {
  const host = region.parentElement;
  if (!host?.classList.contains('sample-scope')) return;
  const scope = host.attachShadow({ mode: 'open' });
  const style = region.ownerDocument.querySelector('link[rel="stylesheet"]');
  if (style) scope.append(style.cloneNode(true));
  scope.append(region);
}

/** 샘플을 현재 페이지에 표시하기 전에 스크립트와 문서 전체를 바꾸는 요소를 제거한다. */
function removeActiveMarkup(root: ParentNode): void {
  for (const element of root.querySelectorAll('script, iframe, frame, object, embed, base, meta, link')) {
    element.remove();
  }
  for (const template of root.querySelectorAll('template')) {
    removeActiveMarkup(template.content);
  }
  for (const element of root.querySelectorAll('*')) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.localName.toLowerCase();
      const url = attr.value.replace(/[\t\n\r]/g, '').trimStart();
      if (name.startsWith('on') || (/^(href|src|action|formaction)$/i.test(name) && /^javascript:/i.test(url))) {
        element.removeAttributeNode(attr);
      }
    }
  }
}

/** HTML 속성과 별도로 바뀐 폼 값을 소스 편집기에도 표시한다. */
function serializePreview(preview: HTMLElement): string {
  const copy = preview.cloneNode(true) as HTMLElement;
  const selector = 'input, textarea, option';
  const originals = preview.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLOptionElement>(selector);
  const copies = copy.querySelectorAll(selector);
  originals.forEach((control, index) => {
    const target = copies[index];
    switch (control.localName) {
      case 'input': {
        const input = control as HTMLInputElement;
        if (['checkbox', 'radio'].includes(input.type)) {
          target.toggleAttribute('checked', input.checked);
        } else if (input.type !== 'file' && input.value !== input.defaultValue) {
          target.setAttribute('value', input.value);
        }
        break;
      }
      case 'textarea':
        target.textContent = (control as HTMLTextAreaElement).value;
        break;
      case 'option':
        target.toggleAttribute('selected', (control as HTMLOptionElement).selected);
        break;
    }
  });
  return copy.innerHTML;
}

/** 실제 영역에서 시작해 테스트 편집, 부분 반영, 양방향 이력 이동을 연결한다. */
export function bindEditor(doc: Document = document): void {
  const actual = requiredElement(doc, 'actual');
  const preview = requiredElement(doc, 'preview');
  const editor = requiredElement<HTMLTextAreaElement>(doc, 'html-editor');
  const apply = requiredElement<HTMLButtonElement>(doc, 'patch');
  const undo = requiredElement<HTMLButtonElement>(doc, 'undo');
  const redo = requiredElement<HTMLButtonElement>(doc, 'redo');
  const position = requiredElement(doc, 'history-position');
  isolateSample(actual);
  isolateSample(preview);
  const history = new StateHistory(readChildren(actual));
  let actualInputChanged = false;

  /** 실제 영역에서 폼을 조작하면 다음 Patch에서 마지막 이력과 다른 입력값도 복원한다. */
  function markActualInput(): void {
    actualInputChanged = true;
  }

  /** 미리보기의 현재 DOM과 새 스냅샷에서 바뀐 곳만 수정한다. */
  function updatePreview(nodes: VNode[]): void {
    patch(preview, diff(readChildren(preview), nodes));
  }

  /** 현재 위치와 이동 가능한 방향을 버튼에 반영한다. */
  function refreshControls(): void {
    position.textContent = `${history.index + 1} / ${history.length}`;
    undo.disabled = history.index === 0;
    redo.disabled = history.index === history.length - 1;
  }

  /** 현재 폼 값과 편집된 텍스트를 HTML 소스에 동기화한다. */
  function syncSource(): void {
    editor.value = serializePreview(preview);
  }

  /** 소스 입력을 비활성 템플릿에서 해석하고 미리보기만 갱신한다. */
  function previewSource(): void {
    const template = doc.createElement('template');
    template.innerHTML = editor.value;
    removeActiveMarkup(template.content);
    updatePreview(readChildren(template.content));
  }

  /** 테스트 영역을 읽어 마지막 스냅샷과 비교하고 바뀐 상태만 기록한다. */
  function applyPatch(): void {
    removeActiveMarkup(preview);
    const next = readChildren(preview);
    const changes = diff(history.current, next);
    patch(actual, actualInputChanged ? diff(readChildren(actual), next) : changes);
    actualInputChanged = false;
    if (changes.length) history.push(next);
    syncSource();
    refreshControls();
  }

  /** 확정된 이력으로 실제 영역과 미리보기를 함께 되돌리거나 다시 적용한다. */
  function navigate(step: -1 | 1): void {
    const next = history.move(step);
    patch(actual, diff(readChildren(actual), next));
    actualInputChanged = false;
    updatePreview(next);
    syncSource();
    refreshControls();
  }

  updatePreview(history.current);
  syncSource();
  refreshControls();
  preview.addEventListener('submit', event => event.preventDefault());
  actual.addEventListener('input', markActualInput);
  actual.addEventListener('change', markActualInput);
  actual.addEventListener('submit', event => event.preventDefault());
  editor.addEventListener('input', previewSource);
  preview.addEventListener('input', syncSource);
  preview.addEventListener('change', syncSource);
  apply.addEventListener('click', applyPatch);
  undo.addEventListener('click', () => navigate(-1));
  redo.addEventListener('click', () => navigate(1));
}
