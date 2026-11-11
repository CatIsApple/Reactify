import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createElement } from '../dist/element/index.js';
import { diff, patch, readChildren, resolveChildren } from '../dist/vdom/index.js';

test('실제 DOM에서 읽은 스냅샷은 공백, 형제, 중첩 속성을 보존하며 원본 편집과 독립적이다', () => {
  const { document } = new JSDOM().window;
  const source = document.createElement('div');
  const copy = document.createElement('div');
  const markup = ' 앞 <h2 lang="ko">제목 <em>강조</em></h2> 뒤 <p>본문</p>';
  source.innerHTML = markup;
  const snapshot = readChildren(source);
  source.querySelector('em')!.textContent = '바뀜';
  source.querySelector('p')!.remove();
  patch(copy, diff([], snapshot));
  assert.equal(copy.innerHTML, markup);
  assert.deepEqual(diff(snapshot, readChildren(copy)), []);
});

test('텍스트·속성 변경, 노드 추가·삭제·교체 후 기존 형제와 텍스트 노드를 유지한다', () => {
  const { document } = new JSDOM().window;
  const current = document.createElement('main');
  const next = document.createElement('main');
  current.innerHTML = '<header>고정</header><p title="old" hidden>이전</p><i>교체</i><ul><li>A</li><li>B</li><li>C</li></ul>';
  next.innerHTML = '<header>고정</header><p title="new">이후</p><b>교체됨</b><ul><li>A</li></ul><footer>추가</footer>';
  const header = current.querySelector('header');
  const paragraph = current.querySelector('p')!;
  const text = paragraph.firstChild;
  const firstItem = current.querySelector('li');
  const previous = readChildren(current);
  const target = readChildren(next);
  patch(current, diff(previous, target));
  assert.equal(current.innerHTML, next.innerHTML);
  assert.equal(current.querySelector('header'), header);
  assert.equal(current.querySelector('p'), paragraph);
  assert.equal(paragraph.firstChild, text);
  assert.equal(current.querySelector('li'), firstItem);
  patch(current, diff(target, []));
  assert.equal(current.childNodes.length, 0);
});

test('폼 스냅샷은 현재 입력값, 체크 여부, textarea와 다중 선택 상태를 복원한다', () => {
  const { document } = new JSDOM().window;
  const source = document.createElement('div');
  source.innerHTML = '<input value="초기"><input type="checkbox"><textarea>초기</textarea><select multiple><option>A</option><option>B</option><option>C</option></select>';
  source.querySelector('input')!.value = '입력';
  source.querySelector<HTMLInputElement>('[type=checkbox]')!.checked = true;
  source.querySelector('textarea')!.value = '새 내용';
  const options = source.querySelector('select')!.options;
  options[0].selected = options[2].selected = true;
  const copy = document.createElement('div');
  patch(copy, diff([], readChildren(source)));
  assert.equal(copy.querySelector('input')!.value, '입력');
  assert.equal(copy.querySelector<HTMLInputElement>('[type=checkbox]')!.checked, true);
  assert.equal(copy.querySelector('textarea')!.value, '새 내용');
  assert.deepEqual(Array.from(copy.querySelector('select')!.selectedOptions, option => option.text), ['A', 'C']);
});

test('이벤트 갱신과 제거는 같은 버튼에 적용되고 이전 핸들러는 다시 실행되지 않는다', () => {
  const { document } = new JSDOM().window;
  const container = document.createElement('div');
  const calls: string[] = [];
  const first = resolveChildren(createElement('button', { onClick: () => calls.push('A') }, '실행'));
  const second = resolveChildren(createElement('button', { onClick: () => calls.push('B') }, '실행'));
  const removed = resolveChildren(createElement('button', null, '실행'));
  patch(container, diff([], first));
  const button = container.querySelector('button')!;
  button.click();
  patch(container, diff(first, second));
  button.click();
  patch(container, diff(second, removed));
  button.click();
  assert.equal(container.querySelector('button'), button);
  assert.deepEqual(calls, ['A', 'B']);
});
