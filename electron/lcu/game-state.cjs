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
      const allowed = this.options.allowedPhases.includes(phase) || liveGameRunning
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
        reason: liveGameRunning ? 'live-client-data' : allowed ? 'gameflow-allowed' : 'phase-not-allowed',
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

  async liveFallbackSnapshot() {
    const liveActivePlayer = await this.client.getLiveActivePlayer().catch(() => null)
    if (!liveActivePlayer) return null

    const championId = resolveLiveChampionId(liveActivePlayer, this.championAliasToId)
    return {
      enabled: true,
      connected: true,
      allowed: true,
      phase: 'InProgress',
      championId,
      championSource: championId ? 'live-client-data' : '',
      queueId: 0,
      gameMode: '',
      gameClient: null,
      lockfilePath: '',
      reason: 'live-client-data',
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
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

module.exports = {
  DEFAULT_ALLOWED_PHASES,
  LcuGameState,
  resolveChampSelectChampionId,
  resolveChampionId,
  resolveLiveChampionId,
}
