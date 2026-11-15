import { DEFAULT_THRESHOLDS, windowStats, viability, type Region, type ScienceTradeoff, type Site, type Viability, type WindowStats } from '../data'
import { ARTEMIS_3_SITES, type ArtemisSiteData } from '../data/artemisData'
import { polarRowCol } from '../engine'
import { terrainAt, type MapData } from '../mapData'

export const R_MOON_KM = 1737.4
export const R_MOON_M = 1_737_400
const D2R = Math.PI / 180
const R2D = 180 / Math.PI
export const SYNODIC_DAY_H = 29.530588 * 24

export interface PsrZone {
  id: string
  name: string
  lat: number
  lon: number
  radiusKm: number
  depthM: number
  tempK: number
  evidence: string
}

export const SOUTH_POLE_PSRS: PsrZone[] = [
  { id: 'shackleton', name: 'Shackleton PSR', lat: -89.9, lon: 0.0, radiusKm: 10.5, depthM: 4200, tempK: 40, evidence: 'LOLA albedo + Diviner <40 K' },
  { id: 'faustini', name: 'Faustini PSR', lat: -87.3, lon: 77.0, radiusKm: 19.5, depthM: 3100, tempK: 55, evidence: 'LEND neutron suppression' },
  { id: 'shoemaker', name: 'Shoemaker PSR', lat: -88.1, lon: 44.9, radiusKm: 25.5, depthM: 2800, tempK: 50, evidence: 'Diviner cold trap + H deposits' },
  { id: 'haworth', name: 'Haworth PSR', lat: -87.4, lon: -5.1, radiusKm: 25.5, depthM: 3500, tempK: 40, evidence: 'LAMP UV ice signature' },
  { id: 'cabeus', name: 'Cabeus PSR (LCROSS)', lat: -84.9, lon: -35.5, radiusKm: 48.0, depthM: 3200, tempK: 42, evidence: 'LCROSS impact plume 5.6% water ice' },
  { id: 'de-gerlache', name: 'de Gerlache PSR', lat: -88.5, lon: -88.3, radiusKm: 16.0, depthM: 2500, tempK: 50, evidence: 'LOLA persistent shadow floor' },
  { id: 'slater', name: 'Slater PSR', lat: -88.1, lon: -110.8, radiusKm: 12.5, depthM: 2500, tempK: 45, evidence: 'Diviner <50 K cold trap' },
  { id: 'amundsen', name: 'Amundsen PSR', lat: -84.5, lon: 85.6, radiusKm: 51.0, depthM: 3000, tempK: 65, evidence: 'Polar crater floor cold trap' },
]

export interface Landmark {
  id: string
  name: string
  lat: number
  lon: number
  category: 'polar' | 'crater' | 'apollo' | 'mare'
  note: string
}

export const GLOBAL_LANDMARKS: Landmark[] = [
  { id: 'tycho', name: 'Tycho Crater', lat: -43.31, lon: -11.36, category: 'crater', note: 'Young 85 km ray crater with central peak (+2 km)' },
  { id: 'copernicus', name: 'Copernicus Crater', lat: 9.62, lon: -20.08, category: 'crater', note: '93 km terraced impact crater; olivine-rich central peaks' },
  { id: 'aristarchus', name: 'Aristarchus Plateau', lat: 23.73, lon: -47.49, category: 'crater', note: 'Brightest large crater & volcanic pyroclastic rilles (Vallis Schröteri)' },
  { id: 'orientale', name: 'Mare Orientale', lat: -19.4, lon: -92.8, category: 'mare', note: '930 km multi-ring impact basin on the western limb' },
  { id: 'apollo-17', name: 'Taurus-Littrow (Apollo 17)', lat: 20.1908, lon: 30.7717, category: 'apollo', note: '1972 crewed landing valley; orange pyroclastic glass' },
  { id: 'spa-basin', name: 'South Pole–Aitken Basin', lat: -53.0, lon: -169.0, category: 'mare', note: 'Largest & oldest impact basin on the Moon (~2,500 km wide)' },
]

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface EphemerisInstant {
  sun: Vec3 // km, Moon ME frame
  earth: Vec3 // km, Moon ME frame
  subSolar: { lat: number; lon: number }
  subEarth: { lat: number; lon: number }
  sunPoleBearingDeg: number // 0..360 E
  earthPoleBearingDeg: number // 0..360 E
  sunPoleElDeg: number
  lunarDayFrac: number // 0..1 around synodic month (0 = subsolar 0E ~ Full Moon)
  phaseName: string
  hourIndex: number // continuous floating hour index
}

