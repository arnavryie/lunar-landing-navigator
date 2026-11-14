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
  kind: 'landing' | 'feature' | 'derived'
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
}

export interface Site extends SiteSummary {
  note: string
  source: string
  source_url: string
  site_height_m: number
  obs_height_m: number
  start_utc: string
  step_h: number
  samples: number
  provenance: string
  horizon: { az_step_deg: number; el_deg: number[]; edge_limited_azimuths: number }
  sun: Track
  earth: Track
}

const base = import.meta.env.BASE_URL

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${base}data/${path}`)
  if (!r.ok) throw new Error(`Couldn't load ${path} (HTTP ${r.status}). Run pipeline/export_sites.py.`)
  return r.json()
}

export const loadSites = () => getJson<SiteSummary[]>('sites.json')
export const loadSite = (id: string) => getJson<Site>(`sites/${id}.json`)

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
