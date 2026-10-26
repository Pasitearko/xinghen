/** 浏览器端压缩：超过上限的图缩到长边 max，转 WebP；GIF/SVG 原样保留（动图和矢量不能重画）。 */
export async function compressImage(file: Blob, max: number, force = false): Promise<Blob> {
  if (/gif|svg/.test(file.type)) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && (file.size < 900 * 1024 || force)) {
    bitmap.close()
    return file
  }
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.88 })
  return out.size < file.size || force ? out : file
}
