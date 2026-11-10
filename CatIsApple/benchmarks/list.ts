import { createElement as h, createRoot, runWithPriority, useState } from '../dist/index.js';
import type { Dispatch, SetStateAction } from '../dist/index.js';

// 빌드: npm run build && npx --no-install tsc --ignoreConfig benchmarks/list.ts --target ES2022 --module NodeNext --strict --outDir build
// 저장소를 HTTP로 제공하고 /benchmarks/를 연 뒤 DevTools에서 await window.benchmark로 결과를 확인한다.
const sizes = [100, 500, 1000, 2000, 4000];
const warmups = 5;
const samples = 21;
let setLast: Dispatch<SetStateAction<number>>;
/** 각 행의 상태를 만들고 마지막 행의 setter를 갱신 측정에 제공한다. */
function Row({ index, last }: { index: number; last: boolean }) {
  const [value, setValue] = useState(0);
  if (last) setLast = setValue;
  return h('li', { 'data-row': index }, h('span', null, `Row ${index}: `), h('strong', null, value));
}
/** key가 있는 상태 소유 행을 지정한 개수만큼 만든다. */
function List({ size }: { size: number }) {
  return h('ul', null, Array.from({ length: size }, (_, index) =>
    h(Row, { key: index, index, last: index === size - 1 }),
  ));
}
/** 원본 표본과 선형 보간으로 계산한 중앙값·사분위수를 반환한다. */
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  // 인접한 정렬 표본 사이를 보간해 요청한 분위수를 구한다.
  const quantile = (p: number) => {
    const i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
  };
  return { median: quantile(.5), q1: quantile(.25), q3: quantile(.75), samples: values };
}
/** 동기 우선순위 요청부터 스케줄러의 커밋 이후까지 경과 시간을 잰다. */
async function measure(request: () => void): Promise<number> {
  const start = performance.now();
  runWithPriority('sync', request);
  // 앞서 큐에 등록한 스케줄러 마이크로태스크가 동기 작업을 비운다.
  await Promise.resolve();
  return performance.now() - start;
}
/** 크기별 준비 실행과 표본 수집을 수행하고 타이머 밖에서 DOM 결과를 검증한다. */
async function benchmark() {
  const results = [];
  for (const size of sizes) {
    const mount: number[] = [];
    const update: number[] = [];
    for (let iteration = -warmups; iteration < samples; iteration++) {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const mountMs = await measure(() => root.render(h(List, { size })));
      if (container.querySelectorAll('li').length !== size) {
        throw Error('Mount validation failed');
      }
      const last = container.querySelector('li:last-child strong')!;
      const updateMs = await measure(() => setLast(1));
      if (last.textContent !== '1' || container.querySelector('li:last-child strong') !== last) {
        throw Error('Update validation failed');
      }
      if (iteration >= 0) {
        mount.push(mountMs);
        update.push(updateMs);
      }
      await measure(() => root.render(null));
      container.remove();
      // 타이머 밖에서 표본 사이에 브라우저의 대기 작업을 처리할 기회를 준다.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    results.push({ rows: size, mount: stats(mount), update: stats(update) });
  }
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    warmups,
    samples,
    unit: 'ms',
    scenario: 'keyed list; each row has useState, span and strong; update last row',
    timing: 'sync request through scheduler microtask and DOM commit; excludes paint/layout and validation',
    results,
  };
}
declare global {
  /** DevTools에서 실행 중인 벤치마크의 결과와 실패를 기다리는 창 속성이다. */
  interface Window {
    benchmark: ReturnType<typeof benchmark>;
  }
}

window.benchmark = benchmark();
const output = document.querySelector('pre')!;
window.benchmark.then(
  result => { output.textContent = JSON.stringify(result, null, 2); },
  error => {
    output.textContent = `벤치마크 실패: ${error instanceof Error ? error.message : String(error)}`;
    console.error(error);
  },
);