/** Linearly interpolate hourly Sun/Earth vectors (vectors_YYYY.f32) at an exact UTC timestamp. */
export function instantFromVectors(vectors: Float32Array, year: number, timeMs: number): EphemerisInstant {
  const startMs = Date.UTC(year, 0, 1, 0, 0, 0)
  const samples = Math.floor(vectors.length / 6)
  const hFloat = Math.max(0, Math.min(samples - 1, (timeMs - startMs) / 3_600_000))
  const i0 = Math.min(samples - 2, Math.floor(hFloat))
  const f = hFloat - i0
  const o0 = 6 * i0
  const o1 = 6 * (i0 + 1)

  const lerp = (k: number) => vectors[o0 + k] * (1 - f) + vectors[o1 + k] * f
  const sun: Vec3 = { x: lerp(0), y: lerp(1), z: lerp(2) }
  const earth: Vec3 = { x: lerp(3), y: lerp(4), z: lerp(5) }

  const subSolar = subPoint(sun)
  const subEarth = subPoint(earth)
  const sunPoleBearingDeg = ((subSolar.lon % 360) + 360) % 360
  const earthPoleBearingDeg = ((subEarth.lon % 360) + 360) % 360
  const sMag = Math.hypot(sun.x, sun.y, sun.z) || 1
  const sunPoleElDeg = Math.asin(-sun.z / sMag) * R2D

  // Sub-solar longitude drifts westward ~360° per synodic month: 0° = Full Moon, 270° (-90°) = First Qtr, 180° = New Moon
  const westFrac = (((360 - sunPoleBearingDeg) % 360) + 360) % 360
  const lunarDayFrac = westFrac / 360

  return {
    sun,
    earth,
    subSolar,
    subEarth,
    sunPoleBearingDeg,
    earthPoleBearingDeg,
    sunPoleElDeg,
    lunarDayFrac,
    phaseName: phaseLabel(lunarDayFrac),
    hourIndex: hFloat,
  }
}

function phaseLabel(frac: number): string {
  // frac 0 = Full Moon (sub-solar 0 E), 0.25 = Last Quarter, 0.5 = New Moon, 0.75 = First Quarter
  const d = frac
  if (d < 0.0625 || d >= 0.9375) return 'Full Moon'
  if (d < 0.1875) return 'Waning Gibbous'
  if (d < 0.3125) return 'Last Quarter'
  if (d < 0.4375) return 'Waning Crescent'
  if (d < 0.5625) return 'New Moon'
  if (d < 0.6875) return 'Waxing Crescent'
  if (d < 0.8125) return 'First Quarter'
  return 'Waxing Gibbous'
}

export function subPoint(v: Vec3): { lat: number; lon: number } {
  const r = Math.hypot(v.x, v.y, v.z) || 1
  const lat = Math.asin(Math.max(-1, Math.min(1, v.z / r))) * R2D
  const lon = Math.atan2(v.y, v.x) * R2D
  return { lat, lon }
}

/** Local topocentric Azimuth (0=N, 90=E) and Elevation (deg) from any point (lat, lon) on a spherical Moon. */
export function topocentricAzEl(latDeg: number, lonDeg: number, targetKm: Vec3): { azDeg: number; elDeg: number } {
  const phi = latDeg * D2R
  const lam = lonDeg * D2R
  const sp = Math.sin(phi), cp = Math.cos(phi)
  const sl = Math.sin(lam), cl = Math.cos(lam)

  // Surface position in km
  const px = R_MOON_KM * cp * cl
  const py = R_MOON_KM * cp * sl
  const pz = R_MOON_KM * sp

  const dx = targetKm.x - px
  const dy = targetKm.y - py
  const dz = targetKm.z - pz
  const dist = Math.hypot(dx, dy, dz) || 1

  // Local ENU basis
  const east = -sl * dx + cl * dy
  const north = -sp * cl * dx - sp * sl * dy + cp * dz
  const up = cp * cl * dx + cp * sl * dy + sp * dz

  const elDeg = Math.asin(Math.max(-1, Math.min(1, up / dist))) * R2D
  const azDeg = ((Math.atan2(east, north) * R2D) % 360 + 360) % 360
  return { azDeg, elDeg }
}

