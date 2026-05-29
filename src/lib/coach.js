const TAG_BUCKET = {
  Tank: 'frontline',
  Fighter: 'frontline',
  Mage: 'poke',
  Marksman: 'carry',
  Assassin: 'dive',
  Support: 'utility',
}

const EMPTY_PROFILE = {
  frontline: 0,
  poke: 0,
  carry: 0,
  dive: 0,
  utility: 0,
}

const COUNTER_ITEMS = {
  antiHeal: [3165, 3033, 3075, 3916, 3076],
  armorPen: [3036, 3033, 6694],
  magicPen: [3135, 4633, 6653],
  antiBurst: [3157, 3026, 3156, 3102, 3143, 3110],
  antiShield: [6695],
  sustain: [3065, 3102, 3111, 4628, 6617],
}

export function buildCoachInsights(coach, staticData, recommendation) {
  if (!coach?.enabled || !hasRoster(coach)) return null
  if (!staticData?.championsById) return null

  const myTeam = decorateTeam(coach.myTeam, staticData)
  const enemyTeam = decorateTeam(coach.enemyTeam, staticData)
  const allyProfile = profileTeam(myTeam)
  const enemyProfile = profileTeam(enemyTeam)
  const enemySignals = detectEnemySignals(enemyTeam)
  const allyStyle = describeTeamStyle(allyProfile)
  const enemyStyle = describeTeamStyle(enemyProfile)
  const myPlayer = decoratePlayer(coach.myPlayer, staticData)
    || myTeam.find((player) => player.championId === coach.myChampionId)
    || myTeam.find((player) => player.isSelf)
    || null

  return {
    sourceLabel: sourceLabel(coach),
    phaseLabel: phaseLabel(coach.phase),
    confidenceLabel: coach.source === 'live-client-data' ? '实时重评估' : '加载阵容',
    headline: `${allyStyle.name} 对 ${enemyStyle.name}`,
    matchup: matchupLine(allyStyle, enemyStyle),
    myChampionName: myPlayer?.championName || '',
    myTeam,
    enemyTeam,
    threats: buildThreats(enemyTeam),
    scoreboard: buildScoreboardSummary({ myPlayer, myTeam, enemyTeam, coach }),
    playbook: buildPlaybook({ allyProfile, enemyProfile, allyStyle, enemyStyle }),
    itemPlan: buildItemPlan({ myPlayer, enemyProfile, allyProfile, enemySignals, recommendation, staticData }),
    augmentPlan: buildAugmentPlan(recommendation),
  }
}

function hasRoster(coach) {
  return Boolean(coach.myTeam?.length || coach.enemyTeam?.length)
}

function decorateTeam(players = [], staticData) {
  return players
    .map((player) => decoratePlayer(player, staticData))
    .filter(Boolean)
}

function decoratePlayer(player, staticData) {
  if (!player) return null
  const champion = resolveChampion(player, staticData)
  const championId = champion?.id || Number(player.championId || 0)
  if (!championId && !player.championName) return null

  return {
    ...player,
    championId,
    championName: champion?.name || player.championName || `英雄 ${championId}`,
    championAlias: champion?.alias || player.championAlias || '',
    tags: champion?.tags || [],
    image: champion?.image || '',
    itemNames: resolveItemNames(player.itemIds, staticData),
  }
}

function resolveChampion(player, staticData) {
  const championId = Number(player?.championId || 0)
  if (championId && staticData?.championsById?.[championId]) {
    return staticData.championsById[championId]
  }

  const needle = normalizeChampionKey(player?.championAlias || player?.championName)
  if (!needle) return null

  return (staticData?.championList || []).find((champion) => (
    normalizeChampionKey(champion.alias) === needle || normalizeChampionKey(champion.name) === needle
  )) || null
}

