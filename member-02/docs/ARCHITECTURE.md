# 엔진 설계와 설명 가이드

## 1. 왜 DOM을 객체로 표현할까?

`domToVNode()`는 element의 `localName`, attributes, childNodes를 읽습니다. 텍스트와 주석도 별도 노드이며, 공백을 임의로 삭제하지 않습니다. `value`, `checked`, option의 `selected`는 HTML attribute와 달리 사용자 입력 이후 property만 달라질 수 있으므로 현재 property를 별도로 저장합니다.

```js
{
  type: 'li',
  key: 'task-1',
  props: { class: 'task' },
  namespace: 'http://www.w3.org/1999/xhtml',
  children: [{ type: '#text', key: null, props: { nodeValue: 'hello' }, children: [] }]
}
```

브라우저 객체를 복제하는 대신 렌더링 의도를 일반 객체로 보관하면 비교, 테스트, 이력 복원이 가능합니다. VNode는 DOM 객체를 들고 있지 않습니다. Fiber가 DOM 참조를 소유합니다.

`h()`는 자식 배열을 평탄화하고 숫자를 텍스트로, null/undefined/boolean을 빈 자식으로 정규화합니다. 함수 타입의 VNode는 Fiber가 평가합니다. JSX 변환기는 사용하지 않습니다.

## 2. Diff의 다섯 가지 핵심 케이스

| 조건                      | 계획           | Patch                    |
| ------------------------- | -------------- | ------------------------ |
| 이전 없음, 다음 있음      | CREATE         | 새로운 subtree 생성·삽입 |
| 이전 있음, 다음 없음      | REMOVE         | 해당 DOM 제거            |
| type/key/namespace 불일치 | REPLACE        | 해당 subtree 교체        |
| 텍스트·주석 값 변경       | TEXT           | 기존 nodeValue 수정      |
| 같은 요소의 props 변경    | UPDATE / PROPS | 해당 속성·이벤트만 수정  |

자식은 재귀적으로 비교하되, 형제 key를 Map으로 인덱싱합니다. key가 없는 노드는 같은 인덱스의 unkeyed 노드와 매칭합니다. 중복 key는 새로 추가되는 하위 트리까지 미리 검사하여 commit 전 오류로 처리합니다.

`diffSteps()`는 generator입니다. 검증과 비교 사이에 스케줄러가 작업을 양보할 수 있습니다. Phase 1의 `diff()`는 동일 generator를 끝까지 동기 실행하는 편의 함수입니다.

Patch 시작 시 이전 childNodes를 배열로 캡처합니다. 먼저 삭제할 노드를 제거한 후 매칭한 실제 객체를 패치하고, 목표 위치가 다르면 `insertBefore()`로 옮깁니다. 순서 변경으로 인덱스가 흔들려도 참조가 안전합니다. `innerHTML = newHTML`로 실제 영역을 매번 재생성하지 않습니다.

key 매칭 자체는 형제 수에 선형입니다. 브라우저 삽입 비용, 배열 생성·복사, 트리 깊이까지 포함해 전체 갱신이 언제나 O(n)이거나 최소 편집이라는 보장은 없습니다. 특히 많은 이동의 비용은 커질 수 있습니다.

## 3. Fiber는 무엇을 바꾸는가?

일반적인 재귀 렌더러는 JS 호출 스택을 내려가며 일을 끝냅니다. 이 구현은 작업의 위치를 객체에 저장합니다.

```text
FunctionComponent(Board)     ← current / work-in-progress
  child → div
            child → section
                       child → form
                       sibling → ul
            sibling → aside

각 노드: type, key, vnode, child, sibling, return, alternate, dom, output
```

- `child`: 첫 자식 작업
- `sibling`: 다음 형제 작업
- `return`: 완료한 뒤 돌아갈 부모
- `alternate`: 이전 commit의 대응 Fiber
- `dom`: 대응하는 실제 DOM 객체
- `output`: 함수 평가가 끝난 host VNode

작업 루프는 beginWork에서 함수 평가와 자식 연결을 하고, 자식이 끝나면 completeWork에서 host VNode를 구성합니다. 포인터가 남아 있으므로 작업 사이에 JS 실행권을 브라우저에 돌려주고 다음 macrotask에서 재개할 수 있습니다.

