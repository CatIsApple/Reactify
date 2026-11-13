import { domToVNode, createDOM, diff, patch } from '../core/index.ts';
import { StateHistory } from './history.ts';
import { sanitizeHTML } from './sanitize.ts';
import { mustQuery, inputValue, errorMessage } from '../shared/dom.ts';
import type { PatchOperation, VNode } from '../core/index.ts';

const base = `<article class="demo-card">
  <span class="demo-eyebrow">TODAY'S SMALL WINS</span>
  <h2>조금씩, 더 나은 코드.</h2>
  <p>작은 변화를 모아 단단한 UI를 만듭니다.</p>
  <ul class="demo-list">
    <li data-key="vdom"><span>01</span> Virtual DOM 만들기 <b>완료</b></li>
    <li data-key="diff"><span>02</span> Diff 알고리즘 구현 <b>진행 중</b></li>
    <li data-key="patch"><span>03</span> 필요한 부분만 Patch <b>예정</b></li>
  </ul>
  <div class="demo-card-foot"><span>한 번에 하나의 노드씩</span><span>↗</span></div>
</article>`;

export function setupLab() {
  const $ = mustQuery;
  const actual = $('#actual'),
    test = $('#test'),
    source = $<HTMLTextAreaElement>('#source');
  const wrap = document.createElement('div');
  wrap.className = 'sample-document';
  wrap.append(sanitizeHTML(base).fragment);
  actual.append(wrap);
  let current = domToVNode(wrap);
  const history = new StateHistory(current);
  test.append(createDOM(current));
  source.value = base;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sourcePending = false;
  const message = (text: string, error = false): void => {
    $('#lab-message').textContent = text;
    $('#lab-message').classList.toggle('error', error);
  };
  const setDirty = (value: boolean): void => {
    dirty = value;
    $('#dirty-status').textContent = value ? '미적용 변경 있음' : '동기화됨';
    $('#dirty-status').classList.toggle('dirty', value);
  };
  const observer = new MutationObserver(() => {
    setDirty(true);
    source.value = test.firstElementChild?.innerHTML ?? '';
  });
  const observe = () =>
    observer.observe(test, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  observe();
  const replaceTest = (tree: VNode): void => {
    observer.disconnect();
    test.replaceChildren(createDOM(tree));
    observe();
  };
  const syncSource = () => {
    clearTimeout(timer);
    if (!sourcePending) return;
    const { fragment, removed } = sanitizeHTML(source.value);
    const root = document.createElement('div');
    root.className = 'sample-document';
    root.append(fragment);
    observer.disconnect();
    test.replaceChildren(root);
    observe();
    sourcePending = false;
    if (removed)
      message(
        `실행 가능한 코드나 지원하지 않는 항목 ${removed}개를 제외했습니다. 안전하게 정리된 DOM이 적용됩니다.`,
      );
  };
  source.addEventListener('input', () => {
    sourcePending = true;
    setDirty(true);
    clearTimeout(timer);
    timer = setTimeout(syncSource, 180);
  });
  test.addEventListener('input', () => {
    source.value = test.firstElementChild?.innerHTML ?? '';
    setDirty(true);
  });
  // Links and forms are content under test, not navigation or submission targets.
  for (const region of [actual, test]) {
    region.addEventListener('click', (event) => {
      if ((event.target as Element | null)?.closest('a')) event.preventDefault();
    });
    region.addEventListener('submit', (event) => event.preventDefault());
  }
  test.addEventListener('paste', (event) => {
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection?.rangeCount || !event.clipboardData) return;
    const range = selection.getRangeAt(0);
    if (!test.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(event.clipboardData.getData('text/plain'));
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  });
  function renderHistory() {
    $<HTMLButtonElement>('#undo').disabled = !history.canUndo;
    $<HTMLButtonElement>('#redo').disabled = !history.canRedo;
    $('#history-position').textContent =
      `${String(history.index + 1).padStart(2, '0')} / ${String(history.entries.length).padStart(2, '0')}`;
    $('#metric-history').replaceChildren(String(history.entries.length), small('snapshot'));
    $('#history-list').replaceChildren(
      ...history.entries.map((entry, index) => {
        const button = document.createElement('button');
        button.className = `history-entry ${index === history.index ? 'current' : ''}`;
        button.setAttribute('aria-current', index === history.index ? 'step' : 'false');
        const number = document.createElement('span');
        number.className = 'history-number';
        number.textContent = String(index + 1).padStart(2, '0');
        const title = document.createElement('span');
        title.textContent = entry.label;
        const badge = document.createElement('small');
        badge.textContent = index === history.index ? 'CURRENT' : '↗';
        button.append(number, title, badge);
        button.addEventListener('click', () => navigate(index));
        return button;
      }),
    );
    $('#tree-view').textContent = JSON.stringify(current, null, 2);
  }
  function renderLog(operations: PatchOperation[]): void {
    $('#log-count').textContent = `${operations.length} changes`;
    const nodes: HTMLElement[] = operations.map((operation) => {
      const row = document.createElement('div');
      row.className = 'log-row';
      const badge = document.createElement('b');
      badge.className = `op op-${operation.type.toLowerCase()}`;
      badge.textContent = operation.type;
      const path = document.createElement('code');
      path.textContent = operation.path;
      const detail = document.createElement('span');
      detail.textContent = operation.detail;
      row.append(badge, path, detail);
      return row;
    });
    if (!nodes.length) {
      const empty = document.createElement('p');
      empty.className = 'log-noop';
      empty.textContent = '변경 없음 — DOM을 그대로 유지했습니다.';
      nodes.push(empty);
    }
    $('#change-log').replaceChildren(...nodes);
  }
  function apply(next: VNode): PatchOperation[] {
    const before = [...actual.querySelectorAll('*')];
    const start = performance.now();
    const plan = diff(current, next);
    const operations: PatchOperation[] = [];
    patch(actual.firstChild, plan, actual, operations);
    const elapsed = performance.now() - start;
    current = next;
    $('#metric-changes').replaceChildren(String(operations.length), small('operations'));
    $('#metric-time').replaceChildren(elapsed.toFixed(2), small('ms'));
    $('#metric-preserved').replaceChildren(
      String(before.filter((node) => actual.contains(node)).length),
      small('nodes'),
    );
    $('#actual-note').textContent = operations.length
      ? `${operations.length}개 변경을 실제 DOM에 반영했습니다.`
      : '동일한 트리입니다. DOM을 유지했습니다.';
    renderLog(operations);
    return operations;
  }
  function applyPatch() {
    try {
      syncSource();
      // The stable wrapper is restored if a contenteditable select-all removed it.
      if (
        !test.firstChild ||
        test.childNodes.length !== 1 ||
        test.firstChild.nodeType !== 1 ||
        !(test.firstChild as Element).classList.contains('sample-document')
      ) {
        source.value = test.innerHTML;
        sourcePending = true;
        syncSource();
      }
      const next = domToVNode(test.firstChild!);
      const changes = apply(next);
      history.push(next, changes.length ? `Patch · ${changes.length}개 변경` : '동일 상태');
      setDirty(false);
      renderHistory();
      message(
        changes.length
          ? `Patch 완료. ${changes.length}개의 변경을 반영하고 상태를 저장했습니다.`
          : '변경 사항이 없어 새 이력을 만들지 않았습니다.',
      );
    } catch (error) {
      message(errorMessage(error), true);
    }
  }
  function navigate(index: number): void {
    clearTimeout(timer);
    sourcePending = false;
    const next = history.go(index);
    apply(next);
    replaceTest(next);
    source.value = test.firstElementChild!.innerHTML;
    setDirty(false);
    renderHistory();
    message(`${index + 1}번 상태로 이동했습니다. 실제 영역과 테스트 영역을 함께 복원했습니다.`);
  }
  $('#patch').addEventListener('click', applyPatch);
  $('#undo').addEventListener('click', () => navigate(history.index - 1));
  $('#redo').addEventListener('click', () => navigate(history.index + 1));
  document.addEventListener('keydown', (event) => {
    if (!$('#page-lab').hidden && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      applyPatch();
    }
  });
  $('#code-mode').addEventListener('click', () => mode(false));
  $('#preview-mode').addEventListener('click', () => mode(true));
  function mode(preview: boolean): void {
    syncSource();
    $('#source-wrap').hidden = preview;
    test.hidden = !preview;
    $('#code-mode').classList.toggle('selected', !preview);
    $('#preview-mode').classList.toggle('selected', preview);
    $('#code-mode').setAttribute('aria-pressed', String(!preview));
    $('#preview-mode').setAttribute('aria-pressed', String(preview));
  }
  $('#log-tab').addEventListener('click', () => inspector(false));
  $('#tree-tab').addEventListener('click', () => inspector(true));
  function inspector(tree: boolean): void {
    $('#change-log').hidden = tree;
    $('#tree-view').hidden = !tree;
    $('#log-tab').classList.toggle('active', !tree);
    $('#tree-tab').classList.toggle('active', tree);
    $('#log-tab').setAttribute('aria-pressed', String(!tree));
    $('#tree-tab').setAttribute('aria-pressed', String(tree));
  }
  $<HTMLSelectElement>('#preset').addEventListener('change', (event) => {
    let html = base;
    switch (inputValue(event)) {
      case 'text':
        html = base.replace('조금씩, 더 나은 코드.', '오늘도, 한 단계 성장.');
        break;
      case 'props':
        html = base.replace(
          'class="demo-card"',
          'class="demo-card mint" title="속성만 바뀌었습니다"',
        );
        break;
      case 'insert':
        html = base.replace(
          '  </ul>',
          '    <li data-key="fiber"><span>04</span> Fiber 엔진 연결 <b>NEW</b></li>\n  </ul>',
        );
        break;
      case 'remove':
        html = base.replace(/    <li data-key="diff">.*<\/li>\n/, '');
        break;
      case 'replace':
        html = base.replace('<h2>', '<h3>').replace('</h2>', '</h3>');
        break;
      case 'reorder': {
        const lines = base.split('\n');
        const a = lines.findIndex((line) => line.includes('data-key="vdom"'));
        const b = a + 2;
        [lines[a], lines[b]] = [lines[b], lines[a]];
        html = lines.join('\n');
        break;
      }
      case 'forms':
        html = `<article class="demo-card"><h2>여러 종류의 DOM</h2>\n<!-- 주석도 VNode로 보존됩니다 -->\n<label>이름 <input value="Fiber" placeholder="이름을 입력하세요"></label>\n<label><input type="checkbox" checked> 선택 상태 보존</label>\n<select><option>JavaScript</option><option>TypeScript</option></select>\n<textarea>여러 줄 텍스트</textarea>\n<svg width="80" height="40" viewBox="0 0 80 40"><circle cx="20" cy="20" r="14" fill="#9fcf65"/><rect x="45" y="6" width="28" height="28" rx="5" fill="#b6a1e7"/></svg>\n<p>공백, 주석, 폼 값, SVG를 함께 테스트합니다.</p></article>`;
        break;
    }
    source.value = html;
    sourcePending = true;
    syncSource();
    setDirty(true);
    message('예제를 불러왔습니다. Patch를 누르면 실제 영역에 반영됩니다.');
  });
  $('#metric-preserved').replaceChildren(
    String(actual.querySelectorAll('*').length),
    small('nodes'),
  );
  renderHistory();
  return {
    history,
    applyPatch,
    get tree() {
      return current;
    },
    get dirty() {
      return dirty;
    },
  };
}

function small(value: string): HTMLElement {
  const node = document.createElement('small');
  node.textContent = value;
  return node;
}
