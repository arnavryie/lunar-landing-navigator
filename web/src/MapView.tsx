import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { R_M, rowColToLatLon } from './engine'
import { ARTEMIS_III_URL, ARTEMIS_NOTE, formatDuration, loadArtemis, type Region, type Site, type SiteSummary, type Viability } from './data'

// F6a: top-down map of 85-90 S, 0 E up (same orientation as the pipeline). Plain canvas, no map library.

type Layer = 'relief' | 'sun' | 'earth' | 'psr' | 'slope'
const LAYERS: { id: Layer; label: string; source: string }[] = [
  { id: 'relief', label: 'Shaded relief', source: 'Our shading of NASA LOLA terrain, 240 m' },
  { id: 'sun', label: 'Sunlit % (NASA)', source: 'NASA PGDA illumination map, 18.6-year average, 60 m averaged to 240 m' },
  { id: 'earth', label: 'Earth in view % (NASA)', source: 'NASA PGDA Earth visibility map, 18.6-year average' },
  { id: 'psr', label: 'Permanent shadow (NASA)', source: 'NASA PGDA permanently shadowed regions, 60 m' },
  { id: 'slope', label: 'Slope', source: 'From NASA LOLA terrain at 240 m; real slopes at lander scale are steeper' },
]
const ZOOMS = [
  { z: 1, label: '85–90° S' },
  { z: 2, label: '87.5–90° S' },
  { z: 4, label: '88.7–90° S' },
]
// Colour ramps, night -> light, per the plan's colour language (amber Sun, blue Earth).
const NIGHT = [26, 31, 38]
const RAMPS: Record<Exclude<Layer, 'relief' | 'psr'>, number[]> = { sun: [242, 190, 92], earth: [128, 170, 235], slope: [226, 150, 205] }
const PSR = [70, 90, 200]

