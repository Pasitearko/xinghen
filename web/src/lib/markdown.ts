import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

const renderer = new marked.Renderer()
renderer.link = ({ href, text }) => `<a href="${href}" target="_blank" rel="noreferrer noopener">${text}</a>`
renderer.image = ({ href, text }) => `<img src="${href}" alt="${text || ''}" loading="lazy" decoding="async" />`
marked.use({ renderer })

/** 只渲染自己写的内容；仍去掉脚本与内联事件，粘贴来的 HTML 也安全。 */
export function renderMarkdown(md: string) {
  const html = marked.parse(md || '', { async: false }) as string
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}
