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
  const v = String(url ?? "").trim();
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

ipcMain.handle("calendar-events", async () => {
  const { icsUrl } = loadConfig();

  // 1) Google 로그인 상태면 Calendar API 로 (Workspace 계정도 동작)
  if (gauth.status().signedIn) {
    try {
      const r = await gauth.fetchTodayEvents();
      if (r.ok) {
        saveCache(r.events);
        return { configured: true, source: "google", events: r.events, fetchedAt: Date.now() };
      }
      if (r.reason === "not_signed_in") return { configured: !!icsUrl, source: "google", events: [], error: "signed_out" };
      const cached = loadCache();
      return { configured: true, source: "google", events: cached ? cached.events : [], error: /429/.test(r.reason) ? "rate_limited" : "error" };
    } catch (e) {
      const cached = loadCache();
      const msg = String(e?.message || e);
      return { configured: true, source: "google", events: cached ? cached.events : [], error: /ENOTFOUND|ECONN|fetch failed/i.test(msg) ? "offline" : "error" };
    }
  }

  // 2) ICS 주소 (개인 Gmail / iCloud 등)
  if (!icsUrl) {
    if (app.isPackaged) return { configured: false, events: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(localEventsPath, "utf8"));
      const todayStr = new Date().toLocaleDateString("sv");
      return {
        configured: true,
        events: raw.date === todayStr ? raw.events : [],
      };
    } catch {
      return { configured: false, events: [] };
    }
  }
  try {
    const data = await nodeIcal.async.fromURL(icsUrl);
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const hm = (d) =>
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const events = [];
    for (const k in data) {
      const ev = data[k];
      if (ev.type !== "VEVENT") continue;
      const dur = (ev.end?.getTime() || 0) - (ev.start?.getTime() || 0);
      if (dur >= 86400000) continue; // 종일 이벤트는 일단 제외
      const push = (s) => {
        const e2 = new Date(s.getTime() + dur);
        events.push({ name: ev.summary || "(제목 없음)", start: hm(s), end: hm(e2) });
      };
      if (ev.rrule) {
        // 반복 일정: 오늘 발생분만 확장
        const exdates = ev.exdate
          ? Object.values(ev.exdate).map((d) => new Date(d).getTime())
          : [];
        ev.rrule
          .between(dayStart, dayEnd, true)
          .filter((d0) => !exdates.some((x) => Math.abs(x - d0.getTime()) < 1000))
          .forEach(push);
      } else if (ev.start >= dayStart && ev.start < dayEnd) {
        push(ev.start);
      }
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    saveCache(events);
    return { configured: true, events, fetchedAt: Date.now() };
  } catch (e) {
    const msg = String(e?.message || e);
    const reason = /429/.test(msg) ? "rate_limited" : /ENOTFOUND|ECONN|fetch failed|network/i.test(msg) ? "offline" : "error";
    const cached = loadCache();
    return {
      configured: true,
      events: cached ? cached.events : [],
      fetchedAt: cached ? cached.fetchedAt : null,
      error: reason,
    };
  }
});

// 창은 항상 패널 크기의 투명 창. 알약↔패널 전환은 렌더러 안에서 애니메이션으로.
// 알약 상태에서는 setIgnoreMouseEvents로 투명 영역 클릭을 뒤 화면으로 통과시킴.
const PANEL = { width: 380, height: 680 };
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
// 기본 자리: 센터 모드면 가운데, 아니면 우하단
function homeBounds() {
  return clamp({ ...PANEL, ...(centered ? centerOf(PANEL) : bottomRight(PANEL)) });
}

function bottomRight(size) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - size.width - MARGIN,
    y: workArea.y + workArea.height - size.height - MARGIN,
  };
}

// 화면 밖으로 나가지 않게 보정
function clamp(bounds) {
  const { workArea } = screen.getDisplayMatching(bounds).workArea
    ? screen.getDisplayMatching(bounds)
    : screen.getPrimaryDisplay();
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
    hasShadow: true, // 투명 창이지만 macOS가 내용(알파) 모양을 따라 그림자를 그려줌
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
  win.on("blur", () => {
    if (placement === "menubar") win?.hide();
    else {
      win?.webContents.send("window-blur");
      refreshShadow(); // 패널 → 알약으로 접힐 때도 그림자 갱신
    }
  });

  win.webContents.on("did-finish-load", () => applyPlacement());
}

// ─── 위치: 화면에 띄우기(floating) / 메뉴 막대(menubar) ───
let placement = loadConfig().placement === "menubar" ? "menubar" : "floating";
let tray = null;
let trayTitle = "";

function showPanelUnderTray(fromTray = false) {
  if (!win || !tray) return;
  win.setBounds(homeBounds(), false);
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
  if (placement === "menubar") {
    createTray();
    win.hide();
    win.setBounds(homeBounds(), false);
  } else {
    destroyTray();
    // 패널이 작은 창에 짜부라지는 순간이 보이지 않게: 숨기고 → 크기 변경 → 렌더러가 위젯 모드로 그린 뒤 표시
    win.hide();
    win.setBounds(homeBounds(), false);
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
function refreshShadow() {
  // 알약 ↔ 패널 전환 애니메이션(≈300ms) 끝난 뒤 그림자를 새 모양에 맞게 다시 그린다
  setTimeout(() => win?.invalidateShadow?.(), 420);
  setTimeout(() => win?.invalidateShadow?.(), 900);
}

ipcMain.on("set-mode", (_e, mode) => {
  refreshShadow();
  if (!win || placement === "menubar") return;
  if (mode === "panel") {
    win.setIgnoreMouseEvents(false);
    win.show();
    win.focus();
    app.focus({ steal: true });
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
  refreshShadow();
  win.setBounds(homeBounds(), false);
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
  win.setPosition(x + Math.round(dx), y + Math.round(dy), false);
});

app.whenReady().then(() => {
  app.dock?.hide();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
