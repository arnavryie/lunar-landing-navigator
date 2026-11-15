import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ARTEMIS_3_SITES } from './data/artemisData'
import { FRAG, VERT } from './moonShader'

const base = import.meta.env.BASE_URL
const D2R = Math.PI / 180

// Scene units: Moon radii (1.0 = lunar surface).
// ME frame to Three.js scene axes: X = x, Y = z (North pole up), Z = -y.
const meToScene = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y)
const unitAt = (lat: number, lon: number) =>
  meToScene(
    Math.cos(lat * D2R) * Math.cos(lon * D2R),
    Math.cos(lat * D2R) * Math.sin(lon * D2R),
    Math.sin(lat * D2R),
  )

interface Moon3DHeroProps {
  vec: Float32Array | null
  hour: number
  sun: { el: number; az: number } | null
  earth: { el: number; az: number } | null
}

export function Moon3DHero({ vec, hour, sun, earth }: Moon3DHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [reliefMode, setReliefMode] = useState<'standard' | 'enhanced' | 'flat'>('standard')
  const [showGrid, setShowGrid] = useState(true)
  const [showSites, setShowSites] = useState(true)
  const [autoRotate, setAutoRotate] = useState(true)

  // Internal Three.js references
  const worldRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    moonMesh: THREE.Mesh
    moonMat: THREE.ShaderMaterial
    gridGroup: THREE.Group
    sitesGroup: THREE.Group
    sunMarker: THREE.Mesh
    earthMarker: THREE.Mesh
    sunBeam: THREE.Line
    light: THREE.DirectionalLight
  } | null>(null)

  // 1. Initialize Scene, Renderer, Textures and OrbitControls
  useEffect(() => {
    const host = containerRef.current
    if (!host) return

    let disposed = false
    let cleanup = () => {}

    ;(async () => {
      try {
        const loader = new THREE.TextureLoader()
        const [colorTex, reliefTex] = await Promise.all([
          loader.loadAsync(`${base}data/globe/lroc_color_2k.jpg`),
          loader.loadAsync(`${base}data/globe/relief.png`),
        ])
        if (disposed || !containerRef.current) return

        colorTex.anisotropy = 4
        reliefTex.anisotropy = 4

        const width = host.clientWidth || 500
        const height = host.clientHeight || 500

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(width, height)
        renderer.setClearColor(0x000000, 0)
        host.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 50)

        // Initial camera position: tilted south-polar view highlighting the 80°-90° S Artemis exploration zone
        const initCamPos = unitAt(-72, 0).multiplyScalar(2.65)
        camera.position.copy(initCamPos)

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enablePan = false
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.minDistance = 1.18
        controls.maxDistance = 6.0
        controls.target.copy(unitAt(-86, 0))
        controls.autoRotate = autoRotate
        controls.autoRotateSpeed = 0.35
        controls.update()

        // Pause auto-rotation when user interacts with mouse/touch
        controls.addEventListener('start', () => {
          controls.autoRotate = false
          setAutoRotate(false)
        })

        // Moon Shader Material (Lommel-Seeliger + Lunar Lambert reflection)
        const moonMat = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: colorTex },
            uRelief: { value: reliefTex },
            uSun: { value: new THREE.Vector3(1, 0, 0) },
            uCam: { value: new THREE.Vector3() },
            uRel: { value: 1.0 },
            uNight: { value: 0.038 },
          },
          vertexShader: VERT,
          fragmentShader: FRAG,
        })

        const sphereGeo = new THREE.SphereGeometry(1, 160, 96)
        const moonMesh = new THREE.Mesh(sphereGeo, moonMat)
        scene.add(moonMesh)

        // Grid group (NASA SVS #14959 lat/lon graticule)
        const gridGroup = new THREE.Group()
        // 80° S and 85° S polar exploration boundaries
        for (const lat of [-80, -85, -88]) {
          const pts: THREE.Vector3[] = []
          for (let step = 0; step <= 180; step++) {
            pts.push(unitAt(lat, step * 2).multiplyScalar(1.002))
          }
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
          const lineMat = new THREE.LineDashedMaterial({
            color: lat === -80 ? 0x93c5fd : 0x64748b,
            dashSize: 0.015,
            gapSize: 0.01,
            transparent: true,
            opacity: lat === -80 ? 0.75 : 0.45,
          })
          const line = new THREE.Line(lineGeo, lineMat)
          line.computeLineDistances()
          gridGroup.add(line)
        }

        // Equator ring (0° latitude)
        const eqPts: THREE.Vector3[] = []
        for (let s = 0; s <= 180; s++) {
          eqPts.push(unitAt(0, s * 2).multiplyScalar(1.001))
        }
        const eqGeo = new THREE.BufferGeometry().setFromPoints(eqPts)
        const eqMat = new THREE.LineDashedMaterial({
          color: 0x475569,
          dashSize: 0.02,
          gapSize: 0.015,
          transparent: true,
          opacity: 0.35,
        })
        const eqLine = new THREE.Line(eqGeo, eqMat)
        eqLine.computeLineDistances()
        gridGroup.add(eqLine)

        // 4 Principal meridians (0°, 90° E, 180°, 270° W)
        for (const lon of [0, 90, 180, 270]) {
          const mPts: THREE.Vector3[] = []
          for (let lat = -90; lat <= 90; lat += 2) {
            mPts.push(unitAt(lat, lon).multiplyScalar(1.0015))
          }
          const mGeo = new THREE.BufferGeometry().setFromPoints(mPts)
          const mMat = new THREE.LineBasicMaterial({
            color: lon === 0 ? 0x93c5fd : 0x334155,
            transparent: true,
            opacity: lon === 0 ? 0.6 : 0.25,
          })
          gridGroup.add(new THREE.Line(mGeo, mMat))
        }
        scene.add(gridGroup)

        // Artemis candidate landing site markers
        const sitesGroup = new THREE.Group()
        for (const site of ARTEMIS_3_SITES) {
          const p = unitAt(site.lat, site.lon).multiplyScalar(1.002)

          // Touchdown circle on terrain
          const ringGeo = new THREE.RingGeometry(0.014, 0.022, 24)
          ringGeo.lookAt(p)
          const ringMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
          })
          const ringMesh = new THREE.Mesh(ringGeo, ringMat)
          ringMesh.position.copy(p)
          sitesGroup.add(ringMesh)

          // Center beacon diamond
          const diamondGeo = new THREE.OctahedronGeometry(0.009)
          const diamondMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
          const diamondMesh = new THREE.Mesh(diamondGeo, diamondMat)
          diamondMesh.position.copy(p.clone().multiplyScalar(1.012))
          diamondMesh.userData = { siteName: site.name }
          sitesGroup.add(diamondMesh)
        }
        scene.add(sitesGroup)

        // Lighting & celestial markers
        const light = new THREE.DirectionalLight(0xffffff, 1.8)
        scene.add(light)
        scene.add(new THREE.AmbientLight(0xffffff, 0.05))

        // Sun Marker
        const sunMarkerGeo = new THREE.SphereGeometry(0.07, 16, 16)
        const sunMarkerMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
        const sunMarker = new THREE.Mesh(sunMarkerGeo, sunMarkerMat)

        // Sun ray beam toward Moon center
        const beamGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(1, 0, 0),
        ])
        const beamMat = new THREE.LineDashedMaterial({
          color: 0xfbbf24,
          dashSize: 0.04,
          gapSize: 0.03,
          transparent: true,
          opacity: 0.5,
        })
        const sunBeam = new THREE.Line(beamGeo, beamMat)
        scene.add(sunMarker, sunBeam)

        // Earth Marker
        const earthMarkerGeo = new THREE.SphereGeometry(0.06, 16, 16)
        const earthMarkerMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa })
        const earthMarker = new THREE.Mesh(earthMarkerGeo, earthMarkerMat)
        scene.add(earthMarker)

        worldRef.current = {
          renderer,
          scene,
          camera,
          controls,
          moonMesh,
          moonMat,
          gridGroup,
          sitesGroup,
          sunMarker,
          earthMarker,
          sunBeam,
          light,
        }

        // Animation Loop
        let animId = 0
        const animate = () => {
          if (disposed) return
          controls.update()
          moonMat.uniforms.uCam.value.copy(camera.position)
          renderer.render(scene, camera)
          animId = requestAnimationFrame(animate)
        }
        animId = requestAnimationFrame(animate)

        // Responsive resize observer
        const ro = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const w = entry.contentRect.width
            const h = entry.contentRect.height
            if (w > 0 && h > 0) {
              camera.aspect = w / h
              camera.updateProjectionMatrix()
              renderer.setSize(w, h)
            }
          }
        })
        ro.observe(host)

        cleanup = () => {
          cancelAnimationFrame(animId)
          ro.disconnect()
          renderer.dispose()
          sphereGeo.dispose()
          moonMat.dispose()
          if (host.contains(renderer.domElement)) {
            host.removeChild(renderer.domElement)
          }
        }

        setReady(true)
      } catch (e) {
        console.error('Failed to initialize 3D Moon hero:', e)
      }
    })()

    return () => {
      disposed = true
      cleanup()
      worldRef.current = null
    }
  }, [])

  // 2. Update Solar and Earth directions dynamically from JPL DE421 ephemeris as hour scrubs
  useEffect(() => {
    const w = worldRef.current
    if (!w || !vec) return

    const k = 6 * Math.min(Math.floor(hour), Math.floor(vec.length / 6 - 1))
    const sunDir = meToScene(vec[k], vec[k + 1], vec[k + 2]).normalize()
    const earthDir = meToScene(vec[k + 3], vec[k + 4], vec[k + 5]).normalize()

    // Pass Sun vector into shader (Lommel-Seeliger terminator shading)
    w.moonMat.uniforms.uSun.value.set(sunDir.x, -sunDir.z, sunDir.y)

    // Position Sun marker & directional ray
    w.sunMarker.position.copy(sunDir).multiplyScalar(2.6)
    w.light.position.copy(sunDir).multiplyScalar(5)

    // Update Sun ray line geometry
    const pts = [sunDir.clone().multiplyScalar(2.55), sunDir.clone().multiplyScalar(1.05)]
    w.sunBeam.geometry.dispose()
    w.sunBeam.geometry = new THREE.BufferGeometry().setFromPoints(pts)
    w.sunBeam.computeLineDistances()

    // Position Earth marker
    w.earthMarker.position.copy(earthDir).multiplyScalar(2.2)
  }, [vec, hour])

  // 3. Update Relief Exaggeration Mode
  useEffect(() => {
    const w = worldRef.current
    if (!w) return
    const relVal = reliefMode === 'enhanced' ? 2.5 : reliefMode === 'flat' ? 0.0 : 1.0
    w.moonMat.uniforms.uRel.value = relVal
  }, [reliefMode])

  // 4. Update Grid and Sites Visibility
  useEffect(() => {
    const w = worldRef.current
    if (!w) return
    w.gridGroup.visible = showGrid
  }, [showGrid])

  useEffect(() => {
    const w = worldRef.current
    if (!w) return
    w.sitesGroup.visible = showSites
  }, [showSites])

  // 5. Update Auto-rotation
  useEffect(() => {
    const w = worldRef.current
    if (!w) return
    w.controls.autoRotate = autoRotate
  }, [autoRotate])

  // Camera Presets
  const setCameraPreset = (preset: 'pole' | 'equator' | 'sun') => {
    const w = worldRef.current
    if (!w) return
    w.controls.autoRotate = false
    setAutoRotate(false)

    if (preset === 'pole') {
      w.camera.position.copy(unitAt(-74, 0).multiplyScalar(2.65))
      w.controls.target.copy(unitAt(-86, 0))
    } else if (preset === 'equator') {
      w.camera.position.set(0, 0, 2.7)
      w.controls.target.set(0, 0, 0)
    } else if (preset === 'sun' && vec) {
      const k = 6 * Math.min(Math.floor(hour), Math.floor(vec.length / 6 - 1))
      const sunDir = meToScene(vec[k], vec[k + 1], vec[k + 2]).normalize()
      w.camera.position.copy(sunDir).multiplyScalar(2.7)
      w.controls.target.set(0, 0, 0)
    }
    w.controls.update()
  }

  return (
    <div className="moon-3d-hero-wrap">
      {/* 3D Canvas Host */}
      <div ref={containerRef} className={`moon-3d-canvas ${ready ? 'is-ready' : ''}`} />

      {/* Top Header Badge */}
      <div className="moon-3d-hud-top">
        <span className="moon-3d-badge">
          NASA LRO 3D MODEL · SVS #14959
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          {sun && (
            <span className="moon-3d-telemetry">
              Sun: <b>{sun.el >= 0 ? '+' : ''}{sun.el.toFixed(1)}°</b>
            </span>
          )}
          {earth && (
            <span className="moon-3d-telemetry">
              Earth: <b>{earth.el >= 0 ? '+' : ''}{earth.el.toFixed(1)}°</b>
            </span>
          )}
        </div>
      </div>

      {/* Interactive Controls Overlay Bar */}
      <div className="moon-3d-controls-bar">
        <div className="moon-3d-btn-group" role="group" aria-label="Camera presets">
          <span className="moon-3d-group-label">View:</span>
          <button
            type="button"
            className="moon-3d-btn"
            onClick={() => setCameraPreset('pole')}
            title="Focus on South Polar landing regions (80-90° S)"
          >
            South Pole
          </button>
          <button
            type="button"
            className="moon-3d-btn"
            onClick={() => setCameraPreset('equator')}
            title="Full Moon Equator View"
          >
            Equator
          </button>
          <button
            type="button"
            className="moon-3d-btn"
            onClick={() => setCameraPreset('sun')}
            title="Align view with the Sun vector"
          >
            From Sun
          </button>
        </div>

        <div className="moon-3d-btn-group" role="group" aria-label="NASA SVS 14959 display modes">
          <span className="moon-3d-group-label">NASA Data:</span>
          <button
            type="button"
            className={`moon-3d-btn ${reliefMode === 'enhanced' ? 'active' : ''}`}
            onClick={() => setReliefMode((m) => (m === 'enhanced' ? 'standard' : 'enhanced'))}
            title="Toggle LOLA elevation relief shading (SVS #14959 Group 379575)"
          >
            {reliefMode === 'enhanced' ? 'Relief: 2.5×' : 'Relief: 1×'}
          </button>
          <button
            type="button"
            className={`moon-3d-btn ${showGrid ? 'active' : ''}`}
            onClick={() => setShowGrid((g) => !g)}
            title="Toggle Latitude / Longitude lines (SVS #14959 Group 379586)"
          >
            Grid: {showGrid ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className={`moon-3d-btn ${showSites ? 'active' : ''}`}
            onClick={() => setShowSites((s) => !s)}
            title="Toggle Artemis III candidate landing sites"
          >
            Sites: {showSites ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className={`moon-3d-btn ${autoRotate ? 'active' : ''}`}
            onClick={() => setAutoRotate((r) => !r)}
            title="Toggle gentle orbital auto-rotation"
          >
            Rotate: {autoRotate ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Informational Tooltip / Guide */}
      <div className="moon-3d-foot-hint">
        <span>Drag to rotate · Scroll to zoom · Scrub timeline below to simulate hourly Sun terminator motion</span>
      </div>
    </div>
  )
}
