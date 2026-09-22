# My Day ☑

macOS 메뉴바 / 플로팅 **투두 + 오늘 일정 위젯**.
오늘 할 일과 캘린더 일정을 작은 창 하나에서 보고, 체크하면 낙서처럼 선이 그어집니다.

<p align="center">
  <img src="docs/screenshot-default.png" width="300" alt="기본 스킨" />
  &nbsp;&nbsp;
  <img src="docs/screenshot-sketch.png" width="300" alt="낙서 스킨" />
</p>

## 기능

- **To-do / Later / Done** 세 탭 — 드래그로 순서 변경, 여러 개 잡아서 그룹 만들기, Backspace로 일괄 삭제
- **오늘 일정** — 캘린더(구글/아이클라우드 등)의 ICS 주소를 넣으면 오늘 일정만 위에 표시
- **Done 분석** — 최근 14일 동안 하루에 처리한 개수를 곡선 그래프로
- **두 가지 스킨** — 깔끔한 기본 / 종이에 펜으로 그린 **낙서 스킨** (손글씨, 삐뚤한 선, 뜯긴 수첩)
- **두 가지 위치** — 메뉴 막대 아이콘으로 열기 / 항상 위에 떠 있는 작은 위젯
- 라이트 / 다크 / 시스템 자동

## 설치 (macOS)

1. [Releases](https://github.com/oiminza/TO-Do-/releases/latest)에서 내 맥에 맞는 파일을 받습니다.
   - Apple Silicon (M1~M4): `My-Day-x.y.z-arm64.dmg`
   - Intel: `My-Day-x.y.z.dmg`
2. dmg를 열고 **My Day**를 **응용 프로그램** 폴더로 드래그
3. 처음 실행할 때 아래 안내를 따라주세요 👇

### 처음 열 때 "손상되었거나 확인되지 않은 개발자" 경고가 뜨는 이유

이 앱은 Apple 개발자 서명이 없는 개인 프로젝트예요. 바이러스가 아니라 **"Apple에 등록되지 않은 앱"** 이라는 뜻입니다. 한 번만 아래처럼 허용해주면 그 다음부터는 그냥 열립니다.

**방법 1 — 시스템 설정에서 허용 (macOS 15 Sequoia 이상)**
1. 앱을 한 번 더블클릭 → 경고 창에서 **완료** 클릭
2. **시스템 설정 → 개인정보 보호 및 보안** 으로 이동
3. 아래로 내려가면 *"My Day"이(가) 차단되었습니다* 옆에 **확인 없이 열기** 버튼 → 클릭
4. 다시 앱 실행

**방법 2 — 터미널 한 줄 (모든 버전)**
```bash
xattr -cr "/Applications/My Day.app"
```
그 다음 앱을 열면 됩니다.

## 캘린더 연결

1. 위젯 우측 상단 ⚙ → **캘린더** 섹션
2. 캘린더 앱에서 **비공개 ICS 주소**를 복사해서 붙여넣기
   - **Google 캘린더**: 설정 → 내 캘린더 선택 → *iCal 형식의 비공개 주소* 복사
   - **iCloud 캘린더**: 캘린더 앱 → 캘린더 공유 → *공개 캘린더* 체크 → 링크 복사 (`webcal://`을 `https://`로 바꿔서 붙여넣기)
3. 오늘 일정이 Schedule 영역에 표시됩니다. 주소는 이 맥의 앱 설정 파일에만 저장되고 어디에도 전송되지 않아요.

## 단축키 · 조작

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

## 개발자용

```bash
git clone https://github.com/oiminza/TO-Do-.git
cd TO-Do-
npm install
npm run dev        # Vite 개발 서버 (http://localhost:5173)
npm run app        # 개발 서버에 붙는 Electron 창 (dev 서버를 먼저 켜두세요)
npm run dist       # macOS .dmg / .zip 빌드 → release/
```

- 스택: Electron · React 19 · Vite · Tailwind v4 · HeroUI · framer-motion · node-ical

### 온보딩 화면 다시 보기 (개발 전용)
이미 사용 중인 환경에서 첫 실행 온보딩을 확인하고 싶을 때:

```bash
cp .env.example .env.local
# .env.local 에서 VITE_DEV_FORCE_NEW_USER=true 로 바꾸고
npm run dev
```

- 저장된 할일·설정은 그대로 두고 **화면만** 신규 사용자 상태로 보여줍니다. "시작하기"를 눌러도 완료 상태를 저장하지 않아 새로고침하면 다시 보입니다.
- `import.meta.env.DEV` 가 `false` 인 프로덕션 뱌드(`npm run build`, `npm run dist`)에서는 이 코드가 번들에서 제거되어 절대 켜지지 않습니다.
- 데이터는 모두 로컬(`localStorage`, 앱 설정 폴더의 `config.json`)에만 저장됩니다.

## 크레딧

- 손글씨 폰트: [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand), [Poor Story](https://fonts.google.com/specimen/Poor+Story) — SIL Open Font License 1.1 (`public/fonts/OFL-*.txt`)
- 기본 폰트: Pretendard

## 라이선스

MIT © oiminza
