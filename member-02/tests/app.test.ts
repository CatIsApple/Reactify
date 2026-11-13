import { query } from './helpers.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { setupLab } from '../src/lab/lab.ts';
import { setupBoard } from '../src/demo/board.ts';

async function setup() {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const window = new JSDOM(html, { url: 'http://localhost/' }).window;
  Object.assign(globalThis, {
    window,
    document: window.document,
    MutationObserver: window.MutationObserver,
    localStorage: window.localStorage,
  });
  return {
    window,
    document: window.document,
    event: (name: string) => new window.Event(name, { bubbles: true, cancelable: true }),
  };
}
test('Phase 1: HTML edit, Patch, undo/redo, branching, no-op, duplicate key failure', async () => {
  const { document, event, window } = await setup();
  const lab = setupLab();
  const source = query<HTMLTextAreaElement>(document, '#source'),
    actual = query(document, '#actual');
  const original = query(actual, 'h2');
  source.value = source.value.replace('조금씩, 더 나은 코드.', '테스트 제목');
  source.dispatchEvent(event('input'));
  query(document, '#patch').click();
  assert.equal(query(actual, 'h2').textContent, '테스트 제목');
  assert.equal(query(actual, 'h2'), original);
  assert.equal(lab.history.entries.length, 2);
  query(document, '#undo').click();
  assert.equal(query(actual, 'h2').textContent, '조금씩, 더 나은 코드.');
  query(document, '#redo').click();
  assert.equal(query(actual, 'h2').textContent, '테스트 제목');
  query(document, '#patch').click();
  assert.equal(lab.history.entries.length, 2);
  query(document, '#undo').click();
  source.value = '<p>새 분기</p>';
  source.dispatchEvent(event('input'));
  query(document, '#patch').click();
  assert.equal(lab.history.canRedo, false);
  assert.equal(actual.textContent, '새 분기');
  source.value = '<ul><li data-key="a">a</li><li data-key="a">b</li></ul>';
  source.dispatchEvent(event('input'));
  query(document, '#patch').click();
  assert.match(query(document, '#lab-message').textContent, /중복 key/);
  assert.equal(actual.textContent, '새 분기');
  window.close();
});
test('Phase 1: direct DOM mutation is detected and form values travel through history', async () => {
  const { document, event, window } = await setup();
  const lab = setupLab();
  const source = query<HTMLTextAreaElement>(document, '#source');
  source.value = '<input value="old"><input type="checkbox">';
  source.dispatchEvent(event('input'));
  query(document, '#patch').click();
  query(document, '#preview-mode').click();
  const input = query<HTMLInputElement>(document, '#test input');
  input.value = 'live';
  input.dispatchEvent(event('input'));
  query<HTMLInputElement>(document, '#test [type=checkbox]').checked = true;
  query(document, '#patch').click();
  assert.equal(query<HTMLInputElement>(document, '#actual input').value, 'live');
  assert.equal(query<HTMLInputElement>(document, '#actual [type=checkbox]').checked, true);
  query(document, '#undo').click();
  assert.equal(query<HTMLInputElement>(document, '#actual input').value, 'old');
  query(document, '#redo').click();
  assert.equal(query<HTMLInputElement>(document, '#test input').value, 'live');
  query(document, '#test').firstElementChild!.append(document.createElement('hr'));
  await Promise.resolve();
  assert.equal(lab.dirty, true);
  window.close();
});
test('Phase 2: board add, search, toggle, reverse, delete, batching and persistence', async () => {
  const { document, event, window } = await setup();
  const board = setupBoard();
  board.flushSync();
  const root = query(document, '#hooks-app'),
    input = query<HTMLInputElement>(document, '#new-task');
  input.value = 'Write tests';
  input.dispatchEvent(event('input'));
  board.flushSync();
  assert.equal(query<HTMLInputElement>(document, '#new-task'), input); // Focus-bearing DOM identity remains stable.
  query(root, 'form').dispatchEvent(event('submit'));
  board.flushSync();
  assert.equal(root.querySelectorAll('.task-row').length, 5);
  const search = query<HTMLInputElement>(root, '[type=search]');
  search.value = 'Write';
  search.dispatchEvent(event('input'));
  board.flushSync();
  assert.equal(root.querySelectorAll('.task-row').length, 1);
  query(root, '.task-checkbox').click();
  board.flushSync();
  assert.ok(query(root, '.task-row').classList.contains('task-done'));
  search.value = '';
  search.dispatchEvent(event('input'));
  board.flushSync();
  const last = query(root, '.task-list').lastChild;
  query(root, '.board-bottom button').click();
  board.flushSync();
  assert.equal(query(root, '.task-list').firstChild, last);
  const before = board.commitCount;
  query(root, '.dark-button').click();
  board.flushSync();
  assert.equal(query(root, '#batch-value').textContent, '3');
  assert.equal(board.commitCount, before + 1);
  query(root, '.delete-task').click();
  board.flushSync();
  assert.equal(root.querySelectorAll('.task-row').length, 4);
  assert.equal(JSON.parse(window.localStorage.getItem('fiber-lab-tasks-v1') ?? 'null').length, 4);
  board.unmount();
  window.close();
});
