// F1 landing-ellipse geometry: sample points and outline for an ellipse around a south-pole site.
// Works in the map's south polar stereographic plane (0 E up, 90 E right), corrected for its scale factor.
import { R_M } from './engine.ts' // .ts so scripts/check-ellipse.ts runs in node

const D2R = Math.PI / 180

export interface EllipseSpec {
  lengthKm: number // long axis (downrange, along the approach)
  widthKm: number // short axis (crossrange)
  headingDeg: number // direction of the long axis, clockwise from north (at the pole, north = away from the pole)
}

export interface LatLon {
  lat: number
  lon: number
}

/** Map an ellipse-frame offset (u along the long axis, v across it, metres on the ground) to lat/lon. */
function framer(lat: number, lon: number, headingDeg: number) {
  const rr = 2 * R_M * Math.tan(((90 + lat) * D2R) / 2)
  const sl = Math.sin(lon * D2R)
  const cl = Math.cos(lon * D2R)
  const k = 2 / (1 + Math.sin(-lat * D2R)) // stereographic scale: plane metres per ground metre
  const ch = Math.cos(headingDeg * D2R)
  const sh = Math.sin(headingDeg * D2R)
  // north = radially away from the pole, east = direction of increasing longitude
  const N = [sl, cl]
  const E = [cl, -sl]
  const A = [N[0] * ch + E[0] * sh, N[1] * ch + E[1] * sh]
  const B = [-N[0] * sh + E[0] * ch, -N[1] * sh + E[1] * ch]
  return (u: number, v: number): LatLon => {
    const x = rr * sl + k * (u * A[0] + v * B[0])
    const y = rr * cl + k * (u * A[1] + v * B[1])
    return {
      lat: -90 + (2 * Math.atan(Math.hypot(x, y) / (2 * R_M))) / D2R,
      lon: ((Math.atan2(x, y) / D2R) % 360 + 360) % 360,
    }
  }
}

/** Closed outline, n points. */
export function ellipseOutline(c: LatLon, e: EllipseSpec, n = 72): LatLon[] {
  const f = framer(c.lat, c.lon, e.headingDeg)
  const a = (e.lengthKm * 1000) / 2
  const b = (e.widthKm * 1000) / 2
  return Array.from({ length: n + 1 }, (_, j) => f(a * Math.cos((2 * Math.PI * j) / n), b * Math.sin((2 * Math.PI * j) / n)))
}

export interface Samples {
  points: LatLon[]
  spacingM: number
  /** Chance of touching down nearest each point: 2D Gaussian with the ellipse edge at 3 sigma (landings bunch towards
   *  the target), integrated over a fine lattice inside the ellipse, each lattice node going to its nearest sample
   *  (so the edge points carry the outer ring). Sums to 1. */
  weights: number[]
  /** Corners of each point's grid cell (null for edge points), for drawing the ellipse as tiles. */
  cells: (LatLon[] | null)[]
}

/** Sample points: the target first, then a grid inside the ellipse, then 12 points on its edge.
 *  Spacing is set for about `target` grid points but never finer than the 240 m terrain. */
export function ellipseSamples(c: LatLon, e: EllipseSpec, target = 36): Samples {
  const a = (e.lengthKm * 1000) / 2
  const b = (e.widthKm * 1000) / 2
  if (2 * a < 240) return { points: [c], spacingM: 0, weights: [1], cells: [null] } // smaller than one terrain pixel
  const f = framer(c.lat, c.lon, e.headingDeg)
  const s = Math.max(240, Math.sqrt((Math.PI * a * b) / target))
  const points: LatLon[] = []
  const weights: number[] = []
  const cells: (LatLon[] | null)[] = []
  const uv: [number, number][] = [] // sample positions in the ellipse frame (m)
  const add = (u: number, v: number) => {
    points.push(u || v ? f(u, v) : c)
    uv.push([u, v])
    cells.push([f(u - s / 2, v - s / 2), f(u + s / 2, v - s / 2), f(u + s / 2, v + s / 2), f(u - s / 2, v + s / 2)])
  }
  add(0, 0)
  for (let ju = -Math.floor(a / s); ju <= Math.floor(a / s); ju++)
    for (let jv = -Math.floor(b / s); jv <= Math.floor(b / s); jv++) {
      const u = ju * s
      const v = jv * s
      if ((ju || jv) && (u / a) ** 2 + (v / b) ** 2 <= 1) add(u, v)
    }
  for (let j = 0; j < 12; j++) {
    const [u, v] = [a * Math.cos((j * Math.PI) / 6), b * Math.sin((j * Math.PI) / 6)]
    points.push(f(u, v))
    uv.push([u, v])
    cells.push(null)
  }
  // Landing chance per sample: Gaussian density exp(-r^2/2), r = 3 at the edge, on an 80 x 80 lattice.
  const L = 80
  weights.push(...uv.map(() => 0))
  for (let iu = 0; iu < L; iu++)
    for (let iv = 0; iv < L; iv++) {
      const u = a * ((2 * iu + 1) / L - 1)
      const v = b * ((2 * iv + 1) / L - 1)
      const r2 = (u / a) ** 2 + (v / b) ** 2
      if (r2 > 1) continue
      let best = 0
      let bd = Infinity
      uv.forEach(([pu, pv], j) => {
        const d = (pu - u) ** 2 + (pv - v) ** 2
        if (d < bd) [bd, best] = [d, j]
      })
      weights[best] += Math.exp(-4.5 * r2)
    }
  const sum = weights.reduce((x, y) => x + y, 0)
  weights.forEach((w, j) => (weights[j] = w / sum))
  return { points, spacingM: s, weights, cells }
}

/** Great-circle distance in km. */
export function kmBetween(p: LatLon, q: LatLon): number {
  const s = Math.sin(((q.lat - p.lat) * D2R) / 2) ** 2 + Math.cos(p.lat * D2R) * Math.cos(q.lat * D2R) * Math.sin(((q.lon - p.lon) * D2R) / 2) ** 2
  return (2 * R_M * Math.asin(Math.sqrt(s))) / 1000
}
