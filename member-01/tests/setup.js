// 모든 테스트 전에 자동으로 로드된다 (npm test의 --import).
// 브라우저 전역(document, window, Node …)을 jsdom으로 만든다.
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');

globalThis.window = window;
for (const name of ['document', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'DocumentFragment', 'MutationObserver']) {
  globalThis[name] = window[name];
}
