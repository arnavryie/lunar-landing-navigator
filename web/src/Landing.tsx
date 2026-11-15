import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration, loadSite, loadValidation, stateAt, type Site, type Validation } from './data'
import { DEFAULT_YEAR, loadVectors } from './years'
import { Moon3DHero } from './Moon3DHero'
import './styles/landing.css'

// Front page, set as a short technical note. Every figure is real data: Fig. 1 is NASA's long-term
// illumination map of 85–90° S with the hourly JPL DE421 Sun and Earth directions over it; Fig. 2 is a
// pipeline site file; the check numbers come from validation.json.

const base = import.meta.env.BASE_URL
const D2R = Math.PI / 180

/** Elevation of a body above a flat horizon at the south pole (local up = −z in the ME frame). */
const poleElevation = (v: Float32Array, o: number) => Math.asin(-v[o + 2] / Math.hypot(v[o], v[o + 1], v[o + 2])) / D2R
/** East longitude (0–360) the body stands over, i.e. its bearing seen from the pole on a 0° E-up map. */
const bearing = (v: Float32Array, o: number) => ((Math.atan2(v[o + 1], v[o]) / D2R) % 360 + 360) % 360

const fmtDate = (year: number, h: number) =>
  new Date(Date.UTC(year, 0, 1) + h * 3600e3).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hourCycle: 'h23',
  })
