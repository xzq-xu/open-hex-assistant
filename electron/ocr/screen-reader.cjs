const fs = require('node:fs')
const path = require('node:path')
const screenshot = require('screenshot-desktop')
const sharp = require('sharp')

async function captureScreen(displayIndex = 0) {
  const options = { format: 'png' }
  if (Number.isInteger(displayIndex) && displayIndex > 0) {
    options.screen = displayIndex
  }
  return screenshot(options)
}

async function cropRegions(imageBuffer, regions, debugDir = '') {
  const image = sharp(imageBuffer).rotate()
  const metadata = await image.metadata()
  const screen = {
    width: metadata.width || 0,
    height: metadata.height || 0,
  }

  const crops = []
  for (const region of regions) {
    const roi = toPixelRoi(region.titleRoi || region.roi || region, screen)
    const buffer = await sharp(imageBuffer)
      .rotate()
      .extract(roi)
      .png()
      .toBuffer()

    crops.push({
      name: region.name || `region-${crops.length + 1}`,
      roi,
      buffer,
    })
  }

  if (debugDir) {
    fs.mkdirSync(debugDir, { recursive: true })
    await Promise.all(crops.map((crop, index) => (
      fs.promises.writeFile(path.join(debugDir, `${String(index + 1).padStart(2, '0')}-${crop.name}.png`), crop.buffer)
    )))
  }

  return { screen, crops }
}

function toPixelRoi(region, screen) {
  const unit = region.unit || 'ratio'
  const ratio = unit === 'ratio'
  const width = ratio ? Math.round(region.width * screen.width) : Math.round(region.width)
  const height = ratio ? Math.round(region.height * screen.height) : Math.round(region.height)
  const x = ratio ? Math.round(region.x * screen.width) : Math.round(region.x)
  const y = ratio ? Math.round(region.y * screen.height) : Math.round(region.y)

  const clampedX = clamp(x, 0, Math.max(0, screen.width - 1))
  const clampedY = clamp(y, 0, Math.max(0, screen.height - 1))
  const clampedWidth = clamp(width, 1, Math.max(1, screen.width - clampedX))
  const clampedHeight = clamp(height, 1, Math.max(1, screen.height - clampedY))

  return {
    left: clampedX,
    top: clampedY,
    width: clampedWidth,
    height: clampedHeight,
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

module.exports = {
  captureScreen,
  cropRegions,
  toPixelRoi,
}
