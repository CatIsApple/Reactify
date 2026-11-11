![Reactify 로고](../assets/reactify-banner.png)

# Reactify
TypeScript로 Element → Fiber → DOM 렌더링부터 Lanes 스케줄링·Bailout·Hooks까지 직접 구현한 UI 프레임워크입니다.

TypeScript · Fiber · Lanes · Zero dependencies

> 과제 구조로 구현한 v1은 `feat/CatIsApple/v1` 브랜치에 있습니다.

## Quick Start

Node.js 22 이상에서 `CatIsApple/` 디렉터리의 명령을 실행합니다.

```sh
npm ci
npm run build
```

```js
import { createElement, createRoot } from './dist/index.js';

const root = createRoot(document.getElementById('app'));
root.render(createElement('h1', { className: 'title' }, 'Reactify'));
```

## New Changes

v1은 상태와 Hook을 루트 컴포넌트에만 둡니다. 어느 값이 바뀌든 루트부터 다시 실행하고 Virtual DOM 전체를 비교합니다. Reactify는 화면을 **Element → Fiber → DOM** 세 층으로 나누고 상태를 각 컴포넌트의 Fiber에 둡니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/pipeline-dark.png">
  <img src="assets/pipeline-light.png" alt="createElement가 만든 Element를 render 단계의 Fiber가 비교하고, flags로 표시한 변경을 commit 단계에서 DOM에 반영하는 흐름">
</picture>

