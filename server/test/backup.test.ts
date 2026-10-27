// 迁移测试：Windows 旧版飞星导出的 v4 ZIP 能完整导入，重复导入不产生重复条目。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { strToU8, zipSync } from 'fflate'

const DATA = mkdtempSync(join(tmpdir(), 'feixing-test-'))
process.env.FEIXING_DATA_DIR = DATA
// 跑完删掉临时数据目录，不在 /tmp 里留垃圾
after(() => rmSync(DATA, { recursive: true, force: true }))
const { ensureDirs } = await import('../paths.ts')
ensureDirs()
const { applyBundle, parseUpload, exportZip } = await import('../backup.ts')
const { all, get } = await import('../db.ts')
const { readFileSync } = await import('node:fs')

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')

function oldBackup() {
  const tables = {
    diary_entries: [
      {
        id: 7, identity: '3f1c9d2e-0000-4000-8000-000000000001', version: 3, date_key: '2026-09-19', entry_index: 1,
        title: '拥抱AI，这是一切的开始', content_md: '正文 ![图](/api/v1/images/diary-a.png)', weather: '晴', mood: '兴奋',
        tags: ['AI'], char_count: 4, excerpt: '', cover_url: '', sealed_at: '2026-09-19T16:00:00+00:00',
        created_at: '2026-09-19T03:00:00+00:00', updated_at: '2026-09-19T04:00:00+00:00',
      },
    ],
    taste_items: [
      { id: 1, legacy_id: 'mabc123', type: 'link', title: '白色相簿2', subtitle: '', url: 'https://example.com', images: [{ url: '/api/v1/images/taste-b.png', name: 'b' }], tags: ['游戏'], category: '作品', note: '', legacy_created_at: null, created_at: '2026-09-20 10:00:00', updated_at: '2026-09-20 10:00:00' },
    ],
    image_assets: [
      { id: 1, filename: 'diary-a.png', original_name: 'a.png', url: '/api/v1/images/diary-a.png', scope: 'diary', file_size: PNG.length, width: 1, height: 1, mime_type: 'image/png' },
      { id: 2, filename: 'taste-b.png', original_name: 'b.png', url: '/api/v1/images/taste-b.png', scope: 'taste', file_size: PNG.length, width: 1, height: 1, mime_type: 'image/png' },
    ],
    study_todos: [{ id: 5, title: '读书', duration_minutes: 25, break_minutes: 5, completed_pomodoros: 2, is_completed: false, sort_order: 0, created_at: '2026-09-21T01:00:00+00:00', updated_at: '2026-09-21T01:00:00+00:00' }],
    study_sessions: [{ id: 1, session_id: 'sess-0000-0001', todo_id: 5, date_key: '2026-09-21', started_at: '2026-09-21T01:00:00+00:00', ended_at: '2026-09-21T01:25:00+00:00', planned_minutes: 25, focused_seconds: 1500, pomodoros: 1, status: 'finished', tags: [] }],
    profile: [{ id: 1, name: '飞星', bio_md: '', bio_html: '', avatar_url: '', cover_url: '' }],
  }
  return Buffer.from(
    zipSync({
      'manifest.json': strToU8(JSON.stringify({ app: 'feixing', version: 4 })),
      'tables.json': strToU8(JSON.stringify(tables)),
      'attachments/diary/diary-a.png': PNG,
      'attachments/taste/taste-b.png': PNG,
    }),
  )
}

test('预览不写库', () => {
  const r = applyBundle(parseUpload(oldBackup()), true)
  assert.equal(r.kind, 'feixing-windows-v4')
  assert.equal(r.diaries.added, 1)
  assert.equal(r.taste.added, 1)
  assert.equal(r.images.added, 2)
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM diary_entries')!.n, 0)
})

test('导入 v4 备份：正文、图片地址、自习记录都对得上', () => {
  const r = applyBundle(parseUpload(oldBackup()), false)
  assert.equal(r.diaries.added, 1)
  assert.equal(r.study.added, 2)
  const d = get<{ content_md: string; identity: string; char_count: number }>('SELECT * FROM diary_entries')!
  assert.equal(d.identity, '3f1c9d2e-0000-4000-8000-000000000001')
  assert.match(d.content_md, /\/api\/images\/diary-a\.png/)
  const t = get<{ images: string }>('SELECT images FROM taste_items')!
  assert.match(t.images, /\/api\/images\/taste-b\.png/)
  const s = get<{ todo_id: number }>('SELECT todo_id FROM study_sessions')!
  assert.equal(s.todo_id, get<{ id: number }>('SELECT id FROM study_todos')!.id)
  assert.equal(get<{ name: string }>('SELECT name FROM profile')!.name, '飞星')
})

test('重复导入是幂等的', () => {
  const r = applyBundle(parseUpload(oldBackup()), false)
  assert.equal(r.diaries.added, 0)
  assert.equal(r.diaries.skipped, 1)
  assert.equal(r.taste.added, 0)
  assert.equal(all('SELECT * FROM diary_entries').length, 1)
})

test('本版导出的备份可以再导回', async () => {
  const out = await exportZip()
  const r = applyBundle(parseUpload(readFileSync(out.path)), true)
  assert.equal(r.kind, 'feixing-linux')
  assert.equal(r.diaries.skipped, 1)
  assert.equal(r.diaries.added, 0)
})

test('旧站扁平日记 JSON', () => {
  const json = Buffer.from(JSON.stringify({ '2026-09-16': { title: 'AI之始', content: '七个字的正文', mood: 'calm', tags: '一、二' } }))
  const r = applyBundle(parseUpload(json), false)
  assert.equal(r.kind, 'legacy-diary-json')
  assert.equal(r.diaries.added, 1)
  const d = get<{ tags: string }>("SELECT tags FROM diary_entries WHERE date_key = '2026-09-16'")!
  assert.deepEqual(JSON.parse(d.tags), ['一', '二'])
})
