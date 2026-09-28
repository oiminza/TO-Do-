import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "@heroui/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

declare global {
  interface Window {
    widget?: {
      isElectron: boolean;
      freshInstall?: boolean;
      setMode: (m: "widget" | "panel") => void;
      moveBy: (dx: number, dy: number) => void;
      onBlur: (cb: () => void) => () => void;
      calendarSetUrl: (url: string) => Promise<boolean>;
      googleStatus: () => Promise<GoogleStatus>;
      googleSignIn: () => Promise<{ ok: boolean; email?: string; reason?: string }>;
      googleSignOut: () => Promise<boolean>;
      calendarGetUrl: () => Promise<string>;
      getPlacement: () => Promise<Placement>;
      setPlacement: (p: Placement) => void;
      onPlacement: (cb: (p: Placement) => void) => () => void;
      onPanelShown: (cb: (fromTray: boolean) => void) => () => void;
      setTrayTitle: (t: string) => void;
      ignoreMouse: (ignore: boolean) => void;
      centerWindow: (on: boolean) => void;
      pillReady: () => void;
      onPillOffset: (cb: (v: { left: number; top: number }) => void) => () => void;
      onPanelWindowReady: (cb: () => void) => () => void;
      onOpenPanel: (cb: () => void) => () => void;
      pillSize: (w: number, h: number) => void;
      appVersion: () => Promise<string>;
      quitApp: () => void;
      checkUpdate: () => Promise<UpdateInfo>;
      openExternal: (url: string) => Promise<void>;
      calendarEvents: () => Promise<{
        configured: boolean;
        sources?: Array<"google" | "ics">;
        source?: "local";
        events: CalEvent[];
        fetchedAt?: number | null;
        error?: "rate_limited" | "offline" | "error" | "signed_out";
      }>;
    };
  }
}
const isElectron = typeof window !== "undefined" && !!window.widget;

// 위젯 위치: 화면에 띄우기 / 메뉴 막대
type Placement = "floating" | "menubar";
const PLACEMENT_LABEL: Record<Placement, string> = {
  floating: "화면에 띄우기",
  menubar: "메뉴 막대",
};

interface CalEvent {
  name: string;
  start: string;
  end: string;
}

// ─── 타입 ───────────────────────────────────────────
type Status = "todo" | "later" | "done";

interface Task {
  id: string;
  title: string;
  status: Status;
  flag: boolean;
  created: string;
  doneAt?: string;
  group?: string;
}

// 브라우저 미리보기용 목데이터 (Electron에선 구글캘린더 ICS 사용)
// 바우저 미리보기(개발) 전용 샘플 일정 — 실제 앱에서는 사용하지 않는다
const MOCK_EVENTS: CalEvent[] = [
  { name: "주간 팀 미팅", start: "11:00", end: "11:30" },
  { name: "점심 약속", start: "12:30", end: "13:30" },
];

// ─── 유틸 ───────────────────────────────────────────
const today = () => new Date().toLocaleDateString("sv");
const uid = () => Math.random().toString(36).slice(2, 9);
const daysAgo = (d: string) =>
  Math.floor((Date.parse(today()) - Date.parse(d)) / 86400000);

// Done 탭 날짜 헤더: Today / Yesterday / "September 05, Friday"
const dateHeading = (ymd: string) => {
  const diff = daysAgo(ymd);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(ymd + "T00:00:00");
  return `${d.toLocaleDateString("en-US", { month: "long", day: "2-digit" })}, ${d.toLocaleDateString("en-US", { weekday: "long" })}`;
};

const nowHM = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
};

// 바우저 미리보기(개발) 전용 샘플 할일 — 실제 앱의 신규 사용자는 뱈 목록으로 시작한다
const SEED: Task[] = [
  { id: uid(), title: "프로젝트 기획서 초안 작성", status: "todo", flag: true, created: today() },
  { id: uid(), title: "디자인 리서치 정리", status: "todo", flag: false, created: today() },
  { id: uid(), title: "운동 30분", status: "todo", flag: false, created: today() },
  { id: uid(), title: "포트폴리오 업데이트", status: "later", flag: false, created: today() },
  { id: uid(), title: "주간 미팅 참석", status: "done", flag: false, created: today(), doneAt: today() },
];

function load(): Task[] {
  try {
    const raw = localStorage.getItem("my-day-tasks");
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  // 앱(Electron)에서는 뱈 목록, 바우저 미리보기에서만 샘플
  return isElectron ? [] : SEED;
}

// ─── 완료 표시 (직선 / 낙서) ────────────────────────
type StrikeStyle = "line" | "scribble";
const StrikeCtx = createContext<StrikeStyle>("line");

// ─── 스킨 (낙서 / 윈도우) ───────────────────────────────
// 낙서: 종이 배경 + 손글씨 + 샐뻗한 테두리/선 + 노란 형광펜 탭. <html class="sketch">로 켜짐
type Look = "sketch" | "win95";

type GoogleStatus = { signedIn: boolean; email: string; clientConfigured: boolean };

// ─── 정보 / 업데이트 ────────────────────────────────────────────────
const REPO_URL = "https://github.com/oiminza/TO-Do-";
type UpdateInfo =
  | { ok: true; latest: string; current: string; hasUpdate: boolean; url: string }
  | { ok: false; reason: string };
// 브라우저 미리보기용 버전 (Electron에서는 main 프로세스의 app.getVersion() 사용)
const WEB_VERSION = "dev";
const loadLook = (): Look => {
  const v = localStorage.getItem("my-day-look");
  // 기존 기본 스킨과 신규 사용자는 낙서 스킨으로 시작한다.
  return v === "win95" ? "win95" : "sketch";
};
const applyLook = (l: Look) => {
  document.documentElement.classList.toggle("sketch", l === "sketch");
  document.documentElement.classList.toggle("win95", l === "win95");
};

// 손그림 테두리/선을 샐뻗하게 만드는 SVG 필터. CSS에서 filter:url(#sketchy)로 참조
function SketchFilter() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        <filter id="sketchy" x="-4%" y="-4%" width="108%" height="108%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="sketchy-wobble" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="sketchy-strong" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

// 크레파스로 긋은 듯한 낙서 선. 글자 폭에 맞게 가로로 늘어나고(preserveAspectRatio none),
// 선 두께는 늘어나지 않게 고정(non-scaling-stroke). 왼쪽부터 그려지는 연출.
function Scribble() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-foreground"
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d="M 2 13 C 15 7, 33 2.5, 52 5 C 63 6.5, 62 15.5, 47 17 C 37 18, 32 12.5, 42 10.5 C 58 8, 78 7.5, 98 10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        className="animate-scribble"
        style={{ opacity: 0.85 }}
      />
    </svg>
  );
}

// ─── 온보딩 (첫 실행 안내) ─────────────────────────────────
const ONBOARDED_KEY = "my-day-onboarded";

// [DEV 전용] 신규 사용자 강제 시뮬레이션.
//  - .env.local 에 VITE_DEV_FORCE_NEW_USER=true 를 넣고 dev 서버를 켜면 저장된 상태와 무관하게 온보딩이 보인다.
//  - localStorage 등 실제 데이터는 읽지도, 바꾸지도 않는다(완료 버튼도 저장하지 않고 화면만 닫는다).
//  - import.meta.env.DEV 는 프로덕션 빌드에서 `false` 상수로 치환되어 이 분기와 플래그 값이 번들에서 통째로 제거된다.
const DEV_FORCE_NEW_USER: boolean =
  import.meta.env.DEV && import.meta.env.VITE_DEV_FORCE_NEW_USER === "true";

// 부수효과 없이 완료 여부만 확인 (open 초기값 계산용)
// 온보딩이 없던 예전 버전(v0.1.0 이전 개발버전)을 이미 쓰던 사용자인가.
// 예전 버전은 "완료 표시" 설정(my-day-strike)을 저장했고, 이 키는 지금 버전에서 더 이상 쓰지 않으므로 신뢰할 수 있는 흔적.
// (할일 데이터 존재 여부는 처음 켜도 샘플이 저장되므로 기준이 될 수 없다)
const isLegacyUser = () => !!localStorage.getItem("my-day-strike");

// 앱을 지웠다 다시 설치한 첫 실행이면 온보딩 완료 기록을 지워 온보딩을 다시 보여준다. (할 일 데이터는 유지)
if (typeof window !== "undefined" && window.widget?.freshInstall) {
  try {
    localStorage.removeItem(ONBOARDED_KEY);
    localStorage.removeItem("my-day-strike");
  } catch {
    /* ignore */
  }
}

function loadOnboardedPeek(): boolean {
  if (DEV_FORCE_NEW_USER) return false;
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1" || isLegacyUser();
  } catch {
    return false;
  }
}

