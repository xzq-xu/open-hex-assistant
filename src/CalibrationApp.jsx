import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Crosshair, MousePointer2, RefreshCw, Save, SlidersHorizontal } from 'lucide-react'
import {
  cardLabel,
  clamp,
  DEFAULT_CALIBRATION_CONFIG,
  formatRoi,
  normalizeCalibrationConfig,
  normalizeRoi,
  roiToStyle,
  updateCardRoi,
} from './lib/calibration.js'

export function CalibrationApp() {
  const stageRef = useRef(null)
  const [config, setConfig] = useState(() => normalizeCalibrationConfig(DEFAULT_CALIBRATION_CONFIG))
  const [image, setImage] = useState(null)
  const [screen, setScreen] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [drag, setDrag] = useState(null)
  const [status, setStatus] = useState('')
  const api = typeof window !== 'undefined' ? window.openHexAssistant : null

  const cards = config.capture.cards
  const selectedCard = cards[selectedIndex]
  const electronReady = Boolean(api?.captureCalibrationScreen && api?.loadOcrConfig && api?.saveOcrConfig)

  useEffect(() => {
    let cancelled = false
    if (!api?.loadOcrConfig) return undefined

    api.loadOcrConfig()
      .then((result) => {
        if (cancelled) return
        setConfig(normalizeCalibrationConfig(result.config))
        setStatus(`已读取配置 ${result.path}`)
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message || String(error))
      })

    return () => {
      cancelled = true
    }
  }, [api])

  const capture = async () => {
    if (!api?.captureCalibrationScreen) {
      setStatus('校准截屏需要通过 Electron 启动')
      return
    }

    setStatus('正在截取屏幕')
    try {
      const result = await api.captureCalibrationScreen()
      setConfig(normalizeCalibrationConfig(result.config))
      setImage(result.image)
      setScreen(result.screen)
      setStatus(`已截取 ${result.screen.width}x${result.screen.height}`)
    } catch (error) {
      setStatus(error.message || String(error))
    }
  }

  const save = async () => {
    if (!api?.saveOcrConfig) {
      setStatus('保存配置需要通过 Electron 启动')
      return
    }

    setStatus('正在保存配置')
    try {
      const result = await api.saveOcrConfig(config)
      setConfig(normalizeCalibrationConfig(result.config))
      setStatus(`已保存 ${result.path}`)
    } catch (error) {
      setStatus(error.message || String(error))
    }
  }

  const beginDrag = (event, index, mode) => {
    event.preventDefault()

    const stage = stageRef.current
    const rect = stage?.getBoundingClientRect()
    if (!stage || !rect) return

    stage.setPointerCapture(event.pointerId)

    setSelectedIndex(index)
    setDrag({
      pointerId: event.pointerId,
      index,
      mode,
      startX: (event.clientX - rect.left) / rect.width,
      startY: (event.clientY - rect.top) / rect.height,
      roi: cards[index].titleRoi,
    })
  }

  const updateDrag = (event) => {
    if (!drag) return

    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return

    const currentX = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const currentY = clamp((event.clientY - rect.top) / rect.height, 0, 1)
    const deltaX = currentX - drag.startX
    const deltaY = currentY - drag.startY
    const nextRoi = drag.mode === 'resize'
      ? resizeRoi(drag.roi, deltaX, deltaY)
      : moveRoi(drag.roi, deltaX, deltaY)

    setConfig((value) => updateCardRoi(value, drag.index, nextRoi))
  }

  const endDrag = (event) => {
    if (drag?.pointerId != null && event?.currentTarget?.hasPointerCapture?.(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId)
    }
    setDrag(null)
  }

  const updateSelectedRoiField = (field, value) => {
    const next = {
      ...selectedCard.titleRoi,
      [field]: Number(value) / 100,
    }
    setConfig((current) => updateCardRoi(current, selectedIndex, next))
  }

  const roiSummary = useMemo(() => cards.map((card) => ({
    name: card.name,
    label: cardLabel(card.name),
    roi: card.titleRoi,
  })), [cards])

  return (
    <main className="calibration-shell">
      <header className="topbar calibration-topbar">
        <div className="brand-mark">
          <Crosshair size={22} />
        </div>
        <div>
          <div className="eyebrow">Open Hex Assistant</div>
          <h1>OCR 标题区域校准</h1>
        </div>
        <div className="topbar-status">
          <SlidersHorizontal size={16} />
          <span>{electronReady ? 'Electron calibration' : 'Browser preview'}</span>
        </div>
      </header>

      <section className="calibration-workspace">
        <section className="calibration-stage-panel">
          <div className="calibration-toolbar">
            <button type="button" onClick={capture}>
              <Camera size={16} />
              <span>截取屏幕</span>
            </button>
            <button type="button" onClick={save}>
              <Save size={16} />
              <span>保存配置</span>
            </button>
            <button type="button" onClick={() => setConfig(normalizeCalibrationConfig(config))}>
              <RefreshCw size={16} />
              <span>规整数值</span>
            </button>
            <span className="calibration-status">{status || '拖动框移动区域，拖右下角调整大小'}</span>
          </div>

          <div
            ref={stageRef}
            className="calibration-stage"
            onPointerMove={updateDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {image ? (
              <img src={image} alt="" draggable={false} />
            ) : (
              <div className="calibration-placeholder">
                <MousePointer2 size={26} />
                <strong>等待截屏</strong>
                <span>用 Electron 校准模式启动后点击“截取屏幕”</span>
              </div>
            )}

            {roiSummary.map((card, index) => (
              <div
                role="button"
                tabIndex={0}
                key={card.name}
                className={`roi-box${index === selectedIndex ? ' is-selected' : ''}`}
                style={roiToStyle(card.roi)}
                onPointerDown={(event) => beginDrag(event, index, 'move')}
              >
                <span>{card.label}</span>
                <small>{formatRoi(card.roi)}</small>
                <i
                  aria-hidden="true"
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    beginDrag(event, index, 'resize')
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        <aside className="calibration-panel">
          <div className="section-title">
            <SlidersHorizontal size={18} />
            <h2>区域参数</h2>
          </div>

          <div className="roi-selector">
            {cards.map((card, index) => (
              <button
                type="button"
                key={card.name}
                className={index === selectedIndex ? 'is-active' : ''}
                onClick={() => setSelectedIndex(index)}
              >
                {cardLabel(card.name)}
              </button>
            ))}
          </div>

          <div className="roi-fields">
            {['x', 'y', 'width', 'height'].map((field) => (
              <label key={field}>
                <span>{field}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={(selectedCard.titleRoi[field] * 100).toFixed(2)}
                  onChange={(event) => updateSelectedRoiField(field, event.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="calibration-readout">
            <strong>{selectedCard ? cardLabel(selectedCard.name) : '-'}</strong>
            <span>{selectedCard ? formatRoi(selectedCard.titleRoi) : '-'}</span>
            <span>{screen ? `截图 ${screen.width}x${screen.height}` : '尚未截取屏幕'}</span>
          </div>

          <div className="calibration-note">
            只框住三张海克斯卡片的标题文字，不要包含图标和描述。范围越小，OCR 越快，误识别越少。
          </div>
        </aside>
      </section>
    </main>
  )
}

function moveRoi(roi, deltaX, deltaY) {
  return normalizeRoi({
    ...roi,
    x: clamp(roi.x + deltaX, 0, 1 - roi.width),
    y: clamp(roi.y + deltaY, 0, 1 - roi.height),
  })
}

function resizeRoi(roi, deltaX, deltaY) {
  return normalizeRoi({
    ...roi,
    width: clamp(roi.width + deltaX, 0.01, 1 - roi.x),
    height: clamp(roi.height + deltaY, 0.01, 1 - roi.y),
  })
}
