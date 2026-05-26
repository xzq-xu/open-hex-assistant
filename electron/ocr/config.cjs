const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.join(__dirname, '..', '..')
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
      cards: DEFAULT_CARD_ROIS,
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
      cards: override.capture?.cards || base.capture.cards,
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
      cards: normalizeCards(config.capture?.cards),
    },
    output: {
      ...config.output,
    },
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

function ocrConfigPath(env = process.env) {
  return projectPath(env.OCR_CONFIG || 'runtime/ocr-config.json')
}

function projectPath(filePath) {
  if (!filePath) return ''
  return path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath)
}

function numberOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
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
  PROJECT_ROOT,
  defaultOcrConfig,
  loadOcrConfig,
  normalizeOcrConfig,
  ocrConfigPath,
  projectPath,
  saveOcrConfig,
}
