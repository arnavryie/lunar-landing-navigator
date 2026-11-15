// Landing-ellipse sample points: exact computation in the worker pool and the planner's viability rule.
// Shared by the Map panel (Ellipse.tsx) and the Find sites check (Finder.tsx).
import { computeCustomPoint } from './customPoint'
import { DEFAULT_YEAR, siteForYear } from './years'
import type { EllipseSpec, LatLon } from './ellipseGeometry'
import { formatDuration, viability, windowStats, type Thresholds, type Viability } from './data'

export interface Sample extends LatLon {
  slope: number
  samples: number
  sun: { frac: Float32Array }
  earth: { frac: Float32Array }
}

export const DEFAULT_ELLIPSE: EllipseSpec = { lengthKm: 4, widthKm: 2, headingDeg: 0 } // example only, not a specific lander

export type Run = { key: string; points: (Sample | null)[]; total: number; spacingM: number; weights: number[]; cells: (LatLon[] | null)[] }
// Inputs and results outlive the panel, so switching to the 3D tab and back keeps them.
// Find sites and the Map share the slope limit and ellipse size through it too; autoRun = analyse as soon as the Map opens.
export const saved: { spec: EllipseSpec; circle: boolean; maxSlope: number; run: Run | null; autoRun: boolean } = {
  spec: DEFAULT_ELLIPSE, circle: false, maxSlope: 8, run: null, autoRun: false,
}

/** Compute sample points exactly, 8 at a time so a cancelled run (alive() = false) stops queuing work. */
export async function computeSamples(points: LatLon[], alive: () => boolean, onPoint: (j: number, p: Sample | null) => void, year = DEFAULT_YEAR) {
  let next = 0
  const lane = async () => {
    while (next < points.length && alive()) {
      const j = next++
      const s = await computeCustomPoint(points[j].lat, points[j].lon, false).then((x) => siteForYear(x, year)).catch(() => null)
      if (!alive()) return
      onPoint(j, s && {
        ...points[j],
        slope: s.slope_deg ?? NaN,
        samples: s.samples,
        sun: { frac: Float32Array.from(s.sun.frac) },
        earth: { frac: Float32Array.from(s.earth.frac) },
      })
    }
  }
  await Promise.all(Array.from({ length: 8 }, lane))
}

/** Planner viability for one sample point; steeper than maxSlope counts as not viable. */
export function judge(p: Sample, i: number, hours: number, th: Thresholds, maxSlope: number) {
  const stats = windowStats(p, i, hours)
  const steep = p.slope > maxSlope
  const v: Viability = stats && steep ? 'not' : viability(stats, th)
  return { stats, steep, v }
}


export type Verdict = 'ok' | 'caution' | 'fail'
/** Example cut-offs, shown on screen (team to agree): chance of landing on ground that meets the mission needs. */
export const VERDICT_CUTOFF = { ok: 0.95, caution: 0.75 }
export const verdictOf = (p: number): Verdict => (p >= VERDICT_CUTOFF.ok ? 'ok' : p >= VERDICT_CUTOFF.caution ? 'caution' : 'fail')
export const VERDICT_LABEL: Record<Verdict, string> = { ok: 'Meets your needs', caution: 'Some risk', fail: 'Too risky' }
/** Green / amber / red with clearly different brightness, so they also read for colour-blind viewers (shapes too). */
export const VCOLOR: Record<Viability, string> = { viable: '#3fb27f', marginal: '#e6c15a', not: '#d9534f', nodata: '#5b636e' }
export const VERDICT_COLOR: Record<Verdict, string> = { ok: VCOLOR.viable, caution: VCOLOR.marginal, fail: VCOLOR.not }

/** Why a judged point misses the needs: one entry per failed need (empty when it meets them all). */
export function reasons(p: Sample, r: ReturnType<typeof judge>, th: Thresholds, maxSlope: number) {
  const out: { k: 'steep' | 'sun' | 'dark' | 'earth' | 'data'; text: string }[] = []
  if (r.steep) out.push({ k: 'steep', text: `too steep (${p.slope.toFixed(1)}° > ${maxSlope}°)` })
  const s = r.stats
  if (!s) return [...out, { k: 'data' as const, text: 'mission runs past the end of the year' }]
  if (s.sunPct < th.minSunPct) out.push({ k: 'sun', text: `sunlit only ${s.sunPct.toFixed(0)}%` })
  if (s.longestDarkH > th.maxDarkH) out.push({ k: 'dark', text: `dark for ${formatDuration(s.longestDarkH)}` })
  if (s.earthPct < th.minEarthPct) out.push({ k: 'earth', text: `Earth in view only ${s.earthPct.toFixed(0)}%` })
  return out
}

/** Chance of touching down on viable / marginal ground: sum of the landing weights of those points. */
export function landingChance(points: { j: number; v: Viability }[], weights: number[]) {
  let ok = 0
  let marginal = 0
  for (const p of points) {
    if (p.v === 'viable') ok += weights[p.j]
    if (p.v === 'marginal') marginal += weights[p.j]
  }
  return { ok, marginal }
}
