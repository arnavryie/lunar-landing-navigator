import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { ARTEMIS_NOTE, STATE_LABEL, loadArtemis, stateAt, type Region, type Site, type SiteSummary } from './data'
import { ARTEMIS_3_SITES, type ArtemisSiteData } from './data/artemisData'

// F6c: whole-Moon globe. Lit from the true Sun direction for the selected hour (same Skyfield vectors as
// the Map and 3D views). Colour: NASA CGI Moon Kit (LROC). Relief: normals from our LOLA LDEM_16.
// Scene units: Moon radii. Scene axes from the Moon ME frame: X = x, Y = z (north up), Z = -y.

const R_KM = 1737.4
const base = import.meta.env.BASE_URL
const COLORS = { sun: '#c98419', earth: '#5590d8', both: '#1fa38a', none: '#4a515a' }
const meToScene = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y)
const D2R = Math.PI / 180

const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vMe;
void main() {
  vUv = uv;
  vMe = vec3(position.x, -position.z, position.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// Lunar-Lambert lighting (half Lambert, half Lommel-Seeliger: the full Moon has little limb darkening),
// on relief normals. Terrain shadows are NOT cast here; the 3D terrain view computes those.
const FRAG = /* glsl */ `
uniform sampler2D uColor, uRelief; uniform vec3 uSun, uCam; uniform float uRel, uNight;
varying vec2 vUv; varying vec3 vMe;
void main() {
  vec3 up = normalize(vMe);
  float lon = atan(up.y, up.x);
  vec3 east = vec3(-sin(lon), cos(lon), 0.0);
  vec3 north = cross(up, east);
  vec3 r = texture2D(uRelief, vUv).rgb * 2.0 - 1.0;
  vec3 n = normalize(uRel * (r.x * east + r.y * north) + r.z * up);
  float ci = max(dot(n, uSun), 0.0) * smoothstep(-0.01, 0.01, dot(up, uSun));
  float ce = max(dot(n, normalize(uCam - up)), 0.0);
  float L = mix(ci, 2.0 * ci / (ci + ce + 1e-4), 0.5);
  vec3 albedo = pow(texture2D(uColor, vUv).rgb, vec3(2.2));
  gl_FragColor = vec4(pow(albedo * (1.15 * L + uNight), vec3(1.0 / 2.2)), 1.0);
}`

interface World {
  renderer: THREE.WebGLRenderer
  labels: CSS2DRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  moonMat: THREE.ShaderMaterial
  sun: THREE.Mesh
  earth: THREE.Mesh
  light: THREE.DirectionalLight
  rays: THREE.Group
  markers: THREE.Group
  vectors: Float32Array
  draw: () => void
}

const unitAt = (lat: number, lon: number) =>
  meToScene(Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R))

function label(text: string, cls = '') {
  const el = document.createElement('div')
  el.className = `globe-label ${cls}`
  el.textContent = text
  return new CSS2DObject(el)
}

/** Sub-point (lat, lon in deg) of a Moon-centred ME vector: where that body is straight overhead. */
function subPoint(v: Float32Array, o: number) {
  const [x, y, z] = [v[o], v[o + 1], v[o + 2]]
  return { lat: Math.asin(z / Math.hypot(x, y, z)) / D2R, lon: Math.atan2(y, x) / D2R }
}
const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}° ${v < 0 ? 'S' : 'N'}`
const fmtLon = (v: number) => `${Math.abs(v).toFixed(1)}° ${v < 0 ? 'W' : 'E'}`

export function Globe({
  site,
  sites,
  i,
  onPickSite,
  onOpen3D,
  onOpenSite,
  onOpenArtemis,
  onPickPoint,
}: {
  site: Site | null
  sites: SiteSummary[]
  i: number
  onPickSite: (id: string) => void
  onOpen3D: () => void
  onOpenSite?: () => void
  onOpenArtemis?: () => void
  onPickPoint?: (lat: number, lon: number) => void
}) {
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedArtemis, setSelectedArtemis] = useState<ArtemisSiteData | null>(null)
  useEffect(() => {
    loadArtemis().then(setRegions, () => setRegions([]))
  }, [])
  const host = useRef<HTMLDivElement>(null)
  const world = useRef<World | null>(null)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const [relief, setRelief] = useState(1)
  const pick = useRef(onPickSite)
  pick.current = onPickSite

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    ;(async () => {
      try {
        const loader = new THREE.TextureLoader()
        const [color, reliefTex, vecBuf] = await Promise.all([
          loader.loadAsync(base + 'data/globe/lroc_color_2k.jpg'),
          loader.loadAsync(base + 'data/globe/relief.png'),
          fetch(base + 'data/map/vectors_2027.f32').then((r) => r.arrayBuffer()),
        ])
        if (disposed || !host.current) return
        for (const t of [color, reliefTex]) t.anisotropy = 4

        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setClearColor('#07090c')
        host.current.appendChild(renderer.domElement)
        const labels = new CSS2DRenderer()
        labels.domElement.className = 'globe-labels'
        host.current.appendChild(labels.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enablePan = false
        controls.minDistance = 1.08
        controls.maxDistance = 16

        const moonMat = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: color }, uRelief: { value: reliefTex }, uSun: { value: new THREE.Vector3(1, 0, 0) },
            uCam: { value: new THREE.Vector3() }, uRel: { value: 1 }, uNight: { value: 0.035 },
          },
          vertexShader: VERT,
          fragmentShader: FRAG,
        })
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), moonMat))

        // 80 S ring: the area the Map and 3D terrain views cover.
        const ring = Array.from({ length: 181 }, (_, k) => unitAt(-80, k * 2).multiplyScalar(1.001))
        const ringLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineDashedMaterial({ color: '#d9d6cf', dashSize: 0.01, gapSize: 0.008, transparent: true, opacity: 0.6 }))
        ringLine.computeLineDistances()
        scene.add(ringLine)

        // Sun and Earth reference models: directions true, sizes and distances NOT to scale.
        const light = new THREE.DirectionalLight('#ffffff', 2.2)
        scene.add(light, new THREE.AmbientLight('#ffffff', 0.04))
        const sun = new THREE.Mesh(new THREE.SphereGeometry(0.32, 32, 16), new THREE.MeshBasicMaterial({ color: '#ffd98a' }))
        sun.add(label('Sun', 'is-sun'))
        const earth = new THREE.Mesh(new THREE.SphereGeometry(0.36, 48, 24), new THREE.MeshLambertMaterial({ color: COLORS.earth }))
        earth.add(label('Earth', 'is-earth'))
        const rays = new THREE.Group()
        const markers = new THREE.Group()
        scene.add(sun, earth, rays, markers)

        const draw = () => {
          moonMat.uniforms.uCam.value.set(camera.position.x, -camera.position.z, camera.position.y)
          const alt = camera.position.length() - 1
          controls.rotateSpeed = Math.min(1, Math.max(0.04, alt * 0.6))
          for (const b of [sun, earth]) // hide a model when the camera is behind it, looking at the Moon
            b.visible = !(camera.position.length() > b.position.length() - 0.6 && camera.position.clone().normalize().dot(b.position.clone().normalize()) > 0.98)
          for (const m of markers.children) {
            if (m instanceof THREE.Mesh) m.scale.setScalar(Math.min(1, Math.max(0.1, alt / 3.2))) // ~constant on-screen size
            else m.visible = m.position.dot(camera.position.clone().sub(m.position)) > 0 && (!m.userData.region || alt < 0.45) // far side hidden; region names only when zoomed in
          }
          renderer.render(scene, camera)
          labels.render(scene, camera)
        }
        const resize = () => {
          const el = host.current
          if (!el) return
          renderer.setSize(el.clientWidth, el.clientHeight)
          labels.setSize(el.clientWidth, el.clientHeight)
          camera.aspect = el.clientWidth / el.clientHeight
          camera.updateProjectionMatrix()
          draw()
        }
        const ro = new ResizeObserver(resize)
        ro.observe(host.current)
        controls.addEventListener('change', draw)

        // Click a marker to select that site (ignore drags).
        let down: [number, number] | null = null
        const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY])
        const onUp = (e: PointerEvent) => {
          if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return
          const rect = renderer.domElement.getBoundingClientRect()
          // Nearest front-facing marker within 12 px on screen (markers are only a few pixels across).
          let best = 12
          let id = ''
          for (const m of markers.children) {
            if (!m.userData.id || m.position.dot(camera.position.clone().sub(m.position)) <= 0) continue
            const q = m.position.clone().project(camera)
            const d = Math.hypot(rect.left + ((q.x + 1) / 2) * rect.width - e.clientX, rect.top + ((1 - q.y) / 2) * rect.height - e.clientY)
            if (d < best) [best, id] = [d, m.userData.id]
          }
          if (id) pick.current(id)
        }
        renderer.domElement.addEventListener('pointerdown', onDown)
        renderer.domElement.addEventListener('pointerup', onUp)

        camera.position.copy(unitAt(-35, 20).multiplyScalar(4))
        controls.update()
        world.current = { renderer, labels, scene, camera, controls, moonMat, sun, earth, light, rays, markers, vectors: new Float32Array(vecBuf), draw }
        resize()
        setReady(true)
        cleanup = () => {
          ro.disconnect()
          controls.dispose()
          renderer.dispose()
          renderer.domElement.remove()
          labels.domElement.remove()
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

  // Time, site and relief changes: move the Sun, Earth and markers; redraw.
  const o = 6 * i
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    const v = w.vectors
    const k = 6 * Math.min(i, v.length / 6 - 1)
    const sunDir = meToScene(v[k], v[k + 1], v[k + 2]).normalize()
    const earthDir = meToScene(v[k + 3], v[k + 4], v[k + 5]).normalize()
    w.moonMat.uniforms.uSun.value.set(sunDir.x, -sunDir.z, sunDir.y)
    w.moonMat.uniforms.uRel.value = relief
    w.sun.position.copy(sunDir).multiplyScalar(4)
    w.earth.position.copy(earthDir).multiplyScalar(3)
    w.light.position.copy(sunDir)

    for (const g of [w.markers, w.rays]) {
      g.traverse((x) => {
        if (x instanceof THREE.Mesh || x instanceof THREE.Line) {
          x.geometry.dispose()
          x.material.dispose()
        }
      })
      g.clear() // fires 'removed', which also deletes CSS2D label elements
    }
    // NASA candidate landing regions: small white octahedra (approximate centres), names when zoomed in.
    for (const r of regions) {
      const isSel = selectedArtemis?.name.toLowerCase() === r.name.toLowerCase()
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(isSel ? 0.012 : 0.007),
        new THREE.MeshBasicMaterial({ color: isSel ? '#f59e0b' : '#38bdf8', wireframe: !isSel })
      )
      m.position.copy(unitAt(r.lat, r.lon).multiplyScalar(1.003))
      w.markers.add(m)
      const l = label(r.name, 'is-region')
      l.position.copy(m.position).multiplyScalar(1.01)
      l.userData.region = true
      w.markers.add(l)
    }
    for (const s of sites) {
      const selected = s.id === site?.id
      const st = selected && site ? stateAt(site, i) : null
      const m = new THREE.Mesh(new THREE.SphereGeometry(selected ? 0.012 : 0.008, 16, 8), new THREE.MeshBasicMaterial({ color: st ? COLORS[st] : '#d9d6cf' }))
      m.position.copy(unitAt(s.lat, s.lon).multiplyScalar(1.003))
      m.userData.id = s.id
      w.markers.add(m)
      if (selected && site) {
        const l = label(s.name, 'is-site')
        l.position.copy(m.position).multiplyScalar(1.03)
        w.markers.add(l)
        // Sight lines from the site toward the true Sun and Earth directions (from the site, parallax included).
        const p = unitAt(site.lat, site.lon)
        for (const [b, off] of [['sun', 0], ['earth', 3]] as const) {
          const d = meToScene(v[k + off], v[k + off + 1], v[k + off + 2]).sub(p.clone().multiplyScalar(R_KM)).normalize()
          const seen = site[b].frac[i] > 0
          const geo = new THREE.BufferGeometry().setFromPoints([p.clone().multiplyScalar(1.003), p.clone().multiplyScalar(1.003).addScaledVector(d, 0.6)])
          const line = new THREE.Line(geo, seen ? new THREE.LineBasicMaterial({ color: COLORS[b] }) : new THREE.LineDashedMaterial({ color: '#e0705c', dashSize: 0.02, gapSize: 0.015 }))
          if (!seen) line.computeLineDistances()
          w.rays.add(line)
        }
      }
    }
    w.draw()
  }, [i, site, sites, relief, ready, regions])

    const flyArtemis = (a: ArtemisSiteData) => {
    setSelectedArtemis(a)
    const w = world.current
    if (!w) return
    w.camera.position.copy(unitAt(a.lat, a.lon).multiplyScalar(1.8))
    w.controls.target.copy(unitAt(a.lat, a.lon))
    w.controls.update()
    w.draw()
  }

  const fly = (k: 'earth' | 'sun' | 'south' | 'site' | 'system') => {
    const w = world.current
    if (!w) return
    const v = w.vectors
    const pos =
      k === 'earth' ? meToScene(v[o + 3], v[o + 4], v[o + 5]).normalize().multiplyScalar(3.2)
      : k === 'sun' ? meToScene(v[o], v[o + 1], v[o + 2]).normalize().multiplyScalar(3.2)
      : k === 'system' ? new THREE.Vector3(0.3, 14, 0.3) // from above the north pole: Sun and Earth lie near the Moon's equator plane
      : k === 'south' ? unitAt(-72, 0).multiplyScalar(2.6)
      : site ? unitAt(site.lat, site.lon).multiplyScalar(1.9) : null
    if (!pos) return
    w.camera.position.copy(pos)
    w.controls.update()
    w.draw()
  }

  const v = world.current?.vectors
  const subSun = v && ready ? subPoint(v, o) : null
  const subEarth = v && ready ? subPoint(v, o + 3) : null
  const st = site ? stateAt(site, i) : null

  return (
    <div className="three-screen">
      <div className="three-wrap" ref={host}>
        {!ready && !err && <p className="loading three-msg">Loading the globe (about 2 MB, once)</p>}
        {err && <p className="error three-msg">The globe couldn't start: {err}</p>}
        <span className="three-label">Sun and Earth not to scale; directions accurate</span>
      </div>
      <aside className="map-side">
        <p className="chart-note">
          Lit from the true Sun direction at the selected time, so the day/night line is real. Drag to spin, scroll to
          zoom, click a marker to pick a site. Dashed ring: 80° S, the 3D terrain area.
        </p>
                <fieldset className="thresholds" style={{ borderColor: 'rgba(56, 189, 248, 0.4)' }}>
          <legend style={{ color: '#38bdf8', fontWeight: 600 }}>Artemis III Candidate Landing Sites</legend>
          <div className="slips" style={{ gap: '6px' }}>
            {ARTEMIS_3_SITES.map((a) => (
              <button
                key={a.id}
                type="button"
                style={{
                  fontSize: '0.74rem',
                  padding: '3px 7px',
                  minWidth: 'auto',
                  borderColor: selectedArtemis?.id === a.id ? '#38bdf8' : undefined,
                  background: selectedArtemis?.id === a.id ? 'rgba(56, 189, 248, 0.22)' : undefined,
                  color: selectedArtemis?.id === a.id ? '#38bdf8' : undefined,
                  fontWeight: selectedArtemis?.id === a.id ? 600 : 400
                }}
                onClick={() => flyArtemis(a)}
              >
                {a.name}
              </button>
            ))}
          </div>

          {selectedArtemis && (
            <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(15, 23, 42, 0.85)', border: '1px solid #38bdf8', borderRadius: 'var(--radius-s)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div>
                  <h4 style={{ margin: '0 0 2px', fontSize: '0.92rem', color: '#38bdf8', fontWeight: 600 }}>{selectedArtemis.name}</h4>
                  <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                    {selectedArtemis.lat.toFixed(2)}° S, {Math.abs(selectedArtemis.lon).toFixed(1)}° {selectedArtemis.lon < 0 ? 'W' : 'E'}
                  </span>
                </div>
                <span style={{ fontSize: '0.68rem', padding: '2px 5px', borderRadius: '3px', fontWeight: 600, background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', border: '1px solid currentColor' }}>
                  {selectedArtemis.resources.water_ice_potential} Ice
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', margin: '6px 0', lineHeight: 1.4 }}>{selectedArtemis.geology}</p>
              <div style={{ fontSize: '0.74rem', margin: '4px 0' }}>
                <strong style={{ color: '#e2e8f0' }}>Minerals:</strong> {selectedArtemis.minerals.primary.join(', ')}
              </div>
              <div style={{ fontSize: '0.74rem', margin: '4px 0' }}>
                <strong style={{ color: '#38bdf8' }}>Water & Volatiles:</strong> {selectedArtemis.resources.water_ice_details}
              </div>
              <div style={{ fontSize: '0.74rem', margin: '4px 0' }}>
                <strong style={{ color: '#f59e0b' }}>ISRU:</strong> {selectedArtemis.resources.isru_applications}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                {onPickPoint && onOpenSite && (
                  <button
                    type="button"
                    style={{ padding: '6px 10px', fontSize: '0.78rem', background: '#0284c7', color: '#fff', border: 'none', borderRadius: 'var(--radius-s)', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      onPickPoint(selectedArtemis.lat, selectedArtemis.lon)
                      onOpenSite()
                    }}
                  >
                    Analyze in Site &amp; Plan Tab →
                  </button>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    style={{ flex: 1, padding: '5px 8px', fontSize: '0.74rem', background: 'rgba(255, 255, 255, 0.08)', color: '#e2e8f0', border: '1px solid var(--rule)', borderRadius: 'var(--radius-s)', cursor: 'pointer' }}
                    onClick={onOpen3D}
                  >
                    Inspect in 3D →
                  </button>
                  {onOpenArtemis && (
                    <button
                      type="button"
                      style={{ flex: 1, padding: '5px 8px', fontSize: '0.74rem', background: 'rgba(255, 255, 255, 0.08)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.35)', borderRadius: 'var(--radius-s)', cursor: 'pointer' }}
                      onClick={onOpenArtemis}
                    >
                      3D Resources
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </fieldset>
        <fieldset className="thresholds">
          <legend>Camera</legend>
          <div className="slips">
            <button onClick={() => fly('system')}>Sun, Earth and Moon</button>
            <button onClick={() => fly('earth')}>As seen from Earth</button>
            <button onClick={() => fly('sun')}>From the Sun</button>
            <button onClick={() => fly('south')}>South pole</button>
            <button disabled={!site} onClick={() => fly('site')}>Fly to site</button>
          </div>
        </fieldset>
        <div className="pick-box">
          {site && st ? (
            <p>
              <strong>{site.name}</strong>: {STATE_LABEL[st]}. Lines point to the Sun and Earth; red dashed when terrain
              blocks them.{' '}
              {site.lat <= -80.5 && (
                <button className="link" onClick={onOpen3D}>
                  See its terrain shadows in 3D
                </button>
              )}
            </p>
          ) : (
            <p className="muted">Pick a site to show it.</p>
          )}
        </div>
        {subSun && subEarth && (
          <p className="globe-facts">
            <span>Sun overhead at</span> <strong>{fmtLat(subSun.lat)}, {fmtLon(subSun.lon)}</strong>
            <span>Earth overhead at</span> <strong>{fmtLat(subEarth.lat)}, {fmtLon(subEarth.lon)}</strong>
          </p>
        )}
        <p className="chart-note">
          Earth hangs almost still over the near side; its small wobble (libration) is why Earth rises and sets at the
          south pole.
        </p>
        <label className="field exag">
          <span>Relief shading</span>
          <input type="range" min={1} max={4} step={0.5} value={relief} aria-label="Relief shading strength" onChange={(e) => setRelief(Number(e.target.value))} />
          <span className="unit">{relief}×</span>
        </label>
        <p className="chart-note">
          ◇ NASA candidate landing regions: names show when you zoom in close; the Map tab lists them clearly. {ARTEMIS_NOTE}
        </p>
        <p className="chart-note">
          Colour: NASA CGI Moon Kit (LROC). Relief: slopes from our LOLA LDEM_16 terrain. Terrain doesn't cast shadows on
          the globe; the 3D terrain view computes those.
        </p>
      </aside>
    </div>
  )
}
