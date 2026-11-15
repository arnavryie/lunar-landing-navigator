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
  reasons,
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
  nearbyPsrs,
  nearestArtemisDossier,
  nearestPsr,
  rankSitesForWindow,
  scanTerrainNeighborhood,
  surfaceKm,
  topocentricAzEl,
} from './moonMath'
import './moonExplorer.css'

const PLAY_SPEEDS = [
  { label: '1x', mult: 1 },
  { label: '15m/s', mult: 900 },
  { label: '1h/s', mult: 3600 },
  { label: '6h/s', mult: 21600 },
] as const

const PIPELINE_STAGES = [
  { id: 'best-site', num: '01', label: 'Best site at time' },
  { id: 'errors', num: '02', label: 'Errors & slope risk' },
  { id: 'energy', num: '03', label: 'Lander power & dark' },
  { id: 'minerals', num: '04', label: 'Minerals & geology' },
  { id: 'ice', num: '05', label: 'Water ice & PSRs' },
] as const

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <path d="M14 3.5a10.5 10.5 0 1 0 0 21 8.5 8.5 0 0 1 0-21z" fill="currentColor" opacity="0.22" />
      <circle cx="14" cy="24.5" r="2.2" fill="var(--sun)" />
    </svg>
  )
}

export function MoonExplorer() {
  const cesiumRef = useRef<CesiumMoonHandle>(null)
  const dossierRef = useRef<HTMLDivElement>(null)
  const pipeTimerRef = useRef<number | null>(null)

  // Viewport: always Split (3D + 2D) by default; optional wide 2D expansion without any single 3D-only mode
  const [expand2d, setExpand2d] = useState(false)
  const [map2dProj, setMap2dProj] = useState<Map2DProjection>('polar')
  const [layersOpen, setLayersOpen] = useState(false)

  // Time & ephemeris
  const [years, setYears] = useState<number[]>([DEFAULT_YEAR])
  const [year, setYear] = useState<number>(DEFAULT_YEAR)
  const [timeMs, setTimeMs] = useState<number>(() => Date.UTC(DEFAULT_YEAR, 0, 15, 6, 30, 0))
  const [vectors, setVectors] = useState<Float32Array | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(2)

  // Static catalogs & preloaded site pool for instant pipeline scoring
  const [sites, setSites] = useState<SiteSummary[]>([])
  const [sitePool, setSitePool] = useState<Site[]>([])
  const [artemis, setArtemis] = useState<Region[]>([])
  const [mapData, setMapData] = useState<MapData | null>(null)

  // Active target
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

  // Map/3D overlay toggles (kept lightweight by default)
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

  // Auto-pipeline reveal state
  const [pipeActive, setPipeActive] = useState(true)
  const [pipeStage, setPipeStage] = useState<number>(5)
  const [pipeRunning, setPipeRunning] = useState(false)
  const [pipeRunCount, setPipeRunCount] = useState(1)
  const [autoFollowClock, setAutoFollowClock] = useState(false)

  // 4x2 km Gaussian Landing Ellipse state
  const [ellipseState, setEllipseState] = useState<{
    key: string
    points: (Sample | null)[]
    cells: (import('../ellipseGeometry').LatLon[] | null)[]
    weights: number[]
    done: number
    total: number
    running: boolean
  } | null>(null)

  // Load metadata & polar grids once
  useEffect(() => {
    loadYears().then(setYears).catch(() => {})
    loadArtemis().then(setArtemis).catch(() => {})
    loadMapData().then(setMapData).catch(() => {})
    loadSites()
      .then((list) => {
        setSites(list)
        const best = list.find((s) => s.id === 'best-lit') ?? list[0]
        if (best) setSelectedPoint({ lat: best.lat, lon: best.lon, name: best.name })
      })
      .catch(() => {})
  }, [])

  // Preload static polar sites for selected year so Pipeline site ranking is <1 ms with zero lag
  useEffect(() => {
    if (sites.length === 0) return
    let alive = true
    const polarIds = sites.filter((s) => s.lat <= -75 && !s.id.startsWith('replay-')).map((s) => s.id)
    Promise.all(
      polarIds.map((id) =>
        loadSite(id)
          .then((s) => (inAnalysisYear(s) ? siteForYear(s, year) : s))
          .catch(() => null),
      ),
    ).then((loaded) => {
      if (!alive) return
      setSitePool(loaded.filter((x): x is Site => x !== null))
    })
    return () => {
      alive = false
    }
  }, [sites, year])

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

  // Keep selected curated site synchronized with chosen year
  useEffect(() => {
    if (!selectedSiteId || selectedSiteId === 'custom') return
    const cached = sitePool.find((s) => s.id === selectedSiteId)
    if (cached) {
      setSiteData(cached)
      setSelectedPoint({ lat: cached.lat, lon: cached.lon, name: cached.name })
      return
    }
    let alive = true
    loadSite(selectedSiteId)
      .then((s) => (inAnalysisYear(s) ? siteForYear(s, year) : s))
      .then((s) => {
        if (!alive) return
        setSiteData(s)
        setSelectedPoint({ lat: s.lat, lon: s.lon, name: s.name })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [selectedSiteId, year, sitePool])

  const minMs = useMemo(() => Date.UTC(year, 0, 1, 0, 0, 0), [year])
  const maxMs = useMemo(() => Date.UTC(year, 11, 31, 23, 59, 59), [year])

  const handleYearChange = (newYear: number) => {
    const d = new Date(timeMs)
    const clamped = Math.min(
      Date.UTC(newYear, 11, 31, 23, 59, 59),
      Date.UTC(newYear, d.getUTCMonth(), Math.min(28, d.getUTCDate()), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()),
    )
    setYear(newYear)
    setTimeMs(clamped)
  }

  // Throttled playback loop (~15 Hz UI updates so Cesium + React stay lightweight)
  useEffect(() => {
    if (!playing) return
    const mult = PLAY_SPEEDS[speedIdx].mult
    const timer = window.setInterval(() => {
      setTimeMs((prev) => {
        const next = prev + 67 * mult
        return next > maxMs ? minMs : next
      })
    }, 67)
    return () => window.clearInterval(timer)
  }, [playing, speedIdx, minMs, maxMs])

  const ephemeris = useMemo(() => {
    if (!vectors) return null
    return instantFromVectors(vectors, year, timeMs)
  }, [vectors, year, timeMs])

  // Real-time instantaneous sky status of every site (fast exact lookup from sitePool)
  const siteStates = useMemo(() => {
    const out: Record<string, State> = {}
    if (!ephemeris) return out
    const h = Math.round(ephemeris.hourIndex)
    for (const s of sitePool) {
      out[s.id] = stateAt(s, Math.min(s.samples - 1, Math.max(0, h)))
    }
    if (siteData) out[siteData.id] = stateAt(siteData, Math.min(siteData.samples - 1, Math.max(0, h)))
    for (const s of sites) {
      if (out[s.id]) continue
      if (s.metrics.sunlit_pct > 55 && s.metrics.earth_visible_pct > 45) out[s.id] = 'both'
      else if (s.metrics.sunlit_pct > 55) out[s.id] = 'sun'
      else if (s.metrics.earth_visible_pct > 45) out[s.id] = 'earth'
      else out[s.id] = 'none'
    }
    return out
  }, [ephemeris, sites, sitePool, siteData])

  // Precomputed instant Pipeline ranking across all loaded polar sites at exact clock timestamp
  const rankedCandidates = useMemo(() => {
    if (!ephemeris || sitePool.length === 0) return []
    return rankSitesForWindow(sitePool, ephemeris.hourIndex, DEFAULT_THRESHOLDS.missionDays * 24, mapData)
  }, [sitePool, ephemeris, mapData])

  // Optional auto-follow: switch automatically to the best location whenever clock changes
  useEffect(() => {
    if (!autoFollowClock || rankedCandidates.length === 0) return
    const top = rankedCandidates[0].site
    if (top.id !== selectedSiteId) {
      setSelectedSiteId(top.id)
      cesiumRef.current?.flyTo(top.lat, top.lon, 95, -52, 0.9)
    }
  }, [autoFollowClock, rankedCandidates, selectedSiteId])

  // Local 240 m LOLA pixel properties + 4 km static neighborhood slope scan
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

  const neighborhood = useMemo(
    () => scanTerrainNeighborhood(mapData, selectedPoint.lat, selectedPoint.lon, 8),
    [mapData, selectedPoint],
  )

  // Local sky conditions at the chosen instant
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

  // Full 14-day window energy + errors analysis
  const missionEval = useMemo(() => {
    if (!siteData || !ephemeris) return null
    const hourIdx = Math.max(0, Math.min(siteData.samples - 1, Math.round(ephemeris.hourIndex)))
    const hours = DEFAULT_THRESHOLDS.missionDays * 24
    const ws = windowStats(siteData, hourIdx, hours)
    const v = viability(ws, DEFAULT_THRESHOLDS)
    const energyWh = arrayEnergyWh(siteData, hourIdx, hours, DEFAULT_ARRAY)
    const avgW = energyWh / hours
    const darkBatteryNeedWh = ws ? Math.round(ws.longestDarkH * 95) : 0
    const slopeDeg = siteData.slope_deg ?? localTerrain?.slopeDeg ?? null
    const errors: { level: 'fail' | 'warn'; title: string; detail: string }[] = []

    if (slopeDeg !== null && slopeDeg > 8) {
      errors.push({
        level: 'fail',
        title: `Slope exceeds 8° lander limit (${slopeDeg.toFixed(1)}°)`,
        detail: `Touchdown stability hazard (+${(slopeDeg - 8).toFixed(1)}° over limit).`,
      })
    }
    if (!ws) {
      errors.push({
        level: 'warn',
        title: '14-day window crosses year boundary',
        detail: 'Pick an earlier start date in the current ephemeris year for a complete 336-hour ledger.',
      })
    } else {
      if (ws.sunPct < DEFAULT_THRESHOLDS.minSunPct) {
        errors.push({
          level: 'fail',
          title: `Low sunlight (${ws.sunPct.toFixed(1)}% < ${DEFAULT_THRESHOLDS.minSunPct}% required)`,
          detail: `Solar array duty cycle falls short by ${(DEFAULT_THRESHOLDS.minSunPct - ws.sunPct).toFixed(1)} percentage points.`,
        })
      }
      if (ws.longestDarkH > DEFAULT_THRESHOLDS.maxDarkH) {
        errors.push({
          level: 'fail',
          title: `Excessive darkness gap (${formatDuration(ws.longestDarkH)} > ${DEFAULT_THRESHOLDS.maxDarkH}h max)`,
          detail: `Requires ${darkBatteryNeedWh.toLocaleString()} Wh survival battery capacity to prevent freeze-out.`,
        })
      }
      if (ws.earthPct < DEFAULT_THRESHOLDS.minEarthPct) {
        errors.push({
          level: 'fail',
          title: `Insufficient direct Earth link (${ws.earthPct.toFixed(1)}% < ${DEFAULT_THRESHOLDS.minEarthPct}% required)`,
          detail: 'Extended Earth occultation behind polar terrain rims.',
        })
      }
    }

    if (neighborhood.inPolarGrid && neighborhood.steepCount > 0) {
      errors.push({
        level: neighborhood.steepCount > 8 ? 'fail' : 'warn',
        title: `${neighborhood.steepCount}/${neighborhood.sampleCount} nearby terrain sectors exceed 8° slope`,
        detail: `Steepest flanks within 4 km: ${neighborhood.steepSectors.join(', ')}.`,
      })
    }

    // 336-hour timeline array for crisp visual strip in Section 03
    const timeline: State[] = []
    for (let k = 0; k < Math.min(hours, siteData.samples - hourIdx); k++) {
      timeline.push(stateAt(siteData, hourIdx + k))
    }

    return {
      hourIdx,
      ws,
      v,
      slopeDeg,
      energyWh: Math.round(energyWh),
      avgW: Math.round(avgW),
      darkBatteryNeedWh,
      surplusWh: Math.round(energyWh - darkBatteryNeedWh),
      errors,
      timeline,
    }
  }, [siteData, ephemeris, localTerrain, neighborhood])

  // Science, minerals & cryogenic water ice dossiers
  const scienceInfo = useMemo(() => {
    const trade = getSiteScienceStats({
      id: selectedSiteId !== 'custom' ? selectedSiteId : undefined,
      lat: selectedPoint.lat,
      lon: selectedPoint.lon,
      metrics: siteData?.metrics,
    })
    const closestPsrs = nearbyPsrs(selectedPoint.lat, selectedPoint.lon, 3)
    const psrNear = closestPsrs[0] ?? { ...nearestPsr(selectedPoint.lat, selectedPoint.lon), bearingDeg: 0 }
    const artNear = nearestArtemisDossier(selectedPoint.lat, selectedPoint.lon)
    return { trade, closestPsrs, psrNear, artNear }
  }, [selectedPoint, selectedSiteId, siteData])

  // Run 4x2 km Landing Ellipse Monte-Carlo worker check
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
          // Batch state updates cleanly so React doesn't re-render Cesium 41 times!
          if (completed % 6 === 0 || completed === geom.points.length) {
            setEllipseState((prev) =>
              prev && prev.key === key
                ? { ...prev, points: [...pts], done: completed, running: completed < geom.points.length }
                : prev,
            )
          }
        },
        year,
      ).catch(() => {
        alive = false
        setEllipseState((prev) => (prev && prev.key === key ? { ...prev, running: false } : prev))
      })
    },
    [year],
  )

  const ellipseDraw: EllipseDrawData | null = useMemo(() => {
    if (!ellipseState) return null
    const hourIdx = Math.max(0, Math.round(ephemeris?.hourIndex ?? 0))
    const missionHours = DEFAULT_THRESHOLDS.missionDays * 24
    const judged: { j: number; v: Viability; reasons: string[] }[] = []
    let steepSamples = 0
    const viabilities: Viability[] = ellipseState.points.map((p, j) => {
      if (!p) return 'nodata'
      const res = judge(p, hourIdx, missionHours, DEFAULT_THRESHOLDS, 8)
      if (res.steep) steepSamples++
      const rList = reasons(p, res, DEFAULT_THRESHOLDS, 8).map((r) => r.text)
      judged.push({ j, v: res.v, reasons: rList })
      return res.v
    })
    const chance = judged.length > 0 ? landingChance(judged, ellipseState.weights) : null
    const verdict = chance !== null && ellipseState.done === ellipseState.total ? verdictOf(chance.ok) : null
    const viableCount = viabilities.filter((v) => v === 'viable').length
    const marginalCount = viabilities.filter((v) => v === 'marginal').length
    const failCount = viabilities.filter((v) => v === 'not').length
    return {
      center: { lat: selectedPoint.lat, lon: selectedPoint.lon },
      spec: DEFAULT_ELLIPSE,
      points: ellipseState.points,
      cells: ellipseState.cells,
      viabilities,
      chancePct: chance !== null ? Math.round(chance.ok * 100) : null,
      verdict,
      steepSamples,
      viableCount,
      marginalCount,
      failCount,
    } as EllipseDrawData & { steepSamples: number; viableCount: number; marginalCount: number; failCount: number }
  }, [ellipseState, ephemeris, selectedPoint])

  // Automated one-click Pipeline: picks #1 best site at selected UTC instant, runs animated 5-stage synthesis + dispersion
  const runAutomatedPipeline = useCallback(
    (scrollToReport = true) => {
      if (pipeTimerRef.current) window.clearInterval(pipeTimerRef.current)
      setPipeActive(true)
      setPipeRunning(true)
      setPipeStage(1)
      setPipeRunCount((c) => c + 1)

      // Pick the best polar site for the exact chosen clock instant from preloaded static pool
      const winner = rankedCandidates[0]?.site ?? sites.find((s) => s.id === 'best-lit')
      if (winner) {
        setSelectedSiteId(winner.id)
        cesiumRef.current?.flyTo(winner.lat, winner.lon, 72, -52, 1.3)
        if (winner.lat <= -85) {
          const expectedKey = `${winner.lat.toFixed(4)},${winner.lon.toFixed(4)},${year}`
          if (!ellipseState || ellipseState.key !== expectedKey) {
            runEllipseCheck(winner.lat, winner.lon)
          }
        }
      }

      // Smooth animated stage-by-stage reveal (~2.0s total)
      let s = 1
      pipeTimerRef.current = window.setInterval(() => {
        s += 1
        setPipeStage(s)
        if (s >= 5) {
          if (pipeTimerRef.current) window.clearInterval(pipeTimerRef.current)
          pipeTimerRef.current = null
          setPipeRunning(false)
        }
      }, 380)

      if (scrollToReport && dossierRef.current) {
        window.setTimeout(() => {
          dossierRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 420)
      }
    },
    [rankedCandidates, sites, year, ellipseState, runEllipseCheck],
  )

  useEffect(() => {
    return () => {
      if (pipeTimerRef.current) window.clearInterval(pipeTimerRef.current)
    }
  }, [])

  // Handle clicking anywhere on 3D globe or 2D map
  const handlePickPoint = useCallback(
    async (lat: number, lon: number, label?: string, siteId?: string) => {
      const normLon = ((((lon + 180) % 360) + 360) % 360) - 180
      if (siteId) {
        setSelectedSiteId(siteId)
        const s = sites.find((x) => x.id === siteId)
        cesiumRef.current?.flyTo(s?.lat ?? lat, s?.lon ?? normLon, 95, -52, 1.1)
        return
      }
      const match = sites.find((s) => Math.abs(s.lat - lat) < 0.04 && Math.abs((((s.lon + 180) % 360) - 180) - normLon) < 0.04)
      if (match) {
        setSelectedSiteId(match.id)
        cesiumRef.current?.flyTo(match.lat, match.lon, 95, -52, 1.1)
        return
      }
      setSelectedSiteId('custom')
      setSelectedPoint({
        lat,
        lon: normLon,
        name: label ?? `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(normLon).toFixed(2)}°${normLon < 0 ? 'W' : 'E'}`,
      })
      cesiumRef.current?.flyTo(lat, normLon, lat < -80 ? 95 : 360, -56, 1.1)
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

  const dsn = useMemo(() => approxDsnStation(timeMs), [timeMs])
  const toggleLayer = (k: keyof ExplorerLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }))

  const sunFluxWm2 = localSky && localSky.sunVis
    ? Math.round(1361 * Math.max(0.05, Math.sin((Math.max(1, localSky.sunTop.elDeg) * Math.PI) / 180)))
    : 0

  const extraEllipse = ellipseDraw as (EllipseDrawData & {
    steepSamples?: number
    viableCount?: number
    marginalCount?: number
    failCount?: number
  }) | null

  const finalVerdictState: 'ok' | 'caution' | 'fail' =
    missionEval?.v === 'viable' && ellipseDraw?.verdict !== 'fail'
      ? 'ok'
      : missionEval?.v === 'not' || ellipseDraw?.verdict === 'fail'
        ? 'fail'
        : 'caution'

  const lonDisplay = ((((selectedPoint.lon + 180) % 360) + 360) % 360) - 180

  return (
    <div className="mx-page">
      {/* Matching Site Sheet Header Collar */}
      <div className="mx-collar-wrap">
        <header className="top">
          <a className="mark" href="./" title="About Lunar Statio">
            <Mark />
            <h1>
              Lunar Statio
              <span>3D/2D Explorer &amp; Pipeline</span>
            </h1>
          </a>
          <p className="sheet-id" aria-label="Current target">
            <b>{selectedPoint.name}</b>
            <span>
              {Math.abs(selectedPoint.lat).toFixed(3)}°{selectedPoint.lat < 0 ? 'S' : 'N'},{' '}
              {Math.abs(lonDisplay).toFixed(2)}°{lonDisplay < 0 ? 'W' : 'E'}
            </span>
            <span>{year}</span>
          </p>
          <div className="tools-row">
            <button
              type="button"
              className="primary mx-run-btn"
              onClick={() => runAutomatedPipeline(true)}
            >
              {pipeRunning ? 'Running Pipeline…' : 'Run Full Pipeline at This Time'}
            </button>
          </div>
          <nav className="views" aria-label="Screens">
            <button onClick={() => { location.search = '?view=site' }}>Site and plan</button>
            <button onClick={() => { location.search = '?view=find' }}>Find sites</button>
            <button onClick={() => { location.search = '?view=globe' }}>Globe</button>
            <button onClick={() => { location.search = '?view=map' }}>Map</button>
            <button onClick={() => { location.search = '?view=3d' }}>3D</button>
            <button onClick={() => { location.search = '?view=compare' }}>Compare</button>
            <button onClick={() => { location.search = '?view=lander' }}>Lander systems</button>
            <button aria-pressed="true">Explorer + Pipeline</button>
          </nav>
          <div className="controls-row">
            <label className="site-pick">
              <span>Target</span>
              <select
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
                  if (s) cesiumRef.current?.flyTo(s.lat, s.lon, s.lat < -80 ? 85 : 320, -52, 1.1)
                }}
              >
                <optgroup label="Mission Sites (South Pole)">
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
            </label>
            <label className="site-pick year-pick">
              <span>Year</span>
              <select value={year} onChange={(e) => handleYearChange(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
      </div>

      {/* TOP WORKSPACE: Split 3D + 2D Map on Left, Telemetry + Errors + 24h Clock on Right Sidebar */}
      <section className="mx-hero" aria-label="Interactive 3D Moon, 2D Map, and 24-Hour Clock">
        <div className={`mx-split-stage ${expand2d ? 'wide-2d' : ''}`}>
          {/* 3D Cesium Moon */}
          <div className={`mx-plate mx-plate-3d ${expand2d ? 'is-collapsed' : ''}`}>
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
            <div className="mx-cam-bar">
              <span className="mx-cam-tag">
                {cameraCenter
                  ? `3D · ${Math.abs(cameraCenter.lat).toFixed(1)}°${cameraCenter.lat < 0 ? 'S' : 'N'}, ${Math.abs(cameraCenter.lon).toFixed(1)}°${cameraCenter.lon < 0 ? 'W' : 'E'} · ${cameraCenter.heightKm >= 100 ? Math.round(cameraCenter.heightKm) : cameraCenter.heightKm.toFixed(1)} km`
                  : '3D LRO WAC Moon'}
              </span>
              <div className="mx-cam-btns">
                <button type="button" onClick={() => cesiumRef.current?.zoomIn()} title="Zoom in">
                  +
                </button>
                <button type="button" onClick={() => cesiumRef.current?.zoomOut()} title="Zoom out">
                  −
                </button>
                <button type="button" onClick={() => cesiumRef.current?.resetSouthPole()} title="Center on South Pole">
                  Pole
                </button>
                <button
                  type="button"
                  onClick={() => cesiumRef.current?.flyTo(0, ephemeris?.subSolar.lon ?? 0, 3800, -89, 1.0)}
                  title="Whole Moon view"
                >
                  Full Moon
                </button>
              </div>
            </div>
          </div>

          {/* 2D Survey Map */}
          <div className="mx-plate mx-plate-2d">
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
            <button
              type="button"
              className="mx-expand-2d"
              onClick={() => setExpand2d((v) => !v)}
              title="Toggle 2D width"
            >
              {expand2d ? 'Show Split 3D + 2D' : 'Expand 2D'}
            </button>
          </div>
        </div>

        {/* RIGHT SIDEBAR: Pipeline Actions, Live Errors & Telemetry, and 24-Hour Clock below */}
        <aside className="mx-sidebar">
          {/* Compact Site State & Clear Errors Box */}
          <div className="mx-side-card">
            <div className="mx-side-head">
              <div>
                <span className="mx-eyebrow">{ephemeris?.phaseName ?? 'Ephemeris'}</span>
                <h2>{selectedPoint.name}</h2>
              </div>
              <span className={`mx-verdict-pill st-${finalVerdictState}`}>
                {missionEval?.v === 'viable' ? 'Viable' : missionEval?.v === 'not' ? 'Fails Needs' : 'Marginal'}
              </span>
            </div>

            {localSky && (
              <div className={`mx-sky-line st-${localSky.status}`}>
                <span className="mx-dot" />
                <span>
                  {localSky.status === 'both' && 'Sunlit + Direct Earth Link'}
                  {localSky.status === 'sun' && 'Sunlit · Earth occulted'}
                  {localSky.status === 'earth' && 'Darkness · Earth link up'}
                  {localSky.status === 'none' && 'In shadow · Earth occulted'}
                </span>
              </div>
            )}

            <div className="mx-side-metrics">
              <div>
                <span>Sun Az / El</span>
                <b className="c-sun">
                  {localSky ? `${localSky.sunTop.azDeg.toFixed(1)}° / ${localSky.sunTop.elDeg >= 0 ? '+' : '−'}${Math.abs(localSky.sunTop.elDeg).toFixed(2)}°` : '—'}
                </b>
              </div>
              <div>
                <span>Earth Az / El</span>
                <b className="c-earth">
                  {localSky ? `${localSky.earthTop.azDeg.toFixed(1)}° / ${localSky.earthTop.elDeg >= 0 ? '+' : '−'}${Math.abs(localSky.earthTop.elDeg).toFixed(2)}°` : '—'}
                </b>
              </div>
              <div>
                <span>Array Flux</span>
                <b>{sunFluxWm2} W/m²</b>
              </div>
              <div>
                <span>Water Ice</span>
                <b className="c-ice">{scienceInfo.psrNear.distKm.toFixed(1)} km ({scienceInfo.psrNear.psr.tempK} K)</b>
              </div>
            </div>

            {/* Immediate Error Flags in Sidebar */}
            {missionEval && missionEval.errors.length > 0 ? (
              <ul className="mx-error-flags">
                {missionEval.errors.slice(0, 3).map((err, i) => (
                  <li key={i} className={`err-${err.level}`}>
                    <b>{err.level === 'fail' ? 'Error' : 'Warn'}:</b> {err.title}
                  </li>
                ))}
              </ul>
            ) : missionEval ? (
              <p className="mx-ok-line">No slope, power, or darkness limit errors for this window.</p>
            ) : null}

            {selectedPoint.lat <= -85 && (
              <div className="mx-side-actions">
                {selectedSiteId === 'custom' && (
                  <button type="button" className="primary" disabled={busyCustom} onClick={handleComputeExactCustom}>
                    {busyCustom ? 'Solving LOLA Horizon…' : 'Solve Exact Custom Point'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={ellipseState?.running}
                  onClick={() => runEllipseCheck(selectedPoint.lat, selectedPoint.lon)}
                >
                  {ellipseState?.running
                    ? `Checking ${ellipseState.done}/${ellipseState.total}…`
                    : extraEllipse?.chancePct !== null && extraEllipse?.chancePct !== undefined
                      ? `Re-check 4×2 km Ellipse (${extraEllipse.chancePct}% safe)`
                      : 'Check 4×2 km Error Ellipse'}
                </button>
              </div>
            )}
            {customErr && <p className="mx-err-text">{customErr}</p>}

            <div className="mx-side-toggles">
              <label className="mx-check">
                <input
                  type="checkbox"
                  checked={autoFollowClock}
                  onChange={(e) => setAutoFollowClock(e.target.checked)}
                />
                <span>Auto-select best site when time changes</span>
              </label>
              <button
                type="button"
                className="mx-link-subtle"
                onClick={() => setLayersOpen((o) => !o)}
              >
                {layersOpen ? 'Hide map layers ▲' : 'Map & 3D layers ▼'}
              </button>
            </div>

            {layersOpen && (
              <div className="mx-layers-pop">
                {([
                  ['wacImagery', 'LRO WAC Mosaic'],
                  ['elevationTint', 'LOLA Color Relief'],
                  ['solarLighting', 'Solar Terminator'],
                  ['psrs', 'Ice PSRs (<110 K)'],
                  ['artemis', 'Artemis III Regions'],
                  ['sites', 'Survey Sites'],
                  ['rays', 'Sun & Earth Vectors'],
                  ['ellipse', 'Landing Error Ellipse'],
                ] as [keyof ExplorerLayers, string][]).map(([k, lbl]) => (
                  <label key={k} className="mx-check">
                    <input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} />
                    <span>{lbl}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 24-Hour Clock Mounted Below the Right Sidebar */}
          <div className="mx-side-card mx-clock-card">
            <div className="mx-side-head">
              <span className="mx-eyebrow">24h Mission Clock (Rotate Hands)</span>
              <span className="mx-mono-sm">{dsn.active}</span>
            </div>
            <div className="mx-clock-center">
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
                size={212}
              />
            </div>
            <div className="mx-clock-controls">
              <button type="button" onClick={() => { setPlaying(false); setTimeMs((t) => Math.max(minMs, t - 86_400_000)) }} title="-1 day">
                −1d
              </button>
              <button type="button" onClick={() => { setPlaying(false); setTimeMs((t) => Math.max(minMs, t - 3_600_000)) }} title="-1 hour">
                −1h
              </button>
              <button
                type="button"
                className={playing ? 'primary' : ''}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => setSpeedIdx((i) => (i + 1) % PLAY_SPEEDS.length)}
                title="Cycle speed"
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
        </aside>
      </section>

      {/* BELOW THE FOLD: Auto-Running Pipeline Progress + Scrollable Survey Report */}
      <section className="mx-dossier" ref={dossierRef} aria-label="Automated Pipeline Summary Report">
        {/* Pipeline Stepper Banner */}
        <div className="mx-pipe-banner">
          <div className="mx-pipe-banner-top">
            <div>
              <span className="mx-eyebrow">Automated Pipeline Synthesis · {formatUtcFull(timeMs)}</span>
              <h2>Full Mission Report — {selectedPoint.name}</h2>
            </div>
            <div className="mx-pipe-cta-group">
              <span className={`mx-verdict-large st-${finalVerdictState}`}>
                {finalVerdictState === 'ok'
                  ? 'GO · TARGET CLEARED'
                  : finalVerdictState === 'caution'
                    ? 'CAUTION · REVIEW RISKS'
                    : 'NO-GO · ERRORS DETECTED'}
              </span>
              <button type="button" className="primary" onClick={() => runAutomatedPipeline(false)}>
                Re-run Pipeline for Current Time
              </button>
            </div>
          </div>

          {/* Animated 5-Stage Progress Ribbon */}
          <div className="mx-pipe-rail">
            {PIPELINE_STAGES.map((st, idx) => {
              const sNum = idx + 1
              const reached = pipeActive ? pipeStage >= sNum : true
              const current = pipeRunning && pipeStage === sNum
              return (
                <a
                  key={st.id}
                  href={`#sec-${st.id}`}
                  className={`mx-rail-step ${reached ? 'done' : ''} ${current ? 'current' : ''}`}
                >
                  <span className="mx-rail-num">{st.num}</span>
                  <span>{st.label}</span>
                </a>
              )
            })}
          </div>
        </div>

        {/* 01 · Best Location Selection & Candidate Table */}
        <article id="sec-best-site" key={`s1-${pipeRunCount}`} className={`mx-sec ${pipeStage >= 1 ? 'mx-reveal' : 'mx-pending'}`}>
          <aside className="mx-margin">01 · Best Site</aside>
          <div className="mx-sec-body">
            <div className="mx-sec-head">
              <h3>Time-Matched Best Landing Site Ranking ({DEFAULT_THRESHOLDS.missionDays}-Day Window)</h3>
              <p>
                Every precomputed polar candidate is scored instantaneously at <b>{formatUtcFull(timeMs)}</b> using JPL DE421 illumination,
                Earth visibility, longest darkness continuity, and 240 m LOLA terrain slope.
              </p>
            </div>

            {rankedCandidates.length > 0 && (
              <div className="mx-table-wrap">
                <table className="mx-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Site</th>
                      <th>Slope</th>
                      <th>Sun %</th>
                      <th>Earth %</th>
                      <th>Longest Dark</th>
                      <th>Ice PSR</th>
                      <th>Status / Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedCandidates.map((c, idx) => {
                      const active = c.site.id === selectedSiteId
                      return (
                        <tr
                          key={c.site.id}
                          className={`${active ? 'is-selected' : ''} ${idx === 0 ? 'is-winner' : ''}`}
                          onClick={() => handlePickPoint(c.site.lat, c.site.lon, c.site.name, c.site.id)}
                        >
                          <td>#{idx + 1}</td>
                          <td>
                            <b>{c.site.name}</b>
                            {idx === 0 && <span className="mx-tag-best">Best now</span>}
                          </td>
                          <td>{c.slopeDeg !== null ? `${c.slopeDeg.toFixed(1)}°` : '—'}</td>
                          <td className="c-sun">{c.stats ? `${c.stats.sunPct.toFixed(0)}%` : '—'}</td>
                          <td className="c-earth">{c.stats ? `${c.stats.earthPct.toFixed(0)}%` : '—'}</td>
                          <td>{c.stats ? formatDuration(c.stats.longestDarkH) : '—'}</td>
                          <td className="c-ice">{c.psrKm.toFixed(1)} km</td>
                          <td>
                            {c.errors.length === 0 ? (
                              <span className="mx-badge-ok">Meets all criteria</span>
                            ) : (
                              <span className={c.v === 'not' ? 'mx-badge-bad' : 'mx-badge-warn'}>{c.errors[0]}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </article>

        {/* 02 · Errors, Steep Ridges & 4x2 km Landing Dispersion */}
        <article id="sec-errors" key={`s2-${pipeRunCount}`} className={`mx-sec ${pipeStage >= 2 ? 'mx-reveal' : 'mx-pending'}`}>
          <aside className="mx-margin">02 · Errors</aside>
          <div className="mx-sec-body">
            <div className="mx-sec-head">
              <h3>Landing Errors, Steep Terrain Near Site &amp; 4×2 km Dispersion</h3>
              <p>
                Clear pass/fail engineering checks plus a 4 km static LOLA neighborhood hazard scan and 41-point Gaussian
                touchdown dispersion ellipse around the target.
              </p>
            </div>

            <div className="mx-two-col">
              <div className="mx-box">
                <h4>Explicit Mission Errors &amp; Limit Checks</h4>
                {missionEval && missionEval.errors.length > 0 ? (
                  <ul className="mx-err-detail-list">
                    {missionEval.errors.map((e, i) => (
                      <li key={i} className={`err-${e.level}`}>
                        <strong>{e.title}</strong>
                        <span>{e.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mx-pass-panel">
                    <strong>All primary threshold limits passed</strong>
                    <span>
                      Slope ≤ 8° ({(missionEval?.slopeDeg ?? localTerrain?.slopeDeg ?? 0).toFixed(1)}°), Sunlight ≥ {DEFAULT_THRESHOLDS.minSunPct}%,
                      Darkness ≤ {DEFAULT_THRESHOLDS.maxDarkH}h, Earth Link ≥ {DEFAULT_THRESHOLDS.minEarthPct}%.
                    </span>
                  </div>
                )}

                <h4 className="mx-sub-h">Surrounding Terrain Within 4 km (240 m LOLA)</h4>
                {neighborhood.inPolarGrid ? (
                  <div className="mx-stat-pair">
                    <div>
                      <span>Elevation Range</span>
                      <b>
                        {Math.round(neighborhood.minElevM ?? 0)} m to {Math.round(neighborhood.maxElevM ?? 0)} m
                      </b>
                    </div>
                    <div>
                      <span>Mean / Max Slope</span>
                      <b className={(neighborhood.maxSlopeDeg ?? 0) > 8 ? 'c-bad' : 'c-ok'}>
                        {(neighborhood.meanSlopeDeg ?? 0).toFixed(1)}° / {(neighborhood.maxSlopeDeg ?? 0).toFixed(1)}°
                      </b>
                    </div>
                    <div className="full">
                      <span>Error Regions Nearby</span>
                      <b>
                        {neighborhood.steepSectors.length > 0
                          ? `Avoid steep flanks (>8°): ${neighborhood.steepSectors.join(' · ')}`
                          : 'No steep >8° hazard sectors detected inside 4 km radius'}
                      </b>
                    </div>
                  </div>
                ) : (
                  <p className="mx-muted">Point is outside the 85–90°S LOLA high-resolution hazard grid.</p>
                )}
              </div>

              <div className="mx-box">
                <div className="mx-box-row">
                  <h4>4×2 km Gaussian Landing Error Ellipse</h4>
                  <button
                    type="button"
                    disabled={selectedPoint.lat > -85 || ellipseState?.running}
                    onClick={() => runEllipseCheck(selectedPoint.lat, selectedPoint.lon)}
                  >
                    {ellipseState?.running ? 'Computing…' : 'Run / Refresh'}
                  </button>
                </div>
                {extraEllipse && extraEllipse.chancePct !== null ? (
                  <>
                    <div className="mx-ellipse-score">
                      <span className={`mx-big-num v-${extraEllipse.verdict ?? 'caution'}`}>
                        {extraEllipse.chancePct}%
                      </span>
                      <div>
                        <b>{extraEllipse.verdict ? VERDICT_LABEL[extraEllipse.verdict] : 'Computing sample horizon masks…'}</b>
                        <span>Weighted safe touchdown probability ({ellipseState?.done}/{ellipseState?.total} cells checked)</span>
                      </div>
                    </div>
                    <div className="mx-bar-track">
                      <div className="mx-bar-fill c-ok-bg" style={{ width: `${extraEllipse.chancePct}%` }} />
                    </div>
                    <div className="mx-stat-pair">
                      <div>
                        <span>Safe Samples</span>
                        <b className="c-ok">{extraEllipse.viableCount ?? 0}</b>
                      </div>
                      <div>
                        <span>Marginal Samples</span>
                        <b className="c-warn">{extraEllipse.marginalCount ?? 0}</b>
                      </div>
                      <div>
                        <span>Failed Samples</span>
                        <b className="c-bad">{extraEllipse.failCount ?? 0}</b>
                      </div>
                      <div>
                        <span>Steep (&gt;8°) Cells</span>
                        <b className="c-bad">{extraEllipse.steepSamples ?? 0}</b>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mx-muted">
                    {selectedPoint.lat <= -85
                      ? 'Click "Run / Refresh" or "Run Full Pipeline" to sample 41 points inside the 4×2 km footprint.'
                      : '4×2 km ellipse hazard sampling applies to 85–90°S polar terrain.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </article>

        {/* 03 · Lander Power, Energy Ledger & 14-Day Hourly Timeline */}
        <article id="sec-energy" key={`s3-${pipeRunCount}`} className={`mx-sec ${pipeStage >= 3 ? 'mx-reveal' : 'mx-pending'}`}>
          <aside className="mx-margin">03 · Lander</aside>
          <div className="mx-sec-body">
            <div className="mx-sec-head">
              <h3>Lander Systems, Solar Harvest &amp; Darkness Survival Energy</h3>
              <p>
                Reference array: {DEFAULT_ARRAY.areaM2} m² at {DEFAULT_ARRAY.effPct}% efficiency
                ({Math.round(peakWatts(DEFAULT_ARRAY))} W peak), vs. 95 W continuous lander survival heater/avionics draw during longest darkness.
              </p>
            </div>

            {missionEval && (
              <>
                <div className="mx-kpi-row">
                  <div className="mx-kpi">
                    <span>14-Day Solar Harvest</span>
                    <b className="c-sun">{(missionEval.energyWh / 1000).toFixed(1)} kWh</b>
                    <small>{missionEval.energyWh.toLocaleString()} Wh total · {missionEval.avgW} W mean</small>
                  </div>
                  <div className="mx-kpi">
                    <span>Sunlit Window</span>
                    <b className="c-sun">{missionEval.ws ? `${missionEval.ws.sunPct.toFixed(1)}%` : '—'}</b>
                    <small>{missionEval.ws ? `${Math.round((missionEval.ws.sunPct / 100) * 336)} h of 336 h` : 'Crosses year boundary'}</small>
                  </div>
                  <div className="mx-kpi">
                    <span>Night Battery Needed</span>
                    <b className={missionEval.darkBatteryNeedWh > 4500 ? 'c-bad' : 'c-ok'}>
                      {(missionEval.darkBatteryNeedWh / 1000).toFixed(2)} kWh
                    </b>
                    <small>{missionEval.ws ? `Max gap: ${formatDuration(missionEval.ws.longestDarkH)}` : '—'}</small>
                  </div>
                  <div className="mx-kpi">
                    <span>Earth Comms Availability</span>
                    <b className="c-earth">{missionEval.ws ? `${missionEval.ws.earthPct.toFixed(1)}%` : '—'}</b>
                    <small>{dsn.active}</small>
                  </div>
                </div>

                <div className="mx-box">
                  <div className="mx-box-row">
                    <h4>336-Hour Illumination &amp; Comms Strip (Starting {formatUtcFull(timeMs).slice(0, 11)})</h4>
                    <div className="mx-legend-inline">
                      <span><i className="sw both" />Both</span>
                      <span><i className="sw sun" />Sun</span>
                      <span><i className="sw earth" />Earth</span>
                      <span><i className="sw none" />Dark</span>
                    </div>
                  </div>
                  <div className="mx-timeline" role="img" aria-label="14-day hourly illumination timeline">
                    {missionEval.timeline.map((st, idx) => (
                      <span key={idx} className={`tl-${st}`} />
                    ))}
                  </div>
                  <div className="mx-timeline-scale">
                    <span>Hour 0</span>
                    <span>Day 3.5</span>
                    <span>Day 7</span>
                    <span>Day 10.5</span>
                    <span>Day 14 (336 h)</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </article>

        {/* 04 · Minerals & Geology Near Site */}
        <article id="sec-minerals" key={`s4-${pipeRunCount}`} className={`mx-sec ${pipeStage >= 4 ? 'mx-reveal' : 'mx-pending'}`}>
          <aside className="mx-margin">04 · Minerals</aside>
          <div className="mx-sec-body">
            <div className="mx-sec-head">
              <h3>Mineralogy, Crustal Geology &amp; ISRU Potential Near Site</h3>
              <p>
                Matched geological dossier from NASA Artemis III candidate region data and LRO spectral surveys nearest to the chosen landing site.
              </p>
            </div>

            {scienceInfo.artNear ? (
              <div className="mx-two-col">
                <div className="mx-box">
                  <div className="mx-box-row">
                    <h4>Nearest Artemis Region: {scienceInfo.artNear.dossier.name}</h4>
                    <span className="mx-mono-sm">{scienceInfo.artNear.distKm.toFixed(1)} km away</span>
                  </div>
                  <p className="mx-prose">{scienceInfo.artNear.dossier.geology}</p>
                  <div className="mx-stat-pair">
                    <div>
                      <span>Crust Type</span>
                      <b>{scienceInfo.artNear.dossier.minerals.crust_type}</b>
                    </div>
                    <div>
                      <span>Region Elevation</span>
                      <b>{scienceInfo.artNear.dossier.elevation_km} km</b>
                    </div>
                  </div>
                  <p className="mx-prose mx-muted">{scienceInfo.artNear.dossier.minerals.details}</p>
                </div>

                <div className="mx-box">
                  <h4>Primary Minerals &amp; Harvestable ISRU Elements</h4>
                  <div className="mx-chip-row">
                    {scienceInfo.artNear.dossier.minerals.primary.map((m) => (
                      <span key={m} className="mx-chip">{m}</span>
                    ))}
                  </div>
                  <h4 className="mx-sub-h">Extractable Elements &amp; Engineering Use</h4>
                  <div className="mx-chip-row">
                    {scienceInfo.artNear.dossier.resources.isru_elements.map((el) => (
                      <span key={el} className="mx-chip isru">{el}</span>
                    ))}
                  </div>
                  <p className="mx-prose mx-muted">{scienceInfo.artNear.dossier.resources.isru_applications}</p>
                </div>
              </div>
            ) : (
              <p className="mx-muted">Select a South Pole target to view high-latitude Artemis III mineral composition.</p>
            )}
          </div>
        </article>

        {/* 05 · Water Ice & Cryogenic Resources Near Site */}
        <article id="sec-ice" key={`s5-${pipeRunCount}`} className={`mx-sec ${pipeStage >= 5 ? 'mx-reveal' : 'mx-pending'}`}>
          <aside className="mx-margin">05 · Water Ice</aside>
          <div className="mx-sec-body">
            <div className="mx-sec-head">
              <h3>Cryogenic Cold Traps (PSRs) &amp; Water Resources Near Site</h3>
              <p>
                Science trade-off zone: <b>{scienceInfo.trade.zoneLabel}</b> · Closest confirmed polar ice sinks ordered by surface distance.
              </p>
            </div>

            <div className="mx-psr-grid">
              {scienceInfo.closestPsrs.map((item, idx) => (
                <div
                  key={item.psr.id}
                  className={`mx-box mx-psr-card ${idx === 0 ? 'primary-psr' : ''}`}
                  onClick={() => handlePickPoint(item.psr.lat, item.psr.lon, item.psr.name)}
                >
                  <div className="mx-box-row">
                    <h4 className="c-ice">{item.psr.name}</h4>
                    <span className="mx-mono-sm">{item.distKm.toFixed(1)} km · {Math.round(item.bearingDeg)}°</span>
                  </div>
                  <div className="mx-stat-pair">
                    <div>
                      <span>Floor Temp</span>
                      <b>{item.psr.tempK} K</b>
                    </div>
                    <div>
                      <span>Crater Radius / Depth</span>
                      <b>{item.psr.radiusKm} km / {item.psr.depthM} m</b>
                    </div>
                  </div>
                  <p className="mx-prose">{item.psr.evidence}</p>
                </div>
              ))}
            </div>

            {scienceInfo.artNear && (
              <div className="mx-box">
                <div className="mx-box-row">
                  <h4>Volatile &amp; Subsurface Ice Evidence ({scienceInfo.artNear.dossier.resources.water_ice_potential} Potential)</h4>
                  <span className="mx-mono-sm">{scienceInfo.artNear.dossier.resources.depth_estimate}</span>
                </div>
                <p className="mx-prose">{scienceInfo.artNear.dossier.resources.water_ice_details}</p>
                <div className="mx-chip-row">
                  {scienceInfo.artNear.dossier.resources.volatiles.map((v) => (
                    <span key={v} className="mx-chip ice">{v}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </article>

        {/* 06 · Deep Links */}
        <article className="mx-sec">
          <aside className="mx-margin">06 · Open Sheet</aside>
          <div className="mx-sec-body">
            <div className="mx-deep-links">
              <a
                className="l-btn"
                href={`?view=site&site=${selectedSiteId === 'custom' ? 'best-lit' : selectedSiteId}&lat=${selectedPoint.lat.toFixed(4)}&lon=${selectedPoint.lon.toFixed(4)}`}
              >
                Open in Site &amp; Plan
              </a>
              <a
                className="l-btn"
                href={`?view=lander&site=${selectedSiteId === 'custom' ? 'best-lit' : selectedSiteId}`}
              >
                Open Lander Systems Budget
              </a>
              <a
                className="l-btn"
                href={`?view=3d&site=${selectedSiteId === 'custom' ? 'best-lit' : selectedSiteId}`}
              >
                Open 240 m GPU Shadow Terrain
              </a>
              <a
                className="l-btn"
                href={`?view=find&site=${selectedSiteId === 'custom' ? 'best-lit' : selectedSiteId}`}
              >
                Compare Nearby Sites
              </a>
            </div>
            <p className="mx-colophon">
              Sources: NASA LRO WAC global mosaic, NASA LOLA / PGDA 240 m polar illumination &amp; topography, JPL DE421 lunar ephemeris, and NASA Artemis III geology dossiers.
              Static precomputed site tracks cover {Math.round(surfaceKm(-90, 0, -85, 0))} km radius across 85–90°S.
            </p>
          </div>
        </article>
      </section>
    </div>
  )
}

export default MoonExplorer
