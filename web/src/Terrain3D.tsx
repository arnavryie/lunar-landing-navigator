import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  DEFAULT_THRESHOLDS,
  formatUtc,
  getSiteScienceStats,
  loadSite,
  timeAt,
  type Site,
  type SiteSummary,
  type Thresholds,
} from './data'
import { ARTEMIS_3_SITES, type ArtemisSiteData } from './data/artemisData'
import { Planner } from './Planner'
import { Timeline } from './Timeline'
import './styles/analysis.css'
import type { EllipseOverlay } from './Ellipse'
import { VCOLOR, VERDICT_COLOR } from './ellipseCheck'

// F6b: 3D south-pole terrain (80-90 S) with shadows from our own horizon physics, run on the GPU.
// Every terrain point steps across the real heightmap toward the Sun and toward Earth (3D rays,
// so the Moon's curvature is built in), exactly like pipeline/horizon.py. Not Three.js shadow maps.
// Scene units: km. Scene axes: X = map x (90 E side), Z = map down (180 side), Y = up at the pole.

const R_KM = 1737.4

export interface PsrZone {
  id: string
  name: string
  lat: number
  lon: number
  radiusKm: number
  depthM: number
  tempK: number
  iceTrapped: boolean
}

export const MAJOR_PSRS: PsrZone[] = [
  { id: 'shackleton', name: 'Shackleton Crater PSR', lat: -89.9, lon: 0.0, radiusKm: 10.5, depthM: 4200, tempK: 40, iceTrapped: true },
  { id: 'faustini', name: 'Faustini Crater PSR', lat: -87.3, lon: 77.0, radiusKm: 19.5, depthM: 3100, tempK: 55, iceTrapped: true },
  { id: 'shoemaker', name: 'Shoemaker Crater PSR', lat: -88.1, lon: 44.9, radiusKm: 25.5, depthM: 2800, tempK: 50, iceTrapped: true },
  { id: 'haworth', name: 'Haworth Crater PSR', lat: -87.4, lon: -5.1, radiusKm: 25.5, depthM: 3500, tempK: 40, iceTrapped: true },
  { id: 'cabeus', name: 'Cabeus (LCROSS Water Confirmed)', lat: -84.9, lon: -35.5, radiusKm: 48.0, depthM: 3200, tempK: 42, iceTrapped: true },
  { id: 'de-gerlache', name: 'de Gerlache Crater PSR', lat: -88.5, lon: -88.3, radiusKm: 16.0, depthM: 2500, tempK: 50, iceTrapped: true },
  { id: 'slater', name: 'Slater Crater PSR', lat: -88.1, lon: -110.8, radiusKm: 12.5, depthM: 2500, tempK: 45, iceTrapped: true },
  { id: 'amundsen', name: 'Amundsen Crater PSR', lat: -84.5, lon: 85.6, radiusKm: 51.0, depthM: 3000, tempK: 65, iceTrapped: true },
]

function surfaceDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180
  const phi1 = lat1 * rad
  const phi2 = lat2 * rad
  const dphi = (lat2 - lat1) * rad
  const dlambda = (lon2 - lon1) * rad
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2
  return 2 * R_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findNearestPsr(lat: number, lon: number): { psr: PsrZone; distanceKm: number } {
  let nearest = MAJOR_PSRS[0]
  let minD = Infinity
  for (const p of MAJOR_PSRS) {
    const d = surfaceDistanceKm(lat, lon, p.lat, p.lon)
    if (d < minD) {
      minD = d
      nearest = p
    }
  }
  return { psr: nearest, distanceKm: minD }
}

function createTextSprite(text: string, color = '#9fd3cf', bg = 'rgba(16, 15, 13, 0.9)') {
  const canvas = document.createElement('canvas')
  canvas.width = 340
  canvas.height = 70
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = bg
  if (ctx.roundRect) {
    ctx.roundRect(4, 4, 332, 62, 10)
  } else {
    ctx.rect(4, 4, 332, 62)
  }
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#f2efe8'
  ctx.font = 'bold 22px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 170, 35)

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  sprite.renderOrder = 999
  sprite.scale.set(16, 3.3, 1)
  return sprite
}

const VIS_RES = 1024
const base = `${import.meta.env.BASE_URL}data/map/`
const COLORS = { sun: '#c98419', earth: '#5590d8', both: '#1fa38a', none: '#383632' }

// Shared GLSL: heightmap lookup and the ray march (same geometry as horizon.py, coarser steps far out).
const MARCH = /* glsl */ `
uniform sampler2D uDem;   // heights in km above the 1737.4 km sphere, n x n, polar stereographic
uniform float uN, uScale, uR, uObs;
uniform vec3 uSun, uEarth; // km, Moon ME frame, from the Moon's centre (apparent)
// Work in colatitude (angle from the south pole): asin() near -90 deg loses precision in float32.
vec2 colatlonToUv(float colat, float lon) {
  float r = 2.0 * uR * tan(colat * 0.5);
  return vec2((0.5 * uN + r * sin(lon) / uScale) / uN, (0.5 * uN - r * cos(lon) / uScale) / uN);
}
float hAt(vec2 uv) {
  vec2 p = uv * uN - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = p - floor(p);
  if (i.x < 0 || i.y < 0 || i.x >= int(uN) - 1 || i.y >= int(uN) - 1) return -1e9;
  float a = texelFetch(uDem, i, 0).r, b = texelFetch(uDem, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uDem, i + ivec2(0, 1), 0).r, d = texelFetch(uDem, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Highest terrain angle above the ray from P along dir (radians). P sits r0 = uR + h0 + uObs from the
// Moon's centre. GPU length()/sqrt of ~1739 km values is only good to ~10 m, so the ray's rise above P is
// computed from small numbers instead: |P + t d| - r0 = (2 t P.d + t^2) / (|P + t d| + r0).
float terrainAbove(vec3 P, vec3 dir, float r0, float h0obs) {
  float best = -1.0;
  float pd = dot(P, dir);
  float t = 0.12;
  for (int k = 0; k < 700; k++) {
    float num = 2.0 * t * pd + t * t;
    float dr = num / (2.0 * r0);
    dr = num / (2.0 * r0 + dr);             // one refinement: exact to well under a metre
    if (h0obs + dr > 9.0) break;            // above every peak: nothing further can block
    vec3 Q = P + dir * t;
    float h = hAt(colatlonToUv(atan(length(Q.xy), -Q.z), atan(Q.y, Q.x)));
    if (h < -1e8) break;                    // left the terrain crop
    best = max(best, atan(h - h0obs - dr, t)); // (uR + h) - |Q|
    t += 0.12 + 0.004 * t;
  }
  return best;
}
float discFraction(float x) { x = clamp(x, -1.0, 1.0); return 1.0 - (acos(x) - x * sqrt(1.0 - x * x)) / 3.14159265; }
vec2 visibilityAt(float colat, float lon) {
  float h0obs = hAt(colatlonToUv(colat, lon)) + uObs;
  float r0 = uR + h0obs;
  vec3 P = r0 * vec3(sin(colat) * cos(lon), sin(colat) * sin(lon), -cos(colat));
  vec3 s = uSun - P, e = uEarth - P;
  float rs = asin(695700.0 / length(s)), re = asin(6378.137 / length(e));
  return vec2(discFraction(-terrainAbove(P, normalize(s), r0, h0obs) / rs),
              discFraction(-terrainAbove(P, normalize(e), r0, h0obs) / re));
}
`

