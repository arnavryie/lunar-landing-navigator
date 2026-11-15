import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_ARRAY,
  DEFAULT_THRESHOLDS,
  arrayEnergyWh,
  formatDuration,
  inAnalysisYear,
  loadArtemis,
  loadSite,
  loadSites,
  peakWatts,
  stateAt,
  viability,
  windowStats,
  getSiteScienceStats,
  type Region,
  type Site,
  type SiteSummary,
  type State,
  type Viability,
} from '../data'
import { ARTEMIS_3_SITES } from '../data/artemisData'
import { computeCustomPoint } from '../customPoint'
import {
  DEFAULT_ELLIPSE,
  computeSamples,
  judge,
  landingChance,
  verdictOf,
  VERDICT_LABEL,
  type Sample,
} from '../ellipseCheck'
import { ellipseSamples } from '../ellipseGeometry'
import { polarRowCol } from '../engine'
import { loadMapData, terrainAt, type MapData } from '../mapData'
import { DEFAULT_YEAR, loadVectors, loadYears, siteForYear } from '../years'
import { CesiumMoon, type CesiumMoonHandle, type EllipseDrawData, type ExplorerLayers } from './CesiumMoon'
import { LunarMap2D, type Map2DProjection } from './LunarMap2D'
import { MissionClock } from './MissionClock'
import {
  GLOBAL_LANDMARKS,
  approxDsnStation,
  formatUtcFull,
  instantFromVectors,
  interpolateSiteState,
  nearestArtemisDossier,
  nearestPsr,
  topocentricAzEl,
} from './moonMath'
import './moonExplorer.css'

type ExplorerMode = 'explore' | 'pipeline'
type ViewLayout = '3d' | '2d' | 'split'

interface PipelineStepMeta {
  step: number
  short: string
  title: string
  subtitle: string
}

const PIPELINE_STEPS: PipelineStepMeta[] = [
  { step: 1, short: 'Ice & Minerals', title: '1. Science Scan: Mountains vs. Ice', subtitle: 'Locate cryogenic cold traps (<110 K PSRs) & mineral targets' },
  { step: 2, short: 'Artemis & Slopes', title: '2. Artemis III & Terrain Safety', subtitle: 'Verify NASA candidate zones & DEM slope hazard (≤ 8°)' },
  { step: 3, short: 'Sun & Comms', title: '3. Illumination & Earth Contact', subtitle: 'Solve Sun power & Direct-to-Earth visibility for mission dates' },
  { step: 4, short: 'Landing Error', title: '4. Landing Dispersion Ellipse', subtitle: 'Monte-Carlo grid over 4×2 km touchdown uncertainty zone' },
  { step: 5, short: 'Energy & Verdict', title: '5. Energy Ledger & Mission GO/NO-GO', subtitle: 'Check solar array Wh, darkness survival & final mission score' },
]

const PLAY_SPEEDS = [
  { label: '1×', mult: 1 },
  { label: '10m/s', mult: 600 },
  { label: '1h/s', mult: 3600 },
  { label: '6h/s', mult: 21600 },
] as const

