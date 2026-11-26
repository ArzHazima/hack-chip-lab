/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Content-Security-Policy for the PRODUCTION build only (apply: 'build'). The dev server needs inline
// scripts and a websocket for hot reload, which this policy would block, so `npm run dev` is unchanged.
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'"

function cspPlugin(): Plugin {
  return {
    name: 'hacklab-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  test: { environment: 'node', include: ['src/**/*.test.ts', 'tests/**/*.test.ts'] },
})
