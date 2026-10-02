import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer')
}

/** Strict Content-Security-Policy for the packaged app (dev server needs inline scripts for HMR). */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: journal-file:",
  "font-src 'self' data:",
  "connect-src 'self' journal-file:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html: string) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
    }
  }
}

// All runtime libraries live in devDependencies and are bundled, so the packaged
// app.asar contains only the build output (no node_modules, no native modules).
export default defineConfig({
  main: {
    resolve: { alias },
    build: { externalizeDeps: false }
  },
  preload: {
    resolve: { alias },
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss(), cspPlugin()],
    build: { chunkSizeWarningLimit: 2000, minify: 'esbuild' }
  }
})
