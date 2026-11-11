# member-03

이 폴더에서 Phase 1과 Phase 2 전체를 독립적으로 구현합니다. 공통 요구사항은 [MISSION.md](../MISSION.md), 협업 규칙은 [CONTRIBUTING.md](../CONTRIBUTING.md)를 확인합니다.

## 작업 정보

- 담당자 : 이강현 / 페이지 주제: 작성 예정
- 기본 환경: JavaScript ES Modules, Node.js 22 이상, npm, 테스트용 jsdom
- TypeScript를 선택하면 필요한 개인 개발 환경과 사용법을 이 폴더에 기록합니다.

## 구조와 현재 상태

- `src/vdom/`, `diff/`, `patch/`, `history/`, `app/`: 구현을 시작할 빈 폴더
- `tests/setup.js`: DOM 테스트를 위한 jsdom 전역 설정
- `tests/helpers.js`: DOM 비교·불변성·변경 기록 등의 검증 도구
- `package.json`, `package-lock.json`: 개인별 설치·실행 설정
- 구현 코드, 데모 HTML, `*.test.js` 테스트 케이스는 아직 없습니다. 하네스가 있다는 사실은 기능 테스트 통과를 뜻하지 않습니다.

## 설치·실행·테스트

저장소 루트에서 아래 폴더로 이동한 뒤 실행합니다.

```sh
cd member-03
npm ci
npm test
npm run dev
```

`npm test`는 `tests/setup.js`를 먼저 불러오고 `tests/**/*.test.js`를 실행합니다. 아직 테스트 케이스가 없으므로 과제 구현 검증은 이후 작성할 테스트로 진행합니다.

