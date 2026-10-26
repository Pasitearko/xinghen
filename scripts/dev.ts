// 开发模式：后端 node --watch（8001）+ Vite 开发服务器（5199，/api 代理到后端）。
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const bin = (name: string) => join(root, 'node_modules', '.bin', name)

const procs = [
  spawn(process.execPath, ['--watch', 'server/main.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, FEIXING_NO_JOBS: process.env.FEIXING_NO_JOBS ?? '1' } }),
  spawn(bin('vite'), ['--config', 'web/vite.config.ts'], { cwd: root, stdio: 'inherit' }),
]

const stop = () => {
  for (const p of procs) p.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', (code) => {
  stop()
  process.exitCode = code ?? 0
})
