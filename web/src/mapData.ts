// South-pole map layers (85-90 S, 240 m): LOLA terrain and NASA long-term light, Earth view and permanent shadow.
// Loaded once and shared by the Map and Find sites.

export interface MapData {
  n: number
  scale: number
  demN: number
  dem: Int16Array
  sun: Uint8ClampedArray
  earth: Uint8ClampedArray
  psr: Uint8ClampedArray
}

const base = `${import.meta.env.BASE_URL}data/map/`

async function grey(file: string): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(await (await fetch(base + file)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const g = c.getContext('2d')!
  g.drawImage(bmp, 0, 0)
  const rgba = g.getImageData(0, 0, bmp.width, bmp.height).data
  const out = new Uint8ClampedArray(bmp.width * bmp.height)
  for (let k = 0; k < out.length; k++) out[k] = rgba[4 * k]
  return out
}

async function loadMap(): Promise<MapData> {
  const meta = await (await fetch(base + 'meta.json')).json()
  const [dem, sun, earth, psr] = await Promise.all([
    fetch(base + meta.dem.file).then((r) => r.arrayBuffer()),
    grey('sun_pct.png'),
    grey('earth_pct.png'),
    grey('psr.png'),
  ])
  return { n: meta.layers.n, scale: meta.layers.scale_m, demN: meta.dem.n, dem: new Int16Array(dem), sun, earth, psr }
}

let cached: Promise<MapData> | null = null
export const loadMapData = () => (cached ??= loadMap())

/** Height (m) and slope (deg) at a map pixel, from the DEM crop (map grid sits in its centre). */
export function terrainAt(d: MapData, r: number, c: number) {
  const off = (d.demN - d.n) / 2
  const k = (r + off) * d.demN + (c + off)
  const h = d.dem[k] * 0.5
  const dx = ((d.dem[k + 1] - d.dem[k - 1]) * 0.5) / (2 * d.scale)
  const dy = ((d.dem[k + d.demN] - d.dem[k - d.demN]) * 0.5) / (2 * d.scale)
  return { h, slope: (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI, dx, dy }
}

let slopeCache: { d: MapData; s: Float32Array } | null = null
/** Slope (deg) of every map pixel (85-90 S grid), computed once. */
export function slopeGrid(d: MapData): Float32Array {
  if (slopeCache?.d === d) return slopeCache.s
  const s = new Float32Array(d.n * d.n).fill(NaN)
  for (let r = 1; r < d.n - 1; r++) for (let c = 1; c < d.n - 1; c++) s[r * d.n + c] = terrainAt(d, r, c).slope
  slopeCache = { d, s }
  return s
}
