import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Electron 패키징 시 dist/index.html을 file:// 로 열기 때문에 에셈 경로는 상대 경로로
  base: './',
})
