const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { toPixelRoi } = require('./screen-reader.cjs')

async function detectAugmentSelection(imageBuffer, config, debugDir = '') {
  const image = sharp(imageBuffer).rotate()
  const metadata = await image.metadata()
  const screen = {
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
  const cards = config.capture.cards
  const trigger = config.automation.trigger

  const samples = []
  for (const card of cards) {
    const titleRoi = toPixelRoi(card.titleRoi || card.roi || card, screen)
    const sample = await analyzeRegion(imageBuffer, titleRoi)
    samples.push({
      slot: card.name,
      roi: titleRoi,
      ...sample,
      score: scoreSample(sample, trigger),
    })
  }

  const activeCards = samples.filter((sample) => sample.score >= trigger.cardScoreThreshold)
  const averageScore = average(samples.map((sample) => sample.score))
  const active = activeCards.length >= trigger.minCards && averageScore >= trigger.minAverageScore

  const result = {
    active,
    score: round(averageScore, 3),
    activeCards: activeCards.length,
    minCards: trigger.minCards,
    samples: samples.map((sample) => ({
      slot: sample.slot,
      score: round(sample.score, 3),
      brightness: round(sample.brightness, 3),
      contrast: round(sample.contrast, 3),
      edgeDensity: round(sample.edgeDensity, 3),
      lightRatio: round(sample.lightRatio, 3),
      darkRatio: round(sample.darkRatio, 3),
      roi: sample.roi,
    })),
  }

  if (debugDir) {
    await writeDebug(debugDir, result)
  }

  return {
    screen,
    ...result,
  }
}

async function analyzeRegion(imageBuffer, roi) {
  const { data, info } = await sharp(imageBuffer)
    .rotate()
    .extract(roi)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const luminance = new Float32Array(info.width * info.height)
  let sum = 0
  let dark = 0
  let light = 0

  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * info.channels
    const value = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255
    luminance[index] = value
    sum += value
    if (value <= 0.22) dark += 1
    if (value >= 0.72) light += 1
  }

  const brightness = sum / Math.max(1, luminance.length)
  let variance = 0
  let edges = 0
  let edgeChecks = 0

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x
      const value = luminance[index]
      variance += (value - brightness) ** 2
      if (x > 0) {
        edgeChecks += 1
        if (Math.abs(value - luminance[index - 1]) >= 0.12) edges += 1
      }
      if (y > 0) {
        edgeChecks += 1
        if (Math.abs(value - luminance[index - info.width]) >= 0.12) edges += 1
      }
    }
  }

  return {
    brightness,
    contrast: Math.sqrt(variance / Math.max(1, luminance.length)),
    edgeDensity: edges / Math.max(1, edgeChecks),
    lightRatio: light / Math.max(1, luminance.length),
    darkRatio: dark / Math.max(1, luminance.length),
  }
}

function scoreSample(sample, trigger) {
  let score = 0
  score += normalize(sample.contrast, trigger.minContrast, trigger.strongContrast)
  score += normalize(sample.edgeDensity, trigger.minEdgeDensity, trigger.strongEdgeDensity)
  score += normalize(sample.lightRatio, trigger.minLightRatio, trigger.strongLightRatio) * 0.7
  score += normalize(sample.darkRatio, trigger.minDarkRatio, trigger.strongDarkRatio) * 0.5

  if (sample.brightness >= trigger.minBrightness && sample.brightness <= trigger.maxBrightness) {
    score += 0.25
  }

  return score
}

async function writeDebug(debugDir, result) {
  fs.mkdirSync(debugDir, { recursive: true })
  await fs.promises.writeFile(
    path.join(debugDir, 'augment-trigger.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  )
}

function normalize(value, min, max) {
  if (max <= min) return value >= min ? 1 : 0
  return clamp((value - min) / (max - min), 0, 1)
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(Number(value || 0) * factor) / factor
}

module.exports = {
  detectAugmentSelection,
}
