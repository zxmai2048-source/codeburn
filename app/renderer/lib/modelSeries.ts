export const SERIES_HEX = {
  opus: '#5B8CFF',
  sonnet: '#8B7CF6',
  haiku: '#B5A8FF',
  gpt: '#4DD8E6',
  other: '#5F6780',
} as const

export type SeriesKey = keyof typeof SERIES_HEX

export const SERIES_LABELS: Record<SeriesKey, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  gpt: 'GPT / Codex',
  other: 'Other',
}

const SERIES_CSS_VAR: Record<SeriesKey, string> = {
  opus: 'var(--s-opus)',
  sonnet: 'var(--s-sonnet)',
  haiku: 'var(--s-haiku)',
  gpt: 'var(--s-gpt)',
  other: 'var(--s-other)',
}

const SERIES_CLASS: Record<SeriesKey, string> = {
  opus: 's-opus',
  sonnet: 's-son',
  haiku: 's-hai',
  gpt: 's-gpt',
  other: 's-other',
}

export function seriesKeyForModel(model?: string): SeriesKey {
  const m = (model ?? '').toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('gpt') || m.includes('codex')) return 'gpt'
  return 'other'
}

export function seriesColorForModel(model?: string): string {
  return SERIES_CSS_VAR[seriesKeyForModel(model)]
}

export function seriesClassForModel(model?: string): string {
  return SERIES_CLASS[seriesKeyForModel(model)]
}

export function seriesClassForKey(series: SeriesKey): string {
  return SERIES_CLASS[series]
}

export function seriesHexForModel(model?: string): string {
  return SERIES_HEX[seriesKeyForModel(model)]
}

export function isOtherNode(idOrLabel?: string): boolean {
  const value = (idOrLabel ?? '').trim().toLowerCase()
  return value === '__other__' || value === 'other' || value === 'others'
}