export function surfaceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a =
    Math.sin(((lat2 - lat1) * D2R) / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(((lon2 - lon1) * D2R) / 2) ** 2
  return 2 * R_MOON_KM * Math.asin(Math.sqrt(Math.min(1, a)))
}

export function nearestPsr(lat: number, lon: number): { psr: PsrZone; distKm: number } {
  let best = SOUTH_POLE_PSRS[0]
  let minD = Infinity
  for (const p of SOUTH_POLE_PSRS) {
    const d = surfaceKm(lat, lon, p.lat, p.lon)
    if (d < minD) {
      minD = d
      best = p
    }
  }
  return { psr: best, distKm: minD }
}

export function nearestArtemisDossier(lat: number, lon: number): { dossier: ArtemisSiteData; distKm: number } | null {
  let best: ArtemisSiteData | null = null
  let minD = Infinity
  for (const d of ARTEMIS_3_SITES) {
    const dist = surfaceKm(lat, lon, d.lat, d.lon)
    if (dist < minD) {
      minD = dist
      best = d
    }
  }
  return best ? { dossier: best, distKm: minD } : null
}

/** Points along the day/night solar terminator circle (where dot(n, sun) = 0) for 2D plotting. */
export function terminatorRing(sun: Vec3, n = 180): { lat: number; lon: number }[] {
  const sMag = Math.hypot(sun.x, sun.y, sun.z) || 1
  const sx = sun.x / sMag, sy = sun.y / sMag, sz = sun.z / sMag
  // Two orthonormal vectors perpendicular to s
  const ref: [number, number, number] = Math.abs(sz) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  let ux = sy * ref[2] - sz * ref[1]
  let uy = sz * ref[0] - sx * ref[2]
  let uz = sx * ref[1] - sy * ref[0]
  const um = Math.hypot(ux, uy, uz) || 1
  ux /= um; uy /= um; uz /= um
  const vx = sy * uz - sz * uy
  const vy = sz * ux - sx * uz
  const vz = sx * uy - sy * ux

  const pts: { lat: number; lon: number }[] = []
  for (let k = 0; k <= n; k++) {
    const a = (2 * Math.PI * k) / n
    const ca = Math.cos(a), sa = Math.sin(a)
    const x = ca * ux + sa * vx
    const y = ca * uy + sa * vy
    const z = ca * uz + sa * vz
    pts.push({
      lat: Math.asin(Math.max(-1, Math.min(1, z))) * R2D,
      lon: Math.atan2(y, x) * R2D,
    })
  }
  return pts
}

/** Approximate sub-lunar longitude on Earth from UTC epoch ms (for rough DSN complex indicator). */
export function approxDsnStation(utcMs: number): { active: string; stations: { name: string; elDeg: number; inView: boolean }[] } {
  // Days since J2000.0 (2000-01-01T12:00:00Z = 946728000000 ms)
  const d = (utcMs - 946_728_000_000) / 86_400_000
  // Low-precision lunar ecliptic longitude & Earth GMST (~3-5 deg accuracy)
  const moonRaDeg = 218.316 + 13.176396 * d
  const gmstDeg = 280.46061837 + 360.98564736629 * d
  const subLunarLonE = (((moonRaDeg - gmstDeg + 180) % 360) + 360) % 360 - 180
  const complexes = [
    { name: 'Goldstone', lat: 35.43, lon: -116.89 },
    { name: 'Madrid', lat: 40.43, lon: -4.25 },
    { name: 'Canberra', lat: -35.4, lon: 148.98 },
  ]
  const stations = complexes.map((c) => {
    const cosZ = Math.cos(c.lat * D2R) * Math.cos((subLunarLonE - c.lon) * D2R)
    const elDeg = Math.asin(Math.max(-1, Math.min(1, cosZ))) * R2D
    return { name: c.name, elDeg, inView: elDeg > 10 }
  })
  const active = stations.filter((s) => s.inView).map((s) => s.name).join(' + ') || 'Handover zone'
  return { active, stations }
}

