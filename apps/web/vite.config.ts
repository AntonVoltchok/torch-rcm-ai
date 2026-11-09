/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    // `pnpm test:contract` runs the one suite that needs a dump of the real API (scripts/contract-real.mjs).
    include: process.env.CONTRACT_DUMP ? ['src/api/real.contract.ts'] : ['src/**/*.test.{ts,tsx}'],
    env: { VITE_API_BASE: 'http://localhost:8000/api/v1' },
    restoreMocks: true,
  },
})
