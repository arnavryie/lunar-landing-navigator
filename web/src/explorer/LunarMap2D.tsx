import { useEffect, useRef, useState } from 'react'
import type { SiteSummary, State } from '../data'
import { polarRowCol, rowColToLatLon } from '../engine'
import { loadMapData, slopeGrid, terrainAt, type MapData } from '../mapData'
import { ellipseOutline } from '../ellipseGeometry'
import type { EllipseDrawData, ExplorerLayers } from './CesiumMoon'
import {
  GLOBAL_LANDMARKS,
  SOUTH_POLE_PSRS,
  nearestPsr,
  type EphemerisInstant,
  type Region,
} from './moonMath'

export type Map2DProjection = 'polar' | 'global'

export interface LunarMap2DProps {
  projection: Map2DProjection
  onProjectionChange: (p: Map2DProjection) => void
  ephemeris: EphemerisInstant | null
  layers: ExplorerLayers
  sites: SiteSummary[]
  siteStates: Record<string, State>
  artemis: Region[]
  selected: { lat: number; lon: number; name?: string } | null
  cameraCenter: { lat: number; lon: number; heightKm: number } | null
  ellipse: EllipseDrawData | null
  onPickPoint: (lat: number, lon: number, label?: string, siteId?: string) => void
}

const STATE_COLOR: Record<State, string> = {
  both: '#1fa38a',
  sun: '#c98419',
  earth: '#5590d8',
  none: '#4a515a',
}

const V_COLOR = {
  viable: '#6fcf9f',
  marginal: '#e6c15a',
  not: '#f08a7a',
  nodata: '#4a515a',
}

type PolarBg = 'sun' | 'earth' | 'psr' | 'slope'

