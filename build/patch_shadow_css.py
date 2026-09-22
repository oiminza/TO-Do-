import re

# ─────────────────────────── main.cjs ───────────────────────────
p = "electron/main.cjs"
s = open(p, encoding="utf-8").read()

def rep(old, new, src=None):
    global s
    assert old in s, old[:90]
    s = s.replace(old, new, 1)

# 1) 네이티브 그림자 끄기 — 그림자는 이제 CSS(box-shadow)가 담당한다
rep(
    '''    hasShadow: true, // 투명 창이지만 macOS가 내용(알파) 모양을 따라 그림자를 그려줌''',
    '''    hasShadow: false, // 그림자는 CSS box-shadow 로 그린다 (네이티브 그림자는 전환 중 한 박자 늦게 따라와 어긋난다)''',
)

# 2) 창 여백 확보: 그림자가 창 경계에서 잘리지 않도록
rep(
    '''const PANEL = { width: 380, height: 680 };''',
    '''// 패널 본체(360x600) + 그림자가 그려질 여백(28px)
const PANEL = { width: 416, height: 656 };''',
)
rep(
    '''const PILL_PAD = 14; // 그림자가 잘리지 않도록 알약 주변 여백''',
    '''const PILL_PAD = 28; // 그림자가 잘리지 않도록 알약 주변 여백''',
)
rep(
    '''const PILL_IN_PANEL = { right: 14, bottom: 14 };''',
    '''const PILL_IN_PANEL = { right: 28, bottom: 28 };''',
)

# 3) 그림자 제어 코드 제거 (전환 중 껐다 켜는 로직 자체가 불필요해짐)
s = re.sub(r'function restoreShadow\(\) \{[\s\S]*?\n\}\n\n', "", s, count=1)
s = re.sub(r'// 렌더러\(framer-motion\)가 전환 애니메이션 완료를[\s\S]*?ipcMain\.on\("shadow-ready", restoreShadow\);\n', "", s, count=1)
s = re.sub(r'let shadowTimer = null;\n// 알약 ↔ 패널 전환 동안에는[\s\S]*?\nfunction suspendShadow\(ms = 700\) \{[\s\S]*?\n\}\n', "", s, count=1)
s = re.sub(r'[ \t]*suspendShadow\([^\n]*\);\n', "", s)
s = re.sub(r'[ \t]*restoreShadow\(\);\n', "", s)
s = re.sub(r'[ \t]*logBounds\([^\n]*\);\n', "", s)
s = re.sub(r'function logBounds\(tag\) \{[\s\S]*?\n\}\n', "", s, count=1)

# blur 핸들러 정리
rep(
    '''    else {
      win?.webContents.send("window-blur");
    }''',
    '''    else win?.webContents.send("window-blur");''',
)

assert "suspendShadow" not in s and "restoreShadow" not in s and "logBounds" not in s
open(p, "w", encoding="utf-8").write(s)

# ─────────────────────────── preload.cjs ───────────────────────────
p = "electron/preload.cjs"
s = open(p, encoding="utf-8").read()
s = s.replace('  shadowReady: () => ipcRenderer.send("shadow-ready"),\n', "")
open(p, "w", encoding="utf-8").write(s)

# ─────────────────────────── App.tsx ───────────────────────────
p = "src/App.tsx"
s = open(p, encoding="utf-8").read()

def rep2(old, new):
    global s
    assert old in s, old[:90]
    s = s.replace(old, new, 1)

rep2('''      shadowReady: () => void;\n''', "")
rep2('''              onAnimationComplete={() => window.widget?.shadowReady()}\n''', "")

# 패널: container 자체에 box-shadow (전환에 transition 없음 — 처음부터 최종 상태)
rep2(
    '''        className={`sk-outer flex h-[600px] w-[360px] flex-col overflow-hidden rounded-[28px] bg-background-secondary ${
          isElectron ? "" : "shadow-2xl"
        }`}''',
    '''        className="sk-outer flex h-[600px] w-[360px] flex-col overflow-hidden rounded-[28px] bg-background-secondary shadow-[0_6px_20px_rgba(0,0,0,0.18)]"''',
)
# 패널/알약을 창 안에서 같은 기준(28px)에 배치 — 그림자 여백과 동일
rep2('''              className="absolute bottom-2 right-2"''', '''              className="absolute bottom-7 right-7"''')
rep2('''      className="absolute bottom-[14px] right-[14px]"''', '''      className="absolute bottom-7 right-7"''')

# 알약: 버튼 자체에 box-shadow. transition 은 transform/colors 에만 (box-shadow 제외)
rep2(
    '''        className="sk-pill flex cursor-grab items-center gap-2.5 rounded-full border border-black/8 bg-white py-3 pl-5 pr-5 transition-transform hover:scale-[1.03] active:cursor-grabbing dark:border-white/10 dark:bg-background-secondary/75"''',
    '''        className="sk-pill flex cursor-grab items-center gap-2.5 rounded-full border border-black/8 bg-white py-3 pl-5 pr-5 shadow-[0_5px_16px_rgba(0,0,0,0.16)] transition-transform hover:scale-[1.03] active:cursor-grabbing dark:border-white/10 dark:bg-background-secondary/75"''',
)

open(p, "w", encoding="utf-8").write(s)

# ─────────────────────────── index.css (낙서 스킨) ───────────────────────────
p = "src/index.css"
s = open(p, encoding="utf-8").read()
rep3_old = '''html.sketch .sk-outer {
  background: var(--paper);
}'''
rep3_new = '''html.sketch .sk-outer {
  background: var(--paper);
  /* 그림자는 컨테이너 자체에 — transition 을 걸지 않아 팝업과 항상 한 덩어리로 나타난다 */
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}
html.sketch .sk-pill {
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.18);
}'''
assert rep3_old in s
s = s.replace(rep3_old, rep3_new, 1)
open(p, "w", encoding="utf-8").write(s)

print("ok")
