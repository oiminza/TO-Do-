# My Day — 회사 컴퓨터에서 이어서 작업하기

현재 작업 브랜치: `skin/win95`. 최신 배포는 v0.1.13입니다. 앱 이름을 My Day로 되돌렸습니다. `main`에는 아직 합치지 않았습니다.

## 실행

새로 받는 경우:

```bash
git clone --branch skin/win95 https://github.com/oiminza/TO-Do-.git
cd TO-Do-
npm ci
npm run dev
```

이미 저장소가 있는 경우 현재 변경사항을 먼저 확인하고 보관한 다음:

```bash
git fetch origin
git switch skin/win95
git pull --ff-only
npm ci
npm run dev
```

터미널에 표시된 localhost 주소로 미리보기를 엽니다. 온보딩을 항상 처음부터 보려면 `.env.local`에 `VITE_DEV_FORCE_NEW_USER=true`를 넣습니다. 이 옵션은 개발 미리보기 전용이며 배포 빌드에는 적용되지 않습니다.

## 최신 디자인 / 동작

- 온보딩: 환영 → 일정·할 일 한눈에 → 그룹 → 완료 그래프 → 일정 연동.
- 온보딩은 항상 낙서 스킨으로 표시합니다. 제목 아래 설명은 12px입니다.
- 환영 문구: “My Day에 오신 것을 환영해요.” / “일정 관리를 시작해볼까요?”
- 환영 영상은 2배속으로 한 번 재생합니다. 재생 20% 지점에서 시작하기 버튼이 아래에서 올라옵니다.
- 일정 예시: 11:00 데일리 스탠업 / 19:00 지원이와 저녁약속.
- 그룹 안내: “하나의 주제로 모아두기”. 디자인 시스템 문서 정리하기와 변경사항 공유하기를 묶는 모션. 드래그 0.6초, 완료 후 약 2초 쉬고 반복합니다.
- 완료 그래프는 선을 그린 뒤 날짜별 개수 툴팁으로 이어집니다. 그래프 바로 아래의 부가 문구는 제거했습니다.
- 그래프 설명: “하루 평균 몇 개의 할 일을 처리하는지 확인해요.”
- 일정 연동: 공개·비공개 iCal 주소 / Google 계정 연결을 모두 표시합니다.
- 스킨 선택은 온보딩에 포함하지 않습니다. 완료 후 메인 화면 아래에서 작은 선택창이 올라옵니다. “잠깐! 어떤 스킨이 더 좋으세요?” / “설정에서 언제든 바꿀 수 있어요.”
- 낙서 / 윈도우 선택 시 뒤의 실제 UI가 즉시 바뀝니다. 배경을 어둡게 하지 않으며 별도 미리보기 그림도 없습니다.
- 윈도우 Schedule/Tasks는 제공된 캘린더·수첩 이미지 사용. 본문 스크롤에는 위아래 화살표 버튼이 있습니다.

## 파일

- `src/App.tsx`: 온보딩, 데모 모션, 스킨 선택창, 앱 UI.
- `src/index.css`: 낙서/윈도우 스타일, 스크롤, 스킨 선택창 등장 모션.
- `public/onboarding-welcome.mp4`, `public/schedule-calendar.png`, `public/task-notepad.png`: 필수 자산, Git에 포함.
- 앱 이름은 **My Day**(My Day.app, appId com.oiminza.myday)입니다. 온보딩·메뉴 등 모든 표기도 My Day입니다.
- v0.1.12 한 버전만 Tody.app으로 배포했다가 v0.1.13에서 되돌렸습니다. My Day.app을 켜면 같은 폴더의 Tody.app을 끄고 휴지통으로 옮깁니다(`retireOldApp`).
- 첫 실행 위치는 화면 정가운데. 같은/낮은 버전으로 재설치하면 온보딩을 다시 보여줍니다(`detectReinstall`).
- 릴리즈 업로드: `npm run dist` 후 `bash release/upload-release.sh` (release/는 깃 제외, 제목·설명은 스크립트 안에서 수정).

## 빌드와 주의사항

- 사용자는 디자이너입니다. 요청한 UI 변경을 진행하고 미리보기를 열어주세요.
- 이후 빌드·배포는 사용자가 요청할 때만 합니다. 개발 미리보기는 실행해도 됩니다.
- `npm run build`: 타입 검사 + 프론트엔드 빌드.
- `npm run dist`: macOS Apple Silicon / Intel 설치 파일 생성. 이번 환경에서는 DMG 생성이 차단되어 v0.1.9는 ZIP 앱 패키지로 준비했습니다.
- Google 로그인 빌드 설정은 `electron/secrets/google-oauth.json`이며 Git에 포함하지 않습니다. 회사 컴퓨터에서도 Google 로그인 테스트나 배포 시 별도로 필요합니다. 브라우저 UI 개발에는 필요 없습니다.
- 개인 일정, 로그인 토큰, `.env.local`, `electron/secrets/`는 커밋하지 않습니다.
