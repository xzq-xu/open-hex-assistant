const { execFile } = require('node:child_process')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const WebSocket = require('ws')

const EVENT_CHANNEL = 'OnJsonApiEvent'
const DEFAULT_LOCKFILE_CANDIDATES = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends\\lockfile',
]

class LcuClient {
  constructor(options = {}) {
    this.options = {
      lockfilePath: options.lockfilePath || process.env.LCU_LOCKFILE || '',
      installDir: options.installDir || process.env.LCU_INSTALL_DIR || '',
      reconnectMs: Number(options.reconnectMs || 1500),
    }
    this.credentials = null
    this.socket = null
    this.socketConnecting = null
    this.eventListeners = new Map()
    this.observedUris = new Set()
    this.subscribedToEventChannel = false
    this.lastConnectionError = null
  }

  async connect() {
    const credentials = await this.resolveCredentials()
    this.credentials = credentials
    return credentials
  }

  isConnected() {
    return Boolean(this.credentials)
  }

  async request(endpoint, options = {}) {
    const credentials = await this.connect()
    const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    const method = options.method || 'GET'
    const body = options.body == null || typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body)
    const headers = {
      Accept: 'application/json',
      Authorization: credentials.authorization,
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    }

    try {
      return await httpsJsonRequest({
        hostname: '127.0.0.1',
        port: credentials.port,
        path: url,
        method,
        headers,
        body,
      })
    } catch (error) {
      this.credentials = null
      this.closeSocket()
      throw error
    }
  }

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' })
  }

  post(endpoint, body) {
    return this.request(endpoint, { method: 'POST', body })
  }

  put(endpoint, body) {
    return this.request(endpoint, { method: 'PUT', body })
  }

  patch(endpoint, body) {
    return this.request(endpoint, { method: 'PATCH', body })
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' })
  }

  getGameflowPhase() {
    return this.get('/lol-gameflow/v1/gameflow-phase')
  }

  getGameflowSession() {
    return this.get('/lol-gameflow/v1/session')
  }

  getChampSelectSession() {
    return this.get('/lol-champ-select/v1/session')
  }

  getCurrentSummoner() {
    return this.get('/lol-summoner/v1/current-summoner')
  }

  getChampionSummary() {
    return this.get('/lol-game-data/assets/v1/champion-summary.json')
  }

  getLiveActivePlayer() {
    return httpsJsonRequest({
      hostname: '127.0.0.1',
      port: 2999,
      path: '/liveclientdata/activeplayer',
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      timeoutMs: 1200,
    })
  }

  getLiveAllGameData() {
    return httpsJsonRequest({
      hostname: '127.0.0.1',
      port: 2999,
      path: '/liveclientdata/allgamedata',
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      timeoutMs: 1200,
    })
  }

  observe(uri, callback) {
    let listeners = this.eventListeners.get(uri)
    if (!listeners) {
      listeners = new Set()
      this.eventListeners.set(uri, listeners)
    }
    listeners.add(callback)
    this.observedUris.add(uri)

    this.ensureSocket().catch((error) => {
      this.lastConnectionError = error
    })

    return () => {
      const current = this.eventListeners.get(uri)
      current?.delete(callback)
      if (current && current.size === 0) {
        this.eventListeners.delete(uri)
        this.observedUris.delete(uri)
      }
    }
  }

  async ensureSocket() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return this.socket
    if (this.socketConnecting) return this.socketConnecting

    this.socketConnecting = this.connectSocket()
      .finally(() => {
        this.socketConnecting = null
      })
    return this.socketConnecting
  }

  async connectSocket() {
    const credentials = await this.connect()
    const socketUrl = `wss://riot:${encodeURIComponent(credentials.password)}@127.0.0.1:${credentials.port}/`

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(socketUrl, {
        rejectUnauthorized: false,
        headers: {
          Authorization: credentials.authorization,
        },
      })

      const fail = (error) => {
        this.lastConnectionError = error
        reject(error)
      }

      socket.once('open', () => {
        this.socket = socket
        this.subscribedToEventChannel = false
        this.subscribeToEventChannel()
        resolve(socket)
      })

      socket.once('error', fail)
      socket.on('message', (data) => this.handleSocketMessage(data))
      socket.on('close', () => {
        if (this.socket === socket) this.socket = null
        this.subscribedToEventChannel = false
        if (this.eventListeners.size) {
          setTimeout(() => this.ensureSocket().catch(() => {}), this.options.reconnectMs)
        }
      })
    })
  }

  subscribeToEventChannel() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.subscribedToEventChannel) return
    this.socket.send(JSON.stringify([5, EVENT_CHANNEL]))
    this.subscribedToEventChannel = true
  }

  handleSocketMessage(data) {
    let message
    try {
      message = JSON.parse(data.toString('utf8'))
    } catch {
      return
    }

    if (!Array.isArray(message) || message[0] !== 8) return

    const payload = normalizeEventPayload(message)
    if (!payload?.uri) return

    const listeners = this.eventListeners.get(payload.uri)
    listeners?.forEach((callback) => callback(payload))
  }

  closeSocket() {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    this.subscribedToEventChannel = false
    try {
      socket.close()
    } catch {
      // ignore close errors
    }
  }

  disconnect() {
    this.closeSocket()
    this.eventListeners.clear()
    this.observedUris.clear()
    this.credentials = null
  }

  async resolveCredentials() {
    const lockfilePath = await findLockfile(this.options)
    if (!lockfilePath) {
      throw new Error('LCU lockfile not found')
    }

    const lockfile = parseLockfile(fs.readFileSync(lockfilePath, 'utf8'))
    return {
      ...lockfile,
      lockfilePath,
      baseUrl: `https://127.0.0.1:${lockfile.port}`,
      authorization: `Basic ${Buffer.from(`riot:${lockfile.password}`).toString('base64')}`,
    }
  }
}

