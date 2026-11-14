// Landing-ellipse sample points: exact computation in the worker pool and the planner's viability rule.
// Shared by the Map panel (Ellipse.tsx) and the Find sites check (Finder.tsx).
import { computeCustomPoint } from './customPoint'
import type { EllipseSpec, LatLon } from './ellipseGeometry'
import { viability, windowStats, type Thresholds, type Viability } from './data'

export interface Sample extends LatLon {
  slope: number
  samples: number
  sun: { frac: Float32Array }
  earth: { frac: Float32Array }
}

export const DEFAULT_ELLIPSE: EllipseSpec = { lengthKm: 4, widthKm: 2, headingDeg: 0 } // example only, not a specific lander

export type Run = { key: string; points: (Sample | null)[]; total: number; spacingM: number }
// Inputs and results outlive the panel, so switching to the 3D tab and back keeps them.
// Find sites and the Map share the slope limit and ellipse size through it too; autoRun = analyse as soon as the Map opens.
export const saved: { spec: EllipseSpec; circle: boolean; maxSlope: number; run: Run | null; autoRun: boolean } = {
  spec: DEFAULT_ELLIPSE, circle: false, maxSlope: 8, run: null, autoRun: false,
}

/** Compute sample points exactly, 8 at a time so a cancelled run (alive() = false) stops queuing work. */
export async function computeSamples(points: LatLon[], alive: () => boolean, onPoint: (j: number, p: Sample | null) => void) {
  let next = 0
  const lane = async () => {
    while (next < points.length && alive()) {
      const j = next++
      const s = await computeCustomPoint(points[j].lat, points[j].lon, false).catch(() => null)
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

