// 数据目录遵循 XDG 规范：默认 ~/.local/share/xinghen，可用 XINGHEN_DATA_DIR 覆盖。
// 代码仓库里不存任何私人数据。
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const xdgData = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')

export const DATA_DIR = resolve(process.env.XINGHEN_DATA_DIR || join(xdgData, 'xinghen'))
export const DB_PATH = join(DATA_DIR, 'xinghen.db')
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')
export const BACKUP_DIR = join(DATA_DIR, 'backups')
export const MUSIC_DIR = resolve(process.env.XINGHEN_MUSIC_DIR || join(DATA_DIR, 'music'))

/** 改名前用的数据目录、数据库和备份文件名。只在这里出现，用来把旧数据原样搬过来。 */
const LEGACY = { dir: join(xdgData, 'feixing'), db: 'feixing.db', backup: /^feixing-(auto|backup|diary-markdown)-/ }

// 必须在打开数据库之前跑完（db.ts 一加载就会打开 DB_PATH），所以放在模块顶层。
// 每一步都先看目标在不在，重复执行不会动已经迁好的东西。
function migrateLegacy() {
  if (!process.env.XINGHEN_DATA_DIR && !existsSync(DATA_DIR) && existsSync(LEGACY.dir)) {
    renameSync(LEGACY.dir, DATA_DIR)
    console.log(`[xinghen] 数据目录已从 ${LEGACY.dir} 搬到 ${DATA_DIR}`)
  }
  // WAL 和 shm 必须跟着主文件一起改名，否则没写回主库的最后几次修改会丢
  for (const ext of ['', '-wal', '-shm']) {
    const from = join(DATA_DIR, LEGACY.db + ext)
    if (existsSync(from) && !existsSync(DB_PATH + ext)) renameSync(from, DB_PATH + ext)
  }
  // 备份改用新前缀，自动备份的轮换只认新名字
  if (existsSync(BACKUP_DIR)) {
    for (const f of readdirSync(BACKUP_DIR)) {
      const to = join(BACKUP_DIR, f.replace(LEGACY.backup, 'xinghen-$1-'))
      if (to !== join(BACKUP_DIR, f) && !existsSync(to)) renameSync(join(BACKUP_DIR, f), to)
    }
  }
}
migrateLegacy()

export const ROOT_DIR = resolve(import.meta.dirname, '..')
export const WEB_DIST = join(ROOT_DIR, 'web', 'dist')
export const WALLPAPER_PRESETS = join(ROOT_DIR, 'web', 'wallpapers')

export const HOST = process.env.XINGHEN_HOST || '127.0.0.1'
export const PORT = Number(process.env.XINGHEN_PORT || 8001)

/** 图片附件的子目录；与旧版保持一致，便于迁移。 */
export const UPLOAD_SCOPES = ['taste', 'diary', 'avatar', 'wallpaper', 'images', 'avatars', 'backgrounds'] as const

export function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR, MUSIC_DIR]) mkdirSync(dir, { recursive: true })
  for (const scope of UPLOAD_SCOPES) mkdirSync(join(UPLOAD_DIR, scope), { recursive: true })
}
