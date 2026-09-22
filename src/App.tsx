import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Tabs } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";

declare global {
  interface Window {
    widget?: {
      isElectron: boolean;
      setMode: (m: "widget" | "panel") => void;
      moveBy: (dx: number, dy: number) => void;
      onBlur: (cb: () => void) => () => void;
      calendarSetUrl: (url: string) => Promise<boolean>;
      calendarGetUrl: () => Promise<string>;
      getPlacement: () => Promise<Placement>;
      setPlacement: (p: Placement) => void;
      onPlacement: (cb: (p: Placement) => void) => () => void;
      onPanelShown: (cb: (fromTray: boolean) => void) => () => void;
      setTrayTitle: (t: string) => void;
      ignoreMouse: (ignore: boolean) => void;
      centerWindow: (on: boolean) => void;
      calendarEvents: () => Promise<{
        configured: boolean;
        events: CalEvent[];
        error?: string;
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
  time?: string;
  created: string;
  doneAt?: string;
  group?: string;
}

// 브라우저 미리보기용 목데이터 (Electron에선 구글캘린더 ICS 사용)
const MOCK_EVENTS: CalEvent[] = [
  { name: "대출 스쿼드 스탠드업", start: "11:00", end: "11:30" },
  { name: "디자인시스템 미팅", start: "14:00", end: "15:00" },
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

const SEED: Task[] = [
  { id: uid(), title: "대환 전용 플로우 웹 QA", status: "todo", flag: true, time: "15:00", created: today() },
  { id: uid(), title: "대출탭 리서치", status: "todo", flag: false, created: today() },
  { id: uid(), title: "패스트트랙 리서치", status: "todo", flag: false, created: today() },
  { id: uid(), title: "포트폴리오 케이스 정리", status: "later", flag: false, created: today() },
  { id: uid(), title: "디자인팀 주간 미팅 참석", status: "done", flag: false, created: today(), doneAt: today() },
];

function load(): Task[] {
  try {
    const raw = localStorage.getItem("my-day-tasks");
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return SEED;
}

// ─── 완료 표시 (직선 / 낙서) ────────────────────────
type StrikeStyle = "line" | "scribble";
const StrikeCtx = createContext<StrikeStyle>("line");

// ─── 스킨 (기본 / 낙서) ───────────────────────────────
// 낙서: 종이 배경 + 손글씨 + 샐뻗한 테두리/선 + 노란 형광펜 탭. <html class="sketch">로 켜짐
type Look = "default" | "sketch";
const loadLook = (): Look => {
  const v = localStorage.getItem("my-day-look");
  if (v === "default" || v === "sketch") return v;
  // 예전 '완료 표시: 낙서' 설정을 쓰던 사용자는 낙서 스킨으로 이어감
  // 예전 '완료 표시: 직선' 설정을 쓰던 사용자만 기본 스킨 유지, 그 외 신규는 낙서가 기본
  return localStorage.getItem("my-day-strike") === "line" ? "default" : "sketch";
};
const applyLook = (l: Look) =>
  document.documentElement.classList.toggle("sketch", l === "sketch");

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
function loadOnboardedPeek(): boolean {
  if (DEV_FORCE_NEW_USER) return false;
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1" || !!localStorage.getItem("my-day-tasks");
  } catch {
    return false;
  }
}

function loadOnboarded(): boolean {
  if (DEV_FORCE_NEW_USER) return false;
  try {
    if (localStorage.getItem(ONBOARDED_KEY) === "1") return true;
    // 온보딩이 없던 버전에서 쓰던 사용자(할일 데이터가 이미 있음)는 자동 완료 처리
    if (localStorage.getItem("my-day-tasks")) {
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
function DoneChart({ tasks }: { tasks: Task[] }) {
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

  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="sk-box mb-4 rounded-2xl border border-black/6 px-2 pb-1 pt-2 dark:border-white/8">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full text-foreground"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {/* 낙서 스킨용 손그림 뿠금 (기본 스킨에서는 사용 안 함) */}
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
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.4 }}
        />
        <motion.path
          d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="sk-line"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* 오늘 점 */}
        <motion.circle
          cx={x(DAYS - 1)} cy={y(counts[DAYS - 1])} r={3.5}
          fill="currentColor"
          initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.85, duration: 0.25 }}
          style={{ originX: `${x(DAYS - 1)}px`, originY: `${y(counts[DAYS - 1])}px` }}
        />

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

// ─── 스킨 미리보기 (온보딩용 미니 위젯) ─────────────────────────────
// 스킨 클래스(html.sketch)에 의존하지 않고 인라인으로 그려서, 어떤 스킨이 켜져 있어도 두 카드가 각자 모습을 유지한다
function SkinPreviewDefault() {
  return (
    <div className="h-[118px] w-full overflow-hidden rounded-xl bg-[#e9e9ec] p-2 font-mono" aria-hidden>
      <div className="h-full rounded-[10px] bg-white p-2 shadow-sm">
        <div className="flex rounded-full bg-[#f2f2f4] p-[2px] text-[7px] text-[#555]">
          <span className="flex-1 rounded-full bg-white py-[3px] text-center text-black shadow-sm">To-do</span>
          <span className="flex-1 py-[3px] text-center">Later</span>
          <span className="flex-1 py-[3px] text-center">Done</span>
        </div>
        <div className="mt-2 space-y-[6px] px-0.5 text-[8px] text-black">
          <div className="flex items-center gap-1.5">
            <span className="h-[8px] w-[8px] rounded-full bg-black" />
            <span className="text-[#8a8a8e] line-through">리서치 정리</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-[8px] w-[8px] rounded-full border border-[#c9c9ce]" />
            <span>주간 미팅 준비</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-[8px] w-[8px] rounded-full border border-[#c9c9ce]" />
            <span>디자인 QA</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkinPreviewSketch() {
  const ink = "#1d1d1b";
  return (
    <div
      className="relative h-[118px] w-full overflow-hidden rounded-xl bg-white p-2"
      style={{ fontFamily: '"Patrick Hand", "Poor Story", sans-serif', color: ink }}
      aria-hidden
    >
      {/* 뜯긴 왼쪽 + 삐뚤한 테두리 */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 150 118" preserveAspectRatio="none">
        <path
          d="M12 8 C 40 6, 90 9, 142 8 L 143 110 C 100 112, 50 110, 12 111 L 12 100 C 6 98, 6 92, 12 90 L 12 78 C 6 76, 6 70, 12 68 L 12 56 C 6 54, 6 48, 12 46 L 12 34 C 6 32, 6 26, 12 24 Z"
          fill="none"
          stroke={ink}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      <div className="relative pl-4 pr-2 pt-1.5">
        <div className="flex justify-between px-1 text-[8.5px]" style={{ color: "#8b897f" }}>
          <span className="relative" style={{ color: ink }}>
            To-do
            <svg className="absolute -left-[5px] -top-[3px] h-[16px] w-[30px]" viewBox="0 0 30 16" fill="none" stroke={ink} strokeWidth="1.1">
              <path d="M19 2 C 11 1, 3 3, 2.5 8 C 2 12, 8 15, 15 14.5 C 22 14, 28 11, 27.5 7 C 27 4, 23 2, 18 2.3" />
            </svg>
          </span>
          <span>Later</span>
          <span>Done</span>
        </div>
        <div className="mt-2.5 space-y-[6px] text-[9px]">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-[9px] w-[9px] rounded-[50%_46%_52%_48%/48%_52%_46%_54%] border-[1.3px]" style={{ borderColor: ink, background: ink }} />
            <span className="relative" style={{ color: "#8b897f" }}>
              리서치 정리
              <svg className="absolute left-0 top-1/2 h-[6px] w-full -translate-y-1/2" viewBox="0 0 60 6" preserveAspectRatio="none" fill="none" stroke={ink} strokeWidth="1.2">
                <path d="M1 3 C 15 1, 30 5, 45 2.5 S 55 4, 59 3" />
              </svg>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-[9px] w-[9px] rotate-12 rounded-[55%_45%_47%_53%/47%_55%_45%_53%] border-[1.3px]" style={{ borderColor: ink }} />
            <span>주간 미팅 준비</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-[9px] w-[9px] -rotate-6 rounded-[46%_54%_50%_50%/56%_46%_54%_44%] border-[1.3px]" style={{ borderColor: ink }} />
            <span>디자인 QA</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 온보딩 화면: 환영 → 스킨 → 캘린더 → 시작 ─────────────────────
function Onboarding({
  look,
  onLook,
  calConnected,
  onSaveIcs,
  onDone,
}: {
  look: Look;
  onLook: (l: Look) => void;
  calConnected: boolean;
  onSaveIcs: (url: string) => Promise<void>;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [ics, setIcs] = useState("");
  const [saving, setSaving] = useState(false);
  const STEPS = 3;
  const next = () => setStep((v) => Math.min(STEPS - 1, v + 1));
  const back = () => setStep((v) => Math.max(0, v - 1));
  const icsValid = /^https?:\/\//.test(ics.trim());

  const saveIcs = async () => {
    if (!icsValid) return;
    setSaving(true);
    try {
      await onSaveIcs(ics.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col px-6 pb-6 pt-6">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          className="flex flex-1 flex-col"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* 1. 환영 — 일러스트 + 한 줄 */}
          {step === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <img
                src="./onboarding-hero.png"
                alt=""
                aria-hidden
                draggable={false}
                className="mb-3 w-[220px] select-none"
              />
              <h1 className="text-[22px] font-bold leading-snug text-foreground">
                My Day에 오신 것을
                <br />
                환영해요
              </h1>
              <p className="mt-2 text-[14px] text-muted">업무 관리를 시작해볼까요?</p>
            </div>
          )}

          {/* 2. 스킨 */}
          {step === 1 && (
            <>
              <h1 className="text-[20px] font-bold leading-snug text-foreground">어떤 느낌이 좋으세요?</h1>
              <p className="mt-2 text-[13px] text-muted">설정에서 언제든 바꿀 수 있어요.</p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {(
                  [
                    ["sketch", "낙서", "종이에 펜으로 그린"],
                    ["default", "기본", "깔끔하고 차분한"],
                  ] as const
                ).map(([key, label, desc]) => {
                  const on = look === key;
                  return (
                    <button
                      key={key}
                      onClick={() => onLook(key)}
                      aria-pressed={on}
                      className={`relative flex flex-col items-stretch gap-2.5 rounded-2xl border-2 p-2.5 text-left transition-colors ${
                        on ? "border-foreground" : "border-black/10 hover:border-black/25 dark:border-white/12"
                      }`}
                    >
                      {on && (
                        <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background shadow-sm">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="4 12 10 18 20 6" />
                          </svg>
                        </span>
                      )}
                      {key === "sketch" ? <SkinPreviewSketch /> : <SkinPreviewDefault />}
                      <div className="px-1 pb-0.5">
                        <p className="text-[13.5px] font-semibold text-foreground">{label}</p>
                        <p className="text-[11.5px] text-muted">{desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* 3. 구글 캘린더 연동 */}
          {step === 2 && (
            <>
              <h1 className="text-[20px] font-bold leading-snug text-foreground">구글 캘린더 연동</h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                오늘 일정이 할 일 위에 함께 보여요. 주소는 이 맥에만 저장되고 어디에도 전송되지 않습니다.
              </p>

              <ol className="mt-5 space-y-2.5 text-[12.5px] leading-relaxed text-foreground">
                {[
                  <>구글 캘린더(웹) 우측 상단 <b>⚙ → 설정</b></>,
                  <>왼쪽 목록을 아래로 내려 <b>내 캘린더의 설정</b> 아래에 있는 <b>내 이름</b>(기본 캘린더)을 클릭</>,
                  <>오른쪽 화면을 맨 아래까지 내려 <b>캘린더 통합</b> 아래 <b>iCal 형식의 비공개 주소</b> 복사</>,
                  <>아래 칸에 붙여넣고 <b>연결</b></>,
                ].map((t, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-foreground text-[10.5px] font-bold text-background">
                      {i + 1}
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>

              {calConnected ? (
                <div className="mt-5 flex items-center gap-2 rounded-xl border border-foreground px-4 py-3 text-[13px] text-foreground">
                  <span aria-hidden>✓</span> 연결되었어요. 오늘 일정을 불러옵니다.
                </div>
              ) : (
                <div className="mt-5 flex items-end gap-2">
                  <input
                    value={ics}
                    onChange={(e) => setIcs(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveIcs();
                    }}
                    placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                    className="sk-underline min-w-0 flex-1 border-b border-foreground bg-transparent py-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted"
                  />
                  <button
                    onClick={saveIcs}
                    disabled={!icsValid || saving}
                    className="flex-shrink-0 cursor-pointer rounded-lg bg-foreground px-3.5 py-2 text-[12.5px] font-semibold text-background transition-opacity disabled:cursor-default disabled:opacity-30"
                  >
                    {saving ? "연결 중…" : "연결"}
                  </button>
                </div>
              )}
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                iCloud 캘린더도 돼요: 캘린더 앱 → 공유 → 공개 캘린더 → 링크의 <span className="font-mono">webcal://</span>을{" "}
                <span className="font-mono">https://</span>로 바꿔 붙이면 됩니다.
              </p>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 하단: 진행 점 + 버튼 */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-1.5" aria-label={`${step + 1} / ${STEPS}`}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <span
              key={i}
              className={`h-[6px] rounded-full transition-all ${
                i === step ? "w-4 bg-foreground" : "w-[6px] bg-foreground/25"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button onClick={back} className="cursor-pointer rounded-lg px-3 py-2 text-[13px] text-muted hover:text-foreground">
              이전
            </button>
          )}
          {step < STEPS - 1 ? (
            <button
              onClick={next}
              className="cursor-pointer rounded-xl bg-foreground px-4 py-2 text-[13px] font-semibold text-background hover:opacity-85"
            >
              {step === 0 ? "시작하기" : "다음"}
            </button>
          ) : (
            <button
              onClick={onDone}
              className="cursor-pointer rounded-xl bg-foreground px-4 py-2 text-[13px] font-semibold text-background hover:opacity-85"
            >
              {calConnected ? "완료" : "나중에 하기"}
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
        className={`flex cursor-pointer items-center gap-2 rounded-md px-1 text-[14px] font-bold text-foreground transition-colors ${
          over ? "bg-background-secondary" : ""
        }`}
      >
        <span
          className={`text-[8px] transition-transform duration-300 ease-out ${expanded ? "" : "-rotate-90"}`}
        >
          ▼
        </span>
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

  const refreshEvents = async () => {
    if (!window.widget) return;
    const r = await window.widget.calendarEvents();
    setCalConfigured(r.configured);
    if (r.configured) setEvents(r.events);
  };

  useEffect(() => {
    if (!isElectron) return;
    refreshEvents();
    const iv = setInterval(refreshEvents, 5 * 60 * 1000); // 5분마다 갱신
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveIcsUrl = async () => {
    const url = icsInput.trim();
    if (!url.startsWith("http")) return;
    await window.widget?.calendarSetUrl(url);
    setIcsInput("");
    setSavedIcsUrl(url);
    refreshEvents();
  };

  // ── 온보딩 ──
  const [onboarded, setOnboarded] = useState<boolean>(loadOnboarded);
  const onboardedRef = useRef(onboarded);
  onboardedRef.current = onboarded;
  // 온보딩 중엔 창을 화면 정가운데에, 끝나면 원래 자리(우하단)로
  useEffect(() => {
    if (!isElectron) return;
    const apply = () => {
      window.widget?.centerWindow(!onboarded);
      if (!onboarded) window.widget?.setMode("panel");
    };
    apply();
    // 앱 시작 직후엔 main이 창 위치를 우하단으로 다시 잡을 수 있어 한 박자 뒤 재적용
    const t = setTimeout(apply, 400);
    return () => clearTimeout(t);
  }, [onboarded]);
  const finishOnboarding = () => {
    // DEV 강제 모드에서는 실제 상태를 저장하지 않고 화면만 닫는다 (새로고침하면 다시 보임)
    if (!DEV_FORCE_NEW_USER) localStorage.setItem(ONBOARDED_KEY, "1");
    setOnboarded(true);
  };

  // ── 설정 화면 ──
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedIcsUrl, setSavedIcsUrl] = useState("");
  const [showFullUrl, setShowFullUrl] = useState(false);
  const [calEditing, setCalEditing] = useState(false); // 주소 입력창 펼침
  // iCal 주소가 있거나, 로컬 동기화 파일로 일정이 들어오고 있으면 연결된 상태
  const calConnected = !!savedIcsUrl || calConfigured;

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
      else {
        setOpen(false); // 화면에 띄우기로 복귀 → 작은 위젯부터
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
  useEffect(() => {
    applyLook(look);
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

  const openPanel = () => {
    setOpen(true);
    window.widget?.setMode("panel");
    refreshEvents();
  };

  // 다른 곳 클릭(포커스 아웃) → 패널을 위젯으로 접기
  useEffect(() => {
    if (!isElectron) return;
    return window.widget?.onBlur(() => {
      // 온보딩 중에는 바깥을 눌러도 접히지 않음
      if (!onboardedRef.current) return;
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
    localStorage.setItem("my-day-tasks", JSON.stringify(tasks));
  }, [tasks]);

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
        // 제목이 그룹명으로 시작하면 접두어 제거 (예: "패스트트랙 QA" → "QA")
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
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

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
  useEffect(() => {
    if (!isElectron) return;
    if (placement !== "floating") return window.widget?.ignoreMouse(false);
    window.widget?.ignoreMouse(!open && !hoverPill);
  }, [open, hoverPill, placement]);

  const pillEl = (
    <motion.div
      key="pill"
      className="absolute bottom-5 right-2"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
      style={{ originX: 1, originY: 1, willChange: "transform, opacity", backfaceVisibility: "hidden" }}
      onMouseEnter={() => setHoverPill(true)}
      onMouseLeave={() => setHoverPill(false)}
    >
      {/* 낙서 스킨 필터 — 패널이 닫혀 있을 때도 알약 테두리가 그리어지도록 */}
      <SketchFilter />
      <button
        onMouseDown={onWidgetMouseDown}
        className="sk-pill flex cursor-grab items-center gap-2.5 rounded-full border border-black/8 bg-white py-3 pl-5 pr-5 transition-transform hover:scale-[1.03] active:cursor-grabbing dark:border-white/10 dark:bg-background-secondary/75"
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
        className={`sk-outer flex h-[600px] w-[360px] flex-col overflow-hidden rounded-[28px] bg-background-secondary ${
          isElectron ? "" : "shadow-2xl"
        }`}
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
              look={look}
              onLook={setLook}
              calConnected={calConnected && !DEV_FORCE_NEW_USER /* DEV 강제 모드에서는 항상 입력창 확인 */}
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
          <div className="sk-scroll flex-1 overflow-y-auto px-5 pb-5">
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
                        : "깔끔한 기본 스킨이에요"
                    }
                  >
                    <Dropdown<Look>
                      value={look}
                      onChange={setLook}
                      options={[
                        ["default", "기본"],
                        ["sketch", "낙서"],
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
                    label="Google Calendar"
                    desc={
                      !isElectron
                        ? "앱에서만 연동할 수 있어요"
                        : calConnected
                          ? "오늘 일정을 Schedule에 표시 중"
                          : "iCal 비공개 주소로 오늘 일정을 가져와요"
                    }
                  >
                    {isElectron && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setCalEditing((v) => !v)}
                          className="cursor-pointer rounded-lg bg-background-secondary px-3.5 py-2 text-[12px] text-foreground transition-opacity hover:opacity-70"
                        >
                          {calConnected ? "변경" : "연결"}
                        </button>
                      </div>
                    )}
                  </SettingRow>

                  {isElectron && calEditing && (
                    <div className="flex flex-col gap-3 px-4 py-4">
                      <p className="text-[11.5px] leading-relaxed text-muted">
                        구글 캘린더 → ⚙ 설정 → 왼쪽 <b>내 캘린더의 설정</b> 아래 <b>내 이름</b> 클릭 → 맨 아래 <b>iCal 형식의 비공개 주소</b> 복사.
                        주소는 이 컴퓨터에만 저장됩니다.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          placeholder="https://calendar.google.com/…/basic.ics"
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
                          disabled={!icsInput.trim().startsWith("http")}
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
                        a.download = `my-day-${today()}.json`;
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
                      No events today
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

                  <div className="mt-1 pl-6">
                    <input
                      placeholder="+ Add task"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        // 한글 조합 중 Enter(IME)는 무시 → 마지막 글자 중복 추가 방지
                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        if (e.key === "Enter") addTask();
                      }}
                      className="sk-underline w-full rounded-none border-0 border-b border-transparent bg-transparent py-2 font-mono text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted focus:border-foreground"
                    />
                  </div>
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
          </>
          )}

        </motion.div>
      </div>
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
          {!open && placement === "floating" && pillEl}
          {open && (
            <motion.div
              key="panel"
              className="absolute bottom-2 right-2"
              style={{ originX: 1, originY: 1, willChange: "transform, opacity", backfaceVisibility: "hidden" }}
              initial={{ opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 8 }}
              transition={{ type: "spring", stiffness: 480, damping: 38, mass: 0.8 }}
            >
              {panelEl}
            </motion.div>
          )}
        </AnimatePresence>
        {menusEl}
      </div>
    );
  }

  // ── 밍라우저 미리보기 ──
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface font-mono">
      {panelEl}
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

      {task.time && (
        <span className="flex-shrink-0 text-[11px] text-muted">
          {task.time}
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
