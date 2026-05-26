const { execFile } = require('node:child_process')

const DEFAULT_PROCESS_NAMES = [
  'League of Legends',
  'League of Legends.exe',
]

async function detectLeagueGame(options = {}) {
  if (options.forceActive) {
    return {
      running: true,
      activeWindow: true,
      platform: process.platform,
      skipped: true,
      reason: 'forced-active',
    }
  }

  if (!options.requireLeagueProcess) {
    return {
      running: true,
      activeWindow: true,
      platform: process.platform,
      skipped: true,
      reason: 'process-gate-disabled',
    }
  }

  if (process.platform !== 'win32') {
    return {
      running: false,
      activeWindow: false,
      platform: process.platform,
      reason: 'unsupported-platform',
    }
  }

  const processNames = normalizeProcessNames(options.processNames)
  try {
    return await detectByPowerShell(processNames)
  } catch (error) {
    const fallback = await detectByTaskList(processNames)
    return {
      ...fallback,
      reason: fallback.running ? 'tasklist-fallback' : `not-running: ${error.message}`,
    }
  }
}

function normalizeProcessNames(values) {
  const names = Array.isArray(values) && values.length ? values : DEFAULT_PROCESS_NAMES
  const normalized = new Set()

  for (const name of names) {
    const cleanName = String(name || '').trim()
    if (!cleanName) continue
    normalized.add(cleanName)
    normalized.add(cleanName.replace(/\.exe$/i, ''))
  }

  return Array.from(normalized)
}

async function detectByPowerShell(processNames) {
  const script = [
    `$names = @(${processNames.map(powerShellString).join(',')})`,
    '$items = Get-Process | Where-Object { $names -contains $_.ProcessName -or $names -contains ($_.ProcessName + ".exe") } | Select-Object -First 8 Id,ProcessName,MainWindowTitle',
    'if ($null -eq $items) { "[]" } else { $items | ConvertTo-Json -Compress }',
  ].join('; ')

  const stdout = await execFileText('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ])
  const processes = normalizePowerShellJson(stdout)
  const visible = processes.find((item) => String(item.MainWindowTitle || '').trim())
  const primary = visible || processes[0]

  return {
    running: processes.length > 0,
    activeWindow: Boolean(visible),
    platform: process.platform,
    processName: primary?.ProcessName || '',
    pid: Number(primary?.Id || 0),
    windowTitle: primary?.MainWindowTitle || '',
    reason: processes.length ? 'process-found' : 'not-running',
  }
}

async function detectByTaskList(processNames) {
  const stdout = await execFileText('tasklist.exe', ['/FO', 'CSV', '/NH'])
  const names = new Set(processNames.map((name) => name.toLowerCase()))
  const line = stdout
    .split(/\r?\n/)
    .find((row) => {
      const imageName = parseCsvFirstColumn(row).toLowerCase()
      return names.has(imageName) || names.has(imageName.replace(/\.exe$/i, ''))
    })

  return {
    running: Boolean(line),
    activeWindow: false,
    platform: process.platform,
    processName: line ? parseCsvFirstColumn(line) : '',
    pid: 0,
    windowTitle: '',
    reason: line ? 'process-found' : 'not-running',
  }
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

function parseCsvFirstColumn(row) {
  const match = String(row || '').match(/^"((?:[^"]|"")*)"/)
  return match ? match[1].replace(/""/g, '"') : ''
}

function powerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

module.exports = {
  DEFAULT_PROCESS_NAMES,
  detectLeagueGame,
}
