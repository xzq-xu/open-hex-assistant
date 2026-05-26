const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('openHexAssistant', {
  captureCalibrationScreen() {
    return ipcRenderer.invoke('calibration:capture-screen')
  },
  loadOcrConfig() {
    return ipcRenderer.invoke('calibration:load-config')
  },
  onRealtimeState(callback) {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('overlay:state', handler)
    return () => ipcRenderer.removeListener('overlay:state', handler)
  },
  saveOcrConfig(config) {
    return ipcRenderer.invoke('calibration:save-config', config)
  },
})
