# AI와 함께하는 Git 작업 규칙

이 문서를 브랜치·커밋·PR 절차의 단일 기준으로 사용합니다. 과제는 [MISSION.md](../../MISSION.md), 팀 정책은 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고합니다. 세 명은 각각 자기 폴더에서 Phase 1과 Phase 2 전체를 구현하고 마지막에 하나를 선택합니다. PR 승인은 최종 구현 선정과 별개입니다.

## 1. 대상과 요청 범위 확인

- 개인 작업은 사용자 요청이나 이미 확정된 맥락의 `member-01`, `member-02`, `member-03`을 따릅니다. 대상이 불분명하면 묻고, 현재 브랜치나 변경 파일만으로 담당자를 추측하지 않습니다.
- 공용 문서·설정 변경이 명시적으로 요청되었다면 `shared` 범위로 진행합니다. 개인 번호를 불필요하게 다시 묻지 않습니다.
- `커밋해줘`는 로컬 커밋까지입니다. `업로드해줘`·`PR 만들어줘`는 작업 브랜치 push와 PR 생성·갱신까지 포함합니다. 이미 승인된 범위는 재확인하지 않습니다.
- push나 PR 요청에서 `main` 병합 권한까지 추론하지 않습니다. 리뷰어는 사용자가 지정한 계정만 요청 대상으로 삼고, 신원을 임의로 정하거나 협업자를 초대하지 않습니다.
- 다른 팀원의 파일, 기존 사용자 변경과 스테이징 상태를 보존합니다. 이번 작업과 섞인 변경은 명확히 분리하거나 필요한 부분만 확인하며, 덮어쓰거나 임의로 보관·폐기하지 않습니다.

## 2. 작업 전 확인

아래 확인은 저장소 루트에서 수행합니다. 원격 이름·주소가 예상과 일치하는지 확인한 뒤 fetch합니다. 이 문서의 명령은 하나씩 실행하고, 실패하면 뒤 명령을 계속 실행하지 말고 원인을 확인합니다.

```sh
git rev-parse --show-toplevel
git status --short
git branch --show-current
git remote -v
git diff
git diff --cached
git fetch origin
```

- 브랜치 전환·병합 전에는 작업 트리가 깨끗해야 합니다. 변경이 있다면 현재 브랜치에서 작업 가능한지 검토하고, 사용자 변경을 임의로 커밋하거나 stash하지 않습니다.
- 이번 작업의 시작 상태와 변경 파일을 구분합니다. 기존 변경과 안전하게 분리할 수 없으면 필요한 선택만 묻습니다.
- `git add .`, `git add -A`, 강제 push, `reset --hard`, `clean`을 사용하지 않습니다. 이미 push한 커밋을 amend·rebase하여 이력을 바꾸지 않습니다.
- `main`에 직접 커밋·push하지 않습니다. 아래 작업 브랜치를 사용합니다.

## 3. 브랜치 선택과 최신 변경 반영

기본은 영구 개인 브랜치 `member-01`, `member-02`, `member-03`입니다. 아래는 **대상이 member-01로 확인된 경우의 예시**입니다. 다른 개인에게 그대로 적용하지 않습니다.

처음 가져올 때만 실행합니다. 이미 로컬 브랜치가 있으면 다음 블록을 사용합니다.

```sh
git switch --track origin/member-01
git merge origin/main
```

기존 개인 브랜치에서 새 작업을 시작할 때 실행합니다. 먼저 위 fetch를 완료합니다.

```sh
git switch member-01
git merge --ff-only origin/member-01
git merge origin/main
```

`--ff-only`가 분기된 이력 때문에 실패하면 다음 명령을 실행하지 않고 양쪽 커밋을 확인합니다. 안전한 통합 방법이 확인되면 원격 개인 브랜치를 일반 merge로 통합한 뒤 진행합니다. 충돌은 의도를 확인해 해결하며 이력을 버려 맞추지 않습니다. 다른 사람의 변경 의도가 불명확하면 그 부분을 확인합니다.

작업을 분리하기로 결정한 경우에만 최신 `origin/main`에서 임시 브랜치를 만듭니다.

| 범위 | 이름 예시 |
| --- | --- |
| 개인 작업 | `feat/member-01/vdom`, `fix/member-02/history`, `test/member-03/hooks` |
| 개인 문서 | `docs/member-01/usage` |
| 공용 문서·설정 | `docs/shared/git-workflow`, `chore/shared/tooling` |

예를 들어 공용 Git 문서 작업을 승인받았다면 `git switch --no-track -c docs/shared/git-workflow origin/main`을 사용합니다. 임시 브랜치의 upstream을 `origin/main`으로 설정하지 않으며, push 시 작업 브랜치로 지정합니다. 이미 그 이름의 브랜치가 있으면 내용을 확인하여 이어갑니다. `member-01/topic`은 기존 `member-01` 참조와 충돌하므로 만들지 않습니다. 모든 작업 PR의 대상은 `main`입니다.

## 4. 검증하고 커밋하기

