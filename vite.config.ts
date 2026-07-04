import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages는 https://<user>.github.io/holdup/ 경로에 배포되므로
  // CI 빌드에서만 base를 바꾼다 (로컬 dev/빌드는 그대로 /)
  base: process.env.GITHUB_ACTIONS ? '/holdup/' : '/',
})
