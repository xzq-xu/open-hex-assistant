import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

const REQUIRED_FILES = [
  'dist/index.html',
  'electron/main.cjs',
  'electron/ocr-worker.cjs',
  'models/paddleocr/ch_PP-OCRv4_rec_infer.onnx',
  'models/paddleocr/ppocr_keys_v1.txt',
  'runtime/ocr-config.example.json',
]

const missing = REQUIRED_FILES.filter((file) => !existsSync(join(ROOT, file)))
if (missing.length) {
  console.error('Missing required package inputs:')
  missing.forEach((file) => console.error(`- ${file}`))
  console.error('\nRun `npm run ocr:models` and `npm run build` before packaging.')
  process.exit(1)
}

if (process.platform !== 'win32') {
  console.warn('[package] Windows packages should be built on Windows CI or a Windows machine because native OCR/capture dependencies are platform-specific.')
}

console.log('Package inputs are ready.')
