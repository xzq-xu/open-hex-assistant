const { LcuClient } = require('./client.cjs')

const GAMEFLOW_PHASE = '/lol-gameflow/v1/gameflow-phase'
const GAMEFLOW_SESSION = '/lol-gameflow/v1/session'
const DEFAULT_ALLOWED_PHASES = ['InProgress', 'Reconnect']

class LcuGameState {
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      requireGameflow: options.requireGameflow !== false,
      lockfilePath: options.lockfilePath || '',
      installDir: options.installDir || '',
      pollMs: Number(options.pollMs || 1000),
      allowedPhases: Array.isArray(options.allowedPhases) && options.allowedPhases.length
        ? options.allowedPhases
        : DEFAULT_ALLOWED_PHASES,
      requireSupportedMode: options.requireSupportedMode !== false,
      allowedQueueIds: Array.isArray(options.allowedQueueIds) ? options.allowedQueueIds : [],
      allowedModeKeywords: Array.isArray(options.allowedModeKeywords) && options.allowedModeKeywords.length
        ? options.allowedModeKeywords
        : ['mayhem', '海克斯', '狂欢'],
    }
    this.client = new LcuClient(this.options)
    this.phase = ''
    this.session = null
    this.champSelectSession = null
    this.liveActivePlayer = null
    this.summoner = null
    this.connected = false
    this.lastError = ''
    this.initialized = false
    this.unsubscribers = []
    this.championAliasToId = new Map()
    this.championsById = new Map()
    this.championSummaryLoaded = false
  }

  init() {
    if (this.initialized || !this.options.enabled) return
    this.initialized = true

    this.unsubscribers.push(this.client.observe(GAMEFLOW_PHASE, (event) => {
      if (typeof event.data === 'string') this.phase = event.data
    }))
    this.unsubscribers.push(this.client.observe(GAMEFLOW_SESSION, (event) => {
      if (event.data && typeof event.data === 'object') this.session = event.data
    }))
  }

  async snapshot() {
    if (!this.options.enabled) {
      return {
        enabled: false,
        connected: false,
        allowed: true,
        phase: '',
        reason: 'lcu-disabled',
      }
    }

    this.init()

    try {
      await this.refresh()
      const phase = this.session?.phase || this.phase || ''
      const liveChampionId = resolveLiveChampionId(this.liveActivePlayer, this.championAliasToId)
      const liveGameRunning = Boolean(this.liveActivePlayer)
      const phaseAllowed = this.options.allowedPhases.includes(phase) || liveGameRunning
      const mode = resolveSupportedMode(this.session, this.options)
      const modeAllowed = mode.supported || !this.options.requireSupportedMode
      const allowed = phaseAllowed && modeAllowed
      const championId = resolveChampionId(
        this.session,
        this.summoner,
        this.champSelectSession,
        this.liveActivePlayer,
        this.championAliasToId,
      )

      return {
        enabled: true,
        connected: true,
        allowed,
        phaseAllowed,
        modeSupported: mode.supported,
        mode,
        phase: liveGameRunning && !this.options.allowedPhases.includes(phase) ? 'InProgress' : phase,
        championId,
        championSource: championId && championId === liveChampionId ? 'live-client-data' : championSource({
          session: this.session,
          summoner: this.summoner,
          champSelectSession: this.champSelectSession,
          liveActivePlayer: this.liveActivePlayer,
          championAliasToId: this.championAliasToId,
        }),
        queueId: this.session?.gameData?.queue?.id || 0,
        gameMode: this.session?.gameData?.queue?.gameMode || this.session?.map?.gameMode || '',
        gameClient: this.session?.gameClient || null,
        lockfilePath: this.client.credentials?.lockfilePath || '',
        reason: !modeAllowed ? 'unsupported-mode' : liveGameRunning ? 'live-client-data' : allowed ? 'gameflow-allowed' : 'phase-not-allowed',
      }
    } catch (error) {
      const liveSnapshot = await this.liveFallbackSnapshot().catch(() => null)
      if (liveSnapshot) return liveSnapshot

      this.connected = false
      this.lastError = error.message || String(error)
      return {
        enabled: true,
        connected: false,
        allowed: !this.options.requireGameflow,
        phase: '',
        championId: 0,
        queueId: 0,
        gameMode: '',
        gameClient: null,
        reason: this.options.requireGameflow ? 'lcu-disconnected' : 'lcu-optional-disconnected',
        error: this.lastError,
      }
    }
  }

  async refresh() {
    await this.client.connect()
    await this.ensureChampionSummary()

    const [phase, session, champSelectSession, summoner] = await Promise.all([
      this.client.getGameflowPhase().catch(() => ''),
      this.client.getGameflowSession().catch(() => null),
      this.client.getChampSelectSession().catch(() => null),
      this.client.getCurrentSummoner().catch(() => null),
    ])

    this.phase = typeof phase === 'string' ? phase : ''
    this.session = session
    this.champSelectSession = champSelectSession
    this.summoner = summoner
    this.liveActivePlayer = await this.readLiveActivePlayer()
    this.connected = true
    this.lastError = ''
  }

  async ensureChampionSummary() {
    if (this.championSummaryLoaded) return

    const summary = await this.client.getChampionSummary().catch(() => null)
    if (!Array.isArray(summary)) return

    for (const champion of summary) {
      const id = Number(champion?.id || 0)
      const aliases = [
        champion?.alias,
        champion?.name,
      ].map(normalizeChampionAlias).filter(Boolean)

      if (id > 0) {
        this.championsById.set(id, {
          id,
          alias: String(champion?.alias || ''),
          name: String(champion?.name || champion?.alias || `Champion ${id}`),
        })
      }

      for (const alias of aliases) {
        if (id > 0) this.championAliasToId.set(alias, id)
      }
    }

    this.championSummaryLoaded = true
  }

  async readLiveActivePlayer() {
    const phase = this.session?.phase || this.phase || ''
    if (!['InProgress', 'GameStart', 'Reconnect'].includes(phase)) return null
    return this.client.getLiveActivePlayer().catch(() => null)
  }

  async readLiveAllGameData() {
    const phase = this.session?.phase || this.phase || ''
    if (!['InProgress', 'GameStart', 'Reconnect'].includes(phase)) return null
    return this.client.getLiveAllGameData().catch(() => null)
  }

  async coachSnapshot(options = {}) {
    if (!this.options.enabled) {
      return {
        enabled: false,
        source: '',
        trigger: options.trigger || 'auto',
        phase: '',
        myChampionId: 0,
        myTeam: [],
        enemyTeam: [],
        reason: 'lcu-disabled',
      }
    }

    this.init()

    try {
      await this.refresh()
      const liveAllGameData = await this.readLiveAllGameData()
      const phase = this.session?.phase || this.phase || ''
      const mode = resolveSupportedMode(this.session, this.options)
      if (!mode.supported && this.options.requireSupportedMode) {
        return {
          enabled: true,
          connected: true,
          source: '',
          trigger: options.trigger || 'auto',
          phase,
          queueId: mode.queueId,
          gameMode: mode.gameMode,
          myChampionId: 0,
          myPlayer: null,
          myTeam: [],
          enemyTeam: [],
          mode,
          reason: 'unsupported-mode',
          observedAt: new Date().toISOString(),
        }
      }

      const fromLive = buildLiveRoster({
        allGameData: liveAllGameData,
        activePlayer: this.liveActivePlayer,
        championAliasToId: this.championAliasToId,
        championsById: this.championsById,
      })
      const roster = fromLive.myTeam.length || fromLive.enemyTeam.length
        ? fromLive
        : buildSessionRoster({
          session: this.session,
          summoner: this.summoner,
          championsById: this.championsById,
        })
      const myChampionId = resolveChampionId(
        this.session,
        this.summoner,
        this.champSelectSession,
        this.liveActivePlayer,
        this.championAliasToId,
      )

      return {
        enabled: true,
        connected: true,
        source: fromLive.source || roster.source || 'lcu-gameflow',
        trigger: options.trigger || 'auto',
        phase: liveAllGameData?.gameData ? 'InProgress' : phase,
        queueId: mode.queueId,
        gameMode: mode.gameMode,
        gameTime: Number(liveAllGameData?.gameData?.gameTime || 0),
        myChampionId: myChampionId || roster.myPlayer?.championId || 0,
        myPlayer: roster.myPlayer || null,
        myTeam: roster.myTeam,
        enemyTeam: roster.enemyTeam,
        mode,
        reason: roster.reason || (fromLive.source ? 'live-client-data' : 'lcu-gameflow'),
        observedAt: new Date().toISOString(),
      }
    } catch (error) {
      return {
        enabled: true,
        connected: false,
        source: '',
        trigger: options.trigger || 'auto',
        phase: '',
        myChampionId: 0,
        myTeam: [],
        enemyTeam: [],
        reason: 'coach-unavailable',
        error: error.message || String(error),
        observedAt: new Date().toISOString(),
      }
    }
  }

  async liveFallbackSnapshot() {
    const liveActivePlayer = await this.client.getLiveActivePlayer().catch(() => null)
    if (!liveActivePlayer) return null

    const championId = resolveLiveChampionId(liveActivePlayer, this.championAliasToId)
    const mode = resolveSupportedMode(null, this.options)
    const modeAllowed = mode.supported || !this.options.requireSupportedMode
    return {
      enabled: true,
      connected: true,
      allowed: modeAllowed,
      phaseAllowed: true,
      modeSupported: mode.supported,
      mode,
      phase: 'InProgress',
      championId,
      championSource: championId ? 'live-client-data' : '',
      queueId: 0,
      gameMode: '',
      gameClient: null,
      lockfilePath: '',
      reason: modeAllowed ? 'live-client-data' : 'unsupported-mode',
    }
  }

  disconnect() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    this.client.disconnect()
    this.initialized = false
  }
}

