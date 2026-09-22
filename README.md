# My Day ☑

macOS 메뉴바 / 플로팅 **투두 + 오늘 일정 위젯**.
오늘 할 일과 캘린더 일정을 작은 창 하나에서 보고, 체크하면 낙서처럼 선이 그어집니다.

## 기능

- **To-do / Later / Done** — 드래그로 순서 변경, 여러 개 잡아 그룹 만들기, Backspace로 삭제
- **오늘 일정** — Google 계정으로 연결하면 오늘 일정이 할 일 위에 표시됩니다 (읽기 전용)
- **Done 분석** — 최근 14일 동안 하루에 처리한 개수를 그래프로
- **두 가지 스킨** — 깔끔한 기본 / 종이에 펜으로 그린 **낙서 스킨**
- **어디든 두는 위젯** — 알약 모양으로 접어 화면 아무 곳에 두고, 그 자리에서 펼쳐집니다. 자리를 기억해요
- 메뉴 막대 모드 · 라이트 / 다크 / 시스템 자동

## 설치 (macOS)

1. [Releases](https://github.com/oiminza/TO-Do-/releases/latest)에서 내 맥에 맞는 파일을 받습니다.
   - Apple Silicon (M1~M4): `My.Day-x.y.z-arm64.dmg`
   - Intel: `My.Day-x.y.z.dmg`
2. dmg를 열고 **My Day**를 **응용 프로그램** 폴더로 드래그
3. 처음 실행할 때 아래 안내를 따라주세요 👇

### 처음 열 때 "손상되었거나 확인되지 않은 개발자" 경고가 뜨면

Apple 개발자 서명이 없는 개인 프로젝트라서 뜨는 안내예요. 한 번만 허용하면 그 뒤로는 그냥 열립니다.

- **시스템 설정 → 개인정보 보호 및 보안** → 아래로 내려 *"My Day"이(가) 차단됨* 옆 **확인 없이 열기** → 다시 실행
- 또는 터미널에서 한 줄:
  ```bash
  xattr -cr "/Applications/My Day.app"
  ```

## 캘린더 연결

첫 실행 온보딩에서 **Google 계정으로 연결**을 누르거나, 위젯 우측 상단 ⚙ → **캘린더**에서 연결할 수 있어요.

1. 브라우저가 열리면 사용할 계정 선택 (회사 Google Workspace 계정도 됩니다)
2. *확인되지 않은 앱* 안내가 나오면 **고급 → My Day(으)로 이동**
3. 캘린더 **보기 권한 허용** → 브라우저에 *완료*가 뜨면 위젯으로 돌아오세요

캘린더는 **읽기만** 하고, 일정은 이 맥 밖으로 나가지 않습니다.

> 아직 테스트 중인 앱이라 **미리 승인된 계정만** 연결됩니다. 연결이 막히면 배포한 사람에게 사용 계정을 알려주세요.

**iCloud 등 다른 캘린더** — ⚙ → 캘린더 → **iCal 주소**에 `https://…/….ics` 주소를 넣으면 됩니다.
(iCloud: 캘린더 앱 → 공유 → *공개 캘린더* → 링크 복사 후 `webcal://`을 `https://`로)

## 조작

| 동작 | 방법 |
|---|---|
| 항목 추가 | `+ Add task` 클릭 → 입력 → Enter |
| 항목 편집 | 제목 클릭 |
| 완료 | 동그라미 클릭 |
| 순서 변경 | 왼쪽 ⠿ 손잡이 드래그 |
| 여러 개 선택 | 항목 위에서 드래그, 또는 Shift+클릭 |
| 선택한 항목 그룹 만들기 | 선택 후 그룹 이름 입력 → Enter |
| 선택한 항목 삭제 | 선택 후 Backspace |
| 나중에 / 되돌리기 / 삭제 | 항목 우클릭 |
| 위젯 이동 | 알약을 드래그 |

## 개발

```bash
git clone https://github.com/oiminza/TO-Do-.git
cd TO-Do-
npm install
npm run dev        # Vite 개발 서버
npm run app        # Electron 창 (dev 서버를 먼저 켜두세요)
npm run dist       # macOS .dmg 빌드 → release/
```

- Electron · React 19 · Vite · Tailwind v4 · framer-motion
- 온보딩 다시 보기: `.env.local`에 `VITE_DEV_FORCE_NEW_USER=true` (dev 서버 전용, 프로덕션 빌드에는 포함되지 않음)
- 모든 데이터는 로컬에만 저장됩니다 (`localStorage`, 앱 설정 폴더의 `config.json`, 구글 토큰은 키체인 암호화)

## 크레딧

- 손글씨 폰트: [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand), [Poor Story](https://fonts.google.com/specimen/Poor+Story) — SIL Open Font License 1.1
- 기본 폰트: Pretendard

## 라이선스

MIT © oiminza
