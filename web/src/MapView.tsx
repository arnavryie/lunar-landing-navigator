import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { R_M, polarRowCol, rowColToLatLon } from './engine'
import { loadMapData, slopeGrid, terrainAt, type MapData } from './mapData'
import { VCOLOR, VERDICT_CUTOFF, VERDICT_COLOR, type Verdict } from './ellipseCheck'
import { ARTEMIS_3_SITES, type ArtemisSiteData } from './data/artemisData'
import { ARTEMIS_III_URL, ARTEMIS_NOTE, formatDuration, loadArtemis, type Region, type Site, type SiteSummary, type Viability } from './data'

// F6a: top-down map of 85-90 S, 0 E up (same orientation as the pipeline). Plain canvas, no map library.

type Layer = 'relief' | 'sun' | 'earth' | 'psr' | 'slope' | 'landing' | 'area'
const LAYERS: { id: Layer; label: string; source: string }[] = [
  { id: 'relief', label: 'Shaded relief', source: 'Our shading of NASA LOLA terrain, 240 m' },
  { id: 'sun', label: 'Sunlit % (NASA)', source: 'NASA PGDA illumination map, 18.6-year average, 60 m averaged to 240 m' },
  { id: 'earth', label: 'Earth in view % (NASA)', source: 'NASA PGDA Earth visibility map, 18.6-year average' },
  { id: 'psr', label: 'Permanent shadow (NASA)', source: 'NASA PGDA permanently shadowed regions, 60 m' },
  { id: 'slope', label: 'Slope', source: 'From NASA LOLA terrain at 240 m; real slopes at lander scale are steeper' },
  {
    id: 'landing', label: 'Landing terrain',
    source: 'Your slope limit applied to NASA LOLA terrain (240 m), plus NASA permanent shadow (no sunlight for a solar lander). Boulders and small craters are smaller than a pixel, so this is not a touchdown-safety map.',
  },
  {
    id: 'area', label: 'Landing area',
    source: 'Share of landable ground (within your slope limit, not in permanent shadow) in a square as wide as your landing ellipse around each point. Bright green = you can land anywhere nearby.',
  },
]
const rgb = (hex: string) => [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16))
const GREEN = rgb(VCOLOR.viable)
const AMBER = rgb(VCOLOR.marginal)
const RED = rgb(VCOLOR.not)
const mix = (a: number[], b: number[], f: number) => a.map((x, j) => x + (b[j] - x) * f)
const ZOOMS = [
  { z: 1, label: '85–90° S' },
  { z: 2, label: '87.5–90° S' },
  { z: 4, label: '88.7–90° S' },
]
// Colour ramps, night -> light, per the plan's colour language (amber Sun, blue Earth).
const NIGHT = [26, 31, 38]
const RAMPS: Record<'sun' | 'earth' | 'slope', number[]> = { sun: [242, 190, 92], earth: [128, 170, 235], slope: [226, 150, 205] }
const PSR = [70, 90, 200]

/** Landing-area share for every pixel: landable pixels (slope <= limit, not permanent shadow) in a square of
 *  side areaKm around it, from an integral image (instant at any size). NaN where the window is off the map. */
function landingArea(d: MapData, maxSlope: number, areaKm: number): Float32Array {
  const n = d.n
  const slope = slopeGrid(d)
  const I = new Float64Array((n + 1) * (n + 1)) // I[(r+1)(n+1) + c+1] = landable pixels in [0..r] x [0..c]
  const C = new Float64Array((n + 1) * (n + 1)) // same, pixels with data
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const k = r * n + c
      const known = Number.isFinite(slope[k]) && d.psr[k] !== 255 ? 1 : 0
      const ok = known && slope[k] <= maxSlope && d.psr[k] !== 100 ? 1 : 0
      const o = (r + 1) * (n + 1) + c + 1
      I[o] = ok + I[o - 1] + I[o - n - 1] - I[o - n - 2]
      C[o] = known + C[o - 1] + C[o - n - 1] - C[o - n - 2]
    }
  const h = Math.max(1, Math.round((areaKm * 500) / d.scale))
  const out = new Float32Array(n * n)
  const box = (A: Float64Array, r0: number, c0: number, r1: number, c1: number) =>
    A[(r1 + 1) * (n + 1) + c1 + 1] - A[r0 * (n + 1) + c1 + 1] - A[(r1 + 1) * (n + 1) + c0] + A[r0 * (n + 1) + c0]
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const r0 = Math.max(0, r - h), r1 = Math.min(n - 1, r + h), c0 = Math.max(0, c - h), c1 = Math.min(n - 1, c + h)
      const known = box(C, r0, c0, r1, c1)
      out[r * n + c] = known > 0.5 * (2 * h + 1) ** 2 ? box(I, r0, c0, r1, c1) / known : NaN
    }
  return out
}

