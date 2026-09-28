// ─── Google 로그인(OAuth 2.0) + Calendar API ──────────────────────────────
// 흐름: 브라우저에서 구글 로그인 → 허용 → 로컬 콜백(http://127.0.0.1:포트) 로 코드 수신 → 토큰 교환
// 토큰은 Electron safeStorage(macOS 키체인)로 암호화해서 userData 에 저장. 만료되면 refresh_token 으로 자동 갱신.
const { app, shell, safeStorage } = require("electron");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// 클라이언트 자격증명: 빌드에 포함되는 secrets/google-oauth.json (깃 제외)
function loadClient() {
  const candidates = [
    path.join(__dirname, "secrets", "google-oauth.json"),
    path.join(process.resourcesPath || "", "google-oauth.json"),
  ];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      const c = j.installed || j.web || j;
      if (c.client_id) return { clientId: c.client_id, clientSecret: c.client_secret || "" };
    } catch {
      /* try next */
    }
  }
  return null;
}

const tokenPath = () => path.join(app.getPath("userData"), "google-token.bin");

function saveToken(tok) {
  const raw = Buffer.from(JSON.stringify(tok), "utf8");
  const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(raw.toString("utf8")) : raw;
  fs.writeFileSync(tokenPath(), enc);
}
function loadToken() {
  try {
    const buf = fs.readFileSync(tokenPath());
    const str = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
    return JSON.parse(str);
  } catch {
    return null;
  }
}
function clearToken() {
  try {
    fs.unlinkSync(tokenPath());
  } catch {
    /* ignore */
  }
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── 로그인: 브라우저 열고 로컬 콜백에서 코드 받기 ──
let pending = null; // 진행 중인 로그인 (중복 방지)
async function signIn() {
  const client = loadClient();
  if (!client) return { ok: false, reason: "no_client" };
  if (pending) return pending;

  pending = new Promise((resolve) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const server = http.createServer(async (req, res) => {
      console.log("[google] callback hit", req.url.split("?")[0]);
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const page = (title, body) =>
        `<!doctype html><meta charset="utf-8"><title>${title}</title>
         <body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fff;color:#1d1d1b">
         <div style="text-align:center"><div style="font-size:40px">${title === "완료" ? "✓" : "✕"}</div>
         <h2 style="margin:12px 0 6px">${title}</h2><p style="color:#8a8a8e">${body}</p></div>`;
      try {
        if (u.searchParams.get("state") !== state) throw new Error("state_mismatch");
        const err = u.searchParams.get("error");
        if (err) throw new Error(err);
        const code = u.searchParams.get("code");
        if (!code) throw new Error("no_code");
        const body = new URLSearchParams({
          code,
          client_id: client.clientId,
          client_secret: client.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: verifier,
        });
        const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        const tok = await r.json();
        if (!r.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || "token_error");
        tok.expires_at = Date.now() + (tok.expires_in || 3600) * 1000;
        // 사용자 이메일 (표시용)
        try {
          const me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((x) => x.json());
          tok.email = me.email || "";
        } catch {
          /* optional */
        }
        saveToken(tok);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("완료", "My Day로 돌아가셔도 됩니다. 이 창은 닫아도 돼요."));
        finish({ ok: true, email: tok.email || "" });
      } catch (e) {
        const msg = String(e.message || e);
        console.log("[google] failed:", msg);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("연결 실패", msg));
        finish({ ok: false, reason: msg });
      }
    });

    let redirectUri = "";
    const timeout = setTimeout(() => finish({ ok: false, reason: "timeout" }), 5 * 60 * 1000);
    const finish = (result) => {
      clearTimeout(timeout);
      try {
        server.close();
      } catch {
        /* ignore */
      }
      pending = null;
      resolve(result);
    };

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: `${SCOPE} email`,
        access_type: "offline", // refresh_token 받기
        prompt: "consent",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
      console.log("[google] opening browser, callback on", redirectUri);
      shell.openExternal(`${AUTH_URL}?${params}`).catch((e) => {
        console.log("[google] openExternal failed", e);
        finish({ ok: false, reason: "open_browser_failed" });
      });
    });
  });
  return pending;
}

// ── 유효한 access_token 확보 (만료 시 갱신) ──
async function getAccessToken() {
  const tok = loadToken();
  if (!tok) return null;
  if (tok.expires_at && Date.now() < tok.expires_at - 60_000) return tok.access_token;
  if (!tok.refresh_token) return null;
  const client = loadClient();
  if (!client) return null;
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: tok.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    if (j.error === "invalid_grant") clearToken(); // 권한 철회됨 → 재로그인 필요
    throw new Error(j.error || "refresh_failed");
  }
  const next = { ...tok, access_token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
  saveToken(next);
  return next.access_token;
}

// ── 오늘 일정 조회 (기본 캘린더 + 선택된 다른 캘린더) ──
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

async function fetchTodayEvents() {
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: "not_signed_in" };
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const params = new URLSearchParams({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: "true", // 반복 일정을 오늘 발생분으로 펼쳐줌
    orderBy: "startTime",
    maxResults: "50",
  });
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) {
    clearToken();
    return { ok: false, reason: "not_signed_in" };
  }
  if (!r.ok) return { ok: false, reason: `http ${r.status}` };
  const j = await r.json();
  const events = [];
  for (const it of j.items || []) {
    if (it.status === "cancelled") continue;
    if (!it.start?.dateTime) continue; // 종일 일정 제외
    if (it.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue; // 내가 거절한 일정 제외
    const s = new Date(it.start.dateTime);
    const e = new Date(it.end?.dateTime || it.start.dateTime);
    events.push({ name: it.summary || "(제목 없음)", start: hm(s), end: hm(e) });
  }
  return { ok: true, events };
}

function status() {
  const tok = loadToken();
  return { signedIn: !!tok, email: tok?.email || "", clientConfigured: !!loadClient() };
}

async function signOut() {
  const tok = loadToken();
  if (tok?.refresh_token || tok?.access_token) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(tok.refresh_token || tok.access_token)}`, { method: "POST" });
    } catch {
      /* ignore */
    }
  }
  clearToken();
  return true;
}

module.exports = { signIn, signOut, status, fetchTodayEvents };
