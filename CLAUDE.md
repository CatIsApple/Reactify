# Reactify 팀 작업 안내

세 명이 각자의 폴더와 영구 개인 브랜치에서 Phase 1(Virtual DOM · Diff · Patch)과 Phase 2(Component · State · Hooks) 전체를 독립적으로 구현합니다. 마지막에는 세 구현 중 하나를 선택합니다. 모듈별 분업이나 서로의 내부 코드 통합을 전제로 작업하지 않습니다.

과제 기준은 [MISSION.md](MISSION.md), 팀 정책은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따릅니다. 브랜치·커밋·push·PR 절차의 단일 기준은 [.claude/rules/git-workflow.md](.claude/rules/git-workflow.md)입니다. 루트 `README.md`는 Reactify 소개 문서이며, 구현 상태를 사실대로 표시합니다.

## 작업 범위와 구현 규칙

- 개인 작업은 사용자 요청이나 이미 확정된 작업 맥락의 `member-01`, `member-02`, `member-03`을 따릅니다. 대상이 없으면 먼저 묻고, `git status`나 현재 브랜치만으로 담당자를 추측하지 않습니다. 명시적으로 요청된 공용 문서·설정 작업은 `shared` 범위로 진행하며 개인 번호를 다시 묻지 않습니다.
- 코드·테스트·설정 변경과 테스트 실행은 해당 개인 폴더로 한정합니다. 다른 팀원의 파일을 덮어쓰지 않습니다. 공용 문서·설정 변경은 별도로 논의된 범위에서 수행합니다.
- 기본 하네스는 HTML, CSS, JavaScript ES Modules와 Node.js 22 이상을 사용합니다. TypeScript도 과제에서 허용하며, 도입하는 개인의 폴더 안에 도구와 사용법을 기록합니다. React, Vue 등 외부 UI 프레임워크는 사용하지 않습니다.
- 현재 개발 의존성은 테스트용 `jsdom`뿐이며, 다른 패키지를 추가하기 전에 사람에게 확인합니다. 개인 패키지와 lock 파일을 함께 관리합니다.
- 파일 이름, 함수 시그니처, VNode·patch 데이터 구조는 각자가 정합니다. 다른 팀원의 구현을 기준으로 API를 강요하지 않습니다.
- `FunctionComponent` 클래스에 `hooks`, `mount()`, `update()`를 구현합니다. **State와 모든 Hook은 루트 컴포넌트에서만 관리·사용**합니다. 자식은 props만 사용하는 순수 함수입니다.
- Phase 2 갱신은 본인의 Phase 1 Virtual DOM → Diff → Patch를 재사용합니다. Fiber는 기본 과제를 완성한 뒤 선택할 수 있는 확장입니다.

## 디렉터리

```text
CLAUDE.md                       공용 작업 안내
.claude/rules/git-workflow.md   공용 Git 작업 규칙
.claude/skills/verify/SKILL.md   공용 검증 절차
member-01/                      member-02, member-03도 동일한 시작 구조
  package.json / package-lock.json
  src/
    vdom/                       DOM ↔ Virtual DOM
    diff/                       두 Virtual DOM 비교
    patch/                      변경 사항만 DOM에 반영
    history/                    State History
    app/                        검증용 웹 페이지
  tests/
    setup.js                    jsdom 전역 설정
    helpers.js                  비교·불변성·변경 기록 도구
```

Phase 2용 컴포넌트·Hook 폴더는 각자 해당 단계에서 추가합니다. 현재 구현 코드, 데모 HTML과 `*.test.js`는 없습니다. 공용 verify 체크리스트는 Phase 1 중심이며, Phase 2 테스트 기준과 케이스는 해당 구현 단계에서 추가해야 합니다.

## AI 검증 요청

- 명시한 개인의 모듈 하나를 작은 단위로 구현하고, 저장소 루트 기준 `/verify member-01/src/diff`처럼 경로를 지정해 검증합니다.
- 대상이 확정되면 그 개인 폴더 안의 변경 내용만 확인합니다. 테스트는 `member-01/tests/`에 작성하며 다른 개인의 테스트를 함께 실행하지 않습니다.
- 현재 구현 결과에 맞추어 테스트 기대값을 바꾸거나, 실패한 테스트를 없애 통과시키지 않습니다.
- 검증할 구현이 아직 없으면 없는 범위를 보고합니다. 통과 수치를 만들기 위한 더미 테스트를 추가하지 않습니다.
- 핵심 로직은 사람이 설명할 수 있도록 작업 결과에 5줄 이내로 요약합니다. 요구사항이 모호하면 관련 질문을 먼저 확인합니다.

## 명령어

아래 명령은 **저장소 루트**에서 지정한 개인에게만 적용합니다. 번호는 확정된 담당 폴더로 바꿉니다.

```sh
npm --prefix member-01 ci
npm --prefix member-01 test
npm --prefix member-01 run dev
```

`npm test`는 해당 폴더의 `tests/setup.js`를 먼저 불러와 `tests/**/*.test.js`를 실행합니다. 아직 테스트 케이스가 없으므로 하네스 실행만으로 과제 검증이 끝나지는 않습니다.

개발 서버는 `npx --yes http-server`를 사용하여 필요하면 서버 패키지를 내려받습니다. 앱 작성 후 기본 주소는 `http://localhost:5173/src/app/`입니다. 같은 컴퓨터에서 동시에 실행할 경우 `member-02/`로 이동한 뒤 `npx --yes http-server -c-1 -p 5174 .`처럼 다른 포트를 지정합니다. 루트에는 `package.json`, 구현 `src/`, 테스트 `tests/`를 만들지 않습니다.