function render(d: MapData, layer: Layer, maxSlope: number, areaKm: number): OffscreenCanvas {
  const area = layer === 'area' ? landingArea(d, maxSlope, areaKm) : null
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
      if (layer === 'landing' || layer === 'area') {
        const s = 0.6 + 0.4 * shade
        if (layer === 'area') {
          const f = area![k]
          rgb = Number.isNaN(f) ? [g * 0.35, g * 0.35, g * 0.35]
            : (f < VERDICT_CUTOFF.caution ? mix(RED, AMBER, f / VERDICT_CUTOFF.caution) : mix(AMBER, GREEN, Math.min(1, (f - VERDICT_CUTOFF.caution) / (VERDICT_CUTOFF.ok - VERDICT_CUTOFF.caution)))).map((x) => x * s)
        } else if (d.psr[k] === 255) rgb = [g * 0.35, g * 0.35, g * 0.35]
        else if (d.psr[k] === 100) rgb = PSR.map((x) => x * s)
        else rgb = (t.slope <= maxSlope ? GREEN : t.slope <= 1.5 * maxSlope ? AMBER : RED).map((x) => x * s)
      } else if (layer !== 'relief') {
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
  cross?: boolean // landing-ellipse sample: green / amber / red, "not viable" as an x
  note?: string // shown when hovering the point
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
  /** Landing ellipse: outline to draw, and the point/size the "Ellipse" zoom centres on. */
  outline?: { lat: number; lon: number }[]
  focus?: { lat: number; lon: number; km: number } | null
  cells?: { corners: { lat: number; lon: number }[]; v: Viability }[] // ellipse tiles, coloured by result
  verdict?: Verdict | null // ellipse outline colour
  maxSlope?: number // for the landing layers
  areaKm?: number // landing-area layer window (ellipse size)
  extra?: ReactNode // extra panel under the picked-point box
  onOpenArtemis?: () => void
}

export function MapView(p: Props) {
  const [data, setData] = useState<MapData | null>(null)
  const [err, setErr] = useState('')
  const [layer, setLayer] = useState<Layer>('relief')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const hasMovedRef = useRef(false)
  const [hover, setHover] = useState<{ lat: number; lon: number; r: number; c: number; x: number; y: number; size: number } | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [regions, setRegions] = useState<Region[]>([])
  const [showRegions, setShowRegions] = useState(true)
  const [selectedArtemis, setSelectedArtemis] = useState<ArtemisSiteData | null>(null)

  useEffect(() => {
    ;loadMapData().then(setData, (e) => setErr(String(e.message ?? e)))
    loadArtemis().then(setRegions, () => setRegions([]))
  }, [])

  useEffect(() => {
    const s = p.site
    if (!s) return
    const match = ARTEMIS_3_SITES.find((a) => {
      if (s.id === `artemis-${a.id}`) return true
      if (s.name.toLowerCase().includes(a.name.toLowerCase())) return true
      const dLon = Math.abs((((a.lon - s.lon) % 360) + 540) % 360 - 180)
      return Math.hypot(a.lat - s.lat, dLon * Math.cos(((a.lat + s.lat) * 0.5 * Math.PI) / 180)) < 0.5
    })
    if (match) setSelectedArtemis(match)
  }, [p.site])

  const maxSlope = p.maxSlope ?? 8
  const areaKm = p.areaKm ?? 4
  const needs = layer === 'landing' || layer === 'area' ? `${maxSlope}|${layer === 'area' ? areaKm : ''}` : ''
  const layerCanvas = useMemo(() => (data ? render(data, layer, maxSlope, areaKm) : null), [data, layer, needs]) // eslint-disable-line react-hooks/exhaustive-deps

  // zoom 0 = centred on the landing ellipse; switch to it when an ellipse appears, back out when it goes.
  const focusKey = p.focus ? `${p.focus.lat},${p.focus.lon}` : ''
  useEffect(() => {
    setPan({ x: 0, y: 0 })
    if (focusKey) setZoom(0)
    else setZoom((z) => z || 1)
  }, [focusKey])

  // Mouse wheel zoom towards mouse cursor
  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const zoomFactor = e.deltaY < 0 ? 1.2 : 1 / 1.2
      setZoom((prevZoom) => {
        const cur = prevZoom === 0 ? 3 : prevZoom || 1
        const next = Math.max(1, Math.min(24, Number((cur * zoomFactor).toFixed(2))))
        if (next === 1) setPan({ x: 0, y: 0 })
        return next
      })
    }
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => cv.removeEventListener('wheel', onWheel)
  }, [])

  // Map pixel <-> canvas position for the current zoom and pan.
  const view = useMemo(() => {
    if (!data) return null
    if (zoom === 0 && p.focus) {
      const sw = Math.max((p.focus.km * 3000) / data.scale, 16) // ellipse fills about a third of the map
      const [row, col] = polarRowCol(p.focus.lat, p.focus.lon, data.n, data.scale)
      return { sx: col + 0.5 - sw / 2 + pan.x, sy: row + 0.5 - sw / 2 + pan.y, sw }
    }
    const sw = data.n / (zoom || 1)
    return { sx: (data.n - sw) / 2 + pan.x, sy: (data.n - sw) / 2 + pan.y, sw }
  }, [data, zoom, p.focus, pan])

  const toCanvas = (lat: number, lon: number, size: number): [number, number] | null => {
    if (!data || !view) return null
    const rr = 2 * R_M * Math.tan(((90 + lat) * Math.PI) / 360)
    const c = data.n / 2 - 0.5
    const row = c - (rr * Math.cos((lon * Math.PI) / 180)) / data.scale
    const col = c + (rr * Math.sin((lon * Math.PI) / 180)) / data.scale
    return [((col + 0.5 - view.sx) / view.sw) * size, ((row + 0.5 - view.sy) / view.sw) * size]
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
    g.imageSmoothingEnabled = zoom > 0 && zoom < 4
    g.fillStyle = '#0f0e0c'
    g.fillRect(0, 0, size, size) // the ellipse zoom can reach past the map edge
    g.drawImage(layerCanvas, view.sx, view.sy, view.sw, view.sw, 0, 0, size, size)

    // Graticule: latitude circles and 30 deg meridians.
    g.strokeStyle = 'rgba(255,255,255,0.32)'
    g.lineWidth = 1
    g.font = '11px "Public Sans", sans-serif'
    const label = (text: string, x: number, y: number) => {
      g.lineWidth = 3
      g.strokeStyle = 'rgba(15,14,12,0.9)'
      g.strokeText(text, x, y)
      g.fillStyle = '#ebe7dd'
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
    const r0 = zoom ? Math.min(2 + zoom, 5) : 5
    for (const d of p.dots ?? []) {
      if (d.rank || d.v === 'nodata') continue
      const pt = toCanvas(d.lat, d.lon, size)
      if (!pt) continue
      g.beginPath()
      g.arc(pt[0], pt[1], d.v === 'not' ? r0 * 0.45 : r0, 0, 2 * Math.PI)
      if (d.v === 'viable') {
        g.fillStyle = d.cross ? VCOLOR.viable : '#e4e1da'
        g.fill()
        g.lineWidth = 1
        g.strokeStyle = '#0f0e0c'
        g.stroke()
      } else if (d.v === 'marginal') {
        g.lineWidth = d.cross ? 2.5 : 1.5
        g.strokeStyle = d.cross ? VCOLOR.marginal : '#e4e1da'
        g.stroke()
      } else if (d.cross) {
        g.beginPath()
        g.moveTo(pt[0] - r0, pt[1] - r0)
        g.lineTo(pt[0] + r0, pt[1] + r0)
        g.moveTo(pt[0] + r0, pt[1] - r0)
        g.lineTo(pt[0] - r0, pt[1] + r0)
        g.lineWidth = 3.5
        g.strokeStyle = '#0f0e0c'
        g.stroke()
        g.lineWidth = 1.5
        g.strokeStyle = VCOLOR.not
        g.stroke()
      } else {
        g.fillStyle = 'rgba(15,14,12,0.4)'
        g.fill()
      }
    }
    // Landing ellipse outline: dark halo + light dashes while computing, then solid green / amber / red by verdict.
    if (p.outline?.length) {
      const pts = p.outline.map((q) => toCanvas(q.lat, q.lon, size)!)
      const ring = () => {
        g.beginPath()
        pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)))
      }
      // Tiles: each sample's share of the ellipse, coloured by its result, clipped to the ellipse.
      if (p.cells?.length) {
        g.save()
        ring()
        g.clip()
        g.globalAlpha = 0.42
        for (const cell of p.cells) {
          g.beginPath()
          cell.corners.forEach((q, j) => {
            const [x, y] = toCanvas(q.lat, q.lon, size)!
            if (j) g.lineTo(x, y)
            else g.moveTo(x, y)
          })
          g.closePath()
          g.fillStyle = VCOLOR[cell.v]
          g.fill()
        }
        g.restore()
      }
      const line = p.verdict ? VERDICT_COLOR[p.verdict] : '#e4e1da'
      for (const [w, c, dash] of [[p.verdict ? 5 : 4, '#0f0e0c', []], [p.verdict ? 2.8 : 1.8, line, p.verdict ? [] : [6, 4]]] as const) {
        g.beginPath()
        pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)))
        g.lineWidth = w
        g.strokeStyle = c
        g.setLineDash([...dash])
        g.stroke()
      }
      g.setLineDash([])
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
      g.strokeStyle = '#0f0e0c'
      g.stroke()
      g.fillStyle = '#0f0e0c'
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
      g.fillStyle = selected ? '#ebe7dd' : '#181715'
      g.fill()
      g.lineWidth = 2
      g.strokeStyle = '#ebe7dd'
      g.stroke()
      let ly = pt[1] + 4
      while (placed.some((y) => Math.abs(y - ly) < 15)) ly += 15
      placed.push(ly)
      if (ly !== pt[1] + 4) {
        g.beginPath()
        g.moveTo(pt[0] + 5, pt[1] + 2)
        g.lineTo(pt[0] + 8, ly - 4)
        g.strokeStyle = '#ebe7dd'
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
        g.strokeStyle = '#0f0e0c'
        g.stroke()
        const isArtemisSel = selectedArtemis?.name.toLowerCase() === r.name.toLowerCase()
        g.lineWidth = isArtemisSel ? 2.5 : 1.5
        g.strokeStyle = isArtemisSel ? '#f2efe8' : '#cf86c3'
        g.stroke()
        if (isArtemisSel) {
          g.beginPath()
          g.arc(pt[0], pt[1], 12, 0, Math.PI * 2)
          g.lineWidth = 1
          g.strokeStyle = '#f2efe8'
          g.stroke()
        }
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
        g.fillStyle = '#ebe7dd'
        g.fill()
        g.lineWidth = 2
        g.strokeStyle = '#181715'
        g.stroke()
      }
    }
    // Scale bar.
    const viewKm = (view.sw * data.scale) / 1000
    const km = zoom === 1 ? 50 : zoom === 2 ? 20 : zoom === 4 ? 10 : [10, 5, 2, 1, 0.5].find((k) => k <= viewKm / 4) ?? 0.5
    const len = ((km * 1000) / (view.sw * data.scale)) * size
    g.fillStyle = '#ebe7dd'
    g.fillRect(16, size - 22, len, 3)
    label(`${km} km`, 16, size - 28)
  })

  const pixelAt = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!data || !view) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const col = view.sx + ((e.clientX - rect.left) / rect.width) * view.sw - 0.5
    const row = view.sy + ((e.clientY - rect.top) / rect.height) * view.sw - 0.5
    const [lat, lon] = rowColToLatLon(row, col, data.n, data.scale)
    return { lat, lon, r: Math.round(row), c: Math.round(col), x: e.clientX - rect.left, y: e.clientY - rect.top, size: rect.width }
  }

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const q = pixelAt(e)
    if (!q) return
    const nearArtemis = ARTEMIS_3_SITES.find((a) => {
      const pt = a.lat <= -85 ? toCanvas(a.lat, a.lon, q.size) : null
      return pt && Math.hypot(pt[0] - q.x, pt[1] - q.y) < 14
    })
    if (nearArtemis) {
      setSelectedArtemis(nearArtemis)
      p.onPickPoint(nearArtemis.lat, nearArtemis.lon)
      return
    }
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
    else if (q.lat <= -85) {
      setSelectedArtemis(null)
      p.onPickPoint(q.lat, q.lon)
    }
  }

  const onMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    setIsDragging(true)
    hasMovedRef.current = false
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  const onMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      if (Math.hypot(dx, dy) > 3) {
        hasMovedRef.current = true
      }
      if (hasMovedRef.current && view && canvas.current) {
        const size = canvas.current.clientWidth || 1
        const scale = view.sw / size
        setPan({
          x: dragStartRef.current.panX - dx * scale,
          y: dragStartRef.current.panY - dy * scale,
        })
      }
    }
    const q = pixelAt(e)
    setHover(q && q.lat <= -85 ? q : null)
  }

  const onMouseUp = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && !hasMovedRef.current) {
      onClick(e)
    }
    setIsDragging(false)
  }

  const onMouseLeave = () => {
    setIsDragging(false)
    setHover(null)
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
  // Landing-ellipse point under the mouse (within 12 px): its result and why.
  const note = hover
    ? (p.dots ?? []).find((d) => {
        const pt = d.note ? toCanvas(d.lat, d.lon, hover.size) : null
        return pt && Math.hypot(pt[0] - hover.x, pt[1] - hover.y) < 12
      })?.note
    : undefined
  const active = LAYERS.find((l) => l.id === layer)!

  const legend = (
    <>
      <p className="chart-note">{active.source}</p>
      {layer === 'landing' ? (
        <div className="legend landing-legend">
          {(
            [
              [VCOLOR.viable, `≤ ${maxSlope}° slope`],
              [VCOLOR.marginal, `${maxSlope}–${+(1.5 * maxSlope).toFixed(1)}° (caution)`],
              [VCOLOR.not, `> ${+(1.5 * maxSlope).toFixed(1)}° (too steep)`],
              [`rgb(${PSR.join(',')})`, 'permanent shadow'],
            ] as const
          ).map(([c, t]) => (
            <span key={t}>
              <span className="swatch" style={{ background: c }} aria-hidden="true" />
              {t}
            </span>
          ))}
        </div>
      ) : layer === 'area' ? (
        <div className="ramp">
          <span className="ramp-bar ramp-area" />
          <span className="muted">0% landable</span>
          <span className="muted">100% within {areaKm} km, slope ≤ {maxSlope}°</span>
        </div>
      ) : (
        layer !== 'relief' && layer !== 'psr' && (
          <div className="ramp">
            <span className={`ramp-bar ramp-${layer}`} />
            <span className="muted">{layer === 'slope' ? '0°' : '0%'}</span>
            <span className="muted">{layer === 'slope' ? '30°+' : '100%'}</span>
          </div>
        )
      )}
    </>
  )

  return (
    <div className="map-screen">
      <div className="map-wrap">
        {err && <p className="error">Couldn't load the map data: {err}</p>}
        {!data && !err && <p className="loading">Loading the south-pole map (about 14 MB, once)</p>}
        <canvas
          ref={canvas}
          className={`map-canvas ${isDragging ? 'is-dragging' : ''}`}
          style={{
            display: data ? 'block' : 'none',
            cursor: isDragging ? 'grabbing' : zoom > 1 || (zoom === 0 && p.focus) ? 'grab' : 'crosshair',
          }}
          role="img"
          aria-label="Map of the lunar south pole, 0° E at the top. Click anywhere to analyse that point. Drag to pan, scroll to zoom."
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        />
        <div className="map-zoom-controls" aria-label="Map zoom controls">
          <button
            type="button"
            title="Zoom in (+)"
            onClick={() => setZoom((z) => Math.min(24, Number(((z === 0 ? 3 : z || 1) * 1.35).toFixed(2))))}
          >
            +
          </button>
          <button
            type="button"
            title="Zoom out (−)"
            onClick={() => {
              setZoom((z) => {
                const nz = Math.max(1, Number(((z === 0 ? 3 : z || 1) / 1.35).toFixed(2)))
                if (nz === 1) setPan({ x: 0, y: 0 })
                return nz
              })
            }}
          >
            −
          </button>
          <button
            type="button"
            title="Reset map view"
            onClick={() => {
              setZoom(1)
              setPan({ x: 0, y: 0 })
            }}
          >
            ⊙
          </button>
        </div>
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
          {legend}
        </fieldset>

          </>
        )}
        {p.side && (
          <div className="layer-pick">
            <label className="field wide">
              <span>Map layer</span>
              <select value={layer} onChange={(e) => setLayer(e.target.value as Layer)}>
                {LAYERS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            {layer !== 'relief' && legend}
          </div>
        )}
        <div className="seg" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button
              key={z.z}
              aria-pressed={zoom === z.z}
              onClick={() => {
                setPan({ x: 0, y: 0 })
                setZoom(z.z)
              }}
            >
              {z.label}
            </button>
          ))}
          {p.focus && (
            <button
              aria-pressed={zoom === 0}
              onClick={() => {
                setPan({ x: 0, y: 0 })
                setZoom(0)
              }}
            >
              Ellipse
            </button>
          )}
        </div>
        <fieldset className="thresholds" style={{ borderColor: 'rgba(207, 134, 195, 0.4)' }}>
          <legend style={{ color: '#cf86c3', fontWeight: 600 }}>Artemis III candidate regions</legend>
          <div className="slips" style={{ gap: '6px' }}>
            {ARTEMIS_3_SITES.map((a) => (
              <button
                key={a.id}
                type="button"
                style={{
                  fontSize: '0.74rem',
                  padding: '3px 7px',
                  minWidth: 'auto',
                  borderColor: selectedArtemis?.id === a.id ? '#cf86c3' : undefined,
                  background: selectedArtemis?.id === a.id ? 'rgba(207, 134, 195, 0.22)' : undefined,
                  color: selectedArtemis?.id === a.id ? '#cf86c3' : undefined,
                  fontWeight: selectedArtemis?.id === a.id ? 600 : 400
                }}
                onClick={() => {
                  setSelectedArtemis(a)
                  p.onPickPoint(a.lat, a.lon)
                }}
              >
                {a.name}
              </button>
            ))}
          </div>

          {selectedArtemis && (
            <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(16, 15, 13, 0.85)', border: '1px solid #cf86c3', borderRadius: 'var(--radius-s)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div>
                  <h4 style={{ margin: '0 0 2px', fontSize: '0.92rem', color: '#cf86c3', fontWeight: 600 }}>{selectedArtemis.name}</h4>
                  <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                    {selectedArtemis.lat.toFixed(2)}° S, {Math.abs(selectedArtemis.lon).toFixed(1)}° {selectedArtemis.lon < 0 ? 'W' : 'E'} · Elev: ~+{selectedArtemis.elevation_km} km
                  </span>
                </div>
                <span style={{ fontSize: '0.68rem', padding: '2px 5px', borderRadius: '3px', fontWeight: 600, background: 'rgba(207, 134, 195, 0.2)', color: '#cf86c3', border: '1px solid currentColor' }}>
                  {selectedArtemis.resources.water_ice_potential} Ice
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', margin: '6px 0', lineHeight: 1.4 }}>{selectedArtemis.geology}</p>
              
              <div style={{ margin: '6px 0', fontSize: '0.74rem' }}>
                <strong style={{ color: '#e8e4da' }}>Mineral Composition:</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '3px 0 4px' }}>
                  {selectedArtemis.minerals.primary.map((m) => (
                    <span key={m} style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 5px', borderRadius: '3px', fontSize: '0.7rem' }}>
                      {m}
                    </span>
                  ))}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>{selectedArtemis.minerals.details}</div>
              </div>

              <div style={{ margin: '6px 0', fontSize: '0.74rem' }}>
                <strong style={{ color: '#cf86c3' }}>Water ice and volatiles</strong>
                <p style={{ margin: '2px 0 4px', color: '#c9c4b8' }}>{selectedArtemis.resources.water_ice_details}</p>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                  Depth: <strong>{selectedArtemis.resources.depth_estimate}</strong> · Volatiles: {selectedArtemis.resources.volatiles.join(', ')}
                </div>
              </div>

              <div style={{ margin: '6px 0', fontSize: '0.74rem' }}>
                <strong style={{ color: '#f2efe8' }}>In-situ resources (ISRU)</strong>
                <p style={{ margin: '2px 0 4px', color: '#c9c4b8' }}>{selectedArtemis.resources.isru_applications}</p>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                  Extractable Elements: {selectedArtemis.resources.isru_elements.join(' · ')}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                <button
                  type="button"
                  style={{ padding: '6px 10px', fontSize: '0.78rem', background: 'var(--ink)', color: 'var(--sheet)', border: 'none', borderRadius: 'var(--radius-s)', fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => {
                    p.onPickPoint(selectedArtemis.lat, selectedArtemis.lon)
                    p.onOpenSite()
                  }}
                >
                  Analyse in Site and plan
                </button>
                {p.onOpenArtemis && (
                  <button
                    type="button"
                    style={{ padding: '5px 8px', fontSize: '0.74rem', background: 'rgba(255, 255, 255, 0.08)', color: '#cf86c3', border: '1px solid rgba(207, 134, 195, 0.35)', borderRadius: 'var(--radius-s)', cursor: 'pointer' }}
                    onClick={p.onOpenArtemis}
                  >
                    Terrain and resources in 3D
                  </button>
                )}
              </div>
            </div>
          )}
        </fieldset>
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
              {note && (
                <>
                  <dt>Landing ellipse</dt>
                  <dd>{note}</dd>
                </>
              )}
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
        {p.extra}
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
