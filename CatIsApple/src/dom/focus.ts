/** 컨테이너와 같은 문서나 섀도 루트에서 실제로 포커스를 받은 요소를 찾는다. */
function focusedElement(container: Element): Element | null {
  const root = container.getRootNode() as Document | ShadowRoot;
  let active = root.activeElement ?? container.ownerDocument.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** 열린 섀도 트리의 호스트까지 따라가며 해당 요소가 커밋 대상 안에 있는지 확인한다. */
function containsFocus(container: Element, element: Element): boolean {
  let node: Element | undefined = element;
  while (node) {
    if (container.contains(node)) return true;
    node = (node.getRootNode() as ShadowRoot).host;
  }
  return false;
}

/** 입력칸의 선택 방향과 범위 또는 편집 가능한 본문의 양 끝점을 기록한다. */
function captureSelection(element: HTMLElement): (() => void) | null {
  if (element.localName === 'input' || element.localName === 'textarea') {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = input;
    if (start === null || end === null) return null;
    // 입력 타입이 여전히 선택을 지원하고 브라우저가 범위를 바꿨을 때만 복원한다.
    return () => {
      if (input.selectionStart !== null &&
          (input.selectionStart !== start || input.selectionEnd !== end || input.selectionDirection !== direction)) {
        input.setSelectionRange(start, end, direction ?? undefined);
      }
    };
  }

  if (!element.isContentEditable) return null;
  const selection = element.ownerDocument.getSelection();
  if (!selection) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (!anchorNode || !focusNode || !element.contains(anchorNode) || !element.contains(focusNode)) return null;
  // 이동 뒤에도 같은 텍스트 노드가 남아 있으면 사용자가 선택한 방향으로 양 끝점을 연결한다.
  return () => {
    if (!element.contains(anchorNode) || !element.contains(focusNode)) return;
    if (selection.anchorNode === anchorNode && selection.anchorOffset === anchorOffset &&
        selection.focusNode === focusNode && selection.focusOffset === focusOffset) return;
    selection.setBaseAndExtent(
      anchorNode, Math.min(anchorOffset, selectionLength(anchorNode)),
      focusNode, Math.min(focusOffset, selectionLength(focusNode)),
    );
  };
}

/** 선택 끝점의 최대 오프셋은 텍스트에서는 문자 수, 요소에서는 자식 노드 수다. */
function selectionLength(node: Node): number {
  return node.nodeType === node.TEXT_NODE ? (node as Text).length : node.childNodes.length;
}

/** 루트 안의 현재 포커스와 선택을 보관한다. 커밋이나 롤백 뒤 같은 요소가 남으면 복원한다. */
export function captureFocus(container: Element): (() => void) | null {
  const doc = container.ownerDocument;
  if (!doc.defaultView) return null;
  const active = focusedElement(container);
  if (!(active instanceof doc.defaultView.HTMLElement) || !containsFocus(container, active)) return null;
  const restoreSelection = captureSelection(active);

  // 이벤트 처리 중 다른 컨트롤에 포커스가 갔다면 그 선택을 유지한다.
  return () => {
    if (!active.isConnected || !containsFocus(container, active)) return;
    const current = focusedElement(container);
    if (current !== active) {
      if (current && current !== doc.body && current !== doc.documentElement) return;
      active.focus({ preventScroll: true });
      if (focusedElement(container) !== active) return;
    }
    restoreSelection?.();
  };
}
