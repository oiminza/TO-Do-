# My Day — Claude 작업 가이드

macOS 메뉴바/플로팅 **투두 + 오늘 일정 위젯**. Electron + React(Vite) + Tailwind + HeroUI.
사용자는 **프로덕트 디자이너(비개발자)** — 기술 용어는 쉬운 말로 풀어서 설명하고, 변경 후엔 항상 스크린샷/미리보기로 확인할 수 있게 안내한다.

## 실행

```bash
npm install
npm run dev        # 브라우저 미리보기 http://localhost:5173 (Electron 없이 UI만)
npm run dist       # macOS dmg 빌드 → release/
```
- 브라우저 미리보기에선 알약(접기)·✕·구글 로그인·창 이동 등 Electron 기능은 안 보인다. UI/CSS 작업은 미리보기로 충분.
- 스킨 전환: ⚙ 설정 → 스킨 (기본 / 낙서 / Win95). `localStorage["my-day-look"]`.
- 온보딩 강제: `.env.local`에 `VITE_DEV_FORCE_NEW_USER=true`.

## 브랜치

| 브랜치 | 상태 |
|---|---|
| `main` | v0.1.8 릴리즈 (안정). 함부로 커밋하지 않는다 |
| `skin/win95` | **현재 작업 브랜치.** Win95 스킨 + 낙서 스킨 Add task 개선. 아직 main에 안 합침 |

작업은 `skin/win95`에서 하고, 작은 단위로 자주 커밋·푸시한다. 릴리즈는 태그 `v0.1.x` + GitHub Releases(dmg 첨부).

## 파일 구조

- `src/App.tsx` — 앱 전체 (단일 파일, ~2900줄). 온보딩·탭·할일 목록·설정·알약 모두 여기
- `src/index.css` — 스킨 CSS. 블록 순서: 공통 → `html.sketch` (낙서) → `html.win95`
- `electron/main.cjs` — 창 제어(알약↔패널 크기, 위치 기억, 트레이), `googleAuth.cjs` — 구글 OAuth, `preload.cjs` — `window.widget` API
- `public/fonts/` — Galmuri11(+Bold), Patrick Hand, Poor Story
- `electron/secrets/google-oauth.json` — **깃 제외.** 없으면 캘린더 연동만 안 됨

## 스킨 구조 (중요 클래스)

```
.sk-outer            창 전체
 ├ .sk-head          제목 막대 (날짜) + ⚙ .sk-gear + ✕ .w95-close(Win95 전용)
 └ .sk-panel         안쪽 패널
    ├ .px-4          탭 줄 (HeroUI Tabs) / 설정에선 '← 돌아가기'
    └ .sk-body       본문 래퍼 (Win95에선 흰 리스트박스). 설정 화면일 때 .sk-settings
       ├ .sk-scroll  스크롤 영역 (Section: Schedule / Tasks, TaskRow)
       └ .w95-addbar 하단 고정 Add task (낙서·Win95만. 기본 스킨은 목록 끝에 인라인)
          └ .sk-addrow > input + button.w95-send (.ico-tri / .ico-plane / .ico-text)
```

- **HeroUI Tabs 슬롯 이름**: `[data-slot="tabs-list-container"]`, `[data-slot="tabs-list"]`, **`[data-slot="tabs-tab"]`** (⚠️ `tab`이 아님), `[data-slot="tabs-indicator"]`. 가로 스크롤 버튼은 `.tabs__list-container__scroll-prev/next`
- Win95 베벨 변수: `--bevel-out`(튀어나옴) `--bevel-in`(눌림) `--bevel-field`(흰 입력 필드 들어감) `--page-out`(회색 페이지 바깥 베벨). 팔레트 `--w-face #c0c0c0` `--w-title-a #000080` `--w-select #000080`
- 낙서 손그림 선은 data-URI SVG 배경 + `vector-effect='non-scaling-stroke'` (늘려도 선 굵기 유지)

## Win95 스킨 현재 상태 (skin/win95)

- 구조: 회색 창 → 단색 남색 제목 막대 → 클래식 탭(내용 폭, 선택 탭이 2px 크고 페이지와 이어짐) → 회색 페이지(튀어나온 베벨) → **흰 리스트박스(들어간 베벨)**. 설정 화면은 흰 박스 없이 회색만
- 폰트 Galmuri11. 중간 굵기가 없어서 **Regular + `text-shadow: 0.5px 0 0 currentColor`**로 미디엄 연출. 탭은 가로+세로 0.5px. 진짜 Bold(700)는 너무 두꺼워서 안 씀. 네오둥근모로 바꿔봤다가 되돌림(톤이 DOS 쪽으로 감)
- 본문 글자: 섹션 제목 13px, 할일 12.5px (기본 14/13.5보다 살짝 작게)
- Add task: 흰 필드 + 오른쪽 끝 꽉 찬 회색 베벨 버튼(▸ 항상 검정), 높이 28px
- 드롭다운: 테두리/그림자 없음, 항목 hover 남색+흰 글씨
- 다크 모드 없음(라이트 고정)

## 낙서 스킨 최근 변경 (skin/win95에 포함)

- Add task 하단 고정 + 손그림 네모 상자(40px) + 오른쪽 손글씨 "추가" 버튼
- 기본 스킨은 아직 목록 끝 인라인 (하단 고정 통일은 미정)

## 공통 최근 변경

- 패널 펼치면 0.42초 뒤 Add task 입력에 자동 포커스 (To-do 탭 + 설정 아님일 때, `preventScroll`)
- Tasks 비었을 때 "Nothing to do" (Schedule의 "No events today"와 같은 톤)

## 남은 아이디어 / TODO

- Win95: 온보딩 화면·Done 그래프 톤 점검, ⚙ 아이콘 픽셀화, 알약 모양
- 기본 스킨 Add task도 하단 고정으로 통일할지
- `skin/win95` → `main` 머지 후 v0.1.9 릴리즈

## 작업 규칙

- 사용자에게 보여줄 땐 **AS IS → TO BE** 순서, 표로 간단히
- 한 요청 = 한 커밋. 커밋 메시지는 한글, 접두어 `win95:` / `sketch:` 등
- 스킨 CSS는 반드시 `html.win95` / `html.sketch` 범위 안에서만 — 다른 스킨에 영향 주지 않기
- `text-[13.5px]` 같은 Tailwind 임의값을 CSS에서 덮을 땐 `.text-\[13\.5px\]`로 이스케이프
- 개인 데이터 파일(`calendar-today.json`, `electron/secrets/`)은 절대 커밋하지 않기
