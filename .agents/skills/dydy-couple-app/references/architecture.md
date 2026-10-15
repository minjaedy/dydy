# 구성과 수정 위치

2026-10-15 저장소와 로컬 원본을 확인한 기록이다. 버전과 설정은 작업 시 다시 확인한다.

## 배포 구성

| 역할 | 현재 연결 |
| --- | --- |
| GitHub 저장소 | https://github.com/minjaedy/dydy |
| 실제 앱 / GitHub Pages | https://minjaedy.github.io/dydy/ |
| Worker API | https://rabbit-guma-push.couple-private-push.workers.dev |
| 주요 Firebase 프로젝트 | `dydy-96bb1` |
| 흡연 Firebase 프로젝트 | `smoke-a9b2e` |
| Cloudflare D1 바인딩 / 이름 | `DB` / `rabbit-guma-push` |

프로젝트 이름과 공개 URL은 연결 식별자이며 인증 정보가 아니다. 다른 앱을 새로 만들 때는 별도 프로젝트·DB·키를 사용한다.

```text
설치된 PWA / 브라우저
  ├─ GitHub Pages: index.html, 이미지, manifest, service worker
  ├─ Firebase SDK: 인증 후 두 RTDB의 공유 앱 데이터
  └─ Cloudflare Worker
       ├─ D1: 패스키·세션·푸시 기기·채팅·중복 발송 기록
       ├─ 서버 자격 증명으로 두 RTDB 접근
       ├─ Web Push 전송
       └─ 매분 cron: 예약 알림, 채팅 발송, 보관 기간 정리
```

`cloudflare-push/wrangler.jsonc`가 Worker 이름, DB 바인딩, cron, 허용 출처의 현재 정본이다. `schema.sql`은 D1 테이블 정의다.

## 원본과 배포 파일이 분리되어 있다

기존 PC의 원본 폴더: `C:/Users/User/Desktop/Minjae/구안행토`.
Git 체크아웃: `C:/Users/User/.codex/tmp/dydy-upload`.

원본에는 여러 JS/HTML/CSS 모듈과 `build-couple-calendar.py`, `publish-github.py`가 있다. GitHub 체크아웃에는 배포용으로 합쳐진 `index.html`, 최적화한 `assets/`, PWA 파일, Worker 소스와 Firebase 규칙이 있다. **새로 clone한 저장소에 원본 모듈과 빌더가 모두 있다고 가정하지 않는다.**

원본의 `github-publish-status.json`은 체크아웃 위치를 찾는 데 쓰인다. 내부 commit/draftVersion 필드는 오래된 값일 수 있으므로 현재 Git HEAD나 배포 확인을 대신하지 못한다.

## 프런트엔드 원본 지도

| 수정 대상 | 로컬 원본 |
| --- | --- |
| 홈과 내비게이션 | `couple-home.*`, `couple-social.*`, `site-navigation.js` |
| 로그인·일 단위 인증 | `couple-auth.js`, `passkey-browser.js` |
| 캘린더·자주 쓰는 일정 | `couple-calendar.js/html/css` |
| 여행·체크리스트·정산 | `travel-planner.js/html/css` |
| 게임 화면·저장·홈 기록 | `couple-game.js/html/css`, `couple-game-home.html` |
| 피하기 / 탑 쌓기 계산 | `couple-game-engine.js` / `couple-tower-engine.js` |
| 월 보상·소원권 사용 | `couple-game-rewards.js`, `couple-reward-wallet.js` |
| 채팅·아이폰 키보드 배치 | `couple-chat.*`, `chat-composer-layout.js` |
| 앱 알림·설치·소리·반응 | `couple-push.js`, `couple-install.js`, `couple-sound.js`, `couple-reactions.*` |
| 유흥연차·흡연 결재 기존 상태 처리 | `index.html` 안의 레거시 스크립트와 `couple-approval.css` |

모든 기능이 독립 모듈로 추출된 것은 아니다. 특히 연차 실제 지급 함수 `__leaveGameReward`는 인라인 코드를 함께 확인한다. 화면 전환은 `SiteNav`와 `site-mode-change`, 각 패널 `#app-*`를 사용한다.

원본이 없는 환경에서는 인라인 `<!-- couple-calendar-…:start -->` / `end` 구간을 확인해서 필요한 부분만 수정할 수 있다. 이후 원본 빌더가 변경을 덮어쓰지 않도록, 원본이 다시 접근 가능해지면 같은 변경을 반영한다.

## 서버 소스 지도

- `worker.js`: HTTP 라우팅, Web Push, 즉시 동기화, 예약 작업, 발송 중복 방지.
- `auth.js`: 관리자 암호 검증, WebAuthn 패스키, 세션, `/auth/firebase`.
- `firebase-access.js`: 서비스 계정 OAuth와 Firebase 커스텀 토큰.
- `chat.js`: 메시지·사진·하트·보관함, 접속 상태, 채팅 알림, 보관 기간 정리.
- `calendar-cleanup.js`: 지난 연도 사용자 일정 정리.
- `app-retention.js`: 흡연 인증·여행·결재·기분·소원 사용 이력 정리.

PWA의 service worker는 현재 오프라인 안내와 제한된 아이콘을 캐시한다. Firebase와 API 전체를 오프라인 캐시에 넣는 구조가 아니다. iPhone에서는 설치·권한·브라우저의 플랫폼 제한을 고려한다. OS의 Face ID 안내를 앱 코드로 숨길 수 있다고 약속하거나 웹 진동이 반드시 작동한다고 가정하지 않는다.
