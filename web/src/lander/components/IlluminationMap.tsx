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

interface MapExplanation {
  title: string
  subtitle: string
  description: string
  details: string[]
}

const MAP_EXPLANATIONS: Record<string, MapExplanation> = {
  sun_azimuth: {
    title: 'SUN AZIMUTH & DIRECTION',
    subtitle: 'Astronomical Solar Bearing Vector',
    description: 'The horizontal direction towards the Sun, measured clockwise from north.',
    details: [
      'The dashed amber vector represents the compass heading towards the Sun relative to the lunar surface.',
      'If solar elevation is negative, the Sun is below the local geometric horizon and cannot illuminate flat terrain.',
      'This line indicates celestial bearing only; it is not a sunlight beam. Ground illumination depends strictly on local topography line-of-sight.',
    ],
  },
  rover_position: {
    title: 'CURRENT ROVER POSITION',
    subtitle: 'Simulated Lunar Surface Location',
    description: "The rover's current simulated location on the lunar surface.",
    details: [
      'Represented by the blue circular beacon on the map.',
      'During mission timeline playback, this marker moves along the kinematic traversal path to the destination.',
      'You can click any open terrain on the map to relocate the rover origin and recalculate surrounding candidate sites.',
    ],
  },
  recommended_destination: {
    title: 'RECOMMENDED RECHARGE DESTINATION',
    subtitle: 'Primary Mission Target',
    description: 'The highest-ranked reachable recharge location under the current mission configuration.',
    details: [
      'Selected through physical simulation of transit locomotion, hotel loads, and solar energy replenishment.',
      'Guarantees arrival battery state of charge meets or exceeds the mandatory safety reserve threshold.',
      'Maximizes continuous sunlit recharge window on elevated topography (crater rim or ridge crest).',
    ],
  },
  alternative_candidates: {
    title: 'ALTERNATIVE RECHARGE SITES',
    subtitle: 'Candidate Secondary Locations',
    description: 'Feasible secondary recharge locations evaluated within the search radius.',
    details: [
      'Teal markers indicate reachable candidate locations with safe slopes and sufficient energy buffer.',
      'Amber markers indicate caution locations with narrow reserve margins or steep slopes.',
      'Dimmed markers with ✕ represent infeasible destinations that violate energy constraints or cause depletion.',
    ],
  },
  search_boundary: {
    title: 'CANDIDATE SEARCH BOUNDARY',
    subtitle: 'Operational Search Radius',
    description: 'The geographic region within which recharge candidates are evaluated.',
    details: [
      'Represents the configured search radius centered on the rover origin.',
      'Topographic peaks and elevated rims outside this boundary are not considered for traversal.',
      'Adjustable via the Search Radius slider in the Rover Configuration panel.',
    ],
  },
  sunlit_terrain: {
    title: 'DIRECT SUNLIGHT REGIONS',
    subtitle: 'Real-Time Solar Visibility',
    description: 'Terrain with direct solar visibility at the selected simulation time.',
    details: [
      'Rendered in warm amber tones on the map.',
      'Calculated in real-time by tracing solar line-of-sight against NASA LOLA 20m digital elevation data.',
      'Higher ground and elevated rim crests receive sunlight earlier and stay illuminated longer than low crater floors.',
    ],
  },
  shadowed_terrain: {
    title: 'SHADOWED REGIONS',
    subtitle: 'Obstructed Solar Line-of-Sight',
    description: 'Terrain where direct sunlight is obstructed.',
    details: [
      'Rendered in deep charcoal with subtle terrain relief.',
      'At the lunar south pole, low solar elevation angles (1°–2°) produce long, persistent shadows.',
      'Rovers traveling in shadowed areas consume battery reserves without solar recharging.',
    ],
  },
  coordinate_grid: {
    title: 'COORDINATE REFERENCE GRID',
    subtitle: 'Polar Stereographic Graticule',
    description: 'Reference lines indicating lunar latitude and longitude.',
    details: [
      'Concentric rings show lunar latitude (degrees south from equator towards the 90°S South Pole).',
      'Radial lines show lunar longitude (0° to 360° East of the Prime Meridian).',
      'North is oriented towards 0° longitude (top of map); East is 90° longitude (right).',
    ],
  },
  traversal_route: {
    title: 'ROVER TRAVERSAL ROUTE',
    subtitle: 'Kinematic Traverse Profile',
    description: 'The planned route profile avoiding steep slopes and deep shadows.',
    details: [
      'Dashed path traces the evaluated journey from the rover origin to the destination.',
      'Color-coded by safety: Teal (feasible, nominal slopes), Amber (caution, steep terrain), Red (infeasible).',
      'Kinematic drive power and hotel subsystem draws are integrated along this path.',
    ],
  },
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

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

  // Interactive Explanations and Inspection States
  const [activeExplanationKey, setActiveExplanationKey] = useState<string | null>(null)
  const [inspectedCandidateId, setInspectedCandidateId] = useState<string | null>(null)
  const [isInspectingRover, setIsInspectingRover] = useState<boolean>(false)
  const [inspectorDismissed, setInspectorDismissed] = useState<boolean>(false)
  const [isHelpModalOpen, setIsHelpModalOpen] = useState<boolean>(false)
  const [isLegendCollapsed, setIsLegendCollapsed] = useState<boolean>(false)

  // Track parent selection changes directly during render
  const [prevSelectedId, setPrevSelectedId] = useState<string | null>(selectedCandidateId)
  if (selectedCandidateId !== prevSelectedId) {
    setPrevSelectedId(selectedCandidateId)
    setInspectorDismissed(false)
    setInspectedCandidateId(selectedCandidateId)
    setIsInspectingRover(false)
  }

  const inspectedCandidate = useMemo(() => {
    if (inspectorDismissed || isInspectingRover) return null
    const targetId = inspectedCandidateId ?? selectedCandidateId ?? null
    if (!targetId) return null
    return candidateList.find((c) => c.id === targetId) ?? null
  }, [inspectorDismissed, isInspectingRover, inspectedCandidateId, selectedCandidateId, candidateList])

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

  // Handle escape key to dismiss overlays
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsHelpModalOpen(false)
        setActiveExplanationKey(null)
        setInspectorDismissed(true)
        setIsInspectingRover(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

    // 2. Graticule (Polar circles & meridians)
    const polePx = toCanvasPx(-90, 0, size)!
    g.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    g.lineWidth = 1

    const latRings = zoomLevel === 1 ? [-89, -88, -87, -86] : zoomLevel === 2 ? [-89.5, -89, -88.5, -88] : [-89.75, -89.5, -89.25, -89]
    for (const lat of latRings) {
      const pt = toCanvasPx(lat, 0, size)!
      const rad = Math.hypot(pt[0] - polePx[0], pt[1] - polePx[1])
      g.beginPath()
      g.arc(polePx[0], polePx[1], rad, 0, 2 * Math.PI)
      g.stroke()

      // Subtle latitude pill label along the 45° diagonal
      const diagAngle = (45 * Math.PI) / 180
      const lx = polePx[0] + rad * Math.sin(diagAngle)
      const ly = polePx[1] - rad * Math.cos(diagAngle)
      if (lx > 20 && lx < size - 50 && ly > 20 && ly < size - 20) {
        g.fillStyle = 'rgba(18, 22, 28, 0.82)'
        g.strokeStyle = 'rgba(255, 255, 255, 0.2)'
        drawRoundedRect(g, lx - 22, ly - 7, 44, 14, 3)
        g.fill()
        g.stroke()
        g.fillStyle = 'rgba(217, 214, 207, 0.88)'
        g.font = '500 8.5px "IBM Plex Mono", monospace'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(`${Math.abs(lat).toFixed(1)}°S Lat`, lx, ly)
        g.textAlign = 'left'
        g.textBaseline = 'alphabetic'
      }
    }

    // Longitude radial lines
    for (let lon = 0; lon < 360; lon += 30) {
      const edgeLat = zoomLevel === 1 ? -85 : zoomLevel === 2 ? -87.5 : -88.8
      const edge = toCanvasPx(edgeLat, lon, size)!
      g.strokeStyle = lon % 90 === 0 ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.08)'
      g.lineWidth = lon % 90 === 0 ? 1.2 : 0.8
      g.beginPath()
      g.moveTo(polePx[0], polePx[1])
      g.lineTo(edge[0], edge[1])
      g.stroke()

      // Cardinal longitude labels
      if (lon % 90 === 0) {
        const labelText = lon === 0 ? '0°E (Prime / N)' : lon === 90 ? '90°E (East)' : lon === 180 ? '180°E (South)' : '270°E (West)'
        const pad = 14
        const ex = edge[0] + (lon === 90 ? -pad - 40 : lon === 270 ? pad : 0)
        const ey = edge[1] + (lon === 0 ? pad + 8 : lon === 180 ? -pad : 0)
        g.fillStyle = 'rgba(18, 22, 28, 0.82)'
        g.strokeStyle = 'rgba(255, 255, 255, 0.2)'
        drawRoundedRect(g, ex - 38, ey - 7, 76, 14, 3)
        g.fill()
        g.stroke()
        g.fillStyle = 'rgba(217, 214, 207, 0.85)'
        g.font = '500 8.5px "IBM Plex Mono", monospace'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(labelText, ex, ey)
        g.textAlign = 'left'
        g.textBaseline = 'alphabetic'
      }
    }

    // South Pole Crosshair
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(polePx[0] - 6, polePx[1])
    g.lineTo(polePx[0] + 6, polePx[1])
    g.moveTo(polePx[0], polePx[1] - 6)
    g.lineTo(polePx[0], polePx[1] + 6)
    g.stroke()
    g.fillStyle = 'rgba(217, 214, 207, 0.75)'
    g.font = '500 8.5px "Public Sans", sans-serif'
    g.fillText('South Pole 90°S', polePx[0] + 8, polePx[1] - 4)

    // Graticule explanation subtext in bottom-right (above scale bar)
    g.fillStyle = 'rgba(154, 160, 166, 0.75)'
    g.font = '400 9px "Public Sans", sans-serif'
    g.textAlign = 'right'
    g.fillText('Concentric rings: latitude • Radial lines: longitude', size - 24, size - 38)
    g.textAlign = 'left'

    // 3. Solar Ray Direction Indicator (Sun vector bearing & directional icon)
    const sunAngleRad = (sunAzimuthDeg * Math.PI) / 180
    const sunDirX = Math.sin(sunAngleRad)
    const sunDirY = -Math.cos(sunAngleRad)
    const sunDist = size * 0.43
    const sunEndpointX = polePx[0] + sunDirX * sunDist
    const sunEndpointY = polePx[1] + sunDirY * sunDist

    g.save()
    g.strokeStyle = sunElevationDeg >= 0 ? '#c98419' : '#6b7280'
    g.lineWidth = 1.6
    g.setLineDash([5, 4])
    g.beginPath()
    g.moveTo(polePx[0], polePx[1])
    g.lineTo(sunEndpointX, sunEndpointY)
    g.stroke()
    g.setLineDash([])

    // Sun Icon at directional endpoint
    if (sunElevationDeg >= 0) {
      // Sun is above horizon: warm amber glowing disc with radial rays
      g.beginPath()
      g.arc(sunEndpointX, sunEndpointY, 13, 0, 2 * Math.PI)
      g.fillStyle = 'rgba(201, 132, 25, 0.25)'
      g.fill()

      g.beginPath()
      g.arc(sunEndpointX, sunEndpointY, 7, 0, 2 * Math.PI)
      g.fillStyle = '#f2be5c'
      g.fill()
      g.strokeStyle = '#ffffff'
      g.lineWidth = 1.5
      g.stroke()

      // 8 radial ray tick marks
      for (let a = 0; a < 8; a++) {
        const rayA = (a * Math.PI) / 4
        g.beginPath()
        g.moveTo(sunEndpointX + Math.cos(rayA) * 9, sunEndpointY + Math.sin(rayA) * 9)
        g.lineTo(sunEndpointX + Math.cos(rayA) * 13, sunEndpointY + Math.sin(rayA) * 13)
        g.strokeStyle = '#f2be5c'
        g.lineWidth = 1.5
        g.stroke()
      }
    } else {
      // Sun is below horizon: slate disc with crossed-out horizon line
      g.beginPath()
      g.arc(sunEndpointX, sunEndpointY, 7, 0, 2 * Math.PI)
      g.fillStyle = '#4b5563'
      g.fill()
      g.strokeStyle = '#9ca3af'
      g.lineWidth = 1.5
      g.stroke()

      // Horizontal horizon line
      g.strokeStyle = '#e0705c'
      g.lineWidth = 1.8
      g.beginPath()
      g.moveTo(sunEndpointX - 11, sunEndpointY)
      g.lineTo(sunEndpointX + 11, sunEndpointY)
      g.stroke()

      // Diagonal slash
      g.beginPath()
      g.moveTo(sunEndpointX - 6, sunEndpointY - 6)
      g.lineTo(sunEndpointX + 6, sunEndpointY + 6)
      g.stroke()
    }

    // Sun Direction Info Badge next to the icon
    const tagW = 210
    const tagH = 50
    let tagX = sunEndpointX + (sunDirX >= 0 ? -tagW - 16 : 16)
    let tagY = sunEndpointY + (sunDirY >= 0 ? -tagH - 8 : 8)
    tagX = Math.max(10, Math.min(size - tagW - 10, tagX))
    tagY = Math.max(10, Math.min(size - tagH - 10, tagY))

    g.fillStyle = 'rgba(18, 22, 28, 0.94)'
    g.strokeStyle = sunElevationDeg >= 0 ? '#c98419' : '#6b7280'
    g.lineWidth = 1
    drawRoundedRect(g, tagX, tagY, tagW, tagH, 4)
    g.fill()
    g.stroke()

    g.font = '600 10px "Public Sans", sans-serif'
    g.fillStyle = sunElevationDeg >= 0 ? '#f2be5c' : '#9ca3af'
    g.fillText(`☀ SUN DIRECTION`, tagX + 8, tagY + 13)

    g.font = '500 9px "IBM Plex Mono", monospace'
    g.fillStyle = '#ffffff'
    const elSign = sunElevationDeg >= 0 ? '+' : ''
    g.fillText(
      `${sunAzimuthDeg.toFixed(0)}° Azimuth • ${elSign}${sunElevationDeg.toFixed(1)}° Elevation`,
      tagX + 8,
      tagY + 25,
    )

    g.font = '400 8.5px "Public Sans", sans-serif'
    if (sunElevationDeg < 0) {
      g.fillStyle = '#f08a7a'
      g.fillText('⚠ Below local horizon (Sun blocked by Moon curvature)', tagX + 8, tagY + 36)
    } else {
      g.fillStyle = '#6fcf9f'
      g.fillText('✔ Above horizon (Terrain line-of-sight active)', tagX + 8, tagY + 36)
    }

    g.fillStyle = 'rgba(154, 160, 166, 0.85)'
    g.fillText('Direction of the Sun relative to lunar surface', tagX + 8, tagY + 46)
    g.restore()

    // 4. Earth Direction Indicator (Optional)
    if (showEarthRay) {
      const earthAngleRad = (earthAzimuthDeg * Math.PI) / 180
      const eRayX = polePx[0] - Math.sin(earthAngleRad) * (size * 0.44 * 0.8)
      const eRayY = polePx[1] + Math.cos(earthAngleRad) * (size * 0.44 * 0.8)

      g.save()
      g.strokeStyle = '#5590d8'
      g.lineWidth = 1.5
      g.setLineDash([4, 4])
      g.beginPath()
      g.moveTo(polePx[0], polePx[1])
      g.lineTo(eRayX, eRayY)
      g.stroke()
      g.fillStyle = '#5590d8'
      g.font = '500 9px "IBM Plex Mono", monospace'
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
      g.strokeStyle = 'rgba(31, 163, 138, 0.65)'
      g.lineWidth = 1.8
      g.setLineDash([5, 4])
      g.beginPath()
      g.arc(searchCenter[0], searchCenter[1], radiusPx, 0, 2 * Math.PI)
      g.stroke()
      g.setLineDash([])

      // Boundary Badge
      const bW = 230
      const bH = 18
      const bX = searchCenter[0] - bW / 2
      const bY = searchCenter[1] - radiusPx - bH - 3
      if (bY > 10 && bX > 10 && bX + bW < size - 10) {
        g.fillStyle = 'rgba(18, 22, 28, 0.9)'
        g.strokeStyle = 'rgba(31, 163, 138, 0.7)'
        g.lineWidth = 1
        drawRoundedRect(g, bX, bY, bW, bH, 3)
        g.fill()
        g.stroke()

        g.fillStyle = '#6fcf9f'
        g.font = '600 9px "Public Sans", sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(
          `⚑ CANDIDATE SEARCH BOUNDARY (${searchRadKm.toFixed(1)} km RADIUS)`,
          searchCenter[0],
          bY + bH / 2,
        )
        g.textAlign = 'left'
        g.textBaseline = 'alphabetic'
      }
      g.restore()
    }

    // 6. Traversal Route from Rover to Recommended (or Selected) Target
    const targetCandidate = candidateList.find((c) => c.id === selectedCandidateId) || recommendedCandidate
    if (targetCandidate && targetCandidate.route.waypoints.length > 0) {
      g.save()
      const routeColor = targetCandidate.feasibility === 'FEASIBLE' ? '#1fa38a' : targetCandidate.feasibility === 'CAUTION' ? '#e5a83b' : '#e0705c'
      g.strokeStyle = routeColor
      g.lineWidth = 2.5
      g.setLineDash([5, 3])

      g.beginPath()
      let firstWp = true
      let midWpPx: [number, number] | null = null
      const midIdx = Math.floor(targetCandidate.route.waypoints.length / 2)

      for (let i = 0; i < targetCandidate.route.waypoints.length; i++) {
        const wp = targetCandidate.route.waypoints[i]
        const wpPx = toCanvasPx(wp.lat, wp.lon, size)
        if (!wpPx) continue
        if (firstWp) {
          g.moveTo(wpPx[0], wpPx[1])
          firstWp = false
        } else {
          g.lineTo(wpPx[0], wpPx[1])
        }
        if (i === midIdx) midWpPx = wpPx
      }
      g.stroke()
      g.setLineDash([])

      if (midWpPx && midWpPx[0] > 40 && midWpPx[0] < size - 40 && midWpPx[1] > 30 && midWpPx[1] < size - 30) {
        const mW = 150
        const mH = 16
        g.fillStyle = 'rgba(18, 22, 28, 0.9)'
        g.strokeStyle = routeColor
        g.lineWidth = 1
        drawRoundedRect(g, midWpPx[0] - mW / 2, midWpPx[1] - mH / 2, mW, mH, 3)
        g.fill()
        g.stroke()

        g.fillStyle = '#ffffff'
        g.font = '500 8.5px "Public Sans", sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(
          `TRAVERSAL ROUTE (${targetCandidate.simulation.transitDistanceKm.toFixed(2)} km)`,
          midWpPx[0],
          midWpPx[1],
        )
        g.textAlign = 'left'
        g.textBaseline = 'alphabetic'
      }
      g.restore()
    }

    // 7. Non-selected Candidate Destinations
    if (showAllCandidates) {
      for (const cand of candidateList) {
        if (cand.id === recommendedCandidate?.id || cand.id === selectedCandidateId) continue
        const pt = toCanvasPx(cand.lat, cand.lon, size)
        if (!pt) continue

        g.beginPath()
        g.arc(pt[0], pt[1], 4.5, 0, 2 * Math.PI)
        if (cand.feasibility === 'FEASIBLE') {
          g.fillStyle = '#1fa38a'
        } else if (cand.feasibility === 'CAUTION') {
          g.fillStyle = '#e5a83b'
        } else {
          g.fillStyle = '#e0705c'
        }
        g.fill()
        g.strokeStyle = '#10141a'
        g.lineWidth = 1.2
        g.stroke()

        if (cand.feasibility === 'INFEASIBLE') {
          // Subtle cross mark on infeasible
          g.strokeStyle = '#ffffff'
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(pt[0] - 2, pt[1] - 2)
          g.lineTo(pt[0] + 2, pt[1] + 2)
          g.moveTo(pt[0] + 2, pt[1] - 2)
          g.lineTo(pt[0] - 2, pt[1] + 2)
          g.stroke()
        }
      }
    }

    // 8. Selected Alternative Candidate (if not recommended)
    if (selectedCandidateId && selectedCandidateId !== recommendedCandidate?.id) {
      const selCand = candidateList.find((c) => c.id === selectedCandidateId)
      if (selCand) {
        const selPx = toCanvasPx(selCand.lat, selCand.lon, size)
        if (selPx) {
          g.beginPath()
          g.arc(selPx[0], selPx[1], 12, 0, 2 * Math.PI)
          g.fillStyle = 'rgba(31, 163, 138, 0.3)'
          g.fill()

          g.beginPath()
          g.arc(selPx[0], selPx[1], 6, 0, 2 * Math.PI)
          g.fillStyle = '#1fa38a'
          g.fill()
          g.strokeStyle = '#ffffff'
          g.lineWidth = 1.5
          g.stroke()

          const sW = 175
          const sH = 36
          let sX = selPx[0] + 12
          let sY = selPx[1] - sH - 4
          sX = Math.max(10, Math.min(size - sW - 10, sX))
          sY = Math.max(10, Math.min(size - sH - 10, sY))

          g.fillStyle = 'rgba(18, 22, 28, 0.92)'
          g.strokeStyle = '#1fa38a'
          g.lineWidth = 1
          drawRoundedRect(g, sX, sY, sW, sH, 3)
          g.fill()
          g.stroke()

          g.font = '600 9.5px "Public Sans", sans-serif'
          g.fillStyle = '#6fcf9f'
          g.fillText('ALTERNATIVE RECHARGE SITES', sX + 6, sY + 11)

          g.font = '600 9.5px "Public Sans", sans-serif'
          g.fillStyle = '#ffffff'
          g.fillText(selCand.name, sX + 6, sY + 22)

          g.font = '400 8.5px "Public Sans", sans-serif'
          g.fillStyle = 'rgba(217, 214, 207, 0.85)'
          g.fillText(
            `${selCand.simulation.transitDistanceKm.toFixed(2)} km • ${selCand.simulation.rechargeDurationH}h sun`,
            sX + 6,
            sY + 32,
          )
        }
      }
    }

    // 9. Recommended Candidate Highlight Beacon
    let targetPx: [number, number] | null = null
    if (recommendedCandidate) {
      targetPx = toCanvasPx(recommendedCandidate.lat, recommendedCandidate.lon, size)
      if (targetPx) {
        // Glowing Halo
        g.beginPath()
        g.arc(targetPx[0], targetPx[1], 14, 0, 2 * Math.PI)
        g.fillStyle = 'rgba(201, 132, 25, 0.3)'
        g.fill()

        g.beginPath()
        g.arc(targetPx[0], targetPx[1], 7, 0, 2 * Math.PI)
        g.fillStyle = '#c98419'
        g.fill()
        g.strokeStyle = '#ffffff'
        g.lineWidth = 2
        g.stroke()

        // Recommended Target Label Box
        const tW = 185
        const tH = 38
        let tX = targetPx[0] + 14
        let tY = targetPx[1] - tH - 6
        tX = Math.max(10, Math.min(size - tW - 10, tX))
        tY = Math.max(10, Math.min(size - tH - 10, tY))

        g.fillStyle = 'rgba(18, 22, 28, 0.92)'
        g.strokeStyle = '#c98419'
        g.lineWidth = 1
        drawRoundedRect(g, tX, tY, tW, tH, 3)
        g.fill()
        g.stroke()

        g.font = '600 9.5px "Public Sans", sans-serif'
        g.fillStyle = '#f2be5c'
        g.fillText('RECOMMENDED RECHARGE SITE', tX + 6, tY + 11)

        g.font = '600 9.5px "Public Sans", sans-serif'
        g.fillStyle = '#ffffff'
        g.fillText(`★ ${recommendedCandidate.name}`, tX + 6, tY + 23)

        g.font = '400 8.5px "Public Sans", sans-serif'
        g.fillStyle = 'rgba(217, 214, 207, 0.85)'
        g.fillText(
          `${recommendedCandidate.simulation.transitDistanceKm.toFixed(2)} km • ${recommendedCandidate.simulation.rechargeDurationH}h sun`,
          tX + 6,
          tY + 33,
        )
      }
    }

    // 10. Rover Position Marker (Animated or Static)
    const activeRoverLat = currentSimulationStep ? currentSimulationStep.roverLat : config.mission.startLat
    const activeRoverLon = currentSimulationStep ? currentSimulationStep.roverLon : config.mission.startLon
    const roverPx = toCanvasPx(activeRoverLat, activeRoverLon, size)

    if (roverPx) {
      // Outer pulse ring
      g.beginPath()
      g.arc(roverPx[0], roverPx[1], 10, 0, 2 * Math.PI)
      g.strokeStyle = '#5590d8'
      g.lineWidth = 2
      g.stroke()

      // Core rover icon
      g.beginPath()
      g.arc(roverPx[0], roverPx[1], 5, 0, 2 * Math.PI)
      g.fillStyle = '#5590d8'
      g.fill()
      g.strokeStyle = '#ffffff'
      g.lineWidth = 1.5
      g.stroke()

      // Rover Label Box (with smart anti-collision positioning)
      const rW = 160
      const rH = 28
      let rX = roverPx[0] + 14
      let rY = roverPx[1] + 10

      if (targetPx && Math.hypot(targetPx[0] - roverPx[0], targetPx[1] - roverPx[1]) < 100) {
        if (targetPx[0] >= roverPx[0]) {
          rX = roverPx[0] - rW - 14
        } else {
          rX = roverPx[0] + 14
        }
      }
      rX = Math.max(10, Math.min(size - rW - 10, rX))
      rY = Math.max(10, Math.min(size - rH - 10, rY))

      g.fillStyle = 'rgba(18, 22, 28, 0.92)'
      g.strokeStyle = '#5590d8'
      g.lineWidth = 1
      drawRoundedRect(g, rX, rY, rW, rH, 3)
      g.fill()
      g.stroke()

      g.font = '600 9.5px "Public Sans", sans-serif'
      g.fillStyle = '#5590d8'
      const roverLabel = currentSimulationStep?.phase === 'transit' ? 'ROVER POSITION (IN TRANSIT)' : 'CURRENT ROVER POSITION'
      g.fillText(roverLabel, rX + 6, rY + 11)

      g.font = '400 8.5px "IBM Plex Mono", monospace'
      g.fillStyle = 'rgba(217, 214, 207, 0.85)'
      g.fillText(`${Math.abs(activeRoverLat).toFixed(3)}°S, ${activeRoverLon.toFixed(2)}°E`, rX + 6, rY + 22)
    }

    // 11. Scale Bar
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
    showEarthRay,
    showAllCandidates,
    config,
    recommendedCandidate,
    candidateList,
    selectedCandidateId,
    currentSimulationStep,
    toCanvasPx,
  ])

  // Click on canvas to inspect elements or relocate rover
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

    // 1. Check if clicked near Rover
    const activeRoverLat = currentSimulationStep ? currentSimulationStep.roverLat : config.mission.startLat
    const activeRoverLon = currentSimulationStep ? currentSimulationStep.roverLon : config.mission.startLon
    const roverPt = toCanvasPx(activeRoverLat, activeRoverLon, size)
    if (roverPt && Math.hypot(roverPt[0] - x, roverPt[1] - y) < 18) {
      setIsInspectingRover(true)
      setInspectedCandidateId(null)
      setActiveExplanationKey(null)
      return
    }

    // 2. Check if clicked near any Candidate marker
    let clickedCandidate: RechargeCandidate | null = null
    for (const cand of candidateList) {
      const pt = toCanvasPx(cand.lat, cand.lon, size)
      if (pt && Math.hypot(pt[0] - x, pt[1] - y) < 16) {
        clickedCandidate = cand
        break
      }
    }
    if (clickedCandidate) {
      setInspectedCandidateId(clickedCandidate.id)
      setIsInspectingRover(false)
      setActiveExplanationKey(null)
      onSelectCandidate(clickedCandidate.id)
      return
    }

    // 3. Check if clicked near Sun Icon
    const polePx = toCanvasPx(-90, 0, size)
    if (polePx) {
      const sunAngleRad = (sunAzimuthDeg * Math.PI) / 180
      const sunDist = size * 0.43
      const sunX = polePx[0] + Math.sin(sunAngleRad) * sunDist
      const sunY = polePx[1] - Math.cos(sunAngleRad) * sunDist
      if (Math.hypot(sunX - x, sunY - y) < 26) {
        setActiveExplanationKey('sun_azimuth')
        setInspectedCandidateId(null)
        setIsInspectingRover(false)
        return
      }

      // 4. Check if clicked near Search Boundary radius
      const searchCenter = toCanvasPx(config.mission.startLat, config.mission.startLon, size)
      if (searchCenter) {
        const kmPerPx = (dataset.scaleM * (viewWindow.sw / size)) / 1000
        const radiusPx = config.mission.searchRadiusKm / kmPerPx
        const distFromSearchCenter = Math.hypot(x - searchCenter[0], y - searchCenter[1])
        if (Math.abs(distFromSearchCenter - radiusPx) < 14) {
          setActiveExplanationKey('search_boundary')
          setInspectedCandidateId(null)
          setIsInspectingRover(false)
          return
        }
      }
    }

    // 5. Click on open terrain to relocate rover
    setInspectedCandidateId(null)
    setIsInspectingRover(false)
    setActiveExplanationKey(null)
    onPickRoverLocation(Number(lat.toFixed(4)), Number(lon.toFixed(4)))
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

  const targetCandidate = candidateList.find((c) => c.id === selectedCandidateId) || recommendedCandidate
  const activeRoverLat = currentSimulationStep ? currentSimulationStep.roverLat : config.mission.startLat
  const activeRoverLon = currentSimulationStep ? currentSimulationStep.roverLon : config.mission.startLon

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

        {/* Time Comparison Toolbar Group */}
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

          <label className="toggle-switch" style={{ marginLeft: '6px' }}>
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
              Candidates
            </span>
          </label>

          <button
            type="button"
            className="btn-map-guide"
            onClick={() => setIsHelpModalOpen(true)}
            title="Open comprehensive map reading guide"
          >
            ℹ How to Read This Map
          </button>
        </div>
      </div>

      <div className="map-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="map-canvas"
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          title="Click candidate marker to inspect • Click open terrain to place rover"
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

        {/* Interactive Legend with 9 Required Explanatory Elements */}
        <div className="map-overlay-legend" aria-label="Interactive Map Legend">
          <div className="legend-header">
            <span className="legend-title">Map Legend (Click to Explain)</span>
            <button
              type="button"
              className="legend-collapse-btn"
              onClick={() => setIsLegendCollapsed(!isLegendCollapsed)}
              title={isLegendCollapsed ? 'Expand Legend' : 'Collapse Legend'}
            >
              {isLegendCollapsed ? '▸ Expand' : '▾ Collapse'}
            </button>
          </div>

          {!isLegendCollapsed && (
            <>
              <button
                type="button"
                className={`legend-item-btn ${activeExplanationKey === 'sunlit_terrain' ? 'active' : ''}`}
                onClick={() => {
                  setActiveExplanationKey(activeExplanationKey === 'sunlit_terrain' ? null : 'sunlit_terrain')
                  setInspectedCandidateId(null)
                  setIsInspectingRover(false)
                }}
                title="Click for explanation"
              >
                <span className="legend-icon" style={{ background: '#c98419' }} />
                <span>Direct Sunlight (Amber)</span>
              </button>

              <button
                type="button"
                className={`legend-item-btn ${activeExplanationKey === 'shadowed_terrain' ? 'active' : ''}`}
                onClick={() => {
                  setActiveExplanationKey(activeExplanationKey === 'shadowed_terrain' ? null : 'shadowed_terrain')
                  setInspectedCandidateId(null)
                  setIsInspectingRover(false)
                }}
                title="Click for explanation"
              >
                <span className="legend-icon" style={{ background: '#181d24', border: '1px solid #3a434e' }} />
                <span>Shadowed Regions (Charcoal)</span>
              </button>

              <button
                type="button"
                className={`legend-item-btn ${activeExplanationKey === 'rover_position' ? 'active' : ''}`}
                onClick={() => {
                  setActiveExplanationKey(activeExplanationKey === 'rover_position' ? null : 'rover_position')
                  setInspectedCandidateId(null)
                  setIsInspectingRover(true)
                }}
                title="Click for explanation"
              >
                <span className="legend-icon" style={{ background: '#5590d8', borderRadius: '50%' }} />
                <span>Current Rover Position (Blue)</span>
              </button>

              <button
                type="button"
                className={`legend-item-btn ${activeExplanationKey === 'recommended_destination' ? 'active' : ''}`}
                onClick={() => {
                  setActiveExplanationKey(activeExplanationKey === 'recommended_destination' ? null : 'recommended_destination')
                  if (recommendedCandidate) setInspectedCandidateId(recommendedCandidate.id)
                  setIsInspectingRover(false)
                }}
                title="Click for explanation"
              >
                <span
                  className="legend-icon"
                  style={{ background: '#c98419', borderRadius: '50%', border: '1.5px solid #ffffff' }}
                />
                <span>Recommended Recharge Site (Amber ★)</span>
              </button>

              <button
                type="button"
                className={`legend-item-btn ${activeExplanationKey === 'alternative_candidates' ? 'active' : ''}`}
                onClick={() => {
                  setActiveExplanationKey(activeExplanationKey === 'alternative_candidates' ? null : 'alternative_candidates')
                  setInspectedCandidateId(null)
                  setIsInspectingRover(false)
                }}
                title="Click for explanation"
              >
                <span className="legend-icon" style={{ background: '#1fa38a', borderRadius: '50%' }} />
                <span>Alternative Recharge Sites (Teal)</span>
              </button>

              <button
                type="button"
                className={`legend-item-btn ${activeExplanationKey === 'sun_azimuth' ? 'active' : ''}`}
                onClick={() => {
                  setActiveExplanationKey(activeExplanationKey === 'sun_azimuth' ? null : 'sun_azimuth')
                  setInspectedCandidateId(null)
                  setIsInspectingRover(false)
                }}
                title="Click for explanation"
              >
                <span className="legend-line-icon" style={{ borderTop: '2px dashed #c98419' }} />
                <span>Sun Direction (Azimuth Vector)</span>
              </button>

              <button
                type="button"
                className={`legend-item-btn ${activeExplanationKey === 'coordinate_grid' ? 'active' : ''}`}
                onClick={() => {
                  setActiveExplanationKey(activeExplanationKey === 'coordinate_grid' ? null : 'coordinate_grid')
                  setInspectedCandidateId(null)
                  setIsInspectingRover(false)
                }}
                title="Click for explanation"
              >
                <span className="legend-line-icon" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.45)' }} />
                <span>Coordinate Reference Rings (Lat/Lon)</span>
              </button>

              <button
                type="button"
                className={`legend-item-btn ${activeExplanationKey === 'search_boundary' ? 'active' : ''}`}
                onClick={() => {
                  setActiveExplanationKey(activeExplanationKey === 'search_boundary' ? null : 'search_boundary')
                  setInspectedCandidateId(null)
                  setIsInspectingRover(false)
                }}
                title="Click for explanation"
              >
                <span className="legend-line-icon" style={{ borderTop: '2px dashed rgba(31, 163, 138, 0.8)' }} />
                <span>Search Boundary ({config.mission.searchRadiusKm.toFixed(1)} km)</span>
              </button>

              {targetCandidate && targetCandidate.route.waypoints.length > 0 && (
                <button
                  type="button"
                  className={`legend-item-btn ${activeExplanationKey === 'traversal_route' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveExplanationKey(activeExplanationKey === 'traversal_route' ? null : 'traversal_route')
                    setInspectedCandidateId(null)
                    setIsInspectingRover(false)
                  }}
                  title="Click for explanation"
                >
                  <span className="legend-line-icon" style={{ borderTop: '2.5px dashed #1fa38a' }} />
                  <span>Rover Traversal Route</span>
                </button>
              )}
            </>
          )}
        </div>

        {/* Floating Explanation Card (When legend element is clicked) */}
        {activeExplanationKey && MAP_EXPLANATIONS[activeExplanationKey] && (
          <div className="map-explanation-card" role="dialog" aria-label="Map Element Explanation">
            <div className="map-explanation-header">
              <div>
                <div className="map-explanation-subtitle">
                  {MAP_EXPLANATIONS[activeExplanationKey].subtitle}
                </div>
                <div className="map-explanation-title">
                  {MAP_EXPLANATIONS[activeExplanationKey].title}
                </div>
              </div>
              <button
                type="button"
                className="map-inspector-close"
                onClick={() => setActiveExplanationKey(null)}
                title="Close Explanation"
              >
                ✕
              </button>
            </div>

            <p className="map-explanation-desc">
              {MAP_EXPLANATIONS[activeExplanationKey].description}
            </p>

            <ul className="map-explanation-list">
              {MAP_EXPLANATIONS[activeExplanationKey].details.map((detail, idx) => (
                <li key={idx}>{detail}</li>
              ))}
            </ul>

            <button
              type="button"
              className="btn-table-pick"
              style={{ alignSelf: 'flex-end', fontSize: '0.74rem', padding: '3px 8px' }}
              onClick={() => setActiveExplanationKey(null)}
            >
              Got it
            </button>
          </div>
        )}

        {/* Floating Marker Inspector Card (When candidate is clicked) */}
        {inspectedCandidate && (
          <div className="map-inspector-card" role="region" aria-label="Candidate Location Telemetry">
            <div className="map-inspector-header">
              <div>
                <div className="map-inspector-title">
                  {inspectedCandidate.id === recommendedCandidate?.id
                    ? '★ RECOMMENDED RECHARGE SITE'
                    : 'ALTERNATIVE RECHARGE SITE'}
                </div>
                <div className="map-inspector-name">{inspectedCandidate.name}</div>
              </div>
              <button
                type="button"
                className="map-inspector-close"
                onClick={() => setInspectedCandidateId(null)}
                title="Close Inspector"
              >
                ✕
              </button>
            </div>

            <div className="map-inspector-body">
              <div className="map-inspector-row">
                <span>Coordinates:</span>
                <strong>
                  {Math.abs(inspectedCandidate.lat).toFixed(4)}°S, {inspectedCandidate.lon.toFixed(3)}°E
                </strong>
              </div>
              <div className="map-inspector-row">
                <span>Elevation / Slope:</span>
                <span>
                  {inspectedCandidate.elevationM > 0 ? '+' : ''}{inspectedCandidate.elevationM} m (Max {inspectedCandidate.route.maxSlopeDeg.toFixed(1)}°)
                </span>
              </div>
              <div className="map-inspector-row">
                <span>Distance from Rover:</span>
                <strong>{inspectedCandidate.simulation.transitDistanceKm.toFixed(2)} km</strong>
              </div>
              <div className="map-inspector-row">
                <span>Direction / Heading:</span>
                <span>
                  {inspectedCandidate.cardinalDirection} ({inspectedCandidate.bearingDeg.toFixed(0)}° Azimuth)
                </span>
              </div>
              <div className="map-inspector-row">
                <span>Feasibility Verdict:</span>
                <span className={`cand-status-pill ${inspectedCandidate.feasibility.toLowerCase()}`}>
                  {inspectedCandidate.feasibility}
                </span>
              </div>
              <div className="map-inspector-row">
                <span>Sunlight Window:</span>
                <strong style={{ color: 'var(--sun)' }}>
                  {inspectedCandidate.simulation.rechargeDurationH} h continuous
                </strong>
              </div>
              <div className="map-inspector-row">
                <span>Net Mission Benefit:</span>
                <strong style={{ color: inspectedCandidate.netMissionBenefitKwh > 0 ? '#6fcf9f' : '#f08a7a' }}>
                  {inspectedCandidate.netMissionBenefitKwh > 0 ? '+' : ''}
                  {inspectedCandidate.netMissionBenefitKwh.toFixed(2)} kWh
                </strong>
              </div>
            </div>

            {selectedCandidateId !== inspectedCandidate.id && (
              <button
                type="button"
                className="btn-table-pick active"
                style={{ width: '100%', marginTop: '4px' }}
                onClick={() => onSelectCandidate(inspectedCandidate.id)}
              >
                Set as Active Target
              </button>
            )}
          </div>
        )}

        {/* Floating Rover Inspector Card (When Rover is clicked) */}
        {isInspectingRover && (
          <div className="map-inspector-card" role="region" aria-label="Rover Location Telemetry">
            <div className="map-inspector-header">
              <div>
                <div className="map-inspector-title" style={{ color: '#5590d8' }}>
                  CURRENT ROVER POSITION
                </div>
                <div className="map-inspector-name">Simulated Rover Location</div>
              </div>
              <button
                type="button"
                className="map-inspector-close"
                onClick={() => setIsInspectingRover(false)}
                title="Close Inspector"
              >
                ✕
              </button>
            </div>

            <div className="map-inspector-body">
              <div className="map-inspector-row">
                <span>Current Coordinates:</span>
                <strong>
                  {Math.abs(activeRoverLat).toFixed(4)}°S, {activeRoverLon.toFixed(3)}°E
                </strong>
              </div>
              <div className="map-inspector-row">
                <span>Mission Phase:</span>
                <span>
                  {currentSimulationStep?.phase === 'transit'
                    ? 'In Transit along Traversal Route'
                    : currentSimulationStep?.phase === 'recharge'
                    ? 'Recharging at Destination'
                    : 'Stationary at Mission Origin'}
                </span>
              </div>
              <div className="map-inspector-row">
                <span>Battery State of Charge:</span>
                <strong style={{ color: '#5590d8' }}>
                  {(currentSimulationStep?.socPct ?? config.battery.currentSocPct).toFixed(1)}% (
                  {(currentSimulationStep?.storedEnergyKwh ?? (config.battery.totalCapacityKwh * config.battery.currentSocPct / 100)).toFixed(2)} kWh)
                </strong>
              </div>
              <div className="map-inspector-row">
                <span>Solar Illumination:</span>
                <span style={{ color: currentSimulationStep?.isDirectSunlit ? 'var(--sun)' : 'var(--muted)' }}>
                  {currentSimulationStep?.isDirectSunlit ? '☀ Direct Sunlight' : '🌑 In Shadow'}
                </span>
              </div>
              <div className="map-inspector-row">
                <span>Search Boundary Radius:</span>
                <span>{config.mission.searchRadiusKm.toFixed(1)} km</span>
              </div>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--muted)', margin: '4px 0 0 0' }}>
              Tip: Click any open terrain on the map to relocate the rover origin and re-evaluate surrounding recharge candidates.
            </p>
          </div>
        )}
      </div>

      {/* "How to Read This Map" Modal Guide */}
      {isHelpModalOpen && (
        <div
          className="map-help-modal-backdrop"
          onClick={() => setIsHelpModalOpen(false)}
          role="presentation"
        >
          <div
            className="map-help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="How to Read the Lunar Illumination Map"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="map-help-header">
              <div>
                <h3>
                  <span style={{ color: 'var(--sun)' }}>ℹ</span> How to Read This Lunar Illumination Map
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Aerospace Mission Planning Instrument Guide • NASA South Pole Operations
                </span>
              </div>
              <button
                type="button"
                className="map-inspector-close"
                onClick={() => setIsHelpModalOpen(false)}
                title="Close Guide"
              >
                ✕
              </button>
            </div>

            <div className="map-help-section">
              <h4>Three Quick Questions (Visual Hierarchy)</h4>
              <div className="map-help-grid">
                <div className="map-help-card" style={{ borderLeft: '3px solid #5590d8' }}>
                  <div className="map-help-card-title">
                    <span style={{ color: '#5590d8' }}>1. Where is the rover?</span>
                  </div>
                  <p className="map-help-card-desc">
                    Look for the blue circular beacon labeled <strong>CURRENT ROVER POSITION</strong>. During mission timeline simulation, it travels along the planned route.
                  </p>
                </div>

                <div className="map-help-card" style={{ borderLeft: '3px solid #c98419' }}>
                  <div className="map-help-card-title">
                    <span style={{ color: '#c98419' }}>2. Where is the Sun?</span>
                  </div>
                  <p className="map-help-card-desc">
                    Follow the dashed amber vector to the <strong>☀ SUN DIRECTION</strong> icon. The badge displays horizontal azimuth (° from north) and elevation angle above/below the lunar horizon.
                  </p>
                </div>

                <div className="map-help-card" style={{ borderLeft: '3px solid #1fa38a' }}>
                  <div className="map-help-card-title">
                    <span style={{ color: '#1fa38a' }}>3. Where to recharge?</span>
                  </div>
                  <p className="map-help-card-desc">
                    Follow the dashed traversal route to the glowing amber star beacon labeled <strong>★ RECOMMENDED RECHARGE SITE</strong>.
                  </p>
                </div>
              </div>
            </div>

            <div className="map-help-section">
              <h4>Colours &amp; Shading Meaning</h4>
              <div className="map-help-grid">
                <div className="map-help-card">
                  <div className="map-help-card-title">
                    <span style={{ width: '10px', height: '10px', background: '#c98419', borderRadius: '2px' }} />
                    Direct Sunlight (Amber)
                  </div>
                  <p className="map-help-card-desc">
                    Terrain receiving unobstructed direct sunlight at the current timestamp, computed from NASA LOLA digital elevation models.
                  </p>
                </div>

                <div className="map-help-card">
                  <div className="map-help-card-title">
                    <span style={{ width: '10px', height: '10px', background: '#181d24', border: '1px solid #3a434e', borderRadius: '2px' }} />
                    Cold Shadow (Charcoal)
                  </div>
                  <p className="map-help-card-desc">
                    Terrain where sunlight is blocked by lunar topography. Rovers in shadow consume battery reserves without solar recharging.
                  </p>
                </div>

                <div className="map-help-card">
                  <div className="map-help-card-title">
                    <span style={{ width: '8px', height: '8px', background: '#1fa38a', borderRadius: '50%' }} />
                    Alternative Sites (Teal)
                  </div>
                  <p className="map-help-card-desc">
                    Secondary viable recharge locations within the search boundary that meet safety and reserve constraints.
                  </p>
                </div>

                <div className="map-help-card">
                  <div className="map-help-card-title">
                    <span style={{ width: '8px', height: '8px', background: '#e0705c', borderRadius: '50%' }} />
                    Infeasible Candidates (Red ✕)
                  </div>
                  <p className="map-help-card-desc">
                    Destinations that cannot be reached without depleting battery energy or breaching safety reserve thresholds.
                  </p>
                </div>
              </div>
            </div>

            <div className="map-help-section">
              <h4>Geometry &amp; Reference Systems</h4>
              <div className="map-help-grid">
                <div className="map-help-card">
                  <div className="map-help-card-title">Coordinate Grid (Graticule)</div>
                  <p className="map-help-card-desc">
                    Concentric rings show lunar latitude (degrees south from equator towards 90°S). Radial lines show longitude (0° to 360°E).
                  </p>
                </div>

                <div className="map-help-card">
                  <div className="map-help-card-title">Candidate Search Boundary</div>
                  <p className="map-help-card-desc">
                    The dashed circle around the rover origin represents the configured search radius ({config.mission.searchRadiusKm.toFixed(1)} km). All ranked recharge candidates lie within this zone.
                  </p>
                </div>
              </div>
            </div>

            <div className="map-help-section">
              <h4>Interactive Controls</h4>
              <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: 0, lineHeight: 1.45 }}>
                • <strong>Click any marker</strong> on the map to inspect its distance, heading, and sunlight window.<br />
                • <strong>Click any legend entry</strong> to see a detailed explanation of that map element.<br />
                • <strong>Click open terrain</strong> to relocate the rover origin and evaluate a new landing site.<br />
                • <strong>Use the simulation slider</strong> or preview buttons (+1h, +6h, +12h) to watch dynamic shadow motion.
              </p>
            </div>

            <button
              type="button"
              className="btn-table-pick active"
              style={{ alignSelf: 'flex-end', padding: '6px 16px' }}
              onClick={() => setIsHelpModalOpen(false)}
            >
              Close Guide (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