function loadOnboarded(): boolean {
  if (DEV_FORCE_NEW_USER) return false;
  try {
    if (localStorage.getItem(ONBOARDED_KEY) === "1") return true;
    // 온보딩이 없던 예전 버전을 쓰던 사용자는 자동 완료 처리 (업데이트 후 갑자기 온보딩이 뜨지 않게)
    if (isLegacyUser()) {
      localStorage.setItem(ONBOARDED_KEY, "1");
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

// ─── 테마 (light / dark / system) ───────────────────
type Theme = "light" | "dark" | "system";
const loadTheme = (): Theme => {
  const v = localStorage.getItem("my-day-theme");
  return v === "light" || v === "dark" || v === "system" ? v : "light";
};
const systemDark = () =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
// HeroUI는 <html class="dark">로 다크 토큰을 켬
const applyTheme = (t: Theme) => {
  const dark = t === "dark" || (t === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
};

// 설정 화면에서 주소는 앞뒤만 보이게 가림
const maskUrl = (u: string) =>
  u.length <= 28 ? u : `${u.slice(0, 22)}…${u.slice(-6)}`;

// 톱니바퀴 아이콘 (인라인 SVG, 14px)
function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

// ─── 설정 화면: 드롭다운 ────────────────────────────
function Dropdown<T extends string>({
  value,
  options,
  onChange,
  width = 120,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const label = options.find(([k]) => k === value)?.[1] ?? value;
  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="sk-box flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/8 bg-surface px-3.5 py-2 text-[12px] text-foreground transition-colors hover:bg-background-secondary dark:border-white/10"
      >
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          style={{ width }}
          className="sk-box absolute right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-black/6 bg-surface py-1 shadow-lg dark:border-white/8"
        >
          {options.map(([key, lbl]) => (
            <li key={key}>
              <button
                role="option"
                aria-selected={value === key}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-background-secondary ${
                  value === key ? "font-bold" : ""
                }`}
              >
                {lbl}
                {value === key && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── 설정 화면: 섹션 카드 + 행 ─────────────────────────
function SettingCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="mb-3 px-1 text-[12px] font-medium tracking-wide text-muted">
        {title}
      </p>
      <div className="sk-box divide-y divide-black/6 rounded-2xl border border-black/6 dark:divide-white/8 dark:border-white/8">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  label,
  desc,
  descMono,
  onDescClick,
  children,
}: {
  label: string;
  desc?: string;
  descMono?: boolean;
  onDescClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-tight text-foreground">{label}</p>
        {desc &&
          (onDescClick ? (
            <button
              onClick={onDescClick}
              title="클릭해서 전체 보기 / 숨기기"
              className={`mt-1.5 block max-w-full cursor-pointer truncate text-left text-[12px] leading-relaxed text-muted hover:text-foreground ${
                descMono ? "font-mono" : ""
              }`}
            >
              {desc}
            </button>
          ) : (
            <p
              className={`mt-1.5 text-[12px] leading-relaxed text-muted ${
                descMono ? "truncate font-mono" : ""
              }`}
            >
              {desc}
            </p>
          ))}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  );
}

// ─── Done 분석 요약 수치 (최근 7일 개수 / 하루 평균) ──────────
function doneSummary(tasks: Task[], days = 14) {
  const keys = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d.toLocaleDateString("sv");
  });
  const counts = keys.map((k) => tasks.filter((t) => (t.doneAt || t.created) === k).length);
  const total7 = counts.slice(-7).reduce((a, b) => a + b, 0);
  const avg = (counts.reduce((a, b) => a + b, 0) / days).toFixed(1);
  return { total7, avg };
}

// ─── Done 분석: 하루별 완료 개수 공선 그래프 (최근 14일) ────────
function DoneChart({ tasks, highlightDay, drawDuration = 0.9, showTodayMarker = true }: { tasks: Task[]; highlightDay?: number | null; drawDuration?: number; showTodayMarker?: boolean }) {
  const reducedMotion = useReducedMotion();
  const DAYS = 14;
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (DAYS - 1 - i));
    return d.toLocaleDateString("sv");
  });
  const counts = days.map(
    (d) => tasks.filter((t) => (t.doneAt || t.created) === d).length,
  );
  const max = Math.max(4, ...counts);

  // 캨버스 좌표
  const W = 300, H = 152, PL = 22, PR = 8, PT = 26, PB = 22;
  const x = (i: number) => PL + (i / (DAYS - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const pts = counts.map((c, i) => [x(i), y(c)] as const);

  // Catmull-Rom → cubic bezier (부드러운 공선)
  const line = pts.reduce((acc, p, i) => {
    if (i === 0) return `M ${p[0]} ${p[1]}`;
    const p0 = pts[i - 2] ?? pts[i - 1];
    const p1 = pts[i - 1];
    const p2 = p;
    const p3 = pts[i + 1] ?? p;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    // 제어점 y를 구간 양 끝 값 범위로 클램프 → 기준선(0) 아래로 파고들거나 봉우리를 넘어가는 오버슈트 방지
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6);
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6);
    return `${acc} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }, "");
  const area = `${line} L ${x(DAYS - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;

  // Y 눈금: 0 제외 4개 (정수만)
  const yTicks = [...new Set([1, 2, 3, 4].map((k) => Math.round((max * k) / 4)))].filter(
    (v) => v > 0,
  );
  // X 라벨: 3일 간격, 오늘 포함
  const label = (ymd: string) => {
    const [, m, d] = ymd.split("-");
    return `${+m}/${+d}`;
  };

  const [pointerHover, setHover] = useState<number | null>(null);
  const hover = highlightDay === undefined ? pointerHover : highlightDay;

  return (
    <div className="sk-box mb-4 rounded-2xl border border-black/6 px-2 pb-1 pt-2 dark:border-white/8">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full text-foreground"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {/* 낙서 스킨용 손그림 뿠금 */}
          <pattern id="doneHatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(-38)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.28" strokeLinecap="round" />
            <line x1="3.6" y1="1" x2="3.4" y2="6.2" stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.14" strokeLinecap="round" />
          </pattern>
          <linearGradient id="doneArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 가로 그리드 + Y 라벨 */}
        {[0, ...yTicks].map((v) => (
          <g key={v}>
            <line
              x1={PL} x2={W - PR} y1={y(v)} y2={y(v)}
              stroke="currentColor" strokeOpacity={v === 0 ? 0.18 : 0.07} strokeWidth={1}
            />
            <text
              x={PL - 5} y={y(v) + 3} textAnchor="end"
              className="fill-muted" fontSize={10.5}
            >
              {v}
            </text>
          </g>
        ))}

        {/* 세로 그리드 (은은) */}
        {days.map((_, i) => (
          <line
            key={i} x1={x(i)} x2={x(i)} y1={PT} y2={y(0)}
            stroke="currentColor" strokeOpacity={0.04} strokeWidth={1}
          />
        ))}

        {/* 영역 + 선 (그려지는 연출) */}
        <motion.path
          className="sk-area"
          d={area} fill="url(#doneArea)"
          initial={{ opacity: reducedMotion ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ delay: reducedMotion ? 0 : drawDuration * 0.55, duration: reducedMotion ? 0 : 0.4 }}
        />
        <motion.path
          d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="sk-line"
          initial={{ pathLength: reducedMotion ? 1 : 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: reducedMotion ? 0 : drawDuration, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* 오늘 점 */}
        {showTodayMarker && <motion.circle
          cx={x(DAYS - 1)} cy={y(counts[DAYS - 1])} r={3.5}
          fill="currentColor"
          initial={{ scale: reducedMotion ? 1 : 0, opacity: reducedMotion ? 1 : 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: reducedMotion ? 0 : drawDuration - 0.05, duration: reducedMotion ? 0 : 0.25 }}
          style={{ originX: `${x(DAYS - 1)}px`, originY: `${y(counts[DAYS - 1])}px` }}
        />}

        {/* hover: 세로선 + 점 + 라벨 */}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PT} y2={y(0)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />
            <circle cx={x(hover)} cy={y(counts[hover])} r={4} fill="var(--surface, #fff)" stroke="currentColor" strokeWidth={2} />
            <g transform={`translate(${Math.min(Math.max(x(hover), PL + 38), W - PR - 38)}, ${PT - 4})`}>
              <rect x={-38} y={-20} width={76} height={20} rx={10} fill="currentColor" />
              <text x={0} y={-6} textAnchor="middle" fontSize={10.5} className="fill-background">
                {label(days[hover])} · {counts[hover]}개
              </text>
            </g>
          </g>
        )}

        {/* X 라벨 */}
        {days.map((d, i) =>
          (DAYS - 1 - i) % 3 === 0 ? (
            <text
              key={d}
              x={x(i)}
              y={H - 6}
              textAnchor={i === DAYS - 1 ? "end" : i === 0 ? "start" : "middle"}
              className="fill-muted"
              fontSize={10.5}
            >
              {i === DAYS - 1 ? "Today" : label(d)}
            </text>
          ) : null,
        )}

        {/* hover 감지 영역 */}
        {days.map((_, i) => (
          <rect
            key={i}
            x={i === 0 ? PL : (x(i - 1) + x(i)) / 2}
            width={i === 0 || i === DAYS - 1 ? (x(1) - x(0)) / 2 : x(1) - x(0)}
            y={PT} height={H - PT - PB}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.62 4.62 0 0 1-2 3.03v2.5h3.23c1.89-1.74 2.97-4.3 2.97-7.34z" />
      <path d="M12 21.6c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.9.6-2.04.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.08v2.58A9.99 9.99 0 0 0 12 21.6z" />
      <path d="M6.41 13.51A6 6 0 0 1 6.1 12c0-.52.1-1.03.3-1.51V7.9H3.08A9.98 9.98 0 0 0 2 12c0 1.61.39 3.14 1.08 4.1l3.33-2.59z" />
      <path d="M12 6.38c1.47 0 2.78.5 3.82 1.5l2.86-2.86A9.98 9.98 0 0 0 12 2.4a9.99 9.99 0 0 0-8.92 5.5l3.33 2.59C7.2 8.13 9.4 6.38 12 6.38z" />
    </svg>
  );
}

function TactileStartButton({ onClick }: { onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  const reducedMotion = useReducedMotion();
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    const release = () => setPressed(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  return (
    <span className="relative inline-flex w-full">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: "#000",
          borderRadius: "12px 13px 11px 12px / 11px 12px 13px 10px",
          transform: "translate(-1px, 4px)",
        }}
      />
      <motion.button
        type="button"
        onPointerDown={() => setPressed(true)}
        onPointerLeave={() => setPressed(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") setPressed(true);
        }}
        onKeyUp={() => setPressed(false)}
        onBlur={() => setPressed(false)}
        onClick={() => {
          if (advanceTimer.current !== null) return;
          advanceTimer.current = window.setTimeout(() => {
            advanceTimer.current = null;
            onClickRef.current();
          }, reducedMotion ? 0 : 180);
        }}
        animate={{ x: pressed ? -1 : 0, y: pressed ? 4 : 0 }}
        transition={reducedMotion
          ? { duration: 0 }
          : pressed
            ? { type: "tween", ease: "easeOut", duration: 0.05 }
            : { type: "spring", stiffness: 800, damping: 60, mass: 1 }}
        style={{ color: "#000" }}
        className="group relative h-[46px] w-full cursor-pointer px-6 text-[16px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 284 52"
          preserveAspectRatio="none"
        >
          <path
            d="M13 1.5 C78 0.8 192 1.9 271 1.3 C279 1.1 283 6.2 283 14 L282.7 38 C283.1 46.5 278.5 50.8 271 50.5 C194 51.2 82 50.1 13 50.7 C5.4 50.5 1.4 46 1.2 38 L1.5 14 C1.1 6.4 5.2 1.8 13 1.5 Z"
            className="fill-white transition-colors duration-150 group-hover:fill-[#e6e6e6]"
            stroke="#000"
            strokeWidth="1.3"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            filter="url(#sketchy)"
          />
        </svg>
        <span className="relative">시작하기</span>
      </motion.button>
    </span>
  );
}

// 실제 Section/TaskRow 스타일로 일정과 할 일을 함께 보여주는 온보딩 예시.
function OverviewOnboardingDemo() {
  const reducedMotion = useReducedMotion();
  const reveal = (delay: number) => ({
    initial: reducedMotion ? false as const : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reducedMotion ? 0 : 0.45, delay: reducedMotion ? 0 : delay, ease: "easeOut" as const },
  });
  return (
    <div className="flex flex-1 flex-col justify-center pb-3">
      <div role="img" aria-label="Schedule에 오전 11시 데일리 스탠업과 오후 7시 지원이와 저녁약속, Tasks에 디자인 레퍼런스 모으기와 시안 정리하기가 함께 보이는 예시">
        <div inert aria-hidden="true" className="task-demo-preview pointer-events-none">
          <motion.div className="flow-root" {...reveal(0.1)}>
          <Section title="Schedule">
            {[
              { start: "11:00", name: "데일리 스탠업" },
              { start: "19:00", name: "지원이와 저녁약속" },
            ].map((event, i) => (
              <motion.div key={event.start} {...reveal(0.35 + i * 0.2)} className="flex items-baseline gap-3 py-[7px] pl-1.5 pr-1">
                <span className="w-9 flex-shrink-0 font-mono text-[12px] text-muted">{event.start}</span>
                <span className="min-w-0 flex-1 text-[13.5px] text-foreground">{event.name}</span>
              </motion.div>
            ))}
          </Section>
          </motion.div>
          <motion.div className="flow-root" {...reveal(0.75)}>
          <Section title="Tasks">
            {["디자인 레퍼런스 모으기", "시안 정리하기"].map((title, i) => (
              <motion.div key={title} {...reveal(1 + i * 0.2)}>
                <TaskRow task={{ id: `overview-task-${i}`, title, status: "todo", flag: false, created: today() }} onUpdate={() => {}} />
              </motion.div>
            ))}
          </Section>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function GroupOnboardingDemo() {
  const reducedMotion = useReducedMotion();
  const [cycle, setCycle] = useState(0);
  const [frame, setFrame] = useState({ phase: 0, name: "" });
  const phase = reducedMotion ? 6 : frame.phase;
  const groupName = "디자인 시스템";
  const titles = ["디자인 시스템 문서 정리하기", "디자인 시스템 변경사항 공유하기"];

  useEffect(() => {
    if (reducedMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, phase: number, name = "") => {
      timers.push(setTimeout(() => setFrame({ phase, name }), ms));
    };
    at(0, 0);
    at(700, 1);
    at(1400, 2); // 첫 줄에서 마우스를 누른 채 잠깐 멈춘다.
    at(1600, 3); // 누른 뒤 200ms 쉬고 아래로 0.6초 동안 드래그한다.
    at(2300, 4); // 두 번째 줄에 도착한 뒤 함께 선택하고 이름을 입력한다.
    Array.from(groupName).forEach((_, i) => at(2900 + i * 200, 4, groupName.slice(0, i + 1)));
    at(5000, 5, groupName);
    at(5900, 6, groupName);
    // 목록 퇴장(200ms)과 그룹 등장(350ms)이 끝난 뒤 2초 쉬고 반복한다.
    timers.push(setTimeout(() => setCycle(v => v + 1), 5900 + 200 + 350 + 2000));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion, cycle]);

  const rows = (grouped: boolean) => titles.map((title, i) => (
    <TaskRow
      key={title}
      task={{ id: `onboarding-group-${i}`, title: grouped ? title.slice(groupName.length + 1) : title, status: "todo", flag: false, created: today() }}
      selected={!grouped && phase >= (i === 0 ? 2 : 4)}
      onUpdate={() => {}}
    />
  ));

  return (
    <div className="flex flex-1 flex-col justify-center pb-3">
      <div className="task-demo relative" role="img" aria-label="디자인 시스템 문서 정리하기와 디자인 시스템 변경사항 공유하기를 드래그해 선택하고 디자인 시스템 그룹으로 묶는 예시">
        <div inert aria-hidden="true" className="task-demo-preview pointer-events-none">
          <Section title="Tasks">
            <AnimatePresence mode="wait" initial={false}>
              {phase < 6 ? (
                <motion.div key="separate" exit={{ opacity: 0, y: -4 }} transition={{ duration: reducedMotion ? 0 : 0.2 }}>
                  {rows(false)}
                  {phase >= 4 && (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="my-1.5 flex items-center gap-2 rounded-lg bg-background-secondary py-2 pl-6 pr-3">
                      <span className="text-[13.5px] text-foreground">2 →</span>
                      <input readOnly tabIndex={-1} value={frame.name} placeholder="Group name" className="sk-underline w-20 min-w-0 flex-1 border-b border-foreground bg-transparent font-mono text-[13.5px] text-foreground outline-none placeholder:text-muted" />
                      <motion.span animate={{ scale: phase === 5 ? 0.9 : 1 }} className="text-[13px] text-foreground">group</motion.span>
                      <span className="text-[13px] text-muted">✕</span>
                    </motion.div>
                  )}
                </motion.div>
              ) : (
                <motion.div key="grouped" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.35 }}>
                  <Group name={groupName}>{rows(true)}</Group>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>
        </div>
        {!reducedMotion && phase > 0 && phase < 6 && (
          <motion.svg aria-hidden="true" width="22" height="28" viewBox="0 0 22 28" className="pointer-events-none absolute z-10 overflow-visible text-foreground" initial={{ left: 90, top: 40, opacity: 0 }} animate={{ left: phase >= 5 ? 226 : 90, top: phase >= 5 ? 131 : phase >= 3 ? 96 : 64, opacity: 1, scale: phase === 2 || phase === 3 || phase === 5 ? 0.86 : 1 }} transition={{ duration: phase === 3 ? 0.6 : 0.5, ease: "easeInOut" }}>
            {(phase === 2 || phase === 3) && <circle cx="2" cy="2" r="9" fill="currentColor" opacity="0.12" />}
            <path d="M2 2 L3 22 L8 17 L12 26 L16 24 L12 16 L20 16 Z" fill="var(--paper)" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </motion.svg>
        )}
      </div>
    </div>
  );
}

function StatsOnboardingDemo() {
  const reducedMotion = useReducedMotion();
  const [cycle, setCycle] = useState(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  // 온보딩 전용 예시. 실제 완료 기록에는 저장하지 않는다.
  const samples = useMemo(() => [2, 3, 1, 4, 2, 5, 3, 2, 6, 4, 8, 3, 5, 2].flatMap((count, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - i));
    const day = date.toLocaleDateString("sv");
    return Array.from({ length: count }, (_, n): Task => ({ id: `stats-demo-${i}-${n}`, title: "완료 기록 예시", status: "done", flag: false, created: day, doneAt: day }));
  }), []);

  useEffect(() => {
    if (reducedMotion) return;
    const timers = [
      setTimeout(() => setHighlight(null), 0),
      setTimeout(() => setHighlight(2), 1600),
      setTimeout(() => setHighlight(5), 2600),
      setTimeout(() => setHighlight(10), 3600),
      setTimeout(() => setCycle(v => v + 1), 5600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion, cycle]);

  const activeDay = reducedMotion ? 10 : highlight;
  return (
    <div className="flex flex-1 flex-col justify-center pb-3">
      <div className="stats-demo" role="img" aria-label="최근 14일의 일별 완료 개수를 보여주는 예시 그래프. 가장 많이 완료한 날은 8개입니다.">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-[14px] text-foreground">완료 기록</span>
        </div>
        <div inert aria-hidden="true" className="pointer-events-none">
          <DoneChart key={cycle} tasks={samples} highlightDay={activeDay} drawDuration={1.6} showTodayMarker={false} />
        </div>
      </div>
    </div>
  );
}

// 메인 화면을 보면서 고르는 첫 스킨 선택. dialog가 배경 입력과 포커스를 막는다.
function SkinPickerModal({ look, onLook, onDone }: {
  look: Look;
  onLook: (look: Look) => void;
  onDone: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="skin-picker" aria-labelledby="skin-picker-title" aria-describedby="skin-picker-description" onCancel={(event) => { event.preventDefault(); onDone(); }}>
      <p className="skin-picker-eyebrow">잠깐!</p>
      <h1 id="skin-picker-title">어떤 스킨이 더 좋으세요?</h1>
      <p id="skin-picker-description">설정에서 언제든 바꿀 수 있어요.</p>
      <div className="skin-picker-options">
        {([
          ["sketch", "낙서"],
          ["win95", "윈도우"],
        ] as const).map(([key, label]) => (
          <button type="button" key={key} aria-pressed={look === key} className="skin-picker-option" onClick={() => onLook(key)}>
            <span className="skin-picker-label">{label}<span aria-hidden="true">{look === key ? "✓" : ""}</span></span>
          </button>
        ))}
      </div>
      <div className="skin-picker-footer">
        <button type="button" className="skin-picker-confirm" onClick={onDone}>이걸로 할게요</button>
      </div>
    </dialog>
  );
}

// ─── 온보딩: 환영 → 할 일 → 그룹 → 완료 분석 → 캘린더 ───────
function Onboarding({
  step,
  onStep,
  calConnected,
  googleEmail,
  googleBusy,
  googleErr,
  onGoogleSignIn,
  onSaveIcs,
  onDone,
}: {
  step: number;
  onStep: (step: number) => void;
  calConnected: boolean;
  googleEmail: string;
  googleBusy: boolean;
  googleErr: string;
  onGoogleSignIn: () => void;
  onSaveIcs: (url: string) => Promise<void>;
  onDone: () => void;
}) {
  const [ics, setIcs] = useState("");
  const [saving, setSaving] = useState(false);
  const [icsError, setIcsError] = useState("");
  const [welcomeCtaReady, setWelcomeCtaReady] = useState(false);
  const STEPS = 5;
  const isGuide = step >= 1 && step <= 3;
  const next = () => onStep(Math.min(STEPS - 1, step + 1));
  const back = () => {
    if (step === 1) setWelcomeCtaReady(false);
    onStep(Math.max(0, step - 1));
  };
  const reducedMotion = useReducedMotion();
  // 영상이 재생되지 못해도 시작 버튼을 사용할 수 있도록 한다.
  useEffect(() => {
    if (step !== 0 || welcomeCtaReady || reducedMotion) return;
    const fallback = setTimeout(() => setWelcomeCtaReady(true), 8000);
    return () => clearTimeout(fallback);
  }, [step, welcomeCtaReady, reducedMotion]);
  const icsValid = /^(https?|webcal):\/\//i.test(ics.trim());
  const progress = (
    <div className="mb-4 flex justify-center gap-1" aria-label={`온보딩 ${step} / ${STEPS - 1}`}>
      {Array.from({ length: STEPS - 1 }).map((_, i) => (
        <span key={i} className={`h-[3px] rounded-full ${i === step - 1 ? "w-5 bg-foreground" : "w-2.5 bg-foreground/20"}`} />
      ))}
    </div>
  );

  const saveIcs = async () => {
    if (!icsValid || saving) return;
    setSaving(true);
    setIcsError("");
    try {
      await onSaveIcs(ics.trim());
    } catch {
      setIcsError("연결하지 못했어요. 주소를 확인하고 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col pb-6 pt-6">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          className="sk-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* 1. 환영 — 한 번 재생되는 소개 영상 + 한 줄 */}
          {step === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center pb-3 text-center">
              <video
                src="./onboarding-welcome.mp4"
                autoPlay
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={(event) => {
                  event.currentTarget.playbackRate = 2;
                }}
                onTimeUpdate={(event) => {
                  const video = event.currentTarget;
                  if (Number.isFinite(video.duration) && video.currentTime >= video.duration * 0.2) {
                    setWelcomeCtaReady(true);
                  }
                }}
                onEnded={() => setWelcomeCtaReady(true)}
                onError={() => setWelcomeCtaReady(true)}
                aria-hidden
                className="mb-3 w-[220px] select-none"
              />
              <h1 className="text-[22px] font-bold leading-snug text-foreground">
                Tody에 오신 것을
                <br />
                환영해요.
              </h1>
              <p className="mt-2 text-[12px] text-muted">일정 관리를 시작해볼까요?</p>
            </div>
          )}

          {/* 기능 안내 — 낙서 스킨의 실제 UI */}
          {isGuide && (
            <div className="flex min-h-full flex-col pb-10">
              <button type="button" onClick={() => onStep(4)} className="self-end cursor-pointer py-1 text-[12px] text-muted hover:text-foreground">건너뛰기</button>
              {step === 1 ? <OverviewOnboardingDemo /> : step === 2 ? <GroupOnboardingDemo /> : <StatsOnboardingDemo />}
              <div className="mb-1 mt-3 text-center">
                {progress}
                <h1 className="text-[22px] leading-snug text-foreground">{step === 1 ? "일정과 할 일을 한눈에." : step === 2 ? "하나의 주제로 모아두기" : "가장 많이 해낸 날은?"}</h1>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">{step === 1 ? <>개인 약속부터 업무 일정까지,<br />한곳에서 관리해요.</> : step === 2 ? "드래그해서 고르고, 그룹으로 묶어요." : "하루 평균 몇 개의 할 일을 처리하는지 확인해요."}</p>
              </div>
            </div>
          )}

          {/* 5. 스케줄 연동 — iCal 주소와 Google 계정 연결을 함께 표시 */}
          {step === 4 && (
            <div className="flex min-h-full flex-col pb-2">
              <div className="text-center">
                <h1 className="text-[22px] leading-snug text-foreground">스케줄 연동을 시작할게요</h1>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">iCal 주소나 Google 계정으로<br />오늘의 일정을 연결해요.</p>
              </div>
              {calConnected ? (
                <div className="flex flex-1 flex-col justify-center py-6">
                  <div className="sk-box flex items-center justify-center gap-2 rounded-xl border border-foreground px-3 py-3 text-[13px] text-foreground">
                    <span aria-hidden>✓</span>
                    <span className="min-w-0 truncate">연결되었어요{googleEmail ? ` · ${googleEmail}` : ""}</span>
                  </div>
                  <p className="mt-3 text-center text-[12px] text-muted">이제 일정과 할 일을 한곳에서 확인해요.</p>
                </div>
              ) : (
                <div className="mt-5">
                  <label htmlFor="onboarding-ical-url" className="block text-[14px] text-foreground">iCal 주소로 연결</label>
                  <div className="mt-1 flex items-end gap-2">
                    <input
                      id="onboarding-ical-url"
                      type="url"
                      value={ics}
                      onChange={(e) => { setIcs(e.target.value); setIcsError(""); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) saveIcs();
                      }}
                      placeholder="복사한 주소를 붙여넣어 주세요"
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby="onboarding-ical-help"
                      aria-invalid={icsError ? true : undefined}
                      className="sk-underline h-11 min-w-0 flex-1 border-b border-foreground bg-transparent py-2 text-[12px] text-foreground outline-none placeholder:text-muted"
                    />
                    <button onClick={saveIcs} disabled={!icsValid || saving} className="h-11 shrink-0 cursor-pointer rounded-xl bg-foreground px-4 text-[14px] text-background disabled:cursor-default disabled:opacity-30">
                      {saving ? "연결 중…" : "연결"}
                    </button>
                  </div>
                  <p id="onboarding-ical-help" className="mt-2 text-[11.5px] text-muted">공개·비공개 iCal 구독 주소 모두 사용할 수 있어요.</p>
                  {icsError && <p role="alert" className="mt-2 text-[12px] text-danger">{icsError}</p>}
                  <details className="mt-3 text-[12px] text-muted">
                    <summary className="cursor-pointer text-foreground">iCal 주소는 어디서 찾나요?</summary>
                    <p className="mt-3 text-foreground">Google 캘린더</p>
                    <ol className="mt-2 space-y-1.5 leading-relaxed">
                      <li>1. 컴퓨터에서 Google 캘린더 → 설정</li>
                      <li>2. 연결할 캘린더 선택 → 캘린더 통합</li>
                      <li>3. iCal 형식의 비공개 주소를 복사해요.</li>
                    </ol>
                    <p className="mt-2 leading-relaxed">이미 공개된 캘린더라면 공개 iCal 주소도 사용할 수 있어요. 연동을 위해 캘린더를 공개로 바꿀 필요는 없어요.</p>
                    <p className="mt-3 text-foreground">iCloud·다른 캘린더</p>
                    <p className="mt-2 leading-relaxed">캘린더에서 제공하는 iCal 구독 주소(https:// 또는 webcal://)를 복사해요. iCloud는 캘린더 공유의 공개 캘린더 링크를 사용할 수 있어요.</p>
                    <p className="mt-2 leading-relaxed">비공개 주소는 다른 사람에게 공유하지 마세요.</p>
                  </details>
                  <div className="my-5 flex items-center gap-3 text-[12px] text-muted" aria-hidden="true">
                    <span className="h-px flex-1 bg-foreground/10" />또는<span className="h-px flex-1 bg-foreground/10" />
                  </div>
                  <button
                    onClick={onGoogleSignIn}
                    disabled={googleBusy}
                    className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-foreground px-4 py-3 text-[14px] text-background hover:opacity-85 disabled:cursor-default disabled:opacity-50"
                  >
                    <GoogleG />
                    {googleBusy ? "브라우저에서 허용을 눌러주세요…" : "Google 계정으로 연결"}
                  </button>
                  <p className="mt-2 text-center text-[11.5px] text-muted">회사 계정이라면 Google 계정으로 연결해주세요.</p>
                  {googleErr && <p role="alert" className="mt-2 text-[12px] text-danger">{googleErr}</p>}
                  <details className="mt-3 text-[12px] text-muted">
                    <summary className="cursor-pointer text-center hover:text-foreground">Google 연결 도움말</summary>
                    <ol className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed">
                      <li>1. 브라우저에서 사용할 Google 계정을 선택해요.</li>
                      <li>2. 확인되지 않은 앱 안내가 나오면 고급 → 앱으로 이동을 선택해요.</li>
                      <li>3. 캘린더 보기 권한을 허용해요.</li>
                      <li>4. 완료 안내가 보이면 Tody로 돌아오세요.</li>
                    </ol>
                    <p className="mt-3 text-[11.5px] leading-relaxed">아직 테스트 중이라 미리 승인된 계정만 연결할 수 있어요. 연결이 막히면 쓰시는 계정을 만든 사람에게 알려주세요.</p>
                  </details>
                </div>
              )}
              <div className="mt-auto pt-3">{progress}</div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 하단: 진행 점 + 버튼 */}
      <div className={`mt-4 flex flex-shrink-0 items-center px-6 ${step === 0 ? "flex-col gap-5" : "justify-between"}`}>
        <div className="flex w-full items-center justify-between gap-2">
          {step > 0 && (
            <button onClick={back} aria-label="이전" className="relative h-11 w-11 cursor-pointer text-[22px] text-foreground">
                <svg aria-hidden="true" viewBox="0 0 44 44" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" fill="none">
                  <path d="M10 2 C18 1 28 2.5 35 1.8 Q42 2 42 10 L41.6 34 Q42 42 34 41.8 L10 42 Q2 42 2.2 34 L1.8 10 Q2 2 10 2 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" filter="url(#sketchy)" />
                </svg>
              ←
            </button>
          )}
          {step === 0 ? (
            <div className="h-[46px] w-full">
              {(welcomeCtaReady || reducedMotion) && (
                <motion.div
                  initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 22 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
                >
                  <TactileStartButton onClick={next} />
                </motion.div>
              )}
            </div>
          ) : step < STEPS - 1 ? (
            <button
              onClick={next}
              className="h-11 w-[128px] cursor-pointer rounded-xl bg-foreground text-[15px] font-semibold text-background hover:opacity-85"
            >
              다음
            </button>
          ) : (
            <button
              onClick={onDone}
              className="h-11 w-[128px] cursor-pointer rounded-xl bg-foreground text-[15px] font-semibold text-background hover:opacity-85"
            >
              {calConnected ? "시작하기" : "나중에 하기"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 접기/펼치기 애니메이션 (높이 + 페이드) ──────────────
function Collapse({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="c"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.2 },
          }}
          style={{ overflow: "hidden" }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── 접을 수 있는 섹션 ────────────────────────────────
function PixelSectionIcon({ kind }: { kind: "calendar" | "tasks" }) {
  return (
    <img
      className="w95-section-icon"
      src={`${import.meta.env.BASE_URL}${kind === "calendar" ? "schedule-calendar.png" : "task-notepad.png"}`}
      width="24"
      height="24"
      alt=""
      aria-hidden="true"
      draggable={false}
      style={kind === "calendar" ? { transform: "scale(1.28)" } : undefined}
    />
  );
}

function ClassicScrollBar({
  targetRef,
  enabled,
  watchKey,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  watchKey: string;
}) {
  const [metrics, setMetrics] = useState({ top: 0, height: 0, content: 0 });
  const drag = useRef<{ pointerId: number; y: number; top: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = targetRef.current;
    if (!el) return;
    const update = () => {
      const next = { top: el.scrollTop, height: el.clientHeight, content: el.scrollHeight };
      setMetrics((prev) =>
        prev.top === next.top && prev.height === next.height && prev.content === next.content ? prev : next,
      );
    };
    const resize = new ResizeObserver(update);
    const observeChildren = () => {
      for (const child of el.children) resize.observe(child);
      update();
    };
    resize.observe(el);
    const mutation = new MutationObserver(observeChildren);
    mutation.observe(el, { childList: true });
    el.addEventListener("scroll", update, { passive: true });
    observeChildren();
    return () => {
      el.removeEventListener("scroll", update);
      mutation.disconnect();
      resize.disconnect();
    };
  }, [targetRef, enabled, watchKey]);

  const maxScroll = Math.max(0, metrics.content - metrics.height);
  if (!enabled || maxScroll <= 1) return null;
  const trackHeight = Math.max(0, metrics.height - 32);
  const thumbHeight = Math.min(trackHeight, Math.max(20, (trackHeight * metrics.height) / metrics.content));
  const thumbRange = Math.max(0, trackHeight - thumbHeight);
  const thumbTop = maxScroll > 0 ? (metrics.top / maxScroll) * thumbRange : 0;
  const move = (amount: number) => targetRef.current?.scrollBy({ top: amount, behavior: "smooth" });

  return (
    <div className="w95-scrollbar" aria-label="본문 스크롤 조절">
      <button className="w95-scroll-button" aria-label="위로 스크롤" onClick={() => move(-40)}>
        <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true">
          <path d="M4 1h2v2h2v2h1v2H1V5h1V3h2z" fill="currentColor" />
        </svg>
      </button>
      <div
        className="w95-scroll-track"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
          move(y < thumbTop ? -metrics.height : metrics.height);
        }}
      >
        <div
          className="w95-scroll-thumb"
          role="scrollbar"
          tabIndex={0}
          aria-label="본문 스크롤 위치"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={Math.round(maxScroll)}
          aria-valuenow={Math.round(metrics.top)}
          style={{ height: thumbHeight, top: thumbTop }}
          onPointerDown={(e) => {
            drag.current = { pointerId: e.pointerId, y: e.clientY, top: metrics.top };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
          onPointerMove={(e) => {
            if (drag.current?.pointerId !== e.pointerId || thumbRange === 0) return;
            targetRef.current?.scrollTo({ top: drag.current.top + ((e.clientY - drag.current.y) / thumbRange) * maxScroll });
          }}
          onPointerUp={(e) => {
            if (drag.current?.pointerId === e.pointerId) {
              drag.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown") {
              e.preventDefault();
              move((e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : e.key === "PageUp" ? -metrics.height / 40 : metrics.height / 40) * 40);
            }
          }}
        />
      </div>
      <button className="w95-scroll-button" aria-label="아래로 스크롤" onClick={() => move(40)}>
        <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true">
          <path d="M1 3h8v2H8v2H6v2H4V7H2V5H1z" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

function Section({
  title,
  children,
  onDrop,
}: {
  title: string;
  children: React.ReactNode;
  onDrop?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [over, setOver] = useState(false);
  return (
    <div className="mt-5">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        onDragOver={(e) => {
          if (!onDrop) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!onDrop) return;
          e.preventDefault();
          setOver(false);
          onDrop();
        }}
        className={`sk-section-toggle flex cursor-pointer items-center gap-2 rounded-md px-1 text-[14px] font-bold text-foreground transition-colors ${
          over ? "bg-background-secondary" : ""
        }`}
      >
        <span
          aria-hidden="true"
          className="sk-section-arrow text-[8px] transition-transform duration-300 ease-out"
          style={{ transform: expanded ? undefined : "rotate(-90deg)" }}
        >
          ▼
        </span>
        <PixelSectionIcon kind={title === "Schedule" ? "calendar" : "tasks"} />
        {title}
      </button>
      <Collapse open={expanded}>
        <div className="mt-2">{children}</div>
      </Collapse>
    </div>
  );
}

// ─── 그룹 (Tasks 안의 하위 묶음) ───────────────────────
function Group({
  name,
  children,
  onContext,
  dropOver,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  name: string;
  children: React.ReactNode;
  onContext?: (x: number, y: number) => void;
  dropOver?: boolean;
  onDragOver?: () => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="mt-2 pl-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContext?.(e.clientX, e.clientY);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOver?.();
        }}
        onDragLeave={() => onDragLeave?.()}
        onDrop={(e) => {
          e.preventDefault();
          onDrop?.();
        }}
        className={`flex cursor-pointer items-center gap-1.5 rounded-md px-1 text-[12.5px] font-normal transition-colors ${
          dropOver ? "bg-background-secondary text-foreground" : "text-muted"
        }`}
      >
        <span
          className={`text-[7px] transition-transform duration-300 ease-out ${expanded ? "" : "-rotate-90"}`}
        >
          ▼
        </span>
        {name}
      </button>
      <Collapse open={expanded}>
        <div>{children}</div>
      </Collapse>
    </div>
  );
}

// ─── 앱 ─────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks] = useState<Task[]>(load);
  const [seg, setSeg] = useState<Status>("todo");
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(!isElectron || DEV_FORCE_NEW_USER || !loadOnboardedPeek());

  // ── 구글캘린더 (ICS) ──
  const [events, setEvents] = useState<CalEvent[]>(
    isElectron ? [] : MOCK_EVENTS,
  );
  const [calConfigured, setCalConfigured] = useState(true);
  const [icsInput, setIcsInput] = useState("");

  const [calError, setCalError] = useState<"rate_limited" | "offline" | "error" | "signed_out" | null>(null);
  // ── Google 로그인 ──
  const [google, setGoogle] = useState<GoogleStatus>({ signedIn: false, email: "", clientConfigured: false });
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleErr, setGoogleErr] = useState("");
  const refreshGoogle = async () => {
    if (!window.widget) return;
    setGoogle(await window.widget.googleStatus());
  };
  const googleSignIn = async () => {
    if (!window.widget) return;
    setGoogleBusy(true);
    setGoogleErr("");
    try {
      const r = await window.widget.googleSignIn();
      if (!r.ok)
        setGoogleErr(
          r.reason === "timeout"
            ? "시간이 지나 취소됐어요. 다시 시도해주세요"
            : r.reason === "access_denied"
              ? "허용이 취소됐거나 아직 승인되지 않은 계정이에요"
              : r.reason === "no_client"
                ? "앱 설정이 없어요 (개발자에게 문의)"
                : "연결에 실패했어요. 다시 시도해주세요",
        );
      await refreshGoogle();
      await refreshEvents();
    } finally {
      setGoogleBusy(false);
    }
  };
  const googleSignOut = async () => {
    await window.widget?.googleSignOut();
    await refreshGoogle();
    await refreshEvents();
  };
  useEffect(() => {
    if (isElectron) refreshGoogle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const calFails = useRef(0);
  const refreshEvents = async () => {
    if (!window.widget) return;
    const r = await window.widget.calendarEvents();
    setCalConfigured(r.configured);
    if (r.configured) setEvents(r.events); // 실패해도 main이 캠시를 넘김
    setCalError(r.error ?? null);
    calFails.current = r.error ? calFails.current + 1 : 0;
  };

  useEffect(() => {
    if (!isElectron) return;
    refreshEvents();
    // 5분마다 갱신. 실패가 이어지면 간격을 늘려(10→20→40분) 구글 요청 제한을 더 자극하지 않는다
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const mins = Math.min(40, 5 * 2 ** calFails.current);
      timer = setTimeout(async () => {
        await refreshEvents();
        schedule();
      }, mins * 60 * 1000);
    };
    schedule();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveIcsUrl = async () => {
    const url = icsInput.trim();
    if (!/^(https?|webcal):\/\//i.test(url)) return;
    await window.widget?.calendarSetUrl(url);
    setIcsInput("");
    setSavedIcsUrl(url);
    refreshEvents();
  };

  // ── 온보딩 ──
  const [onboarded, setOnboarded] = useState<boolean>(loadOnboarded);
  const [showSkinPicker, setShowSkinPicker] = useState(false);
  const onboardedRef = useRef(onboarded);
  onboardedRef.current = onboarded;
  // 온보딩 중엔 창을 화면 정가운데에, 끝나면 원래 자리(우하단)로
  const wasOnboarded = useRef(onboarded);
  useEffect(() => {
    if (!isElectron) return;
    if (!onboarded || showSkinPicker) {
      // 온보딩과 첫 스킨 선택 중에는 패널을 화면 정가운데에 (앱 시작 직후 main이 위치를 다시 잡을 수 있어 한 박자 뒤 재적용)
      const apply = () => {
        window.widget?.centerWindow(open);
        if (open) window.widget?.setMode("panel");
      };
      apply();
      const t = setTimeout(apply, 400);
      return () => clearTimeout(t);
    }
    // 온보딩을 막 끝낸 순간에만 기본 자리로 복귀.
    // 그 뒤에는 위치를 건드리지 않는다 — 사용자가 옮겨둔 자리를 유지하기 위해.
    if (!wasOnboarded.current) {
      window.widget?.centerWindow(false);
      wasOnboarded.current = true;
    }
  }, [onboarded, open, showSkinPicker]);
  const finishOnboarding = () => {
    // DEV 강제 모드에서는 실제 상태를 저장하지 않고 화면만 닫는다 (새로고침하면 다시 보임)
    if (!DEV_FORCE_NEW_USER) localStorage.setItem(ONBOARDED_KEY, "1");
    setShowSkinPicker(true);
    setOnboarded(true);
  };

  // ── 정보 / 업데이트 확인 ──
  const [appVersion, setAppVersion] = useState<string>(WEB_VERSION);
  const [updInfo, setUpdInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const checkUpdate = async () => {
    if (!window.widget) return;
    setChecking(true);
    try {
      setUpdInfo(await window.widget.checkUpdate());
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    if (!isElectron) return;
    window.widget?.appVersion().then(setAppVersion);
    // 켤 때 1회 조용히 확인
    checkUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 설정 화면 ──
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedIcsUrl, setSavedIcsUrl] = useState("");
  const [showFullUrl, setShowFullUrl] = useState(false);
  const [calEditing, setCalEditing] = useState(false); // 주소 입력창 펼침
  // iCal 주소가 있거나, 로컬 동기화 파일로 일정이 들어오고 있으면 연결된 상태
  // "연결됨"은 실제로 동작할 때만: 구글 로그인 상태이거나, ICS 주소로 오류 없이 일정을 받아오는 중
  const calConnected =
    google.signedIn || (calConfigured && !calError && (!!savedIcsUrl || events.length > 0));

  useEffect(() => {
    if (!settingsOpen || !window.widget) return;
    window.widget.calendarGetUrl().then(setSavedIcsUrl);
    setShowFullUrl(false);
    setCalEditing(false);
  }, [settingsOpen]);

  const removeIcsUrl = async () => {
    await window.widget?.calendarSetUrl("");
    setSavedIcsUrl("");
    setEvents([]);
    setCalConfigured(false);
  };

  // ── 위치 (화면에 띄우기 / 메뉴 막대) ──
  const [placement, setPlacement] = useState<Placement>("floating");
  useEffect(() => {
    if (!window.widget) return;
    window.widget.getPlacement().then(setPlacement);
    const offP = window.widget.onPlacement((p) => {
      setPlacement(p);
      if (p === "menubar") setOpen(true); // 메뉴 막대엔 위젯 모드가 없음
      else if (onboardedRef.current) {
        setOpen(false); // 화면에 띄우기로 복귀 → 작은 위젯부터 (온보딩 중에는 패널 열린 상태 유지)
        setSettingsOpen(false);
      }
    });
    const offS = window.widget.onPanelShown((fromTray) => {
      refreshEvents();
      if (fromTray) setSettingsOpen(false); // 메뉴 막대에서 열면 항상 투두 화면
    });
    return () => {
      offP();
      offS();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changePlacement = (p: Placement) => {
    setPlacement(p);
    if (p === "menubar") setOpen(true);
    else {
      setOpen(false);
      setSettingsOpen(false);
    }
    window.widget?.setPlacement(p);
  };

  // ── Done 분석 보기 ──
  const [showStats, setShowStats] = useState(false);

  // ── 완료 표시 스타일 ──
  const [look, setLook] = useState<Look>(loadLook);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 온보딩은 낙서로 유지하고, 완료한 뒤 선택한 스킨을 앱에 적용한다.
    applyLook(onboarded ? look : "sketch");
  }, [look, onboarded]);
  useEffect(() => {
    localStorage.setItem("my-day-look", look);
  }, [look]);
  // 낙서 스킨이면 완료 선도 낙서선으로
  const strike: StrikeStyle = look === "sketch" ? "scribble" : "line";

  // ── 테마 ──
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("my-day-theme", theme);
    if (theme !== "system") return;
    // 시스템 모드일 땐 OS 변경을 실시간 반영
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // 패널을 여는 중(창은 커졌지만 아직 패널을 그리기 전) 구간.
  // 이 동안 클릭 통과를 켜거나 포커스 아웃으로 접으면 "열리자마자 닫히는" 현상이 생긴다.
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  openingRef.current = opening;
  const openRef = useRef(false);
  openRef.current = open;

  // 패널이 펼쳐지면 Add task 입력에 바로 포커스 → 알약 클릭 후 곧장 타이핑
  const addInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open || !onboarded || settingsOpen || seg !== "todo") return;
    // 패널 등장 애니메이션이 끝난 뒤(≈0.4s) 포커스. 목록이 튀지 않게 스크롤은 건드리지 않음
    const t = window.setTimeout(() => addInputRef.current?.focus({ preventScroll: true }), 420);
    return () => window.clearTimeout(t);
  }, [open, onboarded, settingsOpen, seg]);

  const openPanel = () => {
    if (!isElectron) {
      setOpen(true);
      refreshEvents();
      return;
    }
    setOpening(true);
    window.widget?.setMode("panel"); // main이 창을 패널 크기로 키운 뒤 신호를 보낸다
    if (!onboardedRef.current) window.widget?.centerWindow(true);
  };

  // 메뉴 막대 아이콘에서 "열기" → 위젯 모드에서도 패널을 연다
  useEffect(() => {
    if (!isElectron) return;
    return window.widget?.onOpenPanel(() => {
      if (!openRef.current) openPanel();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 창이 패널 크기가 되면 그때 패널을 그린다 (작은 창에 그려서 잘리는 것 방지)
  useEffect(() => {
    if (!isElectron) return;
    return window.widget?.onPanelWindowReady(() => {
      setOpen(true);
      setOpening(false);
      refreshEvents();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 다른 곳 클릭(포커스 아웃) → 패널을 위젯으로 접기
  useEffect(() => {
    if (!isElectron) return;
    return window.widget?.onBlur(() => {
      // 온보딩 중이거나 패널을 여는 중에는 접지 않음
      if (!onboardedRef.current || openingRef.current || document.querySelector(".skin-picker[open]")) return;
      // (화면에 띄우기 모드에서만 도착 — 메뉴 막대 모드는 main이 창을 숨김)
      setOpen((o) => {
        if (o) window.widget?.setMode("widget");
        return false;
      });
      setSettingsOpen(false); // 접힐 때 설정 화면도 닫기
    });
  }, []);

  // 위젯 드래그 (움직임이 거의 없으면 클릭으로 간주)
  const drag = useRef({ lastX: 0, lastY: 0, moved: 0 });
  const onWidgetMouseDown = (e: React.MouseEvent) => {
    drag.current = { lastX: e.screenX, lastY: e.screenY, moved: 0 };
    const onMove = (ev: MouseEvent) => {
      const d = drag.current;
      const dx = ev.screenX - d.lastX;
      const dy = ev.screenY - d.lastY;
      d.lastX = ev.screenX;
      d.lastY = ev.screenY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      window.widget?.moveBy(dx, dy);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (drag.current.moved < 6) openPanel();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    if (!onboarded) return; // 온보딩 전엔 저장 안 함
    localStorage.setItem("my-day-tasks", JSON.stringify(tasks));
  }, [tasks, onboarded]);

  const byStatus = useMemo(
    () => ({
      todo: tasks.filter((t) => t.status === "todo"),
      later: tasks.filter((t) => t.status === "later"),
      done: tasks.filter((t) => t.status === "done"),
    }),
    [tasks],
  );

  // ── 그룹/정렬 ──
  const todos = byStatus.todo;
  // 미완료 멤버가 남아있는 그룹만 To-do 탭에 유지 (전부 완료되면 그룹째 Done으로)
  const allGroupNames = [
    ...new Set(tasks.filter((t) => t.group).map((t) => t.group!)),
  ];
  const activeGroups = allGroupNames.filter((g) =>
    tasks.some((t) => t.group === g && t.status !== "done"),
  );
  // 그룹 멤버: 미완료 먼저, 완료는 아래로
  const groupMembers = (g: string) => {
    const members = tasks.filter(
      (t) => t.group === g && (t.status === "todo" || t.status === "done"),
    );
    return [
      ...members.filter((t) => t.status !== "done"),
      ...members.filter((t) => t.status === "done"),
    ];
  };
  const ungrouped = todos.filter((t) => !t.group);
  const orderedTodos = [
    ...ungrouped,
    ...activeGroups.flatMap((g) => todos.filter((t) => t.group === g)),
  ];
  // Done 탭: 아직 진행 중인 그룹의 완료 항목은 제외
  const doneList = byStatus.done.filter(
    (t) => !t.group || !activeGroups.includes(t.group),
  );
  // 완료 날짜별로 묶기 (최신 날짜 먼저)
  const doneByDate = Object.entries(
    doneList.reduce<Record<string, Task[]>>((acc, t) => {
      const d = t.doneAt || t.created;
      (acc[d] ||= []).push(t);
      return acc;
    }, {}),
  ).sort(([a], [b]) => (a < b ? 1 : -1));
  const orderedRef = useRef<Task[]>(orderedTodos);
  orderedRef.current = orderedTodos;

  // ── 드래그 다중 선택 ──
  const [sel, setSel] = useState<{ anchor: number; head: number } | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const draggingSel = useRef(false);
  const [groupPrompt, setGroupPrompt] = useState<string[] | null>(null);
  const [groupName, setGroupName] = useState("");

  // 선택 범위가 2개 이상이면 그룹명 입력창 띄우기, 아니면 해제
  const finishSel = () => {
    const s = selRef.current;
    if (s && Math.abs(s.head - s.anchor) >= 1) {
      const [a, b] = [Math.min(s.anchor, s.head), Math.max(s.anchor, s.head)];
      const picked = orderedRef.current.slice(a, b + 1);
      setGroupPrompt(picked.map((t) => t.id));
      // 선택 항목들이 같은 첫 단어로 시작하면 그룹명 미리 채움
      const firsts = picked.map((t) => t.title.trim().split(/\s+/)[0]);
      const common =
        firsts.length > 0 && firsts.every((f) => f === firsts[0]) && firsts[0].length >= 2
          ? firsts[0]
          : "";
      setGroupName(common);
    } else {
      setSel(null);
    }
  };

  // 마우스 좌표 아래에 있는 행의 인덱스 (행 사이 틈/그룹 헤더 위에선 null)
  const rowIdxAt = (x: number, y: number): number | null => {
    const el = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-sel-idx]");
    if (!el) return null;
    const n = Number(el.dataset.selIdx);
    return Number.isFinite(n) ? n : null;
  };

  const startSel = (idx: number) => {
    if (seg !== "todo") return;
    draggingSel.current = true;
    setGroupPrompt(null);
    setSel({ anchor: idx, head: idx });
    // 행 mouseenter 대신 window에서 좌표로 추적 → 틈/손잡이/헤더를 지나가도 안 끊김
    const move = (e: MouseEvent) => {
      const i = rowIdxAt(e.clientX, e.clientY);
      if (i !== null) setSel((s) => (s && s.head !== i ? { ...s, head: i } : s));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      draggingSel.current = false;
      finishSel();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const enterSel = (idx: number) => {
    if (draggingSel.current) setSel((s) => (s ? { ...s, head: idx } : s));
  };
  // Shift+클릭: 앵커(직전 클릭/선택)부터 여기까지 범위 선택
  const shiftSel = (idx: number) => {
    if (seg !== "todo") return;
    setGroupPrompt(null);
    const s = selRef.current;
    const next = s ? { anchor: s.anchor, head: idx } : { anchor: idx, head: idx };
    selRef.current = next;
    setSel(next);
    finishSel();
  };
  const isSelIdx = (i: number) => {
    if (!sel) return false;
    const a = Math.min(sel.anchor, sel.head);
    const b = Math.max(sel.anchor, sel.head);
    return i >= a && i <= b;
  };

  const createGroup = () => {
    if (!groupPrompt) return;
    const name = groupName.trim() || "New group";
    setTasks((ts) =>
      ts.map((t) => {
        if (!groupPrompt.includes(t.id)) return t;
        // 제목이 그룹명으로 시작하면 접두어 제거 (예: "마케팅 기확서" → "기확서")
        const stripped = t.title.startsWith(name + " ")
          ? t.title.slice(name.length).trim()
          : t.title;
        return { ...t, group: name, title: stripped || t.title };
      }),
    );
    cancelGroup();
  };
  const cancelGroup = () => {
    setGroupPrompt(null);
    setGroupName("");
    setSel(null);
  };

  const update = (id: string, patch: Partial<Task>) =>
    setTasks((ts) =>
      ts.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        // To-do 를 벗어나면(Later / Done) 그룹에서 자동으로 무어진다 — 그룹은 오늘 할 일을 묶는 것이므로
        if (patch.status && patch.status !== "todo") next.group = undefined;
        return next;
      }),
    );

  const removeTask = (id: string) =>
    setTasks((ts) => ts.filter((t) => t.id !== id));

  // 선택(그룹 프롬프트 떠 있는) 항목 일괄 삭제
  const removeSelected = () => {
    if (!groupPrompt || groupPrompt.length === 0) return;
    const ids = new Set(groupPrompt);
    setTasks((ts) => ts.filter((t) => !ids.has(t.id)));
    cancelGroup();
  };
  // 여러 개 잡은 상태에서 Backspace/Delete → 삭제 (입력창에 포컬스가 있을 끔 그 입력창의 onKeyDown이 처리)
  useEffect(() => {
    if (!groupPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      removeSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPrompt]);

  // ── 우클릭 컨텍스트 메뉴 ──
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const ctxTask = ctxMenu ? tasks.find((t) => t.id === ctxMenu.id) : null;
  const [ctxGroup, setCtxGroup] = useState<{
    x: number;
    y: number;
    name: string;
  } | null>(null);

  const ungroupAll = (name: string) =>
    setTasks((ts) =>
      ts.map((t) => (t.group === name ? { ...t, group: undefined } : t)),
    );

  useEffect(() => {
    if (!ctxMenu && !ctxGroup) return;
    const close = () => {
      setCtxMenu(null);
      setCtxGroup(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [ctxMenu, ctxGroup]);

  const addTask = () => {
    const title = input.trim();
    if (!title) return;
    setInput("");
    // 항상 그룹 밖(일반 목록)에 추가 — 그룹 배치는 드래그로 직접
    setTasks((ts) => [
      ...ts,
      { id: uid(), title, status: "todo", flag: false, created: today() },
    ]);
  };

  // 할일 추가 줄. 낙서/윈도우 스킨 모두 패널 맨 아래에 고정
  const addTaskRow = (
        <div className="sk-addrow mt-1 flex items-center pl-6">
          <input
            ref={addInputRef}
            placeholder="+ Add task"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중 Enter(IME)는 무시 → 마지막 글자 중복 추가 방지
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") addTask();
            }}
            className="sk-underline w-full min-w-0 flex-1 rounded-none border-0 border-b border-transparent bg-transparent py-2 font-mono text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted focus:border-foreground"
          />
          {/* Win95 스킨 전용 보내기 버튼 — 콤보박스 화살표 자리. 다른 스킨은 CSS로 숨김 */}
          <button
            type="button"
            aria-label="추가"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()} // 입력 포커스 유지
            onClick={addTask}
            disabled={!input.trim()}
            className="w95-send hidden"
          >
            {/* Win95: 픽셀 삼각형 */}
            <svg className="ico-tri" width="7" height="7" viewBox="0 0 7 7" aria-hidden shapeRendering="crispEdges">
              <polygon points="0,0 7,3.5 0,7" fill="currentColor" />
            </svg>
            {/* 낙서: 손으로 칠한 종이비행기 (살짝 비뚤게) */}
            <svg className="ico-plane" width="20" height="20" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M2.2 11.6 C 8 9.1, 15 5.8, 21.8 2.6 C 20.1 8.4, 17.6 15.2, 14.9 21.4 C 13.5 18.9, 12.2 16.6, 10.6 14.1 C 7.9 13.2, 5 12.4, 2.2 11.6 Z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
              <path d="M10.8 14 C 14.2 10.6, 17.8 6.9, 21.4 3.2" fill="none" stroke="var(--paper, #fff)" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M10.7 14.2 C 10.4 15.9, 10.2 17.3, 10 18.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
            {/* 낙서: 손글씨 '추가' */}
            <span className="ico-text">추가</span>
          </button>
        </div>
  );


  const d = new Date();
  const dateLabel = `${d.toLocaleDateString("en-US", { month: "long", day: "2-digit" })}, ${d.toLocaleDateString("en-US", { weekday: "long" })}`;

  const todoCount = byStatus.todo.length;
  // 종료 시각이 지난 일정은 목록에서 제외
  const upcomingEvents = events.filter((ev) => ev.end >= nowHM());
  const nextEvent = upcomingEvents.find((ev) => ev.start >= nowHM());

  const openCtx = (t: Task) => (x: number, y: number) =>
    setCtxMenu({ x, y, id: t.id });

  // ── 드래그&드롭 이동 (⠿ 손잡이) ──
  const dragIdRef = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<{
    id: string;
    pos: "before" | "after";
  } | null>(null);
  const dropAtRef = useRef(dropAt);
  dropAtRef.current = dropAt;
  const [overGroup, setOverGroup] = useState<string | null>(null);

  const endDrag = () => {
    dragIdRef.current = null;
    setDropAt(null);
    setOverGroup(null);
  };

  // 대상 행 앞/뒤로 이동 + 대상의 그룹을 따라감
  const moveTaskTo = (targetId: string) => {
    const id = dragIdRef.current;
    const pos = dropAtRef.current?.pos ?? "after";
    if (!id || id === targetId) return endDrag();
    setTasks((ts) => {
      const dragged = ts.find((t) => t.id === id);
      const target = ts.find((t) => t.id === targetId);
      if (!dragged || !target) return ts;
      const rest = ts.filter((t) => t.id !== id);
      const idx = rest.findIndex((t) => t.id === targetId);
      const at = pos === "before" ? idx : idx + 1;
      const moved = { ...dragged, group: target.group };
      return [...rest.slice(0, at), moved, ...rest.slice(at)];
    });
    endDrag();
  };

  // 그룹 헤더에 드롭 → 그룹 맨 뒤로
  const dropIntoGroup = (name: string | undefined) => {
    const id = dragIdRef.current;
    if (!id) return endDrag();
    setTasks((ts) => {
      const dragged = ts.find((t) => t.id === id);
      if (!dragged) return ts;
      const rest = ts.filter((t) => t.id !== id);
      return [...rest, { ...dragged, group: name }];
    });
    endDrag();
  };

  const dragPropsFor = (t: Task) => ({
    onDragStart: () => {
      dragIdRef.current = t.id;
    },
    onDragOver: (pos: "before" | "after") =>
      setDropAt((d) => (d?.id === t.id && d.pos === pos ? d : { id: t.id, pos })),
    onDragLeave: () => setDropAt((d) => (d?.id === t.id ? null : d)),
    onDrop: () => moveTaskTo(t.id),
    onDragEnd: endDrag,
    indicator: dropAt?.id === t.id ? dropAt.pos : null,
  });

  // 그룹 만들기 프롬프트 (선택된 마지막 항목 바로 아래에 렌더)
  const groupPromptEl = groupPrompt && (
    <div className="my-1.5 flex items-center gap-2 rounded-lg bg-background-secondary py-2 pl-6 pr-3">
      <span className="text-[13.5px] font-bold text-foreground">
        {groupPrompt.length} →
      </span>
      <input
        autoFocus
        placeholder="Group name"
        value={groupName}
        onChange={(e) => setGroupName(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") createGroup();
          if (e.key === "Escape") cancelGroup();
          // 그룹명이 뱄 상태에서 Backspace → 선택한 항목 삭제
          if ((e.key === "Backspace" || e.key === "Delete") && groupName === "") {
            e.preventDefault();
            removeSelected();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="sk-underline w-20 flex-1 border-b border-transparent bg-transparent font-mono text-[13.5px] text-foreground outline-none placeholder:text-muted focus:border-foreground"
      />
      <button
        onClick={createGroup}
        onMouseDown={(e) => e.stopPropagation()}
        className="cursor-pointer text-[13px] font-bold text-foreground hover:opacity-70"
      >
        group
      </button>
      <button
        onClick={cancelGroup}
        onMouseDown={(e) => e.stopPropagation()}
        className="cursor-pointer text-[13px] text-muted hover:opacity-70"
      >
        ✕
      </button>
    </div>
  );

  const rowProps = (t: Task) => {
    if (t.status !== "todo")
      return { task: t, onUpdate: update, onContext: openCtx(t) };
    const idx = orderedTodos.findIndex((x) => x.id === t.id);
    return {
      task: t,
      onUpdate: update,
      onContext: openCtx(t),
      selected: isSelIdx(idx),
      selIdx: idx,
      onSelStart: () => startSel(idx),
      onSelEnter: () => enterSel(idx),
      onSelShift: () => shiftSel(idx),
      drag: dragPropsFor(t),
    };
  };

  // ── 미니 위젯 모드 (Electron) ──
  // 메뉴 막대에 보일 요약 글자 (메뉴 막대 모드일 때만)
  const trayTitle = (() => {
    if (!nextEvent) return `${todoCount}`;
    const name =
      nextEvent.name.length > 14 ? nextEvent.name.slice(0, 14) + "…" : nextEvent.name;
    return `${todoCount} · ${nextEvent.start} ${name}`;
  })();
  useEffect(() => {
    if (!isElectron || placement !== "menubar") return;
    window.widget?.setTrayTitle(trayTitle);
  }, [placement, trayTitle]);

  // 알약(미니 위젯) — hover 시에만 클릭을 받고, 나문 투명 영역은 뒤 화면으로 클릭 통과
  const [hoverPill, setHoverPill] = useState(false);
  // 알약 실제 크기를 main에 알려줘 창 크기를 맞춘다 (내용에 따라 폭이 달라짐)
  // 알약은 "최종 위치"에 절대 배치된다 — 닫힘 애니메이션이 끝난 뒤 위치를 보정하지 않기 위해
  const [pillOffset, setPillOffset] = useState({ left: 28, top: 28 });
  const [{ w: pillW, h: pillH }, setPillWH] = useState({ w: 180, h: 48 });
  useEffect(() => {
    if (!isElectron) return;
    return window.widget?.onPillOffset(setPillOffset);
  }, []);
  const pillRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isElectron || open) return;
    const el = pillRef.current;
    if (!el) return;
    const report = () => {
      // getBoundingClientRect 는 hover/등장 애니메이션의 scale 까지 반영해 값이 흔들린다.
      // 레이아웃 크기(offsetWidth/Height)만 써야 창 크기가 매번 같은 값으로 잡힌다.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0) {
        setPillWH({ w, h });
        window.widget?.pillSize(w, h);
      }
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, todoCount, nextEvent]);
  useEffect(() => {
    if (!isElectron) return;
    if (placement !== "floating") return window.widget?.ignoreMouse(false);
    window.widget?.ignoreMouse(!open && !opening && !hoverPill);
  }, [open, opening, hoverPill, placement]);

  const pillEl = (
    <motion.div
      key="pill"
      // 창 크기가 달라져도 같은 기준(오른쪽·아래 14px)에 붙는다 — 정렬 방식이 바뀌면 x 좌표가 튄다
      className="absolute"
      style={{ left: pillOffset.left, top: pillOffset.top }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      onAnimationComplete={() => {
        // 등장/퇴장 모두 여기로 오므로, 알약이 "보이는" 상태일 때만 창 축소를 요청한다
        if (!openRef.current) window.widget?.pillReady();
      }}
      onMouseEnter={() => setHoverPill(true)}
      onMouseLeave={() => setHoverPill(false)}
    >
      {/* 낙서 스킨 필터 — 패널이 닫혀 있을 때도 알약 테두리가 그리어지도록 */}
      <SketchFilter />
      <button
        ref={pillRef}
        onMouseDown={onWidgetMouseDown}
        className="sk-pill flex cursor-grab items-center gap-2.5 rounded-full border border-black/8 bg-white py-3 pl-5 pr-5 shadow-[0_5px_16px_rgba(0,0,0,0.16)] transition-transform hover:scale-[1.03] active:cursor-grabbing dark:border-white/10 dark:bg-background-secondary/75"
      >
        <span className="flex-shrink-0 whitespace-nowrap text-[13px] font-bold text-foreground">
          ☑ {todoCount}
        </span>
        <span className="max-w-[130px] truncate whitespace-nowrap text-[12px] text-muted">
          {nextEvent ? `${nextEvent.start} ${nextEvent.name}` : "No events"}
        </span>
      </button>
    </motion.div>
  );

  // 패널 (바깥 회색 컨테이너)
  const panelEl = (
    <StrikeCtx.Provider value={strike}>
      <div
        className="sk-outer flex h-[600px] w-[360px] flex-col overflow-hidden rounded-[28px] bg-background-secondary shadow-[0_6px_20px_rgba(0,0,0,0.18)]"
      >
        <SketchFilter />
        {/* 날짜 헤더 (드래그 핸들) — 열릴 때 살짝 아래에서 떠오름 */}
        <motion.div
          style={
            isElectron
              ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
              : undefined
          }
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="sk-head relative py-4 text-center text-[13px] font-medium tracking-wide text-foreground/80"
        >
          {dateLabel}
          {!onboarded && isElectron && (
            <button
              onClick={() => {
                // 온보딩을 마치기 전엔 위젯이 없다 → ✕는 앱 종료. 다시 켜면 온보딩부터 (완료 상태 저장 안 됨)
                window.widget?.quitApp();
              }}
              aria-label="닫기"
              style={isElectron ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
              className="absolute right-4 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted outline-none transition-colors hover:text-foreground focus:outline-none"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
          {onboarded && look === "win95" && placement === "floating" && (
            <button
              onClick={() => {
                setOpen(false);
                setSettingsOpen(false);
                window.widget?.setMode("widget");
              }}
              aria-label="접기"
              style={isElectron ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
              className="w95-close absolute right-1.5 top-1/2 flex h-[18px] w-[18px] -translate-y-1/2 cursor-pointer items-center justify-center text-black"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
              </svg>
            </button>
          )}
          {onboarded && (
          <button
            onClick={(e) => {
              setSettingsOpen((v) => !v);
              e.currentTarget.blur(); // 클릭 후 포커스 링(노란 테두리) 방지
            }}
            aria-label="설정"
            aria-pressed={settingsOpen}
            style={
              isElectron
                ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
                : undefined
            }
            className={`sk-gear absolute right-4 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none transition-colors hover:text-foreground focus:outline-none focus-visible:outline-none ${
              settingsOpen ? "bg-surface text-foreground" : "text-muted"
            }`}
          >
            <GearIcon />
          </button>
          )}
        </motion.div>

        {/* 안쪽 흰 패널 — 헤더보다 한 박자 뒦게 아래에서 페이드인 */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.09, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="sk-panel mx-2.5 mb-2.5 flex flex-1 flex-col overflow-hidden rounded-[22px] bg-surface"
        >
          {!onboarded ? (
            <Onboarding
              step={onboardingStep}
              onStep={setOnboardingStep}
              calConnected={DEV_FORCE_NEW_USER && !isElectron ? false : calConnected}
              googleEmail={google.email}
              googleBusy={googleBusy}
              googleErr={googleErr}
              onGoogleSignIn={googleSignIn}
              onSaveIcs={async (url) => {
                await window.widget?.calendarSetUrl(url);
                setSavedIcsUrl(url);
                refreshEvents();
              }}
              onDone={finishOnboarding}
            />
          ) : (
          <>
          {/* 상태 세그먼트 (설정 화면에선 제목으로 대체) */}
          {settingsOpen ? (
            <div className="px-4 pt-4">
              <button
                onClick={() => setSettingsOpen(false)}
                aria-label="돌아가기"
                className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-background-secondary hover:text-foreground"
              >
                <span aria-hidden>←</span>
                <span>돌아가기</span>
              </button>
            </div>
          ) : (
          <div className="px-4 pt-4">
            <div className="min-w-0">
              <Tabs
                selectedKey={seg}
                onSelectionChange={(k) => {
                  setSeg(k as Status);
                  setSettingsOpen(false);
                }}
              >
                <Tabs.ListContainer className="w-full">
                  <Tabs.List aria-label="상태 필터" className="w-full">
                    {(
                      [
                        ["todo", "To-do"],
                        ["later", "Later"],
                        ["done", "Done"],
                      ] as const
                    ).map(([key, label]) => (
                      <Tabs.Tab
                        id={key}
                        key={key}
                        className="flex-1 whitespace-nowrap px-2 font-mono"
                      >
                        {label}{" "}
                        {key === "done" ? doneList.length : byStatus[key].length}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.ListContainer>
              </Tabs>
            </div>
          </div>
          )}

          {/* 본문 — 탭/설정 전환 시 내용이 아래에서 위로 떠오름 */}
          <div className={`sk-body flex min-h-0 flex-1 flex-col ${settingsOpen ? "sk-settings" : ""}`}>
          <div className="sk-scroll-frame flex min-h-0 flex-1">
          <div ref={mainScrollRef} className="sk-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={settingsOpen ? "settings" : seg}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{
              opacity: { duration: 0.3, ease: "easeOut" },
              y: { duration: 0.34, ease: [0.22, 1, 0.36, 1] },
            }}
            style={{ willChange: "opacity, transform" }}
          >
            {settingsOpen && (
              <div className="mt-5 flex flex-col gap-7">
                {/* ── 일반 ── */}
                <SettingCard title="일반">
                  <SettingRow
                    label="테마"
                    desc="Auto는 macOS 설정을 따라요"
                  >
                    <Dropdown<Theme>
                      value={theme}
                      onChange={setTheme}
                      options={[
                        ["light", "Light"],
                        ["dark", "Dark"],
                        ["system", "Auto"],
                      ]}
                    />
                  </SettingRow>
                  <SettingRow
                    label="스킨"
                    desc={
                      look === "sketch"
                        ? "종이에 손으로 그린 듯한 낙서 스킨이에요"
                        : "회색 창과 파란 제목 막대, 그 시절 그 느낌"
                    }
                  >
                    <Dropdown<Look>
                      value={look}
                      onChange={setLook}
                      options={[
                        ["sketch", "낙서"],
                        ["win95", "윈도우"],
                      ]}
                    />
                  </SettingRow>
                  {isElectron && (
                    <SettingRow
                      label="위치"
                      desc={
                        placement === "menubar"
                          ? "상단 메뉴 막대에 표시되고, 클릭하면 우쪽 아래에 열려요"
                          : "항상 위에 뜨는 작은 위젯으로 표시되요"
                      }
                    >
                      <Dropdown<Placement>
                        value={placement}
                        onChange={changePlacement}
                        width={140}
                        options={[
                          ["floating", PLACEMENT_LABEL.floating],
                          ["menubar", PLACEMENT_LABEL.menubar],
                        ]}
                      />
                    </SettingRow>
                  )}
                </SettingCard>

                {/* ── 캘린더 ── */}
                <SettingCard title="캘린더">
                  <SettingRow
                    label="Google 계정"
                    desc={
                      !isElectron
                        ? "앱에서만 연동할 수 있어요"
                        : google.signedIn
                          ? google.email || "연결됨 · 오늘 일정을 표시 중"
                          : googleErr || "로그인해서 오늘 일정을 가져와요 (회사 계정 가능)"
                    }
                    descMono={isElectron && google.signedIn && !!google.email}
                  >
                    {isElectron &&
                      (google.signedIn ? (
                        <button
                          onClick={googleSignOut}
                          className="cursor-pointer rounded-lg bg-background-secondary px-3.5 py-2 text-[12px] text-danger transition-opacity hover:opacity-70"
                        >
                          연결 해제
                        </button>
                      ) : (
                        <button
                          onClick={googleSignIn}
                          disabled={googleBusy}
                          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[12px] font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-50"
                        >
                          <GoogleG />
                          {googleBusy ? "로그인 중…" : "연결"}
                        </button>
                      ))}
                  </SettingRow>
                  <SettingRow
                    label="iCal 주소"
                    desc={
                      !isElectron
                        ? "앱에서만 연동할 수 있어요"
                        : savedIcsUrl
                          ? "이 주소의 오늘 일정도 함께 표시 중"
                          : "iCloud 공개 주소나 Google iCal 주소를 추가로 연결할 수 있어요"
                    }
                  >
                    {isElectron && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setCalEditing((v) => !v)}
                          className="cursor-pointer rounded-lg bg-background-secondary px-3.5 py-2 text-[12px] text-foreground transition-opacity hover:opacity-70"
                        >
                          {savedIcsUrl ? "변경" : "연결"}
                        </button>
                      </div>
                    )}
                  </SettingRow>

                  {isElectron && calEditing && (
                    <div className="flex flex-col gap-3 px-4 py-4">
                      <p className="text-[11.5px] leading-relaxed text-muted">
                        <b>iCloud</b>: 캘린더 앱 → 캘린더 공유 → <i>공개 캘린더</i> → 링크 복사 (webcal 주소 그대로 붙여도 돼요)
                        <br />
                        <b>Google</b>: ⚙ 설정 → <b>내 캘린더의 설정</b> → 내 이름 → 맨 아래 <b>iCal 형식의 비공개 주소</b>
                        <br />
                        Google 계정 연결과 함께 쓰면 두 곳의 오늘 일정이 합쳐져 보여요. 주소는 이 컴퓨터에만 저장됩니다.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          placeholder="webcal://… 또는 https://…/basic.ics"
                          value={icsInput}
                          onChange={(e) => setIcsInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              saveIcsUrl();
                              setCalEditing(false);
                            }
                            if (e.key === "Escape") setCalEditing(false);
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 font-mono text-[11.5px] text-foreground outline-none placeholder:text-muted focus:border-foreground"
                        />
                        <button
                          onClick={() => {
                            saveIcsUrl();
                            setCalEditing(false);
                          }}
                          disabled={!/^(https?|webcal):\/\//i.test(icsInput.trim())}
                          className="cursor-pointer rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-bold text-background hover:opacity-80 disabled:cursor-default disabled:opacity-30"
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  )}

                  {isElectron && savedIcsUrl && (
                    <SettingRow
                      label="연결된 주소"
                      desc={showFullUrl ? savedIcsUrl : maskUrl(savedIcsUrl)}
                      descMono
                      onDescClick={() => setShowFullUrl((v) => !v)}
                    >
                      <button
                        onClick={removeIcsUrl}
                        className="cursor-pointer rounded-lg bg-background-secondary px-3.5 py-2 text-[12px] text-danger transition-opacity hover:opacity-70"
                      >
                        해제
                      </button>
                    </SettingRow>
                  )}
                </SettingCard>

                {/* ── 데이터 ── */}
                <SettingCard title="데이터">
                  <SettingRow
                    label="백업 내보내기"
                    desc="할일 전체를 JSON 파일로 저장"
                  >
                    <button
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(tasks, null, 2)], {
                          type: "application/json",
                        });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `tody-${today()}.json`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                      className="cursor-pointer rounded-lg bg-background-secondary px-3.5 py-2 text-[12px] text-foreground transition-opacity hover:opacity-70"
                    >
                      내보내기
                    </button>
                  </SettingRow>
                  <SettingRow
                    label="완료 항목 정리"
                    desc={`Done에 있는 ${byStatus.done.length}개를 삭제`}
                  >
                    <button
                      onClick={() => {
                        if (confirm("완료된 항목을 모두 지울까요?"))
                          setTasks((ts) => ts.filter((t) => t.status !== "done"));
                      }}
                      disabled={byStatus.done.length === 0}
                      className="cursor-pointer rounded-lg bg-background-secondary px-3.5 py-2 text-[12px] text-danger transition-opacity hover:opacity-70 disabled:cursor-default disabled:opacity-30"
                    >
                      지우기
                    </button>
                  </SettingRow>
                </SettingCard>

                {/* ── 정보 ── */}
                <SettingCard title="정보">
                  <SettingRow
                    label={`Tody v${appVersion}`}
                    desc={
                      !isElectron
                        ? "브라우저 미리보기"
                        : checking
                          ? "업데이트 확인 중…"
                          : updInfo == null
                            ? "업데이트 확인 전"
                            : !updInfo.ok
                              ? updInfo.reason === "offline"
                                ? "오프라인이라 확인할 수 없어요"
                                : "업데이트 정보를 가져올 수 없어요"
                              : updInfo.hasUpdate
                                ? `새 버전 v${updInfo.latest}이 있어요`
                                : "최신 버전이에요"
                    }
                  >
                    {isElectron &&
                      (updInfo?.ok && updInfo.hasUpdate ? (
                        <button
                          onClick={() => window.widget?.openExternal(updInfo.url)}
                          className="cursor-pointer rounded-lg bg-foreground px-3.5 py-2 text-[12px] font-semibold text-background transition-opacity hover:opacity-85"
                        >
                          다운로드
                        </button>
                      ) : (
                        <button
                          onClick={checkUpdate}
                          disabled={checking}
                          className="cursor-pointer rounded-lg bg-background-secondary px-3.5 py-2 text-[12px] text-foreground transition-opacity hover:opacity-70 disabled:cursor-default disabled:opacity-40"
                        >
                          확인
                        </button>
                      ))}
                  </SettingRow>
                  <SettingRow label="GitHub" desc="소스 코드 · 버그 제보 · 릴리즈 노트">
                    <button
                      onClick={() => (isElectron ? window.widget?.openExternal(REPO_URL) : window.open(REPO_URL))}
                      className="cursor-pointer rounded-lg bg-background-secondary px-3.5 py-2 text-[12px] text-foreground transition-opacity hover:opacity-70"
                    >
                      열기
                    </button>
                  </SettingRow>
                </SettingCard>

                <p className="px-1 text-[11.5px] leading-relaxed text-muted">
                  모든 데이터는 이 컴퓨터에만 저장되고 외부로 전송되지 않아요.
                </p>
              </div>
            )}

            {!settingsOpen && seg === "todo" && (
              <>
                <Section title="Schedule">
                  {isElectron && !calConfigured ? (
                    <button
                      onClick={() => setSettingsOpen(true)}
                      className="flex cursor-pointer items-center gap-1.5 py-[7px] pl-6 text-[12.5px] text-muted hover:text-foreground"
                    >
                      <GearIcon className="h-3 w-3" />
                      구글캘린더 연동하기
                    </button>
                  ) : upcomingEvents.length === 0 ? (
                    <p className="py-[7px] pl-6 text-[12.5px] text-muted">
                      {calError === "rate_limited"
                        ? "캨린더 요청이 많아 잠시 후 다시 불러와요"
                        : calError === "offline"
                          ? "오프라인 — 연결되면 일정을 불러와요"
                          : calError === "signed_out"
                            ? "Google 로그인이 만료됐어요 — 설정에서 다시 연결"
                            : calError === "error"
                              ? "일정을 불러오지 못했어요"
                              : "No events today"}
                    </p>
                  ) : (
                    upcomingEvents.map((ev, i) => {
                      const live = nowHM() >= ev.start && nowHM() <= ev.end;
                      return (
                        <div
                          key={ev.name + ev.start + i}
                          className="flex items-center gap-3 py-[7px] pl-6"
                        >
                          <span
                            className={`text-[12px] ${live ? "font-bold text-success" : "text-muted"}`}
                          >
                            {ev.start}
                          </span>
                          <span className="truncate text-[13.5px] text-foreground">
                            {ev.name}
                          </span>
                          {live && (
                            <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-success" />
                          )}
                        </div>
                      );
                    })
                  )}
                </Section>

                <Section title="Tasks" onDrop={() => dropIntoGroup(undefined)}>
                  {/* 할일이 하나도 없을 때 — Schedule의 "No events today"와 같은 톤 */}
                  {ungrouped.length === 0 && activeGroups.length === 0 && (
                    <p className="py-[7px] pl-6 text-[12.5px] text-muted">
                      Nothing to do
                    </p>
                  )}
                  {ungrouped.map((t) => (
                    <div key={t.id}>
                      <TaskRow {...rowProps(t)} />
                      {groupPrompt?.[groupPrompt.length - 1] === t.id && groupPromptEl}
                    </div>
                  ))}
                  {activeGroups.map((g) => (
                    <Group
                      key={g}
                      name={g}
                      onContext={(x, y) => setCtxGroup({ x, y, name: g })}
                      dropOver={overGroup === g}
                      onDragOver={() => setOverGroup(g)}
                      onDragLeave={() => setOverGroup((o) => (o === g ? null : o))}
                      onDrop={() => dropIntoGroup(g)}
                    >
                      {groupMembers(g).map((t) => (
                        <div key={t.id}>
                          <TaskRow {...rowProps(t)} />
                          {groupPrompt?.[groupPrompt.length - 1] === t.id && groupPromptEl}
                        </div>
                      ))}
                    </Group>
                  ))}

                </Section>
              </>
            )}

            {!settingsOpen && seg === "later" && (
              <div className="mt-5">
                {byStatus.later.length === 0 && (
                  <p className="py-10 text-center text-[13px] text-muted">
                    Nothing here
                  </p>
                )}
                {byStatus.later.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onUpdate={update}
                    onContext={openCtx(t)}
                  />
                ))}
              </div>
            )}

            {!settingsOpen && seg === "done" && (
              <div className="mt-4">
                {/* 분석 요약 스트립 — 탭하면 아래로 그래프 펼침 (Done 0개면 숨김) */}
                {byStatus.done.length > 0 && (() => {
                  const { total7, avg } = doneSummary(byStatus.done);
                  return (
                    <button
                      onClick={() => setShowStats((v) => !v)}
                      aria-pressed={showStats}
                      aria-label="분석 보기"
                      className={`mb-2 flex w-full cursor-pointer items-center justify-between px-1.5 py-2 text-[13px] text-foreground`}
                    >
                      <span className="flex items-center gap-1.5">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="3 17 9 11 13 15 21 7" />
                          <polyline points="15 7 21 7 21 13" />
                        </svg>
                        <span>최근 7일 <b className="sk-bold font-semibold text-foreground">{total7}개</b></span>
                        <span className="opacity-40" aria-hidden>·</span>
                        <span>하루 평균 <b className="sk-bold font-semibold text-foreground">{avg}개</b></span>
                      </span>
                      <svg
                        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                        className={`transition-transform duration-300 ease-out ${showStats ? "rotate-180" : ""}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  );
                })()}
                <Collapse open={showStats}>
                  <DoneChart tasks={byStatus.done} />
                </Collapse>
                {doneList.length === 0 && (
                  <p className="py-10 text-center text-[13px] text-muted">
                    No completed tasks yet
                  </p>
                )}
                {doneByDate.map(([date, items]) => (
                  <div key={date} className="mb-5">
                    <p className="mb-2 px-0.5 text-[11.5px] tracking-wide text-muted">
                      {dateHeading(date)}
                    </p>
                    {items.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onUpdate={update}
                        onContext={openCtx(t)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
          </AnimatePresence>
          </div>
          <ClassicScrollBar targetRef={mainScrollRef} enabled={look === "win95"} watchKey={settingsOpen ? "settings" : seg} />
          </div>
          {/* Win95·낙서 스킨: 할일이 많아져도 입력줄이 안 밀리게 패널 하단 고정 */}
          {!settingsOpen && seg === "todo" && (
            <div className="w95-addbar">{addTaskRow}</div>
          )}
          </div>
          </>
          )}

        </motion.div>
      </div>
      {showSkinPicker && <SkinPickerModal look={look} onLook={setLook} onDone={() => setShowSkinPicker(false)} />}
    </StrikeCtx.Provider>
  );

  // 우클릭 메뉴들 (패널 바깥에 fixed로 뜨므로 별도 엘리먼트)
  const menusEl = (
    <>
      {/* 그룹 우클릭 메뉴 */}
      {ctxGroup && (
        <div
          style={{
            left: Math.min(ctxGroup.x, window.innerWidth - 130),
            top: Math.min(ctxGroup.y, window.innerHeight - 80),
          }}
          className="fixed z-50 w-[120px] rounded-xl border border-border bg-surface py-1 font-mono text-[12px]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              ungroupAll(ctxGroup.name);
              setCtxGroup(null);
            }}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-foreground hover:bg-background-secondary"
          >
            ungroup
          </button>
        </div>
      )}

      {/* 우클릭 컨텍스트 메뉴 */}
      {ctxMenu && ctxTask && (
        <div
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 130),
            top: Math.min(ctxMenu.y, window.innerHeight - 150),
          }}
          className="fixed z-50 w-[120px] rounded-xl border border-border bg-surface py-1 font-mono text-[12px]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxTask.status !== "done" && (
            <button
              onClick={() => {
                update(ctxTask.id, { flag: !ctxTask.flag });
                setCtxMenu(null);
              }}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-foreground hover:bg-background-secondary"
            >
              {ctxTask.flag ? "unflag" : "! flag"}
            </button>
          )}
          {ctxTask.status === "todo" && (
            <button
              onClick={() => {
                update(ctxTask.id, { status: "later" });
                setCtxMenu(null);
              }}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-foreground hover:bg-background-secondary"
            >
              later
            </button>
          )}
          {ctxTask.status === "later" && (
            <button
              onClick={() => {
                update(ctxTask.id, { status: "todo", created: today() });
                setCtxMenu(null);
              }}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-foreground hover:bg-background-secondary"
            >
              today
            </button>
          )}
          {ctxTask.group && (
            <button
              onClick={() => {
                update(ctxTask.id, { group: undefined });
                setCtxMenu(null);
              }}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-foreground hover:bg-background-secondary"
            >
              ungroup
            </button>
          )}
          <button
            onClick={() => {
              removeTask(ctxTask.id);
              setCtxMenu(null);
            }}
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-danger hover:bg-background-secondary"
          >
            delete
          </button>
        </div>
      )}
    </>
  );

  // ── Electron: 항상 패널 크기의 투명 창 안에서 알약 ↔ 패널을 애니메이션으로 전환 ──
  if (isElectron) {
    return (
      <div className="relative h-screen w-screen bg-transparent font-mono">
        <AnimatePresence initial={false} mode="sync">
          {!open && placement === "floating" && onboarded && pillEl}
          {open && (
            <motion.div
              key="panel"
              className="absolute inset-0 flex items-center justify-center"
              style={{
                willChange: "transform, opacity",
                backfaceVisibility: "hidden",
                // 알약이 있는 지점을 원점으로 삼아, 그 자리에서 펼쳐지고 그 자리로 접힌다
                transformOrigin: `${pillOffset.left + pillW / 2 - 28}px ${pillOffset.top + pillH / 2 - 28}px`,
              }}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ type: "spring", stiffness: 440, damping: 34, mass: 0.6 }}
            >
              {panelEl}
            </motion.div>
          )}
        </AnimatePresence>
        {menusEl}
      </div>
    );
  }

  // ── 브라우저 미리보기 ──
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface font-mono">
      {open || !onboarded ? panelEl : (
        <button
          onClick={openPanel}
          aria-label="패널 열기"
          className="sk-pill flex cursor-pointer items-center gap-2.5 rounded-full border border-black/8 bg-white py-3 pl-5 pr-5 shadow-[0_5px_16px_rgba(0,0,0,0.16)] dark:border-white/10 dark:bg-background-secondary/75"
        >
          <span className="whitespace-nowrap text-[13px] font-bold text-foreground">☑ {todoCount}</span>
          <span className="max-w-[130px] truncate whitespace-nowrap text-[12px] text-muted">
            {nextEvent ? `${nextEvent.start} ${nextEvent.name}` : "No events"}
          </span>
        </button>
      )}
      {menusEl}
    </div>
  );
}