const VIS_FRAG = /* glsl */ `
${MARCH}
uniform int uPointMode; uniform vec2 uPoint; // colatitude, lon (radians) for the single-point self-check
varying vec2 vUv;
void main() {
  float colat, lon;
  if (uPointMode == 1) { colat = uPoint.x; lon = uPoint.y; }
  else {
    float W = uN * uScale;
    float x = (vUv.x - 0.5) * W, y = (0.5 - vUv.y) * W;
    colat = 2.0 * atan(length(vec2(x, y)) / (2.0 * uR));
    lon = atan(x, y);
  }
  gl_FragColor = vec4(visibilityAt(colat, lon), 0.0, 1.0);
}`

const TERRAIN_VERT = /* glsl */ `
uniform sampler2D uDem; uniform float uW, uR, uExag;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(position.x / uW + 0.5, position.z / uW + 0.5);
  vUv = uv;
  float h = texture2D(uDem, uv).r;
  float d2 = position.x * position.x + position.z * position.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, h * uExag - d2 / (2.0 * uR), position.z, 1.0);
}`

const TERRAIN_FRAG = /* glsl */ `
uniform sampler2D uDem, uVis; uniform float uN, uScale, uExag;
uniform vec3 uSunC, uEarthC, uBothC, uNoneC;
varying vec2 vUv;
void main() {
  float px = 1.0 / uN;
  float hl = texture2D(uDem, vUv - vec2(px, 0.0)).r, hr = texture2D(uDem, vUv + vec2(px, 0.0)).r;
  float hu = texture2D(uDem, vUv - vec2(0.0, px)).r, hd = texture2D(uDem, vUv + vec2(0.0, px)).r;
  vec3 n = normalize(vec3(-(hr - hl) * uExag / (2.0 * uScale), 1.0, -(hd - hu) * uExag / (2.0 * uScale)));
  float shade = 0.35 + 0.65 * max(dot(n, normalize(vec3(-0.5, 0.8, -0.4))), 0.0); // relief only, for readability
  vec2 v = texture2D(uVis, vUv).rg;
  bool s = v.r > 0.004, e = v.g > 0.004;
  vec3 c = s && e ? uBothC : s ? uSunC : e ? uEarthC : uNoneC;
  if (s) c *= mix(0.6, 1.0, v.r); // partly visible Sun disc: dimmer
  gl_FragColor = vec4(c * shade, 1.0);
}`

interface World {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  visScene: THREE.Scene
  visCam: THREE.OrthographicCamera
  visMat: THREE.ShaderMaterial
  visRT: THREE.WebGLRenderTarget
  pointRT: THREE.WebGLRenderTarget
  terrainMat: THREE.ShaderMaterial
  marks: THREE.Group
  artemisGroup: THREE.Group
  vectors: Float32Array
  n: number
  scale: number
  heights: Float32Array
}

/** Scene position of a lat/lon on the terrain (stereographic map coords + height + curvature drop). */
function scenePos(w: World, lat: number, lon: number, exag: number) {
  const r = 2 * R_KM * Math.tan(((90 + lat) * Math.PI) / 360)
  const x = r * Math.sin((lon * Math.PI) / 180)
  const z = -r * Math.cos((lon * Math.PI) / 180)
  const c = w.n / 2 - 0.5
  const row = Math.round(c + z / w.scale)
  const col = Math.round(c + x / w.scale)
  const h = row >= 0 && col >= 0 && row < w.n && col < w.n ? w.heights[row * w.n + col] : 0
  return new THREE.Vector3(x, h * exag - (x * x + z * z) / (2 * R_KM), z)
}

/** Moon ME frame direction -> scene direction (proper rotation; scene up = away from the Moon at the pole). */
const meToScene = (d: number[]) => new THREE.Vector3(d[1], -d[2], -d[0]).normalize()

function directionFrom(w: World, i: number, body: 'sun' | 'earth', lat: number, lon: number, v: Float32Array = w.vectors) {
  const o = 6 * i + (body === 'sun' ? 0 : 3)
  const p = (lat * Math.PI) / 180
  const l = (lon * Math.PI) / 180
  const P = [R_KM * Math.cos(p) * Math.cos(l), R_KM * Math.cos(p) * Math.sin(l), R_KM * Math.sin(p)]
  return meToScene([v[o] - P[0], v[o + 1] - P[1], v[o + 2] - P[2]])
}

export interface Terrain3DProps {
  site: Site | null
  sites: SiteSummary[]
  i: number
  setI?: (i: number) => void
  planned?: number
  setPlanned?: (d: number) => void
  th?: Thresholds
  setTh?: (t: Thresholds) => void
  onPickPoint?: (lat: number, lon: number) => void
  onPickArtemisSite?: (a: ArtemisSiteData) => void
  onOpenSite?: () => void
  onFindAlternatives?: () => void
  ellipse?: EllipseOverlay | null // landing ellipse analysed on the Map
  vectors?: Float32Array | null // Any landing year: that year's Sun/Earth vectors (else the 2027 file)
}

