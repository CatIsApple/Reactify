# member-01

이 폴더에서 Phase 1과 Phase 2 전체를 독립적으로 구현합니다. 공통 요구사항은 [MISSION.md](../MISSION.md), 협업 규칙은 [CONTRIBUTING.md](../CONTRIBUTING.md)를 확인합니다.

## 작업 정보

- 담당자 / 페이지 주제: 작성 예정
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
cd member-01
npm ci
npm test
npm run dev
```

`npm test`는 `tests/setup.js`를 먼저 불러오고 `tests/**/*.test.js`를 실행합니다. 아직 테스트 케이스가 없으므로 과제 구현 검증은 이후 작성할 테스트로 진행합니다.

`npm run dev`는 `npx --yes http-server`를 사용하며 최초 실행 시 서버 패키지를 내려받을 수 있습니다. 앱을 작성한 뒤 [개발 화면](http://localhost:5173/src/app/)에서 확인합니다. 현재는 데모 HTML이 없어 완성된 화면이 제공되지 않습니다. 같은 컴퓨터에서 여러 서버를 켤 때는 해당 개인 폴더에서 `npx --yes http-server -c-1 -p 5174 .`처럼 다른 포트를 지정해 실행합니다.

AI 검증을 요청할 때는 저장소 루트 기준 `/verify member-01/src/diff`처럼 담당 폴더를 명시합니다. 공용 안내는 [CLAUDE.md](../CLAUDE.md), 검증 절차는 [verify 스킬](../.claude/skills/verify/SKILL.md)을 확인합니다.

## 진행 상황 및 구현 기록

- [ ] Phase 1: Virtual DOM · Diff · Patch · State History
- [ ] Phase 2: FunctionComponent · useState · useEffect · useMemo
- [ ] 입력·클릭에 반응하는 데모와 단위·기능 테스트
- [ ] 핵심 로직 설명과 실제 React와의 차이 정리
- 핵심 설계 / 실제 실행한 테스트 결과 / 알려진 제한: 구현 후 작성
