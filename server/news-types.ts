export const COMPANIES = ['anthropic', 'openai', 'deepseek'] as const
export type Company = (typeof COMPANIES)[number]
export type Category = 'official' | 'media' | 'community' | 'aggregate'
export type EventKind = 'model-release' | 'model-upgrade' | 'product-update' | 'website-news'

export interface Source {
  key: string
  brand: string
  name: string
  url: string
  kind: 'rss' | 'github' | 'anthropic' | 'deepseek' | 'hn' | 'gnews' | 'hf' | 'dated' | 'cards' | 'openai-api'
  category: Category
  company?: Company
  /** 官网原文保留；模型/产品专源与外部报道分别按范围筛选。 */
  scope?: 'website' | 'model' | 'product'
  product?: 'Codex' | 'Claude' | 'Claude Code' | 'DeepSeek'
  off?: boolean
  home: string
}

export interface Raw {
  title: string
  url: string
  summary: string
  published: string | null
  dateOnly?: boolean
}

export interface ItemRow extends Omit<Raw, 'published'> {
  id: number
  brand: string
  source_key: string
  published_at: string | null
  fetched_at: string
  published_day: string
}
