import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { RechargeCandidate, RoverMissionConfig, SimulationStepTelemetry } from '../types.ts'
import {
  type PlannerDataset,
  terrainAtCoord,
  rowColToLatLon,
  R_M,
} from '../engine/mapLoader.ts'

export type MapDisplayLayer = 'sunlight' | 'relief' | 'sun_avg' | 'psr' | 'slope'

interface IlluminationMapProps {
  dataset: PlannerDataset
  config: RoverMissionConfig
  recommendedCandidate: RechargeCandidate | null
  candidateList: RechargeCandidate[]
  selectedCandidateId: string | null
  onSelectCandidate: (id: string) => void
  currentSimulationStep: SimulationStepTelemetry | null
  currentHourIndex: number
  onPickRoverLocation: (lat: number, lon: number) => void
}

const NIGHT = [24, 29, 36]
const SUN_RAMP = [242, 190, 92]
const SLOPE_RAMP = [226, 150, 205]
const PSR_COLOR = [70, 90, 200]

export function IlluminationMap({
  dataset,
  config,
  recommendedCandidate,
  candidateList,
  selectedCandidateId,
  onSelectCandidate,
  currentSimulationStep,
  currentHourIndex,
  onPickRoverLocation,
}: IlluminationMapProps) {
  const [activeLayer, setActiveLayer] = useState<MapDisplayLayer>('sunlight')
  const [zoomLevel, setZoomLevel] = useState<number>(2) // 1 = 85-90S, 2 = 87.5-90S, 4 = 88.7-90S
  const [timePreviewOffsetH, setTimePreviewOffsetH] = useState<number>(0) // 0, +1, +6, +12 hours
  const [hoverInfo, setHoverInfo] = useState<{
    lat: number
    lon: number
    elevationM: number
    slopeDeg: number
    x: number
    y: number
  } | null>(null)
  const [showEarthRay, setShowEarthRay] = useState(false)
  const [showAllCandidates, setShowAllCandidates] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Solar position calculation for currentHourIndex + timePreviewOffsetH
  const effectiveHourIndex = useMemo(() => {
    const totalHours = Math.floor(dataset.vectors.length / 6)
    return Math.min(totalHours - 1, Math.max(0, currentHourIndex + timePreviewOffsetH))
  }, [currentHourIndex, timePreviewOffsetH, dataset.vectors.length])

  const { sunElevationDeg, sunAzimuthDeg } = useMemo(() => {
    if (timePreviewOffsetH === 0 && currentSimulationStep) {
      return {
        sunElevationDeg: currentSimulationStep.sunElevationDeg,
        sunAzimuthDeg: currentSimulationStep.sunAzimuthDeg,
      }
    }
    const h = effectiveHourIndex
    const sx = dataset.vectors[6 * h]
    const sy = dataset.vectors[6 * h + 1]
    const sz = dataset.vectors[6 * h + 2]
    const sdist = Math.hypot(sx, sy, sz)
    const el = (Math.asin(sz / sdist) * 180) / Math.PI
    const az = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360
    return { sunElevationDeg: el, sunAzimuthDeg: az }
  }, [effectiveHourIndex, timePreviewOffsetH, currentSimulationStep, dataset.vectors])

  const earthAzimuthDeg = useMemo(() => {
    const h = effectiveHourIndex
    const ex = dataset.vectors[6 * h + 3]
    const ey = dataset.vectors[6 * h + 4]
    return ((Math.atan2(ey, ex) * 180) / Math.PI + 360) % 360
  }, [dataset.vectors, effectiveHourIndex])

  // Pre-render terrain layer offscreen with high-contrast sunlight vs shadow
  const renderedLayerCanvas = useMemo(() => {
    const d = dataset
    const n = d.layersN
    const img = new ImageData(n, n)
    const px = img.data

    // Dynamic light direction for hillshade based on Sun azimuth
    // Sun azimuth in polar stereographic: 0 deg points North/Up (-Y), 90 deg East (+X)
    const sunRad = (sunAzimuthDeg * Math.PI) / 180
    const lightX = Math.sin(sunRad)
    const lightY = -Math.cos(sunRad)
    const lightZ = Math.max(0.08, Math.sin((Math.max(0.5, sunElevationDeg) * Math.PI) / 180) * 12)
    const lightNorm = Math.hypot(lightX, lightY, lightZ)

    const off = (d.demN - n) / 2

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const kLayer = r * n + c
        const kDem = (r + off) * d.demN + (c + off)

        // Shaded relief gradient
        const dx = ((d.demGrid.dn[kDem + 1] - d.demGrid.dn[kDem - 1]) * 0.5) / (2 * d.scaleM)
        const dy = ((d.demGrid.dn[kDem + d.demN] - d.demGrid.dn[kDem - d.demN]) * 0.5) / (2 * d.scaleM)
        const slope = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI

        const nx = -dx
        const ny = -dy
        const nz = 1.0
        const normalNorm = Math.hypot(nx, ny, nz)

        const dot = (nx * lightX + ny * lightY + nz * lightZ) / (normalNorm * lightNorm)
        const shade = Math.max(0, dot)

        let rgb = [30, 30, 30]

        if (activeLayer === 'sunlight') {
          // DIRECT SOLAR ILLUMINATION: High contrast Amber sunlight vs Dark Charcoal shadow
          if (dot > 0.02 && sunElevationDeg > -0.5) {
            // Direct sunlight: Amber gold tone, intensity scales with surface slope towards sun
            const intensity = Math.min(1.0, shade ** 1.1)
            const rVal = Math.min(255, 45 + 205 * intensity)
            const gVal = Math.min(255, 35 + 145 * intensity)
            const bVal = Math.min(255, 20 + 40 * intensity)
            rgb = [rVal, gVal, bVal]
          } else {
            // In shadow: Deep charcoal with subtle terrain relief
            const ambient = Math.max(0.05, 1.0 - slope / 60)
            const darkVal = 18 + 18 * ambient
            rgb = [darkVal, darkVal + 2, darkVal + 6]
          }
        } else if (activeLayer === 'relief') {
          // Standard grayscale hillshade
          const g = 24 + 145 * shade ** 1.3
          rgb = [g, g, g]
        } else if (activeLayer === 'sun_avg') {
          const v = d.sunPctLayer[kLayer] / 100
          rgb = NIGHT.map((n0, j) => (n0 + (SUN_RAMP[j] - n0) * v) * (0.65 + 0.35 * shade))
        } else if (activeLayer === 'psr') {
          const isPsr = d.psrLayer[kLayer] === 100
          const g = 24 + 145 * shade ** 1.3
          rgb = isPsr
            ? PSR_COLOR.map((x) => x * (0.55 + 0.45 * shade))
            : [g * 0.45, g * 0.45, g * 0.45]
        } else if (activeLayer === 'slope') {
          const v = Math.min(slope, 30) / 30
          rgb = NIGHT.map((n0, j) => (n0 + (SLOPE_RAMP[j] - n0) * v) * (0.7 + 0.3 * shade))
        }

        px[4 * kLayer] = rgb[0]
        px[4 * kLayer + 1] = rgb[1]
        px[4 * kLayer + 2] = rgb[2]
        px[4 * kLayer + 3] = 255
      }
    }

    const oc = new OffscreenCanvas(n, n)
    oc.getContext('2d')!.putImageData(img, 0, 0)
    return oc
  }, [dataset, activeLayer, sunAzimuthDeg, sunElevationDeg])

  // Viewport bounds
  const viewWindow = useMemo(() => {
    const sw = dataset.layersN / zoomLevel
    return { sx: (dataset.layersN - sw) / 2, sw }
  }, [dataset.layersN, zoomLevel])

  // Coordinate mapper from lat/lon to current canvas pixel coordinates
  const toCanvasPx = useCallback(
    (lat: number, lon: number, canvasSize: number): [number, number] | null => {
      const rr = 2 * R_M * Math.tan(((90 + lat) * Math.PI) / 360)
      const c = dataset.layersN / 2 - 0.5
      const row = c - (rr * Math.cos((lon * Math.PI) / 180)) / dataset.scaleM
      const col = c + (rr * Math.sin((lon * Math.PI) / 180)) / dataset.scaleM
      return [
        ((col + 0.5 - viewWindow.sx) / viewWindow.sw) * canvasSize,
        ((row + 0.5 - viewWindow.sx) / viewWindow.sw) * canvasSize,
      ]
    },
    [dataset.layersN, dataset.scaleM, viewWindow],
  )

  // Draw full composite scene on canvas
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !renderedLayerCanvas || !viewWindow) return
    const size = cv.clientWidth
    const dpr = window.devicePixelRatio || 1
    cv.width = size * dpr
    cv.height = size * dpr

    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.imageSmoothingEnabled = zoomLevel < 4

    // 1. Draw raster layer
    g.drawImage(renderedLayerCanvas, viewWindow.sx, viewWindow.sx, viewWindow.sw, viewWindow.sw, 0, 0, size, size)

    // 2. Graticule (Polar circles & 30-deg meridians)
    g.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    g.lineWidth = 1
    g.font = '10px "Public Sans", system-ui, sans-serif'

    const polePx = toCanvasPx(-90, 0, size)!
    const latRings = zoomLevel === 1 ? [-89, -88, -87, -86] : zoomLevel === 2 ? [-89.5, -89, -88.5, -88] : [-89.75, -89.5, -89.25, -89]
    for (const lat of latRings) {
      const pt = toCanvasPx(lat, 0, size)!
      const rad = Math.hypot(pt[0] - polePx[0], pt[1] - polePx[1])
      g.beginPath()
      g.arc(polePx[0], polePx[1], rad, 0, 2 * Math.PI)
      g.stroke()
      g.fillStyle = 'rgba(217, 214, 207, 0.7)'
      g.fillText(`${Math.abs(lat)}°S`, polePx[0] + 4, polePx[1] - rad - 2)
    }

    for (let lon = 0; lon < 360; lon += 30) {
      const edge = toCanvasPx(zoomLevel === 1 ? -85 : zoomLevel === 2 ? -87.5 : -88.8, lon, size)!
      g.beginPath()
      g.moveTo(polePx[0], polePx[1])
      g.lineTo(edge[0], edge[1])
      g.stroke()
    }

    // 3. Solar Ray Direction Indicator (Sun vector wavefront & beam arrow)
    const sunAngleRad = (sunAzimuthDeg * Math.PI) / 180
    const beamRadius = size * 0.44
    const raySourceX = polePx[0] - Math.sin(sunAngleRad) * beamRadius
    const raySourceY = polePx[1] + Math.cos(sunAngleRad) * beamRadius
    const rayTargetX = polePx[0] + Math.sin(sunAngleRad) * (beamRadius * 0.7)
    const rayTargetY = polePx[1] - Math.cos(sunAngleRad) * (beamRadius * 0.7)

    g.save()
    g.strokeStyle = '#c98419'
    g.lineWidth = 2.5
    g.setLineDash([6, 4])
    g.beginPath()
    g.moveTo(raySourceX, raySourceY)
    g.lineTo(rayTargetX, rayTargetY)
    g.stroke()
    g.setLineDash([])

    // Sun Arrowhead
    const arrAngle = Math.atan2(rayTargetY - raySourceY, rayTargetX - raySourceX)
    g.fillStyle = '#c98419'
    g.beginPath()
    g.moveTo(rayTargetX, rayTargetY)
    g.lineTo(rayTargetX - 12 * Math.cos(arrAngle - 0.4), rayTargetY - 12 * Math.sin(arrAngle - 0.4))
    g.lineTo(rayTargetX - 12 * Math.cos(arrAngle + 0.4), rayTargetY - 12 * Math.sin(arrAngle + 0.4))
    g.closePath()
    g.fill()

    // Solar Elevation Label
    g.fillStyle = '#c98419'
    g.font = '600 11px "Public Sans", sans-serif'
    g.fillText(
      `☀ Sun El: ${sunElevationDeg.toFixed(1)}° (Az: ${sunAzimuthDeg.toFixed(0)}°) ${timePreviewOffsetH > 0 ? `[+${timePreviewOffsetH}h]` : ''}`,
      raySourceX + 10,
      raySourceY + (raySourceY > size / 2 ? -10 : 15),
    )
    g.restore()

    // 4. Earth Direction Indicator (Optional)
    if (showEarthRay) {
      const earthAngleRad = (earthAzimuthDeg * Math.PI) / 180
      const eRayX = polePx[0] - Math.sin(earthAngleRad) * (beamRadius * 0.8)
      const eRayY = polePx[1] + Math.cos(earthAngleRad) * (beamRadius * 0.8)

      g.save()
      g.strokeStyle = '#5590d8'
      g.lineWidth = 1.5
      g.setLineDash([4, 4])
      g.beginPath()
      g.moveTo(polePx[0], polePx[1])
      g.lineTo(eRayX, eRayY)
      g.stroke()
      g.fillStyle = '#5590d8'
      g.fillText(`♁ Earth Az: ${earthAzimuthDeg.toFixed(0)}°`, eRayX + 8, eRayY + 4)
      g.restore()
    }

    // 5. Search Radius Overlay Circle
    const searchRadKm = config.mission.searchRadiusKm
    const searchCenter = toCanvasPx(config.mission.startLat, config.mission.startLon, size)
    if (searchCenter) {
      const kmPerPx = (dataset.scaleM * (viewWindow.sw / size)) / 1000
      const radiusPx = searchRadKm / kmPerPx

      g.save()
      g.strokeStyle = 'rgba(31, 163, 138, 0.45)'
      g.lineWidth = 1.5
      g.setLineDash([4, 4])
      g.beginPath()
      g.arc(searchCenter[0], searchCenter[1], radiusPx, 0, 2 * Math.PI)
      g.stroke()

      g.fillStyle = 'rgba(31, 163, 138, 0.7)'
      g.font = '10px "Public Sans", sans-serif'
      g.fillText(`${searchRadKm} km search radius`, searchCenter[0] + 6, searchCenter[1] - radiusPx + 12)
      g.restore()
    }

    // 6. Candidate Destinations
    if (showAllCandidates) {
      for (const cand of candidateList) {
        const pt = toCanvasPx(cand.lat, cand.lon, size)
        if (!pt) continue

        const isRec = recommendedCandidate?.id === cand.id
        const isSel = selectedCandidateId === cand.id

        if (!isRec) {
          g.beginPath()
          g.arc(pt[0], pt[1], isSel ? 6 : 4, 0, 2 * Math.PI)
          g.fillStyle = cand.feasibility === 'FEASIBLE' ? '#1fa38a' : cand.feasibility === 'CAUTION' ? '#e5a83b' : '#e0705c'
          g.fill()
          g.strokeStyle = '#1a1f26'
          g.lineWidth = 1.5
          g.stroke()
        }
      }
    }

    // 7. Traversal Route from Rover to Recommended (or Selected) Target
    const targetCandidate = candidateList.find((c) => c.id === selectedCandidateId) || recommendedCandidate
    if (targetCandidate && targetCandidate.route.waypoints.length > 0) {
      g.save()
      g.strokeStyle = targetCandidate.feasibility === 'FEASIBLE' ? '#1fa38a' : '#e5a83b'
      g.lineWidth = 2.5
      g.setLineDash([4, 3])

      g.beginPath()
      let firstWp = true
      for (const wp of targetCandidate.route.waypoints) {
        const wpPx = toCanvasPx(wp.lat, wp.lon, size)
        if (!wpPx) continue
        if (firstWp) {
          g.moveTo(wpPx[0], wpPx[1])
          firstWp = false
        } else {
          g.lineTo(wpPx[0], wpPx[1])
        }
      }
      g.stroke()
      g.setLineDash([])
      g.restore()
    }

    // 8. Recommended Candidate Highlight Beacon
    if (recommendedCandidate) {
      const targetPx = toCanvasPx(recommendedCandidate.lat, recommendedCandidate.lon, size)
      if (targetPx) {
        // Glowing Halo
        g.beginPath()
        g.arc(targetPx[0], targetPx[1], 12, 0, 2 * Math.PI)
        g.fillStyle = 'rgba(201, 132, 25, 0.28)'
        g.fill()

        g.beginPath()
        g.arc(targetPx[0], targetPx[1], 6, 0, 2 * Math.PI)
        g.fillStyle = '#c98419'
        g.fill()
        g.strokeStyle = '#ffffff'
        g.lineWidth = 2
        g.stroke()

        // Label
        g.font = '600 11px "Public Sans", sans-serif'
        g.lineWidth = 3
        g.strokeStyle = 'rgba(26, 31, 38, 0.95)'
        g.strokeText(`★ ${recommendedCandidate.name}`, targetPx[0] + 12, targetPx[1] - 4)
        g.fillStyle = '#c98419'
        g.fillText(`★ ${recommendedCandidate.name}`, targetPx[0] + 12, targetPx[1] - 4)
      }
    }

    // 9. Rover Position Marker (Animated or Static)
    const activeRoverLat = currentSimulationStep ? currentSimulationStep.roverLat : config.mission.startLat
    const activeRoverLon = currentSimulationStep ? currentSimulationStep.roverLon : config.mission.startLon
    const roverPx = toCanvasPx(activeRoverLat, activeRoverLon, size)

    if (roverPx) {
      // Outer pulse ring
      g.beginPath()
      g.arc(roverPx[0], roverPx[1], 9, 0, 2 * Math.PI)
      g.strokeStyle = '#5590d8'
      g.lineWidth = 2
      g.stroke()

      // Core rover icon
      g.beginPath()
      g.arc(roverPx[0], roverPx[1], 5, 0, 2 * Math.PI)
      g.fillStyle = '#5590d8'
      g.fill()

      // Label
      g.font = '600 11px "Public Sans", sans-serif'
      g.lineWidth = 3
      g.strokeStyle = 'rgba(26, 31, 38, 0.95)'
      const labelText = currentSimulationStep?.phase === 'transit' ? 'Rover (In Transit)' : 'Rover Origin'
      g.strokeText(labelText, roverPx[0] + 12, roverPx[1] + 12)
      g.fillStyle = '#5590d8'
      g.fillText(labelText, roverPx[0] + 12, roverPx[1] + 12)
    }

    // 10. Scale Bar
    const kmPerPx = (dataset.scaleM * (viewWindow.sw / size)) / 1000
    const barKm = zoomLevel === 1 ? 50 : zoomLevel === 2 ? 20 : 5
    const barPx = barKm / kmPerPx

    g.fillStyle = '#d9d6cf'
    g.strokeStyle = '#d9d6cf'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(size - 30 - barPx, size - 20)
    g.lineTo(size - 30, size - 20)
    g.stroke()
    g.font = '10px "Public Sans", sans-serif'
    g.textAlign = 'center'
    g.fillText(`${barKm} km`, size - 30 - barPx / 2, size - 26)
    g.textAlign = 'left'
  }, [
    dataset,
    renderedLayerCanvas,
    viewWindow,
    zoomLevel,
    sunElevationDeg,
    sunAzimuthDeg,
    earthAzimuthDeg,
    timePreviewOffsetH,
    showEarthRay,
    showAllCandidates,
    config,
    recommendedCandidate,
    candidateList,
    selectedCandidateId,
    currentSimulationStep,
    toCanvasPx,
  ])

  // Click on canvas to relocate rover or inspect
  const handleCanvasClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current
    if (!cv || !viewWindow) return
    const rect = cv.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size = rect.width

    const col = viewWindow.sx + (x / size) * viewWindow.sw
    const row = viewWindow.sx + (y / size) * viewWindow.sw
    const [lat, lon] = rowColToLatLon(row, col, dataset.layersN, dataset.scaleM)

    // Check if clicked close to a candidate
    let clickedCandidate: RechargeCandidate | null = null
    for (const cand of candidateList) {
      const pt = toCanvasPx(cand.lat, cand.lon, size)
      if (pt && Math.hypot(pt[0] - x, pt[1] - y) < 14) {
        clickedCandidate = cand
        break
      }
    }

    if (clickedCandidate) {
      onSelectCandidate(clickedCandidate.id)
    } else {
      onPickRoverLocation(Number(lat.toFixed(4)), Number(lon.toFixed(4)))
    }
  }

  // Hover tracking
  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current
    if (!cv || !viewWindow) return
    const rect = cv.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size = rect.width

    const col = viewWindow.sx + (x / size) * viewWindow.sw
    const row = viewWindow.sx + (y / size) * viewWindow.sw
    const [lat, lon] = rowColToLatLon(row, col, dataset.layersN, dataset.scaleM)
    const { elevationM, slopeDeg } = terrainAtCoord(dataset.demGrid, lat, lon)

    setHoverInfo({
      lat: Number(lat.toFixed(3)),
      lon: Number(lon.toFixed(2)),
      elevationM: Math.round(elevationM),
      slopeDeg: Number(slopeDeg.toFixed(1)),
      x,
      y,
    })
  }

  return (
    <div className="map-panel" aria-label="Interactive Lunar Illumination and Surface Traverse Map">
      <div className="map-toolbar">
        <div className="map-toolbar-group">
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
            Map Layer:
          </span>
          <div className="seg">
            <button
              type="button"
              aria-pressed={activeLayer === 'sunlight'}
              onClick={() => setActiveLayer('sunlight')}
              title="Real-time calculated direct solar illumination (Amber) vs cold shadow (Charcoal)"
            >
              Direct Sunlight (Amber)
            </button>
            <button
              type="button"
              aria-pressed={activeLayer === 'relief'}
              onClick={() => setActiveLayer('relief')}
              title="Shaded relief with dynamic solar lighting"
            >
              Terrain Relief
            </button>
            <button
              type="button"
              aria-pressed={activeLayer === 'sun_avg'}
              onClick={() => setActiveLayer('sun_avg')}
              title="NASA 18.6-year average polar sunlight availability (%)"
            >
              Sunlit %
            </button>
            <button
              type="button"
              aria-pressed={activeLayer === 'psr'}
              onClick={() => setActiveLayer('psr')}
              title="NASA permanently shadowed regions (craters)"
            >
              Permanent Shadow
            </button>
            <button
              type="button"
              aria-pressed={activeLayer === 'slope'}
              onClick={() => setActiveLayer('slope')}
              title="LOLA terrain slope hazard map"
            >
              Slope
            </button>
          </div>
        </div>

        {/* Time Comparison Toolbar Group (Priority 1) */}
        <div className="map-toolbar-group">
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
            Illumination Preview:
          </span>
          <div className="seg">
            <button
              type="button"
              aria-pressed={timePreviewOffsetH === 0}
              onClick={() => setTimePreviewOffsetH(0)}
              title="Current simulation hour illumination"
            >
              Now (T+0h)
            </button>
            <button
              type="button"
              aria-pressed={timePreviewOffsetH === 1}
              onClick={() => setTimePreviewOffsetH(1)}
              title="Ephemeris illumination in +1 hour"
            >
              +1h
            </button>
            <button
              type="button"
              aria-pressed={timePreviewOffsetH === 6}
              onClick={() => setTimePreviewOffsetH(6)}
              title="Ephemeris illumination in +6 hours"
            >
              +6h
            </button>
            <button
              type="button"
              aria-pressed={timePreviewOffsetH === 12}
              onClick={() => setTimePreviewOffsetH(12)}
              title="Ephemeris illumination in +12 hours"
            >
              +12h
            </button>
          </div>
        </div>

        <div className="map-toolbar-group">
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
            Zoom:
          </span>
          <div className="seg">
            <button type="button" aria-pressed={zoomLevel === 1} onClick={() => setZoomLevel(1)}>
              85–90°S
            </button>
            <button type="button" aria-pressed={zoomLevel === 2} onClick={() => setZoomLevel(2)}>
              87.5–90°S
            </button>
            <button type="button" aria-pressed={zoomLevel === 4} onClick={() => setZoomLevel(4)}>
              88.7–90°S
            </button>
          </div>

          <label className="toggle-switch" style={{ marginLeft: '12px' }}>
            <input
              type="checkbox"
              checked={showEarthRay}
              onChange={(e) => setShowEarthRay(e.target.checked)}
            />
            <span style={{ fontSize: '0.82rem', color: showEarthRay ? '#5590d8' : 'var(--muted)' }}>
              Earth Vector
            </span>
          </label>

          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={showAllCandidates}
              onChange={(e) => setShowAllCandidates(e.target.checked)}
            />
            <span style={{ fontSize: '0.82rem', color: showAllCandidates ? '#1fa38a' : 'var(--muted)' }}>
              Candidate Spots
            </span>
          </label>
        </div>
      </div>

      <div className="map-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="map-canvas"
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          title="Click to place rover position or select recharge candidate"
          role="img"
          aria-label="Lunar South Pole terrain map showing real-time solar illumination angle, rover position, and recharge destinations"
        />

        {/* Hover Inspector Pill */}
        {hoverInfo && (
          <div className="map-hover-pill">
            <span>{Math.abs(hoverInfo.lat)}°S, {hoverInfo.lon}°E</span>
            <span>Elev: {hoverInfo.elevationM} m</span>
            <span>Slope: {hoverInfo.slopeDeg}°</span>
          </div>
        )}

        {/* Dynamic Map Legend Overlay */}
        <div className="map-overlay-legend">
          <div className="legend-row">
            <span style={{ width: '10px', height: '10px', background: '#c98419', borderRadius: '2px' }} />
            <span>Direct Sunlight (Amber)</span>
          </div>
          <div className="legend-row">
            <span style={{ width: '10px', height: '10px', background: '#1a1f26', border: '1px solid #3a434e', borderRadius: '2px' }} />
            <span>Cold Shadow (Charcoal)</span>
          </div>
          <div className="legend-row">
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#5590d8' }} />
            <span>Rover Position (Blue)</span>
          </div>
          <div className="legend-row">
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#c98419', border: '1px solid #ffffff' }} />
            <span>Recommended Target (Amber Beacon)</span>
          </div>
          <div className="legend-row">
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#1fa38a' }} />
            <span>Feasible Candidates (Teal)</span>
          </div>
          <div className="legend-row">
            <span style={{ width: '12px', height: '2px', background: '#c98419', borderTop: '2px dashed #c98419' }} />
            <span>Sun Ray Vector (Azimuth)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