`npm run dev`는 `npx --yes http-server`를 사용하며 최초 실행 시 서버 패키지를 내려받을 수 있습니다. 앱을 작성한 뒤 [개발 화면](http://localhost:5173/src/app/)에서 확인합니다. 현재는 데모 HTML이 없어 완성된 화면이 제공되지 않습니다. 같은 컴퓨터에서 여러 서버를 켤 때는 해당 개인 폴더에서 `npx --yes http-server -c-1 -p 5176 .`처럼 다른 포트를 지정해 실행합니다.

AI 검증을 요청할 때는 저장소 루트 기준 `/verify member-03/src/diff`처럼 담당 폴더를 명시합니다. 공용 안내는 [CLAUDE.md](../CLAUDE.md), 검증 절차는 [verify 스킬](../.claude/skills/verify/SKILL.md)을 확인합니다.

## 진행 상황 및 구현 기록

- [ ] Phase 1: Virtual DOM · Diff · Patch · State History
- [ ] Phase 2: FunctionComponent · useState · useEffect · useMemo
- [ ] 입력·클릭에 반응하는 데모와 단위·기능 테스트
- [ ] 핵심 로직 설명과 실제 React와의 차이 정리
- 핵심 설계 / 실제 실행한 테스트 결과 / 알려진 제한: 구현 후 작성

## 작업 기록 (시간순)

새 작업을 할 때마다 아래에 날짜·시각과 변경 내용을 이어서 적습니다.

### 2026-11-07 21:45 — domToVNode
- `src/vdom/vdom_create.js`: 실제 DOM을 VNode(`{ type, props, children }`, 글자는 문자열)로 변환하는 `domToVNode` 작성. 공백만 있는 텍스트와 주석은 제외.

### 2026-11-09 10:52 — vnodeToDom
- `src/vdom/vdom_create.js`: VNode를 새 실제 DOM 요소로 만드는 `vnodeToDom` 추가. 기존 DOM은 건드리지 않고 diff도 하지 않음.

### 2026-11-09 17:15 — 페이지 뼈대
- `src/app/index.html`: 실제 영역(`#real-area`), 테스트 영역(`#test-area`, contenteditable), Patch·뒤로가기·앞으로가기 버튼(동작 미연결).
- `src/app/main.js`: 로드 시 실제 영역을 VNode로 변환해 테스트 영역에 렌더링.
- `src/vdom/vdom_create.js`: 두 함수를 `export`하고 최상위 실행 코드를 제거(import 가능하게).

### 2026-11-09 17:19 — diff
- `src/diff/diff.js`: `diff(oldVNode, newVNode)` 추가. DOM 없이 patch 배열 반환(`REPLACE`, `TEXT`, `PROPS`, `CREATE`, `REMOVE`). `REMOVE`는 인덱스 내림차순. key 비교는 하지 않음.
- `tests/diff.test.js`: Vitest 형식 테스트 8개 작성. Vitest 미설치로 Vitest 실행은 안 함(임시 스크립트로 8개 통과 확인).

### 2026-11-11 15:00 — useEffect
- `src/hooks/current_component.js`: 현재 렌더 중인 컴포넌트 추적(`setCurrentComponent`, `getCurrentComponent`)을 `use_state.js`에서 분리해 두 훅이 공유(순환 import 없음).
- `src/hooks/use_effect.js`: `useEffect(effect, deps)` 추가. 렌더 중에는 예약만 하고 DOM 반영 뒤에 실행. 실행 전에 이전 cleanup 먼저 호출.
- `src/component/function_component.js`: `pendingEffects`, `runEffects()`, `unmount()` 추가. `mount()`/`update()`가 DOM 반영 직후 effect를 동기로 실행(실제 React는 페인트 뒤 비동기).
- `tests/use_effect.test.js`: 테스트 10개 작성.

### 2026-11-11 15:09 — useMemo
- `src/hooks/deps.js`: deps 비교 `depsChanged`를 `useEffect`와 `useMemo`가 같이 쓰도록 분리(동작은 그대로).
- `src/hooks/use_memo.js`: `useMemo(factory, deps)` 추가. 렌더 중 즉시 계산하고 deps가 같으면 이전 값을 그대로 반환. factory가 예외를 던지면 캐시하지 않음.
- `src/patch/patch.js`로 옮긴 뒤 옛 경로를 쓰던 import 4곳(`main.js`, `function_component.js`, `history.test.js`, `patch.test.js`)을 새 경로로 수정.
- `tests/use_memo.test.js`: 테스트 9개 작성.

### 2026-11-11 15:18 — 이벤트(onClick 등)와 props 적용
- `src/vdom/props.js`: `setProp`/`removeProp` 추가. `onClick`처럼 `on`+대문자이고 값이 함수이면 이벤트로 처리(요소마다 핸들러 저장소를 두고 리스너는 이름마다 한 번만 등록해 patch를 반복해도 중복 실행되지 않음). 문자열 `onclick="..."`은 보안상 무시.
- `value`, `checked`는 attribute가 아닌 DOM 프로퍼티로 설정. `false`/`null`/`undefined`는 속성 제거, `true`는 빈 문자열 attribute.
- `src/vdom/vdom_create.js`의 `vnodeToDom`과 `src/patch/patch.js`의 `PROPS` 처리가 `props.js`를 같이 사용(중복 제거). `vnodeToDom`은 `<select value>`가 먹히도록 자식을 먼저 붙인 뒤 props를 적용.
- `tests/events.test.js`: 테스트 9개 작성.

### 2026-11-11 15:19 — Todo 앱 (세 훅 사용)
- `src/app/todo.html`, `todo_main.js`, `todo_app.js`: 할 일 목록 앱 추가. 상태와 훅은 루트 `App`에서만 쓰고 자식(`Header`, `TodoForm`, `Filters`, `TodoItem`, `TodoList`, `Stats`)은 props만 받는 순수 함수.
- `useState`(할 일·입력창·필터·다음 id·경과 시간), `useMemo`(남은 개수·필터된 목록), `useEffect`(`document.title` 갱신, `setInterval` 시계와 cleanup).
- `src/vdom/props.js`: `value`가 이미 같으면 다시 대입하지 않도록 수정(입력 중 커서 보존).
- `tests/todo.test.js`: 테스트 9개 작성.

### 2026-11-11 20:14 — 카드 뒤집기 데모와 "DOM 보기" 패널
- `tests/game_test/` 폴더 안에서만 작업: `index.html`, `game.css`, `game_logic.js`, `game_app.js`, `inspector.js`, `game_main.js`, `game.test.js`.
- 메모리 카드 매칭 게임(4x4, 이모지 8쌍). 두 장이 다르면 `useEffect` + `setTimeout` + cleanup으로 800ms 뒤 되돌림.
- `FunctionComponent`를 상속해 `update()`만 재정의하여 diff 결과를 가로채고, 패치된 실제 DOM 요소를 600ms 동안 하이라이트.

### 2026-11-11 20:44 — "DOM 보기" 패널 상세화
- `tests/game_test/game_main.js`, `inspector.js`, `game_app.js`, `game.css`: 패널을 업데이트 기록 선택, 한눈에 보기, 단계별 과정(setState→render→diff→patch→effect), 패치 카드(위치 설명과 이전→새 값), State(hooks 배열 표, 바뀐 칸 강조), VNode 트리 순으로 개편.
- `tests/game_test/game.test.js`: 상세 보기용 테스트 5개 추가(총 17개).

### 검증 메모 (2026-11-11)
- 실행한 검증: Vitest가 설치되어 있지 않아 임시 러너(`describe`/`test`/`expect`를 흉내 내는 스크립트)로 전체 테스트 파일을 실행해 모두 통과를 확인. Vitest로는 실행하지 못했고, `npm test`는 `vitest` import 때문에 실패함.
- 알려진 제한: diff는 key 없이 index로 비교, 핸들러는 렌더마다 새 함수라 `PROPS` 패치가 매번 생김, batching 없음, effect는 동기 실행.
