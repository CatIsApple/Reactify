import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bindEditor } from '../dist/app/editor.js';

/** 두 영역, HTML 편집기, 이력 버튼만 있는 페이지를 연결한다. */
function setupEditor(markup: string) {
  const { window } = new JSDOM('<section id="actual"></section><section id="preview"></section><textarea id="html-editor"></textarea><button id="patch"></button><button id="undo"></button><button id="redo"></button><output id="history-position"></output>');
  const document = window.document;
  const actual = document.getElementById('actual')!;
  const preview = document.getElementById('preview')!;
  const editor = document.querySelector('textarea')!;
  const patchButton = document.querySelector<HTMLButtonElement>('#patch')!;
  const undoButton = document.querySelector<HTMLButtonElement>('#undo')!;
  const redoButton = document.querySelector<HTMLButtonElement>('#redo')!;
  actual.innerHTML = markup;
  bindEditor(document);
  /** 사용자가 HTML 코드를 입력할 때와 같은 이벤트를 발생시킨다. */
  function edit(html: string) {
    editor.value = html;
    editor.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  return { actual, preview, editor, patchButton, undoButton, redoButton, edit };
}

test('초기 복제 → 편집 → Patch → 뒤로·앞으로가기에서 두 영역을 복원하고 새 분기를 만든다', () => {
  const initial = '<h2>제목</h2><p>초기</p>';
  const changed = '<h2>제목</h2><p>수정</p><p>추가</p>';
  const page = setupEditor(initial);
  const originalHeading = page.actual.firstChild;
  assert.equal(page.preview.innerHTML, initial);
  assert.ok(page.undoButton.disabled && page.redoButton.disabled);
  page.edit(changed);
  assert.equal(page.preview.innerHTML, changed);
  assert.equal(page.actual.innerHTML, initial);
  page.patchButton.click();
  assert.equal(page.actual.innerHTML, changed);
  assert.equal(page.actual.firstChild, originalHeading);
  page.patchButton.click();
  page.undoButton.click();
  assert.equal(page.actual.innerHTML, initial);
  assert.equal(page.preview.innerHTML, initial);
  assert.equal(page.editor.value, initial);
  assert.ok(page.undoButton.disabled);
  page.redoButton.click();
  assert.equal(page.actual.innerHTML, changed);
  assert.equal(page.preview.innerHTML, changed);
  page.undoButton.click();
  page.edit('');
  page.patchButton.click();
  assert.equal(page.actual.childNodes.length, 0);
  assert.equal(page.preview.childNodes.length, 0);
  assert.ok(page.redoButton.disabled);
  page.undoButton.click();
  assert.equal(page.actual.innerHTML, initial);
  page.redoButton.click();
  assert.equal(page.actual.childNodes.length, 0);
});

test('테스트 영역에서 직접 바꾼 텍스트와 폼 입력값도 Patch와 이력에 포함한다', () => {
  const page = setupEditor('<p>전</p><input value="첫 값">');
  const input = page.actual.querySelector('input')!;
  page.preview.querySelector('p')!.textContent = '후';
  page.preview.querySelector('input')!.value = '두 번째 값';
  page.patchButton.click();
  assert.equal(page.actual.querySelector('p')!.textContent, '후');
  assert.equal(page.actual.querySelector('input'), input);
  assert.equal(input.value, '두 번째 값');
  page.undoButton.click();
  assert.equal(input.value, '첫 값');
  page.redoButton.click();
  assert.equal(page.preview.querySelector('input')!.value, '두 번째 값');
});

test('두 영역에서 같은 name의 라디오와 같은 id의 라벨을 사용해도 Patch 전에 실제 값이 바뀌지 않는다', () => {
  const { window } = new JSDOM('<div class="sample-scope"><div id="actual"></div></div><div class="sample-scope"><div id="preview"></div></div><textarea id="html-editor"></textarea><button id="patch"></button><button id="undo"></button><button id="redo"></button><output id="history-position"></output>');
  const doc = window.document;
  const actual = doc.getElementById('actual')!;
  const preview = doc.getElementById('preview')!;
  actual.innerHTML = '<input type="radio" name="choice" checked><input id="b" type="radio" name="choice"><label for="b">B</label>';
  bindEditor(doc);
  preview.querySelector('label')!.click();
  assert.equal(preview.querySelector<HTMLInputElement>('#b')!.checked, true);
  assert.equal(actual.querySelector<HTMLInputElement>('input')!.checked, true);
  doc.getElementById('patch')!.click();
  assert.equal(actual.querySelector<HTMLInputElement>('#b')!.checked, true);
  doc.getElementById('undo')!.click();
  assert.equal(actual.querySelector<HTMLInputElement>('input')!.checked, true);
  assert.equal(preview.querySelector<HTMLInputElement>('input')!.checked, true);
});
