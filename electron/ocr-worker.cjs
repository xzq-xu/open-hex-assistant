const fs = require('node:fs')
const path = require('node:path')
const { LcuGameState } = require('./lcu/game-state.cjs')
const { detectAugmentSelection } = require('./ocr/augment-screen-detector.cjs')
const { loadOcrConfig, projectPath, writablePath } = require('./ocr/config.cjs')
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

  runLoop(config, recognizer, new LcuGameState(config.lcu))
}

function runLoop(config, recognizer, lcuGameState) {
  const loopState = {
    running: false,
    timer: null,
    pendingCommands: [],
    wakeAfterRun: false,
    lastActiveAt: 0,
    lastPassiveEmitAt: 0,
    lastPassiveKey: '',
    lastCoachAt: 0,
    coach: null,
  }

  let tick
  const schedule = (delayMs = 0) => {
    if (loopState.timer) clearTimeout(loopState.timer)
    loopState.timer = setTimeout(tick, Math.max(0, delayMs))
  }

  tick = async () => {
    loopState.timer = null
    if (loopState.running) {
      loopState.wakeAfterRun = true
      return
    }

    loopState.running = true
    let nextPollMs = config.capture.pollMs
    try {
      const command = loopState.pendingCommands.shift()
      nextPollMs = command
        ? await runCommandFrame(config, recognizer, loopState, lcuGameState, command)
        : await runGatedFrame(config, recognizer, loopState, lcuGameState)
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
      const shouldWakeImmediately = loopState.wakeAfterRun || loopState.pendingCommands.length > 0
      loopState.wakeAfterRun = false
      schedule(shouldWakeImmediately ? 0 : nextPollMs)
    }
  }

  setupCommandInput(loopState, schedule)
  schedule(0)
}

function setupCommandInput(loopState, schedule) {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      const command = parseCommand(line)
      if (!command) continue
      if (command.type === 'reset') {
        loopState.pendingCommands = [command]
      } else {
        loopState.pendingCommands.push(command)
      }
      if (loopState.running) loopState.wakeAfterRun = true
      schedule(0)
    }
  })
  process.stdin.resume()
}

function parseCommand(line) {
  try {
    const payload = JSON.parse(line)
    const type = String(payload?.type || '')
    if (['recognize-now', 'refresh-hero', 'coach-now', 'reset'].includes(type)) {
      return {
        type,
        requestedAt: payload.requestedAt || new Date().toISOString(),
      }
    }
  } catch (error) {
    emitLog(`ignored invalid command: ${error.message}`)
  }
  return null
}

async function runCommandFrame(config, recognizer, loopState, lcuGameState, command) {
  if (command.type === 'reset') {
    loopState.lastActiveAt = 0
    emitState(config, {
      candidates: [],
      ocr: {
        ready: true,
        engine: 'paddleocr-onnx',
        phase: 'reset',
        active: false,
        targetMs: 500,
        command,
      },
    })
    return config.capture.pollMs
  }

  const lcu = await lcuGameState.snapshot()
  const coach = command.type === 'coach-now'
    ? await refreshCoach(config, loopState, lcuGameState, 'manual-hotkey')
    : await maybeRefreshCoach(config, loopState, lcuGameState)

  if (command.type === 'refresh-hero') {
    emitState(config, {
      championId: lcu.championId || config.championId,
      candidates: [],
      coach,
      ocr: {
        ready: true,
        engine: 'paddleocr-onnx',
        phase: 'hero-refreshed',
        active: false,
        targetMs: 500,
        lcu,
        command,
      },
    })
    return config.capture.pollMs
  }

  if (command.type === 'coach-now') {
    emitState(config, {
      championId: coach?.myChampionId || lcu.championId || config.championId,
      candidates: [],
      coach,
      ocr: {
        ready: true,
        engine: 'paddleocr-onnx',
        phase: 'coach-refreshed',
        active: false,
        targetMs: 500,
        lcu,
        command,
      },
    })
    return config.capture.pollMs
  }

  const startedAt = performance.now()
  const screenBuffer = await captureScreen(config.capture.display)
  await recognizeFrame(config, recognizer, screenBuffer, {
    championId: lcu.championId,
    lcu,
    coach,
    startedAt,
    trigger: {
      active: true,
      reason: 'manual-hotkey',
    },
    command,
  })
  return config.capture.pollMs
}

