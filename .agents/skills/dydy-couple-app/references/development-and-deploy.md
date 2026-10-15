# 수정·연결·배포 절차

## 먼저 현재 상태 확인

```powershell
git status --short
git log -3 --oneline
git remote -v
```

기존 PC 원본과 Git 체크아웃은 [architecture.md](architecture.md)를 참고하되 현재 파일 유무를 먼저 확인한다. `scripts/` 등 기존 untracked 파일을 자동으로 포함하지 않는다. 원본을 다른 위치에서 복구할 때 `github-publish-status.json`의 checkout 경로를 실제 Git 작업 경로에 맞춘다. 원본이 없으면 존재하지 않는 빌더 명령을 실행하지 말고 배포 HTML의 해당 marker 구간을 좁게 수정한다.

## 프런트엔드

원본 폴더에서:

```powershell
python build-couple-calendar.py --preview
python publish-github.py
```

첫 명령은 원본 모듈을 **source의 index.html에 실제로 합치고**, 선택적으로 오프라인 미리보기도 만든다. `--preview`가 원본 변경을 생략하는 옵션은 아니다. 두 번째 명령은 설정된 Git 체크아웃의 HTML·이미지·manifest를 준비하고 PNG 등을 최적화한다. **둘 다 Git push는 하지 않는다.**

버전은 원본 HTML의 `app-version`, 빌더의 버전 문자열, 배포 `asset-manifest.json`에 맞춘다. HTML만 바꾸고 빌더 버전을 그대로 두면 다음 빌드에서 버전이 되돌아갈 수 있다. 직접 부분 합치기를 했다면 원본 모듈도 갱신하고 다음 빌드로 유실되지 않게 한다.

기존 로컬 미리보기 루트는 `C:/Users/User/.codex/tmp/couple-calendar-preview`, GitHub 형태의 하위 경로는 `/github/`다. 예시:

```powershell
python -m http.server 8766 --bind 127.0.0.1 --directory <preview-directory>
```

`127.0.0.1`은 그 컴퓨터 안에서만 열린다. 폰 확인이 필요하면 테스트 HTML만 GitHub Pages에 게시하는 방식이 이 프로젝트에서 사용됐다. `tower-game-preview.html`이 그 예다. 테스트 파일은 Firebase SDK/초기 연결 제거, `data-preview="true"`, 분리된 localStorage 및 테스트용 인증 흐름을 사용한다. 실제 사용자 데이터·푸시·잔액에 연결하지 않는다. 테스트 인증 우회는 이 파일에만 있어야 한다.

원본이 있으면 변경에 맞는 검증을 선택한다:

- `node check-chat-bundle.cjs`: 합쳐진 인라인 JS 파싱.
- `node check-tower.cjs`: 탑 동작, 보상 한도, 붕괴 중 기록 고정.
- `node check-home-dual-game.cjs`: 두 사람의 점수/높이와 독립적인 기록 표시.
- `node check-firebase-auth.cjs`: 두 Firebase 인증 후 online, 잠금 시 해제.
- `node check-chat-viewport.cjs`: 아이폰 키보드와 입력창 회귀 확인이 필요한 경우.

이 검증 파일들도 기본 clone에는 없을 수 있다. 실제 변경의 동작을 검증하는 방법을 택한다. 난이도 시뮬레이션은 비교 기준과 입력 오차 모델을 명시하며 사람의 성공률로 단정하지 않는다.

## GitHub에 게시

사용자가 미리보기만 요청했으면 테스트 파일만, 실제 적용을 요청했으면 배포 `index.html`과 관련 파일만 스테이징한다. 예:

```powershell
git diff --check
git diff --stat
git add index.html asset-manifest.json
git commit -m "Describe the actual change"
git push origin main
gh run list --limit 3 --json databaseId,status,headSha,conclusion
gh run watch <matching-run-id> --interval 10 --exit-status
```

예시 파일 목록은 작업에 맞게 바꾼다. 새 이미지·Worker·스킬 파일이 있으면 명시적으로 추가한다. `git add .`로 개인 키·백업·관계없는 로컬 스크립트를 포함하지 않는다. 관찰 시 저장소에는 별도 workflow 파일 없이 Pages의 `pages-build-deployment` 실행이 생성됐다. 현재 설정을 우선 확인한다.

push 직후 run 목록에는 이전 커밋 실행이 보일 수 있다. 반드시 이번 HEAD SHA에 해당하는 실행을 확인한다. 이후 실제 URL에서 새 `app-version`·변경 내용·필요한 이미지 응답을 확인한다. 캐시 확인에는 버전 query를 사용할 수 있다. 새 PR을 만들었다면 앱의 PR attachment 기능이 사용 가능한 환경에서 해당 PR을 첨부한다.

## Cloudflare 변경이 있는 경우

