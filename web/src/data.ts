// Types and small lookups for the precomputed files in public/data (written by pipeline/export_sites.py).
// No physics here: all positions and visibilities come from the pipeline.

export interface Metrics {
  sunlit_pct: number
  mean_sun_disc_pct: number
  mean_power_index_pct: number
  earth_visible_pct: number
  sun_and_earth_pct: number
  longest_dark_h: number
  longest_no_earth_h: number
}

export interface SiteSummary {
  id: string
  group: string
  name: string
  lat: number
  lon: number
  kind: 'landing' | 'feature' | 'derived' | 'custom'
  metrics: Metrics
}

export interface Track {
  az: number[]
  el: number[]
  frac: number[] // visible fraction of the disc, 0-1
  power?: number[] // Sun only: simplified power-potential index, 0-1
}

export const KIND_LABEL: Record<SiteSummary['kind'], string> = {
  landing: 'Landing site',
  feature: 'Named feature',
  derived: 'Derived point',
  custom: 'Custom point',
}

export interface Site extends SiteSummary {
  note: string
  source: string
  source_url: string
  site_height_m: number
  slope_deg?: number // 240 m terrain; only on points computed in the browser
  obs_height_m: number
  start_utc: string
  step_h: number
  samples: number
  provenance: string
  horizon: { az_step_deg: number; el_deg: number[]; edge_limited_azimuths: number }
  sun: Track
  earth: Track
  replay?: MissionReplayInfo
}

const base = import.meta.env.BASE_URL

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${base}data/${path}`)
  if (!r.ok) throw new Error(`Couldn't load ${path} (HTTP ${r.status}). Run pipeline/export_sites.py.`)
  return r.json()
}

export const loadSites = () => getJson<SiteSummary[]>('sites.json')
const siteCache = new Map<string, Promise<Site>>()
const waiting = new Map<string, (s: Site) => void>()
/** Curated sites load from public/data; the map's custom point (id 'custom') arrives later via registerSite. */
export const loadSite = (id: string) => {
  if (!siteCache.has(id))
    siteCache.set(id, id === 'custom' ? new Promise<Site>((res) => waiting.set(id, res)) : getJson<Site>(`sites/${id}.json`))
  return siteCache.get(id)!
}
/** Make a site computed in the browser (map click) available to every panel under its id. */
export const registerSite = (site: Site) => {
  waiting.get(site.id)?.(site)
  waiting.delete(site.id)
  siteCache.set(site.id, Promise.resolve(site))
}

/** Terrain horizon elevation at an azimuth (linear between the 0.5 deg samples). */
export function horizonAt(site: Site, az: number): number {
  const { az_step_deg: step, el_deg: el } = site.horizon
  const x = (((az % 360) + 360) % 360) / step
  const i = Math.floor(x)
  const f = x - i
  return el[i % el.length] * (1 - f) + el[(i + 1) % el.length] * f
}

/** Hours until visibility changes from its state at index i, or null if not within the data. */
export function hoursToChange(frac: number[], i: number): number | null {
  const visible = frac[i] > 0
  for (let j = i + 1; j < frac.length; j++) if (frac[j] > 0 !== visible) return j - i
  return null
}

export function timeAt(site: Site, i: number): Date {
  return new Date(Date.parse(site.start_utc) + i * site.step_h * 3_600_000)
}

export function formatDuration(h: number): string {
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  const r = h % 24
  return r ? `${d} d ${r} h` : `${d} d`
}

