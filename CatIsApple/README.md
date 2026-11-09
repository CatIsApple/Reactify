# Reactify

`CatIsApple`의 Mini React는 TypeScript와 ES 모듈로 구현합니다. Node.js 22 이상에서 이 폴더를 기준으로 다음 명령을 실행합니다.

```sh
npm ci
npm run typecheck
npm run build
```

빌드는 `src/`의 TypeScript를 `dist/`에 JavaScript와 타입 선언 파일로 출력합니다.

`createElement(type, config, ...children)`는 화면을 표현하는 `{ type, key, props }` 객체를 만듭니다. 태그 문자열이나 함수 참조를 `type`에 그대로 저장합니다. [구현](src/element/index.ts) · [Element 타입](src/element/types.ts)

```ts
import { createElement } from './dist/element/index.js';

const item = createElement('li', { key: 0 }, '사과');
const list = createElement('ul', null, item);
// item.key === '0'
// list.props.children === item
```

- `config`의 열거 가능한 자체 속성을 새 `props`에 얕게 복사하고, 그중 `key`는 최상위로 분리합니다. 생략하거나 `undefined`면 `null`, 명시한 `null`은 문자열 `'null'`입니다.
- 자식 인자를 생략하면 `config.children`을 보존합니다. 하나를 전달하면 그 값이 우선하므로 `0`, `false`, 명시적 `undefined`도 그대로 들어갑니다. 여러 개면 순서대로 배열에 담습니다.

학습용 객체이며 실제 React 패키지와 호환되는 구현은 아닙니다.
`src/app/index.html`은 비워 둔 앱 시작점입니다.

## Fiber 트리

`createFiberFromElement(element, parent?)`는 해당 위치의 Fiber 하나를 만들고, `buildFiberTree(element)`는 루트부터 `child`(첫 자식), `sibling`(다음 형제), `return`(부모)을 연결합니다. 두 위치에서 같은 Element를 사용하면 각각의 Fiber가 같은 Element를 참조합니다. [작업 루프](src/fiber/workLoop.ts) · [Fiber 타입](src/fiber/types.ts)

