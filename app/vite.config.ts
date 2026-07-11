import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// BASE_PATH is set by the Pages deploy workflow (e.g. /DoorsWorld/); local
// dev and preview serve from /.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: {
    port: 5179,
    strictPort: true,
  },
})
