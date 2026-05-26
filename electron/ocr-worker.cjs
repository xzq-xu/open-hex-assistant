const fs = require('node:fs')
const path = require('node:path')
const { detectAugmentSelection } = require('./ocr/augment-screen-detector.cjs')
const { loadOcrConfig, projectPath } = require('./ocr/config.cjs')
const { detectLeagueGame } = require('./ocr/game-detector.cjs')
const { PaddleOcrRecognizer } = require('./ocr/paddle-recognizer.cjs')
const { captureScreen, cropRegions } = require('./ocr/screen-reader.cjs')

async function main() {
  const config = loadOcrConfig()
  const recognizer = new PaddleOcrRecognizer({
    modelPath: projectPath(config.model.recPath),
    dictPath: projectPath(config.model.dictPath),
    inputWidth: config.model.inputWidth,
    inputHeight: config.model.inputHeight,
    useSpaceChar: config.model.useSpaceChar,
    executionProviders: config.model.executionProviders,
  })

  try {
    await recognizer.init()
  } catch (error) {
    emitState(config, {
      error: `${error.message}. 请先放入 PaddleOCR ONNX 识别模型和字典。`,
      candidates: [],
      ocr: {
        ready: false,
        engine: 'paddleocr-onnx',
      },
    })
    process.exitCode = 1
    return
  }

  emitLog('PaddleOCR ONNX recognizer ready')

  if (process.env.OCR_ONCE === '1') {
    await runOnce(config, recognizer)
    return
  }

  runLoop(config, recognizer)
}

function runLoop(config, recognizer) {
  const loopState = {
    running: false,
    lastActiveAt: 0,
    lastPassiveEmitAt: 0,
    lastPassiveKey: '',
  }

  const tick = async () => {
    if (loopState.running) return

    loopState.running = true
    let nextPollMs = config.capture.pollMs
    try {
      nextPollMs = await runGatedFrame(config, recognizer, loopState)
    } catch (error) {
      emitState(config, {
        error: `OCR failed: ${error.message}`,
        candidates: [],
        ocr: {
          ready: true,
          engine: 'paddleocr-onnx',
          phase: 'error',
          active: false,
        },
      })
      nextPollMs = config.automation?.gamePollMs || 500
    } finally {
      loopState.running = false
      setTimeout(tick, nextPollMs)
    }
  }

  tick()
}

async function runGatedFrame(config, recognizer, loopState) {
  const automation = config.automation
  if (!automation?.enabled) {
    await runOnce(config, recognizer)
    return config.capture.pollMs
  }

  const scanStartedAt = performance.now()
  const game = await detectLeagueGame(automation)
  if (!game.running) {
    emitPassiveState(config, loopState, 'idle', {
      game,
      scanElapsedMs: Math.round(performance.now() - scanStartedAt),
    })
    return automation.idlePollMs
  }

  const screenBuffer = await captureScreen(config.capture.display)
  const debugDir = process.env.OCR_DEBUG === '1'
    ? projectPath(config.capture.debugDir || 'runtime/ocr-debug')
    : ''
  const trigger = await detectTrigger(screenBuffer, config, debugDir)

  if (trigger.active) {
    loopState.lastActiveAt = Date.now()
  }

  const active = trigger.active || (Date.now() - loopState.lastActiveAt <= automation.activeHoldMs)
  if (!active) {
    emitPassiveState(config, loopState, 'game-running', {
      game,
      trigger,
      screen: trigger.screen,
      scanElapsedMs: Math.round(performance.now() - scanStartedAt),
    })
    return automation.gamePollMs
  }

  await recognizeFrame(config, recognizer, screenBuffer, {
    game,
    trigger: {
      ...trigger,
      active,
      heldActive: !trigger.active,
    },
  })
  return config.capture.pollMs
}

async function detectTrigger(screenBuffer, config, debugDir) {
  const automation = config.automation

  if (automation.forceActive) {
    return {
      active: true,
      reason: 'forced-active',
    }
  }

  if (!automation.screenGate) {
    return {
      active: true,
      reason: 'screen-gate-disabled',
    }
  }

  return detectAugmentSelection(screenBuffer, config, debugDir)
}

async function runOnce(config, recognizer) {
  const startedAt = performance.now()
  const screenBuffer = await captureScreen(config.capture.display)
  await recognizeFrame(config, recognizer, screenBuffer, {
    trigger: {
      active: true,
      reason: 'manual-probe',
    },
    startedAt,
  })
}

async function recognizeFrame(config, recognizer, screenBuffer, context = {}) {
  const startedAt = context.startedAt || performance.now()
  const debugDir = process.env.OCR_DEBUG === '1'
    ? projectPath(config.capture.debugDir || 'runtime/ocr-debug')
    : ''
  const { screen, crops } = await cropRegions(screenBuffer, config.capture.cards, debugDir)

  const cards = []
  for (const crop of crops) {
    const result = await recognizer.recognize(crop.buffer)
    cards.push({
      slot: crop.name,
      text: result.text,
      confidence: round(result.confidence, 4),
      elapsedMs: result.elapsedMs,
      roi: crop.roi,
    })
  }

  const candidates = cards.map((card) => card.text).filter(Boolean).slice(0, 3)
  const elapsedMs = Math.round(performance.now() - startedAt)

  emitState(config, {
    championId: config.championId,
    candidates,
    ocr: {
      ready: true,
      engine: 'paddleocr-onnx',
      phase: 'augment-pick-active',
      active: true,
      elapsedMs,
      targetMs: 500,
      withinTarget: elapsedMs <= 500,
      confidence: round(average(cards.map((card) => card.confidence).filter(Boolean)), 4),
      screen,
      cards,
      game: context.game,
      trigger: context.trigger,
    },
  })
}

function emitPassiveState(config, loopState, phase, details = {}) {
  const now = Date.now()
  const key = JSON.stringify({
    phase,
    game: details.game?.reason,
    trigger: details.trigger?.active,
    score: details.trigger?.score,
  })

  if (key === loopState.lastPassiveKey && now - loopState.lastPassiveEmitAt < 2000) {
    return
  }

  loopState.lastPassiveKey = key
  loopState.lastPassiveEmitAt = now

  emitState(config, {
    championId: config.championId,
    candidates: [],
    ocr: {
      ready: true,
      engine: 'paddleocr-onnx',
      phase,
      active: false,
      targetMs: 500,
      scanElapsedMs: details.scanElapsedMs,
      game: details.game,
      trigger: details.trigger,
      screen: details.screen,
    },
  })
}

function emitState(config, state) {
  const payload = {
    ...state,
    updatedAt: new Date().toISOString(),
  }
  const line = JSON.stringify(payload)
  process.stdout.write(`${line}\n`)

  const stateFile = process.env.OVERLAY_STATE_FILE || config.output?.stateFile
  if (stateFile) {
    const resolvedStateFile = projectPath(stateFile)
    fs.mkdirSync(path.dirname(resolvedStateFile), { recursive: true })
    fs.writeFileSync(resolvedStateFile, `${JSON.stringify(payload, null, 2)}\n`)
  }
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(Number(value || 0) * factor) / factor
}

function emitLog(message) {
  process.stderr.write(`[ocr] ${message}\n`)
}

main().catch((error) => {
  process.stderr.write(`[ocr] fatal: ${error.stack || error.message}\n`)
  process.exit(1)
})
