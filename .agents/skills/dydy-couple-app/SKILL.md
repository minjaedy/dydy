---
name: dydy-couple-app
description: 토끼와 구마 커플 앱(minjaedy/dydy)의 구조를 파악하고 GitHub Pages 프런트엔드, Firebase RTDB 인증·공유 데이터, Cloudflare Worker/D1 푸시·채팅을 연결·수정·배포할 때 사용한다. 다른 앱을 만드는 경우에는 이 프로젝트의 원칙을 참고하되 프로젝트 ID나 데이터를 재사용하지 않는다.
---

# 토끼와 구마 앱

기존 앱의 연결과 데이터를 유지하면서 요청한 기능을 수정한다. 이 스킬은 연결 구조와 작업 방법을 기록한 것이며 서비스 계정 키나 로그인 권한을 제공하지 않는다.

## 작업 시작

1. 현재 Git 저장소와 `git status --short`, 최근 커밋, `index.html`의 `app-version`을 확인한다. 기록된 버전보다 현재 코드가 우선이다.
2. 구조와 수정 위치는 [references/architecture.md](references/architecture.md), Firebase·인증·보관 정책은 [references/data-and-auth.md](references/data-and-auth.md)를 필요한 범위만 읽는다.
3. 빌드·미리보기·GitHub·Worker 배포에는 [references/development-and-deploy.md](references/development-and-deploy.md)를 읽는다.

설정과 파일 유무만 읽는 점검 도구:

```powershell
python <skill-directory>/scripts/inspect_project.py --repo <checkout> --source <source-directory>
```

이 도구는 네트워크에 연결하지 않고 인증 파일이나 실제 사용자 데이터를 읽지 않는다. 원본 폴더가 없는 환경에서는 `--source`를 생략한다.

## 유지해야 하는 특성

- 앱은 GitHub Pages의 PWA다. 데이터는 Firebase **Realtime Database**와 Cloudflare **D1**에 나뉘어 있다. Firestore나 Firebase Cloud Functions로 임의 전환하지 않는다.
- `rabbit`은 이토끼, `sweet`는 구마구마다. 유흥연차 신청자는 토끼·관리자는 구마, 흡연 결재 신청자는 구마·관리자는 토끼다. 기기 알림 등록과 사용자 로그인은 서로 다른 인증이다.
- 서버는 앱을 열지 않아도 알림과 정리를 수행한다. 클라이언트 전용 타이머로 대체하지 않는다. 캘린더 저장·결재 직후 동기화와 분 단위 예약 작업을 모두 유지한다.
- Firebase는 기본 거부 규칙과 만료되는 커스텀 인증을 유지한다. 오류를 고치기 위해 공개 읽기·쓰기를 켜지 않는다.
- 실제 잔액, 누적 포상, 소원권, 설정, 패스키, 기기 등록은 일반 정리 대상이 아니다. 전체 앱이나 계정의 만료를 만들지 않는다.
- 점수와 높이를 섞지 않는다. 피하기는 점, 탑 쌓기는 한 층당 10m다. 두 사람의 두 게임 기록을 홈에 별도로 표시한다.
- 미리보기는 실제 Firebase/D1·보상·알림과 분리한다. `data-preview="true"`와 테스트 인증 우회 코드를 실제 `index.html`에 배포하지 않는다.
- 이 프로젝트는 귀여운 토끼·구마 캐릭터와 간결한 UI를 쓴다. 디자인 변경에서도 결재 타이머, 승인·반려 연출, 기존 데이터·작동 흐름을 유지한다.

## 작업 종료

관련 동작만 검증하고 변경 파일을 명시적으로 스테이징한다. 문서나 스킬 저장 요청으로 앱 배포·규칙 변경·비밀키 재발급을 함께 실행하지 않는다. 배포를 요청받았다면 GitHub 반영과 실제 서비스 반영을 구분해 확인한다.
