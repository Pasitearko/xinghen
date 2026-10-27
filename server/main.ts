// 星痕本机服务：只监听 127.0.0.1，同时提供网页与接口。
import { createServer } from 'node:http'
import { ensureDirs, HOST, PORT, WEB_DIST } from './paths.ts'

ensureDirs()

const { dispatch, sendJson } = await import('./http.ts')
await import('./routes/images.ts')
await import('./routes/diary.ts')
await import('./routes/taste.ts')
await import('./routes/study.ts')
await import('./routes/archive.ts')
await import('./routes/profile.ts')
await import('./routes/music.ts')
await import('./routes/system.ts')
const { serveStatic } = await import('./static.ts')
const { startScheduler } = await import('./news.ts')
const { autoBackup } = await import('./backup.ts')
const { DATA_DIR } = await import('./paths.ts')

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/api/')) {
      if (!(await dispatch(req, res))) sendJson(res, 404, { detail: '没有这个接口' })
      return
    }
    serveStatic(req, res)
  } catch (err) {
    console.error('[xinghen]', err)
    if (!res.headersSent) sendJson(res, 500, { detail: '服务内部错误' })
  }
})

server.keepAliveTimeout = 65_000
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[xinghen] 端口 ${PORT} 已被占用：星痕可能已经在运行。`)
    process.exit(3)
  }
  throw err
})

server.listen(PORT, HOST, () => {
  console.log(`[xinghen] 已启动  http://${HOST}:${PORT}`)
  console.log(`[xinghen] 数据目录 ${DATA_DIR}`)
  console.log(`[xinghen] 网页目录 ${WEB_DIST}`)
  if (process.env.XINGHEN_NO_JOBS !== '1') {
    startScheduler()
    setTimeout(() => {
      autoBackup()
        .then((b) => b && console.log(`[xinghen] 已自动备份 ${b.name}`))
        .catch((err) => console.error('[xinghen] 自动备份失败', err))
    }, 8000).unref()
  }
})

const shutdown = () => {
  server.close()
  setTimeout(() => process.exit(0), 300).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
