const { app, BrowserWindow, ipcMain, screen, Tray, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const nodeIcal = require("node-ical");
const gauth = require("./googleAuth.cjs");

// ─── 캘린더 설정 (비밀 ICS URL은 로컬 config.json에만 저장) ───
const configPath = () => path.join(app.getPath("userData"), "config.json");
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}
function saveConfig(c) {
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
}

ipcMain.handle("calendar-set-url", (_e, url) => {
  const next = { ...loadConfig() };
  // iCloud 공유 링크는 webcal:// 로 복사되므로 https:// 로 바꿔 저장
  const v = String(url ?? "").trim().replace(/^webcal:\/\//i, "https://");
  if (v) next.icsUrl = v;
  else delete next.icsUrl; // 빈 값 → 연동 해제
  saveConfig(next);
  return true;
});

// 설정 화면에서 현재 저장된 주소 확인용
ipcMain.handle("calendar-get-url", () => loadConfig().icsUrl || "");

// ─── Google 로그인 (OAuth) ───
ipcMain.handle("google-status", () => gauth.status());
ipcMain.handle("google-sign-in", () => gauth.signIn());
ipcMain.handle("google-sign-out", () => gauth.signOut());

// (개발 전용) 로컬 일정 파일 — 프로젝트 루트/calendar-today.json 이 있으면 ICS 없이도 오늘 일정을 보여준다.
// 배포된 앱에서는 사용하지 않고(개인 파일), 설정의 ICS URL로만 동작한다.
const localEventsPath = path.join(__dirname, "..", "calendar-today.json");

// 마지막으로 성공한 오늘 일정 — 구글이 429(요청 과다)나 오프라인으로 실패해도 직전 결과를 그대로 보여준다
const cachePath = () => path.join(app.getPath("userData"), "calendar-cache.json");
function loadCache() {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(), "utf8"));
    return c && c.date === new Date().toLocaleDateString("sv") ? c : null;
  } catch {
    return null;
  }
}
function saveCache(events) {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify({ date: new Date().toLocaleDateString("sv"), fetchedAt: Date.now(), events }));
  } catch {
    /* ignore */
  }
}

// ICS 주소(iCloud 공개 주소 / Google iCal 주소 등)에서 오늘 일정
async function fetchIcsToday(icsUrl) {
  const data = await nodeIcal.async.fromURL(icsUrl);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const events = [];
  for (const k in data) {
    const ev = data[k];
    if (ev.type !== "VEVENT") continue;
    const dur = (ev.end?.getTime() || 0) - (ev.start?.getTime() || 0);
    if (dur >= 86400000) continue; // 종일 이벤트는 제외
    const push = (st) => {
      const en = new Date(st.getTime() + dur);
      events.push({ name: ev.summary || "(제목 없음)", start: hm(st), end: hm(en) });
    };
    if (ev.rrule) {
      const exdates = ev.exdate ? Object.values(ev.exdate).map((d) => new Date(d).getTime()) : [];
      ev.rrule
        .between(dayStart, dayEnd, true)
        .filter((d0) => !exdates.some((x) => Math.abs(x - d0.getTime()) < 1000))
        .forEach(push);
    } else if (ev.start >= dayStart && ev.start < dayEnd) {
      push(ev.start);
    }
  }
  return events;
}

const classifyError = (msg) =>
  /429/.test(msg) ? "rate_limited" : /ENOTFOUND|ECONN|fetch failed|network/i.test(msg) ? "offline" : "error";

