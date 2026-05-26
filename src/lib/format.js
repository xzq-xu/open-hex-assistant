export function formatPercent(value, digits = 1) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return '-'
  return `${(numberValue * 100).toFixed(digits)}%`
}

export function formatCount(value) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return '-'
  if (numberValue >= 10000) return `${(numberValue / 10000).toFixed(1)}万`
  return Math.round(numberValue).toLocaleString('zh-CN')
}

export function normalizeSearchText(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '')
}

