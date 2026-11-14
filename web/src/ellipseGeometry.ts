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

/** Sample points: the target first, then a grid inside the ellipse, then 12 points on its edge.
 *  Spacing is set for about `target` grid points but never finer than the 240 m terrain. */
export function ellipseSamples(c: LatLon, e: EllipseSpec, target = 36): { points: LatLon[]; spacingM: number } {
  const a = (e.lengthKm * 1000) / 2
  const b = (e.widthKm * 1000) / 2
  if (2 * a < 240) return { points: [c], spacingM: 0 } // smaller than one terrain pixel
  const f = framer(c.lat, c.lon, e.headingDeg)
  const s = Math.max(240, Math.sqrt((Math.PI * a * b) / target))
  const points = [c]
  for (let ju = -Math.floor(a / s); ju <= Math.floor(a / s); ju++)
    for (let jv = -Math.floor(b / s); jv <= Math.floor(b / s); jv++) {
      const u = ju * s
      const v = jv * s
      if ((ju || jv) && (u / a) ** 2 + (v / b) ** 2 <= 1) points.push(f(u, v))
    }
  for (let j = 0; j < 12; j++) points.push(f(a * Math.cos((j * Math.PI) / 6), b * Math.sin((j * Math.PI) / 6)))
  return { points, spacingM: s }
}

/** Great-circle distance in km. */
export function kmBetween(p: LatLon, q: LatLon): number {
  const s = Math.sin(((q.lat - p.lat) * D2R) / 2) ** 2 + Math.cos(p.lat * D2R) * Math.cos(q.lat * D2R) * Math.sin(((q.lon - p.lon) * D2R) / 2) ** 2
  return (2 * R_M * Math.asin(Math.sqrt(s))) / 1000
}
