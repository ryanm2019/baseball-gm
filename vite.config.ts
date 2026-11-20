import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the built game works from any URL path (static hosting, artifacts).
export default defineConfig({
  base: './',
  plugins: [react()],
})
