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

## Benchmark

4,000행 목록을 React 19.3.1과 같은 컴포넌트 코드로 측정했습니다. 렌더 요청부터 DOM 커밋 직후까지의 중앙값(ms)이며, 막대 길이는 경로마다 느린 쪽을 100%로 둔 상대 길이입니다.

![4,000행 목록의 일곱 가지 렌더 경로에서 Reactify와 React 19.3.1의 소요 시간을 비교한 막대 그래프](assets/bench-4000-rows.png)

- 한 부분만 바뀌는 경로(Update one row)와 구조가 바뀌는 경로(Reverse keys, Unmount list)는 React보다 빠릅니다.
- 4,000행을 모두 다시 계산하는 경로(Re-render, Update 4,000 texts · attributes)는 bailout이 적용되지 않아 React보다 느립니다.

### Flame Graph

**Initial render**의 CPU 프로파일입니다. 위에서 아래로 호출 순서이고, 폭은 한 번의 렌더에서 차지한 시간입니다.

![4,000행 첫 렌더의 CPU 프로파일을 Reactify와 React 19.3.1로 나란히 그린 flame 그래프](assets/flame-first-render.png)

- **Browser DOM** — 절반 이상이며 두 라이브러리가 같습니다(53%, 54%).
- **Garbage collection** — Reactify 6%, React 14%입니다.
- **Framework JS** — Reactify 39%, React 29%입니다. 호스트 요소를 완료하는 단계(`completeHostElement`)가 더 깁니다.

**Re-render, same values**의 프로파일입니다. DOM 변경이 없어 대부분이 Framework JS입니다.

![4,000행을 같은 값으로 다시 렌더할 때의 CPU 프로파일을 Reactify와 React 19.3.1로 나란히 그린 flame 그래프](assets/flame-full-rerender.png)

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

## Documentation

v1은 상태를 루트 컴포넌트에만 두고, 어느 값이 바뀌든 루트부터 끝까지 다시 실행합니다. Reactify는 상태를 컴포넌트마다 Fiber에 두고, 렌더를 작은 단위로 나눠 필요한 부분만 필요한 순서로 실행합니다.

### Element → Fiber → DOM

![Element 트리가 render 단계에서 Fiber 트리와 비교되어 한 노드에 Update flag가 붙고, commit 단계에서 그 노드만 DOM에 쓰이는 흐름](assets/pipeline.png)

`createElement()`는 화면을 설명하는 Element `{ type, key, props }`를 만듭니다. Element는 매 렌더 새로 만들어지는 입력이고, 이전 결과는 Fiber가 기억합니다.

**Render phase**는 새 Element를 Fiber 트리와 비교해 달라진 노드에 flag(`Placement`, `Update`, `ChildDeletion`)만 남깁니다. 이 단계에서는 화면의 DOM을 바꾸지 않습니다. **Commit phase**가 flag가 붙은 노드만 DOM에 한 번에 반영합니다.

계산과 반영이 나뉘어 있어 렌더를 도중에 멈추거나 버려도 화면은 그대로입니다. 같은 값으로 4,000행을 다시 렌더하면 DOM 변경은 0건입니다.

### Fiber Architecture

![child와 sibling 링크로 이어진 Fiber 트리에서 처리한 Fiber, 멈춘 자리의 Fiber, 남은 Fiber를 구분한 그림](assets/fiber-work-loop.png)

Fiber는 컴포넌트나 HTML 요소 하나에 대응하는 작업 단위입니다. 각 Fiber는 `child`(첫 자식), `sibling`(다음 형제), `return`(부모) 링크로 이어져 있어, 재귀 호출 없이 반복문으로 트리를 순회합니다. Work loop는 Fiber 하나를 처리할 때마다 다음에 처리할 Fiber를 저장합니다.

그래서 Fiber 하나를 끝낸 시점마다 렌더를 멈추고 브라우저에 제어권을 넘길 수 있습니다. 브라우저가 입력과 페인트를 처리하면, 저장해 둔 Fiber부터 이어서 진행합니다.

작업은 화면과 일치하는 `current` 트리가 아니라 짝(`alternate`)인 work-in-progress 트리에서만 이루어집니다. 렌더를 버려도 `current`는 그대로이고, 커밋에 성공하면 `root.current` 포인터만 새 트리로 바꿉니다.

[Fiber types](src/fiber/types.ts) · [Work loop](src/fiber/workLoop.ts) · [DOM commit](src/dom/commitWork.ts)

### Lanes Scheduling

![Transition 렌더가 5 ms 단위로 진행되다가 click이 들어오면 버려지고, Sync 갱신이 먼저 커밋된 뒤 Transition 렌더가 처음부터 다시 실행되는 타임라인](assets/lanes.png)

모든 갱신에는 우선순위를 나타내는 비트(lane)가 붙습니다. `click` · `input`에서 생긴 갱신은 `SyncLane`, `scroll`은 `InputContinuousLane`, 그 밖은 `DefaultLane`, `startTransition()` 안의 갱신은 `TransitionLanes`를 받습니다. Root scheduler는 대기 중인 lane 가운데 가장 급한 것부터 렌더합니다.

Sync · Input · Default 렌더는 시작하면 끝까지 실행합니다. Transition과 Idle 렌더는 5 ms마다 브라우저에 제어권을 넘깁니다. 양보한 사이에 더 급한 갱신이 들어오면 진행 중이던 렌더를 버리고 급한 갱신을 먼저 커밋한 뒤, 버린 렌더를 처음부터 다시 실행합니다.

10,000행을 마운트하는 동안 메인 스레드가 가장 오래 막힌 시간은 Sync 35.0 ms, Transition 7.8 ms입니다. Transition 도중에 들어온 Sync 갱신은 0.2 ms 만에 먼저 커밋됩니다.

[Lanes](src/fiber/lanes.ts) · [Root scheduler](src/fiber/rootScheduler.ts) · [Host scheduler](src/scheduler/scheduler.ts)

### Bailout

![HostRoot에서 setState가 일어난 컴포넌트까지의 경로만 복사하고, 그 아래만 다시 호출하며, 나머지 가지는 방문하지 않는 Fiber 트리](assets/bailout.png)

`setState`는 상태를 가진 Fiber에 lane을 표시하고, 부모를 따라 올라가며 같은 비트를 `childLanes`에 기록합니다. 렌더는 항상 루트에서 시작하지만, props 객체가 그대로이고 자신에게 할 일이 없는 Fiber는 컴포넌트 함수를 호출하지 않습니다. `childLanes`에 표시가 있으면 직계 자식만 복제해 내려가고, 표시가 없으면 그 서브트리 전체를 이전 Fiber와 공유한 채 건너뜁니다.

그래서 루트에서 갱신된 컴포넌트까지는 경로만 복사하고, 다시 호출되는 것은 갱신된 컴포넌트와 그 아래뿐입니다. 4,000행 중 한 행의 상태를 바꾸면 컴포넌트 호출은 1회, 0.22 ms입니다. 루트부터 전부 다시 렌더하면 4,000회, 3.60 ms입니다.

[Bailout](src/fiber/workLoop.ts) · [Child reconciler](src/fiber/childReconciler.ts) · [Hook queue](src/fiber/hooks.ts)

### API

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