const signed = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}°`

const SCREENS = [
  { view: 'site', name: 'Site and plan', what: 'Sun and Earth over one site, hour by hour; slip the landing date and see what changes.' },
  { view: 'find', name: 'Find sites', what: 'Nearby spots ranked against your limits for sunlight, darkness and contact.' },
  { view: 'map', name: 'Map', what: 'Polar maps of sunlight, Earth visibility and slope; click anywhere to compute a new site.' },
  { view: '3d', name: '3D terrain', what: 'Polar terrain lit and shadowed on the GPU for the chosen hour.' },
  { view: 'globe', name: 'Globe', what: 'The whole Moon, lit from the true Sun direction, with the sites marked.' },
  { view: 'compare', name: 'Compare', what: 'Up to four site-and-date scenarios side by side.' },
  { view: 'lander', name: 'Lander systems', what: 'Battery and recharge planning for a rover at the chosen site.' },
  { view: 'validation', name: 'Validation', what: 'Each check against JPL Horizons and NASA illumination maps, with how to rerun it.' },
]

const CALENDAR_SITES = [
  { id: 'best-lit', short: 'Best-lit spot' },
  { id: 'mons-mouton', short: 'Mons Mouton' },
  { id: 'shackleton', short: 'Shackleton floor' },
  { id: 'apollo-11', short: 'Apollo 11' },
]


const REFS = [
  { n: 1, text: 'Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066–1081. Data: NASA PGDA Lunar Polar Illumination.', url: 'https://pgda.gsfc.nasa.gov/products/69' },
  { n: 2, text: 'NASA LRO Lunar Orbiter Laser Altimeter, gridded topography LDEM_60S_240M and LDEM_16 (PDS Geosciences Node).', url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm' },
  { n: 3, text: 'JPL DE421 planetary ephemeris and NAIF lunar frame kernels, computed with Skyfield.', url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/' },
  { n: 4, text: 'JPL Horizons System, used as the independent reference for Sun and Earth directions.', url: 'https://ssd.jpl.nasa.gov/horizons/' },
  { n: 5, text: 'NASA SVS #14959: Moon 3D Models for Web, AR, and Animation (LRO LROC & LOLA teams, Scientific Visualization Studio).', url: 'https://svs.gsfc.nasa.gov/14959/' },
  { n: 6, text: 'NASA, Artemis III candidate landing regions (October 2024).', url: 'https://www.nasa.gov/mission/artemis-iii/' },
]

export function Landing() {
  const [vec, setVec] = useState<Float32Array | null>(null)
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [validation, setValidation] = useState<Validation | null>(null)
  const [figMode, setFigMode] = useState<'3d' | '2d'>('3d')

  useEffect(() => {
    loadVectors(DEFAULT_YEAR).then(setVec, () => setVec(null))
    loadValidation().then(setValidation, () => setValidation(null))
  }, [])

  const hours = vec ? vec.length / 6 : 8760
  useEffect(() => {
    if (!playing || !vec) return
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      // 18 simulated hours per second: the Sun circles the pole once a lunar day, in about 40 s.
      // (a frame's timestamp can be a hair earlier than performance.now(), so clamp at 0)
      const dh = Math.min(Math.max(t - last, 0), 100) * 0.018
      last = t
      setHour((h) => (h + dh) % hours)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, vec, hours])

  const h = Math.floor(hour)
  const sun = vec ? { el: poleElevation(vec, h * 6), az: bearing(vec, h * 6) } : null
  const earth = vec ? { el: poleElevation(vec, h * 6 + 3), az: bearing(vec, h * 6 + 3) } : null

  return (
    <div className="landing">
      <header className="l-collar">
        <a className="l-mark" href="./" aria-label="Lunar South Pole Mission Planner, home">
          <svg width="28" height="28" viewBox="0 0 34 34" aria-hidden="true">
            <circle cx="17" cy="17" r="15.5" fill="none" stroke="var(--line-2)" />
            <circle cx="17" cy="17" r="9" fill="none" stroke="var(--line-2)" />
            <path d="M17 1.5v31M1.5 17h31" stroke="var(--line-2)" />
            <circle cx="28" cy="9.8" r="2.6" fill="var(--sun)" />
          </svg>
          <span>Lunar South Pole Mission Planner</span>
        </a>
        <nav aria-label="Page">
          <a href="#fig-2">Fig. 2</a>
          <a href="#contents">Screens</a>
          <a href="#method">Method</a>
          <a href="#refs">References</a>
          <a className="l-open" href="?view=site">Open the planner</a>
        </nav>
      </header>

      <section className="l-hero" aria-labelledby="l-title">
        <figure className="l-fig1">
          <div className="l-fig1-head">
            <span className="l-fig-designation">Fig. 1 · {figMode === '3d' ? '3D Lunar Globe' : 'Polar Map Plate'}</span>
            <div className="l-fig1-tabs" role="tablist" aria-label="Figure 1 visualization mode">
              <button
                type="button"
                role="tab"
                aria-selected={figMode === '3d'}
                className={`l-fig1-tab ${figMode === '3d' ? 'is-active' : ''}`}
                onClick={() => setFigMode('3d')}
              >
                3D Moon (NASA LRO)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={figMode === '2d'}
                className={`l-fig1-tab ${figMode === '2d' ? 'is-active' : ''}`}
                onClick={() => setFigMode('2d')}
              >
                2D Polar Map
              </button>
            </div>
          </div>

          {figMode === '3d' ? (
            <Moon3DHero vec={vec} hour={hour} sun={sun} earth={earth} />
          ) : (
            <PolarPlate sun={sun} earth={earth} />
          )}

          <figcaption>
            {figMode === '3d' ? (
              <>
                <b>Fig. 1.</b> Interactive 3D Moon model rendered from NASA Lunar Reconnaissance Orbiter (LRO) data [SVS #14959] with
                LOLA laser altimetry elevation topography and LROC color mapping [1][2]. The Moon is dynamically lit in real time by the
                hourly JPL DE421 solar ephemeris vector [3]. Drag to rotate and inspect surface topography; scrub the timeline below to sweep the
                calculated solar terminator across polar craters.
              </>
            ) : (
              <>
                <b>Fig. 1.</b> Long-term sunlight, 85°–90° S, polar stereographic, 0° E at top [1]. Brighter ground is lit more of the
                time; the black crater floors never see the Sun. Rim markers show where the Sun and Earth stand, seen from the pole, at the
                hour shown [3].
              </>
            )}
          </figcaption>
        </figure>

        <div className="l-hero-text">
          <h1 id="l-title">At the lunar south pole the Sun never rises more than about 1.6° above the horizon.</h1>
          <p className="l-lead">
            It circles the skyline once a lunar day. A lander there has power only while no ridge stands between it and the Sun, and
            can talk home only while Earth clears the same skyline. Land a few days later and both can change.
          </p>
          <p className="l-lead">
            This planner traces that skyline from NASA laser altimetry for any site near the pole and works out, hour by hour for a
            whole year, when the Sun and Earth are in view.
          </p>
          <div className="l-actions">
            <a className="l-btn l-btn-primary" href="?view=site">Open the planner</a>
            <a className="l-link" href="?view=validation">How the numbers are checked</a>
          </div>

          <table className="l-titleblock" aria-label="About Fig. 1">
            <tbody>
              <tr>
                <th scope="row">Source</th>
                <td>{figMode === '3d' ? 'NASA LRO SVS #14959 (LROC / LOLA)' : 'NASA PGDA Polar Illumination [1]'}</td>
              </tr>
              <tr>
                <th scope="row">Terrain</th>
                <td>{figMode === '3d' ? 'LOLA LDEM relief normals (1× / 2.5×)' : 'LOLA LDEM, 240 m per pixel [2]'}</td>
              </tr>
              <tr>
                <th scope="row">Ephemeris</th>
                <td>JPL DE421, hourly Sun &amp; Earth vectors [3]</td>
              </tr>
              <tr>
                <th scope="row">Hour shown</th>
                <td>{vec ? `${fmtDate(DEFAULT_YEAR, h)} ${DEFAULT_YEAR} UTC` : 'Loading ephemeris'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="l-scrub" aria-label="Time at the south pole">
          <div className="l-read">
            <span><i className="dot sun" />Sun {sun ? <><b>{signed(sun.el)}</b> toward {sun.az.toFixed(0)}° E</> : '…'}</span>
            <span><i className="dot earth" />Earth {earth ? <><b>{signed(earth.el, 1)}</b> toward {earth.az.toFixed(0)}° E</> : '…'}</span>
            <span className="l-read-note">Elevation above a flat horizon at 90° S; terrain is added per site in the planner.</span>
            <button type="button" className="l-play" onClick={() => setPlaying(!playing)} aria-pressed={playing}>
              {playing ? 'Pause' : 'Play'}
            </button>
          </div>
          <YearTrack vec={vec} hour={hour} onScrub={(x) => { setPlaying(false); setHour(x) }} />
        </div>
      </section>

      <div className="l-doc">
        <SiteCalendar />

        <section className="l-sec" id="contents" aria-labelledby="l-contents-title">
          <aside className="l-margin" aria-hidden="true">Contents</aside>
          <div className="l-main">
            <h2 id="l-contents-title">Eight screens over the same hourly data</h2>
            <ol className="l-rows">
              {SCREENS.map((s) => (
                <li key={s.view}>
                  <a href={`?view=${s.view}`}>
                    <span className="l-row-name">{s.name}</span>
                    <span className="l-row-what">{s.what}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="l-sec" id="method" aria-labelledby="l-method-title">
          <aside className="l-margin" aria-hidden="true">Method</aside>
          <div className="l-main l-prose">
            <h2 id="l-method-title">How it is computed and checked</h2>
            <p>
              For each site the horizon is traced in every direction across NASA's LOLA terrain [2], allowing for the Moon's curvature.
              Sun and Earth positions come from the JPL DE421 ephemeris for every hour of the chosen year [3]. A body counts as in view
              for the part of its disc that stands above that horizon.
            </p>
            <p>
              The directions agree with JPL Horizons [4] to within{' '}
              <b>{validation ? `${validation.horizons.worst_deg.toFixed(5)}°` : '…'}</b> over{' '}
              {validation ? validation.horizons.samples.toLocaleString('en') : '…'} hourly comparisons, against a pass mark of{' '}
              {validation ? `${validation.horizons.tolerance_deg}°` : '…'}. Long-term sunlit fractions correlate at{' '}
              <b>{validation ? validation.illumination.sun.correlation.toFixed(3) : '…'}</b> with NASA's illumination map [1], with a
              median difference of {validation ? validation.illumination.sun.median_abs_diff_pp : '…'} percentage points over{' '}
              {validation ? validation.illumination.points : '…'} polar points.
            </p>
            <p className="l-caveat">
              Visibility here is geometric: Earth above the horizon means a clear line of sight, not a guaranteed radio link. Times are
              to the nearest hour; terrain finer than 240 m is smoothed out.
            </p>
            <a className="l-link" href="?view=validation">All checks, with the commands to rerun them</a>
          </div>
        </section>

        <section className="l-sec" id="refs" aria-labelledby="l-refs-title">
          <aside className="l-margin" aria-hidden="true">References</aside>
          <div className="l-main">
            <h2 id="l-refs-title" className="visually-hidden">References</h2>
            <ol className="l-refs">
              {REFS.map((r) => (
                <li key={r.n}>
                  <span className="l-ref-n">[{r.n}]</span>
                  <a href={r.url} target="_blank" rel="noreferrer">{r.text}</a>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      <footer className="l-foot">
        <span>Lunar South Pole Mission Planner · NASA Space Apps Challenge 2026</span>
        <span>Set in Archivo. Data from NASA and JPL; the full list is on the <a href="?view=validation">validation</a> screen.</span>
        <a className="l-btn l-btn-primary" href="?view=site">Open the planner</a>
      </footer>
    </div>
  )
}

/** Fig. 1: NASA's long-term illumination map in a polar chart frame, with the hour's Sun and Earth bearings. */
function PolarPlate({
  sun,
  earth,
}: {
  sun: { el: number; az: number } | null
  earth: { el: number; az: number } | null
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      const bmp = await createImageBitmap(await (await fetch(`${base}data/map/sun_pct.png`)).blob(), {
        colorSpaceConversion: 'none', premultiplyAlpha: 'none',
      })
      const c = canvas.current
      if (!live || !c) return
      c.width = bmp.width
      c.height = bmp.height
      const g = c.getContext('2d')!
      g.drawImage(bmp, 0, 0)
      const img = g.getImageData(0, 0, bmp.width, bmp.height)
      const px = img.data
      // Sunlit % (0–100) to a warm ink ramp: never lit = plate, always lit = pale sunlight.
      const lo = [13, 12, 10]
      const mid = [118, 104, 84]
      const hi = [246, 214, 158]
      for (let k = 0; k < px.length; k += 4) {
        const t = Math.min(px[k], 100) / 100
        const a = t < 0.55 ? lo : mid
        const b = t < 0.55 ? mid : hi
        const u = t < 0.55 ? (t / 0.55) ** 0.9 : (t - 0.55) / 0.45
        px[k] = a[0] + (b[0] - a[0]) * u
        px[k + 1] = a[1] + (b[1] - a[1]) * u
        px[k + 2] = a[2] + (b[2] - a[2]) * u
      }
      g.putImageData(img, 0, 0)
      setReady(true)
    })().catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // Chart geometry in a 1000-unit frame: the 85° S circle has radius R; stereographic radii inside it.
  const C = 500
  const R = 400
  const rOf = (lat: number) => (R * Math.tan(((90 + lat) * D2R) / 2)) / Math.tan((5 * D2R) / 2)
  const at = (r: number, lon: number) => [C + r * Math.sin(lon * D2R), C - r * Math.cos(lon * D2R)] as const
  const MERIDIANS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

  const marker = (b: { az: number } | null, cls: string, label: string) => {
    if (!b) return null
    const [x, y] = at(R + 28, b.az)
    const [x0, y0] = at(R, b.az)
    const below = b.az > 90 && b.az < 270
    return (
      <g className={cls}>
        <line x1={C} y1={C} x2={x0} y2={y0} className="pp-ray" />
        <circle cx={x} cy={y} r={cls === 'pp-sun' ? 10 : 8} />
        <text x={x} y={y} dy={below ? 32 : -20} textAnchor="middle">{label}</text>
      </g>
    )
  }

  return (
    <div className={`pp${ready ? ' is-ready' : ''}`}>
      <canvas ref={canvas} className="pp-map" aria-hidden="true" />

      <svg viewBox="0 0 1000 1000" className="pp-chart" role="img" aria-label="Polar chart of long-term sunlight with the current Sun and Earth bearings">
        {/* Polar graticule rings */}
        {[86, 87, 88, 89].map((l) => (
          <g key={l}>
            <circle cx={C} cy={C} r={rOf(-l)} className="pp-grat" />
            <text x={C + 5} y={C - rOf(-l) - 5} className="pp-lat">{l}° S</text>
          </g>
        ))}

        {/* Meridians */}
        {MERIDIANS.map((lon) => {
          const [x, y] = at(R, lon)
          const [x1, y1] = at(rOf(-89), lon)
          return <line key={lon} x1={x1} y1={y1} x2={x} y2={y} className="pp-grat" />
        })}

        <circle cx={C} cy={C} r={R} className="pp-neat" />
        <circle cx={C} cy={C} r={R + 50} className="pp-neat pp-outer" />

        {/* 5-deg Rim Ticks */}
        {Array.from({ length: 72 }, (_, k) => k * 5).map((t) => {
          const [x1, y1] = at(R, t)
          const [x2, y2] = at(R + (t % 30 === 0 ? 16 : t % 10 === 0 ? 10 : 6), t)
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className="pp-tick" />
        })}

        {/* Meridian degree labels */}
        {MERIDIANS.map((lon) => {
          const [x, y] = at(R + 74, lon)
          const name = lon === 0 ? '0°' : lon === 180 ? '180°' : lon < 180 ? `${lon}° E` : `${360 - lon}° W`
          return <text key={lon} x={x} y={y} dy="0.35em" textAnchor="middle" className="pp-lon">{name}</text>
        })}

        {marker(earth, 'pp-earth', 'Earth')}
        {marker(sun, 'pp-sun', 'Sun')}

        {/* 50 km Scale Bar */}
        <g className="pp-scale" transform={`translate(${C + R - (R * 50) / 151.7} ${C + R + 44})`}>
          <line x1="0" x2={(R * 50) / 151.7} y1="0" y2="0" />
          <line x1="0" x2="0" y1="-5" y2="5" />
          <line x1={(R * 50) / 151.7} x2={(R * 50) / 151.7} y1="-5" y2="5" />
          <text x={(R * 50) / 151.7} y="-12" textAnchor="end">50 km</text>
        </g>
      </svg>
    </div>
  )
}

/** The year as the scrubber's track: Sun (amber) and Earth (blue) elevation at the pole. */
function YearTrack({ vec, hour, onScrub }: { vec: Float32Array | null; hour: number; onScrub: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const n = vec ? vec.length / 6 : 8760
  const W = 1200
  const H = 56
  const EL = 7 // ±7° vertical range: covers Earth's libration
  const y = (el: number) => H / 2 - (el / EL) * (H / 2 - 4)
  const { sunPath, earthPath, peak } = useMemo(() => {
    if (!vec) return { sunPath: '', earthPath: '', peak: 0 }
    let s = ''
    let e = ''
    let pk = -90
    for (let h = 0; h < n; h += 3) {
      const x = ((h / (n - 1)) * W).toFixed(1)
      const se = poleElevation(vec, h * 6)
      pk = Math.max(pk, se)
      s += `${h ? 'L' : 'M'}${x} ${y(se).toFixed(2)}`
      e += `${h ? 'L' : 'M'}${x} ${y(poleElevation(vec, h * 6 + 3)).toFixed(2)}`
    }
    return { sunPath: s, earthPath: e, peak: pk }
  }, [vec, n])

  const fromEvent = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    onScrub(Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * (n - 1))
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return (
    <div className="l-track">
      <div className="l-track-row">
        <div className="l-track-axis" aria-hidden="true">
          <span>+7°</span>
          <span>0°</span>
          <span>−7°</span>
        </div>
        <div
          className="l-track-plot"
          ref={ref}
          role="slider"
          tabIndex={0}
          aria-label={`Hour of ${DEFAULT_YEAR}`}
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={Math.floor(hour)}
          aria-valuetext={fmtDate(DEFAULT_YEAR, Math.floor(hour))}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            fromEvent(e.clientX)
          }}
          onPointerMove={(e) => e.buttons && fromEvent(e.clientX)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 24 * 7 : 24
            if (e.key === 'ArrowRight') onScrub(Math.min(hour + step, n - 1))
            else if (e.key === 'ArrowLeft') onScrub(Math.max(hour - step, 0))
            else return
            e.preventDefault()
          }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="l-zero" />
            <path d={earthPath} className="l-earth-path" />
            <path d={sunPath} className="l-sun-path" />
          </svg>
          <div className="l-cursor" style={{ left: `${(hour / (n - 1)) * 100}%` }} />
        </div>
      </div>
      <div className="l-months" aria-hidden="true">
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <p className="l-track-note">
        {DEFAULT_YEAR}, hourly. Drag the track or use the arrow keys.{vec && <> Highest Sun at the pole this year: <b>{signed(peak)}</b>.</>}
      </p>
    </div>
  )
}

/** Fig. 2: a year at one site as a calendar: rows are months, columns are hours, colour is what is in view. */
function SiteCalendar() {
  const [id, setId] = useState(CALENDAR_SITES[0].id)
  const [site, setSite] = useState<Site | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let live = true
    loadSite(id).then((s) => live && setSite(s), () => live && setSite(null))
    return () => {
      live = false
    }
  }, [id])

  useEffect(() => {
    const c = canvas.current
    if (!c || !site) return
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      const w = c.clientWidth
      const rowH = 14
      const gap = 6
      c.width = Math.round(w * dpr)
      c.height = Math.round((12 * rowH + 11 * gap) * dpr)
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      const css = getComputedStyle(c)
      const col = {
        both: css.getPropertyValue('--both').trim(), sun: css.getPropertyValue('--sun').trim(),
        earth: css.getPropertyValue('--earth').trim(), none: '#24231f',
      }
      const year = new Date(site.start_utc).getUTCFullYear()
      const px = w / (31 * 24)
      for (let m = 0; m < 12; m++) {
        const start = (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 3600e3
        const end = Math.min((Date.UTC(year, m + 1, 1) - Date.UTC(year, 0, 1)) / 3600e3, site.samples)
        const y0 = m * (rowH + gap)
        let runStart = start
        let runState = stateAt(site, start)
        for (let i = start + 1; i <= end; i++) {
          const st = i < end ? stateAt(site, i) : null
          if (st !== runState) {
            g.fillStyle = col[runState]
            g.fillRect((runStart - start) * px, y0, (i - runStart) * px + 0.35, rowH)
            runStart = i
            if (st) runState = st
          }
        }
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [site])

  const m = site?.metrics
  return (
    <section className="l-sec" id="fig-2" aria-labelledby="l-cal-title">
      <aside className="l-margin" aria-hidden="true">Fig. 2</aside>
      <div className="l-main">
        <h2 id="l-cal-title">A few kilometres decide whether a lander has power, contact, both or neither</h2>
        <div className="l-cal-tools">
          <div className="seg" role="group" aria-label="Site">
            {CALENDAR_SITES.map((s) => (
              <button key={s.id} aria-pressed={id === s.id} onClick={() => setId(s.id)}>
                {s.short}
              </button>
            ))}
          </div>
          <ul className="legend">
            <li><span className="swatch st-both" />Power and contact</li>
            <li><span className="swatch st-sun" />Power only</li>
            <li><span className="swatch st-earth" />Contact only</li>
            <li><span className="swatch l-swatch-none" />Neither</li>
          </ul>
        </div>
        <div className="l-cal-plate">
          <div className="l-cal-months" aria-hidden="true">
            {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          <canvas ref={canvas} className="l-cal-canvas" role="img" aria-label={site ? `Hourly visibility calendar for ${site.name}, ${DEFAULT_YEAR}` : 'Loading'} />
          <div className="l-cal-days" aria-hidden="true">
            {[1, 8, 15, 22, 29].map((d) => (
              <span key={d} style={{ left: `${((d - 1) / 31) * 100}%` }}>Day {d}</span>
            ))}
          </div>
        </div>
        <p className="l-figcap">
          <b>Fig. 2.</b> Every hour of {DEFAULT_YEAR} at {site?.name ?? '…'}: one row per month, one column per hour, coloured by what
          stands above the local terrain [2][3]. Sunlit {m ? `${m.sunlit_pct.toFixed(1)}%` : '…'} of the year, Earth in view{' '}
          {m ? `${m.earth_visible_pct.toFixed(1)}%` : '…'}, both {m ? `${m.sun_and_earth_pct.toFixed(1)}%` : '…'}; longest darkness{' '}
          {m ? formatDuration(m.longest_dark_h) : '…'}. <a href={`?view=site&site=${id}`}>Open this site in the planner</a>
        </p>
      </div>
    </section>
  )
}