export function LunarMap2D({
  projection,
  onProjectionChange,
  ephemeris,
  layers,
  sites,
  siteStates,
  artemis,
  selected,
  cameraCenter,
  ellipse,
  onPickPoint,
}: LunarMap2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [polarBg, setPolarBg] = useState<PolarBg>('sun')
  const [mapData, setMapData] = useState<MapData | null>(null)
  const [globalImg, setGlobalImg] = useState<HTMLImageElement | null>(null)
  const polarCacheRef = useRef<Partial<Record<PolarBg, HTMLCanvasElement>>>({})
  const slopesRef = useRef<Float32Array | null>(null)
  const [hoverInfo, setHoverInfo] = useState<string>('')

  // Interactive Zoom & Pan states
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const hasMovedRef = useRef(false)

  // Reset zoom & pan when switching projection modes
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [projection])

  // Mouse wheel zoom towards pointer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const zoomFactor = e.deltaY < 0 ? 1.18 : 1 / 1.18

      setZoom((prevZoom) => {
        const nextZoom = Math.min(15, Math.max(1, prevZoom * zoomFactor))
        if (nextZoom === prevZoom) return prevZoom

        setPan((prevPan) => {
          if (nextZoom === 1) return { x: 0, y: 0 }
          const scaleChange = nextZoom / prevZoom
          const newPanX = mouseX - (mouseX - prevPan.x) * scaleChange
          const newPanY = mouseY - (mouseY - prevPan.y) * scaleChange
          const maxPan = (nextZoom - 1) * Math.max(rect.width, rect.height)
          return {
            x: Math.max(-maxPan, Math.min(maxPan, newPanX)),
            y: Math.max(-maxPan, Math.min(maxPan, newPanY)),
          }
        })
        return nextZoom
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // Load local LRO 2k global mosaic and polar MapData once
  useEffect(() => {
    let alive = true
    const base = import.meta.env.BASE_URL ?? '/'
    const img = new Image()
    img.src = `${base}data/globe/lroc_color_2k.jpg`
    img.onload = () => {
      if (alive) setGlobalImg(img)
    }
    loadMapData()
      .then((d) => {
        if (alive) setMapData(d)
      })
      .catch(() => {
        /* polar layers optional if offline */
      })
    return () => {
      alive = false
    }
  }, [])

  // Build & cache offscreen raster canvas for selected polar background layer
  const getPolarRaster = (d: MapData, bg: PolarBg): HTMLCanvasElement => {
    const cached = polarCacheRef.current[bg]
    if (cached) return cached
    const c = document.createElement('canvas')
    c.width = d.n
    c.height = d.n
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(d.n, d.n)
    if (bg === 'slope' && !slopesRef.current) slopesRef.current = slopeGrid(d)
    const slopes = bg === 'slope' ? slopesRef.current : null
    const off = (d.demN - d.n) / 2
    for (let k = 0; k < d.n * d.n; k++) {
      let r = 20, g = 20, b = 18
      if (bg === 'sun') {
        const v = d.sun[k]
        r = Math.round(18 + v * 0.85)
        g = Math.round(17 + v * 0.62)
        b = Math.round(15 + v * 0.16)
      } else if (bg === 'earth') {
        const v = d.earth[k]
        r = Math.round(16 + v * 0.28)
        g = Math.round(20 + v * 0.56)
        b = Math.round(26 + v * 0.84)
      } else if (bg === 'psr') {
        const isPsr = d.psr[k] > 128
        const rIdx = Math.floor(k / d.n), cIdx = k % d.n
        const h = d.dem[(rIdx + off) * d.demN + (cIdx + off)] * 0.5
        const base = Math.max(18, Math.min(108, Math.round(56 + h / 140)))
        if (isPsr) {
          r = 112; g = 186; b = 182
        } else {
          r = base; g = base; b = Math.max(15, base - 3)
        }
      } else if (bg === 'slope' && slopes) {
        const s = slopes[k]
        if (!Number.isFinite(s)) {
          r = 22; g = 21; b = 19
        } else if (s <= 5) {
          r = 68; g = 152; b = 108
        } else if (s <= 8) {
          r = 165; g = 156; b = 78
        } else if (s <= 15) {
          r = 201; g = 132; b = 25
        } else {
          r = 210; g = 96; b = 86
        }
      }
      const p = 4 * k
      img.data[p] = r
      img.data[p + 1] = g
      img.data[p + 2] = b
      img.data[p + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    polarCacheRef.current[bg] = c
    return c
  }

  // Redraw 2D canvas on changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(300, Math.round(rect.width))
    const h = Math.max(240, Math.round(rect.height))
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0f0e0c'
    ctx.fillRect(0, 0, w, h)

    if (projection === 'global') {
      // Equirectangular box preserving 2:1 aspect inside canvas, scaled and panned
      const baseW = Math.min(w - 24, (h - 24) * 2)
      const boxW = baseW * zoom
      const boxH = boxW / 2
      const ox = (w - boxW) / 2 + pan.x
      const oy = (h - boxH) / 2 + pan.y
      const toXY = (lat: number, lon: number): [number, number] => {
        const normLon = ((((lon + 180) % 360) + 360) % 360) - 180
        return [ox + ((normLon + 180) / 360) * boxW, oy + ((90 - lat) / 180) * boxH]
      }

      if (globalImg) {
        ctx.drawImage(globalImg, ox, oy, boxW, boxH)
      } else {
        ctx.fillStyle = '#181c22'
        ctx.fillRect(ox, oy, boxW, boxH)
      }

      // Live solar day/night terminator overlay
      if (ephemeris && layers.solarLighting) {
        const s = ephemeris.sun
        const mag = Math.hypot(s.x, s.y, s.z) || 1
        const sx = s.x / mag, sy = s.y / mag, sz = s.z / mag
        ctx.save()
        ctx.beginPath()
        ctx.rect(ox, oy, boxW, boxH)
        ctx.clip()

        ctx.fillStyle = 'rgba(4, 8, 16, 0.62)'
        ctx.beginPath()
        const steps = 180
        if (Math.abs(sz) > 0.012) {
          const sunIsNorth = sz > 0
          const darkPoleY = sunIsNorth ? oy + boxH : oy
          ctx.moveTo(ox, darkPoleY)
          for (let k = 0; k <= steps; k++) {
            const lon = -180 + (360 * k) / steps
            const lam = (lon * Math.PI) / 180
            const dotHoriz = sx * Math.cos(lam) + sy * Math.sin(lam)
            const lat = (Math.atan(-dotHoriz / sz) * 180) / Math.PI
            const [px, py] = toXY(lat, lon)
            ctx.lineTo(px, py)
          }
          ctx.lineTo(ox + boxW, darkPoleY)
          ctx.closePath()
          ctx.fill()
        } else {
          // Near exact equinox: shade night hemisphere per column
          for (let k = 0; k < steps; k++) {
            const lon = -180 + (360 * (k + 0.5)) / steps
            const lam = (lon * Math.PI) / 180
            if (sx * Math.cos(lam) + sy * Math.sin(lam) < 0) {
              ctx.fillRect(ox + (k / steps) * boxW, oy, boxW / steps + 1, boxH)
            }
          }
        }

        // Terminator highlight curve
        if (Math.abs(sz) > 0.012) {
          ctx.strokeStyle = 'rgba(245, 176, 65, 0.7)'
          ctx.lineWidth = 1.4
          ctx.beginPath()
          for (let k = 0; k <= steps; k++) {
            const lon = -180 + (360 * k) / steps
            const lam = (lon * Math.PI) / 180
            const lat = (Math.atan(-(sx * Math.cos(lam) + sy * Math.sin(lam)) / sz) * 180) / Math.PI
            const [px, py] = toXY(lat, lon)
            if (k === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.stroke()
        }
        ctx.restore()
      }

      // Grid lines
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'
      ctx.lineWidth = 1
      ctx.strokeRect(ox, oy, boxW, boxH)
      for (const lat of [-60, -30, 0, 30, 60]) {
        const [, py] = toXY(lat, 0)
        ctx.beginPath(); ctx.moveTo(ox, py); ctx.lineTo(ox + boxW, py); ctx.stroke()
      }
      for (const lon of [-120, -60, 0, 60, 120]) {
        const [px] = toXY(0, lon)
        ctx.beginPath(); ctx.moveTo(px, oy); ctx.lineTo(px, oy + boxH); ctx.stroke()
      }

      // 85 S South Pole region band highlight
      const [, y85] = toXY(-85, 0)
      ctx.strokeStyle = 'rgba(235, 231, 221, 0.45)'
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(ox, y85); ctx.lineTo(ox + boxW, y85); ctx.stroke()
      ctx.setLineDash([])

      // Sub-solar & Sub-Earth markers
      if (ephemeris) {
        const [sxPx, syPx] = toXY(ephemeris.subSolar.lat, ephemeris.subSolar.lon)
        ctx.fillStyle = '#c98419'
        ctx.beginPath(); ctx.arc(sxPx, syPx, 5, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#0f0e0c'; ctx.lineWidth = 1.5; ctx.stroke()
        ctx.fillStyle = '#e6c15a'; ctx.font = '600 10px Archivo, sans-serif'
        ctx.fillText('SUN', sxPx + 7, syPx + 3)

        const [exPx, eyPx] = toXY(ephemeris.subEarth.lat, ephemeris.subEarth.lon)
        ctx.strokeStyle = '#5590d8'; ctx.lineWidth = 1.6
        ctx.beginPath(); ctx.arc(exPx, eyPx, 5, 0, Math.PI * 2); ctx.stroke()
      }

      // Global landmarks & sites
      if (layers.landmarks) {
        for (const lm of GLOBAL_LANDMARKS) {
          const [px, py] = toXY(lm.lat, lm.lon)
          ctx.fillStyle = '#aaa598'
          ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = '#ebe7dd'; ctx.font = '500 10px Archivo, sans-serif'
          ctx.fillText(lm.name, px + 5, py + 3)
        }
      }
      if (layers.sites) {
        for (const s of sites) {
          const [px, py] = toXY(s.lat, s.lon)
          ctx.fillStyle = STATE_COLOR[siteStates[s.id] ?? 'none']
          ctx.beginPath(); ctx.arc(px, py, 3.8, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = '#0f0e0c'; ctx.lineWidth = 1; ctx.stroke()
        }
      }

      // 3D Camera reticle
      if (cameraCenter) {
        const [cx, cy] = toXY(cameraCenter.lat, cameraCenter.lon)
        ctx.strokeStyle = 'rgba(235, 231, 221, 0.75)'
        ctx.lineWidth = 1.3
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke()
      }

      // Selected marker
      if (selected) {
        const [px, py] = toXY(selected.lat, selected.lon)
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.stroke()
      }
    } else {
      // Polar stereographic 85 S - 90 S, scaled and panned
      const baseSize = Math.min(w - 20, h - 20)
      const size = baseSize * zoom
      const ox = (w - size) / 2 + pan.x
      const oy = (h - size) / 2 + pan.y

      if (mapData) {
        const raster = getPolarRaster(mapData, polarBg)
        ctx.drawImage(raster, ox, oy, size, size)
      } else {
        ctx.fillStyle = '#11161f'
        ctx.fillRect(ox, oy, size, size)
      }

      const n = mapData?.n ?? 1266
      const scale = mapData?.scale ?? 240
      const toXY = (lat: number, lon: number): [number, number] => {
        const [row, col] = polarRowCol(lat, lon, n, scale)
        return [ox + (col / n) * size, oy + (row / n) * size]
      }
      const kmToPx = (km: number) => ((km * 1000) / (n * scale)) * size

      // Polar latitude rings (-89, -88, -87, -86, -85)
      const [poleX, poleY] = toXY(-90, 0)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
      ctx.lineWidth = 1
      for (const lat of [-89, -88, -87, -86, -85]) {
        const [rx] = toXY(lat, 90)
        const rad = Math.abs(rx - poleX)
        ctx.beginPath(); ctx.arc(poleX, poleY, rad, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = 'rgba(226, 232, 240, 0.55)'; ctx.font = '500 9px Archivo, sans-serif'
        ctx.fillText(`${-lat}°S`, poleX + 3, poleY - rad + 10)
      }

      // PSR rings
      if (layers.psrs) {
        for (const p of SOUTH_POLE_PSRS) {
          if (p.lat > -84.2) continue
          const [px, py] = toXY(p.lat, p.lon)
          const rPx = kmToPx(p.radiusKm)
          ctx.fillStyle = 'rgba(159, 211, 207, 0.14)'
          ctx.strokeStyle = 'rgba(159, 211, 207, 0.8)'
          ctx.lineWidth = 1.3
          ctx.beginPath(); ctx.arc(px, py, rPx, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
          ctx.fillStyle = '#9fd3cf'; ctx.font = '600 9px Archivo, sans-serif'
          ctx.fillText(`${p.name.replace(' PSR', '')} ${p.tempK}K`, px + 4, py - 2)
        }
      }

      // Artemis III regions
      if (layers.artemis) {
        for (const r of artemis) {
          if (r.lat > -84.2) continue
          const [px, py] = toXY(r.lat, r.lon)
          ctx.strokeStyle = '#cf86c3'; ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.moveTo(px, py - 6); ctx.lineTo(px + 6, py)
          ctx.lineTo(px, py + 6); ctx.lineTo(px - 6, py); ctx.closePath()
          ctx.stroke()
          ctx.fillStyle = '#ebe7dd'; ctx.font = '500 9px Archivo, sans-serif'
          ctx.fillText(r.name, px + 8, py + 3)
        }
      }

      // Sites
      if (layers.sites) {
        for (const s of sites) {
          if (s.lat > -84.2) continue
          const [px, py] = toXY(s.lat, s.lon)
          ctx.fillStyle = STATE_COLOR[siteStates[s.id] ?? 'none']
          ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = '#0f0e0c'; ctx.lineWidth = 1.2; ctx.stroke()
        }
      }

      // Landing ellipse
      if (layers.ellipse && ellipse) {
        ellipse.cells.forEach((cell, idx) => {
          if (!cell) return
          ctx.fillStyle = V_COLOR[ellipse.viabilities[idx] ?? 'nodata'] + '88'
          ctx.beginPath()
          cell.forEach((pt, k) => {
            const [cx, cy] = toXY(pt.lat, pt.lon)
            if (k === 0) ctx.moveTo(cx, cy)
            else ctx.lineTo(cx, cy)
          })
          ctx.closePath(); ctx.fill()
        })
        const ring = ellipseOutline(ellipse.center, ellipse.spec, 64)
        ctx.strokeStyle = '#ebe7dd'; ctx.lineWidth = 1.8
        ctx.beginPath()
        ring.forEach((pt, k) => {
          const [rx, ry] = toXY(pt.lat, pt.lon)
          if (k === 0) ctx.moveTo(rx, ry)
          else ctx.lineTo(rx, ry)
        })
        ctx.stroke()
      }

      // Selected marker + Sun/Earth azimuth arrows + nearest PSR traverse
      if (selected && selected.lat <= -84) {
        const [sx, sy] = toXY(selected.lat, selected.lon)
        if (layers.psrs) {
          const { psr } = nearestPsr(selected.lat, selected.lon)
          const [tx, ty] = toXY(psr.lat, psr.lon)
          ctx.strokeStyle = '#9fd3cf'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3])
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke()
          ctx.setLineDash([])
        }
        if (ephemeris && layers.rays) {
          const drawArrow = (bearingDeg: number, color: string, label: string) => {
            const a = (bearingDeg * Math.PI) / 180
            const ex = sx + Math.sin(a) * 42
            const ey = sy - Math.cos(a) * 42
            ctx.strokeStyle = color; ctx.lineWidth = 2
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
            ctx.fillStyle = color; ctx.font = '700 9px Archivo, sans-serif'
            ctx.fillText(label, ex + 4, ey + 3)
          }
          drawArrow(ephemeris.sunPoleBearingDeg, '#c98419', 'SUN')
          drawArrow(ephemeris.earthPoleBearingDeg, '#5590d8', 'EARTH')
        }
        ctx.strokeStyle = '#ebe7dd'; ctx.lineWidth = 2.2
        ctx.beginPath(); ctx.arc(sx, sy, 6.5, 0, Math.PI * 2); ctx.stroke()
      }

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)'
      ctx.lineWidth = 1
      ctx.strokeRect(ox, oy, size, size)
    }
  }, [projection, polarBg, mapData, globalImg, ephemeris, layers, sites, siteStates, artemis, selected, cameraCenter, ellipse, zoom, pan])

  const pointerToCoords = (clientX: number, clientY: number): { lat: number; lon: number; row?: number; col?: number } | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const w = rect.width, h = rect.height

    if (projection === 'global') {
      const baseW = Math.min(w - 24, (h - 24) * 2)
      const boxW = baseW * zoom
      const boxH = boxW / 2
      const ox = (w - boxW) / 2 + pan.x
      const oy = (h - boxH) / 2 + pan.y
      if (x < ox || x > ox + boxW || y < oy || y > oy + boxH) return null
      const lon = ((x - ox) / boxW) * 360 - 180
      const lat = 90 - ((y - oy) / boxH) * 180
      return { lat, lon }
    } else {
      const baseSize = Math.min(w - 20, h - 20)
      const size = baseSize * zoom
      const ox = (w - size) / 2 + pan.x
      const oy = (h - size) / 2 + pan.y
      if (x < ox || x > ox + size || y < oy || y > oy + size) return null
      const n = mapData?.n ?? 1266
      const scale = mapData?.scale ?? 240
      const col = ((x - ox) / size) * n
      const row = ((y - oy) / size) * n
      const [lat, lon] = rowColToLatLon(row, col, n, scale)
      return { lat, lon, row, col }
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    setIsDragging(true)
    hasMovedRef.current = false
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      if (Math.hypot(dx, dy) > 3) {
        hasMovedRef.current = true
      }
      if (hasMovedRef.current) {
        const canvas = canvasRef.current
        const rect = canvas?.getBoundingClientRect()
        const maxPan = (zoom - 1) * Math.max(rect?.width ?? 400, rect?.height ?? 400) + 160
        setPan({
          x: Math.max(-maxPan, Math.min(maxPan, dragStartRef.current.panX + dx)),
          y: Math.max(-maxPan, Math.min(maxPan, dragStartRef.current.panY + dy)),
        })
      }
    }
    handleMove(e)
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && !hasMovedRef.current) {
      const pt = pointerToCoords(e.clientX, e.clientY)
      if (pt) onPickPoint(pt.lat, pt.lon)
    }
    setIsDragging(false)
  }

  const handleMouseLeave = () => {
    setIsDragging(false)
    setHoverInfo('')
  }

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = pointerToCoords(e.clientX, e.clientY)
    if (!pt) {
      setHoverInfo('')
      return
    }
    const latStr = `${Math.abs(pt.lat).toFixed(2)}°${pt.lat < 0 ? 'S' : 'N'}`
    const lonNorm = ((((pt.lon + 180) % 360) + 360) % 360) - 180
    const lonStr = `${Math.abs(lonNorm).toFixed(2)}°${lonNorm < 0 ? 'W' : 'E'}`
    if (projection === 'polar' && mapData && pt.row !== undefined && pt.col !== undefined) {
      const r = Math.max(1, Math.min(mapData.n - 2, Math.round(pt.row)))
      const c = Math.max(1, Math.min(mapData.n - 2, Math.round(pt.col)))
      const t = terrainAt(mapData, r, c)
      const k = r * mapData.n + c
      const sunPct = Math.round((mapData.sun[k] / 255) * 100)
      setHoverInfo(`${latStr}, ${lonStr} · Elev ${Math.round(t.h)} m · Slope ${t.slope.toFixed(1)}° · Mean Sun ${sunPct}%`)
    } else {
      setHoverInfo(`${latStr}, ${lonStr}`)
    }
  }

  return (
    <div className="mx-map2d">
      <div className="mx-map2d-bar">
        <div className="mx-seg">
          <button
            type="button"
            aria-pressed={projection === 'polar'}
            onClick={() => onProjectionChange('polar')}
          >
            South Pole (85–90°S)
          </button>
          <button
            type="button"
            aria-pressed={projection === 'global'}
            onClick={() => onProjectionChange('global')}
          >
            Whole Moon 2D
          </button>
        </div>
        {projection === 'polar' && (
          <div className="mx-seg">
            {([
              ['sun', 'Sun %'],
              ['earth', 'Earth %'],
              ['psr', 'Ice PSRs'],
              ['slope', 'Slope'],
            ] as const).map(([k, lbl]) => (
              <button key={k} type="button" aria-pressed={polarBg === k} onClick={() => setPolarBg(k)}>
                {lbl}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mx-map2d-viewport">
        <canvas
          ref={canvasRef}
          className={`mx-map2d-canvas ${isDragging ? 'is-dragging' : ''}`}
          style={{ cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'crosshair' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
        <div className="mx-map2d-controls" aria-label="2D Map zoom and pan controls">
          <button
            type="button"
            title="Zoom in (+)"
            onClick={() => setZoom((z) => Math.min(15, Number((z * 1.35).toFixed(2))))}
          >
            +
          </button>
          <button
            type="button"
            title="Zoom out (−)"
            onClick={() => {
              setZoom((z) => {
                const nz = Math.max(1, Number((z / 1.35).toFixed(2)))
                if (nz === 1) setPan({ x: 0, y: 0 })
                return nz
              })
            }}
          >
            −
          </button>
          <button
            type="button"
            title="Reset zoom and pan"
            onClick={() => {
              setZoom(1)
              setPan({ x: 0, y: 0 })
            }}
          >
            ⊙
          </button>
        </div>
      </div>
      <div className="mx-map2d-foot">
        <span>{hoverInfo || 'Click anywhere on the 2D map to target & fly the 3D Moon camera'}</span>
        <span>{projection === 'global' ? 'Terminator synced to 24h clock' : 'NASA LOLA / PGDA 240 m grid'}</span>
      </div>
    </div>
  )
}
