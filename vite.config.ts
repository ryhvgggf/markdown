import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Big libraries get chunks of their own: cached across releases, and no chunk goes past the 500 kB warning.
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'highlight', test: /node_modules[\\/](highlight\.js|lowlight)[\\/]/, priority: 20 },
            { name: 'prosemirror', test: /node_modules[\\/](prosemirror-[^\\/]+|y-prosemirror|@tiptap[\\/]pm)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