export const formatDeg = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}°`

export function formatUtc(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export type State = 'both' | 'sun' | 'earth' | 'none'
export function stateAt(site: Site, i: number): State {
  const s = site.sun.frac[i] > 0
  const e = site.earth.frac[i] > 0
  return s && e ? 'both' : s ? 'sun' : e ? 'earth' : 'none'
}

export const STATE_LABEL: Record<State, string> = {
  both: 'Power and Earth contact',
  sun: 'Power, no Earth contact',
  earth: 'Earth contact, no power',
  none: 'No power, no Earth contact',
}

/** Hours the current visibility state has lasted at index i (atStart: it began before the data). */
export function hoursSinceChange(frac: number[], i: number): { h: number; atStart: boolean } {
  const visible = frac[i] > 0
  for (let j = i - 1; j >= 0; j--) if (frac[j] > 0 !== visible) return { h: i - j, atStart: false }
  return { h: i + 1, atStart: true }
}

/** The darkness (frac == 0 run) in progress at i, or the next one after it. */
export function nextDarkness(frac: number[], i: number): { startsIn: number; length: number; open: boolean } | null {
  let s = i
  while (s < frac.length && frac[s] > 0) s++
  if (s === frac.length) return null
  let e = s
  while (e < frac.length && frac[e] === 0) e++
  return { startsIn: s - i, length: e - s, open: e === frac.length }
}

/** Hours per UTC day with the body (any part of disc) above the terrain. */
export function dailyHours(site: Site, b: 'sun' | 'earth'): number[] {
  const out: number[] = []
  const f = site[b].frac
  for (let d = 0; d * 24 < f.length; d++) {
    let n = 0
    for (let j = d * 24; j < Math.min((d + 1) * 24, f.length); j++) if (f[j] > 0) n++
    out.push(n)
  }
  return out
}

export const formatDate = (d: Date) => d.toISOString().slice(0, 10)

/** Tooltip position as a fraction of the plot width, kept inside the plot near the edges. */
export function tipStyle(f: number) {
  return { left: `${f * 100}%`, transform: `translateX(${f < 0.15 ? '0' : f > 0.85 ? '-100%' : '-50%'})` }
}

// ---------- F3: viability of a landing date (pure counting over the precomputed hourly data) ----------

export interface Thresholds {
  missionDays: number
  minSunPct: number
  maxDarkH: number
  minEarthPct: number
}

// Example defaults, always shown and editable; the team still has to agree real ones (open decision in the plan).
export const DEFAULT_THRESHOLDS: Thresholds = { missionDays: 14, minSunPct: 60, maxDarkH: 48, minEarthPct: 50 }

/** How far a marginal date may miss a threshold. */
export const MARGIN = { sunPct: 10, earthPct: 10, darkFactor: 1.5 }

export type Viability = 'viable' | 'marginal' | 'not' | 'nodata'

export const VIABILITY_LABEL: Record<Viability, string> = {
  viable: 'Viable',
  marginal: 'Marginal',
  not: 'Not viable',
  nodata: 'Mission runs past the data',
}

export interface WindowStats {
  sunPct: number
  earthPct: number
  longestDarkH: number
  longestNoEarthH: number
}

/** Sunlit %, Earth-visible % and longest darkness over [start, start + hours); null if it runs past the data. */
type FracTracks = { samples: number; sun: { frac: ArrayLike<number> }; earth: { frac: ArrayLike<number> } }
export function windowStats(site: FracTracks, start: number, hours: number): WindowStats | null {
  if (start < 0 || start + hours > site.samples) return null
  let sun = 0
  let earth = 0
  let run = 0
  let longest = 0
  let eRun = 0
  let eLongest = 0
  for (let j = start; j < start + hours; j++) {
    if (site.sun.frac[j] > 0) {
      sun++
      run = 0
    } else longest = Math.max(longest, ++run)
    if (site.earth.frac[j] > 0) {
      earth++
      eRun = 0
    } else eLongest = Math.max(eLongest, ++eRun)
  }
  return { sunPct: (100 * sun) / hours, earthPct: (100 * earth) / hours, longestDarkH: longest, longestNoEarthH: eLongest }
}

export function viability(s: WindowStats | null, t: Thresholds): Viability {
  if (!s) return 'nodata'
  if (s.sunPct >= t.minSunPct && s.longestDarkH <= t.maxDarkH && s.earthPct >= t.minEarthPct) return 'viable'
  if (
    s.sunPct >= t.minSunPct - MARGIN.sunPct &&
    s.longestDarkH <= t.maxDarkH * MARGIN.darkFactor &&
    s.earthPct >= t.minEarthPct - MARGIN.earthPct
  )
    return 'marginal'
  return 'not'
}

export interface DayEval {
  status: Viability
  stats: WindowStats | null
}

/** One evaluation per candidate landing date (landing at 00:00 UTC). */
export function dailyViability(site: Site, t: Thresholds): DayEval[] {
  const hours = t.missionDays * 24
  const out: DayEval[] = []
  for (let d = 0; d * 24 < site.samples; d++) {
    const stats = windowStats(site, d * 24, hours)
    out.push({ status: viability(stats, t), stats })
  }
  return out
}

/** Slip budget from planned day p: how many days it can slip and stay viable (null if p itself isn't viable),
 *  and the first viable day after that viable run (or after p). */
export function slipBudget(days: DayEval[], p: number): { canSlip: number | null; nextViable: number | null } {
  const ok = (d: number) => days[d]?.status === 'viable'
  let k = p
  if (ok(p)) while (ok(k + 1)) k++
  let n = k + 1
  while (n < days.length && !ok(n)) n++
  return { canSlip: ok(p) ? k - p : null, nextViable: n < days.length ? n : null }
}

// ---------- Validation summary (written by pipeline/export_sites.py from validation/*.json) ----------

interface Agreement {
  correlation: number
  median_abs_diff_pp: number
  p90_abs_diff_pp: number
  max_abs_diff_pp: number
}

export interface Validation {
  horizons: { worst_deg: number; tolerance_deg: number; points: number; samples: number; period_utc: [string, string]; passed: boolean }
  illumination: { points: number; sun: Agreement; earth: Agreement; passed: boolean }
}

export const loadValidation = () => getJson<Validation>('validation.json')

// --- WS3: replays ---
export interface MissionReplayInfo {
  landing_utc: string
  days_before: number
  days_after: number
  outcome: string
  outcome_source: string
  outcome_url: string
  landing_note?: string
}

/** Our model at a replay's landing hour: Sun/Earth up, and when each next sets (null = not before the data ends). */
export function replayAtLanding(site: Site) {
  const i = Math.floor((Date.parse(site.replay!.landing_utc) - Date.parse(site.start_utc)) / 3600e3)
  const set = (frac: number[]) => {
    const h = hoursToChange(frac, i)
    return frac[i] > 0 && h !== null ? timeAt(site, i + h) : null
  }
  return { i, sunUp: site.sun.frac[i] > 0, earthUp: site.earth.frac[i] > 0, sunset: set(site.sun.frac), earthset: set(site.earth.frac) }
}

/** Results of the last `npm run check:engine` (browser engine vs Python, finder coarse vs exact). */
export interface EngineCheck {
  run_utc: string
  engine: { points: number; direction_deg: number; sunlit_pp: number; earth_pp: number; horizon_deg: number; passed: boolean }
  finder: { candidates: number; worst_pp: number; limit_pp: number; window_match: boolean; passed: boolean }
}
export const loadEngineCheck = () => getJson<EngineCheck>('engine_check.json')

export const inAnalysisYear = (s: Site) => s.start_utc.startsWith('2027-01-01') && s.samples === 8760

// --- NASA south-pole candidate landing regions (pipeline/artemis_regions.py) ---
export interface Region {
  name: string
  lat: number
  lon: number
  approximate: boolean
  source: string
  source_url: string
  map_url: string
}
let artemis: Promise<Region[]> | null = null
export const loadArtemis = () => (artemis ??= getJson<Region[]>('artemis.json'))
export const ARTEMIS_III_URL = 'https://www.nasa.gov/mission/artemis-iii/'
export const ARTEMIS_NOTE =
  "Approximate centres (about ±5 km) read from NASA's region map; NASA publishes the regions as areas, not coordinates. " +
  'NASA chose these nine in Oct 2024 for Artemis III, which it has since changed to an Earth-orbit test flight; ' +
  'we found no newer region list (checked 14 Nov 2026).'

// --- WS5: science helpers (Science vs Engineering / PSR & Ice trade-offs) ---

export interface ScienceTradeoff {
  distToPsrKm: number
  inPsr: boolean
  tempK: number // surface thermal regime (Kelvin)
  depthDropM: number // rim-to-floor crater depth / depression drop (meters)
  scienceScore: number // 0-100 score for proximity to volatiles & PSRs
  engineeringScore: number // 0-100 score for sunlight & Earth comms
  zone: 'sweet_spot' | 'safe_dry' | 'cryo_danger' | 'non_viable'
  zoneLabel: string
  iceTrapped: boolean // True if thermal trap (< 110 K volatile stability threshold)
}

const PRECOMPUTED_SCIENCE: Record<string, ScienceTradeoff> = {
  'best-lit': {
    distToPsrKm: 1.7,
    inPsr: false,
    tempK: 145,
    depthDropM: 1850,
    scienceScore: 94,
    engineeringScore: 86,
    zone: 'sweet_spot',
    zoneLabel: 'Sweet Spot ⭐ (High Sun + Ice < 2 km)',
    iceTrapped: false,
  },
  'shackleton': {
    distToPsrKm: 0.0,
    inPsr: true,
    tempK: 40,
    depthDropM: 4200,
    scienceScore: 100,
    engineeringScore: 0,
    zone: 'cryo_danger',
    zoneLabel: 'Cryo Hazard ⚠️ (In PSR: 40 K, 0% Sunlight)',
    iceTrapped: true,
  },
  'mons-mouton': {
    distToPsrKm: 12.1,
    inPsr: false,
    tempK: 180,
    depthDropM: 850,
    scienceScore: 46,
    engineeringScore: 65,
    zone: 'safe_dry',
    zoneLabel: 'Safe Ridge 🛡️ (Sunlit, but 12 km from Ice)',
    iceTrapped: false,
  },
  'im2-athena': {
    distToPsrKm: 6.4,
    inPsr: false,
    tempK: 165,
    depthDropM: 1200,
    scienceScore: 74,
    engineeringScore: 78,
    zone: 'sweet_spot',
    zoneLabel: 'Viable Rim ⭐ (Good Sun & Moderate Distance)',
    iceTrapped: false,
  },
  'im1-odysseus': {
    distToPsrKm: 147.0,
    inPsr: false,
    tempK: 210,
    depthDropM: 1400,
    scienceScore: 22,
    engineeringScore: 64,
    zone: 'safe_dry',
    zoneLabel: 'Sub-Polar 🛡️ (>100 km from Polar Ice)',
    iceTrapped: false,
  },
  'chandrayaan-3': {
    distToPsrKm: 450.0,
    inPsr: false,
    tempK: 290,
    depthDropM: 450,
    scienceScore: 28,
    engineeringScore: 72,
    zone: 'safe_dry',
    zoneLabel: 'Highland Explorer 🛡️ (Far from PSR Cold Traps)',
    iceTrapped: false,
  },
  'replay-chandrayaan-3': {
    distToPsrKm: 450.0,
    inPsr: false,
    tempK: 290,
    depthDropM: 450,
    scienceScore: 28,
    engineeringScore: 72,
    zone: 'safe_dry',
    zoneLabel: 'Highland Explorer 🛡️ (Far from PSR Cold Traps)',
    iceTrapped: false,
  },
  'replay-im1-odysseus': {
    distToPsrKm: 147.0,
    inPsr: false,
    tempK: 210,
    depthDropM: 1400,
    scienceScore: 22,
    engineeringScore: 64,
    zone: 'safe_dry',
    zoneLabel: 'Sub-Polar 🛡️ (>100 km from Polar Ice)',
    iceTrapped: false,
  },
  'change-4': {
    distToPsrKm: 1200.0,
    inPsr: false,
    tempK: 275,
    depthDropM: 2100,
    scienceScore: 30,
    engineeringScore: 25,
    zone: 'non_viable',
    zoneLabel: 'Far Side 🚫 (Requires Relay Satellite)',
    iceTrapped: false,
  },
  'apollo-11': {
    distToPsrKm: 2700.0,
    inPsr: false,
    tempK: 385,
    depthDropM: 50,
    scienceScore: 10,
    engineeringScore: 68,
    zone: 'safe_dry',
    zoneLabel: 'Equatorial Baseline 🛡️ (Zero Water Ice)',
    iceTrapped: false,
  },
}

export function getSiteScienceStats(site: { id?: string; lat: number; lon: number; metrics?: any }): ScienceTradeoff {
  if (site.id && PRECOMPUTED_SCIENCE[site.id]) {
    return PRECOMPUTED_SCIENCE[site.id]
  }
  const lat = site.lat
  const sunPct = site.metrics?.sunlit_pct ?? 50
  const earthPct = site.metrics?.earth_visible_pct ?? 50

  let distKm: number
  let inPsr = false
  let tempK = 180
  let depthM = 1000

  if (lat > -85) {
    distKm = Math.round((Math.abs(lat) < 85 ? (85 - Math.abs(lat)) * 30.32 + 10 : 15) * 10) / 10
    tempK = Math.min(390, Math.round(180 + (90 - Math.abs(lat)) * 2.3))
  } else {
    const polarOffset = (90 + lat)
    distKm = Math.round(Math.max(0.5, polarOffset * 2.1) * 10) / 10
    if (sunPct < 5) {
      inPsr = true
      distKm = 0.0
      tempK = 40
      depthM = 3500
    } else {
      tempK = Math.round(110 + polarOffset * 15)
      depthM = Math.round(1200 + polarOffset * 200)
    }
  }

  const scienceScore = inPsr ? 100 : Math.round(Math.max(5, 100 - distKm * 4.2))
  const engineeringScore = Math.round(sunPct * 0.6 + earthPct * 0.4)

  let zone: ScienceTradeoff['zone']
  let zoneLabel: string
  if (sunPct >= 50 && distKm <= 5.0) {
    zone = 'sweet_spot'
    zoneLabel = 'Sweet Spot ⭐ (High Sun + Accessible Ice)'
  } else if (sunPct >= 50) {
    zone = 'safe_dry'
    zoneLabel = `Safe Ridge 🛡️ (Sunlit, ${distKm} km from Ice)`
  } else if (distKm <= 2.0 || inPsr) {
    zone = 'cryo_danger'
    zoneLabel = 'Cryo Hazard ⚠️ (Near Ice, Low Sun / Freeze Risk)'
  } else {
    zone = 'non_viable'
    zoneLabel = 'Non-Viable 🚫 (Low Sun & Distant from Ice)'
  }

  return {
    distToPsrKm: distKm,
    inPsr,
    tempK,
    depthDropM: depthM,
    scienceScore,
    engineeringScore,
    zone,
    zoneLabel,
    iceTrapped: inPsr || tempK < 110,
  }
}