- 커밋 하나에 논리적 변경 하나를 담습니다. 형식은 `type(scope): 설명`입니다.
- type: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. scope: `member-01`, `member-02`, `member-03`, `shared`.
- 예: `feat(member-01): DOM을 VNode로 변환`, `docs(shared): AI Git 작업 절차 추가`. 설명 언어는 기존 저장소 스타일에 맞춰 한국어 또는 영어로 일관되게 사용합니다.
- 변경에 맞는 실제 검증을 수행합니다. 개인 코드라면 해당 개인의 테스트를 실행하고 명령·결과를 기록합니다. 예: `npm --prefix member-01 test`.
- tests 0 / pass 0은 테스트 케이스가 없다는 뜻이며 기능 검증 통과가 아닙니다. 더미 테스트나 조작한 기대값으로 통과를 만들지 않습니다.
- 문서만 변경했다면 링크·경로·명령의 일관성과 diff를 확인합니다. 실행하지 않은 앱 테스트를 실행했다고 적지 않습니다.
- 이번 작업의 **정확한 파일 경로**만 `git add -- <파일 경로>`로 스테이징합니다. 같은 파일에 다른 변경이 섞였다면 필요한 부분만 분리하고, 이미 스테이징된 사용자 변경을 임의로 해제하지 않습니다.
- `git diff --cached --stat`, `git diff --cached`, `git diff --cached --check`로 범위와 내용을 확인합니다. 다른 변경이 포함되어 있으면 커밋하지 말고 분리합니다.
- 실제 변경에 맞춘 메시지로 `git commit -m "type(scope): 설명"`을 실행합니다. 위 문자열은 형식 예시이므로 그대로 사용하지 않습니다.

## 5. push와 PR 생성·갱신

업로드가 요청된 경우에만 진행합니다. 다음은 `member-01` 브랜치 예시이며 실제 작업 브랜치로 바꿉니다. `main`을 head로 사용하지 않습니다.

```sh
git push -u origin member-01
gh pr list --repo CatIsApple/Reactify --head member-01 --base main --state open
```

- 같은 head·base의 열린 PR이 있으면 새 PR을 만들지 않고 기존 PR을 갱신합니다. 최종 변경 범위에 맞춰 제목·본문도 수정합니다.
- PR 본문은 [.github/pull_request_template.md](../../.github/pull_request_template.md)를 따라 실제 줄바꿈이 있는 Markdown 임시 파일로 작성합니다. 자격 증명이나 로컬 비밀값은 포함하지 않습니다.
- 아래 `<실제 제목>`, `<본문 파일 경로>`, `<기존 PR 번호>`는 확인한 값으로 바꾸는 자리표시자입니다. 본문 파일을 먼저 작성하고 해당 분기 하나만 실행합니다.

```sh
gh pr create --repo CatIsApple/Reactify --base main --head member-01 --title "<실제 제목>" --body-file "<본문 파일 경로>"
```

기존 PR을 갱신할 때는 다음 명령을 사용합니다.

```sh
gh pr edit "<기존 PR 번호>" --repo CatIsApple/Reactify --title "<실제 제목>" --body-file "<본문 파일 경로>"
```

`gh`가 없으면 GitHub 웹 UI에서 같은 head·base의 PR 존재 여부를 확인하고 생성·수정합니다. push 권한이나 연결이 없으면 로컬 결과와 남은 단계를 보고하며 업로드 성공을 주장하지 않습니다.

## 6. 리뷰와 병합

- 작성자를 제외한 **Write 이상 권한의 서로 다른 사람 2명 이상**이 최신 변경을 승인해야 합니다. 세 명의 팀에서는 나머지 두 명 모두의 승인입니다.
- 코드가 바뀌면 이전 승인을 무효로 취급하고 재승인받습니다. 모든 리뷰 대화를 해결하고 실제 검증 결과를 확인합니다.
- AI가 만든 코드도 사람이 핵심 로직을 설명하고 검토할 수 있어야 합니다. AI는 승인 표를 만들거나 사람의 계정을 대신해 승인하지 않습니다.
- PR 작성 시 두 명 승인을 미리 체크하지 않습니다. GitHub의 실제 리뷰 상태를 확인하고, 체크리스트 자체를 승인으로 취급하지 않습니다.
- **현재 비공개 플랜에서는 필수 승인·오래된 승인 해제·대화 해결 보호 규칙이 자동 강제되지 않습니다.** 팀이 수동으로 확인합니다. 이를 우회하거나 공개 전환·유료 업그레이드를 임의로 진행하지 않습니다.
- 사용자에게 병합 요청을 받았고 위 조건이 충족된 경우에만 **Create a merge commit**으로 병합합니다. 승인 부족을 무시하거나 관리자 우회로 병합하지 않습니다.
- 저장소는 merge commit만 허용하며 Squash·Rebase 병합과 병합 후 브랜치 자동 삭제가 꺼져 있습니다. 영구 개인 브랜치는 삭제하지 않습니다.

## 7. 병합 후 개인 브랜치 동기화

병합 완료를 확인한 뒤 확정된 개인 브랜치에 최신 `main`을 반영합니다. 공용 문서 작업이라는 이유로 세 개인 브랜치를 모두 변경하지 않습니다. 동기화도 요청 범위 안에서만 진행합니다.

```sh
git fetch origin
git switch member-01
git merge --ff-only origin/member-01
git merge origin/main
git push origin member-01
```

위 예시에도 깨끗한 작업 트리와 실제 대상 확인이 필요합니다. 분기·충돌은 앞의 merge 절차로 처리하며 reset이나 강제 push로 맞추지 않습니다.

## 8. 결과 보고

작업 브랜치, 생성한 커밋 해시, PR 링크 또는 미생성 이유, 실제 검증 명령·결과, 남은 리뷰 상태를 간결하게 보고합니다. 로컬 커밋·원격 push·PR 생성·승인·병합을 각각 실제 완료 상태대로 구분합니다.

## 요청 예시

- “member-01의 VNode 변경을 확인하고 관련 테스트를 실행한 뒤 `feat(member-01)` 커밋만 만들어줘. 업로드는 하지 마.”
- “member-02의 history 수정을 개인 브랜치에서 검증하고 push한 뒤 main 대상 PR을 만들어줘. 열린 PR이 있으면 갱신하고 병합은 하지 마.”
- “공용 Git 작업 문서를 수정하고 `docs/shared/git-workflow` 브랜치에서 커밋·push·PR까지 만들어줘. 개인 구현 폴더는 변경하지 마.”
