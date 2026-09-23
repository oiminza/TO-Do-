import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 렌더 중 예외가 나면 빈 화면 대신 원인을 보여준다 (Dock 에 없는 앱이라 빈 창은 디버깅이 어렵다)
const showFatal = (msg: string) => {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `<pre style="margin:16px;padding:12px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;color:#b00;background:#fff;border:1px solid #f3c;border-radius:8px">${msg
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</pre>`
}
window.addEventListener('error', (e) => showFatal(`${e.message}\n${e.error?.stack ?? ''}`))
window.addEventListener('unhandledrejection', (e) => showFatal(`Unhandled: ${String((e as PromiseRejectionEvent).reason)}`))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
