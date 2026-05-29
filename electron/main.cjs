const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const sharp = require('sharp')
const { loadOcrConfig, ocrConfigPath, saveOcrConfig } = require('./ocr/config.cjs')
const { captureScreen } = require('./ocr/screen-reader.cjs')

let overlayWindow = null
let clickThrough = process.env.OVERLAY_CLICK_THROUGH !== '0'
let latestOcrState = {}
let ocrWorker = null

function appMode() {
  return process.env.APP_MODE === 'calibrate' ? 'calibrate' : 'overlay'
}

function isCalibrationMode() {
  return appMode() === 'calibrate'
}

function addAppParams(baseUrl) {
  const url = new URL(baseUrl)
  url.searchParams.set(isCalibrationMode() ? 'calibrate' : 'overlay', '1')

  if (process.env.OVERLAY_CHAMPION) {
    url.searchParams.set('champion', process.env.OVERLAY_CHAMPION)
  }

  if (process.env.OVERLAY_CANDIDATES) {
    url.searchParams.set('candidates', process.env.OVERLAY_CANDIDATES)
  }

  return url.toString()
}

function appUrl() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return addAppParams(process.env.VITE_DEV_SERVER_URL)
  }

  const indexUrl = pathToFileURL(path.join(appRoot(), 'dist', 'index.html')).toString()
  return addAppParams(indexUrl)
}

function runtimeStateFromEnv() {
  const state = {}
  if (process.env.OVERLAY_CHAMPION) state.championId = Number(process.env.OVERLAY_CHAMPION)
  if (process.env.OVERLAY_CANDIDATES) state.candidates = process.env.OVERLAY_CANDIDATES
  return state
}

function readStateFile() {
  const stateFile = process.env.OVERLAY_STATE_FILE
  if (!stateFile) return {}

  try {
    if (!fs.existsSync(stateFile)) return {}
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch (error) {
    return { error: `状态文件读取失败: ${error.message}` }
  }
}

function currentRuntimeState() {
  return {
    ...runtimeStateFromEnv(),
    ...readStateFile(),
    ...latestOcrState,
  }
}

function pushRuntimeState() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.webContents.send('overlay:state', currentRuntimeState())
}

function startStateFileWatcher() {
  const stateFile = process.env.OVERLAY_STATE_FILE
  if (!stateFile) return

  fs.watchFile(stateFile, { interval: 500 }, pushRuntimeState)
}

function startOcrWorker() {
  if (!ocrEnabled()) return

  const workerRuntime = ocrWorkerRuntime()
  const workerPath = path.join(appRoot(), 'electron', 'ocr-worker.cjs')
  ocrWorker = spawn(workerRuntime.command, [workerPath], {
    cwd: workerCwd(),
    env: workerRuntime.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stdoutBuffer = ''
  ocrWorker.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        latestOcrState = JSON.parse(line)
        pushRuntimeState()
      } catch (error) {
        console.warn(`[ocr] ignored invalid payload: ${error.message}`)
      }
    }
  })

  ocrWorker.stderr.on('data', (chunk) => {
    console.warn(chunk.toString('utf8').trimEnd())
  })

  ocrWorker.on('exit', (code, signal) => {
    latestOcrState = {
      ...latestOcrState,
      error: latestOcrState.error || `OCR worker exited: ${signal || code}`,
      ocr: {
        ...(latestOcrState.ocr || {}),
        ready: false,
      },
    }
    pushRuntimeState()
    ocrWorker = null
  })
}

function ocrEnabled() {
  if (isCalibrationMode()) return false
  if (process.env.OCR_ENABLED === '0') return false
  return app.isPackaged || process.env.OCR_ENABLED === '1'
}

function sendOcrCommand(type) {
  if (!ocrWorker || !ocrWorker.stdin?.writable) {
    latestOcrState = {
      ...latestOcrState,
      error: 'OCR worker is not running. Start with OCR_ENABLED=1 or use overlay:ocr:dev.',
      ocr: {
        ...(latestOcrState.ocr || {}),
        ready: false,
        phase: 'hotkey-unavailable',
      },
    }
    pushRuntimeState()
    return
  }

  ocrWorker.stdin.write(`${JSON.stringify({ type, requestedAt: new Date().toISOString() })}\n`)
}

