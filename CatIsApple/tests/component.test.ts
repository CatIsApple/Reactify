import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createElement } from '../dist/element/index.js';
import { FunctionComponent, useEffect, useMemo, useState } from '../dist/component/index.js';

test('루트의 상태를 두 자식에 전달하고 클릭과 연속 입력 후에도 같은 DOM과 포커스를 유지한다', () => {
  const { window } = new JSDOM('<main></main>');
  const container = window.document.querySelector('main')!;
  let initializations = 0;
  /** 공유 상태와 갱신 콜백을 전달받는 입력 컴포넌트. */
  function Controls(props: { title: string; rename: (title: string) => void; increment: () => void }) {
    return [
      createElement('input', {
        value: props.title,
        onInput: (event: Event) => props.rename((event.target as HTMLInputElement).value),
      }),
      createElement('button', { onClick: props.increment }, '증가'),
    ];
  }
  /** 같은 루트 상태를 읽어 요약을 그린다. */
  function Summary(props: { title: string; count: number }) {
    return createElement('output', null, props.title, ' ', props.count);
  }
  const root = new FunctionComponent(container, () => {
    const [title, rename] = useState('책');
    const [count, setCount] = useState(() => {
      initializations++;
      return 0;
    });
    return [
      createElement(Controls, { title, rename, increment: () => {
        setCount(value => value + 1);
        setCount(value => value + 1);
      } }),
      createElement(Summary, { title, count }),
    ];
  });
  root.mount();
  const input = container.querySelector('input')!;
  const output = container.querySelector('output')!;
  input.focus();
  for (const value of ['새', '새 제목']) {
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(output.textContent, value + ' 0');
  }
  container.querySelector('button')!.click();
  assert.equal(output.textContent, '새 제목 2');
  assert.equal(container.querySelector('output'), output);
  assert.equal(window.document.activeElement, input);
  assert.equal(initializations, 1);
});

test('useMemo는 같은 의존성에서 결과를 재사용하고 useEffect는 커밋 후 실행·정리한다', () => {
  const container = new JSDOM('<main></main>').window.document.querySelector('main')!;
  let changeName!: (value: string) => void;
  let changeCount!: (value: number) => void;
  let calculations = 0;
  const log: string[] = [];
  const root = new FunctionComponent(container, () => {
    const [name, setName] = useState('A');
    const [count, setCount] = useState(2);
    changeName = setName;
    changeCount = setCount;
    const square = useMemo(() => {
      calculations++;
      return count * count;
    }, [count]);
    useEffect(() => {
      log.push('설정 ' + count + ' ' + container.textContent);
      return () => { log.push('정리 ' + count); };
    }, [count]);
    return createElement('p', null, name + square);
  });
  root.mount();
  changeName('B');
  root.update();
  assert.equal(container.textContent, 'B4');
  assert.equal(calculations, 1);
  assert.deepEqual(log, ['설정 2 A4']);
  changeCount(3);
  assert.equal(calculations, 2);
  assert.deepEqual(log, ['설정 2 A4', '정리 2', '설정 3 B9']);
  root.unmount();
  assert.deepEqual(log, ['설정 2 A4', '정리 2', '설정 3 B9', '정리 3']);
  assert.equal(container.childNodes.length, 0);
});

test('빈 의존성 effect에서 시작한 상태 변경이 다음 커밋까지 반영된다', () => {
  const container = new JSDOM('<main></main>').window.document.querySelector('main')!;
  let setups = 0;
  const root = new FunctionComponent(container, () => {
    const [value, setValue] = useState(0);
    useEffect(() => {
      setups++;
      setValue(previous => previous + 1);
    }, []);
    return String(value);
  });
  root.mount();
  assert.equal(container.textContent, '1');
  assert.equal(setups, 1);
});

test('렌더 밖·자식에서 Hook을 호출하거나 렌더마다 호출 개수를 바꾸면 오류를 낸다', () => {
  assert.throws(() => useState(0));
  const container = new JSDOM('<main></main>').window.document.querySelector('main')!;
  /** 루트 소유 규칙을 검증하기 위해 자식에서 Hook을 호출한다. */
  function InvalidChild() {
    useMemo(() => 1, []);
    return '자식';
  }
  const invalid = new FunctionComponent(container, () => createElement(InvalidChild));
  assert.throws(() => invalid.mount());
  let conditional = true;
  const root = new FunctionComponent(container, () => {
    useState(0);
    if (conditional) useState(true);
    return '루트';
  });
  root.mount();
  conditional = false;
  assert.throws(() => root.update());
});
