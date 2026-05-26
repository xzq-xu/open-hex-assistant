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
    this.summoner = null
    this.connected = false
    this.lastError = ''
    this.initialized = false
    this.unsubscribers = []
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
      const allowed = this.options.allowedPhases.includes(phase)
      const championId = allowed ? resolveChampionId(this.session, this.summoner) : 0

      return {
        enabled: true,
        connected: true,
        allowed,
        phase,
        championId,
        queueId: this.session?.gameData?.queue?.id || 0,
        gameMode: this.session?.gameData?.queue?.gameMode || this.session?.map?.gameMode || '',
        gameClient: this.session?.gameClient || null,
        lockfilePath: this.client.credentials?.lockfilePath || '',
        reason: allowed ? 'gameflow-allowed' : 'phase-not-allowed',
      }
    } catch (error) {
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

    const [phase, session, summoner] = await Promise.all([
      this.client.getGameflowPhase().catch(() => ''),
      this.client.getGameflowSession().catch(() => null),
      this.client.getCurrentSummoner().catch(() => null),
    ])

    this.phase = typeof phase === 'string' ? phase : ''
    this.session = session
    this.summoner = summoner
    this.connected = true
    this.lastError = ''
  }

  disconnect() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.unsubscribers = []
    this.client.disconnect()
    this.initialized = false
  }
}

function resolveChampionId(session, summoner) {
  const puuid = summoner?.puuid
  if (!session || !puuid) return 0

  const selection = session.gameData?.playerChampionSelections?.find((item) => item.puuid === puuid)
  if (selection?.championId) return Number(selection.championId)

  const players = [
    ...(session.gameData?.teamOne || []),
    ...(session.gameData?.teamTwo || []),
  ]
  const player = players.find((item) => item.puuid === puuid || item.obfuscatedPuuid === puuid)
  return Number(player?.championId || 0)
}

module.exports = {
  DEFAULT_ALLOWED_PHASES,
  LcuGameState,
  resolveChampionId,
}