기본 스케줄러는 `setTimeout`으로 다음 macrotask를 예약하고 `performance.now()`로 5ms 예산을 계산합니다. idle time만 기다리는 `requestIdleCallback`은 바쁜 브라우저에서 사용자 입력 반응을 지연시킬 수 있어 기본으로 사용하지 않습니다. setTimeout 역시 정확한 실행 시점을 보장하지 않으며 백그라운드에서는 브라우저가 제한할 수 있습니다.

처음부터 모든 React 기능을 모사하지 않고, **함수 평가를 위한 Fiber 트리 → 공통 host VDOM Diff → commit** 구조로 두 Phase를 연결했습니다. React 내부 reconciler를 그대로 복사한 구조는 아닙니다.

## 4. Render와 commit 경계

Render 중에는 기존 DOM을 읽어 다시 만들지 않습니다. 컴포넌트의 반환값으로 다음 트리를 계산합니다. 완성된 변경 계획이 나온 뒤에만 `patch()`를 동기 실행합니다. 따라서 브라우저가 새 트리의 절반만 표시하는 중간 프레임을 보지 않습니다.

commit 후에는 다음 트리를 current로 바꾸고 draft hooks를 확정합니다. 이전 Fiber의 오래된 alternate 연결을 모두 끊어 이력 전체가 메모리에 계속 남지 않게 합니다. 상태 이력이 필요한 Phase 1은 별도의 명시적인 `StateHistory`를 사용합니다.

주의: commit은 DOM API 실패를 되돌리는 트랜잭션이 아닙니다. 렌더러 밖에서 관리 중인 DOM을 임의로 삭제하는 상황은 지원하지 않습니다. 사용자 컴포넌트는 render에서 부작용을 만들지 않아야 합니다.

## 5. Hook은 함수 밖 어디에 기억되는가?

`FunctionComponent.hooks`가 commit된 값을 보관합니다. 렌더링할 때 `hookIndex = 0`부터 같은 순서로 슬롯을 찾습니다. 새 값은 `draftHooks`에 저장하고 commit에서 확정합니다.

### useState

각 슬롯에는 value, queue, stable setter가 있습니다. setter는 큐에 값이나 updater 함수를 넣고 `update()`를 예약합니다. render에서 기존 value에 큐를 순서대로 적용합니다.

```js
setCount((n) => n + 1);
setCount((n) => n + 1);
setCount((n) => n + 1); // 0 → 1 → 2 → 3, 한 번의 commit
```

스케줄된 작업이 이미 있으면 추가 예약을 하지 않습니다. 이 규칙이 자동 batching의 기반입니다. render가 소비한 큐 길이만 기록하고 **commit 때 그만큼만 제거**합니다. render가 양보한 동안 새로 들어온 업데이트는 다음 render에서 처리하므로 유실되지 않습니다.

같은 직접 값은 Object.is로 빠르게 건너뜁니다. 함수형 updater는 순서를 보존하기 위해 큐에서 평가합니다. updater가 같은 값을 반환해도 이 구현은 렌더링 자체를 생략하지 않습니다. unmount 이후 setter, 이전 mount 세대의 setter는 무시합니다.

### useMemo

의존성을 항목별 Object.is로 비교하고, 같으면 이전 계산값을 반환합니다. 의존성 생략은 매번 계산, 빈 배열은 mount 동안 한 번 계산입니다. 객체를 제자리에서 수정하면 참조가 같기 때문에 바뀐 것으로 인식하지 않습니다. 상태는 새 배열·객체로 갱신해야 합니다.

### useEffect

render에서는 실행할 effect만 기록합니다. commit 후 의존성이 바뀐 슬롯의 이전 cleanup을 호출한 다음 새 setup을 호출합니다. unmount에서도 cleanup을 실행합니다. effect에서 setState하면 후속 render가 예약됩니다.

React처럼 별도의 passive effect 단계나 paint 이후 타이밍을 보장하지 않습니다. async 함수를 직접 effect로 넘기면 Promise는 cleanup이 아니므로 오류입니다. setup 안에서 비동기 작업을 시작하고 함수형 cleanup으로 취소하는 패턴을 사용하세요.

