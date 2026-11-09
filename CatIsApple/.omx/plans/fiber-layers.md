# Reactify 레이어별 구현 계획

`CatIsApple` 브랜치의 `0af73ae`를 기준으로 한다. 첫 작업 단위는 Element다. Element와 함수형 컴포넌트가 반환하는 자식을 Fiber 렌더러로 갱신한다. 각 레이어는 아래의 완료 기준을 확인한 뒤 다음 레이어에서 사용한다. [현재 구현](../../src/element/index.ts) · [개인 README](../../README.md)

팀 과제에서 Fiber는 선택 확장이다. 이번 개인 구현에서는 요청에 따라 부모·자식·형제 링크가 있는 Fiber 트리를 처음부터 염두에 두고, 최초 렌더와 갱신은 동기로 처리한다. 우선순위 스케줄링과 중단·재개는 기본 과제를 마친 뒤 별도로 선택한다. [팀 구현 기준](../../../MISSION.md#phase-1-구현-체크리스트) · [React의 Fiber 타입](https://github.com/facebook/react/blob/v19.2.0/packages/react-reconciler/src/ReactInternalTypes.js#L81-L161)

개인 구현의 모든 레이어는 TypeScript의 strict 모드로 작성한다. 각 레이어는 구현 전에 경계 입력과 기대 결과를 정하고, 마무리할 때 실제 결과와 대조한다.

## 1. Element — 완료

`createElement(type, config, ...children)`가 반환하는 `{ type, key, props }`를 이후 레이어의 입력으로 정한다. Element는 한 번의 화면 구성을 표현한다. 부모·형제 링크, 대응하는 실제 DOM, 갱신 중인 작업은 Fiber에서 관리한다. [현재 함수](../../src/element/index.ts) · [React의 createElement](https://react.dev/reference/react/createElement)

| 확인할 입력 | 관찰할 결과 |
| --- | --- |
| 문자열 태그 또는 함수 참조를 `type`으로 전달 | 입력한 `type`을 그대로 돌려준다. 함수 호출 횟수는 0이다. |
| `config` 생략, `key: 0` 전달 | 생략 시 `key`는 `null`, 숫자 0은 문자열 `'0'`이다. 반환한 `props`에는 `key`가 없고 원본 설정에는 남는다. |
| `config.children`만 전달 | 해당 값을 보존한다. 설정과 자식 인자가 모두 비어 있으면 `props`에 `children` 필드를 만들지 않는다. |
| 자식 인자 한 개 또는 여러 개 전달 | 한 개는 그 값 자체, 여러 개는 입력 순서의 배열이다. 명시한 자식이 `config.children`보다 우선한다. 숫자 0, 빈 값, 중첩 Element도 생성 시 보존한다. |
| 같은 자식 Element를 두 곳에 사용 | 생성 과정에서 그 자식이나 입력 설정을 수정하지 않는다. 각 위치의 부모 관계는 나중에 Fiber가 표현한다. |

개인 README에 중첩 Element 예시와 입력 규칙을 기록했다. Node에서 `key` 생략·상속·명시적 `null`, 자식 생략·명시적 `undefined`, 동결한 입력, 함수 참조와 중첩 Element 재사용을 검증했다. 현재 개인 폴더에는 자동 테스트 하네스가 없다. [실행 예시](../../README.md) · [검증 지침](../../../CLAUDE.md#ai-검증-요청)

## 2. Fiber 트리 — 완료

Element 트리 하나를 받아 동기적으로 순회할 수 있는 작업 트리를 만든다. 루트 아래에서 `child`는 첫 자식, `sibling`은 다음 형제, `return`은 부모를 가리킨다. 문자열·숫자는 텍스트 작업으로 바꾸고, `null`·`undefined`·불리언은 화면에서 생략한다. 배열은 순서대로 순회한다. **완료 기준**은 중첩 요소, 두 형제, 숫자 0이 있는 트리를 DOM 없이 순회해 순서와 부모 관계를 확인하는 것이다. 같은 Element를 두 위치에 넣으면 서로 다른 Fiber가 생겨야 한다.

`npm run typecheck`와 `npm run build`를 통과했다. 빌드 결과를 Node에서 직접 실행해 부모·형제 링크, 공유 Element의 위치별 Fiber 생성, 함수 컴포넌트의 자식 입력 보존, 20,000단계 중첩과 순환 참조 처리를 확인했다. [작업 루프](../../src/fiber/workLoop.ts)

HostRoot 두 개는 `alternate`로 연결하며 `root.current`가 커밋된 쪽을 가리킨다. 같은 부모에서 key와 타입이 일치하면 작업 Fiber에서 기존 DOM 참조를 재사용한다. key가 없으면 형제 위치와 타입으로 비교한다. `root.prepare()`에서 트리를 준비하고 `root.commit()`에서 DOM 변경을 적용한 다음 `current`를 바꾼다. [루트 구현](../../src/fiber/root.ts)

## 3. 최초 DOM 표시 — 완료

컨테이너와 Element를 입력받아 HTML 요소와 텍스트를 최초 표시한다. 이후 함수 컴포넌트도 이 렌더러를 사용한다. 팀 과제의 기존 DOM 읽기와 두 편집 영역은 별도 과제 범위다. [Phase 1 요구사항](../../../MISSION.md#phase-1-구현-체크리스트)

## 4. Reconcile과 Commit

**Reconcile**은 같은 부모의 자식들을 순차 비교하다가 key가 어긋나면 남은 이전 형제를 Map으로 조회한다. 새 자식 및 이전 위치가 `lastPlacedIndex`보다 작은 재사용 자식에 `Placement`를 표시한다. 제거할 이전 자식은 부모의 `deletions`에 담고 `ChildDeletion`을 표시한다. 호스트 작업을 완료할 때 속성이나 텍스트가 달라진 Fiber에 `Update`를 표시한다. 자식이 완료될 때마다 그 변경 비트를 부모의 `subtreeFlags`에 합친다. [작업 루프](../../src/fiber/workLoop.ts) · [호스트 작업 완료](../../src/dom/completeWork.ts)

**완료 기준**은 삽입·삭제·교체·속성 갱신·텍스트 갱신 결과가 목표 화면과 같고, 두 형제 중 하나의 텍스트만 바꿀 때 다른 형제의 DOM 참조가 유지되는 것이다. 같은 입력을 연속 적용하면 DOM 변경은 0건이어야 한다. key 기반 재정렬은 호스트 노드와 여러 DOM 노드를 반환하는 함수 컴포넌트 양쪽에서 기존 노드 참조, 순서, 이동 실패 후 복구를 확인한다. [공용 검증 기준](../../../.claude/skills/verify/SKILL.md#체크리스트--phase-1)

**Commit**은 부모의 삭제를 먼저 적용하고, 변경이 있는 자손을 방문한 뒤 해당 Fiber의 삽입·갱신을 처리한다. DOM 반영이 끝나면 완성한 트리를 다음 `current`로 지정한다. 같은 입력으로 다시 렌더하면 커밋은 루트에서 순회를 끝낸다. [DOM 커밋](../../src/dom/index.ts)

## 5. 편집 화면과 History — 별도 과제, 보류

Patch 버튼은 편집한 테스트 영역을 다시 읽어 레이어 4로 보내고, 적용에 성공한 화면 구성을 History에 저장한다. 이력에는 Element·텍스트 스냅샷을 보관한다. Fiber와 실제 DOM 참조는 현재 렌더러가 소유한다. 이력 이동 시에는 테스트 영역에 사용자가 직접 편집한 내용까지 고려해 선택한 스냅샷으로 두 영역을 동기화한다.

**완료 기준**은 A → B → C를 적용한 뒤 뒤로·앞으로 이동하면 두 영역이 함께 바뀌고, B에서 D를 새로 적용하면 C로 가는 이력이 사라지는 것이다. 빈 영역과 이력 양 끝에서도 같은 절차로 확인한다. [이력 요구사항](../../../MISSION.md#phase-1-구현-체크리스트)

## 6. 함수 컴포넌트와 루트 Hooks

순수 함수 컴포넌트의 동기 렌더를 구현했다. 함수 Fiber는 props를 받아 반환한 자식들을 reconcile하고, 호스트 부모는 그 결과의 DOM만 순서대로 연결한다. 루트 상태와 Hooks는 다음 단계다. [작업 루프](../../src/fiber/workLoop.ts)

`FunctionComponent.mount()`와 `update()`가 반환받은 Element를 앞에서 만든 렌더러로 보낸다. 루트 인스턴스의 `hooks` 배열에서 호출 순서대로 상태를 관리한다. 자식 함수는 props로 화면을 표현한다. 구현 순서는 상태 갱신이 보이는 `useState`, 의존성에 따른 계산 재사용을 검증할 `useMemo`, 화면 반영 후 실행과 정리 순서를 검증할 `useEffect`다.

**완료 기준**은 클릭 한 번에 카운터 텍스트만 바뀌고 옆 입력창의 DOM 참조와 포커스가 유지되는 것이다. 같은 의존성에서는 memo 계산과 effect 실행이 반복되지 않아야 한다. 의존성이 바뀌면 이전 effect 정리 후 새 effect를 실행하고, 루트를 제거하면 마지막 정리를 수행한다. 개인 README에 Hook 호출 규칙과 실제 검증 결과를 기록한다. [Phase 2 요구사항](../../../MISSION.md#phase-2-구현-체크리스트) · [과제의 테스트 범위](../../../MISSION.md#검증-및-설명-준비)
