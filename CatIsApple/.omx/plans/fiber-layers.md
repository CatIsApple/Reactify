# Reactify v2 레이어별 구현 계획

v2는 `createElement → Fiber 렌더 → DOM 커밋` 경로를 TypeScript strict 모드로 구현한다. v1은 과제의 DOM → Element 변환, 편집 화면과 History, 루트 전용 Hooks를 진행할 브랜치다. 각 레이어는 경계 입력과 기대 결과를 정한 뒤 실제 동작과 대조한다. [v2 README](../../README.md) · [과제 요구사항](../../../MISSION.md)

## 1. Element — 완료

`createElement(type, config, ...children)`가 반환하는 `{ type, key, props }`를 이후 레이어의 입력으로 정한다. Element는 한 번의 화면 구성을 표현한다. 부모·형제 링크, 대응하는 실제 DOM, 갱신 중인 작업은 Fiber에서 관리한다. [현재 함수](../../src/element/createElement.ts) · [React의 createElement](https://react.dev/reference/react/createElement)

| 확인할 입력 | 관찰할 결과 |
| --- | --- |
| 문자열 태그 또는 함수 참조를 `type`으로 전달 | 입력한 `type`을 그대로 돌려준다. 함수 호출 횟수는 0이다. |
| `config` 생략, `key: 0` 전달 | 생략 시 `key`는 `null`, 숫자 0은 문자열 `'0'`이다. 반환한 `props`에는 `key`가 없고 원본 설정에는 남는다. |
| `config.children`만 전달 | 해당 값을 보존한다. 설정과 자식 인자가 모두 비어 있으면 `props`에 `children` 필드를 만들지 않는다. |
| 자식 인자 한 개 또는 여러 개 전달 | 한 개는 그 값 자체, 여러 개는 입력 순서의 배열이다. 명시한 자식이 `config.children`보다 우선한다. 숫자 0, 빈 값, 중첩 Element도 생성 시 보존한다. |
| 같은 자식 Element를 두 곳에 사용 | 생성 과정에서 그 자식이나 입력 설정을 수정하지 않는다. 각 위치의 부모 관계는 나중에 Fiber가 표현한다. |

개인 README에 중첩 Element 예시와 입력 규칙을 기록했다. Node에서 `key` 생략·상속·명시적 `null`, 자식 생략·명시적 `undefined`, 동결한 입력, 함수 참조와 중첩 Element 재사용을 검증했다. [실행 예시](../../README.md) · [검증 지침](../../../CLAUDE.md#ai-검증-요청)

## 2. Fiber 트리 — 완료

Element 트리 하나를 받아 동기적으로 순회할 수 있는 작업 트리를 만든다. 루트 아래에서 `child`는 첫 자식, `sibling`은 다음 형제, `return`은 부모를 가리킨다. 문자열·숫자는 텍스트 작업으로 바꾸고, `null`·`undefined`·불리언은 화면에서 생략한다. 배열은 순서대로 순회한다. **완료 기준**은 중첩 요소, 두 형제, 숫자 0이 있는 트리를 DOM 없이 순회해 순서와 부모 관계를 확인하는 것이다. 같은 Element를 두 위치에 넣으면 서로 다른 Fiber가 생겨야 한다.

`npm run typecheck`와 `npm run build`를 통과했다. 빌드 결과를 Node에서 직접 실행해 부모·형제 링크, 공유 Element의 위치별 Fiber 생성, 함수 컴포넌트의 자식 입력 보존, 20,000단계 중첩과 순환 참조 처리를 확인했다. [작업 루프](../../src/fiber/workLoop.ts)

HostRoot 두 개는 `alternate`로 연결하며 `root.current`가 커밋된 쪽을 가리킨다. 자식 비교에서 재사용한 Fiber는 기존 DOM 참조를 이어받는다. `root.prepare()`에서 트리를 준비하고 `root.commit()`에서 DOM 변경을 적용한 다음 `current`를 바꾼다. [루트 구현](../../src/fiber/root.ts)

## 3. 최초 DOM 표시 — 완료

컨테이너와 Element를 입력받아 HTML 요소와 텍스트를 최초 표시한다. 이후 함수 컴포넌트도 이 렌더러를 사용한다. 팀 과제의 기존 DOM 읽기와 두 편집 영역은 별도 과제 범위다. [Phase 1 요구사항](../../../MISSION.md#phase-1-구현-체크리스트)

## 4. Reconcile과 Commit

**Reconcile**은 새 자식이 단일 Element이면 key가 처음 일치하는 형제를 찾아 타입을 비교한다. 배열이면 순차 비교하다가 key가 어긋난 지점부터 남은 이전 형제를 Map으로 조회한다. 새 자식 및 이전 위치가 `lastPlacedIndex`보다 작은 재사용 자식에 `Placement`를 표시한다. 제거할 이전 자식은 부모의 `deletions`에 담고 `ChildDeletion`을 표시한다. 호스트 작업을 완료할 때 속성이나 텍스트가 달라진 Fiber에 `Update`를 표시한다. 자식이 완료될 때마다 그 변경 비트를 부모의 `subtreeFlags`에 합친다. [자식 비교](../../src/fiber/childReconciler.ts) · [작업 루프](../../src/fiber/workLoop.ts) · [호스트 작업 완료](../../src/dom/completeWork.ts)

**완료 기준**은 삽입·삭제·교체·속성 갱신·텍스트 갱신 결과가 목표 화면과 같고, 두 형제 중 하나의 텍스트만 바꿀 때 다른 형제의 DOM 참조가 유지되는 것이다. 같은 입력을 연속 적용하면 DOM 변경은 0건이어야 한다. key 기반 재정렬은 호스트 노드와 여러 DOM 노드를 반환하는 함수 컴포넌트 양쪽에서 기존 노드 참조, 순서, 이동 실패 후 복구를 확인한다. [공용 검증 기준](../../../.claude/skills/verify/SKILL.md#체크리스트--phase-1)

**Commit**은 부모의 삭제를 먼저 적용하고, 변경이 있는 자손을 방문한 뒤 해당 Fiber의 삽입·갱신을 처리한다. DOM 반영이 끝나면 완성한 트리를 다음 `current`로 지정한다. 같은 입력으로 다시 렌더하면 커밋은 루트에서 순회를 끝낸다. [DOM 커밋](../../src/dom/commitWork.ts)

## 5. HostRoot 업데이트 큐와 스케줄러

`root.render(children): void`는 화면 갱신을 예약한다. 완료 Promise를 반환하지 않고 자식만 받으며, `runWithPriority`와 `startTransition`으로 우선순위를 지정한다. `prepare()`와 `commit()`은 동기 관찰용 API로 유지한다. 클릭·연속 입력·전환 등 [호출 문맥](../../src/fiber/updatePriority.ts)에서 lane을 선택한다. 루트의 화면 요청을 접수 순서로 큐에 넣고, 이번 렌더의 lane에 해당하는 요청을 적용한다. 건너뛴 요청은 기준 화면과 함께 보관하고 그 뒤 이미 처리한 요청은 `NoLane`으로 재적용한다. Sync는 마이크로태스크에서 처리하고, 전환·유휴 작업은 Fiber 사이에서 양보할 수 있다. DOM 커밋은 동기로 끝낸다. [우선순위와 큐 사용 예](../../README.md#hostroot의-업데이트-큐와-스케줄링) · [구현](../../src/fiber/updateQueue.ts)

**완료 기준**은 낮은 우선순위 A 다음 긴급 B가 도착했을 때 B가 먼저 커밋되고 A를 처리한 뒤에도 화면이 B인 것이다. 같은 lane의 여러 요청은 한 렌더에서 처리할 수 있어야 한다. 렌더 중 선점, 여러 루트의 예약, 커밋 실패 후 재시도에서도 요청 유실이 없어야 한다. 예약 호출 직후의 DOM을 완료 결과로 간주하지 않고 실제 DOM과 커밋된 `current`를 관찰한다.

## 6. 렌더 bailout

props 참조가 같고 해당 Fiber에 이번 lane의 작업이 없으면 컴포넌트 호출을 건너뛴다. 자손에 이번 lane의 작업이 남아 있으면 해당 가지를 방문한다. **완료 기준**은 같은 Element를 유지한 형제의 호출 수와 DOM 참조가 유지되고, 서로 다른 lane이 표시된 자손은 각자의 렌더에서 처리되는 것이다. `useState`의 setter는 상태를 소유한 함수 Fiber부터 조상까지 이 경로를 표시한다. [작업 루프](../../src/fiber/workLoop.ts) · [React의 bailout](https://github.com/facebook/react/blob/61aa00df822d0eb76d0362eb8b6fdd3527693efe/packages/react-reconciler/src/ReactFiberBeginWork.js#L3826-L3864)