### 루트만 Hook 사용

루트 함수 평가 중에만 hook owner를 설정합니다. 자식 함수 평가에는 owner가 없으므로 Hook 호출 시 명확한 오류가 납니다. 함수 밖의 Hook 호출, Hook 개수·종류의 순서 변화도 오류로 처리합니다. 같은 종류의 Hook을 서로 교환하는 의미상의 순서 오류까지 검출하지는 않습니다.

## 6. 브라우저 API와 렌더링 비용

Document는 노드 생성·조회·이벤트 연결을 담당합니다. Window는 UI 이벤트, 타이머, selection, location 같은 브라우저 기능의 진입점입니다. `MutationObserver`는 DOM 구조/속성/characterData 변경을 관찰하지만, `input.value = ...` 같은 property 변경 자체는 mutation record를 만들지 않습니다. 폼 입력은 이벤트와 현재 property 읽기를 병행합니다. [MDN MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)

DOM API 호출 그 자체만으로 항상 느린 것은 아닙니다. 스타일 계산, layout(reflow), paint, compositing 비용은 바뀐 속성과 문서 상태에 따라 달라집니다. DOM 쓰기 사이에 offsetWidth 같은 layout 읽기를 반복하면 강제 동기 레이아웃이 발생할 수 있습니다. 이 엔진은 diff 중 DOM을 쓰지 않고 commit에서 변경을 모읍니다. 별도 브라우저 벤치마크 없이 실제 React보다 빠르다고 주장하지 않습니다. [브라우저 렌더링 설명](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work)

## 7. 실제 React와 비교

| 기능            | 이 프로젝트                  | 실제 React                             |
| --------------- | ---------------------------- | -------------------------------------- |
| 함수형 컴포넌트 | 지원, 단일 출력              | 다양한 출력·생태계 지원                |
| Hook 소유 위치  | 루트만                       | 각 함수형 컴포넌트                     |
| 상태 보존       | 루트 인스턴스의 배열         | 컴포넌트 identity와 Fiber에 연결       |
| 작업 분할       | 고정 5ms 협력적 양보         | 우선순위와 scheduler 등 더 복잡한 정책 |
| Diff/Patch      | 공유 host VDOM 계획          | React reconciler와 renderer            |
| Effect          | commit 뒤 동기 실행          | passive effect 및 개발 모드 동작 등    |
| 동시성          | 작업 사이 양보, 후속 큐 보존 | lanes, transitions, 중단·재시작 등     |
| 서버·고급 기능  | 미지원                       | SSR/hydration, Suspense 등             |

Fiber의 child/sibling/return/alternate 설명은 [React Fiber Architecture](https://github.com/acdlite/react-fiber-architecture)를 참고했습니다. 이 글은 개념 설명이며 최신 구현 명세는 아닙니다. Hook API 의미는 공식 [useState](https://react.dev/reference/react/useState), [useEffect](https://react.dev/reference/react/useEffect), [useMemo](https://react.dev/reference/react/useMemo)를 참고하되 위의 차이를 명시적으로 둡니다.

## 8. 발표에서 설명할 순서

1. Phase 1 제목을 바꾸고 TEXT 한 작업과 DOM 보존 수를 보여줍니다.
2. key 순서를 뒤집고 객체를 다시 만들지 않는 이유를 설명합니다.
3. history에서 과거로 이동한 뒤 새 변경을 적용하여 분기를 보여줍니다.
4. Phase 2에서 입력만 바꿀 때 memo 계산 수가 유지되는지 확인합니다.
5. +3 버튼에서 상태는 3 증가하고 commit은 1 증가하는 모습을 보여줍니다.
6. Fiber 트리의 포인터와 render/commit 경계를 코드로 설명합니다.
7. 단위 테스트의 DOM 객체 동일성 검증과 중복 key 회귀 테스트를 소개합니다.

추가 발전 방향: 최소 이동을 위한 LIS, 우선순위별 작업 큐, effect의 비동기 flush, Fragment, 다양한 DOM property 어댑터. 실제 React와 가까워지려면 루트 전용이라는 과제 제약을 별도 확장 모드에서 풀고 각 컴포넌트 Fiber가 Hook을 소유하도록 설계를 바꿀 수 있습니다.