function resolveChampionId(session, summoner, champSelectSession, liveActivePlayer, championAliasToId = new Map()) {
  const champSelectChampionId = resolveChampSelectChampionId(champSelectSession)
  if (champSelectChampionId) return champSelectChampionId

  const puuid = summoner?.puuid
  if (!session || !puuid) return resolveLiveChampionId(liveActivePlayer, championAliasToId)

  const selection = session.gameData?.playerChampionSelections?.find((item) => item.puuid === puuid)
  if (selection?.championId) return Number(selection.championId)

  const players = [
    ...(session.gameData?.teamOne || []),
    ...(session.gameData?.teamTwo || []),
  ]
  const player = players.find((item) => item.puuid === puuid || item.obfuscatedPuuid === puuid)
  return Number(player?.championId || 0) || resolveLiveChampionId(liveActivePlayer, championAliasToId)
}

function resolveChampSelectChampionId(session) {
  const localCellId = session?.localPlayerCellId
  if (localCellId == null) return 0

  const player = session.myTeam?.find((item) => item.cellId === localCellId)
  return Number(player?.championId || 0)
}

function resolveLiveChampionId(activePlayer, championAliasToId = new Map()) {
  const aliases = [
    activePlayer?.championName,
    activePlayer?.rawChampionName,
  ].map(normalizeChampionAlias).filter(Boolean)

  for (const alias of aliases) {
    const championId = championAliasToId.get(alias)
    if (championId) return championId
  }

  return 0
}

