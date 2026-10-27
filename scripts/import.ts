// 命令行导入：./xinghen import <路径> [--dry]
// 路径可以是另一份数据文件夹（含 xinghen.db 或旧版的 feixing.db，以及 uploads/）、备份 zip、单个数据库文件或 JSON。
// 导入是合并：已有的不会重复，也不会覆盖。服务开着也能导入（SQLite WAL）。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { ensureDirs } from '../server/paths.ts'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const target = args.find((a) => !a.startsWith('--'))
if (!target) {
  console.error('用法：./xinghen import <旧数据文件夹 | 备份.zip | xinghen.db | 备份.json> [--dry]')
  process.exit(2)
}
const path = resolve(target)
if (!existsSync(path)) {
  console.error(`找不到 ${path}`)
  process.exit(2)
}

ensureDirs()
const { applyBundle, fromOldDataDir, parseUpload } = await import('../server/backup.ts')

try {
  const bundle = statSync(path).isDirectory() ? fromOldDataDir(path) : parseUpload(readFileSync(path), basename(path))
  const r = applyBundle(bundle, dry)
  const line = (name: string, x: { added: number; skipped: number }) => `  ${name}  新增 ${x.added}，已存在跳过 ${x.skipped}`
  console.log(dry ? `预览（没有写入）：${r.kind}` : `已导入：${r.kind}`)
  console.log(line('日记', r.diaries))
  console.log(line('收藏', r.taste))
  console.log(line('自习', r.study))
  console.log(line('图片', r.images) + (r.images.inline ? `，内联图 ${r.images.inline}` : ''))
  if (r.profile) console.log('  个人资料  已导入')
  for (const n of r.notes) console.log(`  提示：${n}`)
} catch (err) {
  console.error(`导入失败：${(err as Error).message}`)
  process.exit(1)
}
