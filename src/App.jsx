import React, { useEffect, useMemo, useState } from 'react'
import { Activity, Boxes, Brain, Database, RefreshCw, Search, Sparkles, Swords, Target, Zap } from 'lucide-react'
import { CalibrationApp } from './CalibrationApp.jsx'
import { augmentIconUrl, itemIconUrl, loadMayhemChampion, loadStaticData } from './lib/api.js'
import { buildCoachInsights } from './lib/coach.js'
import { buildRecommendations } from './lib/recommendation.js'
import { formatCount, formatPercent, normalizeSearchText } from './lib/format.js'
import { candidateIds, recognitionStatus, resolveCandidateAugments } from './lib/realtime.js'

const DEFAULT_CHAMPION_ID = 777
const DEFAULT_RECOGNITION_INPUT = '秘术冲拳\n质变：棱彩阶\n会心治疗'

export function App() {
  const overlayMode = isOverlayMode()
  const calibrationMode = isCalibrationMode()
  const [staticData, setStaticData] = useState(null)
  const [selectedChampionId, setSelectedChampionId] = useState(getInitialChampionId)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [row, setRow] = useState(null)
  const [query, setQuery] = useState('')
  const [recognitionInput, setRecognitionInput] = useState(getInitialRecognitionInput)
  const [runtimeState, setRuntimeState] = useState({})
  const [staticLoading, setStaticLoading] = useState(true)
  const [championLoading, setChampionLoading] = useState(true)
  const [error, setError] = useState('')
  const loading = staticLoading || championLoading

  useEffect(() => {
    document.body.classList.toggle('overlay-body', overlayMode)
    return () => document.body.classList.remove('overlay-body')
  }, [overlayMode])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.openHexAssistant?.onRealtimeState) return undefined

    return window.openHexAssistant.onRealtimeState((state) => {
      if (!state || typeof state !== 'object') return
      setRuntimeState(state)

      const championId = Number(state.championId ?? state.champion_id)
      if (Number.isFinite(championId) && championId > 0) {
        setSelectedChampionId(championId)
      }

      const candidates = state.candidates ?? state.augments ?? state.text
      if (Array.isArray(candidates)) {
        setRecognitionInput(candidates.join('\n'))
      } else if (typeof candidates === 'string') {
        setRecognitionInput(candidates.replace(/[|｜,，;；/]/g, '\n'))
      }
    })
  }, [])

  useEffect(() => {
    if (calibrationMode) return undefined
    const controller = new AbortController()
    setStaticLoading(true)
    loadStaticData(controller.signal)
      .then(setStaticData)
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err.message || String(err))
      })
      .finally(() => {
        if (!controller.signal.aborted) setStaticLoading(false)
      })
    return () => controller.abort()
  }, [calibrationMode])

  useEffect(() => {
    if (calibrationMode) return undefined
    if (!selectedChampionId) return
    const controller = new AbortController()
    setChampionLoading(true)
    setError('')
    loadMayhemChampion(selectedChampionId, controller.signal)
      .then(setRow)
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err.message || String(err))
      })
      .finally(() => {
        if (!controller.signal.aborted) setChampionLoading(false)
      })
    return () => controller.abort()
  }, [calibrationMode, selectedChampionId, refreshNonce])

  const selectedChampion = staticData?.championsById[selectedChampionId]
  const recognizedCandidates = useMemo(() => (
    resolveCandidateAugments(recognitionInput, staticData?.augments ?? {})
  ), [recognitionInput, staticData])
  const candidateAugmentIds = useMemo(() => candidateIds(recognizedCandidates), [recognizedCandidates])
  const recommendation = useMemo(() => {
    if (!staticData || !row) return null
    return buildRecommendations(row, staticData, candidateAugmentIds)
  }, [staticData, row, candidateAugmentIds])
  const coachInsights = useMemo(() => (
    buildCoachInsights(runtimeState?.coach, staticData, recommendation)
  ), [runtimeState, staticData, recommendation])

  const champions = useMemo(() => {
    const needle = normalizeSearchText(query)
    const list = staticData?.championList ?? []
    if (!needle) return list.slice(0, 24)
    return list
      .filter((champion) => {
        const haystack = normalizeSearchText(`${champion.id}${champion.name}${champion.title}${champion.alias}`)
        return haystack.includes(needle)
      })
      .slice(0, 36)
  }, [query, staticData])

  if (calibrationMode) {
    return <CalibrationApp />
  }

  if (overlayMode) {
    return (
      <OverlayShell
        selectedChampion={selectedChampion}
        selectedChampionId={selectedChampionId}
        recommendation={recommendation}
        recognizedCandidates={recognizedCandidates}
        loading={loading}
        error={error}
        staticData={staticData}
        runtimeState={runtimeState}
        coachInsights={coachInsights}
      />
    )
  }

  const toggleCandidate = (id) => {
    const current = candidateAugmentIds
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id].slice(-3)
    setRecognitionInput(next.join(' '))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">
          <Swords size={22} />
        </div>
        <div>
          <div className="eyebrow">Open Hex Assistant</div>
          <h1>海克斯大乱斗推荐台</h1>
        </div>
        <div className="topbar-status">
          <Database size={16} />
          <span>{recommendation ? `Patch ${recommendation.patch}` : staticData ? `DDragon ${staticData.version}` : 'Loading'}</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="side-panel">
          <div className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索英雄" />
          </div>

          <div className="champion-grid">
            {champions.map((champion) => (
              <button
                type="button"
                key={champion.id}
                className={`champion-button${champion.id === selectedChampionId ? ' is-active' : ''}`}
                onClick={() => setSelectedChampionId(champion.id)}
              >
                <img src={champion.image} alt="" />
                <span>{champion.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="content-panel">
          <div className="hero-strip">
            <div className="champion-title">
              {selectedChampion?.image && <img className="champion-portrait" src={selectedChampion.image} alt="" />}
              <div>
                <div className="eyebrow">KIWI / ARAM Mayhem</div>
                <h2>{selectedChampion ? `${selectedChampion.name} ${selectedChampion.title}` : `英雄 ${selectedChampionId}`}</h2>
                <div className="metric-row">
                  <Metric label="胜率" value={formatPercent(recommendation?.baselineWinRate)} />
                  <Metric label="样本" value={formatCount(recommendation?.games)} />
                  <Metric label="登场" value={formatPercent(recommendation?.pickRate)} />
                  <Metric label="Tier" value={recommendation?.championTier ?? '-'} />
                </div>
              </div>
            </div>
            <button className="icon-button" type="button" onClick={() => setRefreshNonce((value) => value + 1)} disabled={loading}>
              <RefreshCw size={16} />
            </button>
          </div>

          {error && <div className="alert">{error}</div>}

          {coachInsights && <CoachPanel coach={coachInsights} />}

          <section className="recognition-panel">
            <div className="recognition-header">
              <div>
                <div className="eyebrow">Realtime Selection</div>
                <h3>实时海克斯识别入口</h3>
              </div>
              <span>{recognitionStatus(recognitionInput, recognizedCandidates)}</span>
            </div>
            <textarea
              value={recognitionInput}
              onChange={(event) => setRecognitionInput(event.target.value)}
              placeholder="粘贴 OCR 文本、海克斯中文名或 ID，每行一个"
            />
            <div className="recognized-row">
              <span>{candidateAugmentIds.length}/3</span>
              {recognizedCandidates.map((candidate) => (
                <button type="button" key={candidate.id} onClick={() => toggleCandidate(candidate.id)}>
                  {candidate.name}
                  <small>{Math.round(candidate.confidence * 100)}%</small>
                </button>
              ))}
            </div>
          </section>

          <div className="dashboard-grid">
            <RecommendationSection
              icon={<Boxes size={18} />}
              title="常规核心"
              items={recommendation?.coreItems ?? []}
              renderItem={(item) => <ItemCard item={item} staticData={staticData} />}
              empty={loading ? '正在加载' : '暂无数据'}
            />
            <RecommendationSection
              icon={<Zap size={18} />}
              title="流派爆点"
              items={recommendation?.spikeItems ?? []}
              renderItem={(item) => <ItemCard item={item} staticData={staticData} accent />}
              empty={loading ? '正在加载' : '暂无数据'}
            />
          </div>

          <RecommendationSection
            icon={<Activity size={18} />}
            title={candidateAugmentIds.length ? '本轮候选' : '海克斯优先级'}
            items={recommendation?.candidateAugments ?? []}
            renderItem={(augment) => (
              <AugmentCard
                augment={augment}
                selected={candidateAugmentIds.includes(augment.id)}
                onClick={() => toggleCandidate(augment.id)}
                staticData={staticData}
              />
            )}
            empty={loading ? '正在加载' : '暂无数据'}
            gridClassName="augment-grid"
          />

          <RecommendationSection
            icon={<Sparkles size={18} />}
            title="海克斯池"
            items={recommendation?.augments ?? []}
            renderItem={(augment) => (
              <AugmentCard
                augment={augment}
                selected={candidateAugmentIds.includes(augment.id)}
                onClick={() => toggleCandidate(augment.id)}
                staticData={staticData}
                compact
              />
            )}
            empty={loading ? '正在加载' : '暂无数据'}
            gridClassName="augment-grid compact"
          />
        </section>
      </section>
    </main>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function RecommendationSection({ icon, title, items, renderItem, empty, gridClassName = 'card-grid' }) {
  return (
    <section className="recommend-section">
      <div className="section-title">
        {icon}
        <h3>{title}</h3>
      </div>
      {items.length ? (
        <div className={gridClassName}>
          {items.map((item, index) => (
            <React.Fragment key={`${item.id ?? 'row'}-${index}`}>
              {renderItem(item)}
            </React.Fragment>
          ))}
        </div>
      ) : <div className="empty-state">{empty}</div>}
    </section>
  )
}

function CoachPanel({ coach, compact = false }) {
  const primaryPlan = coach.itemPlan[0] || coach.playbook[0]
  const threatLine = coach.threats?.[0]
    ? { label: '优先盯防', text: `${coach.threats[0].championName}：${coach.threats[0].threatReason}` }
    : null
  const tacticalLines = compact
    ? [threatLine, ...coach.playbook.slice(0, 1), ...coach.itemPlan.slice(0, 1)].filter(Boolean)
    : [...coach.playbook, ...coach.itemPlan].slice(0, 5)

  return (
    <section className={`coach-panel${compact ? ' is-compact' : ''}`}>
      <div className="coach-header">
        <div>
          <div className="eyebrow">{coach.sourceLabel} / {coach.phaseLabel}</div>
          <h3>{coach.headline}</h3>
        </div>
        <span>{coach.confidenceLabel}</span>
      </div>

      {primaryPlan && (
        <div className="coach-spotlight">
          <Brain size={18} />
          <p>{coach.matchup}</p>
        </div>
      )}

      <div className="coach-teams">
        <CoachTeam title="我方" players={coach.myTeam} />
        <CoachTeam title="敌方" players={coach.enemyTeam} />
      </div>

      <CoachScoreboard scoreboard={coach.scoreboard} compact={compact} />

      {!compact && coach.threats?.length > 0 && (
        <div className="coach-threats">
          {coach.threats.map((threat) => (
            <article key={`threat-${threat.slot}-${threat.championId || threat.championName}`}>
              {threat.image ? <img src={threat.image} alt="" /> : <em>{threat.championName.slice(0, 1)}</em>}
              <div>
                <strong>{threat.championName}</strong>
                <span>{threat.threatType}</span>
                <small>{threat.threatReason}</small>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="coach-lines">
        {tacticalLines.map((line, index) => (
          <div className="coach-line" key={`${line.label}-${index}`}>
            <strong>{line.label}</strong>
            <span>{line.text}</span>
          </div>
        ))}
      </div>

      {!compact && coach.augmentPlan.length > 0 && (
        <div className="coach-augment-plan">
          {coach.augmentPlan.map((line) => (
            <div key={line.label}>
              <Target size={14} />
              <span>{line.label}</span>
              <small>{line.text}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function CoachScoreboard({ scoreboard, compact }) {
  if (!scoreboard) return null
  const items = scoreboard.myItems?.length ? scoreboard.myItems.join(' / ') : ''
  const details = [
    scoreboard.gameTime > 0 ? formatGameTime(scoreboard.gameTime) : '',
    scoreboard.myLevel > 0 ? `Lv.${scoreboard.myLevel}` : '',
    items,
  ].filter(Boolean)

  if (!details.length && compact) return null

  return (
    <div className="coach-scoreboard">
      <span>{details.length ? details.join(' · ') : '等待局内装备数据'}</span>
      {!compact && (
        <small>已知装备：我方 {scoreboard.allyKnownItems} / 敌方 {scoreboard.enemyKnownItems}</small>
      )}
    </div>
  )
}

function CoachTeam({ title, players }) {
  return (
    <div className="coach-team">
      <span>{title}</span>
      <div>
        {players.slice(0, 5).map((player) => (
          player.image
            ? <img key={`${title}-${player.slot}-${player.championId}`} src={player.image} title={player.championName} alt="" />
            : <em key={`${title}-${player.slot}-${player.championId}`}>{player.championName.slice(0, 1)}</em>
        ))}
      </div>
    </div>
  )
}

function formatGameTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)))
  const minutes = Math.floor(total / 60)
  const rest = String(total % 60).padStart(2, '0')
  return `${minutes}:${rest}`
}

function ItemCard({ item, staticData, accent = false }) {
  const data = staticData?.items[String(item.id)]
  return (
    <article className={`item-card${accent ? ' is-accent' : ''}`} key={item.id}>
      <img src={itemIconUrl(staticData?.version, item.id, data)} alt="" />
      <div>
        <h4>{item.name}</h4>
        <div className="stat-line">
          <span>{formatPercent(item.winRate)}</span>
          <span>{formatPercent(item.pickRate)}</span>
          <span>{formatCount(item.games)}场</span>
        </div>
      </div>
      <strong>{item.score.toFixed(1)}</strong>
    </article>
  )
}

function AugmentCard({ augment, selected, onClick, staticData, compact = false }) {
  const meta = staticData?.augments[String(augment.id)]
  const icon = augmentIconUrl(meta)
  return (
    <button type="button" className={`augment-card rarity-${augment.rarity}${selected ? ' is-selected' : ''}${compact ? ' is-compact' : ''}`} onClick={onClick}>
      {icon ? <img src={icon} alt="" /> : <span className="augment-fallback">{augment.id}</span>}
      <span className="augment-body">
        <span className="augment-name-row">
          <strong>{augment.name}</strong>
          <em className={`grade-badge grade-${augment.grade?.toLowerCase().replace('+', 'plus')}`}>{augment.grade}</em>
        </span>
        <small>{formatPercent(augment.winRate)} · {formatCount(augment.games)}场 · #{augment.tier}</small>
        {!compact && <small className="augment-reason">{augment.reason}</small>}
      </span>
    </button>
  )
}

function OverlayShell({ selectedChampion, selectedChampionId, recommendation, recognizedCandidates, loading, error, staticData, runtimeState, coachInsights }) {
  const candidateAugments = recommendation?.candidateAugments?.slice(0, 3) ?? []
  const ocr = runtimeState?.ocr
  const ocrStatus = ocr?.elapsedMs ? `OCR ${ocr.elapsedMs}ms${ocr.withinTarget === false ? ' 超时' : ''}` : ''
  const ocrPhaseStatus = ocrPhaseLabel(ocr)
  const emptyMessage = loading ? '正在加载英雄与海克斯数据' : ocrPhaseStatus || '没有匹配到候选海克斯'
  const status = runtimeState?.error || error || (
    loading
      ? '同步公开统计中'
      : [ocrStatus || ocrPhaseStatus, recognizedCandidates.length ? `已识别 ${recognizedCandidates.length}/3` : '等待候选识别'].filter(Boolean).join(' · ')
  )

  return (
    <main className="overlay-root">
      <section className="overlay-panel" aria-label="Open Hex Assistant overlay">
        <header className="overlay-header">
          <div className="overlay-champion">
            {selectedChampion?.image && <img src={selectedChampion.image} alt="" />}
            <div>
              <div className="overlay-kicker">Open Hex Assistant</div>
              <h1>{selectedChampion?.name || `英雄 ${selectedChampionId}`}</h1>
            </div>
          </div>
          <div className="overlay-meta">
            <strong>{recommendation ? `Patch ${recommendation.patch}` : staticData ? `DDragon ${staticData.version}` : 'Loading'}</strong>
            <span>{status}</span>
          </div>
        </header>

        {runtimeState?.error || error ? (
          <div className="overlay-message is-error">{runtimeState?.error || error}</div>
        ) : candidateAugments.length ? (
          <div className="overlay-list">
            {candidateAugments.map((augment, index) => (
              <OverlayAugment key={augment.id} augment={augment} rank={index + 1} staticData={staticData} />
            ))}
          </div>
        ) : (
          <div className="overlay-message">{emptyMessage}</div>
        )}

        {coachInsights && <CoachPanel coach={coachInsights} compact />}
      </section>
    </main>
  )
}

function ocrPhaseLabel(ocr) {
  if (!ocr?.phase) return ''
  if (ocr.phase === 'lcu-disconnected') return '等待 League Client'
  if (ocr.phase === 'lcu-waiting') return `等待游戏中${ocr.lcu?.phase ? ` (${ocr.lcu.phase})` : ''}`
  if (ocr.phase === 'hotkey-unavailable') return 'OCR 未启动'
  if (ocr.phase === 'idle') return '等待 LoL 游戏启动'
  if (ocr.phase === 'game-running') return '等待海克斯选择'
  if (ocr.phase === 'hero-refreshed') return `英雄已刷新${ocr.lcu?.championSource ? ` (${ocr.lcu.championSource})` : ''}`
  if (ocr.phase === 'reset') return '已重置，等待海克斯选择'
  if (ocr.phase === 'augment-pick-active') return '海克斯选择已触发'
  if (ocr.phase === 'coach-refreshed') return '战术已重评估'
  if (ocr.phase === 'error') return 'OCR 异常'
  return ''
}

function OverlayAugment({ augment, rank, staticData }) {
  const meta = staticData?.augments[String(augment.id)]
  const icon = augmentIconUrl(meta)

  return (
    <article className={`overlay-augment rarity-${augment.rarity}`}>
      <div className="overlay-rank">#{rank}</div>
      {icon ? <img src={icon} alt="" /> : <span className="augment-fallback">{augment.id}</span>}
      <div className="overlay-augment-body">
        <div className="overlay-name-row">
          <h2>{augment.name}</h2>
          <em className={`grade-badge grade-${augment.grade?.toLowerCase().replace('+', 'plus')}`}>{augment.grade}</em>
        </div>
        <p>{augment.reason}</p>
        <div className="overlay-stats">
          <span>{formatPercent(augment.winRate)} 胜率</span>
          <span>{formatCount(augment.games)} 场</span>
          <span>Tier {augment.tier}</span>
        </div>
      </div>
    </article>
  )
}

function getInitialChampionId() {
  const params = getSearchParams()
  const value = Number(params.get('champion') || params.get('champion_id'))
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CHAMPION_ID
}

function getInitialRecognitionInput() {
  const params = getSearchParams()
  const value = params.get('candidates') || params.get('augments')
  if (!value) return DEFAULT_RECOGNITION_INPUT
  return value.replace(/[|｜,，;；/]/g, '\n')
}

function isOverlayMode() {
  if (typeof window === 'undefined') return false
  const params = getSearchParams()
  return params.get('overlay') === '1' || window.location.hash.includes('overlay')
}

function isCalibrationMode() {
  if (typeof window === 'undefined') return false
  const params = getSearchParams()
  return params.get('calibrate') === '1' || window.location.hash.includes('calibrate')
}

function getSearchParams() {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}
