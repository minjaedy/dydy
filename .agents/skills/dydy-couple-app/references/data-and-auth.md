# Firebase, 인증, 데이터 수명

## Firebase RTDB 연결

| 프로젝트 | RTDB URL | 주요 경로 |
| --- | --- | --- |
| `dydy-96bb1` | `https://dydy-96bb1-default-rtdb.firebaseio.com` | `leave_app_v2`, `couple_calendar_v1`, `couple_home_v1`, `couple_travel_v1` |
| `smoke-a9b2e` | `https://smoke-a9b2e-default-rtdb.firebaseio.com` | `smoke_app_v1` |

기본 Firebase 앱과 이름 있는 `smokeApp`을 사용한다. SDK 프로젝트 설정은 배포 HTML을 확인한다. Firebase 웹 설정의 API key와 프로젝트 ID는 서버 서비스 계정 개인키와 다르다. 공개 웹 설정만으로 접근을 허용하는 구조를 만들지 않는다.

- 캘린더 `events`와 자주 쓰는 일정 `templates`는 별도 하위 경로다.
- 홈의 `gameScores`는 피하기 최고 점수다. `towerHeights`는 탑 최고 높이(m)다.
- `couple_home_v1/gameRewards/sweet`는 구마 소원권 지갑이다.
- 연차 상태의 `miniGameRewards`, `miniGameRewardBank/Total/Issued`를 함께 보존한다.
- 여행은 `couple_travel_v1/trips` 아래에 정산·체크리스트와 함께 저장된다.

## 인증 흐름

1. 사용자가 토끼 또는 구마를 고른다. Worker가 관리자 암호 또는 등록된 패스키를 검증한다.
2. Worker 세션은 한국 날짜 기준 다음 자정까지 유효하며, 같은 날 재입장에 재사용할 수 있다. 세션 확인을 생략한 무기한 자동 로그인으로 바꾸지 않는다.
3. 유효한 본인 세션으로 `POST /auth/firebase`를 호출해 두 프로젝트의 커스텀 토큰을 받는다.
4. 두 Firebase 앱 모두 `Persistence.NONE` 및 `signInWithCustomToken`에 성공한 뒤 DB를 online으로 바꾼다.
5. 잠금·사용자 변경 시 두 DB를 offline으로 바꾸고 로그아웃한다.

Firebase UID는 `couple-rabbit` / `couple-sweet`, 토큰 claim은 `couple_owner`, 만료 시각(ms) `session_until`이다. 규칙은 루트 기본 거부이며 허용된 경로에서도 UID와 `session_until > now`를 검사한다. 규칙 파일은 저장소 `firebase-security/`에 있다. 두 사용자는 커플 공유 데이터에 접근하는 구조이며, 모든 게임·결재 무결성을 서버에서 강제하는 별도 검증 시스템으로 과장하지 않는다.

Worker는 서비스 계정 자격 증명으로 RTDB에 접근하고 커스텀 토큰을 발급한다. `firebaseFetch`는 두 RTDB 호스트만 허용한다. 테스트 환경의 자격 증명 없는 fetch 분기를 운영 인증 방식으로 사용하지 않는다.

## Worker 설정과 비밀 정보

`APP_ORIGIN`은 `https://minjaedy.github.io`처럼 origin만 넣고, `APP_URL`은 `https://minjaedy.github.io/dydy/`처럼 앱 경로를 포함한다. WebAuthn RP ID는 origin의 호스트다. 도메인 변경은 패스키와 푸시 구독에 영향을 주므로 단순 URL 치환으로 끝내지 않는다.

Worker에서 사용하는 주요 비밀/키 이름:

- `FIREBASE_DYDY_ACCOUNT`, `FIREBASE_SMOKE_ACCOUNT`: 프로젝트별 서비스 계정 JSON.
- `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`: 기존 푸시 구독과 연결된 키 쌍.
- `RABBIT_PAIR_HASH`, `SWEET_PAIR_HASH`: 기기 연결 코드의 해시.

이 문서는 **이름만** 기록한다. 서비스 계정 JSON·개인키·암호·페어링 코드·로그인 토큰·실제 DB 백업은 스킬, Git, 화면 출력에 넣지 않는다. 배포를 위해 기존 비밀키를 재발급하지 않는다. 계정 로그인/연결이 없으면 사용자에게 해당 인증 단계만 요청하고 비밀번호나 토큰을 채팅으로 받지 않는다.

