const fs = require('node:fs')
const path = require('node:path')
const { loadOcrConfig, projectPath } = require('./ocr/config.cjs')
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

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runOnce(config, recognizer)
    } catch (error) {
      emitState(config, {
        error: `OCR failed: ${error.message}`,
        candidates: [],
        ocr: {
          ready: true,
          engine: 'paddleocr-onnx',
        },
      })
    } finally {
      running = false
    }
  }

  await tick()
  setInterval(tick, config.capture.pollMs)
}

async function runOnce(config, recognizer) {
  const startedAt = performance.now()
  const screenBuffer = await captureScreen(config.capture.display)
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
      elapsedMs,
      targetMs: 500,
      withinTarget: elapsedMs <= 500,
      confidence: round(average(cards.map((card) => card.confidence).filter(Boolean)), 4),
      screen,
      cards,
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