// 오늘 일정 = Google 계정(로그인) + ICS 주소 두 소스를 합친다.
// 한쪽이 실패해도 다른 쪽 일정은 보여주고, 둘 다 실패하면 마지막 성공 캐시를 유지한다.
ipcMain.handle("calendar-events", async () => {
  const { icsUrl } = loadConfig();
  const signedIn = gauth.status().signedIn;

  if (!signedIn && !icsUrl) {
    // (개발 전용) 로컬 동기화 파일
    if (app.isPackaged) return { configured: false, events: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(localEventsPath, "utf8"));
      const todayStr = new Date().toLocaleDateString("sv");
      return { configured: true, source: "local", events: raw.date === todayStr ? raw.events : [] };
    } catch {
      return { configured: false, events: [] };
    }
  }

  const events = [];
  const okSources = [];
  const errors = [];

  if (signedIn) {
    try {
      const r = await gauth.fetchTodayEvents();
      if (r.ok) {
        events.push(...r.events);
        okSources.push("google");
      } else {
        errors.push(r.reason === "not_signed_in" ? "signed_out" : classifyError(r.reason));
      }
    } catch (e) {
      errors.push(classifyError(String(e?.message || e)));
    }
  }

  if (icsUrl) {
    try {
      events.push(...(await fetchIcsToday(icsUrl)));
      okSources.push("ics");
    } catch (e) {
      errors.push(classifyError(String(e?.message || e)));
    }
  }

  if (okSources.length > 0) {
    // 같은 일정이 양쪽에 다 있으면(예: 구글 캘린더를 ICS 로도 넣은 경우) 하나만
    const seen = new Set();
    const merged = events
      .filter((ev) => {
        const key = `${ev.start}|${ev.end}|${ev.name.trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    saveCache(merged);
    // 일부 소스만 실패한 경우엔 성공한 쪽 일정을 그대로 보여준다 (경고는 signed_out 만 전달)
    const err = errors.includes("signed_out") ? "signed_out" : undefined;
    return { configured: true, sources: okSources, events: merged, fetchedAt: Date.now(), error: err };
  }

  // 모두 실패 → 마지막 성공 캐시
  const cached = loadCache();
  return {
    configured: true,
    sources: [],
    events: cached ? cached.events : [],
    fetchedAt: cached ? cached.fetchedAt : null,
    error: errors[0] || "error",
  };
});

// 창은 항상 패널 크기의 투명 창. 알약↔패널 전환은 렌더러 안에서 애니메이션으로.
// 알약 상태에서는 setIgnoreMouseEvents로 투명 영역 클릭을 뒤 화면으로 통과시킴.
// 패널 본체(360x600) + 그림자가 그려질 여백(28px)
const PANEL = { width: 416, height: 656 };
const MARGIN = 8; // 창 자체에 이미 8px 안쪽 여백이 있어 실제 화면 여백은 16px

let win = null;

// 온보딩 동안 true: 이 동안에는 모든 자동 재배치가 우하단 대신 화면 정가운데를 향함
let centered = false;
function centerOf(size) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + (workArea.height - size.height) / 2),
  };
}
// 기본 자리: 센터 모드면 가운데, 사용자가 옮긴 위치가 있으면 그 자리, 없으면 우하단
function homeBounds() {
  if (centered) return clamp({ ...PANEL, ...centerOf(PANEL) });
  const pos = ensurePillPos();
  const size = pillWinSize();
  return clamp({
    ...PANEL,
    x: Math.round(pos.x + size.width / 2 - PANEL.width / 2),
    y: Math.round(pos.y + size.height / 2 - PANEL.height / 2),
  });
}

function bottomRight(size) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - size.width - MARGIN,
    y: workArea.y + workArea.height - size.height - MARGIN,
  };
}

// ─── 창 크기: 알약일 때는 작게, 패널일 때는 크게 ────────────────────────
// 알약인데도 창이 패널 크기(380x680)면, 알약을 위로 끌 때 "보이지 않는 창 위쪽"이
// 메뉴 막대에 먼저 걸려 화면 상단까지 갈 수 없다. 그래서 알약일 때는 창도 알약 크기로 줄인다.
const PILL_PAD = 28; // 그림자가 잘리지 않도록 알약 주변 여백
// 알약·패널 모두 창 한가운데에 그려진다 (요소는 CSS 로 중앙 정렬)
let pillSize = { width: 210, height: 52 }; // 렌더러가 실제 크기를 알려준다
let winMode = "panel"; // 지금 창이 어느 크기인지
let panelOpen = false; // 패널이 열려 있는 동안에는 창을 줄이면 안 된다

function pillWinSize() {
  return { width: Math.round(pillSize.width + PILL_PAD * 2), height: Math.round(pillSize.height + PILL_PAD * 2) };
}

// ─── 기준 좌표(anchor) ───────────────────────────────────────────────
// 알약 창의 좌상단 좌표. "사용자가 위젯을 놓아둔 자리"를 뜻하는 단 하나의 기준값이며
// 창 크기(알약↔패널, 알약 폭 변화)로는 절대 바뀌지 않는다. 오직 드래그로만 갱신된다.
let pillPos = null;

function defaultPillPos() {
  const { workArea } = screen.getPrimaryDisplay();
  const size = pillWinSize();
  return {
    x: workArea.x + workArea.width - size.width - MARGIN,
    y: workArea.y + workArea.height - size.height - MARGIN,
  };
}

// 알약이 창 안에서 놓일 좌표(= 화면상으로는 항상 같은 자리)를 렌더러에 전달
function sendPillOffset() {
  if (!win || win.isDestroyed()) return;
  const [wx, wy] = win.getPosition();
  const pos = ensurePillPos();
  win.webContents.send("pill-offset", { left: pos.x + PILL_PAD - wx, top: pos.y + PILL_PAD - wy });
}

// 메뉴 막대 모드에서 사용자가 패널을 끌어 옮긴 자리 (패널 창 좌상단). 없으면 기본 자리.
let panelPos = null;
function ensurePanelPos() {
  if (panelPos) return panelPos;
  const saved = loadConfig().panelPos;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) panelPos = { x: saved.x, y: saved.y };
  return panelPos;
}
function menubarBounds() {
  const pos = ensurePanelPos();
  return pos ? clamp({ ...PANEL, x: pos.x, y: pos.y }) : homeBounds();
}

// 앱이 스스로 옮긴 위치. 'moved' 이벤트에서 사용자 드래그(헤더를 잡고 OS가 옮긴 것)와 구분하는 데 쓴다.
let expectedPos = null;
function place(bounds) {
  if (!win || win.isDestroyed()) return;
  win.setBounds(bounds, false);
  const [x, y] = win.getPosition();
  expectedPos = { x, y };
}

function ensurePillPos() {
  if (pillPos) return pillPos;
  const saved = loadConfig().pillPos;
  pillPos =
    saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? { x: saved.x, y: saved.y }
      : defaultPillPos();
  return pillPos;
}

function toPillWindow() {
  if (!win || win.isDestroyed() || placement === "menubar") return;
  if (panelOpen) return; // 패널이 떠 있는 동안 축소 금지
  winMode = "pill";
  const pos = ensurePillPos();
  const size = pillWinSize();
  // 위치는 기준 좌표 그대로. 크기가 달라져도 x/y 를 다시 계산하지 않는다.
  const b = clamp({ ...size, x: pos.x, y: pos.y });
  place(b);
  // 화면 밖이라 보정된 경우에만 기준 좌표를 따라 옮긴다
  if (b.x !== pos.x || b.y !== pos.y) pillPos = { x: b.x, y: b.y };
  sendPillOffset();
  savePosSoon();
}

function toPanelWindow() {
  if (!win || win.isDestroyed()) return;
  winMode = "panel";
  // 알약이 있던 자리(기준 좌표)를 중심으로 펼친다. pillPos 는 절대 바꾸지 않는다.
  const pos = ensurePillPos();
  const size = pillWinSize();
  place(
    clamp({
      ...PANEL,
      x: Math.round(pos.x + size.width / 2 - PANEL.width / 2),
      y: Math.round(pos.y + size.height / 2 - PANEL.height / 2),
    }),
  );
  sendPillOffset();
}

// 렌더러가 알려주는 알약 실제 크기 (내용에 따라 폭이 달라진다)
let shrinkTimer = null;
ipcMain.on("pill-size", (_e, w, h) => {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 40) return;
  pillSize = { width: w, height: h };
  if (panelOpen) return; // 패널이 열려 있으면 크기만 기억하고 창은 그대로
  if (winMode === "pill") {
    toPillWindow(); // 이미 알약 창이면 폭 변화만 반영
    return;
  }
  // 패널 크기 창 → 알약으로 돌아오는 중. 접힘 애니메이션이 끝난 뒤 줄여야 패널이 잘려 보이지 않는다.
  // (앱 시작 직후엔 등장 애니메이션이 생략돼 "완료" 신호가 오지 않으므로 이 경로로 줄인다)
  clearTimeout(shrinkTimer);
  shrinkTimer = setTimeout(toPillWindow, 340);
});

// 알약 등장 애니메이션이 끝났다 → 창을 알약 크기로 줄이고 그림자 복구
ipcMain.on("pill-ready", () => {
  // 패널이 열려 있는데 도착한 신호 = 알약이 "사라지는" 애니메이션이 끝난 것이므로 무시한다
  if (panelOpen) {
    return;
  }
  toPillWindow();
});

// 사용자가 옮겨둔 창 위치를 기억한다 (드래그 중엔 잦은 저장을 피해 디바운스)
let savePosTimer = null;
function savePosSoon() {
  clearTimeout(savePosTimer);
  savePosTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || centered) return;
    const next = { ...loadConfig(), pillPos: ensurePillPos() };
    if (panelPos) next.panelPos = panelPos;
    saveConfig(next);
  }, 400);
}

// 화면 밖으로 나가지 않게 보정
function clamp(bounds) {
  // 창이 걸쳐 있는 모니터의 작업 영역 기준 (서브 모니터에 둔 창은 서브 모니터 안에서 보정)
  const { workArea } = screen.getDisplayMatching(bounds);
  return {
    ...bounds,
    x: Math.min(
      Math.max(bounds.x, workArea.x),
      workArea.x + workArea.width - bounds.width,
    ),
    y: Math.min(
      Math.max(bounds.y, workArea.y),
      workArea.y + workArea.height - bounds.height,
    ),
  };
}

function createWindow() {
  win = new BrowserWindow({
    ...PANEL,
    ...bottomRight(PANEL),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000", // 리사이즈 시 투명 배경이 검게 변하는 버그 방지
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false, // 그림자는 CSS box-shadow 로 그린다 (네이티브 그림자는 전환 중 한 박자 늦게 따라온다)
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 패키징된 앱은 번들 안의 뱌드 결과(dist)를, 개발 중에는 Vite 개발 서버를 연다
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || "http://localhost:5173");
  }

  // 다른 곳 클릭(포커스 아웃)
  //  - 화면에 띄우기: 렌더러에 알려서 위젯으로 접기
  //  - 메뉴 막대: 창 자체를 숨김
  // 헤더(드래그 영역)를 잡고 옮기면 OS 가 직접 창을 움직여 앱은 모른다 → 'moved' 로 받아서 기억
  win.on("moved", () => {
    if (!win || win.isDestroyed() || centered) return;
    const [x, y] = win.getPosition();
    if (expectedPos && Math.abs(x - expectedPos.x) < 2 && Math.abs(y - expectedPos.y) < 2) return; // 앱이 옮긴 것
    expectedPos = { x, y };
    if (placement === "menubar") {
      panelPos = { x, y };
    } else if (winMode === "panel") {
      // 패널을 옮겼으면 알약 기준 좌표도 같은 관계를 유지하도록 역산
      const size = pillWinSize();
      pillPos = {
        x: Math.round(x + PANEL.width / 2 - size.width / 2),
        y: Math.round(y + PANEL.height / 2 - size.height / 2),
      };
      sendPillOffset();
    } else {
      pillPos = { x, y };
    }
    savePosSoon();
  });

  win.on("blur", () => {
    if (placement === "menubar") win?.hide();
    else win?.webContents.send("window-blur");
  });

  win.webContents.on("did-finish-load", () => {
    applyPlacement();
    sendPillOffset();
  });
}

// ─── 위치: 화면에 띄우기(floating) / 메뉴 막대(menubar) ───
let placement = loadConfig().placement === "menubar" ? "menubar" : "floating";
let tray = null;
let trayTitle = "";

function showPanelUnderTray(fromTray = false) {
  if (!win || !tray) return;
  place(menubarBounds()); // 사용자가 옮겨둔 자리가 있으면 그 자리(다른 모니터 포함)
  win.setBackgroundColor("#00000000");
  win.setIgnoreMouseEvents(false);
  win.show();
  win.focus();
  app.focus({ steal: true });
  // fromTray: 사용자가 메뉴 막대를 눌러 연 것 → 렌더러가 설정을 닫고 투두 화면으로
  win.webContents.send("panel-shown", fromTray);
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, "trayTemplate.png"));
  icon.setTemplateImage(true); // macOS가 라이트/다크에 맞게 자동 틴트
  tray = new Tray(icon);
  tray.setTitle(trayTitle, { fontType: "monospacedDigit" });
  tray.setToolTip("My Day");
  tray.on("click", () => {
    if (win?.isVisible()) win.hide();
    else showPanelUnderTray(true);
  });
}

function destroyTray() {
  tray?.destroy();
  tray = null;
}

function applyPlacement() {
  if (!win) return;
  winMode = "panel";
  if (placement === "menubar") {
    createTray();
    win.hide();
    place(menubarBounds());
  } else {
    destroyTray();
    // 패널이 작은 창에 짜부라지는 순간이 보이지 않게: 숨기고 → 크기 변경 → 렌더러가 위젯 모드로 그린 뒤 표시
    win.hide();
    place(homeBounds());
    win.setBackgroundColor("#00000000");
    win.webContents.send("placement", placement);
    setTimeout(() => {
      if (placement === "floating") win?.show();
    }, 120);
    return;
  }
  win.webContents.send("placement", placement);
}

ipcMain.handle("get-placement", () => placement);
ipcMain.on("set-placement", (_e, p) => {
  placement = p === "menubar" ? "menubar" : "floating";
  saveConfig({ ...loadConfig(), placement });
  applyPlacement();
  // 메뉴 막대로 바꾼 직후엔 설정 화면이 그대로 보이도록 바로 한 번 열어줌
  if (placement === "menubar") showPanelUnderTray();
});

// 메뉴 막대에 보일 글자 (예: "2 · 11:00 스탠드업")
ipcMain.on("tray-title", (_e, t) => {
  trayTitle = String(t ?? "");
  tray?.setTitle(trayTitle, { fontType: "monospacedDigit" });
});

// 모드 전환: 패널이 열릴 때 포커스만 가져옴 (바깥 클릭 시 blur로 접히기 위해)

ipcMain.on("set-mode", (_e, mode) => {
  if (mode === "widget") panelOpen = false;
  if (!win || placement === "menubar") return;
  if (mode === "panel") {
    panelOpen = true;
    clearTimeout(shrinkTimer);
    toPanelWindow();
    win.setIgnoreMouseEvents(false);
    win.show();
    win.focus();
    app.focus({ steal: true });
    // 창이 패널 크기로 커진 뒤에 패널을 그려야 잘리지 않는다
    win.webContents.send("panel-window-ready");
  }
});

// ─── 정보 / 업데이트 확인 ───────────────────────────────────
// 자동 설치는 Apple 서명이 필요해서(서명 없는 앱은 macOS가 자기 교체를 막음) 지금은 "새 버전 알림 + 다운로드 링크"만 제공.
// 나중에 서명을 붙이면 electron-updater 로 교체하면 된다.
const REPO = "oiminza/TO-Do-";
ipcMain.handle("app-version", () => app.getVersion());
ipcMain.on("quit-app", () => app.quit());
ipcMain.handle("open-external", (_e, url) => {
  const u = String(url || "");
  if (/^https:\/\/(github\.com|calendar\.google\.com)\//.test(u)) shell.openExternal(u);
});
ipcMain.handle("check-update", async () => {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "my-day" },
    });
    if (!res.ok) return { ok: false, reason: res.status === 404 || res.status === 403 ? "private" : `http ${res.status}` };
    const j = await res.json();
    const latest = String(j.tag_name || "").replace(/^v/, "");
    const current = app.getVersion();
    const newer = (a, b) => {
      const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
      return false;
    };
    return { ok: true, latest, current, hasUpdate: newer(latest, current), url: j.html_url };
  } catch (e) {
    return { ok: false, reason: "offline" };
  }
});

// 온보딩: 창을 화면 정가운데로 (끝나면 우하단으로 복귀)
ipcMain.on("center-window", (_e, on) => {
  if (!win) return;
  centered = !!on;
  if (on) winMode = "panel";
  place(homeBounds());
});

// 알약 상태: 투명 영역 클릭을 뒤로 통과 (forward: hover는 계속 감지)
ipcMain.on("ignore-mouse", (_e, ignore) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

// 드래그 이동
ipcMain.on("move-by", (_e, dx, dy) => {
  if (!win || placement === "menubar") return;
  const [x, y] = win.getPosition();
  const mx = Math.round(dx);
  const my = Math.round(dy);
  win.setPosition(x + mx, y + my, false);
  expectedPos = { x: x + mx, y: y + my };
  const pos = ensurePillPos();
  pillPos = { x: pos.x + mx, y: pos.y + my }; // 기준 좌표도 같이 이동
  savePosSoon();
});

app.whenReady().then(() => {
  app.dock?.hide();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