export function interpolateSiteState(site: Site | null, hourFloat: number) {
  if (!site || site.samples === 0) return null
  const idx = Math.max(0, Math.min(site.samples - 1, Math.round(hourFloat)))
  return {
    idx,
    sunFrac: site.sun.frac[idx] ?? 0,
    sunEl: site.sun.el[idx] ?? 0,
    sunAz: site.sun.az[idx] ?? 0,
    earthFrac: site.earth.frac[idx] ?? 0,
    earthEl: site.earth.el[idx] ?? 0,
    earthAz: site.earth.az[idx] ?? 0,
  }
}

export function formatUtcFull(ms: number): string {
  const d = new Date(ms)
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${m} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
}

export interface NearbyPsr {
  psr: PsrZone
  distKm: number
  bearingDeg: number
}

export function bearingBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R
  const p2 = lat2 * D2R
  const dl = (lon2 - lon1) * D2R
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) * R2D) % 360 + 360) % 360
}

export function nearbyPsrs(lat: number, lon: number, count = 3): NearbyPsr[] {
  return SOUTH_POLE_PSRS.map((psr) => ({
    psr,
    distKm: surfaceKm(lat, lon, psr.lat, psr.lon),
    bearingDeg: bearingBetween(lat, lon, psr.lat, psr.lon),
  }))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, count)
}

export interface NeighborhoodHazard {
  inPolarGrid: boolean
  centerElevM: number | null
  centerSlopeDeg: number | null
  minElevM: number | null
  maxElevM: number | null
  maxSlopeDeg: number | null
  meanSlopeDeg: number | null
  steepCount: number
  sampleCount: number
  steepSectors: string[]
  meanSunPct: number | null
  meanEarthPct: number | null
}

const DIRS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** Instant static 4 km neighborhood terrain/hazard scan from LOLA 240 m polar grids (0 ms CPU). */
export function scanTerrainNeighborhood(map: MapData | null, lat: number, lon: number, maxSlopeLimit = 8): NeighborhoodHazard {
  if (!map || lat > -84.2) {
    return {
      inPolarGrid: false,
      centerElevM: null,
      centerSlopeDeg: null,
      minElevM: null,
      maxElevM: null,
      maxSlopeDeg: null,
      meanSlopeDeg: null,
      steepCount: 0,
      sampleCount: 0,
      steepSectors: [],
      meanSunPct: null,
      meanEarthPct: null,
    }
  }
  const [rc, cc] = polarRowCol(lat, lon, map.n, map.scale)
  const r0 = Math.round(rc)
  const c0 = Math.round(cc)
  if (r0 < 2 || r0 >= map.n - 2 || c0 < 2 || c0 >= map.n - 2) {
    return {
      inPolarGrid: false,
      centerElevM: null,
      centerSlopeDeg: null,
      minElevM: null,
      maxElevM: null,
      maxSlopeDeg: null,
      meanSlopeDeg: null,
      steepCount: 0,
      sampleCount: 0,
      steepSectors: [],
      meanSunPct: null,
      meanEarthPct: null,
    }
  }
  const ct = terrainAt(map, r0, c0)
  const kmPerDegLat = (Math.PI * R_MOON_KM) / 180
  const cosLat = Math.max(0.02, Math.cos(lat * D2R))
  const kmPerDegLon = kmPerDegLat * cosLat

  let minE = ct.h
  let maxE = ct.h
  let maxS = ct.slope
  let sumS = 0
  let sumSun = 0
  let sumEarth = 0
  let steep = 0
  let count = 0
  const steepDirSet = new Set<string>()

  for (const distKm of [1, 2, 3, 4]) {
    for (let dIdx = 0; dIdx < 8; dIdx++) {
      const az = (dIdx * 45 * Math.PI) / 180
      const dLat = (distKm * Math.cos(az)) / kmPerDegLat
      const dLon = (distKm * Math.sin(az)) / kmPerDegLon
      const [rr, ccc] = polarRowCol(lat + dLat, lon + dLon, map.n, map.scale)
      const r = Math.round(rr)
      const c = Math.round(ccc)
      if (r < 1 || r >= map.n - 1 || c < 1 || c >= map.n - 1) continue
      const t = terrainAt(map, r, c)
      if (!Number.isFinite(t.h) || !Number.isFinite(t.slope)) continue
      count++
      minE = Math.min(minE, t.h)
      maxE = Math.max(maxE, t.h)
      maxS = Math.max(maxS, t.slope)
      sumS += t.slope
      const k = r * map.n + c
      sumSun += (map.sun[k] / 255) * 100
      sumEarth += (map.earth[k] / 255) * 100
      if (t.slope > maxSlopeLimit) {
        steep++
        steepDirSet.add(`${DIRS_8[dIdx]} (~${t.slope.toFixed(0)}°)`)
      }
    }
  }

  return {
    inPolarGrid: true,
    centerElevM: ct.h,
    centerSlopeDeg: ct.slope,
    minElevM: minE,
    maxElevM: maxE,
    maxSlopeDeg: maxS,
    meanSlopeDeg: count > 0 ? sumS / count : ct.slope,
    steepCount: steep,
    sampleCount: count,
    steepSectors: Array.from(steepDirSet).slice(0, 4),
    meanSunPct: count > 0 ? sumSun / count : null,
    meanEarthPct: count > 0 ? sumEarth / count : null,
  }
}

