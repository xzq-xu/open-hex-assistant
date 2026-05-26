export const CARD_LABELS = {
  left: '左侧',
  middle: '中间',
  right: '右侧',
}

export const DEFAULT_CALIBRATION_CONFIG = {
  championId: 777,
  model: {
    recPath: 'models/paddleocr/ch_PP-OCRv4_rec_infer.onnx',
    dictPath: 'models/paddleocr/ppocr_keys_v1.txt',
    inputWidth: 320,
    inputHeight: 48,
    useSpaceChar: true,
    executionProviders: ['dml', 'cpu'],
  },
  capture: {
    display: 0,
    pollMs: 120,
    debugDir: 'runtime/ocr-debug',
    cards: [
      { name: 'left', titleRoi: { unit: 'ratio', x: 0.205, y: 0.405, width: 0.17, height: 0.055 } },
      { name: 'middle', titleRoi: { unit: 'ratio', x: 0.415, y: 0.405, width: 0.17, height: 0.055 } },
      { name: 'right', titleRoi: { unit: 'ratio', x: 0.625, y: 0.405, width: 0.17, height: 0.055 } },
    ],
  },
  automation: {
    enabled: true,
    forceActive: false,
    requireLeagueProcess: true,
    screenGate: true,
    idlePollMs: 1000,
    gamePollMs: 180,
    activeHoldMs: 900,
    processNames: ['League of Legends', 'League of Legends.exe'],
    trigger: {
      minCards: 2,
      cardScoreThreshold: 1.85,
      minAverageScore: 1.55,
      minBrightness: 0.04,
      maxBrightness: 0.88,
      minContrast: 0.08,
      strongContrast: 0.22,
      minEdgeDensity: 0.012,
      strongEdgeDensity: 0.08,
      minLightRatio: 0.01,
      strongLightRatio: 0.12,
      minDarkRatio: 0.02,
      strongDarkRatio: 0.25,
    },
  },
  lcu: {
    enabled: true,
    requireGameflow: true,
    lockfilePath: '',
    installDir: '',
    pollMs: 1000,
    allowedPhases: ['InProgress', 'Reconnect'],
  },
  output: {
    stateFile: 'runtime/overlay-state.json',
  },
}

export function normalizeCalibrationConfig(config = {}) {
  const merged = {
    ...DEFAULT_CALIBRATION_CONFIG,
    ...config,
    model: {
      ...DEFAULT_CALIBRATION_CONFIG.model,
      ...(config.model || {}),
    },
    capture: {
      ...DEFAULT_CALIBRATION_CONFIG.capture,
      ...(config.capture || {}),
    },
    automation: {
      ...DEFAULT_CALIBRATION_CONFIG.automation,
      ...(config.automation || {}),
      trigger: {
        ...DEFAULT_CALIBRATION_CONFIG.automation.trigger,
        ...(config.automation?.trigger || {}),
      },
    },
    lcu: {
      ...DEFAULT_CALIBRATION_CONFIG.lcu,
      ...(config.lcu || {}),
    },
    output: {
      ...DEFAULT_CALIBRATION_CONFIG.output,
      ...(config.output || {}),
    },
  }

  return {
    ...merged,
    capture: {
      ...merged.capture,
      cards: DEFAULT_CALIBRATION_CONFIG.capture.cards.map((fallback, index) => {
        const card = merged.capture.cards?.[index] || fallback
        return {
          name: card.name || fallback.name,
          titleRoi: normalizeRoi(card.titleRoi || fallback.titleRoi),
        }
      }),
    },
  }
}

export function updateCardRoi(config, index, roi) {
  const normalized = normalizeCalibrationConfig(config)
  const cards = normalized.capture.cards.map((card, cardIndex) => (
    cardIndex === index ? { ...card, titleRoi: normalizeRoi(roi) } : card
  ))

  return {
    ...normalized,
    capture: {
      ...normalized.capture,
      cards,
    },
  }
}

export function normalizeRoi(roi) {
  const x = clamp(numberOr(roi?.x, 0), 0, 0.99)
  const y = clamp(numberOr(roi?.y, 0), 0, 0.99)
  const width = clamp(numberOr(roi?.width, 0.1), 0.01, 1 - x)
  const height = clamp(numberOr(roi?.height, 0.05), 0.01, 1 - y)

  return {
    unit: 'ratio',
    x: round(x, 5),
    y: round(y, 5),
    width: round(width, 5),
    height: round(height, 5),
  }
}

export function roiToStyle(roi) {
  return {
    left: `${roi.x * 100}%`,
    top: `${roi.y * 100}%`,
    width: `${roi.width * 100}%`,
    height: `${roi.height * 100}%`,
  }
}

export function formatRoi(roi) {
  return [
    `x ${(roi.x * 100).toFixed(2)}%`,
    `y ${(roi.y * 100).toFixed(2)}%`,
    `w ${(roi.width * 100).toFixed(2)}%`,
    `h ${(roi.height * 100).toFixed(2)}%`,
  ].join(' · ')
}

export function cardLabel(name) {
  return CARD_LABELS[name] || name
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function numberOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