interface DragProps {
  onDragStart: () => void;
  onDragOver: (pos: "before" | "after") => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  indicator: "before" | "after" | null;
}

function TaskRow({
  task,
  onUpdate,
  onContext,
  selected,
  selIdx,
  onSelStart,
  onSelEnter,
  onSelShift,
  drag,
}: {
  task: Task;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onContext?: (x: number, y: number) => void;
  selected?: boolean;
  selIdx?: number;
  onSelStart?: () => void;
  onSelEnter?: () => void;
  onSelShift?: () => void;
  drag?: DragProps;
}) {
  const carried = task.status === "todo" ? daysAgo(task.created) : 0;
  const done = task.status === "done";
  const strike = useContext(StrikeCtx);
  const [checking, setChecking] = useState(false);

  // ── 인라인 편집 ──
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const press = useRef({ x: 0, y: 0 });
  const commitEdit = () => {
    const v = draft.trim();
    if (v && v !== task.title) onUpdate(task.id, { title: v });
    setEditing(false);
  };

  const handleChange = (sel: boolean) => {
    if (sel && !done) {
      setChecking(true);
      setTimeout(() => {
        setChecking(false);
        onUpdate(task.id, {
          status: "done",
          doneAt: today(),
          flag: false, // 완료되면 우선순위 표시 제거
        });
      }, 550);
    } else if (!sel && done) {
      onUpdate(task.id, { status: "todo", created: today(), doneAt: undefined });
    }
  };

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext?.(e.clientX, e.clientY);
      }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        drag.onDragOver(e.clientY < r.top + r.height / 2 ? "before" : "after");
      }}
      onDragLeave={() => drag?.onDragLeave()}
      onDrop={(e) => {
        if (!drag) return;
        e.preventDefault();
        e.stopPropagation();
        drag.onDrop();
      }}
      data-sel-idx={selIdx}
      onMouseDown={(e) => {
        if (e.button !== 0 || editing) return;
        if ((e.target as HTMLElement).closest("button,input,[data-handle]")) return;
        e.preventDefault();
        press.current = { x: e.clientX, y: e.clientY };
        if (e.shiftKey) return; // Shift+클릭은 onClick에서 범위 선택 처리
        onSelStart?.();
      }}
      onClick={(e) => {
        if (editing) return;
        if ((e.target as HTMLElement).closest("button,input,[data-handle]")) return;
        if (e.shiftKey) {
          onSelShift?.();
          return;
        }
        // 드래그(그룹 선택)가 아닌 "제자리 클릭"만 편집으로
        const moved =
          Math.abs(e.clientX - press.current.x) +
          Math.abs(e.clientY - press.current.y);
        if (moved > 4) return;
        setDraft(task.title);
        setEditing(true);
      }}
      onMouseEnter={() => onSelEnter?.()}
      className={`group relative flex select-none items-center gap-3 rounded-lg py-[7px] pr-1 ${
        drag ? "pl-6" : "pl-1.5" /* 드래그 손잡이(⠿) 자리가 필요한 행만 들여쓰기 */
      } ${selected ? "sk-selected bg-background-secondary" : ""} ${checking ? "animate-wiggle" : ""}`}
    >
      {/* 드롭 위치 표시선 */}
      {drag?.indicator && (
        <span
          className={`pointer-events-none absolute left-6 right-1 h-[2px] rounded bg-foreground ${
            drag.indicator === "before" ? "top-0" : "bottom-0"
          }`}
        />
      )}
      {/* 드래그 손잡이 (hover 시 표시) */}
      {drag && (
        <span
          data-handle
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", task.id);
            e.dataTransfer.effectAllowed = "move";
            drag.onDragStart();
          }}
          onDragEnd={() => drag.onDragEnd()}
          className="absolute left-1 top-1/2 -translate-y-1/2 cursor-grab select-none text-[12px] leading-none text-muted opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          aria-label="드래그해서 이동"
        >
          ⠿
        </span>
      )}
      <button
        role="checkbox"
        aria-checked={done || checking}
        aria-label={task.title}
        onClick={() => handleChange(!(done || checking))}
        className={`sk-check flex h-[18px] w-[18px] flex-shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
          done || checking
            ? "border-foreground bg-foreground"
            : "border-border bg-transparent hover:border-muted dark:border-white/30 dark:hover:border-white/50"
        }`}
      >
        {(done || checking) && (
          <svg
            viewBox="0 0 17 18"
            className="h-2.5 w-2.5 text-background"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="1 9 7 14 15 4" />
          </svg>
        )}
      </button>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commitEdit}
          className="sk-underline min-w-0 flex-1 border-b border-foreground bg-transparent font-mono text-[13.5px] text-foreground outline-none"
        />
      ) : (
        <span
          className={`relative flex min-w-0 flex-1 cursor-text items-center text-[13.5px] transition-opacity duration-150 group-hover:opacity-70 ${
            done ? "text-muted line-through" : "text-foreground"
          }`}
        >
          {/* 글자 폭만큼만 선이 그어지도록 텍스트를 inline-block으로 감쌈 */}
          <span className="relative -my-[7px] line-clamp-2 inline-block max-w-full break-words py-[7px] leading-snug">
            {task.flag && <span className="mr-1 font-bold text-danger">!</span>}
            {task.title}
            {/* 체크 중에만 선 그어지는 연출 (직선/낙서) — 완료 후엔 일반 취소선 */}
            {checking &&
              (strike === "scribble" ? (
                <Scribble />
              ) : (
                <span className="animate-strike absolute left-0 top-1/2 h-[1.5px] bg-foreground" />
              ))}
          </span>
        </span>
      )}

      {carried > 0 && (
        <span className="flex-shrink-0 text-[11px] text-warning">
          +{carried}d
        </span>
      )}

    </div>
  );
}
