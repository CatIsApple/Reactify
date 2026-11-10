# Reactify v2

Reactify는 함수 컴포넌트가 반환한 Element를 브라우저 DOM에 그리는 TypeScript 렌더러입니다. Fiber가 컴포넌트별 상태를 보관하고, 갱신 우선순위와 자식의 변경 여부에 따라 다시 실행할 작업을 결정합니다. 런타임 의존성은 없습니다.

## 빌드와 사용

Node.js 22 이상에서 `CatIsApple/` 디렉터리의 명령을 실행합니다.

```sh
npm ci
npm run typecheck
npm run build
```

빌드하면 `dist/index.js`와 TypeScript 선언 파일이 생성됩니다. 브라우저 ES 모듈에서 DOM 컨테이너를 루트에 연결합니다.

```js
import { createElement, createRoot } from './dist/index.js';

const root = createRoot(document.getElementById('app'));
root.render(createElement('h1', { className: 'title' }, 'Reactify'));
```

`root.render()`는 화면 갱신을 예약합니다. DOM이 바뀌는 시점은 해당 요청이 커밋될 때입니다. 같은 루트에서 다음 Element를 넘기면 이전 트리와 비교하고, `root.render(null)`을 호출하면 내용을 비웁니다.

## 렌더링 구조

![화면 요청과 상태 요청이 각자의 큐를 거쳐 루트 스케줄러에 모이고, Fiber 렌더와 DOM 커밋으로 이어지는 흐름](assets/fiber-render-flow.png)

1. **요청** — `root.render(element)`는 HostRoot 큐에 다음 화면을 넣습니다. `setState(action)`은 상태를 소유한 함수 컴포넌트의 Hook 큐에 갱신을 넣습니다. 두 요청 모두 같은 루트 스케줄러에서 처리합니다.
2. **스케줄링** — 각 요청에는 우선순위를 나타내는 비트인 *lane*이 붙습니다. 전환과 유휴 작업은 Fiber 사이에서 브라우저에 실행권을 돌려주고 나중에 이어갈 수 있습니다. 실행 중인 컴포넌트 함수 하나는 반환할 때까지 실행됩니다.
3. **렌더** — `root.current`가 가리키는 트리를 기준으로 작업용 트리를 만듭니다. 두 버전의 Fiber는 `alternate`로 연결됩니다. 목록은 앞에서부터 비교하고, 순서가 어긋나면 남은 형제를 key로 찾습니다. 같은 부모 아래에서 key와 type이 유지된 항목은 이동해도 상태와 DOM을 재사용할 수 있습니다.
4. **커밋** — 새 DOM은 문서 밖에서 준비합니다. 커밋은 `flags`와 `subtreeFlags`를 따라 삭제·삽입·이동·갱신을 동기로 반영합니다. 성공하면 `root.current`가 완성된 트리로 바뀌고, 해당 커밋의 effect 처리를 예약합니다.

예를 들어 `App` 아래의 `Header`와 `Counter` 중 `Counter`만 상태를 바꾸면, 그 요청의 lane이 `Counter`에, 같은 비트가 조상의 `childLanes`에 기록됩니다. 다른 요청이 없고 props가 그대로라면 `App`과 `Header` 함수를 다시 호출하지 않고 `Counter`를 갱신합니다. `<strong>`의 유일한 자식이 숫자라면 그 호스트 Fiber가 DOM 텍스트를 직접 갱신합니다.

[작업 루프](src/fiber/workLoop.ts) · [자식 비교](src/fiber/childReconciler.ts) · [DOM 커밋](src/dom/commitWork.ts)

## 공개 API

| API | 동작 |
| --- | --- |
| `createElement(type, props?, ...children)` | HTML 태그 또는 함수 컴포넌트를 나타내는 `{ type, key, props }`를 만듭니다. `key`는 형제 간 비교에 쓰이며 컴포넌트의 props에서 제외됩니다. |
| `createRoot(container)` | DOM 컨테이너에 루트를 만듭니다. `root.render(children)`으로 화면을 예약합니다. 렌더와 커밋을 직접 나눌 때는 `root.prepare(children)`로 동기 준비 후 `root.commit()`으로 반영합니다. |
| `useState(initial)` | 컴포넌트별로 `[state, setState]`를 반환합니다. 초기화 함수와 이전 상태를 받는 updater를 지원합니다. |
| `useEffect(setup, deps?)` | 커밋 후 setup을 실행합니다. 의존성이 바뀌면 이전 cleanup 후 새 setup을 실행하고, 언마운트하면 마지막 cleanup을 실행합니다. |
| `useMemo(calculate, deps?)` | 렌더 중 계산한 값을 보관합니다. 각 의존성이 이전 값과 `Object.is`로 같으면 값을 재사용합니다. |
| `startTransition(scope)` | 콜백 안에서 동기로 등록한 갱신에 전환 우선순위를 부여합니다. |
| `runWithPriority(priority, scope)` | 콜백 안에서 등록하는 갱신의 우선순위를 지정합니다. |

Hook은 각 함수 컴포넌트의 최상위에서 매 렌더마다 같은 순서로 호출합니다. `useEffect`와 `useMemo`에서 의존성 배열을 생략하면 해당 컴포넌트가 다시 렌더될 때마다 실행합니다. [공개 진입점](src/index.ts)

## DOM 지원 범위

- HTML 요소, 함수 컴포넌트, 문자열, 숫자, 중첩 배열을 렌더링합니다. `null`, `undefined`, 불리언 자식은 건너뜁니다.
- `className`, `htmlFor`, `data-*`, `aria-*`, 불리언 HTML 속성, 문자열 `style`을 지원합니다. 이벤트는 DOM의 `addEventListener`로 연결합니다.
- JSX 런타임, SVG·MathML, `template`, `ref`, `onClick` 같은 이벤트 props, 객체형 `style`은 지원 범위 밖입니다.