async function runGatedFrame(config, recognizer, loopState, lcuGameState) {
  const automation = config.automation
  if (!automation?.enabled) {
    await runOnce(config, recognizer)
    return config.capture.pollMs
  }

  const scanStartedAt = performance.now()
  const lcu = await lcuGameState.snapshot()
  const coach = await maybeRefreshCoach(config, loopState, lcuGameState)
  if (lcu.enabled && !lcu.allowed) {
    emitPassiveState(config, loopState, lcu.connected ? 'lcu-waiting' : 'lcu-disconnected', {
      lcu,
      coach,
      scanElapsedMs: Math.round(performance.now() - scanStartedAt),
    })
    return lcu.connected ? config.lcu.pollMs : automation.idlePollMs
  }

  const game = lcu.enabled && lcu.connected
    ? {
      running: true,
      activeWindow: true,
      platform: process.platform,
      reason: 'lcu-gameflow-allowed',
      lcu,
    }
    : await detectLeagueGame(automation)

  if (!game.running) {
    emitPassiveState(config, loopState, 'idle', {
      game,
      lcu,
      coach,
      scanElapsedMs: Math.round(performance.now() - scanStartedAt),
    })
    return automation.idlePollMs
  }

  const screenBuffer = await captureScreen(config.capture.display)
  const debugDir = process.env.OCR_DEBUG === '1'
    ? writablePath(config.capture.debugDir || 'runtime/ocr-debug')
    : ''
  const trigger = await detectTrigger(screenBuffer, config, debugDir)

  if (trigger.active) {
    loopState.lastActiveAt = Date.now()
  }

  const active = trigger.active || (Date.now() - loopState.lastActiveAt <= automation.activeHoldMs)
  if (!active) {
    emitPassiveState(config, loopState, 'game-running', {
      game,
      lcu,
      coach,
      trigger,
      screen: trigger.screen,
      scanElapsedMs: Math.round(performance.now() - scanStartedAt),
    })
    return automation.gamePollMs
  }

  await recognizeFrame(config, recognizer, screenBuffer, {
    championId: lcu.championId,
    game,
    lcu,
    coach,
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
    ? writablePath(config.capture.debugDir || 'runtime/ocr-debug')
    : ''
  const { screen, crops } = await cropRegions(screenBuffer, config.capture.cards, debugDir, config.capture.preprocess)

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
    championId: context.championId || config.championId,
    candidates,
    coach: context.coach,
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
      lcu: context.lcu,
      trigger: context.trigger,
      command: context.command,
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
    championId: details.lcu?.championId || config.championId,
    candidates: [],
    coach: details.coach,
    ocr: {
      ready: true,
      engine: 'paddleocr-onnx',
      phase,
      active: false,
      targetMs: 500,
      scanElapsedMs: details.scanElapsedMs,
      lcu: details.lcu,
      game: details.game,
      trigger: details.trigger,
      screen: details.screen,
    },
  })
}

async function maybeRefreshCoach(config, loopState, lcuGameState) {
  if (!config.coach?.enabled) return loopState.coach
  const now = Date.now()
  if (loopState.coach && now - loopState.lastCoachAt < config.coach.passivePollMs) {
    return loopState.coach
  }
  return refreshCoach(config, loopState, lcuGameState, 'auto')
}

async function refreshCoach(config, loopState, lcuGameState, trigger) {
  if (!config.coach?.enabled) return null
  const coach = await lcuGameState.coachSnapshot({ trigger })
  loopState.coach = coach
  loopState.lastCoachAt = Date.now()
  return coach
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
    const resolvedStateFile = writablePath(stateFile)
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
