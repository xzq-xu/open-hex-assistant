import { normalizeSearchText } from './format.js'

export function resolveCandidateAugments(input, augmentMeta = {}) {
  const rawText = String(input ?? '').trim()
  if (!rawText) return []

  const byId = new Map()
  const byName = []

  Object.entries(augmentMeta).forEach(([id, augment]) => {
    const numericId = Number(id)
    if (!Number.isFinite(numericId) || numericId <= 0) return

    const names = [
      augment?.displayName,
      augment?.name,
    ].filter(Boolean)

    byId.set(String(numericId), {
      id: numericId,
      name: augment?.displayName || augment?.name || String(numericId),
      confidence: 1,
      source: 'id',
    })

    names.forEach((name) => {
      byName.push({
        id: numericId,
        name,
        normalized: normalizeAugmentToken(name),
      })
    })
  })

  const candidates = []
  const seen = new Set()

  for (const token of tokenizeRecognitionText(rawText)) {
    const direct = byId.get(token)
    if (direct && !seen.has(direct.id)) {
      candidates.push(direct)
      seen.add(direct.id)
      continue
    }

    const match = findBestNameMatch(token, byName)
    if (match && !seen.has(match.id)) {
      candidates.push(match)
      seen.add(match.id)
    }

    if (candidates.length >= 3) break
  }

  return candidates
}

export function candidateIds(candidates) {
  return candidates.map((candidate) => candidate.id)
}

export function recognitionStatus(input, candidates) {
  if (!String(input ?? '').trim()) return '等待 OCR 文本或候选 ID'
  if (candidates.length === 0) return '未匹配到海克斯'
  if (candidates.length < 3) return `已识别 ${candidates.length} 个候选`
  return '三选一已识别'
}

function tokenizeRecognitionText(text) {
  const normalized = text
    .replace(/[|｜]/g, '\n')
    .replace(/[，,;；/]/g, '\n')
    .replace(/\s{2,}/g, '\n')

  const tokens = normalized
    .split(/\n+/)
    .map((token) => token.trim())
    .filter(Boolean)

  const numericTokens = normalized.match(/\b\d{3,5}\b/g) ?? []
  return [...numericTokens, ...tokens].map(normalizeAugmentToken).filter(Boolean)
}

function normalizeAugmentToken(value) {
  return normalizeSearchText(value)
    .replace(/[:：!！?？·•.\-_\[\]【】()（）]/g, '')
    .replace(/增强|强化|海克斯|符文|选择|推荐/g, '')
}

function findBestNameMatch(token, names) {
  if (!token) return null

  let best = null
  for (const entry of names) {
    const score = matchScore(token, entry.normalized)
    if (score <= 0) continue
    if (!best || score > best.confidence) {
      best = {
        id: entry.id,
        name: entry.name,
        confidence: score,
        source: 'text',
      }
    }
  }

  return best && best.confidence >= 0.64 ? best : null
}

function matchScore(token, name) {
  if (!token || !name) return 0
  if (token === name) return 1
  if (name.includes(token) || token.includes(name)) {
    return Math.min(token.length, name.length) / Math.max(token.length, name.length)
  }

  const distance = levenshtein(token, name)
  return 1 - distance / Math.max(token.length, name.length)
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current = new Array(b.length + 1)

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      )
    }
    previous.splice(0, previous.length, ...current)
  }

  return previous[b.length]
}
