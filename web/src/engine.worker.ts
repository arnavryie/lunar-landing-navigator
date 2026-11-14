// Web Worker: computes a clicked map point with the same maths as the Python pipeline (see engine.ts).
import { heightM, horizonMask, polarRowCol, siteTracks, trackMetrics, type Grid } from './engine'

interface Meta {
  dem: { file: string; n: number; scale_m: number }
  vectors: { file: string; hours: number; start_utc: string }
  obs_height_m: number
}

const base = `${import.meta.env.BASE_URL}data/map/`
let data: Promise<{ meta: Meta; grid: Grid; vectors: Float32Array }> | null = null

async function load() {
  const meta: Meta = await (await fetch(base + 'meta.json')).json()
  const [dem, vec] = await Promise.all([fetch(base + meta.dem.file), fetch(base + meta.vectors.file)].map(async (r) => (await r).arrayBuffer()))
  return { meta, grid: { dn: new Int16Array(dem), n: meta.dem.n, scaleM: meta.dem.scale_m }, vectors: new Float32Array(vec) }
}

self.onmessage = async (e: MessageEvent<{ id: number; lat: number; lon: number }>) => {
  try {
    const { id, lat, lon } = e.data
    const { meta, grid, vectors } = await (data ??= load())
    const h = heightM(grid, lat, lon)
    if (Number.isNaN(h)) throw new Error('Point is outside the terrain map')
    const mask = horizonMask(grid, lat, lon, meta.obs_height_m)
    const t = siteTracks(vectors, lat, lon, h + meta.obs_height_m, mask)
    const r = (a: Float64Array, nd: number) => Array.from(a, (v) => Math.round(v * 10 ** nd) / 10 ** nd)
    const lonW = lon > 180 ? lon - 360 : lon
    // Slope from the 240 m terrain, as the map's slope layer does (central differences at the nearest pixel).
    const [row, col] = polarRowCol(lat, lon, grid.n, grid.scaleM).map(Math.round)
    const k = row * grid.n + col
    const dx = ((grid.dn[k + 1] - grid.dn[k - 1]) * 0.5) / (2 * grid.scaleM)
    const dy = ((grid.dn[k + grid.n] - grid.dn[k - grid.n]) * 0.5) / (2 * grid.scaleM)
    self.postMessage({
      id,
      ok: true,
      site: {
        id: 'custom', group: 'Custom', kind: 'custom',
        name: `Custom point ${Math.abs(lat).toFixed(3)}° S, ${Math.abs(lonW).toFixed(2)}° ${lonW >= 0 ? 'E' : 'W'}`,
        lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4,
        note: 'Picked on the map. Horizon and visibility computed in your browser with the same maths as the Python pipeline (checked to match).',
        source: 'Map click', source_url: '#sources',
        site_height_m: Math.round(h * 10) / 10, slope_deg: Math.round((Math.atan(Math.hypot(dx, dy)) * 1800) / Math.PI) / 10, obs_height_m: meta.obs_height_m,
        start_utc: meta.vectors.start_utc, step_h: 1, samples: meta.vectors.hours,
        metrics: trackMetrics(t),
        provenance: 'Terrain: NASA LOLA LDEM_60S_240M (240 m/px), cropped to 80–90° S. Ephemeris: JPL DE421 via Skyfield, MOON_ME frame. Computed in the browser; same maths as the validated pipeline.',
        horizon: { az_step_deg: 0.5, el_deg: r(mask, 2), edge_limited_azimuths: 0 },
        sun: { az: r(t.sun.az, 2), el: r(t.sun.el, 3), frac: r(t.sun.frac, 3), power: r(t.sun.power, 3) },
        earth: { az: r(t.earth.az, 2), el: r(t.earth.el, 3), frac: r(t.earth.frac, 3) },
      },
    })
  } catch (err) {
    self.postMessage({ id: e.data.id, ok: false, error: String((err as Error).message ?? err) })
  }
}
