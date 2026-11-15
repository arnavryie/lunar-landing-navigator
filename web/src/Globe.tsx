import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { ARTEMIS_NOTE, STATE_LABEL, stateAt, type Site, type SiteSummary } from './data'
import { ARTEMIS_3_SITES, type ArtemisSiteData } from './data/artemisData'
import { FRAG, VERT } from './moonShader'

// F6c: whole-Moon globe. Lit from the true Sun direction for the selected hour (same Skyfield vectors as
// the Map and 3D views). Colour: NASA CGI Moon Kit (LROC). Relief: normals from our LOLA LDEM_16.
// Scene units: Moon radii. Scene axes from the Moon ME frame: X = x, Y = z (north up), Z = -y.

const R_KM = 1737.4
const base = import.meta.env.BASE_URL
const COLORS = { sun: '#c98419', earth: '#5590d8', both: '#1fa38a', none: '#4a515a' }
const meToScene = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y)
const D2R = Math.PI / 180

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
  artemisGroup: THREE.Group
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

function createArtemisLabel(a: ArtemisSiteData, isSel: boolean, onSelect: () => void, showAlways: boolean) {
  const el = document.createElement('div')
  el.className = `globe-label is-artemis ${isSel ? 'is-selected' : ''} ${showAlways ? 'show-always' : ''}`
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '0')
  el.setAttribute('aria-label', `${a.name} Artemis III candidate landing site`)

  const dot = document.createElement('span')
  dot.className = 'artemis-badge-dot'
  dot.textContent = isSel ? '◆' : '◇'
  el.appendChild(dot)

  const nameSpan = document.createElement('span')
  nameSpan.className = 'artemis-badge-name'
  nameSpan.textContent = a.name
  el.appendChild(nameSpan)

  const tagSpan = document.createElement('span')
  tagSpan.className = 'artemis-badge-tag'
  tagSpan.textContent =
    a.resources.water_ice_potential === 'Exceptional'
      ? 'Exceptional ice'
      : a.resources.water_ice_potential === 'Strategic'
      ? 'Strategic ISRU'
      : `${a.resources.water_ice_potential} ice`
  el.appendChild(tagSpan)

  el.onclick = (e) => {
    e.stopPropagation()
    onSelect()
  }
  el.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      onSelect()
    }
  }

  return el
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
  onPickArtemisSite,
  onOpen3D,
  onOpenSite,
  onOpenArtemis,
  onPickPoint,
  vectors: yearVectors,
}: {
  site: Site | null
  sites: SiteSummary[]
  i: number
  onPickSite: (id: string) => void
  onPickArtemisSite?: (a: ArtemisSiteData) => void
  onOpen3D: () => void
  onOpenSite?: () => void
  onOpenArtemis?: () => void
  onPickPoint?: (lat: number, lon: number) => void
  vectors?: Float32Array | null // Any landing year: that year's Sun/Earth vectors (else the 2027 file)
}) {
  const [selectedArtemis, setSelectedArtemis] = useState<ArtemisSiteData | null>(() => {
    if (site) {
      const match = ARTEMIS_3_SITES.find(
        (a) =>
          site.id === `artemis-${a.id}` ||
          site.name.toLowerCase().includes(a.name.toLowerCase()) ||
          Math.hypot(a.lat - site.lat, a.lon - site.lon) < 0.35,
      )
      if (match) return match
    }
    return ARTEMIS_3_SITES[0]
  })

  // Synchronize when active site changes
  useEffect(() => {
    if (!site) return
    const match = ARTEMIS_3_SITES.find(
      (a) =>
        site.id === `artemis-${a.id}` ||
        site.name.toLowerCase().includes(a.name.toLowerCase()) ||
        Math.hypot(a.lat - site.lat, a.lon - site.lon) < 0.35,
    )
    if (match) setSelectedArtemis((prev) => (prev?.id === match.id ? prev : match))
  }, [site])

  const host = useRef<HTMLDivElement>(null)
  const world = useRef<World | null>(null)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const [relief, setRelief] = useState(1)
  const [labelMode, setLabelMode] = useState<'selected' | 'all' | 'none'>('selected')
  const [vectors, setVectors] = useState<Float32Array | null>(null)
  const labelModeRef = useRef(labelMode)

  const selectedReticleRef = useRef<THREE.Group | null>(null)
  const selectAnimRef = useRef<{ startTime: number; duration: number } | null>(null)
  const pulseMeshRef = useRef<THREE.Line | null>(null)
  const flyAnimRef = useRef<{
    startPos: THREE.Vector3
    endPos: THREE.Vector3
    startTarget: THREE.Vector3
    endTarget: THREE.Vector3
    startTime: number
    duration: number
  } | null>(null)

  const pick = useRef(onPickSite)
  const flyArtemisRef = useRef<(a: ArtemisSiteData, shouldFly?: boolean) => void>(() => {})

  useEffect(() => {
    labelModeRef.current = labelMode
  }, [labelMode])

  useEffect(() => {
    pick.current = onPickSite
  }, [onPickSite])

  const startFlight = (endPos: THREE.Vector3, endTarget: THREE.Vector3, duration = 750) => {
    const w = world.current
    if (!w) return
    flyAnimRef.current = {
      startPos: w.camera.position.clone(),
      endPos: endPos.clone(),
      startTarget: w.controls.target.clone(),
      endTarget: endTarget.clone(),
      startTime: performance.now(),
      duration,
    }
  }

  const flyArtemis = (a: ArtemisSiteData, shouldFly = true) => {
    setSelectedArtemis(a)
    onPickArtemisSite?.(a)
    selectAnimRef.current = { startTime: performance.now(), duration: 600 }
    if (shouldFly) {
      const target = unitAt(a.lat, a.lon)
      const camPos = unitAt(Math.min(-68, a.lat + 10), a.lon).multiplyScalar(1.9)
      startFlight(camPos, target, 750)
    }
  }

  useEffect(() => {
    flyArtemisRef.current = flyArtemis
  })

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
        renderer.setClearColor('#0c0a06')
        host.current.appendChild(renderer.domElement)
        const labels = new CSS2DRenderer()
        labels.domElement.className = 'globe-labels'
        host.current.appendChild(labels.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enablePan = false
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.minDistance = 1.08
        controls.maxDistance = 16

        const moonMat = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: color },
            uRelief: { value: reliefTex },
            uSun: { value: new THREE.Vector3(1, 0, 0) },
            uCam: { value: new THREE.Vector3() },
            uRel: { value: 1 },
            uNight: { value: 0.035 },
          },
          vertexShader: VERT,
          fragmentShader: FRAG,
        })
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), moonMat))

        // 80 S ring: the area the Map and 3D terrain views cover.
        const ring = Array.from({ length: 181 }, (_, k) => unitAt(-80, k * 2).multiplyScalar(1.001))
        const ringLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(ring),
          new THREE.LineDashedMaterial({ color: '#ebe7dd', dashSize: 0.01, gapSize: 0.008, transparent: true, opacity: 0.6 }),
        )
        ringLine.computeLineDistances()
        scene.add(ringLine)

        // Sun and Earth reference models
        const light = new THREE.DirectionalLight('#ffffff', 2.2)
        scene.add(light, new THREE.AmbientLight('#ffffff', 0.04))
        const sun = new THREE.Mesh(new THREE.SphereGeometry(0.32, 32, 16), new THREE.MeshBasicMaterial({ color: '#ffd98a' }))
        sun.add(label('Sun', 'is-sun'))
        const earth = new THREE.Mesh(new THREE.SphereGeometry(0.36, 48, 24), new THREE.MeshLambertMaterial({ color: COLORS.earth }))
        earth.add(label('Earth', 'is-earth'))
        const rays = new THREE.Group()
        const markers = new THREE.Group()
        const artemisGroup = new THREE.Group()
        scene.add(sun, earth, rays, markers, artemisGroup)

        const draw = () => {
          moonMat.uniforms.uCam.value.set(camera.position.x, -camera.position.z, camera.position.y)
          const alt = camera.position.length() - 1
          controls.rotateSpeed = Math.min(1, Math.max(0.04, alt * 0.6))
          for (const b of [sun, earth]) {
            b.visible = !(
              camera.position.length() > b.position.length() - 0.6 &&
              camera.position.clone().normalize().dot(b.position.clone().normalize()) > 0.98
            )
          }

          // Legacy survey markers visibility
          for (const m of markers.children) {
            if (m instanceof THREE.Mesh) {
              m.scale.setScalar(Math.min(1, Math.max(0.2, alt / 3.0)))
            } else {
              m.visible = m.position.dot(camera.position.clone().sub(m.position)) > 0
            }
          }

          // Artemis site labels visibility based on camera facing angle and user toggle
          for (const child of artemisGroup.children) {
            if (child instanceof CSS2DObject) {
              const isFacing = child.position.dot(camera.position.clone().sub(child.position)) > 0
              const isSel = child.userData.isSel
              if (!isFacing) {
                child.visible = false
              } else if (labelModeRef.current === 'none') {
                child.visible = false
              } else if (labelModeRef.current === 'all') {
                child.visible = true
              } else {
                // 'selected' mode: only active selected site badge shows (or hovered via CSS)
                child.visible = isSel
              }
            }
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

        // Animation loop for smooth camera transitions, orbit controls damping, and landing reticle expansion
        let animId: number
        const animate = () => {
          animId = requestAnimationFrame(animate)

          // Smooth camera flight interpolation
          const fly = flyAnimRef.current
          if (fly) {
            const elapsed = performance.now() - fly.startTime
            const progress = Math.min(1, elapsed / fly.duration)
            const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2
            camera.position.lerpVectors(fly.startPos, fly.endPos, ease)
            controls.target.lerpVectors(fly.startTarget, fly.endTarget, ease)
            controls.update()
            if (progress >= 1) flyAnimRef.current = null
          } else {
            controls.update()
          }

          // Smooth landing reticle expansion animation on site click/selection
          const selAnim = selectAnimRef.current
          const reticle = selectedReticleRef.current
          if (reticle) {
            if (selAnim) {
              const elapsed = performance.now() - selAnim.startTime
              const progress = Math.min(1, elapsed / selAnim.duration)
              // Smooth cubic ease out
              const ease = 1 - Math.pow(1 - progress, 3)
              reticle.scale.set(ease, ease, ease)
              if (progress >= 1) selectAnimRef.current = null
            } else {
              reticle.scale.set(1, 1, 1)
            }
          }

          // Dynamic radar pulse animation for the active landing reticle
          const pulse = pulseMeshRef.current
          if (pulse) {
            const time = performance.now() * 0.0035
            const s = 1.0 + 0.35 * (0.5 + 0.5 * Math.sin(time))
            pulse.scale.set(s, 1, s)
            if (pulse.material instanceof THREE.LineBasicMaterial) {
              pulse.material.opacity = 0.4 + 0.55 * (0.5 + 0.5 * Math.cos(time))
            }
          }

          draw()
        }
        animId = requestAnimationFrame(animate)

        // Click a marker or Artemis landing site to select it
        let down: [number, number] | null = null
        const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY])
        const onUp = (e: PointerEvent) => {
          if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return
          const rect = renderer.domElement.getBoundingClientRect()

          // Check Artemis landing sites first with generous click target (28px)
          let bestArtemis = 28
          let foundArtemis: ArtemisSiteData | null = null

          for (const child of artemisGroup.children) {
            if (child.userData.artemis) {
              const worldPos = new THREE.Vector3()
              child.getWorldPosition(worldPos)
              if (worldPos.dot(camera.position.clone().sub(worldPos)) > 0) {
                const q = worldPos.clone().project(camera)
                const sx = rect.left + ((q.x + 1) / 2) * rect.width
                const sy = rect.top + ((1 - q.y) / 2) * rect.height
                const d = Math.hypot(sx - e.clientX, sy - e.clientY)
                if (d < bestArtemis) {
                  bestArtemis = d
                  foundArtemis = child.userData.artemis
                }
              }
            } else if (child instanceof THREE.Group) {
              for (const sub of child.children) {
                if (sub.userData.artemis) {
                  const worldPos = new THREE.Vector3()
                  sub.getWorldPosition(worldPos)
                  if (worldPos.dot(camera.position.clone().sub(worldPos)) > 0) {
                    const q = worldPos.clone().project(camera)
                    const sx = rect.left + ((q.x + 1) / 2) * rect.width
                    const sy = rect.top + ((1 - q.y) / 2) * rect.height
                    const d = Math.hypot(sx - e.clientX, sy - e.clientY)
                    if (d < bestArtemis) {
                      bestArtemis = d
                      foundArtemis = sub.userData.artemis
                    }
                  }
                }
              }
            }
          }

          if (foundArtemis) {
            flyArtemisRef.current(foundArtemis)
            return
          }

          // Fallback check for survey sites
          let best = 14
          let id = ''
          for (const m of markers.children) {
            if (!m.userData.id || m.position.dot(camera.position.clone().sub(m.position)) <= 0) continue
            const q = m.position.clone().project(camera)
            const d = Math.hypot(
              rect.left + ((q.x + 1) / 2) * rect.width - e.clientX,
              rect.top + ((1 - q.y) / 2) * rect.height - e.clientY,
            )
            if (d < best) [best, id] = [d, m.userData.id]
          }
          if (id) pick.current(id)
        }

        const onMove = (e: PointerEvent) => {
          const rect = renderer.domElement.getBoundingClientRect()
          let hoveredSiteId: string | null = null

          for (const child of artemisGroup.children) {
            if (child.userData.artemis) {
              const worldPos = new THREE.Vector3()
              child.getWorldPosition(worldPos)
              if (worldPos.dot(camera.position.clone().sub(worldPos)) > 0) {
                const q = worldPos.clone().project(camera)
                const sx = rect.left + ((q.x + 1) / 2) * rect.width
                const sy = rect.top + ((1 - q.y) / 2) * rect.height
                if (Math.hypot(sx - e.clientX, sy - e.clientY) < 28) {
                  hoveredSiteId = child.userData.artemis.id
                  break
                }
              }
            }
          }

          renderer.domElement.style.cursor = hoveredSiteId ? 'pointer' : 'default'

          // Toggle hover class on CSS2D label badges
          for (const child of artemisGroup.children) {
            if (child instanceof CSS2DObject && child.userData.domEl) {
              const isHov = child.userData.artemisId === hoveredSiteId && !child.userData.isSel
              child.userData.domEl.classList.toggle('is-hovered', isHov)
            }
          }
        }

        renderer.domElement.addEventListener('pointerdown', onDown)
        renderer.domElement.addEventListener('pointerup', onUp)
        renderer.domElement.addEventListener('pointermove', onMove)

        // Initial view: frame lunar South Pole with all 9 Artemis landing sites visible
        camera.position.copy(unitAt(-74, 0).multiplyScalar(2.7))
        controls.target.copy(unitAt(-86, 0))
        controls.update()

        const vecArray = new Float32Array(vecBuf)
        setVectors(vecArray)

        world.current = {
          renderer,
          labels,
          scene,
          camera,
          controls,
          moonMat,
          sun,
          earth,
          light,
          rays,
          markers,
          artemisGroup,
          vectors: vecArray,
          draw,
        }
        resize()
        setReady(true)

        cleanup = () => {
          cancelAnimationFrame(animId)
          ro.disconnect()
          renderer.domElement.removeEventListener('pointerdown', onDown)
          renderer.domElement.removeEventListener('pointerup', onUp)
          renderer.domElement.removeEventListener('pointermove', onMove)
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

  // Time, site, relief and selection changes: update 3D markers, sun/earth directions, and redraw.
  const o = 6 * i
  useEffect(() => {
    const w = world.current
    if (!w || !ready) return
    const v = yearVectors ?? w.vectors
    const k = 6 * Math.min(i, v.length / 6 - 1)
    const sunDir = meToScene(v[k], v[k + 1], v[k + 2]).normalize()
    const earthDir = meToScene(v[k + 3], v[k + 4], v[k + 5]).normalize()
    w.moonMat.uniforms.uSun.value.set(sunDir.x, -sunDir.z, sunDir.y)
    w.moonMat.uniforms.uRel.value = relief
    w.sun.position.copy(sunDir).multiplyScalar(4)
    w.earth.position.copy(earthDir).multiplyScalar(3)
    w.light.position.copy(sunDir)

    // Dispose old geometries and materials to avoid memory leaks
    for (const g of [w.markers, w.rays, w.artemisGroup]) {
      g.traverse((x) => {
        if (x instanceof THREE.Mesh || x instanceof THREE.Line) {
          x.geometry.dispose()
          if (Array.isArray(x.material)) x.material.forEach((m) => m.dispose())
          else x.material.dispose()
        }
      })
      g.clear()
    }
    pulseMeshRef.current = null
    selectedReticleRef.current = null

    // Render Artemis III 9 Candidate Landing Regions
    // Unselected: Clean, minimal, uncluttered pinpoints
    // Selected: Animated expanding landing reticle, cardinal crosshairs, rising beacon, and radar wave
    for (const a of ARTEMIS_3_SITES) {
      const isSel = selectedArtemis?.id === a.id
      const norm = unitAt(a.lat, a.lon)

      if (!isSel) {
        // UNSELECTED SITE: Subtle, uncluttered coordinate marker
        const surfPos = norm.clone().multiplyScalar(1.0025)

        // 1. Sleek cyan pinpoint dot
        const dot = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.005),
          new THREE.MeshBasicMaterial({ color: '#cf86c3' }),
        )
        dot.position.copy(surfPos)
        dot.userData = { artemis: a, id: a.id }
        w.artemisGroup.add(dot)

        // 2. Mini landing target ring (compact, radius 0.008, ~14 km)
        const up = Math.abs(norm.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
        const t1 = new THREE.Vector3().crossVectors(norm, up).normalize()
        const t2 = new THREE.Vector3().crossVectors(norm, t1).normalize()

        const ringPts: THREE.Vector3[] = []
        for (let s = 0; s <= 24; s++) {
          const phi = (s / 24) * Math.PI * 2
          const pt = norm
            .clone()
            .multiplyScalar(Math.cos(0.008))
            .add(t1.clone().multiplyScalar(Math.sin(0.008) * Math.cos(phi)))
            .add(t2.clone().multiplyScalar(Math.sin(0.008) * Math.sin(phi)))
          ringPts.push(pt.multiplyScalar(1.0025))
        }
        const miniRing = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(ringPts),
          new THREE.LineBasicMaterial({ color: '#cf86c3', transparent: true, opacity: 0.45 }),
        )
        miniRing.userData = { artemis: a, id: a.id }
        w.artemisGroup.add(miniRing)

        // 3. Mini pin stem (height 0.012)
        const miniHeadPos = norm.clone().multiplyScalar(1.014)
        const miniStem = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([surfPos, miniHeadPos]),
          new THREE.LineBasicMaterial({ color: '#cf86c3', transparent: true, opacity: 0.5 }),
        )
        miniStem.userData = { artemis: a, id: a.id }
        w.artemisGroup.add(miniStem)

        // 4. CSS2D label (hidden by default, reveals on hover to eliminate clutter)
        const el = createArtemisLabel(a, false, () => flyArtemisRef.current(a), labelMode === 'all')
        const l = new CSS2DObject(el)
        l.position.copy(miniHeadPos.clone().multiplyScalar(1.008))
        l.userData = { artemisId: a.id, isSel: false, domEl: el }
        w.artemisGroup.add(l)
      } else {
        // SELECTED SITE: Full prominent landing reticle, beacon stem, and radar pulse
        // Seated in a local group oriented along surface normal for smooth outward expansion animation
        const reticleGroup = new THREE.Group()
        reticleGroup.position.copy(norm.clone().multiplyScalar(1.0025))
        reticleGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm)
        selectedReticleRef.current = reticleGroup
        w.artemisGroup.add(reticleGroup)

        // 1. Touchdown center anchor dot
        const centerDot = new THREE.Mesh(
          new THREE.SphereGeometry(0.005, 12, 6),
          new THREE.MeshBasicMaterial({ color: '#ffffff' }),
        )
        centerDot.userData = { artemis: a, id: a.id }
        reticleGroup.add(centerDot)

        // 2. Landing candidate zone boundary circle (~42 km radius, 0.024 rad)
        const boundaryRadius = 0.024
        const segs = 36
        const bndPts: THREE.Vector3[] = []
        for (let s = 0; s <= segs; s++) {
          const phi = (s / segs) * Math.PI * 2
          bndPts.push(new THREE.Vector3(boundaryRadius * Math.cos(phi), 0.0003, boundaryRadius * Math.sin(phi)))
        }
        const bndLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(bndPts),
          new THREE.LineBasicMaterial({ color: '#f2efe8', transparent: true, opacity: 0.95 }),
        )
        bndLine.userData = { artemis: a, id: a.id }
        reticleGroup.add(bndLine)

        // 3. Inner reticle circle (radius 0.012)
        const inPts: THREE.Vector3[] = []
        for (let s = 0; s <= segs; s++) {
          const phi = (s / segs) * Math.PI * 2
          inPts.push(new THREE.Vector3(0.012 * Math.cos(phi), 0.0003, 0.012 * Math.sin(phi)))
        }
        const inLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(inPts),
          new THREE.LineBasicMaterial({ color: '#f2efe8', transparent: true, opacity: 0.85 }),
        )
        inLine.userData = { artemis: a, id: a.id }
        reticleGroup.add(inLine)

        // 4. Cardinal crosshair tick marks
        for (const phi of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
          const p1 = new THREE.Vector3(
            boundaryRadius * 0.8 * Math.cos(phi),
            0.0003,
            boundaryRadius * 0.8 * Math.sin(phi),
          )
          const p2 = new THREE.Vector3(
            boundaryRadius * 1.25 * Math.cos(phi),
            0.0003,
            boundaryRadius * 1.25 * Math.sin(phi),
          )
          const tick = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([p1, p2]),
            new THREE.LineBasicMaterial({ color: '#f2efe8', transparent: true, opacity: 0.9 }),
          )
          tick.userData = { artemis: a, id: a.id }
          reticleGroup.add(tick)
        }

        // 5. Vertical navigational beacon stem rising to height 0.055
        const stemH = 0.055
        const stemLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, stemH, 0)]),
          new THREE.LineBasicMaterial({ color: '#f2efe8', transparent: true, opacity: 1.0 }),
        )
        stemLine.userData = { artemis: a, id: a.id }
        reticleGroup.add(stemLine)

        // 5b. Mathematically accurate Ground Shadow cast by vertical beacon stem on the terrain
        const localSun = sunDir.clone().applyQuaternion(reticleGroup.quaternion.clone().invert())
        if (localSun.y > -0.0047) {
          const horizLen = Math.hypot(localSun.x, localSun.z)
          if (horizLen > 1e-4) {
            const shadowDirX = -localSun.x / horizLen
            const shadowDirZ = -localSun.z / horizLen
            const sinAlpha = Math.max(0.015, localSun.y)
            const shadowL = Math.min(stemH / sinAlpha, boundaryRadius * 1.8)
            const shadowPts = [
              new THREE.Vector3(0, 0.0004, 0),
              new THREE.Vector3(shadowDirX * shadowL, 0.0004, shadowDirZ * shadowL),
            ]
            const shadowLine = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(shadowPts),
              new THREE.LineBasicMaterial({
                color: '#050403',
                transparent: true,
                opacity: 0.88,
              }),
            )
            shadowLine.userData = { artemis: a, id: a.id }
            reticleGroup.add(shadowLine)

            // Diamond head shadow at tip
            const tipCenter = new THREE.Vector3(shadowDirX * shadowL, 0.0004, shadowDirZ * shadowL)
            const tipGeo = new THREE.RingGeometry(0.001, 0.006, 4)
            tipGeo.rotateX(-Math.PI / 2)
            const tipMesh = new THREE.Mesh(
              tipGeo,
              new THREE.MeshBasicMaterial({ color: '#050403', side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
            )
            tipMesh.position.copy(tipCenter)
            tipMesh.userData = { artemis: a, id: a.id }
            reticleGroup.add(tipMesh)
          }
        }

        // 6. Radiant Gold diamond head + inner jewel
        const headMesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.016),
          new THREE.MeshBasicMaterial({ color: '#f2efe8' }),
        )
        headMesh.position.set(0, stemH, 0)
        headMesh.userData = { artemis: a, id: a.id }
        reticleGroup.add(headMesh)

        const jewelMesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.008),
          new THREE.MeshBasicMaterial({ color: '#ffffff' }),
        )
        jewelMesh.position.set(0, stemH, 0)
        jewelMesh.userData = { artemis: a, id: a.id }
        reticleGroup.add(jewelMesh)

        // 7. Pulsing radar wave ring
        const pulsePts: THREE.Vector3[] = []
        for (let s = 0; s <= segs; s++) {
          const phi = (s / segs) * Math.PI * 2
          pulsePts.push(new THREE.Vector3(boundaryRadius * Math.cos(phi), 0.0005, boundaryRadius * Math.sin(phi)))
        }
        const pulseMesh = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pulsePts),
          new THREE.LineBasicMaterial({ color: '#f2efe8', transparent: true, opacity: 0.8 }),
        )
        pulseMesh.userData = { artemis: a, id: a.id }
        pulseMeshRef.current = pulseMesh
        reticleGroup.add(pulseMesh)

        // 8. Selected mission badge
        const el = createArtemisLabel(a, true, () => flyArtemisRef.current(a), true)
        const l = new CSS2DObject(el)
        l.position.copy(norm.clone().multiplyScalar(1.0025 + stemH + 0.018))
        l.userData = { artemisId: a.id, isSel: true, domEl: el }
        w.artemisGroup.add(l)
      }
    }

    // Survey sites
    for (const s of sites) {
      const selected = s.id === site?.id
      const st = selected && site ? stateAt(site, i) : null
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 0.01 : 0.006, 16, 8),
        new THREE.MeshBasicMaterial({ color: st ? COLORS[st] : '#aaa598' }),
      )
      m.position.copy(unitAt(s.lat, s.lon).multiplyScalar(1.003))
      m.userData.id = s.id
      w.markers.add(m)
      if (selected && site) {
        const l = label(s.name, 'is-site')
        l.position.copy(m.position).multiplyScalar(1.03)
        w.markers.add(l)
        // Sight lines toward Sun and Earth
        const p = unitAt(site.lat, site.lon)
        for (const [b, off] of [['sun', 0], ['earth', 3]] as const) {
          const d = meToScene(v[k + off], v[k + off + 1], v[k + off + 2])
            .sub(p.clone().multiplyScalar(R_KM))
            .normalize()
          const seen = site[b].frac[i] > 0
          const geo = new THREE.BufferGeometry().setFromPoints([
            p.clone().multiplyScalar(1.003),
            p.clone().multiplyScalar(1.003).addScaledVector(d, 0.6),
          ])
          const line = new THREE.Line(
            geo,
            seen
              ? new THREE.LineBasicMaterial({ color: COLORS[b] })
              : new THREE.LineDashedMaterial({ color: '#e0705c', dashSize: 0.02, gapSize: 0.015 }),
          )
          if (!seen) line.computeLineDistances()
          w.rays.add(line)
        }
      }
    }

    w.draw()
  }, [i, site, sites, relief, ready, selectedArtemis, labelMode, yearVectors])

  const fly = (k: 'earth' | 'sun' | 'south' | 'site' | 'system') => {
    const w = world.current
    if (!w) return
    const v = yearVectors ?? w.vectors
    if (k === 'earth') {
      startFlight(meToScene(v[o + 3], v[o + 4], v[o + 5]).normalize().multiplyScalar(3.2), new THREE.Vector3(0, 0, 0), 750)
    } else if (k === 'sun') {
      startFlight(meToScene(v[o], v[o + 1], v[o + 2]).normalize().multiplyScalar(3.2), new THREE.Vector3(0, 0, 0), 750)
    } else if (k === 'system') {
      startFlight(new THREE.Vector3(0.3, 14, 0.3), new THREE.Vector3(0, 0, 0), 850)
    } else if (k === 'south') {
      startFlight(unitAt(-74, 0).multiplyScalar(2.7), unitAt(-86, 0), 800)
    } else if (k === 'site' && site) {
      const target = unitAt(site.lat, site.lon)
      const camPos = unitAt(Math.min(-68, site.lat + 10), site.lon).multiplyScalar(1.9)
      startFlight(camPos, target, 750)
    }
  }

  const currentIndex = selectedArtemis ? ARTEMIS_3_SITES.findIndex((x) => x.id === selectedArtemis.id) : 0

  const handlePrevSite = () => {
    const nextIdx = (currentIndex - 1 + ARTEMIS_3_SITES.length) % ARTEMIS_3_SITES.length
    flyArtemis(ARTEMIS_3_SITES[nextIdx])
  }

  const handleNextSite = () => {
    const nextIdx = (currentIndex + 1) % ARTEMIS_3_SITES.length
    flyArtemis(ARTEMIS_3_SITES[nextIdx])
  }

  const shown = yearVectors ?? vectors
  const subSun = shown && ready ? subPoint(shown, o) : null
  const subEarth = shown && ready ? subPoint(shown, o + 3) : null
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
          Lit from the true Sun direction at the selected time. Drag to spin, scroll to zoom, click any candidate site to focus camera and reveal its full landing zone.
        </p>

        {/* Primary Camera & Perspectives */}
        <fieldset className="thresholds">
          <legend>Camera</legend>
          <div className="slips" style={{ gap: '6px' }}>
            <button
              type="button"
              style={{ background: 'var(--ink)', color: 'var(--sheet)', borderColor: 'var(--ink)', fontWeight: 600 }}
              onClick={() => fly('south')}
            >
              Artemis III regions (south pole)
            </button>
            <button type="button" onClick={() => fly('earth')}>
              As seen from Earth
            </button>
            <button type="button" onClick={() => fly('sun')}>
              From the Sun
            </button>
            <button type="button" onClick={() => fly('system')}>
              Sun, Earth &amp; Moon
            </button>
            {selectedArtemis && (
              <button
                type="button"
                style={{ borderColor: '#f2efe8', color: '#f2efe8' }}
                onClick={() => flyArtemis(selectedArtemis)}
              >
                Focus {selectedArtemis.name}
              </button>
            )}
          </div>
        </fieldset>

        {/* Artemis III Candidate Landing Regions & Lander Resources Dossier */}
        <fieldset className="thresholds" style={{ borderColor: 'rgba(207, 134, 195, 0.45)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <legend style={{ color: '#cf86c3', fontWeight: 600, margin: 0, padding: '0 4px' }}>
              Artemis III candidate regions
            </legend>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                aria-label="Previous Artemis landing site"
                style={{ padding: '2px 8px', fontSize: '0.72rem', minWidth: 'auto', borderRadius: '3px' }}
                onClick={handlePrevSite}
              >
                ◀ Prev
              </button>
              <span style={{ fontSize: '0.72rem', color: 'var(--muted)', minWidth: '40px', textAlign: 'center' }}>
                {currentIndex + 1} / {ARTEMIS_3_SITES.length}
              </span>
              <button
                type="button"
                aria-label="Next Artemis landing site"
                style={{ padding: '2px 8px', fontSize: '0.72rem', minWidth: 'auto', borderRadius: '3px' }}
                onClick={handleNextSite}
              >
                Next ▶
              </button>
            </div>
          </div>

          {/* 9 Sites Selector Chips */}
          <div className="slips" style={{ gap: '5px', maxHeight: '160px', overflowY: 'auto', padding: '2px 0' }}>
            {ARTEMIS_3_SITES.map((a) => {
              const isSelected = selectedArtemis?.id === a.id
              const isExceptional = a.resources.water_ice_potential === 'Exceptional'
              const isStrategic = a.resources.water_ice_potential === 'Strategic'
              return (
                <button
                  key={a.id}
                  type="button"
                  style={{
                    fontSize: '0.74rem',
                    padding: '4px 8px',
                    minWidth: 'auto',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    borderColor: isSelected ? '#f2efe8' : isExceptional ? 'rgba(207, 134, 195, 0.4)' : undefined,
                    background: isSelected ? 'rgba(242, 239, 232, 0.16)' : undefined,
                    color: isSelected ? '#f2efe8' : undefined,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onClick={() => flyArtemis(a)}
                >
                  <span>{a.name}</span>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      padding: '1px 4px',
                      borderRadius: '2px',
                      background: isSelected
                        ? 'rgba(242, 239, 232, 0.25)'
                        : isExceptional
                        ? 'rgba(207, 134, 195, 0.2)'
                        : isStrategic
                        ? 'rgba(242, 239, 232, 0.2)'
                        : 'rgba(255, 255, 255, 0.08)',
                      color: isSelected
                        ? '#f2efe8'
                        : isExceptional
                        ? '#cf86c3'
                        : isStrategic
                        ? '#f2efe8'
                        : '#aaa598',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {a.resources.water_ice_potential} Ice
                  </span>
                </button>
              )
            })}
          </div>

          {/* Selected Site Complete Lander Resource Dossier */}
          {selectedArtemis && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px',
                background: 'rgba(16, 15, 13, 0.92)',
                border: '1px solid #cf86c3',
                borderRadius: 'var(--radius-s)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#f2efe8', fontSize: '0.8rem' }}>◆</span>
                    <h4 style={{ margin: 0, fontSize: '0.96rem', color: '#f2efe8', fontWeight: 600 }}>
                      {selectedArtemis.name}
                    </h4>
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginTop: '2px' }}>
                    {selectedArtemis.lat.toFixed(2)}° S, {Math.abs(selectedArtemis.lon).toFixed(1)}°{' '}
                    {selectedArtemis.lon < 0 ? 'W' : 'E'} · Elev: +{selectedArtemis.elevation_km} km
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    background:
                      selectedArtemis.resources.water_ice_potential === 'Exceptional'
                        ? 'rgba(207, 134, 195, 0.25)'
                        : 'rgba(242, 239, 232, 0.25)',
                    color: selectedArtemis.resources.water_ice_potential === 'Exceptional' ? '#cf86c3' : '#f2efe8',
                    border: '1px solid currentColor',
                  }}
                >
                  {selectedArtemis.resources.water_ice_potential} Ice
                </span>
              </div>

              <p style={{ fontSize: '0.78rem', margin: '8px 0 6px', lineHeight: 1.45, color: '#c9c4b8' }}>
                {selectedArtemis.geology}
              </p>

              {/* Regolith & Minerals */}
              <div
                style={{
                  fontSize: '0.74rem',
                  margin: '6px 0',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: '6px',
                }}
              >
                <strong style={{ color: '#e8e4da' }}>Mineral Composition:</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '3px 0' }}>
                  {selectedArtemis.minerals.primary.map((m) => (
                    <span
                      key={m}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontSize: '0.7rem',
                        color: '#f2efe8',
                      }}
                    >
                      {m}
                    </span>
                  ))}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>
                  {selectedArtemis.minerals.crust_type} · {selectedArtemis.minerals.details}
                </div>
              </div>

              {/* Water Ice & Cryogenic Volatiles */}
              <div
                style={{
                  fontSize: '0.74rem',
                  margin: '6px 0',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: '6px',
                }}
              >
                <strong style={{ color: '#cf86c3' }}>Water ice and volatiles</strong>
                <div style={{ color: '#c9c4b8', margin: '2px 0' }}>
                  {selectedArtemis.resources.water_ice_details}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                  Depth: <strong>{selectedArtemis.resources.depth_estimate}</strong> · Volatiles:{' '}
                  {selectedArtemis.resources.volatiles.join(', ')}
                </div>
              </div>

              {/* Lander In-Situ Resources (ISRU) */}
              <div
                style={{
                  fontSize: '0.74rem',
                  margin: '6px 0',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: '6px',
                }}
              >
                <strong style={{ color: '#f2efe8' }}>In-situ resources (ISRU)</strong>
                <div style={{ color: '#c9c4b8', margin: '2px 0' }}>
                  {selectedArtemis.resources.isru_applications}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                  Extractable Elements: {selectedArtemis.resources.isru_elements.join(' · ')}
                </div>
              </div>

              {/* Operational Environment */}
              <div
                style={{
                  fontSize: '0.72rem',
                  color: 'var(--muted)',
                  margin: '6px 0 10px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: '6px',
                }}
              >
                <div>Sun: {selectedArtemis.operations.illumination}</div>
                <div>Earth Comms: {selectedArtemis.operations.earth_comms}</div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {onPickPoint && onOpenSite && (
                  <button
                    type="button"
                    style={{
                      padding: '7px 10px',
                      fontSize: '0.78rem',
                      background: 'var(--ink)',
                      color: 'var(--sheet)',
                      border: 'none',
                      borderRadius: 'var(--radius-s)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      onPickPoint(selectedArtemis.lat, selectedArtemis.lon)
                      onOpenSite()
                    }}
                  >
                    Analyse in Site and plan
                  </button>
                )}
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
                    onClick={onOpen3D}
                  >
                    Inspect in 3D
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      fontSize: '0.74rem',
                      background: 'rgba(255, 255, 255, 0.08)',
                      color: '#cf86c3',
                      border: '1px solid rgba(207, 134, 195, 0.35)',
                      borderRadius: 'var(--radius-s)',
                      cursor: 'pointer',
                    }}
                    onClick={() => flyArtemis(selectedArtemis)}
                  >
                    Re-center Globe
                  </button>
                </div>
                {onOpenArtemis && (
                  <button
                    type="button"
                    style={{
                      padding: '5px 8px',
                      fontSize: '0.74rem',
                      background: 'rgba(207, 134, 195, 0.12)',
                      color: '#cf86c3',
                      border: '1px solid rgba(207, 134, 195, 0.4)',
                      borderRadius: 'var(--radius-s)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    onClick={onOpenArtemis}
                  >
                    Compare all nine regions in 3D
                  </button>
                )}
              </div>
            </div>
          )}
        </fieldset>

        {/* Display & Shading Controls */}
        <fieldset className="thresholds">
          <legend>Display</legend>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Artemis Labels:</span>
            <div className="slips" style={{ gap: '4px' }}>
              {(['selected', 'all', 'none'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 7px',
                    minWidth: 'auto',
                    background: labelMode === mode ? 'rgba(207, 134, 195, 0.25)' : undefined,
                    color: labelMode === mode ? '#cf86c3' : undefined,
                    borderColor: labelMode === mode ? '#cf86c3' : undefined,
                    fontWeight: labelMode === mode ? 600 : 400,
                  }}
                  onClick={() => setLabelMode(mode)}
                >
                  {mode === 'selected' ? 'Active Site Only' : mode === 'all' ? 'All 9 Sites' : 'Off'}
                </button>
              ))}
            </div>
          </div>
          <label className="field exag">
            <span>Relief shading</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.5}
              value={relief}
              aria-label="Relief shading strength"
              onChange={(e) => setRelief(Number(e.target.value))}
            />
            <span className="unit">{relief}×</span>
          </label>
        </fieldset>

        {/* Selected Survey Site (if any) */}
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
            <p className="muted">Click any marker or landing zone to inspect it.</p>
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
        <p className="chart-note">
          NASA candidate landing regions: shown with pinpoint coordinate targets. Clicking any site triggers camera focus, landing reticle expansion, and radar pulse. {ARTEMIS_NOTE}
        </p>
        <p className="chart-note">
          Colour: NASA CGI Moon Kit (LROC). Relief: slopes from our LOLA LDEM_16 terrain.
        </p>
      </aside>
    </div>
  )
}
