import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODEL_DIR = join(ROOT, 'models', 'paddleocr')
const VENV_DIR = join(ROOT, '.venv-paddleocr')

const MODEL_URL = 'https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_rec_infer.tar'
const MODEL_ONNX_URL = 'https://huggingface.co/Desperado-JT/CH-PP-OCRv4/resolve/main/ch_PP-OCRv4_rec_infer.onnx'
const DICT_URL = 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt'
const MODEL_ONNX_SHA256 = '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b'
const DICT_SHA256 = 'a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492'

const MODEL_TAR = join(MODEL_DIR, 'ch_PP-OCRv4_rec_infer.tar')
const MODEL_INFER_DIR = join(MODEL_DIR, 'ch_PP-OCRv4_rec_infer')
const MODEL_ONNX = join(MODEL_DIR, 'ch_PP-OCRv4_rec_infer.onnx')
const DICT_FILE = join(MODEL_DIR, 'ppocr_keys_v1.txt')

const PYTHON_EXE = process.platform === 'win32'
  ? join(VENV_DIR, 'Scripts', 'python.exe')
  : join(VENV_DIR, 'bin', 'python')
const PADDLE2ONNX_EXE = process.platform === 'win32'
  ? join(VENV_DIR, 'Scripts', 'paddle2onnx.exe')
  : join(VENV_DIR, 'bin', 'paddle2onnx')

async function main() {
  mkdirSync(MODEL_DIR, { recursive: true })

  await downloadIfMissing(DICT_URL, DICT_FILE, DICT_SHA256)
  await prepareOnnxModel()

  console.log('\nPaddleOCR model files are ready:')
  console.log(`- ${MODEL_ONNX}`)
  console.log(`- ${DICT_FILE}`)
}

async function prepareOnnxModel() {
  if (existsSync(MODEL_ONNX)) {
    verifySha256(MODEL_ONNX, MODEL_ONNX_SHA256)
    console.log(`skip existing ${relative(MODEL_ONNX)}`)
    return
  }

  if (process.env.PREPARE_PADDLEOCR_CONVERT !== '1') {
    await downloadIfMissing(MODEL_ONNX_URL, MODEL_ONNX, MODEL_ONNX_SHA256)
    return
  }

  await downloadIfMissing(MODEL_URL, MODEL_TAR)

  if (!existsSync(join(MODEL_INFER_DIR, 'inference.pdmodel'))) {
    run('tar', ['-xf', MODEL_TAR, '-C', MODEL_DIR])
  }

  ensureUvVenv()
  installConverter()
  convertModel()
}

async function downloadIfMissing(url, target, expectedSha256 = '') {
  if (existsSync(target)) {
    if (expectedSha256) verifySha256(target, expectedSha256)
    console.log(`skip existing ${relative(target)}`)
    return
  }

  console.log(`download ${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed ${response.status} ${response.statusText}: ${url}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
  if (expectedSha256) verifySha256(target, expectedSha256)
  console.log(`wrote ${relative(target)} (${bytes.length} bytes)`)
}

function verifySha256(target, expected) {
  const actual = createHash('sha256').update(readFileSync(target)).digest('hex')
  if (actual !== expected) {
    throw new Error(`SHA256 mismatch for ${relative(target)}: expected ${expected}, got ${actual}`)
  }
}

function ensureUvVenv() {
  if (existsSync(PYTHON_EXE)) {
    console.log(`skip existing ${relative(VENV_DIR)}`)
    return
  }

  run('uv', ['venv', VENV_DIR, '--python', '3.11'])
}

function installConverter() {
  run('uv', ['pip', 'install', '--python', PYTHON_EXE, 'paddlepaddle', 'paddle2onnx', 'onnxruntime'])
}

function convertModel() {
  if (existsSync(MODEL_ONNX)) {
    console.log(`skip existing ${relative(MODEL_ONNX)}`)
    return
  }

  run(PADDLE2ONNX_EXE, [
    '--model_dir', MODEL_INFER_DIR,
    '--model_filename', 'inference.pdmodel',
    '--params_filename', 'inference.pdiparams',
    '--save_file', MODEL_ONNX,
    '--opset_version', '11',
    '--enable_onnx_checker', 'True',
  ])
}

function run(command, args) {
  console.log(`\n> ${[command, ...args].map(shellWord).join(' ')}`)
  execFileSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
  })
}

function relative(pathname) {
  return pathname.replace(`${ROOT}/`, '')
}

function shellWord(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
