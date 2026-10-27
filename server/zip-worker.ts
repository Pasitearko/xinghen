// 备份压缩的后台线程：每次导出时临时起一个，压完就退出。
// 图片按原样存入时 fflate 也要算一遍 CRC，几百 MB 的附件放在主线程会卡住所有请求。
import { parentPort } from 'node:worker_threads'
import { zipSync, type Zippable } from 'fflate'

parentPort!.once('message', (files: Zippable) => {
  const out = zipSync(files, { level: 6 })
  parentPort!.postMessage(out, [out.buffer as ArrayBuffer])
})
