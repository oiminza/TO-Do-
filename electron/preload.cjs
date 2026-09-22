const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widget", {
  isElectron: true,
  setMode: (mode) => ipcRenderer.send("set-mode", mode),
  moveBy: (dx, dy) => ipcRenderer.send("move-by", dx, dy),
  onBlur: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("window-blur", handler);
    return () => ipcRenderer.removeListener("window-blur", handler);
  },
  calendarSetUrl: (url) => ipcRenderer.invoke("calendar-set-url", url),
  googleStatus: () => ipcRenderer.invoke("google-status"),
  googleSignIn: () => ipcRenderer.invoke("google-sign-in"),
  googleSignOut: () => ipcRenderer.invoke("google-sign-out"),
  calendarGetUrl: () => ipcRenderer.invoke("calendar-get-url"),
  getPlacement: () => ipcRenderer.invoke("get-placement"),
  setPlacement: (p) => ipcRenderer.send("set-placement", p),
  onPlacement: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on("placement", handler);
    return () => ipcRenderer.removeListener("placement", handler);
  },
  onPanelShown: (cb) => {
    const handler = (_e, fromTray) => cb(!!fromTray);
    ipcRenderer.on("panel-shown", handler);
    return () => ipcRenderer.removeListener("panel-shown", handler);
  },
  setTrayTitle: (t) => ipcRenderer.send("tray-title", t),
  ignoreMouse: (b) => ipcRenderer.send("ignore-mouse", !!b),
  centerWindow: (on) => ipcRenderer.send("center-window", !!on),
  shadowReady: () => ipcRenderer.send("shadow-ready"),
  pillReady: () => ipcRenderer.send("pill-ready"),
  onPanelWindowReady: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("panel-window-ready", handler);
    return () => ipcRenderer.removeListener("panel-window-ready", handler);
  },
  pillSize: (w, h) => ipcRenderer.send("pill-size", w, h),
  appVersion: () => ipcRenderer.invoke("app-version"),
  quitApp: () => ipcRenderer.send("quit-app"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  calendarEvents: () => ipcRenderer.invoke("calendar-events"),
});
