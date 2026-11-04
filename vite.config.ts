/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Política de seguridad de contenido (solo en el build; en desarrollo Vite necesita scripts en línea).
 * Limita a dónde puede conectarse la app y de dónde carga scripts e imágenes: reduce el daño de un XSS futuro.
 * GitHub Pages no permite cabeceras HTTP, por eso va como <meta>.
 */
function cspPlugin(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'novacell-csp',
    apply: 'build',
    transformIndexHtml() {
      const origin = supabaseUrl ? new URL(supabaseUrl).origin : ''
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: ${origin}`.trim(),
        "font-src 'self'",
        `connect-src 'self' ${origin}`.trim(),
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      return [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
        { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
      ]
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss(), cspPlugin(env.VITE_SUPABASE_URL)],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: {
      environment: 'jsdom',
      globals: true,
      testTimeout: 20_000,
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/unit/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    },
  }
})