기기 등록의 `/pair`·`/subscription` 토큰은 사용자 로그인 세션과 별개다. Web Push 실패를 Firebase 로그인 성공만으로 해결됐다고 판정하지 않는다.

## D1과 알림

D1에는 `devices`, `deliveries`, `meta`, `pairing_attempts`, `passkeys`, `auth_sessions`, `auth_challenges`, `chat_messages`, `chat_photos`, `chat_reads`, `chat_presence`, `chat_hearts`가 있다.

결재·일정 등록은 클라이언트의 즉시 `/sync`와 서버 스캔을 사용한다. 예약 작업은 매분 실행된다. 채팅은 로그인 세션으로 접근하고, 서버 접속 상태를 이용해 보고 있는 상대의 중복 푸시를 줄인다. 실제 라우트/대상/예약 시각은 `worker.js`와 `chat.js`에서 확인한다. 앱을 닫아도 동작하는지 서버 쪽 발송과 디바이스 표시를 구분해 검증한다.

## 보관 정책

현재 구현은 데이터를 한꺼번에 초기화하지 않는다.

| 대상 | 정리 기준 |
| --- | --- |
| 흡연 요청과 내장 인증 사진 | 제출 후 7일 |
| 여행과 하위 정산·준비물·장소 | 등록 후 30일; 오래된 무시각 데이터는 마이그레이션 시작 시각 사용 |
| 사용자 캘린더 일정 | 일정의 연도가 한국 현재 연도보다 과거인 경우; 자동 공휴일·기본 기념일 제외 |
| 일반 채팅·첨부 | 30일; 보관한 메시지는 예외 |
| 기분, 결재 이력, 완료된 연차 요청 | 30일; 대기 요청·미래 승인 외출은 보존 |
| 소원권 사용 상세 이력 | 30일 후 `archivedUses`로 합산; 잔액·누적 사용량 유지 |
| 성공·실패 푸시 발송 기록 | 7일; 미발송 행은 `created_at` 기준 |
| 영속 설정·잔액·누적 포상·패스키·기기 | 일반 정리 대상 아님 |

고정 기념일, 이벤트 템플릿, 앱 코드 전체에 만료를 부여하지 않는다. 보관 채팅 상한은 현재 1,000개, 채팅 사진 총량 제한은 코드의 100,000,000바이트 기준이다. 서버 cron의 정리와 클라이언트 표시 숨김은 다르다. Firebase 정리는 ETag 비교 후 조건부 쓰기를 하므로 동시 편집을 덮어쓰지 않는다. 412 충돌은 실패 처리 후 다음 실행에서 다시 시도한다.

## 게임 보상과 지갑 단위

- 피하기: 토끼 3,000점 초과, 구마 3,500점 이상.
- 탑 쌓기: 한 층 10m, 토끼 450m 이상, 구마 500m 이상.
- 각 게임별 월 1회. 토끼는 회당 연차 0.1일, 구마는 소원권 0.25장. 월 합계는 각각 0.2일, 0.5장이다.
- 연차 1일이 모이면 실제 연차 잔액에 자동 지급한다. 소원권 1장이 모이면 흡연 화면에서 사용한다.
- 구마 `halfTickets`는 **반 장 단위**다. 0.25장 지급은 이 필드에 **0.5를 더한다**. 정수만 허용하면 0.25장 적립이 사라진다. 표시 단위와 저장 단위를 혼동하지 않는다.
- 소원권 잔여 = `floor(halfTickets / 2) - 최근 uses 개수`, 진행도 = `(halfTickets % 2) / 2`. `archivedUses`는 누적 사용·획득 표시에 반영한다.
- 분할 전 이미 받은 월 보상과 기존 잔액을 보존한다. 게임별 청구와 전체 월 한도를 같은 트랜잭션 안에서 확인한다.

장기 사용을 지원하는 정리 구조이지 10년 무료·무장애 보장이 아니다. 요금제나 한도를 질문받으면 그때 실제 사용량과 공식 정책을 확인한다.
