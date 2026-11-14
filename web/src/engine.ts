// F6a click-anywhere engine: the same maths as pipeline/horizon.py and pipeline/timeline.py, in TypeScript.
// Pure functions (no DOM), used by the Web Worker and by scripts/check-engine.ts, which checks it against Python.

export interface Grid {
  dn: Int16Array // LOLA heights, DN x 0.5 m above the 1737.4 km sphere
  n: number
  scaleM: number
}

export const R_M = 1737400
const R_KM = 1737.4
const RADIUS_KM = { sun: 695700, earth: 6378.137 }
const D2R = Math.PI / 180

/** Fractional (row, col) in a pole-centred south polar stereographic grid: 0 E up, 90 E right (as horizon.py). */
export function polarRowCol(latDeg: number, lonDeg: number, n: number, scaleM: number): [number, number] {
  const r = 2 * R_M * Math.tan(((90 + latDeg) * D2R) / 2)
  const c = n / 2 - 0.5
  return [c - (r * Math.cos(lonDeg * D2R)) / scaleM, c + (r * Math.sin(lonDeg * D2R)) / scaleM]
}

/** Inverse of polarRowCol: (lat, east lon) of a fractional pixel position. */
export function rowColToLatLon(row: number, col: number, n: number, scaleM: number): [number, number] {
  const c = n / 2 - 0.5
  const x = (col - c) * scaleM
  const y = -(row - c) * scaleM
  const lat = -90 + (2 * Math.atan(Math.hypot(x, y) / (2 * R_M))) / D2R
  return [lat, ((Math.atan2(x, y) / D2R) % 360 + 360) % 360]
}

/** Bilinear height in metres, NaN outside the grid (horizon.py _bilinear). */
export function heightM(g: Grid, latDeg: number, lonDeg: number): number {
  const [row, col] = polarRowCol(latDeg, lonDeg, g.n, g.scaleM)
  const i0 = Math.floor(row)
  const j0 = Math.floor(col)
  if (i0 < 0 || j0 < 0 || i0 >= g.n - 1 || j0 >= g.n - 1) return NaN
  const fi = row - i0
  const fj = col - j0
  const k = i0 * g.n + j0
  const d = g.dn
  return (d[k] * (1 - fi) * (1 - fj) + d[k + 1] * (1 - fi) * fj + d[k + g.n] * fi * (1 - fj) + d[k + g.n + 1] * fi * fj) * 0.5
}

/** Terrain horizon elevation (deg) every azStep deg, curvature included (horizon.py horizon_mask). */
export function horizonMask(g: Grid, latDeg: number, lonDeg: number, obsHeightM = 2, azStep = 0.5, stepM = 120, maxRangeM = 500_000) {
  const nAz = Math.round(360 / azStep)
  const el = new Float64Array(nAz)
  const p1 = latDeg * D2R
  const l1 = lonDeg * D2R
  const r0 = R_M + heightM(g, latDeg, lonDeg) + obsHeightM
  const sp1 = Math.sin(p1)
  const cp1 = Math.cos(p1)
  for (let a = 0; a < nAz; a++) {
    const th = a * azStep * D2R
    const st = Math.sin(th)
    const ct = Math.cos(th)
    let best = -Infinity
    for (let d = stepM; d < maxRangeM; d += stepM) {
      const delta = d / R_M
      const sd = Math.sin(delta)
      const cd = Math.cos(delta)
      const lat2 = Math.asin(sp1 * cd + cp1 * sd * ct)
      const lon2 = l1 + Math.atan2(st * sd * cp1, cd - sp1 * Math.sin(lat2))
      const h = heightM(g, lat2 / D2R, lon2 / D2R)
      if (Number.isNaN(h)) break // left the grid: the crop gives >= 150 km of terrain for 85-90 S points
      const rp = R_M + h
      const e = Math.atan2(rp * cd - r0, rp * sd)
      if (e > best) best = e
    }
    el[a] = best / D2R
  }
  return el
}

