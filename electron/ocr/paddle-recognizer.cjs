const fs = require('node:fs')
const ort = require('onnxruntime-node')
const sharp = require('sharp')

class PaddleOcrRecognizer {
  constructor(options) {
    this.modelPath = options.modelPath
    this.dictPath = options.dictPath
    this.inputWidth = Number(options.inputWidth || 320)
    this.inputHeight = Number(options.inputHeight || 48)
    this.useSpaceChar = options.useSpaceChar !== false
    this.executionProviders = options.executionProviders || ['cpu']
    this.session = null
    this.inputName = ''
    this.outputName = ''
    this.characters = []
  }

  async init() {
    assertFile(this.modelPath, 'PaddleOCR recognition ONNX model')
    assertFile(this.dictPath, 'PaddleOCR dictionary')

    this.characters = loadCharacters(this.dictPath, this.useSpaceChar)
    this.session = await createSessionWithFallback(this.modelPath, this.executionProviders)
    this.inputName = this.session.inputNames[0]
    this.outputName = this.session.outputNames[0]
  }

  async recognize(imageBuffer) {
    if (!this.session) throw new Error('PaddleOCR recognizer is not initialized')

    const startedAt = performance.now()
    const tensor = await this.preprocess(imageBuffer)
    const outputMap = await this.session.run({ [this.inputName]: tensor })
    const output = outputMap[this.outputName]
    const decoded = decodeCtc(output, this.characters)

    return {
      ...decoded,
      elapsedMs: Math.round(performance.now() - startedAt),
    }
  }

  async preprocess(imageBuffer) {
    const source = sharp(imageBuffer).rotate().toColourspace('srgb').removeAlpha()
    const metadata = await source.metadata()
    const sourceWidth = Math.max(1, metadata.width || this.inputWidth)
    const sourceHeight = Math.max(1, metadata.height || this.inputHeight)
    const ratioWidth = Math.min(this.inputWidth, Math.max(1, Math.ceil(this.inputHeight * sourceWidth / sourceHeight)))

    const { data, info } = await source
      .resize(ratioWidth, this.inputHeight, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const input = new Float32Array(3 * this.inputHeight * this.inputWidth)
    const channels = info.channels

    for (let y = 0; y < this.inputHeight; y += 1) {
      for (let x = 0; x < ratioWidth; x += 1) {
        const pixelOffset = (y * ratioWidth + x) * channels
        for (let channel = 0; channel < 3; channel += 1) {
          const value = data[pixelOffset + channel] / 255
          input[channel * this.inputHeight * this.inputWidth + y * this.inputWidth + x] = (value - 0.5) / 0.5
        }
      }
    }

    return new ort.Tensor('float32', input, [1, 3, this.inputHeight, this.inputWidth])
  }
}

function assertFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath || '(empty path)'}`)
  }
}

async function createSessionWithFallback(modelPath, executionProviders) {
  try {
    return await ort.InferenceSession.create(modelPath, sessionOptions(executionProviders))
  } catch (error) {
    if (executionProviders.length === 1 && executionProviders[0] === 'cpu') throw error
    console.warn(`[ocr] provider fallback to CPU: ${error.message}`)
    return ort.InferenceSession.create(modelPath, sessionOptions(['cpu']))
  }
}

function sessionOptions(executionProviders) {
  const usesDirectMl = executionProviders.includes('dml')
  return {
    executionProviders,
    enableMemPattern: !usesDirectMl,
    executionMode: usesDirectMl ? 'sequential' : 'parallel',
    graphOptimizationLevel: 'all',
  }
}

function loadCharacters(dictPath, useSpaceChar) {
  const lines = fs.readFileSync(dictPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (useSpaceChar && !lines.includes(' ')) {
    lines.push(' ')
  }

  return ['blank', ...lines]
}

function decodeCtc(tensor, characters) {
  const { timeSteps, classCount, readLogit } = outputReader(tensor)
  const parts = []
  const probabilities = []
  let previousIndex = -1

  for (let t = 0; t < timeSteps; t += 1) {
    let maxIndex = 0
    let maxValue = -Infinity
    let sumExp = 0

    for (let c = 0; c < classCount; c += 1) {
      const value = readLogit(t, c)
      if (value > maxValue) {
        maxValue = value
        maxIndex = c
      }
    }

    for (let c = 0; c < classCount; c += 1) {
      sumExp += Math.exp(readLogit(t, c) - maxValue)
    }

    const probability = 1 / Math.max(sumExp, Number.EPSILON)
    if (maxIndex !== 0 && maxIndex !== previousIndex) {
      parts.push(characters[maxIndex] || '')
      probabilities.push(probability)
    }
    previousIndex = maxIndex
  }

  return {
    text: parts.join('').trim(),
    confidence: probabilities.length ? average(probabilities) : 0,
  }
}

function outputReader(tensor) {
  const dims = tensor.dims
  const data = tensor.data

  if (dims.length !== 3) {
    throw new Error(`Unsupported PaddleOCR output shape: [${dims.join(', ')}]`)
  }

  if (dims[0] === 1) {
    const timeSteps = dims[1]
    const classCount = dims[2]
    return {
      timeSteps,
      classCount,
      readLogit: (t, c) => data[t * classCount + c],
    }
  }

  if (dims[1] === 1) {
    const timeSteps = dims[0]
    const classCount = dims[2]
    return {
      timeSteps,
      classCount,
      readLogit: (t, c) => data[t * classCount + c],
    }
  }

  throw new Error(`Unsupported PaddleOCR output shape: [${dims.join(', ')}]`)
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

module.exports = {
  PaddleOcrRecognizer,
}
