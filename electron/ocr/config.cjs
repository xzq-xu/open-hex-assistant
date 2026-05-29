const fs = require('node:fs')
const path = require('node:path')

const SOURCE_ROOT = path.join(__dirname, '..', '..')
const DEFAULT_CARD_ROIS = [
  { name: 'left', titleRoi: { unit: 'ratio', x: 0.205, y: 0.405, width: 0.17, height: 0.055 } },
  { name: 'middle', titleRoi: { unit: 'ratio', x: 0.415, y: 0.405, width: 0.17, height: 0.055 } },
  { name: 'right', titleRoi: { unit: 'ratio', x: 0.625, y: 0.405, width: 0.17, height: 0.055 } },
]

function defaultOcrConfig(env = process.env) {
  return {
    championId: Number(env.OVERLAY_CHAMPION || 777),
    model: {
      recPath: env.PADDLEOCR_REC_MODEL || 'models/paddleocr/ch_PP-OCRv4_rec_infer.onnx',
      dictPath: env.PADDLEOCR_DICT || 'models/paddleocr/ppocr_keys_v1.txt',
      inputWidth: Number(env.PADDLEOCR_INPUT_WIDTH || 320),
      inputHeight: Number(env.PADDLEOCR_INPUT_HEIGHT || 48),
      useSpaceChar: true,
      executionProviders: parseExecutionProviders(env.OCR_EXECUTION_PROVIDERS)
        || (process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu']),
    },
    capture: {
      display: Number(env.OCR_DISPLAY || 0),
      pollMs: Number(env.OCR_POLL_MS || 120),
      debugDir: 'runtime/ocr-debug',
      preprocess: {
        scale: Number(env.OCR_CROP_SCALE || 2),
        grayscale: parseBool(env.OCR_CROP_GRAYSCALE, true),
        sharpen: parseBool(env.OCR_CROP_SHARPEN, false),
      },
      cards: DEFAULT_CARD_ROIS,
    },
    automation: {
      enabled: parseBool(env.OCR_AUTO_GATE, true),
      forceActive: parseBool(env.OCR_FORCE_ACTIVE, false),
      requireLeagueProcess: parseBool(env.OCR_REQUIRE_LEAGUE_PROCESS, true),
      screenGate: parseBool(env.OCR_SCREEN_GATE, true),
      idlePollMs: Number(env.OCR_IDLE_POLL_MS || 1000),
      gamePollMs: Number(env.OCR_GAME_POLL_MS || 180),
      activeHoldMs: Number(env.OCR_ACTIVE_HOLD_MS || 900),
      processNames: parseList(env.OCR_GAME_PROCESS_NAMES) || [
        'League of Legends',
        'League of Legends.exe',
      ],
      trigger: {
        minCards: Number(env.OCR_TRIGGER_MIN_CARDS || 2),
        cardScoreThreshold: Number(env.OCR_TRIGGER_CARD_SCORE || 1.85),
        minAverageScore: Number(env.OCR_TRIGGER_AVERAGE_SCORE || 1.55),
        minBrightness: Number(env.OCR_TRIGGER_MIN_BRIGHTNESS || 0.04),
        maxBrightness: Number(env.OCR_TRIGGER_MAX_BRIGHTNESS || 0.88),
        minContrast: Number(env.OCR_TRIGGER_MIN_CONTRAST || 0.08),
        strongContrast: Number(env.OCR_TRIGGER_STRONG_CONTRAST || 0.22),
        minEdgeDensity: Number(env.OCR_TRIGGER_MIN_EDGE_DENSITY || 0.012),
        strongEdgeDensity: Number(env.OCR_TRIGGER_STRONG_EDGE_DENSITY || 0.08),
        minLightRatio: Number(env.OCR_TRIGGER_MIN_LIGHT_RATIO || 0.01),
        strongLightRatio: Number(env.OCR_TRIGGER_STRONG_LIGHT_RATIO || 0.12),
        minDarkRatio: Number(env.OCR_TRIGGER_MIN_DARK_RATIO || 0.02),
        strongDarkRatio: Number(env.OCR_TRIGGER_STRONG_DARK_RATIO || 0.25),
      },
    },
    lcu: {
      enabled: parseBool(env.LCU_ENABLED, true),
      requireGameflow: parseBool(env.LCU_REQUIRE_GAMEFLOW, true),
      lockfilePath: env.LCU_LOCKFILE || '',
      installDir: env.LCU_INSTALL_DIR || '',
      pollMs: Number(env.LCU_POLL_MS || 1000),
      allowedPhases: parseList(env.LCU_ALLOWED_PHASES) || ['InProgress', 'Reconnect'],
    },
    coach: {
      enabled: parseBool(env.COACH_ENABLED, true),
      passivePollMs: Number(env.COACH_PASSIVE_POLL_MS || 2200),
    },
    output: {
      stateFile: '',
    },
  }
}

function loadOcrConfig(env = process.env) {
  const configPath = ocrConfigPath(env)
  const userConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {}

  return normalizeOcrConfig(mergeOcrConfig(defaultOcrConfig(env), userConfig))
}

function saveOcrConfig(config, env = process.env) {
  const configPath = ocrConfigPath(env)
  const normalized = normalizeOcrConfig(mergeOcrConfig(defaultOcrConfig(env), config))

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`)

  return {
    config: normalized,
    path: configPath,
  }
}

function mergeOcrConfig(base, override = {}) {
  return {
    ...base,
    ...override,
    model: {
      ...base.model,
      ...(override.model || {}),
    },
    capture: {
      ...base.capture,
      ...(override.capture || {}),
      preprocess: {
        ...base.capture.preprocess,
        ...(override.capture?.preprocess || {}),
      },
      cards: override.capture?.cards || base.capture.cards,
    },
    automation: {
      ...base.automation,
      ...(override.automation || {}),
      trigger: {
        ...base.automation.trigger,
        ...(override.automation?.trigger || {}),
      },
    },
    lcu: {
      ...base.lcu,
      ...(override.lcu || {}),
    },
    coach: {
      ...base.coach,
      ...(override.coach || {}),
    },
    output: {
      ...base.output,
      ...(override.output || {}),
    },
  }
}

function normalizeOcrConfig(config) {
  return {
    ...config,
    championId: numberOr(config.championId, 777),
    model: {
      ...config.model,
      inputWidth: Math.max(64, numberOr(config.model?.inputWidth, 320)),
      inputHeight: Math.max(24, numberOr(config.model?.inputHeight, 48)),
      useSpaceChar: config.model?.useSpaceChar !== false,
      executionProviders: Array.isArray(config.model?.executionProviders) && config.model.executionProviders.length
        ? config.model.executionProviders
        : ['cpu'],
    },
    capture: {
      ...config.capture,
      display: Math.max(0, Math.round(numberOr(config.capture?.display, 0))),
      pollMs: Math.max(50, Math.round(numberOr(config.capture?.pollMs, 120))),
      preprocess: normalizePreprocess(config.capture?.preprocess),
      cards: normalizeCards(config.capture?.cards),
    },
    automation: normalizeAutomation(config.automation),
    lcu: normalizeLcu(config.lcu),
    coach: normalizeCoach(config.coach),
    output: {
      ...config.output,
    },
  }
}

function normalizePreprocess(preprocess = {}) {
  return {
    ...preprocess,
    scale: clamp(numberOr(preprocess.scale, 2), 1, 4),
    grayscale: preprocess.grayscale !== false,
    sharpen: preprocess.sharpen === true,
  }
}

function normalizeCards(cards) {
  const source = Array.isArray(cards) && cards.length ? cards : DEFAULT_CARD_ROIS

  return DEFAULT_CARD_ROIS.map((fallback, index) => {
    const card = source[index] || fallback
    return {
      name: String(card.name || fallback.name),
      titleRoi: normalizeRatioRoi(card.titleRoi || card.roi || fallback.titleRoi, fallback.titleRoi),
    }
  })
}

function normalizeRatioRoi(roi, fallback) {
  const x = clamp(numberOr(roi?.x, fallback.x), 0, 0.99)
  const y = clamp(numberOr(roi?.y, fallback.y), 0, 0.99)
  const width = clamp(numberOr(roi?.width, fallback.width), 0.01, 1 - x)
  const height = clamp(numberOr(roi?.height, fallback.height), 0.01, 1 - y)

  return {
    unit: 'ratio',
    x: round(x, 5),
    y: round(y, 5),
    width: round(width, 5),
    height: round(height, 5),
  }
}

function normalizeLcu(lcu = {}) {
  return {
    ...lcu,
    enabled: lcu.enabled !== false,
    requireGameflow: lcu.requireGameflow !== false,
    lockfilePath: String(lcu.lockfilePath || ''),
    installDir: String(lcu.installDir || ''),
    pollMs: Math.max(250, Math.round(numberOr(lcu.pollMs, 1000))),
    allowedPhases: Array.isArray(lcu.allowedPhases) && lcu.allowedPhases.length
      ? lcu.allowedPhases.map((phase) => String(phase).trim()).filter(Boolean)
      : ['InProgress', 'Reconnect'],
  }
}

function normalizeAutomation(automation = {}) {
  return {
    ...automation,
    enabled: automation.enabled !== false,
    forceActive: automation.forceActive === true,
    requireLeagueProcess: automation.requireLeagueProcess === true,
    screenGate: automation.screenGate !== false,
    idlePollMs: Math.max(250, Math.round(numberOr(automation.idlePollMs, 1000))),
    gamePollMs: Math.max(100, Math.round(numberOr(automation.gamePollMs, 350))),
    activeHoldMs: Math.max(0, Math.round(numberOr(automation.activeHoldMs, 900))),
    processNames: Array.isArray(automation.processNames) && automation.processNames.length
      ? automation.processNames.map((name) => String(name).trim()).filter(Boolean)
      : ['League of Legends', 'League of Legends.exe'],
    trigger: normalizeTrigger(automation.trigger),
  }
}

function normalizeCoach(coach = {}) {
  return {
    ...coach,
    enabled: coach.enabled !== false,
    passivePollMs: Math.max(500, Math.round(numberOr(coach.passivePollMs, 2200))),
  }
}

function normalizeTrigger(trigger = {}) {
  return {
    ...trigger,
    minCards: clamp(Math.round(numberOr(trigger.minCards, 2)), 1, 3),
    cardScoreThreshold: clamp(numberOr(trigger.cardScoreThreshold, 1.85), 0, 4),
    minAverageScore: clamp(numberOr(trigger.minAverageScore, 1.55), 0, 4),
    minBrightness: clamp(numberOr(trigger.minBrightness, 0.04), 0, 1),
    maxBrightness: clamp(numberOr(trigger.maxBrightness, 0.88), 0, 1),
    minContrast: clamp(numberOr(trigger.minContrast, 0.08), 0, 1),
    strongContrast: clamp(numberOr(trigger.strongContrast, 0.22), 0, 1),
    minEdgeDensity: clamp(numberOr(trigger.minEdgeDensity, 0.012), 0, 1),
    strongEdgeDensity: clamp(numberOr(trigger.strongEdgeDensity, 0.08), 0, 1),
    minLightRatio: clamp(numberOr(trigger.minLightRatio, 0.01), 0, 1),
    strongLightRatio: clamp(numberOr(trigger.strongLightRatio, 0.12), 0, 1),
    minDarkRatio: clamp(numberOr(trigger.minDarkRatio, 0.02), 0, 1),
    strongDarkRatio: clamp(numberOr(trigger.strongDarkRatio, 0.25), 0, 1),
  }
}

function ocrConfigPath(env = process.env) {
  return writablePath(env.OCR_CONFIG || 'runtime/ocr-config.json', env)
}

function projectPath(filePath, env = process.env) {
  if (!filePath) return ''
  if (path.isAbsolute(filePath)) return filePath

  const candidates = [
    path.join(appRoot(env), filePath),
    path.join(resourceRoot(env), filePath),
    path.join(SOURCE_ROOT, filePath),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}

function writablePath(filePath, env = process.env) {
  if (!filePath) return ''
  return path.isAbsolute(filePath) ? filePath : path.join(userDataRoot(env), filePath)
}

function appRoot(env = process.env) {
  return env.OPEN_HEX_APP_ROOT || SOURCE_ROOT
}

function resourceRoot(env = process.env) {
  return env.OPEN_HEX_RESOURCE_ROOT || appRoot(env)
}

function userDataRoot(env = process.env) {
  return env.OPEN_HEX_USER_DATA || appRoot(env)
}

function numberOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseBool(value, fallback) {
  if (value == null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase())
}

function parseList(value) {
  if (!value) return null
  const items = String(value)
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length ? items : null
}

function parseExecutionProviders(value) {
  if (!value) return null
  const providers = String(value)
    .split(/[,\s]+/)
    .map((provider) => provider.trim())
    .filter(Boolean)
  return providers.length ? providers : null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

module.exports = {
  DEFAULT_CARD_ROIS,
  PROJECT_ROOT: SOURCE_ROOT,
  defaultOcrConfig,
  loadOcrConfig,
  normalizeOcrConfig,
  ocrConfigPath,
  projectPath,
  saveOcrConfig,
  writablePath,
}
