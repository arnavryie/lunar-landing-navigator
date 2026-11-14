import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { formatUtc, loadSite, timeAt, type Site, type SiteSummary } from './data'
import type { EllipseOverlay } from './Ellipse'
import { VCOLOR, VERDICT_COLOR } from './ellipseCheck'

// F6b: 3D south-pole terrain (80-90 S) with shadows from our own horizon physics, run on the GPU.
// Every terrain point steps across the real heightmap toward the Sun and toward Earth (3D rays,
// so the Moon's curvature is built in), exactly like pipeline/horizon.py. Not Three.js shadow maps.
// Scene units: km. Scene axes: X = map x (90 E side), Z = map down (180 side), Y = up at the pole.

const R_KM = 1737.4
const VIS_RES = 1024
const base = `${import.meta.env.BASE_URL}data/map/`
const COLORS = { sun: '#c98419', earth: '#5590d8', both: '#1fa38a', none: '#30363e' }

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

function directionFrom(w: World, i: number, body: 'sun' | 'earth', lat: number, lon: number) {
  const o = 6 * i + (body === 'sun' ? 0 : 3)
  const p = (lat * Math.PI) / 180
  const l = (lon * Math.PI) / 180
  const P = [R_KM * Math.cos(p) * Math.cos(l), R_KM * Math.cos(p) * Math.sin(l), R_KM * Math.sin(p)]
  return meToScene([w.vectors[o] - P[0], w.vectors[o + 1] - P[1], w.vectors[o + 2] - P[2]])
}