function ocrWorkerRuntime() {
  if (process.env.OCR_NODE) {
    return {
      command: process.env.OCR_NODE,
      env: process.env,
    }
  }

  return {
    command: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPEN_HEX_APP_ROOT: appRoot(),
      OPEN_HEX_RESOURCE_ROOT: resourceRoot(),
      OPEN_HEX_USER_DATA: userDataRoot(),
    },
  }
}

function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.join(__dirname, '..')
}

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..')
}

function userDataRoot() {
  return app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..')
}

function workerCwd() {
  return app.isPackaged ? resourceRoot() : path.join(__dirname, '..')
}

function registerCalibrationIpc() {
  ipcMain.handle('calibration:load-config', () => ({
    config: loadOcrConfig(),
    path: ocrConfigPath(),
  }))

  ipcMain.handle('calibration:save-config', (_event, config) => saveOcrConfig(config))

  ipcMain.handle('calibration:capture-screen', async () => {
    const config = loadOcrConfig()
    const imageBuffer = await captureScreen(config.capture.display)
    const metadata = await sharp(imageBuffer).metadata()

    return {
      config,
      image: `data:image/png;base64,${imageBuffer.toString('base64')}`,
      screen: {
        width: metadata.width || 0,
        height: metadata.height || 0,
      },
    }
  })
}

function createOverlayWindow() {
  const calibration = isCalibrationMode()
  const display = screen.getPrimaryDisplay()
  const width = calibration ? Math.min(1180, display.workArea.width - 48) : 660
  const height = calibration ? Math.min(820, display.workArea.height - 48) : 460
  const x = display.workArea.x + 24
  const y = display.workArea.y + 24

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: calibration,
    transparent: !calibration,
    alwaysOnTop: !calibration,
    skipTaskbar: !calibration,
    resizable: calibration,
    fullscreenable: calibration,
    hasShadow: calibration,
    backgroundColor: calibration ? '#171411' : '#00000000',
    title: calibration ? 'Open Hex Assistant Calibration' : 'Open Hex Assistant Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (!calibration) {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlayWindow.setIgnoreMouseEvents(clickThrough, { forward: true })
  }

  overlayWindow.loadURL(appUrl())
  overlayWindow.webContents.once('did-finish-load', pushRuntimeState)

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function toggleClickThrough() {
  if (!overlayWindow) return
  clickThrough = !clickThrough
  overlayWindow.setIgnoreMouseEvents(clickThrough, { forward: true })
}

function registerShortcut(accelerator, handler) {
  const registered = globalShortcut.register(accelerator, handler)
  if (!registered) {
    console.warn(`[shortcut] failed to register ${accelerator}`)
  }
}

app.whenReady().then(() => {
  process.env.OPEN_HEX_APP_ROOT = appRoot()
  process.env.OPEN_HEX_RESOURCE_ROOT = resourceRoot()
  process.env.OPEN_HEX_USER_DATA = userDataRoot()

  registerCalibrationIpc()
  createOverlayWindow()
  startStateFileWatcher()
  startOcrWorker()

  registerShortcut('F6', () => sendOcrCommand('recognize-now'))
  registerShortcut('F7', () => sendOcrCommand('refresh-hero'))
  registerShortcut('F8', () => sendOcrCommand('reset'))
  registerShortcut('F9', () => sendOcrCommand('coach-now'))
  registerShortcut('CommandOrControl+Shift+O', toggleClickThrough)
  registerShortcut('CommandOrControl+Shift+R', () => {
    overlayWindow?.reload()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlayWindow()
  })
})

app.on('will-quit', () => {
  if (process.env.OVERLAY_STATE_FILE) fs.unwatchFile(process.env.OVERLAY_STATE_FILE)
  if (ocrWorker) ocrWorker.kill()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