GitHub push만으로 Worker는 배포되지 않는다. `cloudflare-push` 디렉터리에서 잠금 파일을 유지해 의존성을 설치하고 검사한다.

```powershell
npm ci
npm test
npm run build
```

`npm run build`는 현재 패키지에서 `wrangler deploy --dry-run`이다. 실제 배포 요청을 받은 경우에만 이어서:

```powershell
npx wrangler whoami
npx wrangler deploy
```

프로젝트 디렉터리 안의 고정된 Wrangler를 사용한다. 인증이 필요하면 공식 로그인과 사용자 승인 흐름으로 연결한다. 비밀값을 출력하거나 새 VAPID 키로 기존 키를 덮어쓰지 않는다. `APP_ORIGIN`, `APP_URL`, D1 바인딩을 실제 환경에 맞추되 변경 영향을 먼저 검토한다.

상태 확인은 Worker `/health` 응답을 사용한다. 이 경로는 D1과 Firebase 읽기를 확인하지만 실제 아이폰 알림 도착까지 증명하지는 않는다. 디바이스 테스트 알림 전송은 사용자가 요청한 때에만 수행한다.

D1 `schema.sql`의 `CREATE TABLE IF NOT EXISTS`만으로 기존 테이블 열은 추가되지 않는다. 예를 들어 `deliveries.created_at`은 과거 별도 migration으로 추가됐다. 원격 DB에 schema나 ALTER를 반복 실행하지 말고 현재 구조를 확인한 후 필요한 일회성 migration만 수행한다. 이 스킬 저장 요청 자체는 DB migration이나 정리 실행의 승인이 아니다.

## Firebase 연결 또는 규칙 변경이 필요한 경우

기존 두 프로젝트를 새 프로젝트로 교체하지 않는다. 새 환경 복구라면 프로젝트의 Firebase Authentication 활성화, 서버 서비스 계정 자격 증명, Worker 토큰 발급, 브라우저 두 앱 로그인 연결을 준비한다. 기존 환경에서는 이를 매번 재생성하지 않는다.

규칙 강화 시 순서:

1. 인증을 지원하는 Worker와 클라이언트를 먼저 준비·검증한다.
2. 두 프로젝트에서 커스텀 토큰 로그인이 되는지 확인한다.
3. 저장소 `firebase-security/*.rules.json`의 대상 프로젝트·경로를 확인한 후 해당 규칙을 게시한다.
4. 익명 읽기/쓰기 거부, 두 사용자 접근, 무관한 UID·만료 세션 거부, 서버 알림/정리 접근을 확인한다.

서비스 계정으로 접근하는 서버와 사용자 토큰으로 접근하는 브라우저를 따로 검사한다. 규칙 배포는 Firebase 전용 배포 구성/관리 API 등 실제 사용할 수 있는 방법을 택하고, 배포 파일이 없는 상태에서 `firebase deploy`가 자동으로 올바른 DB를 고른다고 가정하지 않는다. 문제를 고치려고 일시적으로 공개 규칙을 배포하지 않는다.

## 배지 검증

배지 관련 변경은 Git 체크아웃에서 `node tests/app-badges.cjs`와 `node tests/app-badge-client.cjs`로 확인한다. Service Worker의 저장·중복 방지·알림 클릭/읽음·권한 실패, 클라이언트의 로그인/가시성 조건을 검사한다. OS 아이콘 자체의 실제 표시는 설치된 기기에서 별도로 확인한다. 서버 Worker 재배포나 비밀키 변경은 배지 코드만 바꿀 때 필요하지 않다.

## 설치 앱 식별자와 아이콘

DYDY의 manifest `id`는 `/dydy/`로 고정한다. 같은 GitHub Pages 도메인의 TEMPO는 `/cale/`, MIXROOM은 `/mixroom/`다. `id: "./"`는 origin 기준으로 루트 ID가 되어 서로 충돌하므로 사용하지 않는다. `start_url`/`scope`는 manifest 기준 상대 경로이고 id와 해석 기준이 다르다. ID는 아이콘/이름/배포 버전 때문에 다시 바꾸지 않는다.

원본 `pwa-head.html`은 정적 favicon/Apple 아이콘 선언의 정본이다. 원본 index, manifest, app-sw, offline 페이지와 배포 파일을 함께 맞춘다. 32–1024px 투명 PNG와 별도의 180/512/1024px 불투명 maskable PNG를 사용하며 알림 아이콘도 버전 URL을 갱신한다. 자세한 이전/설치 안내는 저장소 `INSTALLATION.md`를 참고한다. `node tests/app-install.cjs`와 기존 배지 테스트를 실행한다. 웹 코드 검증을 실제 Mac Dock/Windows/iPhone 설치 화면 검증으로 표현하지 않는다.