동기 작업 루프는 `workInProgress`로 현재 Fiber를 가리킵니다. `beginWork`는 직계 자식들을 형제로 연결하고 첫 `child`를 돌려줍니다. 자식이 없으면 `completeUnitOfWork`가 다음 `sibling`을 찾을 때까지 `return`을 따라 올라갑니다. 루트까지 완료하면 순회가 끝납니다. [React의 동기 작업 루프](https://github.com/facebook/react/blob/v19.2.0/packages/react-reconciler/src/ReactFiberWorkLoop.js#L2543-L2548)

```ts
import { createElement } from './dist/element/index.js';
import { buildFiberTree } from './dist/fiber/index.js';

const item = createElement('li', null, '사과');
const root = buildFiberTree(createElement('ul', null, item, item));
// root.child와 root.child.sibling은 서로 다른 Fiber이며, 둘의 return은 root입니다.
```

호스트 태그의 중첩 배열은 순서대로 펼칩니다. 숫자 `0`과 빈 문자열은 텍스트 Fiber가 되고, `null`·`undefined`·불리언은 건너뜁니다. 자식이 자기 조상을 다시 참조하면 `TypeError`를 던집니다.

## 렌더와 커밋

`createRoot(container)`가 반환한 루트의 `current`는 커밋된 HostRoot Fiber를 가리킵니다. 각 Fiber의 `alternate`는 반대편 트리에 있는 짝입니다. 처음 생긴 버튼 Fiber의 `alternate`는 `null`이고, 다음 렌더에서 같은 버튼을 재사용하면 짝이 생깁니다. 두 Fiber의 `stateNode`는 같은 DOM 버튼입니다. [루트](src/fiber/root.ts) · [DOM 반영](src/dom/index.ts)

```ts
import { createElement } from './dist/element/index.js';
import { createRoot } from './dist/fiber/index.js';

const container = document.createElement('div');
const root = createRoot(container);
function SaveButton({ disabled }: { disabled: boolean }) {
  return createElement('button', { disabled }, '저장');
}

root.render(createElement(SaveButton, { disabled: false }));
const before = root.current;
const dom = container.querySelector('button')!;

root.prepare(createElement(SaveButton, { disabled: true }));
// root.current === before, root.finishedWork === before.alternate, dom.disabled === false
root.commit();
// root.current.alternate === before, dom === container.firstChild, dom.disabled === true
```

이 예제의 Fiber 트리는 `HostRoot → SaveButton → button → 텍스트`입니다. 렌더 중에 `SaveButton(props)`을 호출하고 반환값을 자식 Fiber로 연결합니다. 컴포넌트가 받은 `props.children`도 반환값에 포함할 때 화면에 나타납니다. 함수 Fiber의 `stateNode`는 `null`이고, 반환한 버튼 DOM이 컨테이너의 직계 자식이 됩니다. 함수가 배열을 반환하면 여러 자식이 그 자리에 순서대로 들어가고, `null`이면 그 자리를 비웁니다.

`render(input)`은 `prepare(input)`과 `commit()`을 동기로 실행합니다. 다시 준비하면 이전 요청을 대체합니다. 준비에 실패하면 대기 중인 결과를 비우고 현재 트리와 화면을 유지합니다. `render(null)`은 자식을 제거합니다.

위 예제에서 `prepare()` 직후 버튼 Fiber의 `flags`에는 `Update`가 켜집니다. 버튼의 조상인 `SaveButton`과 `HostRoot`에는 `subtreeFlags`로 같은 비트가 전파됩니다. 버튼의 텍스트는 그대로이므로 커밋은 텍스트 Fiber로 내려가지 않습니다. [플래그 정의](src/fiber/flags.ts) · [전파](src/fiber/workLoop.ts)

| 변경 | 렌더가 표시하는 위치 | 커밋 동작 |
| --- | --- | --- |
| 삽입 | 새 서브트리 맨 위 Fiber의 `Placement` | 해당 Fiber가 내놓는 DOM 노드를 다음 기존 형제 앞에 순서대로 삽입합니다. |
| 이동 | 기존 Fiber를 재사용하면서 위치를 옮길 때 `Placement` | 해당 Fiber의 기존 DOM 노드를 새 형제 순서에 맞춰 옮깁니다. |
| 속성·텍스트 갱신 | 값이 바뀐 호스트 또는 텍스트 Fiber의 `Update` | 기존 DOM 노드에서 바뀐 값만 씁니다. |
| 삭제 | 부모의 `ChildDeletion`과 `deletions` | 목록에 담긴 이전 자식 Fiber가 내놓던 DOM 노드를 제거합니다. |

첫 커밋은 HostRoot의 `Snapshot`을 보고 기존 컨테이너를 비웁니다. 각 부모에서는 삭제를 먼저 처리하고, `subtreeFlags`에 변경이 있는 가지로 내려갑니다. 자식 작업을 마치면 해당 Fiber 자신의 삽입·갱신을 적용합니다. DOM 변경이 모두 성공하면 `root.current`를 교체합니다. 중간에 실패하면 이미 적용한 DOM 변경을 역순으로 되돌리고 같은 `finishedWork`로 재시도할 수 있습니다. [DOM 준비](src/dom/completeWork.ts) · [커밋 순회](src/dom/index.ts)

현재 DOM 렌더러는 HTML 요소와 텍스트를 표시합니다. 속성은 문자열·숫자, `className`·`htmlFor`, `disabled` 같은 HTML 불리언 속성, `aria-*`·`data-*`를 처리합니다. 이벤트 핸들러, 객체형 스타일, SVG, Hooks는 이후 레이어의 범위입니다. [속성 처리](src/dom/attributes.ts)

검증은 `npm run typecheck`, `npm run build`와 실제 Chrome에서 수행했습니다. 자식 텍스트와 부모 속성을 함께 바꿨을 때 부모의 속성 변경 콜백은 새 텍스트와 교체 전 `current`를 읽었습니다. 텍스트 하나만 바꿨을 때 변경 없는 형제의 자식 링크 접근은 0회였고, 동일 입력에서는 DOM 변경도 0건이었습니다. 함수 컴포넌트가 여러 노드를 반환할 때의 삽입 순서와 입력 포커스, 18,001단계 트리의 갱신·삭제, DOM 쓰기 직후 예외를 던진 뒤 원래 노드 복구와 재시도도 확인했습니다.

React DOM 19.2와 Reactify에 같은 함수 컴포넌트 트리를 렌더해 반환하는 자식 수를 바꾸는 8번의 갱신에서 HTML과 입력 노드 재사용이 일치하는지 확인했습니다. 함수의 예외·순환 반환·지원하지 않는 Promise나 일반 객체 반환은 준비 단계에서 실패하고, 이후 정상 입력으로 다시 렌더할 수 있습니다.

## key로 형제 재정렬하기

같은 부모의 자식을 앞에서부터 비교합니다. 처음으로 key가 어긋나면 **남은 이전 형제만** Map에 넣습니다. 명시한 key는 문자열, key 없는 자식은 `null`·`undefined`·불리언을 제외한 숫자 위치로 찾습니다. 따라서 `key={0}`과 key 없는 첫 번째 자식은 서로 다른 후보입니다. 후보의 타입까지 같으면 Fiber의 짝과 DOM을 재사용합니다. 타입이나 부모가 바뀌면 새로 만듭니다. 같은 부모에서 key가 중복되면 모두 표시하지만, 어느 기존 노드를 재사용할지는 보장하지 않습니다. [자식 조정](src/fiber/workLoop.ts)

예를 들어 `[A, B, C] → [B, A, C]`에서 새 순서로 읽은 이전 위치는 `[1, 0, 2]`입니다. B의 이전 위치 1을 기록한 뒤 A의 0을 만나므로 A에만 `Placement`를 붙입니다. 커밋은 기존 A를 C 앞에 옮깁니다. 세 DOM 객체는 그대로이고 삭제 목록은 비어 있습니다. [React의 placeChild](https://github.com/facebook/react/blob/v19.2.0/packages/react-reconciler/src/ReactChildFiber.js#L458-L485)

Chrome에서 중첩 함수 컴포넌트 목록을 600회 갱신해 React DOM 19.2.0과 최종 HTML 및 각 DOM 노드의 재사용 여부가 일치하는지 확인했습니다. 별도 이동 검증에서는 사용자가 입력한 값·포커스·역방향 선택 범위가 유지됐고, 이동 직후 예외가 발생해도 커밋 전 순서로 복구된 뒤 재시도에 성공했습니다.