| Change | Enables | Evidence |
| --- | --- | --- |
| [Element → Fiber → DOM](#element--fiber--dom) | 비교가 끝난 변경만 DOM에 씁니다. | 같은 값으로 4,000행을 다시 렌더하면 DOM 변경 0건 |
| [Fiber Architecture](#fiber-architecture) | 렌더를 멈추고, 버리고, 다시 시작합니다. | 렌더 도중 들어온 갱신이 먼저 커밋 |
| [Lanes Scheduling](#lanes-scheduling) | 우선순위를 두고 긴 렌더는 양보합니다. | 10,000행 마운트 중 최장 차단 35.0 → 7.8 ms |
| [Bailout](#bailout) | 변경이 없는 컴포넌트는 호출하지 않습니다. | 한 행 변경 시 컴포넌트 호출 4,000 → 1회 |

### Element → Fiber → DOM

| Layer | Responsibility |
| --- | --- |
| Element | 이번 렌더의 화면 설명 `{ type, key, props }`. 만들고 나면 바꾸지 않습니다. |
| Fiber | 위치별 상태, 지난 props, DOM 참조, 남은 업데이트, 커밋할 변경을 보관합니다. |
| DOM | 커밋 단계에서만 바뀝니다. 표시된 변경만 반영합니다. |

![화면 요청과 상태 요청이 각자의 큐를 거쳐 루트 스케줄러에 모이고, Fiber 렌더와 DOM 커밋으로 이어지는 흐름](assets/fiber-render-flow.png)

- **Child matching** — `key`가 있으면 key로, 없으면 배열의 위치로 이전 Fiber를 찾습니다. 타입까지 같으면 상태와 DOM을 재사용합니다.
- **Host attributes** — 렌더는 props 객체가 바뀐 요소에 `Update`만 표시하고, 커밋이 이전 props와 새 props를 비교해 바뀐 값만 씁니다.
- **Direct text** — 자식이 문자열이나 숫자 하나뿐이면 텍스트용 Fiber 없이 그 요소가 텍스트를 직접 갱신합니다.

### Fiber Architecture

- **Linked list** — `child` · `sibling` · `return`으로 이어진 Fiber를 반복문으로 순회합니다. Fiber 하나 단위로 멈췄다가 이어갈 수 있습니다.
- **Double buffering** — 화면과 일치하는 `current`는 그대로 두고 짝(`alternate`)인 작업 트리에서만 계산합니다. 렌더를 버려도 화면은 그대로입니다.
- **Flags** — 렌더는 `Placement` · `Update` · `ChildDeletion` 플래그만 남기고, 커밋은 플래그가 없는 가지에 들어가지 않습니다.
- **Atomic commit** — 쓰기 직전의 DOM 값과 노드 위치를 기록해, 커밋 중 오류가 나면 역순으로 복구합니다.

[Fiber types](src/fiber/types.ts) · [Work loop](src/fiber/workLoop.ts) · [DOM commit](src/dom/commitWork.ts)

### Lanes Scheduling

갱신마다 우선순위 비트(lane)를 붙이고, `lanes & -lanes`로 가장 급한 lane을 고릅니다.

| Source | Lane | Rendering |
| --- | --- | --- |
| `click`, `keydown`, `input` 등 | `SyncLane` | 마이크로태스크에서 바로 끝까지 |
| `scroll`, `pointermove` 등 | `InputContinuousLane` | 시작하면 끝까지 |
| 그 밖의 코드 | `DefaultLane` | 시작하면 끝까지 |
| `startTransition(scope)` | `TransitionLanes` | 5 ms마다 양보, 급한 요청이 오면 중단 후 다시 시작 |
| `runWithPriority('idle', scope)` | `IdleLane` | 5 ms마다 양보 |

10,000행 마운트 중 메인 스레드가 가장 오래 막힌 시간은 Sync 35.0 ms에서 Transition **7.8 ms**로 줄었습니다. 그 도중에 넣은 Sync 갱신은 0.2 ms 만에 먼저 커밋됐습니다.

[Lanes](src/fiber/lanes.ts) · [Root scheduler](src/fiber/rootScheduler.ts) · [Host scheduler](src/scheduler/scheduler.ts)

### Bailout

`setState`는 해당 Fiber에 lane을 표시하고 조상들의 `childLanes`에 같은 비트를 기록합니다. 렌더는 이 표시를 따라 내려갑니다.

| Condition | Result |
| --- | --- |
| props가 같고, 자신과 자손에 일이 없음 | 서브트리 전체를 이전 트리와 공유합니다. |
| props가 같고, 자손에만 일이 있음 | 함수를 호출하지 않고 직계 자식만 복제해 내려갑니다. |
| 다시 호출했지만 state가 이전과 같음 | 자식 비교를 건너뜁니다. |
| `setState`로 넘긴 값이 현재 값과 같음 | 렌더를 예약하지 않습니다. |

4,000행 중 한 행의 상태만 바꾸면 **0.22 ms**, 루트부터 다시 렌더하면 3.60 ms입니다. 약 16배 차이입니다.

[Bailout](src/fiber/workLoop.ts) · [Child reconciler](src/fiber/childReconciler.ts) · [Hook queue](src/fiber/hooks.ts)

## Fewer Layers than React

| Layer | React | Reactify |
| --- | --- | --- |
| Events | 루트에 위임하는 합성 이벤트 시스템 | 없습니다. 현재 이벤트 이름만 읽어 lane을 정합니다. |
| Host attributes | 속성 종류별 전용 처리 | HTML 속성으로 정규화해 `setAttribute`로 씁니다. |
| Features | Context, Suspense, ref, 포털, SVG, hydration 등 | HTML 요소와 함수 컴포넌트만 다룹니다. |
| Hooks | 10종 이상 | `useState`, `useEffect`, `useMemo` |

- **Size** — gzip **10.6 KB** (React 69.3 KB)
- **Memory** — 마운트 후 행당 JS 힙 **742 B** (React 867 B)
- **Fast paths** — Reverse keys 5.5배, Unmount list 2.9배, Update one row 12%
- **Known gaps** — Initial render 8%, 4,000행을 모두 다시 그리는 경로는 25–37% 느립니다.

## API

| API | Description |
| --- | --- |
| `createElement(type, props?, ...children)` | HTML 태그나 함수 컴포넌트의 Element를 만듭니다. |
| `createRoot(container)` | 루트를 만듭니다. `root.render(children)`으로 화면을 예약합니다. |
| `useState(initial)` | 컴포넌트별 `[state, setState]`를 반환합니다. |
| `useEffect(setup, deps?)` | 커밋 후 setup을 실행하고, 의존성이 바뀌거나 언마운트하면 cleanup을 실행합니다. |
| `useMemo(calculate, deps?)` | 의존성이 같으면 계산한 값을 재사용합니다. |
| `startTransition(scope)` | 콜백 안의 갱신에 전환 우선순위를 부여합니다. |
| `runWithPriority(priority, scope)` | 콜백 안의 갱신에 우선순위를 지정합니다. |

HTML 요소, 함수 컴포넌트, 문자열, 숫자, 중첩 배열을 렌더링합니다. 이벤트는 DOM의 `addEventListener`로 연결합니다. JSX 런타임, SVG, `ref`, `onClick` 같은 이벤트 props, 객체형 `style`은 지원하지 않습니다.

## Benchmark

4,000행 목록을 React 19.3.1과 같은 컴포넌트 코드로 측정했습니다. 렌더 요청부터 DOM 커밋 직후까지의 중앙값(ms)이며, 막대 길이는 경로마다 느린 쪽을 100%로 둔 상대 길이입니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/bench-4000-rows-dark.png">
  <img src="assets/bench-4000-rows-light.png" alt="4,000행 목록의 일곱 가지 렌더 경로에서 Reactify와 React 19.3.1의 소요 시간을 비교한 막대 그래프">
</picture>

- 한 부분만 바뀌는 경로(Update one row)와 구조가 바뀌는 경로(Reverse keys, Unmount list)는 React보다 빠릅니다.
- 4,000행을 모두 다시 계산하는 경로(Re-render, Update 4,000 texts · attributes)는 bailout이 적용되지 않아 React보다 느립니다.

### Flame Graph

**Initial render**의 CPU 프로파일입니다. 위에서 아래로 호출 순서이고, 폭은 한 번의 렌더에서 차지한 시간입니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/flame-first-render-dark.png">
  <img src="assets/flame-first-render-light.png" alt="4,000행 첫 렌더의 CPU 프로파일을 Reactify와 React 19.3.1로 나란히 그린 flame 그래프">
</picture>

- **Browser DOM** — 절반 이상이며 두 라이브러리가 같습니다(53%, 54%).
- **Garbage collection** — Reactify 6%, React 14%입니다.
- **Framework JS** — Reactify 39%, React 29%입니다. 호스트 요소를 완료하는 단계(`completeHostElement`)가 더 깁니다.

**Re-render, same values**의 프로파일입니다. DOM 변경이 없어 대부분이 Framework JS입니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/flame-full-rerender-dark.png">
  <img src="assets/flame-full-rerender-light.png" alt="4,000행을 같은 값으로 다시 렌더할 때의 CPU 프로파일을 Reactify와 React 19.3.1로 나란히 그린 flame 그래프">
</picture>

- **Complete phase** — Reactify 26%, React 4%입니다. Reactify는 요소마다 태그를 검증하고 직접 텍스트를 확인합니다.
- **Commit phase** — 비중이 비슷합니다(17%, 18%).

### Size, Memory, Scheduling

| Metric | Reactify | React 19.3.1 |
| --- | ---: | ---: |
| Bundle size (minify + gzip) | **10.6 KB** | 69.3 KB |
| JS heap per row · 마운트 후 | **742 B** | 867 B |
| JS allocation · 전체 재렌더 1회 | 2.39 MB | **1.72 MB** |
| Longest block · 10,000행 Transition 마운트 | 7.8 ms | 6.6 ms |

Environment: Linux x64, Chrome 153 headless, 7세션의 중앙값, 소스 `9b85783953b8`.