interface MapData {
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

/** Height (m) and slope (deg) at a map pixel, from the DEM crop (map grid sits in its centre). */
function terrainAt(d: MapData, r: number, c: number) {
  const off = (d.demN - d.n) / 2
  const k = (r + off) * d.demN + (c + off)
  const h = d.dem[k] * 0.5
  const dx = ((d.dem[k + 1] - d.dem[k - 1]) * 0.5) / (2 * d.scale)
  const dy = ((d.dem[k + d.demN] - d.dem[k - d.demN]) * 0.5) / (2 * d.scale)
  return { h, slope: (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI, dx, dy }
}

function render(d: MapData, layer: Layer): OffscreenCanvas {
  const img = new ImageData(d.n, d.n)
  const px = img.data
  const L = [-Math.SQRT1_2, -Math.SQRT1_2, 1] // light from the upper left, 45 deg up
  const ln = Math.hypot(...L)
  for (let r = 0; r < d.n; r++)
    for (let c = 0; c < d.n; c++) {
      const k = r * d.n + c
      const t = terrainAt(d, r, c)
      // Hillshade: normal (-dz/dx, dz/dy, 1) in screen axes (row increases downward).
      const nx = -t.dx
      const ny = -t.dy
      const shade = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / (Math.hypot(nx, ny, 1) * ln))
      const g = 20 + 150 * shade ** 1.3 // flat ground ~ mid-dark grey so overlays and labels stay readable
      let rgb = [g, g, g]
      if (layer !== 'relief') {
        const v = layer === 'slope' ? Math.min(t.slope, 30) / 30 : layer === 'psr' ? d.psr[k] : d[layer][k] / 100
        if ((layer === 'sun' || layer === 'earth' || layer === 'psr') && d[layer][k] === 255) rgb = [g * 0.35, g * 0.35, g * 0.35]
        else if (layer === 'psr') rgb = d.psr[k] === 100 ? PSR.map((x) => x * (0.6 + 0.4 * shade)) : [g * 0.55, g * 0.55, g * 0.55]
        else {
          const ramp = RAMPS[layer as 'sun' | 'earth' | 'slope']
          const s = 0.7 + 0.3 * shade
          rgb = NIGHT.map((n0, j) => (n0 + (ramp[j] - n0) * (v as number)) * s)
        }
      }
      px[4 * k] = rgb[0]
      px[4 * k + 1] = rgb[1]
      px[4 * k + 2] = rgb[2]
      px[4 * k + 3] = 255
    }
  const oc = new OffscreenCanvas(d.n, d.n)
  oc.getContext('2d')!.putImageData(img, 0, 0)
  return oc
}

/** F7 finder overlay: one dot per candidate spot, ranked ones numbered. */
export interface Dot {
  lat: number
  lon: number
  v: Viability
  rank?: number
}

interface Props {
  dots?: Dot[]
  side?: ReactNode // replaces the layer/hover panel (the finder uses it)
  sites: SiteSummary[]
  site: Site | null
  onPickSite: (id: string) => void
  onPickPoint: (lat: number, lon: number) => void
  busy: boolean
  pickError: string
  onOpenSite: () => void
  onCompare: () => void
}

export function MapView(p: Props) {
  const [data, setData] = useState<MapData | null>(null)
  const [err, setErr] = useState('')
  const [layer, setLayer] = useState<Layer>('relief')
  const [zoom, setZoom] = useState(1)
  const [hover, setHover] = useState<{ lat: number; lon: number; r: number; c: number } | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [regions, setRegions] = useState<Region[]>([])
  const [showRegions, setShowRegions] = useState(true)

  useEffect(() => {
    ;(cached ??= loadMap()).then(setData, (e) => setErr(String(e.message ?? e)))
    loadArtemis().then(setRegions, () => setRegions([]))
  }, [])

  const layerCanvas = useMemo(() => (data ? render(data, layer) : null), [data, layer])

  // Map pixel <-> canvas position for the current zoom (centred on the pole).
  const view = useMemo(() => {
    if (!data) return null
    const sw = data.n / zoom
    return { sx: (data.n - sw) / 2, sw }
  }, [data, zoom])

  const toCanvas = (lat: number, lon: number, size: number): [number, number] | null => {
    if (!data || !view) return null
    const rr = 2 * R_M * Math.tan(((90 + lat) * Math.PI) / 360)
    const c = data.n / 2 - 0.5
    const row = c - (rr * Math.cos((lon * Math.PI) / 180)) / data.scale
    const col = c + (rr * Math.sin((lon * Math.PI) / 180)) / data.scale
    return [((col + 0.5 - view.sx) / view.sw) * size, ((row + 0.5 - view.sx) / view.sw) * size]
  }

  const markers = p.sites.filter((s) => s.lat <= -85 && s.kind !== 'custom')

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !layerCanvas || !view || !data) return
    const size = cv.clientWidth
    const dpr = window.devicePixelRatio || 1
    cv.width = size * dpr
    cv.height = size * dpr
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.imageSmoothingEnabled = zoom < 4
    g.drawImage(layerCanvas, view.sx, view.sx, view.sw, view.sw, 0, 0, size, size)