/** Visible fraction of a disc above a straight horizon line (timeline.py disc_fraction). */
export function discFraction(el: number, radius: number, horizonEl: number): number {
  const x = Math.min(1, Math.max(-1, (el - horizonEl) / radius))
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI
}

function horizonAtAz(mask: ArrayLike<number>, az: number, azStep: number): number {
  const x = (((az % 360) + 360) % 360) / azStep
  const i = Math.floor(x)
  const f = x - i
  return mask[i % mask.length] * (1 - f) + mask[(i + 1) % mask.length] * f
}

export interface Tracks {
  sun: { az: Float64Array; el: Float64Array; frac: Float64Array; power: Float64Array }
  earth: { az: Float64Array; el: Float64Array; frac: Float64Array }
}

/** Hourly Sun/Earth az/el and visible-disc fractions (ephemeris.altaz_from_vectors + timeline.site_timeline).
 *  vectors: float32 [sun x,y,z, earth x,y,z] per hour, km, MOON_ME frame, from the Moon's centre.
 *  start/hours: compute only that window (index 0 of the result = hour `start`). */
export function siteTracks(vectors: Float32Array, latDeg: number, lonDeg: number, siteElevM: number, mask: ArrayLike<number>, azStep = 0.5, start = 0, hours = vectors.length / 6 - start): Tracks {
  const p = latDeg * D2R
  const l = lonDeg * D2R
  const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]
  const east = [-Math.sin(l), Math.cos(l), 0]
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]]
  const rs = R_KM + siteElevM / 1000
  const mk = () => ({ az: new Float64Array(hours), el: new Float64Array(hours), frac: new Float64Array(hours) })
  const out: Tracks = { sun: { ...mk(), power: new Float64Array(hours) }, earth: mk() }
  for (let h = 0; h < hours; h++) {
    const o = 6 * (start + h)
    for (const [b, off] of [['sun', 0], ['earth', 3]] as const) {
      const x = vectors[o + off] - rs * up[0]
      const y = vectors[o + off + 1] - rs * up[1]
      const z = vectors[o + off + 2] - rs * up[2]
      const dist = Math.hypot(x, y, z)
      const az = ((Math.atan2(east[0] * x + east[1] * y + east[2] * z, north[0] * x + north[1] * y + north[2] * z) / D2R) % 360 + 360) % 360
      const el = Math.asin((up[0] * x + up[1] * y + up[2] * z) / dist) / D2R
      const radius = Math.asin(RADIUS_KM[b] / dist) / D2R
      const t = out[b]
      t.az[h] = az
      t.el[h] = el
      t.frac[h] = discFraction(el, radius, horizonAtAz(mask, az, azStep))
    }
    out.sun.power[h] = out.sun.frac[h] * Math.cos(out.sun.el[h] * D2R)
  }
  return out
}

function longestRun(on: (h: number) => boolean, n: number): number {
  let run = 0
  let best = 0
  for (let h = 0; h < n; h++) best = Math.max(best, (run = on(h) ? run + 1 : 0))
  return best
}

const r2 = (x: number) => Math.round(x * 100) / 100

/** Same metrics as timeline.metrics. */
export function trackMetrics(t: Tracks) {
  const n = t.sun.frac.length
  let sun = 0, earth = 0, both = 0, disc = 0, power = 0
  for (let h = 0; h < n; h++) {
    const s = t.sun.frac[h] > 0
    const e = t.earth.frac[h] > 0
    sun += +s
    earth += +e
    both += +(s && e)
    disc += t.sun.frac[h]
    power += t.sun.power[h]
  }
  return {
    sunlit_pct: r2((100 * sun) / n),
    mean_sun_disc_pct: r2((100 * disc) / n),
    mean_power_index_pct: r2((100 * power) / n),
    earth_visible_pct: r2((100 * earth) / n),
    sun_and_earth_pct: r2((100 * both) / n),
    longest_dark_h: longestRun((h) => !(t.sun.frac[h] > 0), n),
    longest_no_earth_h: longestRun((h) => !(t.earth.frac[h] > 0), n),
  }
}