export function Terrain3D({
  site,
  sites,
  i,
  setI,
  planned,
  setPlanned,
  th,
  setTh,
  onPickPoint,
  onPickArtemisSite,
  onOpenSite,
  onFindAlternatives,
  ellipse,
  vectors,
}: Terrain3DProps) {
  const host = useRef<HTMLDivElement>(null)
  const world = useRef<World | null>(null)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const [exag, setExag] = useState(1)
  const [check, setCheck] = useState('')
  type SideTab = 'artemis' | 'planner' | 'controls'
  const [sideTab, setSideTab] = useState<SideTab>('artemis')
  const [showScience, setShowScience] = useState(false)

  const [selectedArtemis, setSelectedArtemis] = useState<ArtemisSiteData | null>(() => {
    if (site) {
      const match = ARTEMIS_3_SITES.find(
        (a) => site.id === `artemis-${a.id}` || site.name.toLowerCase().includes(a.name.toLowerCase()),
      )
      if (match) return match
    }
    return ARTEMIS_3_SITES[0]
  })
  const currentExagRef = useRef(1)
  const animFrameRef = useRef<number | null>(null)

  const localTh = th ?? DEFAULT_THRESHOLDS
  const localSetTh = setTh ?? (() => {})
  const localPlanned = planned ?? 0
  const localSetPlanned = setPlanned ?? (() => {})
  const localSetI = setI ?? (() => {})

  // Synchronize selected Artemis region when site changes
  useEffect(() => {
    if (!site) return
    const match = ARTEMIS_3_SITES.find((a) => {
      if (site.id === `artemis-${a.id}`) return true
      if (site.name.toLowerCase().includes(a.name.toLowerCase())) return true
      const dLon = Math.abs((((a.lon - site.lon) % 360) + 540) % 360 - 180)
      return Math.hypot(a.lat - site.lat, dLon * Math.cos(((a.lat + site.lat) * 0.5 * Math.PI) / 180)) < 0.5
    })
    if (match) setSelectedArtemis(match)
  }, [site])

  // Build the scene once.
  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    ;(async () => {
      try {
        const meta = await (await fetch(base + 'meta.json')).json()
        const [demBuf, vecBuf] = await Promise.all([
          fetch(base + meta.dem.file),
          fetch(base + meta.vectors.file),
        ].map(async (r) => (await r).arrayBuffer()))
        if (disposed || !host.current) return
        const n: number = meta.dem.n
        const scale = meta.dem.scale_m / 1000
        const dn = new Int16Array(demBuf)
        const heights = new Float32Array(dn.length)
        for (let k = 0; k < dn.length; k++) heights[k] = dn[k] * 0.0005 // DN x 0.5 m -> km
        const W = n * scale

        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setClearColor('#0f0e0c')
        host.current.appendChild(renderer.domElement)
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = false

        const dem = new THREE.DataTexture(heights, n, n, THREE.RedFormat, THREE.FloatType)
        dem.minFilter = dem.magFilter = THREE.NearestFilter
        dem.needsUpdate = true
        const common = { uDem: { value: dem }, uN: { value: n }, uScale: { value: scale }, uR: { value: R_KM } }

        const visRT = new THREE.WebGLRenderTarget(VIS_RES, VIS_RES, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
        const pointRT = new THREE.WebGLRenderTarget(1, 1)
        const visMat = new THREE.ShaderMaterial({
          uniforms: {
            ...common,
            uObs: { value: 0.002 },
            uSun: { value: new THREE.Vector3() },
            uEarth: { value: new THREE.Vector3() },
            uPointMode: { value: 0 },
            uPoint: { value: new THREE.Vector2() },
          },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: VIS_FRAG,
        })
        const visScene = new THREE.Scene()
        visScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), visMat))
        const visCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

        const terrainMat = new THREE.ShaderMaterial({
          uniforms: {
            ...common,
            uVis: { value: visRT.texture },
            uW: { value: W },
            uExag: { value: 1 },
            uSunC: { value: new THREE.Color(COLORS.sun) },
            uEarthC: { value: new THREE.Color(COLORS.earth) },
            uBothC: { value: new THREE.Color(COLORS.both) },
            uNoneC: { value: new THREE.Color(COLORS.none) },
          },
          vertexShader: TERRAIN_VERT,
          fragmentShader: TERRAIN_FRAG,
        })
        const geo = new THREE.PlaneGeometry(W, W, 1023, 1023)
        geo.rotateX(-Math.PI / 2)
        scene.add(new THREE.Mesh(geo, terrainMat))
        const marks = new THREE.Group()
        scene.add(marks)
        const artemisGroup = new THREE.Group()
        scene.add(artemisGroup)

        const resize = () => {
          const el = host.current
          if (!el) return
          renderer.setSize(el.clientWidth, el.clientHeight)
          camera.aspect = el.clientWidth / el.clientHeight
          camera.updateProjectionMatrix()
          renderer.render(scene, camera)
        }
        const ro = new ResizeObserver(resize)
        ro.observe(host.current)
        controls.addEventListener('change', () => renderer.render(scene, camera))
        camera.position.set(0, 260, 330)
        controls.target.set(0, 0, 0)
        controls.update()
        world.current = {
          renderer,
          scene,
          camera,
          controls,
          visScene,
          visCam,
          visMat,
          visRT,
          pointRT,
          terrainMat,
          marks,
          artemisGroup,
          vectors: new Float32Array(vecBuf),
          n,
          scale,
          heights,
        }
        resize()
        setReady(true)
        cleanup = () => {
          if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current)
            animFrameRef.current = null
          }
          ro.disconnect()
          controls.dispose()
          renderer.dispose()
          renderer.domElement.remove()
        }
      } catch (e) {
        setErr(String((e as Error).message ?? e))
      }
    })()
    return () => {
      disposed = true
      cleanup()
      world.current = null
    }
  }, [])

  // Draw marker pin, sight rays, and science trade-off layers at current exaggeration.
  const drawMarksAndRender = (w: World, curExag: number) => {
    w.terrainMat.uniforms.uExag.value = curExag

    // Dispose old mark geometries and materials to keep GPU memory clean
    w.marks.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
        child.geometry?.dispose()
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
        else child.material?.dispose()
      }
    })
    w.marks.clear()

    // 1. Base solar & Earth sight rays from site
    if (site && site.lat <= -80.5) {
      const pos = scenePos(w, site.lat, site.lon, curExag)
      const pin = new THREE.Mesh(new THREE.SphereGeometry(ellipse ? 0.03 * ellipse.focus.km : 0.8), new THREE.MeshBasicMaterial({ color: '#ebe7dd' }))
      pin.position.copy(pos)
      w.marks.add(pin)
      for (const b of ['sun', 'earth'] as const) {
        const dir = directionFrom(w, i, b, site.lat, site.lon, vectors ?? w.vectors)
        const visible = site[b].frac[i] > 0
        const geo = new THREE.BufferGeometry().setFromPoints([pos, pos.clone().addScaledVector(dir, 60)])
        const mat = visible
          ? new THREE.LineBasicMaterial({ color: COLORS[b] })
          : new THREE.LineDashedMaterial({ color: '#e0705c', dashSize: 2, gapSize: 1.5 })
        const line = new THREE.Line(geo, mat)
        if (!visible) line.computeLineDistances()
        w.marks.add(line)
      }
    }

    // Render Artemis III candidate landing site zones & markers
    w.artemisGroup.clear()
    for (const a of ARTEMIS_3_SITES) {
      const p = scenePos(w, a.lat, a.lon, curExag)
      const isSel = selectedArtemis?.id === a.id

      // Circular landing zone ring (~15 km scale on terrain)
      const ringGeo = new THREE.RingGeometry(1.0, 1.4, 24)
      ringGeo.rotateX(-Math.PI / 2)
      const ringMat = new THREE.MeshBasicMaterial({
        color: isSel ? '#f2efe8' : '#cf86c3',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: isSel ? 0.95 : 0.65,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.set(p.x, p.y + 0.08, p.z)
      w.artemisGroup.add(ring)

      // Center diamond pin
      const diamondGeo = new THREE.OctahedronGeometry(isSel ? 0.9 : 0.6)
      const diamondMat = new THREE.MeshBasicMaterial({
        color: isSel ? '#f2efe8' : '#cf86c3',
      })
      const diamond = new THREE.Mesh(diamondGeo, diamondMat)
      diamond.position.set(p.x, p.y + 1.0, p.z)
      w.artemisGroup.add(diamond)
    }

    // 2. Science vs Engineering Lens (Mountains vs Ice)
    if (showScience) {
      // Draw all major cold trap PSR crater bowls (<110 K)
      for (const p of MAJOR_PSRS) {
        if (p.lat <= -80.5) {
          const pPos = scenePos(w, p.lat, p.lon, curExag)

          // Glowing cryogenic disc on crater floor
          const discGeo = new THREE.CircleGeometry(p.radiusKm, 32)
          discGeo.rotateX(-Math.PI / 2)
          const discMat = new THREE.MeshBasicMaterial({
            color: 0x9fd3cf,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
          const disc = new THREE.Mesh(discGeo, discMat)
          disc.position.copy(pPos)
          disc.position.y += 0.15 * curExag
          w.marks.add(disc)

          // Glowing ice perimeter ring
          const ringGeo = new THREE.RingGeometry(p.radiusKm * 0.94, p.radiusKm, 48)
          ringGeo.rotateX(-Math.PI / 2)
          const ringMat = new THREE.MeshBasicMaterial({
            color: 0x38ef7d,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
          })
          const ring = new THREE.Mesh(ringGeo, ringMat)
          ring.position.copy(pPos)
          ring.position.y += 0.2 * curExag
          w.marks.add(ring)

          // Center cryo beacon
          const beaconGeo = new THREE.CylinderGeometry(0.35, 0.35, 4 * curExag, 12)
          const beaconMat = new THREE.MeshBasicMaterial({ color: 0x9fd3cf, transparent: true, opacity: 0.85 })
          const beacon = new THREE.Mesh(beaconGeo, beaconMat)
          beacon.position.copy(pPos)
          beacon.position.y += 2 * curExag
          w.marks.add(beacon)

          // 3D Billboard label for crater cold trap (no emojis)
          const psrLabel = createTextSprite(`ICE PSR: ${p.name.replace(' Crater PSR', '')} (${p.tempK} K)`, '#9fd3cf')
          if (psrLabel) {
            psrLabel.position.copy(pPos)
            psrLabel.position.y += 5.5 * curExag
            w.marks.add(psrLabel)
          }
        }
      }

      // If a site near the south pole is selected, draw Traverse Corridor and Solar Engineering Halo
      if (site && site.lat <= -80.5) {
        const posSite = scenePos(w, site.lat, site.lon, curExag)
        const { psr, distanceKm } = findNearestPsr(site.lat, site.lon)

        // Solar Engineering Landing Crest (Golden Halo)
        const solarHaloGeo = new THREE.RingGeometry(1.6, 2.4, 32)
        solarHaloGeo.rotateX(-Math.PI / 2)
        const solarHaloMat = new THREE.MeshBasicMaterial({
          color: 0xffb74d,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        })
        const solarHalo = new THREE.Mesh(solarHaloGeo, solarHaloMat)
        solarHalo.position.copy(posSite)
        solarHalo.position.y += 0.25 * curExag
        w.marks.add(solarHalo)

        // Landing Ridge 3D Billboard (no emojis)
        const siteSprite = createTextSprite(`RIDGE: ${site.name}`, '#ffb74d', 'rgba(30, 20, 10, 0.9)')
        if (siteSprite) {
          siteSprite.position.copy(posSite)
          siteSprite.position.y += 4.5 * curExag
          w.marks.add(siteSprite)
        }

        // 3D Traverse Descent Laser Corridor from Ridge into Crater Floor
        const STEPS = 24
        const linePoints: THREE.Vector3[] = []
        for (let k = 0; k <= STEPS; k++) {
          const t = k / STEPS
          const l_lat = site.lat + (psr.lat - site.lat) * t
          const l_lon = site.lon + (psr.lon - site.lon) * t
          const p = scenePos(w, l_lat, l_lon, curExag)
          p.y += 0.3 * curExag // slight elevation clearance to hug topography cleanly
          linePoints.push(p)
        }

        const travGeo = new THREE.BufferGeometry().setFromPoints(linePoints)
        const travMat = new THREE.LineBasicMaterial({
          color: 0x00f5d4,
          linewidth: 3,
        })
        const travLine = new THREE.Line(travGeo, travMat)
        w.marks.add(travLine)

        // Midpoint Traverse Telemetry Badge (no emojis)
        const midIdx = Math.floor(STEPS / 2)
        const midPoint = linePoints[midIdx].clone()
        const travBadge = createTextSprite(`TRAVERSE: ${distanceKm.toFixed(1)} km (-${psr.depthM} m)`, '#00f5d4', 'rgba(21, 19, 15, 0.9)')
        if (travBadge) {
          travBadge.position.copy(midPoint)
          travBadge.position.y += 3.5 * curExag
          w.marks.add(travBadge)
        }
      }
    }

    // Landing ellipse from the Map tab: drawn on top of the terrain (no depth test) so ridges can't hide it.
    if (ellipse) {
      const onTop = <M extends THREE.Material>(m: M) => Object.assign(m, { depthTest: false, transparent: true })
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ellipse.outline.map((q) => scenePos(w, q.lat, q.lon, curExag))),
        onTop(new THREE.LineBasicMaterial({ color: ellipse.verdict ? VERDICT_COLOR[ellipse.verdict] : '#e4e1da' })),
      )
      ring.renderOrder = 10
      w.marks.add(ring)
      const ball = new THREE.SphereGeometry(Math.max(0.02, 0.015 * ellipse.focus.km))
      for (const d of ellipse.dots) {
        const m = new THREE.Mesh(ball, onTop(new THREE.MeshBasicMaterial({ color: VCOLOR[d.v] })))
        m.position.copy(scenePos(w, d.lat, d.lon, curExag))
        m.renderOrder = 11
        w.marks.add(m)
      }
    }

    w.renderer.render(w.scene, w.camera)
  }

  // Recompute visibility map on GPU when the hour/ephemeris time changes.
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    const v = vectors ?? w.vectors // Any landing year; the self-check below stays on the 2027 file it checks against
    const o = 6 * Math.min(i, v.length / 6 - 1)
    const u = w.visMat.uniforms
    u.uSun.value.set(v[o], v[o + 1], v[o + 2])
    u.uEarth.value.set(v[o + 3], v[o + 4], v[o + 5])
    u.uPointMode.value = 0
    w.renderer.setRenderTarget(w.visRT)
    w.renderer.render(w.visScene, w.visCam)
    w.renderer.setRenderTarget(null)

    drawMarksAndRender(w, currentExagRef.current)
  }, [i, site, ready, vectors])

  // Instant update when science lens toggles without triggering expensive GPU shadow raymarches
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    drawMarksAndRender(w, currentExagRef.current)
  }, [showScience, ellipse]) // eslint-disable-line react-hooks/exhaustive-deps

  // Smoothly animate vertical exaggeration transitions using a frame-rate-independent cubic ease-out.
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }

    const from = currentExagRef.current
    const to = exag

    if (Math.abs(from - to) < 0.005) {
      currentExagRef.current = to
      drawMarksAndRender(w, to)
      return
    }

    const start = performance.now()
    const duration = Math.min(360, Math.max(120, Math.abs(to - from) * 90))

    const step = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(1, elapsed / duration)
      const ease = 1 - Math.pow(1 - progress, 3)
      const val = from + (to - from) * ease
      currentExagRef.current = val
      drawMarksAndRender(w, val)

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step)
      } else {
        currentExagRef.current = to
        drawMarksAndRender(w, to)
        animFrameRef.current = null
      }
    }

    animFrameRef.current = requestAnimationFrame(step)
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
    }
  }, [exag, ready, site, i])

  const inspectArtemis = (siteData: ArtemisSiteData) => {
    setSelectedArtemis(siteData)
    const w = world.current
    if (!w) return
    const p = scenePos(w, siteData.lat, siteData.lon, currentExagRef.current)
    w.camera.position.set(p.x - 22, p.y + 16, p.z - 20)
    w.controls.target.copy(p)
    w.controls.update()
    drawMarksAndRender(w, currentExagRef.current)
  }

  const selectAndPlanArtemis = (siteData: ArtemisSiteData) => {
    inspectArtemis(siteData)
    if (onPickArtemisSite) {
      onPickArtemisSite(siteData)
    } else if (onPickPoint) {
      onPickPoint(siteData.lat, siteData.lon)
    }
  }

  const openPlannerForSite = (siteData: ArtemisSiteData) => {
    selectAndPlanArtemis(siteData)
    setSideTab('planner')
  }

  const preset = (k: 'overview' | 'overhead' | 'sun' | 'earth' | 'shackleton' | 'descent' | 'psr_bowl' | 'ellipse') => {
    const w = world.current
    if (!w) return
    const { camera, controls } = w
    camera.up.set(0, 1, 0)
    if (k === 'overview') {
      camera.position.set(0, 260, 330)
      controls.target.set(0, 0, 0)
    } else if (k === 'overhead') {
      camera.position.set(0, 720, 0.01)
      camera.up.set(0, 0, -1)
      controls.target.set(0, 0, 0)
    } else if (k === 'shackleton') {
      const p = scenePos(w, -89.67, 129.78, currentExagRef.current)
      camera.position.set(p.x - 30, p.y + 22, p.z - 26)
      controls.target.copy(p)
    } else if (k === 'ellipse') {
      if (!ellipse) return
      const p = scenePos(w, ellipse.focus.lat, ellipse.focus.lon, currentExagRef.current)
      const km = ellipse.focus.km
      camera.position.set(p.x + 1.1 * km, p.y + 0.9 * km, p.z + 1.1 * km)
      controls.target.copy(p)
    } else if (k === 'descent' && site && site.lat <= -80.5) {
      const pSite = scenePos(w, site.lat, site.lon, currentExagRef.current)
      const { psr } = findNearestPsr(site.lat, site.lon)
      const pPsr = scenePos(w, psr.lat, psr.lon, currentExagRef.current)
      const dir = new THREE.Vector3().subVectors(pPsr, pSite).normalize()
      camera.position.set(pSite.x - dir.x * 24, pSite.y + 16 * currentExagRef.current, pSite.z - dir.z * 24)
      controls.target.copy(pPsr)
    } else if (k === 'psr_bowl' && site && site.lat <= -80.5) {
      const { psr } = findNearestPsr(site.lat, site.lon)
      const pPsr = scenePos(w, psr.lat, psr.lon, currentExagRef.current)
      camera.position.set(pPsr.x - 20, pPsr.y + 12 * currentExagRef.current, pPsr.z - 20)
      controls.target.copy(pPsr)
    } else if ((k === 'sun' || k === 'earth') && site && site.lat <= -80.5) {
      const p = scenePos(w, site.lat, site.lon, currentExagRef.current).add(new THREE.Vector3(0, 0.05, 0))
      camera.position.copy(p)
      controls.target.copy(p.clone().addScaledVector(directionFrom(w, i, k, site.lat, site.lon, vectors ?? w.vectors), 30))
    }
    controls.update()
    w.renderer.render(w.scene, w.camera)
  }

  // Fly to a new landing ellipse once, when it first appears here.
  const ellipseAt = ellipse ? `${ellipse.focus.lat},${ellipse.focus.lon},${ellipse.focus.km}` : ''
  useEffect(() => {
    if (ready && ellipseAt) preset('ellipse')
  }, [ready, ellipseAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Self-check: shader visibility at curated sites vs the pipeline's hourly values.
  const runCheck = async () => {
    const w = world.current
    if (!w) return
    setCheck('Checking…')
    const hours = Array.from({ length: 24 }, (_, k) => k * 365) // every ~15 days across the year
    const ids = sites.filter((s) => s.lat <= -80.5 && s.kind !== 'custom').map((s) => s.id)
    let agree = 0
    let total = 0
    const misses: string[] = []
    const buf = new Uint8Array(4)
    const u = w.visMat.uniforms
    for (const id of ids) {
      const s = await loadSite(id)
      for (const h of hours) {
        const o = 6 * h
        u.uSun.value.set(w.vectors[o], w.vectors[o + 1], w.vectors[o + 2])
        u.uEarth.value.set(w.vectors[o + 3], w.vectors[o + 4], w.vectors[o + 5])
        u.uPointMode.value = 1
        u.uPoint.value.set(((90 + s.lat) * Math.PI) / 180, (s.lon * Math.PI) / 180)
        w.renderer.setRenderTarget(w.pointRT)
        w.renderer.render(w.visScene, w.visCam)
        w.renderer.readRenderTargetPixels(w.pointRT, 0, 0, 1, 1, buf)
        for (const [b, k] of [['sun', 0], ['earth', 1]] as const) {
          total++
          if (buf[k] > 0 === s[b].frac[h] > 0) agree++
          else misses.push(`${s.name}, ${formatUtc(timeAt(s, h))}, ${b}`)
        }
      }
    }
    w.renderer.setRenderTarget(null)
    u.uPointMode.value = 0
    setCheck(
      `${agree} of ${total} Sun/Earth visible-or-not values agree with the validated pipeline.${misses.length ? ' Differences: ' + misses.join('; ') : ''}`,
    )
  }

  return (
    <div className="terrain-3d-page" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="three-screen">
        <div className="three-wrap" ref={host}>
          {!ready && !err && <p className="loading three-msg">Loading terrain (about 13 MB, once)</p>}
          {err && <p className="error three-msg">3D view couldn't start: {err}</p>}
          <span className="three-label">
            {exag > 1 ? `Heights exaggerated ${exag.toFixed(1).replace(/\.0$/, '')}×, not to scale` : 'True vertical scale'}
          </span>
        </div>

        <aside className="map-side">
          {/* Sub-tab navigation inside the 3D sidebar */}
          <div className="seg views" style={{ width: '100%', marginBottom: '8px', display: 'flex' }}>
            <button
              type="button"
              aria-pressed={sideTab === 'artemis'}
              onClick={() => setSideTab('artemis')}
              style={{ fontSize: '0.74rem', padding: '5px 4px', flex: 1 }}
            >
              Artemis resources
            </button>
            <button
              type="button"
              aria-pressed={sideTab === 'planner'}
              onClick={() => setSideTab('planner')}
              style={{ fontSize: '0.74rem', padding: '5px 4px', flex: 1 }}
            >
              Site planner
            </button>
            <button
              type="button"
              aria-pressed={sideTab === 'controls'}
              onClick={() => setSideTab('controls')}
              style={{ fontSize: '0.74rem', padding: '5px 4px', flex: 1 }}
            >
              3D &amp; Lighting
            </button>
          </div>

          {/* TAB 1: ARTEMIS III RESOURCES */}
          {sideTab === 'artemis' && (
            <>
              <fieldset className="thresholds artemis-section" style={{ borderColor: 'rgba(207, 134, 195, 0.4)' }}>
                <legend style={{ color: '#cf86c3', fontWeight: 600 }}>Artemis III candidate regions</legend>
                <p className="chart-note" style={{ margin: '0 0 8px' }}>
                  NASA downselected 9 landing zones (Oct 2024). Click any site to fly camera in 3D and view resources:
                </p>
                <div className="slips" style={{ gap: '6px' }}>
                  {ARTEMIS_3_SITES.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      style={{
                        fontSize: '0.76rem',
                        padding: '4px 7px',
                        minWidth: 'auto',
                        borderColor: selectedArtemis?.id === a.id ? '#cf86c3' : undefined,
                        background: selectedArtemis?.id === a.id ? 'rgba(207, 134, 195, 0.22)' : undefined,
                        color: selectedArtemis?.id === a.id ? '#cf86c3' : undefined,
                        fontWeight: selectedArtemis?.id === a.id ? 600 : 400,
                      }}
                      onClick={() => selectAndPlanArtemis(a)}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>

                {selectedArtemis && (
                  <div
                    style={{
                      marginTop: '10px',
                      padding: '10px',
                      background: 'rgba(16, 15, 13, 0.85)',
                      border: '1px solid #cf86c3',
                      borderRadius: 'var(--radius-s)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div>
                        <h4 style={{ margin: '0 0 2px', fontSize: '0.92rem', color: '#cf86c3', fontWeight: 600 }}>{selectedArtemis.name}</h4>
                        <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                          {selectedArtemis.lat.toFixed(2)}° S, {Math.abs(selectedArtemis.lon).toFixed(1)}° {selectedArtemis.lon < 0 ? 'W' : 'E'} · Elev: ~+{selectedArtemis.elevation_km} km
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '2px 5px',
                          borderRadius: '3px',
                          fontWeight: 600,
                          background:
                            selectedArtemis.resources.water_ice_potential === 'Exceptional'
                              ? 'rgba(31, 163, 138, 0.25)'
                              : 'rgba(207, 134, 195, 0.2)',
                          color: selectedArtemis.resources.water_ice_potential === 'Exceptional' ? '#34d399' : '#cf86c3',
                          border: '1px solid currentColor',
                        }}
                      >
                        {selectedArtemis.resources.water_ice_potential} Ice
                      </span>
                    </div>

                    <p style={{ fontSize: '0.78rem', margin: '6px 0', lineHeight: 1.4 }}>{selectedArtemis.geology}</p>

                    <div style={{ margin: '6px 0', fontSize: '0.76rem' }}>
                      <strong style={{ color: '#e8e4da' }}>Mineral Composition:</strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '3px 0 4px' }}>
                        {selectedArtemis.minerals.primary.map((m) => (
                          <span
                            key={m}
                            style={{
                              background: 'rgba(255,255,255,0.08)',
                              padding: '2px 5px',
                              borderRadius: '3px',
                              fontSize: '0.7rem',
                            }}
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>{selectedArtemis.minerals.details}</div>
                    </div>

                    <div style={{ margin: '6px 0', fontSize: '0.76rem' }}>
                      <strong style={{ color: '#cf86c3' }}>Water ice and volatiles</strong>
                      <p style={{ margin: '2px 0 4px', color: '#c9c4b8' }}>{selectedArtemis.resources.water_ice_details}</p>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                        Depth: <strong>{selectedArtemis.resources.depth_estimate}</strong> · Volatiles: {selectedArtemis.resources.volatiles.join(', ')}
                      </div>
                    </div>

                    <div style={{ margin: '6px 0', fontSize: '0.76rem' }}>
                      <strong style={{ color: '#f2efe8' }}>In-situ resources (ISRU)</strong>
                      <p style={{ margin: '2px 0 4px', color: '#c9c4b8' }}>{selectedArtemis.resources.isru_applications}</p>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                        Elements: {selectedArtemis.resources.isru_elements.join(' · ')}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                      <button
                        type="button"
                        style={{
                          padding: '6px 10px',
                          fontSize: '0.78rem',
                          background: 'var(--ink)',
                          color: 'var(--sheet)',
                          border: 'none',
                          borderRadius: 'var(--radius-s)',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        onClick={() => openPlannerForSite(selectedArtemis)}
                      >
                        Plan landing windows for this region
                      </button>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          style={{
                            flex: 1,
                            padding: '5px 8px',
                            fontSize: '0.74rem',
                            background: 'rgba(255, 255, 255, 0.08)',
                            color: '#e8e4da',
                            border: '1px solid var(--rule)',
                            borderRadius: 'var(--radius-s)',
                            cursor: 'pointer',
                          }}
                          onClick={() => inspectArtemis(selectedArtemis)}
                        >
                          Fly camera here
                        </button>
                        <a
                          href="#artemis-3d-matrix"
                          style={{
                            flex: 1,
                            padding: '5px 8px',
                            fontSize: '0.74rem',
                            background: 'rgba(207, 134, 195, 0.1)',
                            color: '#cf86c3',
                            border: '1px solid rgba(207, 134, 195, 0.3)',
                            borderRadius: 'var(--radius-s)',
                            textAlign: 'center',
                            textDecoration: 'none',
                          }}
                        >
                          Comparison table
                        </a>
                      </div>
                      {onOpenSite && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                          <button
                            type="button"
                            style={{
                              flex: 1,
                              padding: '4px 6px',
                              fontSize: '0.7rem',
                              background: 'transparent',
                              color: 'var(--muted)',
                              border: '1px solid var(--rule)',
                              borderRadius: 'var(--radius-s)',
                              cursor: 'pointer',
                            }}
                            onClick={onOpenSite}
                          >
                            Open in Site and plan
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </fieldset>
            </>
          )}

          {/* TAB 2: SITE PLANNER */}
          {sideTab === 'planner' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {site ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: '#cf86c3', fontWeight: 600 }}>Active Site: {site.name}</span>
                    <button
                      type="button"
                      style={{ fontSize: '0.72rem', padding: '2px 6px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--rule)', borderRadius: '3px', cursor: 'pointer' }}
                      onClick={() => setSideTab('artemis')}
                    >
                      Change Site
                    </button>
                  </div>
                  <Planner
                    site={site}
                    i={i}
                    setI={localSetI}
                    planned={localPlanned}
                    setPlanned={localSetPlanned}
                    th={localTh}
                    setTh={localSetTh}
                    onFindAlternatives={onFindAlternatives}
                  />
                </div>
              ) : (
                <div className="pick-box">
                  <p>Calculating 2027 orbital illumination &amp; terrain horizon for the selected site...</p>
                  <button
                    type="button"
                    style={{ marginTop: '8px', padding: '6px 10px', fontSize: '0.76rem', background: 'var(--ink)', color: 'var(--sheet)', border: 'none', borderRadius: 'var(--radius-s)' }}
                    onClick={() => setSideTab('artemis')}
                  >
                    Select an Artemis III region
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: 3D CONTROLS & LIGHTING */}
          {sideTab === 'controls' && (
            <>
              {/* Science vs Engineering 3D Lens Toggle & Telemetry */}
              <div className="science-3d-card" style={{ marginBottom: '14px' }}>
                <div className="science-3d-header">
                  <div>
                    <span className="science-3d-title">Science Lens: Ridge vs. Cold Trap</span>
                    <span className="science-3d-subtitle">Mountains vs. Volatile Ice Traps</span>
                  </div>
                  <button
                    type="button"
                    className={`science-toggle-pill ${showScience ? 'active' : ''}`}
                    onClick={() => setShowScience((v) => !v)}
                    aria-pressed={showScience}
                    title="Toggle 3D Cryogenic Cold Traps & Traverse Corridors"
                  >
                    {showScience ? 'Science layer on' : 'Science layer off'}
                  </button>
                </div>

                <p className="science-3d-desc">
                  {showScience
                    ? 'Visualizing cold trap water ice (<110 K PSRs), illuminated ridges, and rim-to-floor descent trajectories.'
                    : 'Toggle ON to visualize crater cold traps, volatile ice reservoirs, and landing-to-ice traverse vectors.'}
                </p>

                {showScience && site && site.lat <= -80.5 && (() => {
                  const scienceStats = getSiteScienceStats(site)
                  const { psr, distanceKm } = findNearestPsr(site.lat, site.lon)
                  return (
                    <div className="science-3d-telemetry">
                      <div className="telemetry-item">
                        <span className="telemetry-lbl">Target PSR:</span>
                        <span className="telemetry-val highlight">{psr.name.replace(' Crater PSR', '')}</span>
                      </div>
                      <div className="telemetry-item">
                        <span className="telemetry-lbl">Traverse Dist:</span>
                        <span className="telemetry-val">{distanceKm.toFixed(1)} km</span>
                      </div>
                      <div className="telemetry-item">
                        <span className="telemetry-lbl">Crater Depth:</span>
                        <span className="telemetry-val depth">-{psr.depthM.toLocaleString()} m</span>
                      </div>
                      <div className="telemetry-item">
                        <span className="telemetry-lbl">Cryo Temp:</span>
                        <span className="telemetry-val cryo">{psr.tempK} K (-{273 - psr.tempK}°C)</span>
                      </div>
                      <div className="telemetry-item full">
                        <span className="telemetry-lbl">Zone Verdict:</span>
                        <span className={`tradeoff-chip chip-${scienceStats.zone}`}>{scienceStats.zoneLabel}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div className="legend three-legend">
                {(['sun', 'earth', 'both', 'none'] as const).map((k) => (
                  <span key={k}>
                    <span className={`swatch st-${k}`} aria-hidden="true" />
                    {k === 'sun' ? 'Sunlit' : k === 'earth' ? 'Earth in view' : k === 'both' ? 'Both' : 'Neither'}
                  </span>
                ))}
              </div>
              <p className="chart-note">
                Colours are computed, not drawn: each point steps across the real terrain toward the Sun and Earth at the selected
                time, with the Moon's curvature. Grey relief shading is only for readability.
              </p>
              <label className="field exag">
                <span>Vertical exaggeration</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={0.1}
                  value={exag}
                  aria-label="Vertical exaggeration"
                  onChange={(e) => setExag(Number(e.target.value))}
                />
                <span className="unit">{exag.toFixed(1).replace(/\.0$/, '')}×</span>
              </label>
              <div className="seg" style={{ marginTop: '6px', marginBottom: '14px' }}>
                {[1, 1.5, 2, 3, 5].map((val) => (
                  <button
                    key={val}
                    type="button"
                    aria-pressed={exag === val}
                    title={val === 1 ? 'True vertical scale' : undefined}
                    onClick={() => setExag(val)}
                  >
                    {val === 1 ? '1× true' : `${val}×`}
                  </button>
                ))}
              </div>
              <fieldset className="thresholds">
                <legend>Camera</legend>
                <div className="slips">
                  <button onClick={() => preset('overview')}>Overview</button>
                  <button onClick={() => preset('overhead')}>Overhead</button>
                  <button onClick={() => preset('shackleton')}>Over Shackleton</button>
                  <button disabled={!ellipse} onClick={() => preset('ellipse')}>Over the landing ellipse</button>
                  <button disabled={!site || site.lat > -80.5} onClick={() => preset('sun')}>
                    From site, look at Sun
                  </button>
                  <button disabled={!site || site.lat > -80.5} onClick={() => preset('earth')}>
                    Look at Earth
                  </button>
                </div>
                <p className="chart-note">Drag to rotate, right-drag to pan, scroll to zoom.</p>
              </fieldset>
              <div className="pick-box">
                {site && site.lat <= -80.5 ? (
                  <p>
                    <strong>{site.name}</strong>: lines to the Sun and Earth; solid when visible, red dashed when blocked by terrain.
                    {ellipse && (
                      <>
                        {' '}
                        Landing ellipse from the Map: {ellipse.dots.length ? 'green = viable, amber = marginal, red = not viable for the mission; the outline takes the overall verdict colour' : 'outline only; press "Analyse ellipse" on the Map to colour its points'}.
                      </>
                    )}
                  </p>
                ) : (
                  <p className="muted">The selected site is outside 80–90° S, so it isn't shown here. Pick a polar site or click the Map.</p>
                )}
              </div>
              <div>
                <button onClick={runCheck} disabled={!ready}>
                  Check shadows against the pipeline
                </button>
                {check && <p className="chart-note">{check}</p>}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Interactive 2027 Sun & Earth Availability Timeline (scrubs hour i and updates 3D GPU raymarched shadows) */}
      {site && (
        <section className="panel" aria-label="Interactive 2027 Availability Timeline">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.96rem', color: '#e8e4da' }}>
                Sun and Earth availability
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--muted)' }}>
                Click or drag anywhere along the timeline to rotate Sun &amp; Earth vectors and sweep GPU shadows across the 3D terrain.
              </p>
            </div>
            <span style={{ fontSize: '0.76rem', color: '#cf86c3' }}>
              Active Site: <strong>{site.name}</strong>
            </span>
          </div>
          <Timeline site={site} i={i} onPick={localSetI} />
        </section>
      )}

      {/* Full-width Landing Date Planner (if site loaded and sideTab is not already showing it) */}
      {site && sideTab !== 'planner' && (
        <section className="panel" aria-label="Landing Date Planner Calendar">
          <Planner
            site={site}
            i={i}
            setI={localSetI}
            planned={localPlanned}
            setPlanned={localSetPlanned}
            th={localTh}
            setTh={localSetTh}
            onFindAlternatives={onFindAlternatives}
          />
        </section>
      )}

      {/* Artemis III Candidate Landing Regions Comparative Resource Matrix */}
      <section
        id="artemis-3d-matrix"
        className="panel"
        style={{ borderColor: 'rgba(207, 134, 195, 0.35)' }}
        aria-label="Artemis III Comparative Resource Matrix"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', color: '#f2efe8', fontWeight: 600 }}>
              Artemis III candidate regions: resources and minerals
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
              Comprehensive on-site mineralogy, water-ice cold trap depth, cryogenic volatiles, and lander ISRU utility across all 9 regions.
            </p>
          </div>
          <button
            type="button"
            style={{
              padding: '5px 10px',
              fontSize: '0.74rem',
              background: 'rgba(207, 134, 195, 0.15)',
              color: '#cf86c3',
              border: '1px solid rgba(207, 134, 195, 0.4)',
              borderRadius: 'var(--radius-s)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            Back to the 3D view
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.78rem',
              color: '#c9c4b8',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 10px' }}>Region name</th>
                <th style={{ padding: '8px 10px' }}>Lat / lon</th>
                <th style={{ padding: '8px 10px' }}>Elev.</th>
                <th style={{ padding: '8px 10px' }}>Water ice potential</th>
                <th style={{ padding: '8px 10px' }}>Depth estimate</th>
                <th style={{ padding: '8px 10px' }}>Primary minerals</th>
                <th style={{ padding: '8px 10px' }}>Lander ISRU utility</th>
                <th style={{ padding: '8px 10px' }}>3D Action</th>
              </tr>
            </thead>
            <tbody>
              {ARTEMIS_3_SITES.map((a) => {
                const isSelected = selectedArtemis?.id === a.id
                return (
                  <tr
                    key={a.id}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                      background: isSelected ? 'rgba(207, 134, 195, 0.08)' : undefined,
                    }}
                  >
                    <td style={{ padding: '10px 10px', fontWeight: 600, color: isSelected ? '#cf86c3' : '#f2efe8' }}>
                      {a.name}
                    </td>
                    <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                      {Math.abs(a.lat).toFixed(2)}° S, {Math.abs(a.lon).toFixed(1)}° {a.lon < 0 ? 'W' : 'E'}
                    </td>
                    <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                      +{a.elevation_km} km
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontWeight: 600,
                          background:
                            a.resources.water_ice_potential === 'Exceptional'
                              ? 'rgba(34, 197, 94, 0.2)'
                              : a.resources.water_ice_potential === 'Very High'
                              ? 'rgba(207, 134, 195, 0.2)'
                              : a.resources.water_ice_potential === 'Strategic'
                              ? 'rgba(242, 239, 232, 0.2)'
                              : 'rgba(168, 85, 247, 0.2)',
                          color:
                            a.resources.water_ice_potential === 'Exceptional'
                              ? '#4ade80'
                              : a.resources.water_ice_potential === 'Very High'
                              ? '#cf86c3'
                              : a.resources.water_ice_potential === 'Strategic'
                              ? '#f2efe8'
                              : '#c084fc',
                        }}
                      >
                        {a.resources.water_ice_potential}
                      </span>
                    </td>
                    <td style={{ padding: '10px 10px' }}>{a.resources.depth_estimate}</td>
                    <td style={{ padding: '10px 10px' }}>{a.minerals.primary.slice(0, 2).join(', ')}</td>
                    <td style={{ padding: '10px 10px', maxWidth: '240px' }}>{a.resources.isru_applications}</td>
                    <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        style={{
                          padding: '4px 8px',
                          fontSize: '0.72rem',
                          background: isSelected ? 'var(--ink)' : 'rgba(255,255,255,0.06)',
                          color: isSelected ? 'var(--sheet)' : 'var(--ink)',
                          border: isSelected ? 'none' : '1px solid var(--rule)',
                          borderRadius: 'var(--radius-s)',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        onClick={() => {
                          selectAndPlanArtemis(a)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        Fly there in 3D
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