export function MoonExplorer() {
  const cesiumRef = useRef<CesiumMoonHandle>(null)

  // Navigation & layout state
  const [mode, setMode] = useState<ExplorerMode>('explore')
  const [layout, setLayout] = useState<ViewLayout>('3d')
  const [map2dProj, setMap2dProj] = useState<Map2DProjection>('polar')
  const [clockCollapsed, setClockCollapsed] = useState(false)

  // Time & ephemeris state
  const [years, setYears] = useState<number[]>([DEFAULT_YEAR])
  const [year, setYear] = useState<number>(DEFAULT_YEAR)
  const [timeMs, setTimeMs] = useState<number>(() => Date.UTC(DEFAULT_YEAR, 0, 15, 6, 30, 0))
  const [vectors, setVectors] = useState<Float32Array | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(2) // default 1 h/s

  // Catalogs & terrain data
  const [sites, setSites] = useState<SiteSummary[]>([])
  const [artemis, setArtemis] = useState<Region[]>([])
  const [mapData, setMapData] = useState<MapData | null>(null)

  // Active target & computed site
  const [selectedSiteId, setSelectedSiteId] = useState<string>('best-lit')
  const [siteData, setSiteData] = useState<Site | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lon: number; name: string }>({
    lat: -89.4749,
    lon: 222.557,
    name: 'Best-lit spot near the pole',
  })
  const [cameraCenter, setCameraCenter] = useState<{ lat: number; lon: number; heightKm: number } | null>(null)
  const [busyCustom, setBusyCustom] = useState(false)
  const [customErr, setCustomErr] = useState('')

  // Map/3D overlay layers
  const [layers, setLayers] = useState<ExplorerLayers>({
    wacImagery: true,
    elevationTint: false,
    solarLighting: true,
    psrs: true,
    artemis: true,
    sites: true,
    landmarks: true,
    rays: true,
    ellipse: true,
  })

  // Landing Ellipse computation state
  const [ellipseState, setEllipseState] = useState<{
    key: string
    points: (Sample | null)[]
    cells: (import('../ellipseGeometry').LatLon[] | null)[]
    weights: number[]
    done: number
    total: number
    running: boolean
  } | null>(null)

  // Pipeline mode state
  const [pipeStep, setPipeStep] = useState<number>(1)
  const [autoTour, setAutoTour] = useState<boolean>(false)

  // Initial catalog & terrain loading
  useEffect(() => {
    loadYears().then(setYears).catch(() => {})
    loadSites()
      .then((list) => {
        setSites(list)
        const best = list.find((s) => s.id === 'best-lit') ?? list[0]
        if (best) setSelectedPoint({ lat: best.lat, lon: best.lon, name: best.name })
      })
      .catch(() => {})
    loadArtemis().then(setArtemis).catch(() => {})
    loadMapData().then(setMapData).catch(() => {})
  }, [])

  // Load vectors for selected year
  useEffect(() => {
    let alive = true
    loadVectors(year)
      .then((v) => {
        if (alive) setVectors(v)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [year])

  // Load & retime active curated site when selectedSiteId or year changes
  useEffect(() => {
    if (!selectedSiteId || selectedSiteId === 'custom') return
    let alive = true
    loadSite(selectedSiteId)
      .then((s) => (inAnalysisYear(s) ? siteForYear(s, year) : s))
      .then((s) => {
        if (alive) {
          setSiteData(s)
          setSelectedPoint({ lat: s.lat, lon: s.lon, name: s.name })
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [selectedSiteId, year])

  // Clock bounds for active year
  const minMs = useMemo(() => Date.UTC(year, 0, 1, 0, 0, 0), [year])
  const maxMs = useMemo(() => Date.UTC(year, 11, 31, 23, 59, 59), [year])

  // Change year while preserving month/day/time
  const handleYearChange = (newYear: number) => {
    const d = new Date(timeMs)
    const clamped = Math.min(
      Date.UTC(newYear, 11, 31, 23, 59, 59),
      Date.UTC(newYear, d.getUTCMonth(), Math.min(28, d.getUTCDate()), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()),
    )
    setYear(newYear)
    setTimeMs(clamped)
  }

  // Smooth playback loop
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = 0
    const mult = PLAY_SPEEDS[speedIdx].mult
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setTimeMs((prev) => {
        const next = prev + dt * 1000 * mult
        return next > maxMs ? minMs : next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speedIdx, minMs, maxMs])

  // Instantaneous ephemeris
  const ephemeris = useMemo(() => {
    if (!vectors) return null
    return instantFromVectors(vectors, year, timeMs)
  }, [vectors, year, timeMs])

  // Real-time state of all curated sites at the current hour
  const siteStates = useMemo(() => {
    const out: Record<string, State> = {}
    if (!ephemeris) return out
    const h = Math.round(ephemeris.hourIndex)
    if (siteData) out[siteData.id] = stateAt(siteData, Math.min(siteData.samples - 1, Math.max(0, h)))
    // Also set baseline color from long-term stats when full track isn't loaded
    for (const s of sites) {
      if (out[s.id]) continue
      if (s.metrics.sunlit_pct > 55 && s.metrics.earth_visible_pct > 45) out[s.id] = 'both'
      else if (s.metrics.sunlit_pct > 55) out[s.id] = 'sun'
      else if (s.metrics.earth_visible_pct > 45) out[s.id] = 'earth'
      else out[s.id] = 'none'
    }
    return out
  }, [ephemeris, sites, siteData])

  // Exact DEM height and slope if point is in 85-90 S grid
  const localTerrain = useMemo(() => {
    if (!mapData || selectedPoint.lat > -85) return null
    const [r, c] = polarRowCol(selectedPoint.lat, selectedPoint.lon, mapData.n, mapData.scale)
    const ri = Math.round(r), ci = Math.round(c)
    if (ri < 1 || ci < 1 || ri >= mapData.n - 1 || ci >= mapData.n - 1) return null
    const t = terrainAt(mapData, ri, ci)
    const k = ri * mapData.n + ci
    return {
      elevM: Math.round(t.h),
      slopeDeg: t.slope,
      nasaSunPct: Math.round((mapData.sun[k] / 255) * 100),
      nasaEarthPct: Math.round((mapData.earth[k] / 255) * 100),
      inPsr: mapData.psr[k] > 128,
    }
  }, [mapData, selectedPoint])

  // Local Sun/Earth Az/El at selected point + optional terrain horizon check
  const localSky = useMemo(() => {
    if (!ephemeris) return null
    const sunTop = topocentricAzEl(selectedPoint.lat, selectedPoint.lon, ephemeris.sun)
    const earthTop = topocentricAzEl(selectedPoint.lat, selectedPoint.lon, ephemeris.earth)
    const siteTrack =
      siteData && Math.abs(siteData.lat - selectedPoint.lat) < 0.01 && Math.abs(siteData.lon - selectedPoint.lon) < 0.01
        ? interpolateSiteState(siteData, ephemeris.hourIndex)
        : null
    const sunVis = siteTrack ? siteTrack.sunFrac > 0 : sunTop.elDeg > -0.25
    const earthVis = siteTrack ? siteTrack.earthFrac > 0 : earthTop.elDeg > -0.2
    const status: State = sunVis && earthVis ? 'both' : sunVis ? 'sun' : earthVis ? 'earth' : 'none'
    return { sunTop, earthTop, siteTrack, sunVis, earthVis, status }
  }, [ephemeris, selectedPoint, siteData])

  // Science & Artemis dossier for selected point
  const scienceInfo = useMemo(() => {
    const trade = getSiteScienceStats({
      id: selectedSiteId !== 'custom' ? selectedSiteId : undefined,
      lat: selectedPoint.lat,
      lon: selectedPoint.lon,
      metrics: siteData?.metrics,
    })
    const psrNear = nearestPsr(selectedPoint.lat, selectedPoint.lon)
    const artNear = nearestArtemisDossier(selectedPoint.lat, selectedPoint.lon)
    return { trade, psrNear, artNear }
  }, [selectedPoint, selectedSiteId, siteData])

  // Run landing ellipse Monte-Carlo dispersion for current polar target
  const runEllipseCheck = useCallback(
    async (lat: number, lon: number) => {
      if (lat > -85) return
      const key = `${lat.toFixed(4)},${lon.toFixed(4)},${year}`
      const geom = ellipseSamples({ lat, lon }, DEFAULT_ELLIPSE, 28)
      const pts: (Sample | null)[] = geom.points.map(() => null)
      setEllipseState({
        key,
        points: pts,
        cells: geom.cells,
        weights: geom.weights,
        done: 0,
        total: geom.points.length,
        running: true,
      })

      let alive = true
      let completed = 0
      await computeSamples(
        geom.points,
        () => alive,
        (j, s) => {
          pts[j] = s
          completed++
          setEllipseState((prev) =>
            prev && prev.key === key
              ? { ...prev, points: [...pts], done: completed, running: completed < geom.points.length }
              : prev,
          )
        },
        year,
      ).catch(() => {
        alive = false
        setEllipseState((prev) => (prev && prev.key === key ? { ...prev, running: false } : prev))
      })
    },
    [year],
  )

  // Compute ellipse viability overlay for Cesium & 2D Map
  const ellipseDraw: EllipseDrawData | null = useMemo(() => {
    if (!ellipseState) return null
    const hourIdx = Math.max(0, Math.round(ephemeris?.hourIndex ?? 0))
    const missionHours = DEFAULT_THRESHOLDS.missionDays * 24
    const judged: { j: number; v: Viability }[] = []
    const viabilities: Viability[] = ellipseState.points.map((p, j) => {
      if (!p) return 'nodata'
      const res = judge(p, hourIdx, missionHours, DEFAULT_THRESHOLDS, 8)
      judged.push({ j, v: res.v })
      return res.v
    })
    const chance = judged.length > 0 ? landingChance(judged, ellipseState.weights) : null
    const verdict = chance !== null && ellipseState.done === ellipseState.total ? verdictOf(chance.ok) : null
    return {
      center: { lat: selectedPoint.lat, lon: selectedPoint.lon },
      spec: DEFAULT_ELLIPSE,
      points: ellipseState.points,
      cells: ellipseState.cells,
      viabilities,
      chancePct: chance !== null ? Math.round(chance.ok * 100) : null,
      verdict,
    }
  }, [ellipseState, ephemeris, selectedPoint])

  // Mission window statistics (Step 3 & Step 5)
  const missionEval = useMemo(() => {
    if (!siteData || !ephemeris) return null
    const hourIdx = Math.max(0, Math.min(siteData.samples - 1, Math.round(ephemeris.hourIndex)))
    const hours = DEFAULT_THRESHOLDS.missionDays * 24
    const ws = windowStats(siteData, hourIdx, hours)
    const v = viability(ws, DEFAULT_THRESHOLDS)
    const energyWh = arrayEnergyWh(siteData, hourIdx, hours, DEFAULT_ARRAY)
    const avgW = energyWh / hours
    // Baseline lander survival power draw ~ 95 W continuous through darkness
    const darkBatteryNeedWh = ws ? Math.round(ws.longestDarkH * 95) : 0
    return { ws, v, energyWh: Math.round(energyWh), avgW: Math.round(avgW), darkBatteryNeedWh }
  }, [siteData, ephemeris])

  // Handle clicking anywhere on Moon (3D or 2D)
  const handlePickPoint = useCallback(
    async (lat: number, lon: number, label?: string, siteId?: string) => {
      const normLon = ((((lon + 180) % 360) + 360) % 360) - 180
      if (siteId) {
        setSelectedSiteId(siteId)
        const s = sites.find((x) => x.id === siteId)
        cesiumRef.current?.flyTo(s?.lat ?? lat, s?.lon ?? normLon, 110, -52, 1.2)
        return
      }
      const match = sites.find((s) => Math.abs(s.lat - lat) < 0.04 && Math.abs((((s.lon + 180) % 360) - 180) - normLon) < 0.04)
      if (match) {
        setSelectedSiteId(match.id)
        cesiumRef.current?.flyTo(match.lat, match.lon, 110, -52, 1.2)
        return
      }
      setSelectedSiteId('custom')
      setSelectedPoint({
        lat,
        lon: normLon,
        name: label ?? `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(normLon).toFixed(2)}°${normLon < 0 ? 'W' : 'E'}`,
      })
      cesiumRef.current?.flyTo(lat, normLon, lat < -80 ? 110 : 380, -58, 1.2)
    },
    [sites],
  )

  const handleComputeExactCustom = async () => {
    if (selectedPoint.lat > -85) return
    setBusyCustom(true)
    setCustomErr('')
    try {
      const s = await computeCustomPoint(selectedPoint.lat, selectedPoint.lon, true)
      const timed = await siteForYear(s, year)
      setSiteData(timed)
    } catch (e) {
      setCustomErr(String((e as Error).message ?? e))
    } finally {
      setBusyCustom(false)
    }
  }

  // Pipeline Step Side-Effects: switch layers & fly 3D camera seamlessly
  const activatePipelineStep = useCallback(
    (step: number) => {
      setPipeStep(step)
      const target = selectedPoint.lat <= -80 ? selectedPoint : { lat: -89.4749, lon: 222.557, name: 'Best-lit spot near the pole' }
      if (selectedPoint.lat > -80) {
        setSelectedSiteId('best-lit')
      }
      if (step === 1) {
        setLayers((l) => ({ ...l, wacImagery: true, elevationTint: true, solarLighting: false, psrs: true, artemis: false, sites: false, rays: false, ellipse: false }))
        cesiumRef.current?.flyTo(-88.5, target.lon, 430, -72, 1.3)
      } else if (step === 2) {
        setLayers((l) => ({ ...l, wacImagery: true, elevationTint: false, solarLighting: false, psrs: true, artemis: true, sites: true, rays: false, ellipse: false }))
        cesiumRef.current?.flyTo(target.lat, target.lon, 175, -58, 1.3)
      } else if (step === 3) {
        setLayers((l) => ({ ...l, wacImagery: true, elevationTint: false, solarLighting: true, psrs: true, artemis: true, sites: true, rays: true, ellipse: false }))
        cesiumRef.current?.flyTo(target.lat, target.lon, 85, -42, 1.3)
      } else if (step === 4) {
        setLayers((l) => ({ ...l, wacImagery: true, elevationTint: false, solarLighting: true, psrs: true, artemis: false, sites: true, rays: true, ellipse: true }))
        cesiumRef.current?.flyTo(target.lat, target.lon, 28, -50, 1.4)
        const expectedKey = `${target.lat.toFixed(4)},${target.lon.toFixed(4)},${year}`
        if (!ellipseState || ellipseState.key !== expectedKey) {
          runEllipseCheck(target.lat, target.lon)
        }
      } else if (step === 5) {
        setLayers((l) => ({ ...l, wacImagery: true, elevationTint: false, solarLighting: true, psrs: true, artemis: true, sites: true, rays: true, ellipse: true }))
        cesiumRef.current?.flyTo(target.lat, target.lon, 54, -46, 1.3)
      }
    },
    [selectedPoint, year, ellipseState, runEllipseCheck],
  )

  // Switch into pipeline mode triggers Step 1
  const enterMode = (next: ExplorerMode) => {
    setMode(next)
    setAutoTour(false)
    if (next === 'pipeline') {
      activatePipelineStep(1)
    } else {
      setLayers((l) => ({ ...l, solarLighting: true, elevationTint: false, psrs: true, artemis: true, sites: true, rays: true, ellipse: true }))
    }
  }

  // Auto-run 5-step tour timer
  useEffect(() => {
    if (mode !== 'pipeline' || !autoTour) return
    const timer = window.setInterval(() => {
      setPipeStep((curr) => {
        const next = curr + 1
        if (next > 5) {
          setAutoTour(false)
          return 5
        }
        activatePipelineStep(next)
        return next
      })
    }, 6500)
    return () => window.clearInterval(timer)
  }, [mode, autoTour, activatePipelineStep])

  const dsn = useMemo(() => approxDsnStation(timeMs), [timeMs])
  const toggleLayer = (k: keyof ExplorerLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }))

  const sunFluxWm2 = localSky && localSky.sunVis ? Math.round(1361 * Math.max(0.05, Math.sin((Math.max(1, localSky.sunTop.elDeg) * Math.PI) / 180))) : 0

  return (
    <div className="mx-root">
      {/* Top Mission Control Header */}
      <header className="mx-head">
        <div className="mx-brand">
          <a className="mx-back" href="?view=site" title="Return to Survey Planner tabs">
            ← Planner
          </a>
          <div className="mx-title-wrap">
            <h1>Moon Explorer</h1>
            <span className="mx-badge">Google-Earth 3D + 24h Clock + Mission Pipeline</span>
          </div>
        </div>

        <div className="mx-head-controls">
          <div className="mx-seg" role="group" aria-label="Explorer mode">
            <button type="button" aria-pressed={mode === 'explore'} onClick={() => enterMode('explore')}>
              Free Explore
            </button>
            <button type="button" aria-pressed={mode === 'pipeline'} onClick={() => enterMode('pipeline')}>
              Mission Pipeline
            </button>
          </div>

          <div className="mx-seg" role="group" aria-label="Viewport layout">
            <button type="button" aria-pressed={layout === '3d'} onClick={() => setLayout('3d')}>
              3D Globe
            </button>
            <button type="button" aria-pressed={layout === 'split'} onClick={() => setLayout('split')}>
              Split 3D + 2D
            </button>
            <button type="button" aria-pressed={layout === '2d'} onClick={() => setLayout('2d')}>
              2D Map
            </button>
          </div>

          <select
            className="mx-select"
            aria-label="Jump to lunar site or landmark"
            value={selectedSiteId}
            onChange={(e) => {
              const val = e.target.value
              if (val.startsWith('lm:')) {
                const lm = GLOBAL_LANDMARKS.find((x) => `lm:${x.id}` === val)
                if (lm) handlePickPoint(lm.lat, lm.lon, lm.name)
                return
              }
              setSelectedSiteId(val)
              const s = sites.find((x) => x.id === val)
              if (s) cesiumRef.current?.flyTo(s.lat, s.lon, s.lat < -80 ? 90 : 320, -52, 1.3)
            }}
          >
            <optgroup label="Mission Sites (South Pole & Landing)">
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Global Landmarks">
              {GLOBAL_LANDMARKS.map((lm) => (
                <option key={lm.id} value={`lm:${lm.id}`}>
                  {lm.name}
                </option>
              ))}
            </optgroup>
            {selectedSiteId === 'custom' && <option value="custom">Custom: {selectedPoint.name}</option>}
          </select>

          <select
            className="mx-select mx-year"
            aria-label="Orbital ephemeris year"
            value={year}
            onChange={(e) => handleYearChange(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Pipeline Stepper Ribbon (visible in Pipeline mode) */}
      {mode === 'pipeline' && (
        <div className="mx-stepper-bar">
          <div className="mx-stepper-steps">
            {PIPELINE_STEPS.map((st) => (
              <button
                key={st.step}
                type="button"
                className={`mx-step-pill ${pipeStep === st.step ? 'active' : pipeStep > st.step ? 'done' : ''}`}
                onClick={() => {
                  setAutoTour(false)
                  activatePipelineStep(st.step)
                }}
              >
                <span className="mx-step-num">{pipeStep > st.step ? '✓' : st.step}</span>
                <span>{st.short}</span>
              </button>
            ))}
          </div>
          <div className="mx-stepper-actions">
            <button
              type="button"
              className={`mx-btn-tour ${autoTour ? 'running' : ''}`}
              onClick={() => {
                if (autoTour) {
                  setAutoTour(false)
                } else {
                  if (pipeStep === 5) activatePipelineStep(1)
                  else activatePipelineStep(pipeStep)
                  setAutoTour(true)
                }
              }}
            >
              {autoTour ? '⏸ Pause Tour' : '▶ Auto-Run Pipeline'}
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area: Viewport(s) + Right HUD Drawer */}
      <div className="mx-workspace">
        <div className={`mx-stage mx-layout-${layout}`}>
          {/* 3D Cesium Globe */}
          <div className={`mx-pane-3d ${layout === '2d' ? 'hidden' : ''}`}>
            <CesiumMoon
              ref={cesiumRef}
              mode="3d"
              ephemeris={ephemeris}
              layers={layers}
              sites={sites}
              siteStates={siteStates}
              artemis={artemis}
              artemisDossiers={ARTEMIS_3_SITES}
              selected={selectedPoint}
              ellipse={layers.ellipse ? ellipseDraw : null}
              onPickPoint={handlePickPoint}
              onCameraCenter={(lat, lon, heightKm) => setCameraCenter({ lat, lon, heightKm })}
            />

            {/* Floating 3D Navigation Tools */}
            <div className="mx-cam-tools">
              <button type="button" onClick={() => cesiumRef.current?.zoomIn()} title="Zoom in">
                +
              </button>
              <button type="button" onClick={() => cesiumRef.current?.zoomOut()} title="Zoom out">
                −
              </button>
              <button type="button" onClick={() => cesiumRef.current?.resetSouthPole()} title="Fly to South Pole">
                South Pole
              </button>
              <button type="button" onClick={() => cesiumRef.current?.flyTo(0, ephemeris?.subSolar.lon ?? 0, 3800, -89, 1.2)} title="Whole Moon overview">
                Full Moon
              </button>
            </div>

            {cameraCenter && (
              <div className="mx-cam-readout">
                Camera: {Math.abs(cameraCenter.lat).toFixed(2)}°{cameraCenter.lat < 0 ? 'S' : 'N'},{' '}
                {Math.abs(cameraCenter.lon).toFixed(2)}°{cameraCenter.lon < 0 ? 'W' : 'E'} · Alt{' '}
                {cameraCenter.heightKm >= 100 ? `${Math.round(cameraCenter.heightKm)} km` : `${cameraCenter.heightKm.toFixed(1)} km`}
              </div>
            )}
          </div>

          {/* 2D Map (Full in 2D mode, Right half in Split mode) */}
          {layout !== '3d' && (
            <div className="mx-pane-2d">
              <LunarMap2D
                projection={map2dProj}
                onProjectionChange={setMap2dProj}
                ephemeris={ephemeris}
                layers={layers}
                sites={sites}
                siteStates={siteStates}
                artemis={artemis}
                selected={selectedPoint}
                cameraCenter={cameraCenter}
                ellipse={layers.ellipse ? ellipseDraw : null}
                onPickPoint={handlePickPoint}
              />
            </div>
          )}

          {/* Floating Bottom-Left 24-Hour Mission Clock */}
          <div className={`mx-clock-dock ${clockCollapsed ? 'collapsed' : ''}`}>
            <button
              type="button"
              className="mx-clock-toggle"
              onClick={() => setClockCollapsed((c) => !c)}
              aria-expanded={!clockCollapsed}
            >
              <span>24h Mission Clock · {formatUtcFull(timeMs)}</span>
              <span>{clockCollapsed ? 'Expand ▲' : 'Minimize ▼'}</span>
            </button>
            {!clockCollapsed && (
              <div className="mx-clock-body">
                <MissionClock
                  timeMs={timeMs}
                  onChange={(ms) => {
                    setPlaying(false)
                    setTimeMs(ms)
                  }}
                  minMs={minMs}
                  maxMs={maxMs}
                  sunBearingDeg={ephemeris?.sunPoleBearingDeg}
                  earthBearingDeg={ephemeris?.earthPoleBearingDeg}
                  sunElevationDeg={ephemeris?.sunPoleElDeg}
                  lunarDayFrac={ephemeris?.lunarDayFrac}
                  size={216}
                />
                <div className="mx-playback">
                  <button type="button" onClick={() => { setPlaying(false); setTimeMs((t) => Math.max(minMs, t - 86_400_000)) }} title="-1 day">
                    −1d
                  </button>
                  <button type="button" onClick={() => { setPlaying(false); setTimeMs((t) => Math.max(minMs, t - 3_600_000)) }} title="-1 hour">
                    −1h
                  </button>
                  <button
                    type="button"
                    className={`mx-play-btn ${playing ? 'active' : ''}`}
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? '⏸' : '▶'}
                  </button>
                  <button
                    type="button"
                    className="mx-speed-btn"
                    onClick={() => setSpeedIdx((i) => (i + 1) % PLAY_SPEEDS.length)}
                    title="Cycle simulation speed"
                  >
                    {PLAY_SPEEDS[speedIdx].label}
                  </button>
                  <button type="button" onClick={() => { setPlaying(false); setTimeMs((t) => Math.min(maxMs, t + 3_600_000)) }} title="+1 hour">
                    +1h
                  </button>
                  <button type="button" onClick={() => { setPlaying(false); setTimeMs((t) => Math.min(maxMs, t + 86_400_000)) }} title="+1 day">
                    +1d
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right HUD Telemetry / Pipeline Drawer */}
        <aside className="mx-drawer">
          {mode === 'explore' ? (
            <>
              <section className="mx-card">
                <div className="mx-card-head">
                  <h2>At This Instant</h2>
                  <span className="mx-phase">{ephemeris?.phaseName ?? '…'}</span>
                </div>
                <div className="mx-target-name">{selectedPoint.name}</div>
                <div className="mx-coords">
                  {Math.abs(selectedPoint.lat).toFixed(3)}°{selectedPoint.lat < 0 ? 'S' : 'N'},{' '}
                  {Math.abs(selectedPoint.lon).toFixed(3)}°{selectedPoint.lon < 0 ? 'W' : 'E'}
                  {localTerrain && ` · Elev ${localTerrain.elevM} m · Slope ${localTerrain.slopeDeg.toFixed(1)}°`}
                </div>

                {localSky && (
                  <div className={`mx-status-banner st-${localSky.status}`}>
                    <span className="mx-status-dot" />
                    <span>
                      {localSky.status === 'both'
                        ? 'Sunlit + Direct Earth Link'
                        : localSky.status === 'sun'
                          ? 'Sunlit · Earth Below Horizon'
                          : localSky.status === 'earth'
                            ? 'In Darkness · Earth Link Active'
                            : 'Lunar Night · No Direct Link'}
                    </span>
                  </div>
                )}

                <div className="mx-kv-grid">
                  <div>
                    <span className="mx-k">Sun Az / El</span>
                    <span className="mx-v amber">
                      {localSky ? `${localSky.sunTop.azDeg.toFixed(1)}° / ${localSky.sunTop.elDeg >= 0 ? '+' : ''}${localSky.sunTop.elDeg.toFixed(2)}°` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="mx-k">Earth Az / El</span>
                    <span className="mx-v blue">
                      {localSky ? `${localSky.earthTop.azDeg.toFixed(1)}° / ${localSky.earthTop.elDeg >= 0 ? '+' : ''}${localSky.earthTop.elDeg.toFixed(2)}°` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="mx-k">Solar Irradiance</span>
                    <span className="mx-v">{sunFluxWm2} W/m²</span>
                  </div>
                  <div>
                    <span className="mx-k">Nearest Water Ice</span>
                    <span className="mx-v cyan">
                      {scienceInfo.psrNear.distKm.toFixed(1)} km ({scienceInfo.psrNear.psr.tempK} K)
                    </span>
                  </div>
                  <div>
                    <span className="mx-k">Sub-Solar Point</span>
                    <span className="mx-v">
                      {ephemeris ? `${ephemeris.subSolar.lat.toFixed(1)}°, ${ephemeris.subSolar.lon.toFixed(1)}°` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="mx-k">DSN Ground (est.)</span>
                    <span className="mx-v">{dsn.active}</span>
                  </div>
                </div>

                {selectedPoint.lat <= -85 && (
                  <div className="mx-btn-row">
                    {selectedSiteId === 'custom' && (
                      <button type="button" className="mx-btn-primary" disabled={busyCustom} onClick={handleComputeExactCustom}>
                        {busyCustom ? 'Computing horizon…' : 'Compute Exact Horizon & Shadows'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="mx-btn-secondary"
                      onClick={() => runEllipseCheck(selectedPoint.lat, selectedPoint.lon)}
                      disabled={ellipseState?.running}
                    >
                      {ellipseState?.running
                        ? `Checking Ellipse (${ellipseState.done}/${ellipseState.total})…`
                        : 'Run 4×2 km Landing Ellipse'}
                    </button>
                  </div>
                )}
                {customErr && <p className="mx-err">{customErr}</p>}

                {ellipseDraw && ellipseDraw.chancePct !== null && (
                  <div className="mx-ellipse-mini">
                    <span>Landing Ellipse Safety:</span>
                    <strong className={`v-${ellipseDraw.verdict ?? 'caution'}`}>
                      {ellipseDraw.chancePct}% safe ground ({ellipseDraw.verdict ? VERDICT_LABEL[ellipseDraw.verdict] : 'Computing'})
                    </strong>
                  </div>
                )}
              </section>

              <section className="mx-card">
                <h2>Map &amp; 3D Overlays</h2>
                <div className="mx-layer-list">
                  {([
                    ['wacImagery', 'LRO WAC Imagery (100 m tiles)'],
                    ['elevationTint', 'LOLA Elevation Color Shade'],
                    ['solarLighting', 'Real-Time Solar Terminator'],
                    ['psrs', 'Cryogenic Ice PSRs (<110 K)'],
                    ['artemis', 'NASA Artemis III Regions'],
                    ['sites', 'Curated Sites & CLPS Landers'],
                    ['landmarks', 'Global Craters & Landmarks'],
                    ['rays', '3D Sun & Earth Sight Vectors'],
                    ['ellipse', 'Landing Error Dispersion Ellipse'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="mx-toggle-row">
                      <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="mx-card mx-actions-card">
                <a className="mx-link-btn" href={`?view=site&site=${selectedSiteId === 'custom' ? 'best-lit' : selectedSiteId}`}>
                  Open in Main Site Planner
                </a>
                <a className="mx-link-btn" href={`?view=3d&site=${selectedSiteId === 'custom' ? 'best-lit' : selectedSiteId}`}>
                  Open GPU Shadow 3D View
                </a>
              </section>
            </>
          ) : (
            /* MISSION PIPELINE STEPPER DRAWER */
            <>
              <section className="mx-card mx-pipe-card">
                <div className="mx-pipe-head">
                  <span className="mx-pipe-step-tag">Stage {pipeStep} of 5</span>
                  <h2>{PIPELINE_STEPS[pipeStep - 1].title}</h2>
                  <p className="mx-pipe-sub">{PIPELINE_STEPS[pipeStep - 1].subtitle}</p>
                </div>

                <div className="mx-pipe-target">
                  <span>Evaluating Target:</span>
                  <strong>{selectedPoint.name}</strong>
                </div>

                {pipeStep === 1 && (
                  <div className="mx-pipe-body">
                    <div className="mx-stat-box cyan">
                      <span className="lbl">Nearest Cryogenic Cold Trap</span>
                      <span className="val">{scienceInfo.psrNear.psr.name}</span>
                      <span className="sub">
                        {scienceInfo.psrNear.distKm.toFixed(1)} km away · Floor {scienceInfo.psrNear.psr.tempK} K · Drop −{scienceInfo.psrNear.psr.depthM} m
                      </span>
                    </div>
                    <div className="mx-stat-box">
                      <span className="lbl">Trade-Off Zone</span>
                      <span className="val">{scienceInfo.trade.zoneLabel}</span>
                      <span className="sub">{scienceInfo.psrNear.psr.evidence}</span>
                    </div>
                    {scienceInfo.artNear && (
                      <div className="mx-stat-box">
                        <span className="lbl">ISRU &amp; Mineral Profile ({scienceInfo.artNear.dossier.name})</span>
                        <span className="val">{scienceInfo.artNear.dossier.resources.water_ice_potential} Ice Potential</span>
                        <span className="sub">{scienceInfo.artNear.dossier.minerals.primary.join(' · ')}</span>
                      </div>
                    )}
                  </div>
                )}

                {pipeStep === 2 && (
                  <div className="mx-pipe-body">
                    <div className="mx-stat-box">
                      <span className="lbl">Terrain Elevation &amp; Slope (240 m LOLA)</span>
                      <span className="val">
                        {localTerrain ? `${localTerrain.elevM} m elev · ${localTerrain.slopeDeg.toFixed(1)}° slope` : 'Outside 85°S grid'}
                      </span>
                      <span className="sub">
                        {localTerrain
                          ? localTerrain.slopeDeg <= 8
                            ? 'PASS: Within ≤ 8° lander tilt limit'
                            : 'WARNING: Exceeds 8° slope limit — check landing ellipse'
                          : 'Pick a South Pole site for 240 m slope grading'}
                      </span>
                    </div>
                    <div className="mx-stat-box">
                      <span className="lbl">NASA Artemis III Candidate Overlay</span>
                      <span className="val">{artemis.length} Candidate Regions Mapped</span>
                      <span className="sub">
                        {scienceInfo.artNear
                          ? `Closest region: ${scienceInfo.artNear.dossier.name} (${scienceInfo.artNear.distKm.toFixed(1)} km)`
                          : 'Select polar target to measure offset'}
                      </span>
                    </div>
                  </div>
                )}

                {pipeStep === 3 && (
                  <div className="mx-pipe-body">
                    <div className="mx-stat-box amber">
                      <span className="lbl">14-Day Window Starting {formatUtcFull(timeMs).slice(0, 11)}</span>
                      <span className="val">
                        {missionEval?.ws
                          ? `Sun ${Math.round(missionEval.ws.sunPct)}% · Earth ${Math.round(missionEval.ws.earthPct)}%`
                          : 'Loading hourly site tracks…'}
                      </span>
                      <span className="sub">
                        {missionEval?.ws
                          ? `Longest darkness: ${formatDuration(missionEval.ws.longestDarkH)} · Status: ${missionEval.v.toUpperCase()}`
                          : 'Computes exact Sun & Earth disc intersections over DEM horizon'}
                      </span>
                    </div>
                    <div className="mx-stat-box">
                      <span className="lbl">Instantaneous 3D Ray Vectors (Now)</span>
                      <span className="val">{localSky ? `${localSky.sunTop.elDeg.toFixed(2)}° Sun · ${localSky.earthTop.elDeg.toFixed(2)}° Earth` : '—'}</span>
                      <span className="sub">Amber beam = solar vector · Blue beam = DSN Earth link</span>
                    </div>
                  </div>
                )}

                {pipeStep === 4 && (
                  <div className="mx-pipe-body">
                    <div className="mx-stat-box">
                      <span className="lbl">4×2 km Gaussian Landing Error Ellipse</span>
                      <span className="val">
                        {ellipseDraw?.chancePct !== null && ellipseDraw?.chancePct !== undefined
                          ? `${ellipseDraw.chancePct}% Safe Touchdown Probability`
                          : ellipseState?.running
                            ? `Running Workers (${ellipseState.done}/${ellipseState.total})…`
                            : 'Ready to simulate dispersion'}
                      </span>
                      <span className="sub">
                        {ellipseDraw?.verdict
                          ? `Verdict: ${VERDICT_LABEL[ellipseDraw.verdict]} (≤ 8° slope + 14-day power/comms across footprint)`
                          : 'Green tiles = safe · Amber = marginal · Red = crater hazard/shadow'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mx-btn-primary"
                      disabled={ellipseState?.running || selectedPoint.lat > -85}
                      onClick={() => runEllipseCheck(selectedPoint.lat, selectedPoint.lon)}
                    >
                      {ellipseState?.running ? 'Computing dispersion…' : 'Re-Run Dispersion Grid'}
                    </button>
                  </div>
                )}

                {pipeStep === 5 && (
                  <div className="mx-pipe-body">
                    <div className={`mx-verdict-banner v-${missionEval?.v === 'viable' && ellipseDraw?.verdict !== 'fail' ? 'ok' : missionEval?.v === 'not' || ellipseDraw?.verdict === 'fail' ? 'fail' : 'caution'}`}>
                      <span className="lbl">FINAL MISSION GO / NO-GO VERDICT</span>
                      <strong>
                        {missionEval?.v === 'viable' && (ellipseDraw?.verdict ?? 'ok') !== 'fail'
                          ? 'GO FOR LAUNCH'
                          : missionEval?.v === 'not' || ellipseDraw?.verdict === 'fail'
                            ? 'NO-GO · RELOCATE TARGET'
                            : 'MARGINAL · CHECK MARGINS'}
                      </strong>
                    </div>

                    <div className="mx-kv-grid">
                      <div>
                        <span className="mx-k">Solar Harvest (14d)</span>
                        <span className="mx-v amber">{missionEval ? `${missionEval.energyWh.toLocaleString()} Wh` : '—'}</span>
                      </div>
                      <div>
                        <span className="mx-k">Peak Array (1m² 30%)</span>
                        <span className="mx-v">{Math.round(peakWatts(DEFAULT_ARRAY))} W</span>
                      </div>
                      <div>
                        <span className="mx-k">Night Battery Need</span>
                        <span className="mx-v">{missionEval ? `${missionEval.darkBatteryNeedWh.toLocaleString()} Wh` : '—'}</span>
                      </div>
                      <div>
                        <span className="mx-k">Ellipse Safety</span>
                        <span className="mx-v">{ellipseDraw?.chancePct !== null && ellipseDraw?.chancePct !== undefined ? `${ellipseDraw.chancePct}%` : 'Run Step 4'}</span>
                      </div>
                    </div>

                    <a className="mx-link-btn" href={`?view=lander&site=${selectedSiteId === 'custom' ? 'best-lit' : selectedSiteId}`}>
                      Open Full Battery Ledger in Lander Systems
                    </a>
                  </div>
                )}

                <div className="mx-pipe-nav">
                  <button
                    type="button"
                    disabled={pipeStep <= 1}
                    onClick={() => {
                      setAutoTour(false)
                      activatePipelineStep(pipeStep - 1)
                    }}
                  >
                    ← Prev Step
                  </button>
                  <button
                    type="button"
                    className="mx-btn-primary"
                    disabled={pipeStep >= 5}
                    onClick={() => {
                      setAutoTour(false)
                      activatePipelineStep(pipeStep + 1)
                    }}
                  >
                    Next Step →
                  </button>
                </div>
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
