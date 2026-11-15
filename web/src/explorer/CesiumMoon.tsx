import { useEffect, useImperativeHandle, useRef, forwardRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { SiteSummary, State } from '../data'
import type { Sample, Verdict } from '../ellipseCheck'
import { ellipseOutline, type EllipseSpec, type LatLon } from '../ellipseGeometry'
import type { ARTEMIS_3_SITES } from '../data/artemisData'
import {
  GLOBAL_LANDMARKS,
  SOUTH_POLE_PSRS,
  nearestPsr,
  topocentricAzEl,
  type EphemerisInstant,
  type Region,
} from './moonMath'

declare global {
  interface Window {
    CESIUM_BASE_URL?: string
  }
}

export interface ExplorerLayers {
  wacImagery: boolean
  elevationTint: boolean
  solarLighting: boolean
  psrs: boolean
  artemis: boolean
  sites: boolean
  landmarks: boolean
  rays: boolean
  ellipse: boolean
}

export interface EllipseDrawData {
  center: LatLon
  spec: EllipseSpec
  points: (Sample | null)[]
  cells: (LatLon[] | null)[]
  viabilities: ('viable' | 'marginal' | 'not' | 'nodata')[]
  chancePct: number | null
  verdict: Verdict | null
}

export interface CesiumMoonHandle {
  flyTo: (lat: number, lon: number, heightKm?: number, pitchDeg?: number, durationS?: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetSouthPole: () => void
}

export interface CesiumMoonProps {
  mode: '3d' | '2d'
  ephemeris: EphemerisInstant | null
  layers: ExplorerLayers
  sites: SiteSummary[]
  siteStates: Record<string, State>
  artemis: Region[]
  artemisDossiers: typeof ARTEMIS_3_SITES
  selected: { lat: number; lon: number; name?: string } | null
  ellipse: EllipseDrawData | null
  onPickPoint: (lat: number, lon: number, label?: string, siteId?: string) => void
  onCameraCenter?: (lat: number, lon: number, heightKm: number) => void
}

const STATE_HEX: Record<State, string> = {
  both: '#1fa38a',
  sun: '#f5b041',
  earth: '#4f9dff',
  none: '#6b7280',
}

const V_HEX = {
  viable: '#3fb27f',
  marginal: '#e6c15a',
  not: '#f05a50',
  nodata: '#64748b',
}

export const CesiumMoon = forwardRef<CesiumMoonHandle, CesiumMoonProps>(function CesiumMoon(
  {
    mode,
    ephemeris,
    layers,
    sites,
    siteStates,
    artemis,
    artemisDossiers,
    selected,
    ellipse,
    onPickPoint,
    onCameraCenter,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const wacLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const lolaLayerRef = useRef<Cesium.ImageryLayer | null>(null)

  const dsPsrRef = useRef<Cesium.CustomDataSource | null>(null)
  const dsArtemisRef = useRef<Cesium.CustomDataSource | null>(null)
  const dsSitesRef = useRef<Cesium.CustomDataSource | null>(null)
  const dsEllipseRef = useRef<Cesium.CustomDataSource | null>(null)
  const dsDynRef = useRef<Cesium.CustomDataSource | null>(null)

  const ephemRef = useRef<EphemerisInstant | null>(ephemeris)
  const selectedRef = useRef(selected)
  const layersRef = useRef(layers)
  const onPickRef = useRef(onPickPoint)
  const onCamRef = useRef(onCameraCenter)

  ephemRef.current = ephemeris
  selectedRef.current = selected
  layersRef.current = layers
  onPickRef.current = onPickPoint
  onCamRef.current = onCameraCenter

  const [ready, setReady] = useState(false)
  const [tileNotice, setTileNotice] = useState<string | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      flyTo(lat: number, lon: number, heightKm = 180, pitchDeg = -55, durationS = 1.4) {
        const v = viewerRef.current
        if (!v) return
        const moon = Cesium.Ellipsoid.MOON
        if (v.scene.mode === Cesium.SceneMode.SCENE2D) {
          v.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(40, heightKm) * 1000, moon),
            duration: durationS,
          })
          return
        }
        // Place camera looking toward the point at the desired pitch using bounding sphere offset
        const target = Cesium.Cartesian3.fromDegrees(lon, lat, 0, moon)
        v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0),
            Cesium.Math.toRadians(pitchDeg),
            heightKm * 1000,
          ),
          duration: durationS,
        })
      },
      zoomIn() {
        const v = viewerRef.current
        if (!v) return
        const h = Cesium.Ellipsoid.MOON.cartesianToCartographic(v.camera.positionWC)?.height ?? 800_000
        v.camera.zoomIn(Math.max(1500, h * 0.4))
      },
      zoomOut() {
        const v = viewerRef.current
        if (!v) return
        const h = Cesium.Ellipsoid.MOON.cartesianToCartographic(v.camera.positionWC)?.height ?? 800_000
        v.camera.zoomOut(Math.max(2500, h * 0.55))
      },
      resetSouthPole() {
        const v = viewerRef.current
        if (!v) return
        const moon = Cesium.Ellipsoid.MOON
        const target = Cesium.Cartesian3.fromDegrees(0, -88.5, 0, moon)
        if (v.scene.mode === Cesium.SceneMode.SCENE2D) {
          v.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(0, -86, 1_500_000, moon), duration: 1.0 })
        } else {
          v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-72), 420_000),
            duration: 1.1,
          })
        }
      },
    }),
    [],
  )

  // Initialize Cesium Moon Viewer once
  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    const base = import.meta.env.BASE_URL ?? '/'
    window.CESIUM_BASE_URL = `${base}cesium/`
    Cesium.Ellipsoid.default = Cesium.Ellipsoid.MOON
    const moon = Cesium.Ellipsoid.MOON

    const globe = new Cesium.Globe(moon)
    globe.showGroundAtmosphere = false
    globe.enableLighting = layersRef.current.solarLighting
    globe.lightingFadeOutDistance = 100
    globe.lightingFadeInDistance = 200
    globe.lambertDiffuseMultiplier = 1.6
    globe.baseColor = Cesium.Color.fromCssColorString('#1a1c20')

    const viewer = new Cesium.Viewer(el, {
      globe,
      mapProjection: new Cesium.GeographicProjection(moon),
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      skyAtmosphere: false,
      scene3DOnly: false,
    })

    if (viewer.scene.moon) viewer.scene.moon.show = false
    if (viewer.scene.sun) viewer.scene.sun.show = false
    viewer.scene.fog.enabled = false
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#05080d')

    let disposed = false

    // 1) Local fallback mosaic underneath
    Cesium.SingleTileImageryProvider.fromUrl(`${base}data/globe/lroc_color_2k.jpg`, {
      ellipsoid: moon,
      rectangle: Cesium.Rectangle.MAX_VALUE,
    })
      .then((prov) => {
        if (disposed || viewer.isDestroyed()) return
        const layer = viewer.imageryLayers.addImageryProvider(prov, 0)
        layer.brightness = 1.4
        layer.contrast = 1.12
      })
      .catch(() => {
        /* ignore if offline */
      })

    // 2) Streaming NASA Moon Trek LRO WAC mosaic (zoom 0..8, ~100 m/px)
    const wacProv = new Cesium.WebMapTileServiceImageryProvider({
      url: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.jpg',
      layer: 'LRO_WAC_Mosaic_Global_303ppd_v02',
      style: 'default',
      format: 'image/jpeg',
      tileMatrixSetID: 'default028mm',
      tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: moon }),
      minimumLevel: 0,
      maximumLevel: 8,
      credit: 'NASA Moon Trek · LRO WAC',
      ellipsoid: moon,
    })
    let tileErrors = 0
    wacProv.errorEvent.addEventListener(() => {
      tileErrors++
      if (tileErrors >= 4) setTileNotice('NASA Moon Trek tiles slow/unavailable — showing bundled 2k LRO mosaic')
    })
    const wacLayer = viewer.imageryLayers.addImageryProvider(wacProv)
    wacLayer.brightness = 1.42
    wacLayer.contrast = 1.12
    wacLayer.show = layersRef.current.wacImagery
    wacLayerRef.current = wacLayer

    // 3) LOLA color-shaded elevation overlay
    const lolaProv = new Cesium.WebMapTileServiceImageryProvider({
      url: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrShade_Global_128ppd_v04/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.png',
      layer: 'LRO_LOLA_ClrShade_Global_128ppd_v04',
      style: 'default',
      format: 'image/png',
      tileMatrixSetID: 'default028mm',
      tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: moon }),
      minimumLevel: 0,
      maximumLevel: 5,
      credit: 'NASA LRO LOLA Elevation',
      ellipsoid: moon,
    })
    const lolaLayer = viewer.imageryLayers.addImageryProvider(lolaProv)
    lolaLayer.alpha = 0.52
    lolaLayer.show = layersRef.current.elevationTint
    lolaLayerRef.current = lolaLayer

    // 4) Custom DataSources for crisp toggling
    const dsPsr = new Cesium.CustomDataSource('psr')
    const dsArtemis = new Cesium.CustomDataSource('artemis')
    const dsSites = new Cesium.CustomDataSource('sites')
    const dsEllipse = new Cesium.CustomDataSource('ellipse')
    const dsDyn = new Cesium.CustomDataSource('dynamic')
    viewer.dataSources.add(dsPsr)
    viewer.dataSources.add(dsArtemis)
    viewer.dataSources.add(dsSites)
    viewer.dataSources.add(dsEllipse)
    viewer.dataSources.add(dsDyn)

    dsPsrRef.current = dsPsr
    dsArtemisRef.current = dsArtemis
    dsSitesRef.current = dsSites
    dsEllipseRef.current = dsEllipse
    dsDynRef.current = dsDyn

    // Static PSR Cold Traps layer
    for (const psr of SOUTH_POLE_PSRS) {
      dsPsr.entities.add({
        id: `psr-${psr.id}`,
        position: Cesium.Cartesian3.fromDegrees(psr.lon, psr.lat, 500, moon),
        ellipse: {
          semiMajorAxis: psr.radiusKm * 1000,
          semiMinorAxis: psr.radiusKm * 1000,
          material: Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.22),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#38e1ff').withAlpha(0.85),
          outlineWidth: 2,
          height: 300,
        },
        label: {
          text: `${psr.name.replace(' PSR', '')} · ${psr.tempK} K`,
          font: '600 11px Archivo, system-ui, sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#a5f3fc'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_400_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }

    // Dynamic CallbackProperty entities (sub-solar, sub-earth, selected marker, Sun/Earth sight lines, traverse line)
    dsDyn.entities.add({
      id: 'subsolar-pin',
      position: new Cesium.CallbackProperty(() => {
        const e = ephemRef.current
        if (!e) return Cesium.Cartesian3.fromDegrees(0, 0, 5000, moon)
        return Cesium.Cartesian3.fromDegrees(e.subSolar.lon, e.subSolar.lat, 8000, moon)
      }, false) as unknown as Cesium.PositionProperty,
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#f5b041'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: 'SUB-SOLAR',
        font: '700 10px Archivo, system-ui, sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#fbd38d'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    // Selected point ring + Sun/Earth 3D beams + Nearest PSR traverse vector
    dsDyn.entities.add({
      id: 'selected-marker',
      show: true,
      position: new Cesium.CallbackProperty(() => {
        const s = selectedRef.current
        return s
          ? Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 1200, moon)
          : Cesium.Cartesian3.fromDegrees(0, -89.5, 1200, moon)
      }, false) as unknown as Cesium.PositionProperty,
      point: {
        pixelSize: 11,
        color: Cesium.Color.fromCssColorString('#ffffff'),
        outlineColor: Cesium.Color.fromCssColorString('#38e1ff'),
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    const rayPositions = (body: 'sun' | 'earth') =>
      new Cesium.CallbackProperty(() => {
        const s = selectedRef.current
        const e = ephemRef.current
        if (!s || !e || !layersRef.current.rays) return []
        const origin = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 1500, moon)
        const tgt = body === 'sun' ? e.sun : e.earth
        const ox = origin.x / 1000, oy = origin.y / 1000, oz = origin.z / 1000
        const dx = tgt.x - ox, dy = tgt.y - oy, dz = tgt.z - oz
        const d = Math.hypot(dx, dy, dz) || 1
        const lenM = 180_000
        const tip = new Cesium.Cartesian3(
          origin.x + (dx / d) * lenM,
          origin.y + (dy / d) * lenM,
          origin.z + (dz / d) * lenM,
        )
        return [origin, tip]
      }, false)

    const rayColor = (body: 'sun' | 'earth') =>
      new Cesium.CallbackProperty(() => {
        const s = selectedRef.current
        const e = ephemRef.current
        if (!s || !e) return Cesium.Color.GRAY
        const { elDeg } = topocentricAzEl(s.lat, s.lon, body === 'sun' ? e.sun : e.earth)
        const baseColor =
          elDeg > -0.25
            ? Cesium.Color.fromCssColorString(body === 'sun' ? '#f5b041' : '#4f9dff')
            : Cesium.Color.fromCssColorString('#f08a7a').withAlpha(0.55)
        return baseColor
      }, false)

    dsDyn.entities.add({
      id: 'sun-ray',
      polyline: {
        positions: rayPositions('sun'),
        width: 3,
        material: new Cesium.ColorMaterialProperty(rayColor('sun')),
      },
    })

    dsDyn.entities.add({
      id: 'earth-ray',
      polyline: {
        positions: rayPositions('earth'),
        width: 3,
        material: new Cesium.ColorMaterialProperty(rayColor('earth')),
      },
    })

    dsDyn.entities.add({
      id: 'psr-traverse',
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const s = selectedRef.current
          if (!s || !layersRef.current.psrs || s.lat > -78) return []
          const { psr } = nearestPsr(s.lat, s.lon)
          return [
            Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 1200, moon),
            Cesium.Cartesian3.fromDegrees(psr.lon, psr.lat, 1200, moon),
          ]
        }, false),
        width: 2.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#00f5d4'),
          dashLength: 14,
        }),
      },
    })

    // Click handler: pick entity or surface coordinates anywhere on Moon
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position)
      if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
        const ent = picked.id
        if (ent.id.startsWith('site-')) {
          const id = ent.id.slice(5)
          const pos = ent.position?.getValue(Cesium.JulianDate.now())
          if (pos) {
            const c = moon.cartesianToCartographic(pos)
            onPickRef.current(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude), ent.name, id)
            return
          }
        }
        if (ent.id.startsWith('artemis-') || ent.id.startsWith('landmark-') || ent.id.startsWith('psr-')) {
          const pos = ent.position?.getValue(Cesium.JulianDate.now())
          if (pos) {
            const c = moon.cartesianToCartographic(pos)
            onPickRef.current(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude), ent.name)
            return
          }
        }
      }
      const cart = viewer.camera.pickEllipsoid(movement.position, moon)
      if (cart) {
        const c = moon.cartesianToCartographic(cart)
        onPickRef.current(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude))
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    const onMoveEnd = () => {
      const cb = onCamRef.current
      if (!cb || viewer.isDestroyed()) return
      const rect = viewer.camera.computeViewRectangle(moon)
      let lat = 0, lon = 0
      if (rect) {
        lat = Cesium.Math.toDegrees((rect.north + rect.south) / 2)
        lon = Cesium.Math.toDegrees((rect.east + rect.west) / 2)
      } else {
        const c = moon.cartesianToCartographic(viewer.camera.positionWC)
        if (c) {
          lat = Cesium.Math.toDegrees(c.latitude)
          lon = Cesium.Math.toDegrees(c.longitude)
        }
      }
      const h = (moon.cartesianToCartographic(viewer.camera.positionWC)?.height ?? 1_500_000) / 1000
      cb(lat, lon, h)
    }
    viewer.camera.moveEnd.addEventListener(onMoveEnd)

    // Initial landing view: looking obliquely across the lunar south pole
    const initTarget = Cesium.Cartesian3.fromDegrees(0, -88.5, 0, moon)
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(initTarget, 1), {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-70), 560_000),
      duration: 0,
    })

    viewerRef.current = viewer
    setReady(true)

    return () => {
      disposed = true
      handler.destroy()
      if (!viewer.isDestroyed()) {
        viewer.camera.moveEnd.removeEventListener(onMoveEnd)
        viewer.destroy()
      }
      viewerRef.current = null
    }
  }, [])

  // Morph between 3D globe and 2D flat map
  useEffect(() => {
    const v = viewerRef.current
    if (!v || !ready || v.isDestroyed()) return
    if (mode === '2d' && v.scene.mode !== Cesium.SceneMode.SCENE2D) {
      v.scene.morphTo2D(0.55)
    } else if (mode === '3d' && v.scene.mode !== Cesium.SceneMode.SCENE3D) {
      v.scene.morphTo3D(0.55)
    }
  }, [mode, ready])

  // Sync Sun DirectionalLight from DE421 ephemeris + layer visibility
  useEffect(() => {
    const v = viewerRef.current
    if (!v || !ready || v.isDestroyed()) return
    v.scene.globe.enableLighting = layers.solarLighting
    if (wacLayerRef.current) wacLayerRef.current.show = layers.wacImagery
    if (lolaLayerRef.current) lolaLayerRef.current.show = layers.elevationTint
    if (dsPsrRef.current) dsPsrRef.current.show = layers.psrs
    if (dsArtemisRef.current) dsArtemisRef.current.show = layers.artemis
    if (dsSitesRef.current) dsSitesRef.current.show = layers.sites
    if (dsEllipseRef.current) dsEllipseRef.current.show = layers.ellipse

    if (ephemeris) {
      const { x, y, z } = ephemeris.sun
      const mag = Math.hypot(x, y, z) || 1
      // DirectionalLight.direction emits light FROM Sun TOWARD Moon center -> negate sun vector
      v.scene.light = new Cesium.DirectionalLight({
        direction: new Cesium.Cartesian3(-x / mag, -y / mag, -z / mag),
        color: Cesium.Color.fromCssColorString('#fffaf0'),
        intensity: 2.2,
      })
    }
  }, [ephemeris, layers, ready])

  // Rebuild Artemis regions & global landmarks
  useEffect(() => {
    const ds = dsArtemisRef.current
    if (!ds || !ready) return
    const moon = Cesium.Ellipsoid.MOON
    ds.entities.removeAll()
    for (const r of artemis) {
      const d = artemisDossiers.find((a) => a.name.toLowerCase() === r.name.toLowerCase())
      ds.entities.add({
        id: `artemis-${r.name}`,
        name: r.name,
        position: Cesium.Cartesian3.fromDegrees(r.lon, r.lat, 800, moon),
        ellipse: {
          semiMajorAxis: 12_000,
          semiMinorAxis: 12_000,
          material: Cesium.Color.fromCssColorString('#cf86c3').withAlpha(0.16),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#e879f9'),
          outlineWidth: 2,
          height: 400,
        },
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString('#e879f9'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: d ? `${r.name} (${d.resources.water_ice_potential})` : r.name,
          font: '600 11px Archivo, system-ui, sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#f5d0fe'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_800_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }
    if (layers.landmarks) {
      for (const lm of GLOBAL_LANDMARKS) {
        ds.entities.add({
          id: `landmark-${lm.id}`,
          name: lm.name,
          position: Cesium.Cartesian3.fromDegrees(lm.lon, lm.lat, 800, moon),
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString('#94a3b8'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1.5,
          },
          label: {
            text: lm.name,
            font: '500 11px Archivo, system-ui, sans-serif',
            fillColor: Cesium.Color.fromCssColorString('#cbd5e1'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -12),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_500_000),
          },
        })
      }
    }
  }, [artemis, artemisDossiers, layers.landmarks, ready])

  // Rebuild site markers colored by instantaneous Sun/Earth state
  useEffect(() => {
    const ds = dsSitesRef.current
    if (!ds || !ready) return
    const moon = Cesium.Ellipsoid.MOON
    ds.entities.removeAll()
    for (const s of sites) {
      const st = siteStates[s.id] ?? 'none'
      const isSelected = selected?.name === s.name
      ds.entities.add({
        id: `site-${s.id}`,
        name: s.name,
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 1000, moon),
        point: {
          pixelSize: isSelected ? 12 : 8,
          color: Cesium.Color.fromCssColorString(STATE_HEX[st]),
          outlineColor: isSelected ? Cesium.Color.WHITE : Cesium.Color.BLACK,
          outlineWidth: isSelected ? 2.5 : 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: s.name,
          font: `${isSelected ? 700 : 500} 11px Archivo, system-ui, sans-serif`,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isSelected ? 6_000_000 : 750_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }
  }, [sites, siteStates, selected, ready])

  // Rebuild landing ellipse dispersion outline + tiles
  useEffect(() => {
    const ds = dsEllipseRef.current
    if (!ds || !ready) return
    const moon = Cesium.Ellipsoid.MOON
    ds.entities.removeAll()
    if (!ellipse) return

    const ring = ellipseOutline(ellipse.center, ellipse.spec, 72)
    ds.entities.add({
      id: 'ellipse-outline',
      polyline: {
        positions: ring.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 700, moon)),
        width: 2.5,
        material: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.9),
      },
    })

    ellipse.cells.forEach((cell, idx) => {
      if (!cell) return
      const v = ellipse.viabilities[idx] ?? 'nodata'
      ds.entities.add({
        id: `ellipse-cell-${idx}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(cell.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 450, moon))),
          material: Cesium.Color.fromCssColorString(V_HEX[v]).withAlpha(0.55),
          outline: true,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.35),
          height: 450,
        },
      })
    })
  }, [ellipse, ready])

  return (
    <div className="mx-cesium-wrap">
      <div className="mx-cesium" ref={hostRef} />
      {!ready && <div className="mx-cesium-loading">Initializing 3D Moon engine…</div>}
      {tileNotice && <div className="mx-tile-notice">{tileNotice}</div>}
    </div>
  )
})
