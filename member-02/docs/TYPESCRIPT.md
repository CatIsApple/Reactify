# TypeScript 구성

JavaScript 구현을 TypeScript로 전환했습니다. 브라우저 진입점은 `src/main.ts`이며, 모든 엔진·화면·테스트 코드와 Vite/Playwright 설정도 `.ts` 파일입니다. CSS와 HTML은 그대로 각 역할을 담당합니다.

```text
member-02/
├── index.html
├── tsconfig.json
├── vite.config.ts
├── playwright.config.ts
├── src/
│   ├── main.ts
│   ├── style.css
│   ├── core/
│   │   ├── types.ts
│   │   ├── vnode.ts
│   │   ├── dom.ts
│   │   ├── diff.ts
│   │   ├── patch.ts
│   │   ├── fiber.ts
│   │   ├── hooks.ts
│   │   └── index.ts
│   ├── lab/          # HTML 실험실·이력·입력 제한
│   ├── demo/         # 카드 게임·렌더링 검사기·작업 보드
│   └── shared/       # 타입이 있는 DOM 유틸리티
└── tests/            # 단위·통합·회귀·E2E·타입 계약
```

## 컴파일과 실행

- `npm run typecheck`: `tsc --noEmit`으로 소스·테스트·설정을 검사합니다.
- `npm run dev`: Vite가 `.ts` 모듈을 JavaScript로 변환하여 제공합니다.
- `npm run build`: 타입 검사를 통과하면 정적 JavaScript/CSS/HTML을 `dist/`에 생성합니다.
- `npm run preview`: `dist/` 결과물을 로컬에서 확인합니다.
- `npm test`: tsx를 통해 TypeScript 테스트를 Node test runner로 실행합니다.

`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`를 적용했습니다. `verbatimModuleSyntax`로 타입 의존성을 `import type`으로 명시하며, 타입 검사와 실제 JavaScript 출력은 분리합니다. Vite의 타입 변환만으로 타입 검사를 대체하지 않습니다. [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html), [Vite TypeScript](https://vite.dev/guide/features.html#typescript)

브라우저의 DOM 구조와 Node.js 테스트 환경을 함께 검사하기 위해 DOM·DOM.Iterable·Node 타입을 포함합니다. Node.js는 22.12 이상을 사용합니다. [Vite 실행 환경](https://vite.dev/guide/)

## 핵심 타입

| 타입                                     | 보호하는 경계                                                  |
| ---------------------------------------- | -------------------------------------------------------------- |
| `VNode`, `Child`, `Component<P>`         | 트리의 기본 필드와 컴포넌트 props                              |
| `Fiber`                                  | child/sibling/return/alternate와 DOM·완료 출력의 nullable 상태 |
| `DiffPlan`                               | CREATE/REMOVE/REPLACE/TEXT/UPDATE/NONE별 필수 필드             |
| `PatchOperation`                         | 로그에 들어가는 연산 종류·경로·설명                            |
| `StateSetter<T>`, `StateAction<T>`       | 상태 값과 함수형 updater의 입력·반환 타입                      |
| `Hook`                                   | state/memo/effect 슬롯의 구분과 의존성·cleanup                 |
| `Scheduler`, `Deadline`, `CommitMetrics` | 작업 예약·시간 예산·관측 데이터                                |

`DiffPlan`과 `Hook`은 식별 필드를 가진 유니온입니다. 예를 들어 CREATE에는 `next`가 필요하고 REMOVE에는 `previous`가 필요합니다. 분기 안에서는 TypeScript가 해당 필드를 자동으로 좁힙니다.

`useState(0)`은 숫자 상태로 추론됩니다. `useState<Task[]>([])`처럼 빈 배열이나 유니온 상태에는 타입을 직접 지정할 수 있습니다. `h(TaskRow, props)`는 자식이 요구하는 props를 검사합니다.

Hook 배열은 여러 타입의 상태를 같은 배열에 저장해야 하므로 내부 슬롯 값은 `unknown`으로 저장합니다. 공개 `useState<T>`와 `useMemo<T>` 경계에서 해당 타입을 복원합니다. 컴포넌트 트리도 여러 props 타입을 함께 저장하므로 `h()`에서 검사한 뒤 Fiber의 호출 경계에서 타입을 복원합니다. 전체 코드에 `any`, `@ts-ignore`, `@ts-nocheck`를 붙여 검사를 생략하지 않습니다.

DOM은 null일 수 있는 조회 결과를 `mustQuery()`로 확인합니다. 폼 입력은 이벤트의 `currentTarget`을 확인하여 읽습니다. localStorage에서 읽은 JSON은 `unknown`으로 취급하고 `isTask()`로 구조를 검사합니다. TypeScript 타입은 런타임에 사라지므로 외부 입력의 실행 중 검증도 필요합니다.

## 검증

기존 41개 테스트를 `.test.ts`로 옮겨 동일한 동작을 검사합니다. `tests/type-contracts.ts`는 실행되지 않는 컴파일 전용 파일입니다. 일부러 잘못된 사용 예에 `@ts-expect-error`를 붙였으며, 타입 검사가 해당 오류를 잡지 못하게 되면 오히려 검사에 실패합니다.

이 폴더에서 `npm run check`로 타입 검사, TypeScript 테스트와 정적 빌드를 실행합니다. `npm run test:e2e`로 데스크톱과 모바일 Chromium 프로필을 검증합니다. `CI` 환경 변수를 설정하면 Playwright는 `npm run preview`로 정적 빌드 결과물을 확인합니다.
