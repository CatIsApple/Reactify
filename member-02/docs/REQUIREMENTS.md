# 요구사항 추적표

| 과제 요구사항                      | 구현                                               | 검증                                |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------- |
| DOM → Virtual DOM                  | core/vnode.ts: domToVNode                          | vdom.test.ts round trip, live forms |
| 두 트리 Diff                       | core/diff.ts                                       | 5가지 변경·무변경·key 회귀          |
| 변경 부분 Patch                    | core/patch.ts                                      | DOM 객체 동일성, 120개 key 순서     |
| 실제/테스트 영역과 버튼            | index.html, lab/lab.ts                             | app.test.ts, E2E, 실제 브라우저     |
| 초기 실제 DOM을 읽고 테스트 렌더링 | setupLab 초기화                                    | app.test.ts                         |
| 자유로운 샘플 수정                 | HTML textarea, contenteditable                     | 직접 DOM mutation·폼 이력           |
| 상태 이력, undo/redo               | lab/history.ts                                     | 불변성·최대 개수·분기·무변경        |
| FunctionComponent 클래스           | core/fiber.ts                                      | mount, update, unmount, whenIdle    |
| hooks 배열                         | core/hooks.ts                                      | 슬롯 보존·lazy init·stable setter   |
| 루트만 Hook / 상태 관리            | GameBoard, Board, withHooks owner                  | 자식 Hook 거부 테스트               |
| 순수 함수형 자식                   | Card, TaskRow, ProgressCard                        | props 변경·key 이동                 |
| useState                           | 상태 큐·updater·Object.is                          | 상태 지속·배칭·동시 도착            |
| useEffect                          | deps·setup·cleanup                                 | commit 이후·unmount·후속 갱신       |
| useMemo                            | deps 캐시                                          | 불필요한 재계산 방지                |
| Phase 1·2 공통 VDOM/Diff/Patch     | core/index.ts 공유 엔진                            | 양 Phase 통합 테스트                |
| 클릭·입력에 따른 변화              | 카드 게임, HTML 실험실, 작업 보드                  | 브라우저·통합·E2E                   |
| Vanilla / 외부 프레임워크 금지     | 런타임 npm 의존성 없음                             | package.json, 정적 build            |
| Fiber 아키텍처                     | child/sibling/return/alternate, WIP, yield, commit | commit 전 DOM 불변·작업 재개        |
| 선택: Batching                     | 단일 예약 + updater 큐                             | 세 번 setter → 한 commit            |
| 학습·설명 가능한 코드              | README, ARCHITECTURE                               | 시연 흐름·차이점·한계 명시          |

## 테스트 계층

- **단위·통합·회귀**: `npm test`로 41개 테스트. DOM 환경은 jsdom이며 layout/paint나 브라우저 focus 동작을 대신 검증하지 않습니다.
- **브라우저 E2E**: `tests/e2e/app.spec.ts`에 4개 시나리오 × 데스크톱·모바일 Chromium. GitHub Actions가 실행합니다.
- **카드 게임 검증**: 실제 카드 DOM 보존, 짝 맞춤, 자동으로 다시 덮는 타이머, 검사기 탭과 커밋 이력을 확인합니다.
- **추가 실험 검증**: 텍스트 Patch, 이력 이동, key 재정렬, 작업 추가·검색·저장, +3 배칭, 키보드 Patch와 모바일 가로 넘침을 확인합니다.

## 해석상의 경계

- 5가지 핵심 케이스 외에 key 재정렬을 위한 MOVE를 제공합니다.
- 편집기 shell·로그·이력 목록은 일반 DOM으로 구성됩니다. 과제의 실제 영역과 Phase 2 컴포넌트 화면은 자체 렌더러를 사용합니다.
- HTML의 브라우저 자동 보정은 그대로 따릅니다. 실행 가능한 임의 HTML과 custom element 등은 제한합니다.
- 스냅샷에는 텍스트·attribute·폼 값이 포함되지만 selection, focus, 스크롤 위치, 임의 JS property는 저장하지 않습니다.
- event handler 함수는 JSON 이력으로 직렬화하지 않습니다. Phase 1의 HTML 스냅샷 이력과 Phase 2의 실행 중 Hook 상태는 분리되어 있습니다.