function normalizeChampionKey(value) {
  return String(value || '')
    .replace(/^game_character_displayname_/i, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
}

function profileTeam(players) {
  const profile = { ...EMPTY_PROFILE }

  for (const player of players) {
    const tags = Array.isArray(player.tags) ? player.tags : []
    const buckets = new Set(tags.map((tag) => TAG_BUCKET[tag]).filter(Boolean))
    for (const bucket of buckets) profile[bucket] += 1
  }

  return profile
}

function detectEnemySignals(enemyTeam) {
  const joinedItems = enemyTeam.flatMap((player) => player.itemNames || []).join(' ')

  return {
    healing: /饮血|破败|贪欲|海克斯科技枪|峡谷|吸血|回复|治疗/.test(joinedItems),
    shields: /护盾|血手|饮魔刀|女妖/.test(joinedItems),
    fedCarry: enemyTeam.some((player) => Number(player.score?.kills || 0) >= 6),
  }
}

function buildThreats(enemyTeam) {
  return enemyTeam
    .map((player) => {
      const tags = new Set(player.tags || [])
      const kills = Number(player.score?.kills || 0)
      const assists = Number(player.score?.assists || 0)
      const deaths = Number(player.score?.deaths || 0)
      const itemCount = (player.itemIds || []).length
      const level = Number(player.level || 0)
      const score = itemCount * 1.4 + kills * 0.9 + assists * 0.25 + Math.max(0, level - 8) * 0.2 - deaths * 0.25
        + (tags.has('Marksman') ? 2 : 0)
        + (tags.has('Mage') ? 1.5 : 0)
        + (tags.has('Assassin') ? 1.5 : 0)
        + (tags.has('Tank') ? 0.8 : 0)

      return {
        ...player,
        threatScore: score,
        threatType: threatType(tags),
        threatReason: threatReason({ tags, kills, itemCount, level }),
      }
    })
    .sort((a, b) => b.threatScore - a.threatScore)
    .slice(0, 3)
}

function threatType(tags) {
  if (tags.has('Marksman')) return '持续输出'
  if (tags.has('Mage')) return '远程爆发'
  if (tags.has('Assassin')) return '突进收割'
  if (tags.has('Tank') || tags.has('Fighter')) return '前排开团'
  return '战术变量'
}

function threatReason({ tags, kills, itemCount, level }) {
  if (kills >= 6) return `击杀数高，优先限制进场和输出窗口。`
  if (itemCount >= 4) return `装备已成型，团前需要提前规划处理方式。`
  if (level >= 14) return `等级偏高，关键技能基础伤害和冷却压力上升。`
  if (tags.has('Marksman')) return '后期持续输出核心，团战别让他无压力站桩。'
  if (tags.has('Mage')) return '消耗和爆发威胁高，开团前注意血线。'
  if (tags.has('Assassin')) return '盯后排能力强，关键控制别提前交空。'
  if (tags.has('Tank') || tags.has('Fighter')) return '会决定正面团的开战位置。'
  return '根据站位和装备临场处理。'
}

function buildScoreboardSummary({ myPlayer, myTeam, enemyTeam, coach }) {
  const myItems = myPlayer?.itemNames?.slice(0, 4) || []

  return {
    gameTime: Number(coach?.gameTime || 0),
    myLevel: Number(myPlayer?.level || 0),
    myItems,
    allyKnownItems: countKnownItems(myTeam),
    enemyKnownItems: countKnownItems(enemyTeam),
  }
}

function describeTeamStyle(profile) {
  if (profile.frontline >= 2 && profile.carry >= 1) {
    return { id: 'front-to-back', name: '前排正面阵', action: '围绕前排开团，保核心连续输出。' }
  }
  if (profile.poke + profile.carry >= 3) {
    return { id: 'poke', name: '消耗拉扯阵', action: '先磨血线，等关键技能命中后再接团。' }
  }
  if (profile.dive >= 2) {
    return { id: 'dive', name: '突进收割阵', action: '盯后排交位移，等第一波控制后进场。' }
  }
  if (profile.frontline === 0) {
    return { id: 'fragile', name: '无前排阵', action: '避免硬接，优先买生存和移动空间。' }
  }
  return { id: 'balanced', name: '均衡团战阵', action: '按装备强势期接团，少在窄口被先手。' }
}

function matchupLine(allyStyle, enemyStyle) {
  if (enemyStyle.id === 'poke') return '敌方消耗能力强，开团前要少掉血，装备优先考虑续航或强开窗口。'
  if (enemyStyle.id === 'dive') return '敌方突进压力高，保命装、控制链和站位比贪输出更关键。'
  if (enemyStyle.id === 'front-to-back') return '敌方前排扎实，中期需要穿透、重伤或持续输出来处理肉盾。'
  return allyStyle.action
}

function buildPlaybook({ allyProfile, enemyProfile, allyStyle, enemyStyle }) {
  const lines = [
    {
      label: '团战节奏',
      text: allyStyle.action,
    },
    {
      label: '敌方压力',
      text: enemyStyle.action,
    },
  ]

  if (enemyProfile.frontline >= 2) {
    lines.push({
      label: '处理前排',
      text: '对面前排偏多，优先让装备和海克斯服务于持续伤害，不要只看爆发。'
    })
  }

  if (enemyProfile.dive >= 2) {
    lines.push({
      label: '防突进',
      text: '对面进场点多，留关键控制和位移，第二时间输出比先手暴露更稳。'
    })
  }

  if (allyProfile.frontline === 0) {
    lines.push({
      label: '阵容短板',
      text: '我方缺少稳定前排，出装需要给自己留容错，别把胜负押在一波站桩输出。'
    })
  }

  return lines.slice(0, 4)
}

function buildItemPlan({ myPlayer, enemyProfile, allyProfile, enemySignals, recommendation, staticData }) {
  const owned = new Set((myPlayer?.itemIds || []).map(Number))
  const nextCoreItems = (recommendation?.coreItems || [])
    .filter((item) => !owned.has(Number(item.id)))
    .slice(0, 3)
  const spikeItems = (recommendation?.spikeItems || [])
    .filter((item) => !owned.has(Number(item.id)))
    .slice(0, 2)
  const plan = []

  if (nextCoreItems.length) {
    plan.push({
      label: '下一件',
      text: `${nextCoreItems.map((item) => item.name).join(' / ')}。统计稳定，先保证当前英雄的基础成型速度。`,
    })
  }

  if (enemyProfile.frontline >= 2) {
    plan.push({
      label: '打肉调整',
      text: `敌方前排多，优先考虑 ${counterItemsFor(myPlayer, staticData, 'frontline')}，不要只堆爆发。`
    })
  }

  if (enemyProfile.dive >= 2 || allyProfile.frontline === 0) {
    plan.push({
      label: '容错调整',
      text: `突进或无前排压力高，考虑 ${itemNames(staticData, COUNTER_ITEMS.antiBurst, '自保/抗性/保命装')}，避免关键团先倒。`
    })
  }

  if (enemyProfile.poke >= 3) {
    plan.push({
      label: '抗消耗',
      text: `敌方远程消耗多，${itemNames(staticData, COUNTER_ITEMS.sustain, '续航/魔抗/移速')} 价值上升，别裸贪纯输出。`
    })
  }

  if (enemySignals.healing || enemySignals.fedCarry) {
    plan.push({
      label: '重伤窗口',
      text: `敌方有回复或高经济核心，队伍里至少安排一件 ${itemNames(staticData, COUNTER_ITEMS.antiHeal, '重伤装备')}。`
    })
  }

  if (enemySignals.shields || enemyProfile.utility >= 2) {
    plan.push({
      label: '破盾检查',
      text: `敌方护盾/保护偏多时，AD 位可以评估 ${itemNames(staticData, COUNTER_ITEMS.antiShield, '破盾装备')}。`
    })
  }

  if (spikeItems.length) {
    plan.push({
      label: '高胜率变招',
      text: `${spikeItems.map((item) => item.name).join(' / ')} 当前胜率突出，适合作为局势允许时的强化选择。`,
    })
  }

  return plan.slice(0, 4)
}

function buildAugmentPlan(recommendation) {
  return (recommendation?.candidateAugments || [])
    .slice(0, 3)
    .map((augment, index) => ({
      label: `#${index + 1} ${augment.name}`,
      text: `${augment.grade} 级，${augment.reason}`,
    }))
}

function sourceLabel(coach) {
  if (coach.source === 'live-client-data') return 'Live Client Data'
  if (coach.source === 'lcu-gameflow') return 'LCU 阵容'
  return 'LCU'
}

function phaseLabel(phase) {
  if (phase === 'GameStart') return '加载中'
  if (phase === 'InProgress') return '对局中'
  if (phase === 'Reconnect') return '重连中'
  if (phase === 'ChampSelect') return '选择中'
  return phase || '等待中'
}

function counterItemsFor(myPlayer, staticData, need) {
  const tags = new Set(myPlayer?.tags || [])
  if (need === 'frontline' && tags.has('Mage')) {
    return itemNames(staticData, COUNTER_ITEMS.magicPen, '法穿/持续伤害装备')
  }
  if (need === 'frontline' && (tags.has('Marksman') || tags.has('Fighter') || tags.has('Assassin'))) {
    return itemNames(staticData, COUNTER_ITEMS.armorPen, '护甲穿透/百分比伤害装备')
  }
  return '穿透、百分比伤害、重伤或持续伤害装备'
}

function itemNames(staticData, ids, fallback) {
  const names = ids
    .map((id) => staticData?.items?.[String(id)]?.name)
    .filter(Boolean)
    .slice(0, 3)
  return names.length ? names.join(' / ') : fallback
}

function resolveItemNames(itemIds = [], staticData) {
  return itemIds
    .map((id) => staticData?.items?.[String(id)]?.name)
    .filter(Boolean)
}

function countKnownItems(players) {
  return players.reduce((total, player) => total + (player.itemIds?.length || 0), 0)
}