async function findLockfile(options = {}) {
  const explicit = [
    options.lockfilePath,
    options.installDir ? path.join(options.installDir, 'lockfile') : '',
  ].filter(Boolean)

  for (const candidate of explicit) {
    if (fs.existsSync(candidate)) return candidate
  }

  const processCandidates = process.platform === 'win32'
    ? await findLockfilesFromLeagueProcesses().catch(() => [])
    : []

  for (const candidate of [...processCandidates, ...DEFAULT_LOCKFILE_CANDIDATES]) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }

  return ''
}

async function findLockfilesFromLeagueProcesses() {
  const script = [
    '$items = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("LeagueClientUx.exe","LeagueClient.exe") } | Select-Object -First 8 ExecutablePath,CommandLine',
    '$items | ConvertTo-Json -Compress',
  ].join('; ')
  const stdout = await execFileText('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ])
  const rows = normalizePowerShellJson(stdout)
  const candidates = []

  for (const row of rows) {
    const executablePath = String(row.ExecutablePath || '').trim()
    if (executablePath) {
      candidates.push(path.join(path.dirname(executablePath), 'lockfile'))
    }

    const installDir = parseInstallDirectory(row.CommandLine)
    if (installDir) {
      candidates.push(path.join(installDir, 'lockfile'))
    }
  }

  return Array.from(new Set(candidates))
}

function parseInstallDirectory(commandLine = '') {
  const match = String(commandLine).match(/--install-directory=(?:"([^"]+)"|([^\s]+))/i)
  return match ? (match[1] || match[2] || '').trim() : ''
}

function parseLockfile(text) {
  const [name, pid, port, password, protocol] = String(text).trim().split(':')
  if (!port || !password) {
    throw new Error('Invalid LCU lockfile format')
  }

  return {
    name,
    pid: Number(pid || 0),
    port: Number(port),
    password,
    protocol,
  }
}

function httpsJsonRequest(options) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      ...options,
      rejectUnauthorized: false,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`[LCU] ${options.method} ${options.path} -> ${response.statusCode} ${response.statusMessage}${errorDetail(text)}`))
          return
        }

        if (!text) {
          resolve(undefined)
          return
        }

        try {
          resolve(JSON.parse(text))
        } catch (error) {
          reject(new Error(`[LCU] Invalid JSON from ${options.path}: ${error.message}`))
        }
      })
    })

    request.on('error', reject)
    if (options.timeoutMs) {
      request.setTimeout(options.timeoutMs, () => {
        request.destroy(new Error(`[LCU] ${options.method} ${options.path} timed out after ${options.timeoutMs}ms`))
      })
    }
    if (options.body != null) request.write(options.body)
    request.end()
  })
}

function normalizeEventPayload(message) {
  const channel = message[1]
  const payload = message[2]

  if (channel === EVENT_CHANNEL && payload && typeof payload === 'object') {
    return payload
  }

  if (typeof channel === 'string' && payload && typeof payload === 'object') {
    return {
      ...payload,
      uri: payload.uri || channel,
    }
  }

  return null
}

function execFileText(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 2500, maxBuffer: 1024 * 512 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message))
        return
      }
      resolve(stdout.toString('utf8'))
    })
  })
}

function normalizePowerShellJson(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function errorDetail(text) {
  if (!text) return ''
  return ` - ${text.replace(/\s+/g, ' ').slice(0, 180)}`
}

module.exports = {
  EVENT_CHANNEL,
  LcuClient,
  findLockfile,
  parseLockfile,
}
