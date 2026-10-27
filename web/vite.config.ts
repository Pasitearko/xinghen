import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const API = `http://127.0.0.1:${process.env.XINGHEN_PORT || 8001}`

/** 构建后给文本资源生成 .br / .gz，本机服务直接返回预压缩版本。 */
function precompress(): Plugin {
  return {
    name: 'xinghen-precompress',
    apply: 'build',
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f)
          return statSync(p).isDirectory() ? walk(p) : [p]
        })
      for (const file of walk(join(import.meta.dirname, 'dist'))) {
        if (!/\.(js|css|html|svg|json)$/.test(file)) continue
        const buf = readFileSync(file)
        if (buf.length < 1024) continue
        writeFileSync(`${file}.br`, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }))
        writeFileSync(`${file}.gz`, gzipSync(buf, { level: 9 }))
      }
    },
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), precompress()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    proxy: { '/api': { target: API, changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: true,
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'motion'
        },
      },
    },
  },
})
