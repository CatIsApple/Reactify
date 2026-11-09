# Reactify v1

`feat/CatIsApple/v1`에서 [과제 필수 기능](../MISSION.md)을 구현합니다. 현재는 [TypeScript로 작성한 createElement](src/element/index.ts)로 `{ type, key, props }` 객체를 만들 수 있습니다. 첫 작업은 실제 DOM을 읽어 Virtual DOM 트리로 변환하는 것입니다.

Node.js 22 이상에서 이 폴더를 기준으로 실행합니다.

```sh
npm ci
npm run typecheck
npm run build
```

Fiber 렌더러를 이어서 개발하려면 `git switch feat/CatIsApple/v2`로 전환합니다.
