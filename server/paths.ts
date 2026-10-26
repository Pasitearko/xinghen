// 数据目录遵循 XDG 规范：默认 ~/.local/share/feixing，可用 FEIXING_DATA_DIR 覆盖。
// 代码仓库里不存任何私人数据。
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const xdgData = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')

export const DATA_DIR = resolve(process.env.FEIXING_DATA_DIR || join(xdgData, 'feixing'))
export const DB_PATH = join(DATA_DIR, 'feixing.db')
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')
export const BACKUP_DIR = join(DATA_DIR, 'backups')
export const MUSIC_DIR = resolve(process.env.FEIXING_MUSIC_DIR || join(DATA_DIR, 'music'))

export const ROOT_DIR = resolve(import.meta.dirname, '..')
export const WEB_DIST = join(ROOT_DIR, 'web', 'dist')
export const WALLPAPER_PRESETS = join(ROOT_DIR, 'web', 'wallpapers')

export const HOST = process.env.FEIXING_HOST || '127.0.0.1'
export const PORT = Number(process.env.FEIXING_PORT || 8001)

/** 图片附件的子目录；与旧版飞星保持一致，便于迁移。 */
export const UPLOAD_SCOPES = ['taste', 'diary', 'avatar', 'wallpaper', 'images', 'avatars', 'backgrounds'] as const

export function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR, MUSIC_DIR]) mkdirSync(dir, { recursive: true })
  for (const scope of UPLOAD_SCOPES) mkdirSync(join(UPLOAD_DIR, scope), { recursive: true })
}