export interface RankedCandidate {
  site: Site
  stats: WindowStats | null
  v: Viability
  slopeDeg: number | null
  steep: boolean
  score: number
  psrKm: number
  errors: string[]
}

/** Fast instantaneous site scorer over static hourly Site vectors for any chosen UTC hour & mission duration. */
export function rankSitesForWindow(sites: Site[], hourIdx: number, missionHours = 336, map: MapData | null = null): RankedCandidate[] {
  const th = DEFAULT_THRESHOLDS
  return sites
    .filter((s) => s.lat <= -75 && !s.replay && !s.id.startsWith('replay-'))
    .map((site) => {
      const i = Math.max(0, Math.min(site.samples - 1, Math.round(hourIdx)))
      const stats = windowStats(site, i, missionHours)
      let slopeDeg: number | null = site.slope_deg ?? null
      if (slopeDeg === null && map && site.lat <= -85) {
        const [r, c] = polarRowCol(site.lat, site.lon, map.n, map.scale)
        const ri = Math.round(r), ci = Math.round(c)
        if (ri >= 1 && ci >= 1 && ri < map.n - 1 && ci < map.n - 1) {
          slopeDeg = terrainAt(map, ri, ci).slope
        }
      }
      const slopeVal = slopeDeg ?? 4
      const steep = slopeDeg !== null && slopeDeg > 8
      const baseV: Viability = stats ? viability(stats, th) : 'nodata'
      const v: Viability = steep && baseV === 'viable' ? 'marginal' : steep ? 'not' : baseV
      const { distKm: psrKm } = nearestPsr(site.lat, site.lon)

      const errors: string[] = []
      if (steep && slopeDeg !== null) errors.push(`Slope ${slopeDeg.toFixed(1)}° exceeds 8° limit`)
      if (!stats) {
        errors.push('Mission window crosses end of year')
      } else {
        if (stats.sunPct < th.minSunPct) errors.push(`Sunlight ${stats.sunPct.toFixed(0)}% < ${th.minSunPct}% min`)
        if (stats.longestDarkH > th.maxDarkH) errors.push(`Longest darkness ${stats.longestDarkH}h > ${th.maxDarkH}h max`)
        if (stats.earthPct < th.minEarthPct) errors.push(`Earth link ${stats.earthPct.toFixed(0)}% < ${th.minEarthPct}% min`)
      }

      // Composite score (0..100): matches Find sites weights cleanly
      let score = 0
      if (stats) {
        const power = (Math.min(100, stats.sunPct) / 100) * 40
        const comms = (Math.min(100, stats.earthPct) / 100) * 25
        const darkScore = Math.max(0, 1 - stats.longestDarkH / 168) * 20
        const flatScore = Math.max(0, 1 - slopeVal / 16) * 15
        score = Math.round(power + comms + darkScore + flatScore)
      }
      if (v === 'viable') score += 100
      else if (v === 'marginal') score += 45

      return { site, stats, v, slopeDeg, steep, score, psrKm, errors }
    })
    .sort((a, b) => b.score - a.score)
}

export type { ScienceTradeoff, Region }
