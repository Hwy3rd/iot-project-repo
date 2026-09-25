import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://localhost:3000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      // Proxy the API through the dev server so auth cookies are same-origin.
      // The backend scopes refresh_token to path /auth, so rewrite it to
      // /api/auth or the browser never sends it back through the proxy.
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          cookiePathRewrite: { '/auth': '/api/auth' },
        },
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
      },
    },
  }
})
