const DDRAGON_VERSION_URL = 'https://ddragon.leagueoflegends.com/api/versions.json'
const DDRAGON_CDN = 'https://ddragon.leagueoflegends.com/cdn'
const MAYHEM_CHAMPION_URL = 'https://data.v2.iesdev.com/api/v1/query_objects/prod/lol/aram_mayhem_champion'
const MAYHEM_AUGMENTS_URL = 'https://data.v2.iesdev.com/api/v1/query_objects/prod/lol/aram_mayhem_augments'
const AUGMENT_META_URL = 'https://hextech.dtodo.cn/data/aram-mayhem-augments.zh_cn.json'

async function getJson(url, signal) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}${errorDetail(text)}`)
  }

  try {
    return text ? JSON.parse(text) : null
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error.message}`)
  }
}

function errorDetail(text) {
  if (!text) return ''

  try {
    const body = JSON.parse(text)
    const message = body?.message || body?.error || body?.msg
    return message ? ` - ${message}` : ''
  } catch {
    return ` - ${text.replace(/\s+/g, ' ').slice(0, 180)}`
  }
}

export async function loadStaticData(signal) {
  const versions = await getJson(DDRAGON_VERSION_URL, signal)
  const version = versions[0]
  const [champions, items, augments] = await Promise.all([
    getJson(`${DDRAGON_CDN}/${version}/data/zh_CN/champion.json`, signal),
    getJson(`${DDRAGON_CDN}/${version}/data/zh_CN/item.json`, signal),
    getJson(AUGMENT_META_URL, signal),
  ])

  const championList = Object.values(champions.data)
    .map((champion) => ({
      id: Number(champion.key),
      alias: champion.id,
      name: champion.name,
      title: champion.title,
      image: `${DDRAGON_CDN}/${version}/img/champion/${champion.image.full}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  return {
    version,
    championList,
    championsById: Object.fromEntries(championList.map((champion) => [champion.id, champion])),
    items: items.data,
    augments,
  }
}

export async function loadMayhemChampion(championId, signal) {
  const url = new URL(MAYHEM_CHAMPION_URL)
  url.searchParams.set('champion_id', String(championId))
  const body = await getJson(url.toString(), signal)
  const row = body?.data?.[0]
  if (!row?.data) throw new Error(`没有找到英雄 ${championId} 的海克斯大乱斗统计`)
  return row
}

export async function loadGlobalMayhemAugments(signal) {
  return getJson(MAYHEM_AUGMENTS_URL, signal)
}

export function itemIconUrl(version, itemId, item) {
  const imageName = item?.image?.full || `${itemId}.png`
  return `${DDRAGON_CDN}/${version}/img/item/${imageName}`
}

export function augmentIconUrl(augment) {
  const raw = augment?.iconSmall || augment?.iconLarge
  if (!raw) return ''
  return `https://cdn.dtodo.cn/hextech/augment-icons/${raw.toLowerCase()}`
}