function championSource(context) {
  if (resolveChampSelectChampionId(context.champSelectSession)) return 'champ-select'
  if (resolveChampionId(context.session, context.summoner, null, null, context.championAliasToId)) return 'gameflow'
  if (resolveLiveChampionId(context.liveActivePlayer, context.championAliasToId)) return 'live-client-data'
  return ''
}

function normalizeChampionAlias(value) {
  return String(value || '')
    .replace(/^game_character_displayname_/i, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
}

function resolveSupportedMode(session, options = {}) {
  const queue = session?.gameData?.queue || {}
  const queueId = Number(queue.id || 0)
  const gameMode = String(queue.gameMode || session?.map?.gameMode || '')
  const text = [
    queue.name,
    queue.shortName,
    queue.description,
    queue.detailedDescription,
    queue.gameMode,
    queue.gameTypeConfigId,
    session?.map?.gameMode,
    session?.map?.name,
  ].filter(Boolean).join(' ').toLowerCase()
  const allowedQueueIds = (options.allowedQueueIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
  const allowedModeKeywords = (options.allowedModeKeywords || [])
    .map((keyword) => String(keyword).trim().toLowerCase())
    .filter(Boolean)

  if (queueId && allowedQueueIds.includes(queueId)) {
    return {
      supported: true,
      matchedBy: 'queue-id',
      queueId,
      gameMode,
      queueName: String(queue.name || ''),
    }
  }

  const matchedKeyword = allowedModeKeywords.find((keyword) => text.includes(keyword))
  if (matchedKeyword) {
    return {
      supported: true,
      matchedBy: 'keyword',
      matchedKeyword,
      queueId,
      gameMode,
      queueName: String(queue.name || ''),
    }
  }

  return {
    supported: false,
    matchedBy: '',
    queueId,
    gameMode,
    queueName: String(queue.name || ''),
    checkedText: text.slice(0, 240),
  }
}

function buildSessionRoster({ session, summoner, championsById }) {
  const teamOne = Array.isArray(session?.gameData?.teamOne) ? session.gameData.teamOne : []
  const teamTwo = Array.isArray(session?.gameData?.teamTwo) ? session.gameData.teamTwo : []
  const puuid = summoner?.puuid || ''
  const teamOneHasSelf = puuid && teamOne.some((player) => samePuuid(player, puuid))
  const teamTwoHasSelf = puuid && teamTwo.some((player) => samePuuid(player, puuid))
  const mySource = teamTwoHasSelf ? teamTwo : teamOne
  const enemySource = teamTwoHasSelf ? teamOne : teamTwo
  const myTeam = mySource.map((player, index) => normalizeSessionPlayer(player, {
    index,
    isSelf: samePuuid(player, puuid),
    team: teamTwoHasSelf ? 'CHAOS' : 'ORDER',
    championsById,
  })).filter((player) => player.championId > 0)
  const enemyTeam = enemySource.map((player, index) => normalizeSessionPlayer(player, {
    index,
    isSelf: false,
    team: teamTwoHasSelf ? 'ORDER' : 'CHAOS',
    championsById,
  })).filter((player) => player.championId > 0)

  return {
    source: 'lcu-gameflow',
    reason: teamOneHasSelf || teamTwoHasSelf ? 'loading-roster' : 'loading-roster-self-unknown',
    myPlayer: myTeam.find((player) => player.isSelf) || null,
    myTeam,
    enemyTeam,
  }
}

function normalizeSessionPlayer(player, context) {
  const championId = Number(player?.championId || 0)
  const champion = context.championsById.get(championId)

  return {
    slot: context.index + 1,
    team: context.team,
    isSelf: Boolean(context.isSelf),
    championId,
    championName: champion?.name || `Champion ${championId}`,
    championAlias: champion?.alias || '',
    summonerName: displayName(player),
    itemIds: [],
    level: 0,
    score: null,
  }
}

function buildLiveRoster({ allGameData, activePlayer, championAliasToId, championsById }) {
  const players = Array.isArray(allGameData?.allPlayers) ? allGameData.allPlayers : []
  if (!players.length) {
    return {
      source: '',
      reason: 'live-data-empty',
      myPlayer: null,
      myTeam: [],
      enemyTeam: [],
    }
  }

  const activeName = normalizePlayerName(activePlayer?.summonerName || allGameData?.activePlayer?.summonerName)
  const self = players.find((player) => normalizePlayerName(player?.summonerName) === activeName)
  const selfTeam = self?.team || players[0]?.team || 'ORDER'
  const normalizedPlayers = players.map((player, index) => normalizeLivePlayer(player, {
    index,
    isSelf: player === self,
    championAliasToId,
    championsById,
  }))

  return {
    source: 'live-client-data',
    reason: 'live-client-data',
    myPlayer: normalizedPlayers.find((player) => player.isSelf) || null,
    myTeam: normalizedPlayers.filter((player) => player.team === selfTeam),
    enemyTeam: normalizedPlayers.filter((player) => player.team !== selfTeam),
  }
}

function normalizeLivePlayer(player, context) {
  const championId = resolveChampionNameToId(player?.championName, context.championAliasToId)
  const champion = context.championsById.get(championId)

  return {
    slot: context.index + 1,
    team: String(player?.team || ''),
    isSelf: Boolean(context.isSelf),
    championId,
    championName: champion?.name || player?.championName || `Champion ${championId}`,
    championAlias: champion?.alias || '',
    summonerName: String(player?.summonerName || ''),
    itemIds: normalizeItemIds(player?.items),
    level: Number(player?.level || 0),
    score: player?.scores || null,
  }
}

function resolveChampionNameToId(name, championAliasToId) {
  return championAliasToId.get(normalizeChampionAlias(name)) || 0
}

function normalizeItemIds(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => Number(item?.itemID || item?.itemId || item?.id || 0))
    .filter((itemId) => Number.isFinite(itemId) && itemId > 0)
}

function samePuuid(player, puuid) {
  if (!puuid) return false
  return player?.puuid === puuid || player?.obfuscatedPuuid === puuid
}

function displayName(player) {
  return [
    player?.summonerName,
    player?.gameName && player?.tagLine ? `${player.gameName}#${player.tagLine}` : '',
    player?.gameName,
  ].find(Boolean) || ''
}

function normalizePlayerName(value) {
  return String(value || '').trim().toLowerCase()
}

module.exports = {
  DEFAULT_ALLOWED_PHASES,
  LcuGameState,
  resolveSupportedMode,
  resolveChampSelectChampionId,
  resolveChampionId,
  resolveLiveChampionId,
}
