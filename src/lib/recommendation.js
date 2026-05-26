const EXCLUDED_ITEM_IDS = new Set([
  2003, 2010, 2031, 2033, 2052, 2138, 2139, 2140, 3340, 3363, 3364,
])

function numberValue(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isRecommendableItem(id, item) {
  const itemId = Number(id)
  if (!Number.isFinite(itemId) || itemId <= 0 || EXCLUDED_ITEM_IDS.has(itemId)) return false
  const tags = item?.tags ?? []
  if (tags.includes('Consumable') || tags.includes('Trinket')) return false
  if (item?.requiredChampion) return false
  return true
}

export function scoreStat(entry, baselineWinRate) {
  const winRate = numberValue(entry.win_rate)
  const pickRate = numberValue(entry.pick_rate)
  const games = numberValue(entry.num_games)
  const tier = numberValue(entry.tier, 5)
  const averageIndex = numberValue(entry.average_index, 0)
  const sampleScore = Math.min(1, Math.log10(Math.max(games, 1)) / 5)
  const winScore = (winRate - baselineWinRate) * 130
  const pickScore = Math.sqrt(Math.max(pickRate, 0)) * 8
  const tierScore = Math.max(0, 6 - tier) * 1.1
  const indexPenalty = averageIndex > 0 ? Math.max(0, averageIndex - 1) * 0.45 : 0
  const lowSamplePenalty = games < 500 ? 8 : games < 1500 ? 3 : 0
  return winScore + pickScore + tierScore + sampleScore * 4 - indexPenalty - lowSamplePenalty
}

export function buildRecommendations(row, staticData, candidateAugmentIds = []) {
  const data = row.data
  const baselineWinRate = numberValue(data.win_rate, 0.5)
  const itemEntries = Object.entries(data.items ?? {})
    .filter(([id]) => isRecommendableItem(id, staticData.items[id]))
    .map(([id, stat]) => toItemRecommendation(id, stat, staticData, baselineWinRate))
    .sort((a, b) => b.score - a.score)

  const coreItems = itemEntries
    .filter((item) => item.games >= 1500 && item.pickRate >= 0.03)
    .slice(0, 8)

  const spikeItems = itemEntries
    .filter((item) => item.games >= 1000 && item.winRate >= baselineWinRate + 0.035)
    .sort((a, b) => b.winRate - a.winRate || b.score - a.score)
    .slice(0, 8)

  const augmentEntries = Object.entries(data.augments ?? {})
    .map(([id, stat]) => toAugmentRecommendation(id, stat, staticData, baselineWinRate))
    .filter((augment) => augment.id > 0)
    .sort((a, b) => b.score - a.score)

  const candidateSet = new Set(candidateAugmentIds.map((id) => Number(id)).filter(Number.isFinite))
  const candidateAugments = candidateSet.size
    ? augmentEntries.filter((augment) => candidateSet.has(augment.id)).sort((a, b) => b.score - a.score)
    : augmentEntries.slice(0, 9)

  return {
    patch: row.patch,
    date: row.dt,
    baselineWinRate,
    championTier: data.tier,
    games: numberValue(data.num_games),
    pickRate: numberValue(data.pick_rate),
    coreItems,
    spikeItems,
    augments: augmentEntries.slice(0, 15),
    candidateAugments,
  }
}

function toItemRecommendation(id, stat, staticData, baselineWinRate) {
  const item = staticData.items[id]
  return {
    id: Number(id),
    name: item?.name || `物品 ${id}`,
    description: item?.plaintext || '',
    icon: item?.image?.full || `${id}.png`,
    score: scoreStat(stat, baselineWinRate),
    tier: numberValue(stat.tier, 5),
    games: numberValue(stat.num_games),
    wins: numberValue(stat.num_win_games),
    winRate: numberValue(stat.win_rate),
    pickRate: numberValue(stat.pick_rate),
    averageIndex: numberValue(stat.average_index, 0),
  }
}

function toAugmentRecommendation(id, stat, staticData, baselineWinRate) {
  const augment = staticData.augments[String(id)]
  const winRate = numberValue(stat.win_rate)
  const games = numberValue(stat.num_games)
  const tier = numberValue(stat.tier, 5)
  const deltaWinRate = winRate - baselineWinRate
  const grade = gradeAugment({ winRate, games, tier, deltaWinRate })
  return {
    id: Number(id),
    name: augment?.displayName || augment?.name || `海克斯 ${id}`,
    description: stripTags(augment?.description || augment?.tooltip || ''),
    icon: augment?.iconSmall || '',
    rarity: normalizeRarity(augment?.rarity),
    score: scoreStat(stat, baselineWinRate),
    tier,
    games,
    wins: numberValue(stat.num_win_games),
    winRate,
    deltaWinRate,
    pickRate: numberValue(stat.pick_rate),
    grade,
    reason: reasonForAugment({ grade, winRate, games, tier, deltaWinRate }),
  }
}

function gradeAugment({ games, tier, deltaWinRate }) {
  const stable = games >= 1200
  const enough = games >= 500

  if (stable && tier <= 1 && deltaWinRate >= 0.06) return 'S+'
  if (enough && tier <= 2 && deltaWinRate >= 0.04) return 'S'
  if (enough && deltaWinRate >= 0.022) return 'A'
  if (deltaWinRate >= 0.005 || tier <= 3) return 'B'
  if (deltaWinRate >= -0.015) return 'C'
  return 'D'
}

function reasonForAugment({ grade, games, tier, deltaWinRate }) {
  const diff = formatSignedPercent(deltaWinRate)

  if (games < 300) return `样本仅 ${formatCompactNumber(games)} 场，分级先保守看待。`
  if (grade === 'S+' || grade === 'S') return `胜率比英雄均值高 ${diff}，样本和 Tier 都支撑优先选择。`
  if (grade === 'A') return `胜率高于均值 ${diff}，属于当前英雄的稳健强选。`
  if (grade === 'B') return `表现接近或略高均值，适合配合已有装备和阵容。`
  if (grade === 'C') return `胜率与均值差距不大，更多看局内流派需求。`
  return `胜率低于均值 ${diff}，除非有明确流派联动才考虑。`
}

function formatSignedPercent(value) {
  const percent = Math.abs(numberValue(value)) * 100
  return `${value >= 0 ? '+' : '-'}${percent.toFixed(1)}%`
}

function formatCompactNumber(value) {
  const number = numberValue(value)
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`
  return String(Math.round(number))
}

function normalizeRarity(value) {
  if (typeof value === 'string') {
    const rarity = value.toLowerCase()
    if (rarity === 'prismatic' || rarity === 'gold' || rarity === 'silver') return rarity
  }

  const numericValue = Number(value)
  if (numericValue === 2 || numericValue === 8) return 'prismatic'
  if (numericValue === 1 || numericValue === 4) return 'gold'
  if (numericValue === 0) return 'silver'
  return 'unknown'
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}
