import { type Grid, heightM, polarRowCol, rowColToLatLon, R_M } from '../../engine.ts'

export interface MapMeta {
  dem: {
    file: string
    n: number
    scale_m: number
    lat_edge: number
    dn_to_m: number
    source: string
  }
  vectors: {
    file: string
    hours: number
    start_utc: string
    source: string
  }
  layers: {
    n: number
    scale_m: number
    lat_edge: number
    source: string
  }
  obs_height_m: number
  r_moon_m: number
}

export interface PlannerDataset {
  meta: MapMeta
  demGrid: Grid
  demN: number
  scaleM: number
  sunPctLayer: Uint8ClampedArray
  earthPctLayer: Uint8ClampedArray
  psrLayer: Uint8ClampedArray
  layersN: number
  vectors: Float32Array // 8760 x 6
  candidateCount: number
  candidateRec: Float32Array // n x 6: lat, lon, height_m, slope_deg, sun_pct, earth_pct
  candidateMasks: Float32Array // n x 360 horizons in deg
}

const base = `${import.meta.env?.BASE_URL ?? '/'}data/`

async function loadPngAlpha(url: string): Promise<Uint8ClampedArray> {
  const resp = await fetch(url)
  const blob = await resp.blob()
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  const out = new Uint8ClampedArray(bmp.width * bmp.height)
  for (let i = 0; i < out.length; i++) {
    out[i] = imgData[4 * i]
  }
  return out
}

let cachedPlannerData: Promise<PlannerDataset> | null = null

export function loadPlannerDataset(): Promise<PlannerDataset> {
  if (cachedPlannerData) return cachedPlannerData

  cachedPlannerData = (async () => {
    // 1. Fetch metadata files
    const [mapMeta, finderMeta] = await Promise.all([
      fetch(`${base}map/meta.json`).then((r) => r.json() as Promise<MapMeta>),
      fetch(`${base}finder/meta.json`).then((r) => r.json()),
    ])

    // 2. Fetch buffers in parallel
    const [demBuf, vecBuf, sunBuf, earthBuf, psrBuf, candsBuf, masksBuf] = await Promise.all([
      fetch(`${base}map/${mapMeta.dem.file}`).then((r) => r.arrayBuffer()),
      fetch(`${base}map/${mapMeta.vectors.file}`).then((r) => r.arrayBuffer()),
      loadPngAlpha(`${base}map/sun_pct.png`),
      loadPngAlpha(`${base}map/earth_pct.png`),
      loadPngAlpha(`${base}map/psr.png`),
      fetch(`${base}finder/candidates.f32`).then((r) => r.arrayBuffer()),
      fetch(`${base}finder/masks.i8`).then((r) => r.arrayBuffer()),
    ])

    const demN = mapMeta.dem.n
    const demGrid: Grid = {
      dn: new Int16Array(demBuf),
      n: demN,
      scaleM: mapMeta.dem.scale_m,
    }

    const maskUnitDeg = finderMeta.mask?.unit_deg || 0.1
    const masksInt8 = new Int8Array(masksBuf)
    const candidateMasks = Float32Array.from(masksInt8, (v) => v * maskUnitDeg)

    return {
      meta: mapMeta,
      demGrid,
      demN,
      scaleM: mapMeta.dem.scale_m,
      sunPctLayer: sunBuf,
      earthPctLayer: earthBuf,
      psrLayer: psrBuf,
      layersN: mapMeta.layers.n,
      vectors: new Float32Array(vecBuf),
      candidateCount: finderMeta.count,
      candidateRec: new Float32Array(candsBuf),
      candidateMasks,
    }
  })()

  return cachedPlannerData
}

/** Great-circle surface distance in km between two lunar coordinates (Moon R = 1737.4 km) */
export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R_KM = 1737.4
  const d2r = Math.PI / 180
  const dLat = (lat2 - lat1) * d2r
  const dLon = (lon2 - lon1) * d2r
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLon / 2) ** 2
  return R_KM * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Initial azimuth / bearing in degrees (0-360) from point 1 to point 2 */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const d2r = Math.PI / 180
  const y = Math.sin((lon2 - lon1) * d2r) * Math.cos(lat2 * d2r)
  const x =
    Math.cos(lat1 * d2r) * Math.sin(lat2 * d2r) -
    Math.sin(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.cos((lon2 - lon1) * d2r)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Convert bearing angle to 16-wind compass abbreviation (e.g. "NE", "SSW") */
export function cardinalDirection(bearing: number): string {
  const directions = [
    'North', 'NNE', 'North-East', 'ENE',
    'East', 'ESE', 'South-East', 'SSE',
    'South', 'SSW', 'South-West', 'WSW',
    'West', 'WNW', 'North-West', 'NNW',
  ]
  const idx = Math.round(bearing / 22.5) % 16
  return directions[idx]
}

/** Bilinear slope and height querying from DEM */
export function terrainAtCoord(grid: Grid, lat: number, lon: number): { elevationM: number; slopeDeg: number } {
  const elev = heightM(grid, lat, lon)
  if (Number.isNaN(elev)) return { elevationM: 0, slopeDeg: 0 }

  const [row, col] = polarRowCol(lat, lon, grid.n, grid.scaleM)
  const r0 = Math.floor(row)
  const c0 = Math.floor(col)
  if (r0 <= 0 || c0 <= 0 || r0 >= grid.n - 1 || c0 >= grid.n - 1) {
    return { elevationM: elev, slopeDeg: 0 }
  }

  const k = r0 * grid.n + c0
  const dx = ((grid.dn[k + 1] - grid.dn[k - 1]) * 0.5) / (2 * grid.scaleM)
  const dy = ((grid.dn[k + grid.n] - grid.dn[k - grid.n]) * 0.5) / (2 * grid.scaleM)
  const slope = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI

  return { elevationM: elev, slopeDeg: Math.min(45, Math.max(0, slope)) }
}

export { heightM, polarRowCol, rowColToLatLon, R_M }