export function Terrain3D({ site, sites, i, ellipse }: { site: Site | null; sites: SiteSummary[]; i: number; ellipse?: EllipseOverlay | null }) {
  const host = useRef<HTMLDivElement>(null)
  const world = useRef<World | null>(null)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const [exag, setExag] = useState(1)
  const [check, setCheck] = useState('')

  // Build the scene once.
  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    ;(async () => {
      try {
        const meta = await (await fetch(base + 'meta.json')).json()
        const [demBuf, vecBuf] = await Promise.all([fetch(base + meta.dem.file), fetch(base + meta.vectors.file)].map(async (r) => (await r).arrayBuffer()))
        if (disposed || !host.current) return
        const n: number = meta.dem.n
        const scale = meta.dem.scale_m / 1000
        const dn = new Int16Array(demBuf)
        const heights = new Float32Array(dn.length)
        for (let k = 0; k < dn.length; k++) heights[k] = dn[k] * 0.0005 // DN x 0.5 m -> km
        const W = n * scale

        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setClearColor('#111418')
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
          uniforms: { ...common, uObs: { value: 0.002 }, uSun: { value: new THREE.Vector3() }, uEarth: { value: new THREE.Vector3() }, uPointMode: { value: 0 }, uPoint: { value: new THREE.Vector2() } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: VIS_FRAG,
        })
        const visScene = new THREE.Scene()
        visScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), visMat))
        const visCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

        const terrainMat = new THREE.ShaderMaterial({
          uniforms: {
            ...common, uVis: { value: visRT.texture }, uW: { value: W }, uExag: { value: 1 },
            uSunC: { value: new THREE.Color(COLORS.sun) }, uEarthC: { value: new THREE.Color(COLORS.earth) },
            uBothC: { value: new THREE.Color(COLORS.both) }, uNoneC: { value: new THREE.Color(COLORS.none) },
          },
          vertexShader: TERRAIN_VERT,
          fragmentShader: TERRAIN_FRAG,
        })
        const geo = new THREE.PlaneGeometry(W, W, 1023, 1023)
        geo.rotateX(-Math.PI / 2)
        scene.add(new THREE.Mesh(geo, terrainMat))
        const marks = new THREE.Group()
        scene.add(marks)

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
        world.current = { renderer, scene, camera, controls, visScene, visCam, visMat, visRT, pointRT, terrainMat, marks, vectors: new Float32Array(vecBuf), n, scale, heights }
        resize()
        setReady(true)
        cleanup = () => {
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

  // Recompute visibility when the time changes; redraw pin and rays.
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    const v = w.vectors
    const o = 6 * Math.min(i, v.length / 6 - 1)
    const u = w.visMat.uniforms
    u.uSun.value.set(v[o], v[o + 1], v[o + 2])
    u.uEarth.value.set(v[o + 3], v[o + 4], v[o + 5])
    u.uPointMode.value = 0
    w.terrainMat.uniforms.uExag.value = exag
    w.renderer.setRenderTarget(w.visRT)
    w.renderer.render(w.visScene, w.visCam)
    w.renderer.setRenderTarget(null)

    w.marks.clear()
    if (site && site.lat <= -80.5) {
      const pos = scenePos(w, site.lat, site.lon, exag)
      const pin = new THREE.Mesh(new THREE.SphereGeometry(ellipse ? 0.03 * ellipse.focus.km : 0.8), new THREE.MeshBasicMaterial({ color: '#d9d6cf' }))
      pin.position.copy(pos)
      w.marks.add(pin)
      for (const b of ['sun', 'earth'] as const) {
        const dir = directionFrom(w, i, b, site.lat, site.lon)
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
    // Landing ellipse from the Map tab: drawn on top of the terrain (no depth test) so ridges can't hide it.
    if (ellipse) {
      const onTop = <M extends THREE.Material>(m: M) => Object.assign(m, { depthTest: false, transparent: true })
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ellipse.outline.map((q) => scenePos(w, q.lat, q.lon, exag))),
        onTop(new THREE.LineBasicMaterial({ color: ellipse.verdict ? VERDICT_COLOR[ellipse.verdict] : '#e4e1da' })),
      )
      ring.renderOrder = 10
      w.marks.add(ring)
      const ball = new THREE.SphereGeometry(Math.max(0.02, 0.015 * ellipse.focus.km))
      for (const d of ellipse.dots) {
        const m = new THREE.Mesh(ball, onTop(new THREE.MeshBasicMaterial({ color: VCOLOR[d.v] })))
        m.position.copy(scenePos(w, d.lat, d.lon, exag))
        m.renderOrder = 11
        w.marks.add(m)
      }
    }
    w.renderer.render(w.scene, w.camera)
  }, [i, site, exag, ready, ellipse])

  const preset = (k: 'overview' | 'overhead' | 'sun' | 'earth' | 'shackleton' | 'ellipse') => {
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
      const p = scenePos(w, -89.67, 129.78, exag)
      camera.position.set(p.x - 30, p.y + 22, p.z - 26)
      controls.target.copy(p)
    } else if (k === 'ellipse') {
      if (!ellipse) return
      const p = scenePos(w, ellipse.focus.lat, ellipse.focus.lon, exag)
      const km = ellipse.focus.km
      camera.position.set(p.x + 1.1 * km, p.y + 0.9 * km, p.z + 1.1 * km)
      controls.target.copy(p)
    } else if (site && site.lat <= -80.5) {
      const p = scenePos(w, site.lat, site.lon, exag).add(new THREE.Vector3(0, 0.05, 0))
      camera.position.copy(p)
      controls.target.copy(p.clone().addScaledVector(directionFrom(w, i, k, site.lat, site.lon), 30))
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
    setCheck(`${agree} of ${total} Sun/Earth visible-or-not values agree with the validated pipeline.${misses.length ? ' Differences: ' + misses.join('; ') : ''}`)
  }

  return (
    <div className="three-screen">
      <div className="three-wrap" ref={host}>
        {!ready && !err && <p className="loading three-msg">Loading terrain (about 13 MB, once)</p>}
        {err && <p className="error three-msg">3D view couldn't start: {err}</p>}
        <span className="three-label">{exag > 1 ? `Heights exaggerated ${exag}×, not to scale` : 'True vertical scale'}</span>
      </div>
      <aside className="map-side">
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
          <input type="range" min={1} max={5} step={0.5} value={exag} aria-label="Vertical exaggeration" onChange={(e) => setExag(Number(e.target.value))} />
          <span className="unit">{exag}×</span>
        </label>
        <fieldset className="thresholds">
          <legend>Camera</legend>
          <div className="slips">
            <button onClick={() => preset('overview')}>Overview</button>
            <button onClick={() => preset('overhead')}>Overhead</button>
            <button onClick={() => preset('shackleton')}>Over Shackleton</button>
            <button disabled={!ellipse} onClick={() => preset('ellipse')}>Over the landing ellipse</button>
            <button disabled={!site || site.lat > -80.5} onClick={() => preset('sun')}>From the site, look at the Sun</button>
            <button disabled={!site || site.lat > -80.5} onClick={() => preset('earth')}>Look at Earth</button>
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
      </aside>
    </div>
  )
}