    // Graticule: latitude circles and 30 deg meridians.
    g.strokeStyle = 'rgba(255,255,255,0.32)'
    g.lineWidth = 1
    g.font = '11px "Public Sans", sans-serif'
    const label = (text: string, x: number, y: number) => {
      g.lineWidth = 3
      g.strokeStyle = 'rgba(17,20,24,0.9)'
      g.strokeText(text, x, y)
      g.fillStyle = '#d9d6cf'
      g.fillText(text, x, y)
      g.lineWidth = 1
      g.strokeStyle = 'rgba(255,255,255,0.32)'
    }
    const centre = toCanvas(-90, 0, size)!
    const lats = zoom === 1 ? [-89, -88, -87, -86] : zoom === 2 ? [-89.5, -89, -88.5, -88] : [-89.75, -89.5, -89.25, -89]
    for (const lat of lats) {
      const pt = toCanvas(lat, 0, size)!
      const rad = Math.hypot(pt[0] - centre[0], pt[1] - centre[1])
      g.beginPath()
      g.arc(centre[0], centre[1], rad, 0, 2 * Math.PI)
      g.stroke()
      label(`${Math.abs(lat)}° S`, centre[0] + 4, centre[1] - rad - 3)
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const edge = toCanvas(zoom === 1 ? -85 : zoom === 2 ? -87.5 : -88.7, lon, size)!
      g.beginPath()
      g.moveTo(centre[0], centre[1])
      g.lineTo(edge[0], edge[1])
      g.stroke()
      const lab = toCanvas(zoom === 1 ? -85.25 : zoom === 2 ? -87.65 : -88.78, lon, size)!
      const lw = lon > 180 ? lon - 360 : lon
      g.textAlign = 'center'
      label(lon === 0 ? '0°' : lon === 180 ? '180°' : `${Math.abs(lw)}° ${lw > 0 ? 'E' : 'W'}`, lab[0], lab[1] + 4)
      g.textAlign = 'start'
    }
    // F7 candidate spots: viable = filled, marginal = ring, not viable = faint speck; ranked = numbered badge.
    const r0 = Math.min(2 + zoom, 5)
    for (const d of p.dots ?? []) {
      if (d.rank || d.v === 'nodata') continue
      const pt = toCanvas(d.lat, d.lon, size)
      if (!pt) continue
      g.beginPath()
      g.arc(pt[0], pt[1], d.v === 'not' ? r0 * 0.45 : r0, 0, 2 * Math.PI)
      if (d.v === 'viable') {
        g.fillStyle = '#e4e1da'
        g.fill()
        g.lineWidth = 1
        g.strokeStyle = '#111418'
        g.stroke()
      } else if (d.v === 'marginal') {
        g.lineWidth = 1.5
        g.strokeStyle = '#e4e1da'
        g.stroke()
      } else {
        g.fillStyle = 'rgba(17,20,24,0.4)'
        g.fill()
      }
    }
    g.font = '700 11px "Public Sans", sans-serif'
    g.textAlign = 'center'
    for (const d of (p.dots ?? []).filter((x) => x.rank).reverse()) {
      const pt = toCanvas(d.lat, d.lon, size)
      if (!pt) continue
      g.beginPath()
      g.arc(pt[0], pt[1], 8.5, 0, 2 * Math.PI)
      g.fillStyle = '#e4e1da'
      g.fill()
      g.lineWidth = 2
      g.strokeStyle = '#111418'
      g.stroke()
      g.fillStyle = '#111418'
      g.fillText(String(d.rank), pt[0], pt[1] + 4)
    }
    g.textAlign = 'start'
    // Curated sites and the custom pin.
    g.font = '600 12px "Public Sans", sans-serif'
    const placed: number[] = [] // label y positions already used near each other: shift down to avoid overlap
    for (const s of markers) {
      const pt = toCanvas(s.lat, s.lon, size)
      if (!pt) continue
      const selected = p.site?.id === s.id
      g.beginPath()
      g.arc(pt[0], pt[1], selected ? 6 : 4.5, 0, 2 * Math.PI)
      g.fillStyle = selected ? '#d9d6cf' : '#1a1f26'
      g.fill()
      g.lineWidth = 2
      g.strokeStyle = '#d9d6cf'
      g.stroke()
      let ly = pt[1] + 4
      while (placed.some((y) => Math.abs(y - ly) < 15)) ly += 15
      placed.push(ly)
      if (ly !== pt[1] + 4) {
        g.beginPath()
        g.moveTo(pt[0] + 5, pt[1] + 2)
        g.lineTo(pt[0] + 8, ly - 4)
        g.strokeStyle = '#d9d6cf'
        g.lineWidth = 1
        g.stroke()
      }
      label(s.name, pt[0] + 10, ly)
    }
    // NASA candidate landing regions: hollow diamonds at approximate centres.
    if (showRegions)
      for (const r of regions) {
        const pt = r.lat <= -85 ? toCanvas(r.lat, r.lon, size) : null
        if (!pt) continue
        g.beginPath()
        g.moveTo(pt[0], pt[1] - 7)
        g.lineTo(pt[0] + 7, pt[1])
        g.lineTo(pt[0], pt[1] + 7)
        g.lineTo(pt[0] - 7, pt[1])
        g.closePath()
        g.lineWidth = 3.5
        g.strokeStyle = '#111418'
        g.stroke()
        g.lineWidth = 1.5
        g.strokeStyle = '#d9d6cf'
        g.stroke()
        let ly = pt[1] + 4
        while (placed.some((y) => Math.abs(y - ly) < 15)) ly += 15
        placed.push(ly)
        g.font = 'italic 12px "Public Sans", sans-serif'
        label(r.name, pt[0] + 11, ly)
      }
    g.font = '600 12px "Public Sans", sans-serif'
    if (p.site?.kind === 'custom') {
      const pt = toCanvas(p.site.lat, p.site.lon, size)
      if (pt) {
        g.beginPath()
        g.moveTo(pt[0], pt[1])
        g.lineTo(pt[0] - 7, pt[1] - 16)
        g.arc(pt[0], pt[1] - 18, 7, Math.PI * 0.8, Math.PI * 0.2)
        g.closePath()
        g.fillStyle = '#d9d6cf'
        g.fill()
        g.lineWidth = 2
        g.strokeStyle = '#1a1f26'
        g.stroke()
      }
    }
    // Scale bar.
    const km = zoom === 1 ? 50 : zoom === 2 ? 20 : 10
    const len = ((km * 1000) / (view.sw * data.scale)) * size
    g.fillStyle = '#d9d6cf'
    g.fillRect(16, size - 22, len, 3)
    label(`${km} km`, 16, size - 28)
  })

  const pixelAt = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!data || !view) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const col = view.sx + ((e.clientX - rect.left) / rect.width) * view.sw - 0.5
    const row = view.sx + ((e.clientY - rect.top) / rect.height) * view.sw - 0.5
    const [lat, lon] = rowColToLatLon(row, col, data.n, data.scale)
    return { lat, lon, r: Math.round(row), c: Math.round(col), x: e.clientX - rect.left, y: e.clientY - rect.top, size: rect.width }
  }

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const q = pixelAt(e)
    if (!q) return
    const near = markers.find((s) => {
      const pt = toCanvas(s.lat, s.lon, q.size)
      return pt && Math.hypot(pt[0] - q.x, pt[1] - q.y) < 9
    })
    const ranked = (p.dots ?? []).find((d) => {
      const pt = d.rank ? toCanvas(d.lat, d.lon, q.size) : null
      return pt && Math.hypot(pt[0] - q.x, pt[1] - q.y) < 10
    })
    if (ranked) p.onPickPoint(ranked.lat, ranked.lon)
    else if (near) p.onPickSite(near.id)
    else if (q.lat <= -85) p.onPickPoint(q.lat, q.lon)
  }

  const t = data && hover && hover.r >= 1 && hover.c >= 1 && hover.r < data.n - 1 && hover.c < data.n - 1 ? terrainAt(data, hover.r, hover.c) : null
  const k = data && hover ? hover.r * data.n + hover.c : 0
  const layerValue = (l: Layer) => {
    if (!data || !hover || !t) return ''
    if (l === 'sun' || l === 'earth') return data[l][k] === 255 ? 'no data' : `${data[l][k]}%`
    if (l === 'psr') return data.psr[k] === 255 ? 'no data' : data.psr[k] === 100 ? 'Yes' : 'No'
    return ''
  }
  const lonW = hover ? (hover.lon > 180 ? hover.lon - 360 : hover.lon) : 0
  const active = LAYERS.find((l) => l.id === layer)!

  return (
    <div className="map-screen">
      <div className="map-wrap">
        {err && <p className="error">Couldn't load the map data: {err}</p>}
        {!data && !err && <p className="loading">Loading the south-pole map (about 14 MB, once)</p>}
        <canvas
          ref={canvas}
          className="map-canvas"
          style={{ display: data ? 'block' : 'none' }}
          role="img"
          aria-label="Map of the lunar south pole, 0° E at the top. Click anywhere to analyse that point."
          onMouseMove={(e) => {
            const q = pixelAt(e)
            setHover(q && q.lat <= -85 ? q : null)
          }}
          onMouseLeave={() => setHover(null)}
          onClick={onClick}
        />
      </div>

      <aside className="map-side">
        {!p.side && (
          <>
        <fieldset className="thresholds">
          <legend>Layer</legend>
          {LAYERS.map((l) => (
            <label key={l.id} className="radio">
              <input type="radio" name="layer" checked={layer === l.id} onChange={() => setLayer(l.id)} />
              {l.label}
            </label>
          ))}
          <p className="chart-note">{active.source}</p>
          {layer !== 'relief' && layer !== 'psr' && (
            <div className="ramp">
              <span className={`ramp-bar ramp-${layer}`} />
              <span className="muted">{layer === 'slope' ? '0°' : '0%'}</span>
              <span className="muted">{layer === 'slope' ? '30°+' : '100%'}</span>
            </div>
          )}
        </fieldset>

          </>
        )}
        <div className="seg" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z.z} aria-pressed={zoom === z.z} onClick={() => setZoom(z.z)}>
              {z.label}
            </button>
          ))}
        </div>
        <label className="radio">
          <input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} />
          NASA candidate landing regions ◇
        </label>
        {showRegions && regions.length > 0 && (
          <p className="chart-note">
            {ARTEMIS_NOTE} {regions.filter((r) => r.lat > -85).map((r) => r.name).join(', ')} lie north of 85° S, off this
            map; see the Globe.{' '}
            <a href={regions[0].source_url} target="_blank" rel="noopener noreferrer">NASA regions</a> ·{' '}
            <a href={ARTEMIS_III_URL} target="_blank" rel="noopener noreferrer">Artemis III today</a>
          </p>
        )}

        {p.side ?? (
          <>
        <div className="hover-box" aria-live="off">
          {hover && t ? (
            <dl>
              <dt>Point</dt>
              <dd>
                {Math.abs(hover.lat).toFixed(3)}° S, {Math.abs(lonW).toFixed(2)}° {lonW >= 0 ? 'E' : 'W'}
              </dd>
              <dt>Terrain height</dt>
              <dd>{t.h.toFixed(0)} m</dd>
              <dt>Slope (240 m)</dt>
              <dd>{t.slope.toFixed(1)}°</dd>
              <dt>NASA sunlit</dt>
              <dd>{layerValue('sun')}</dd>
              <dt>NASA Earth in view</dt>
              <dd>{layerValue('earth')}</dd>
              <dt>Permanent shadow</dt>
              <dd>{layerValue('psr')}</dd>
            </dl>
          ) : (
            <p className="muted">Hover the map to read terrain and NASA values. Click anywhere to analyse that point, or click a site marker.</p>
          )}
        </div>

        <div className="pick-box">
          {p.busy && <p>Computing horizon and a year of Sun and Earth visibility…</p>}
          {p.pickError && <p className="error">{p.pickError}</p>}
          {!p.busy && p.site && (
            <>
              <h3>{p.site.name}</h3>
              <dl>
                <dt>Sunlit over 2027</dt>
                <dd>{p.site.metrics.sunlit_pct.toFixed(1)}%</dd>
                <dt>Earth in view</dt>
                <dd>{p.site.metrics.earth_visible_pct.toFixed(1)}%</dd>
                <dt>Longest darkness</dt>
                <dd>{formatDuration(p.site.metrics.longest_dark_h)}</dd>
              </dl>
              <div className="pick-actions">
                <button onClick={p.onOpenSite}>Open in Site and plan</button>
                <button onClick={p.onCompare}>Add to comparison</button>
              </div>
            </>
          )}
        </div>
        <p className="chart-note">
          Custom points: 85–90° S only, terrain at 240 m. Our numbers are for 2027 at 2 m height; NASA's layers are 18.6-year
          averages at the surface, so they differ a little.
        </p>
          </>
        )}
      </aside>
    </div>
  )
}
