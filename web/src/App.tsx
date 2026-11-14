import { useEffect, useState } from 'react'
import {
  DEFAULT_THRESHOLDS, KIND_LABEL, STATE_LABEL, formatDeg, formatDuration, horizonAt, hoursSinceChange, hoursToChange, loadSite, loadSites,
  stateAt,
  type Site, type SiteSummary, type Thresholds,
} from './data'
import { HorizonDial } from './HorizonDial'
import { Planner } from './Planner'
import { Seasons } from './Seasons'
import { Survival } from './Survival'
import { Timeline } from './Timeline'
import { YearStrip } from './YearStrip'

const STEPS = [
  { label: '−1 d', h: -24 },
  { label: '−1 h', h: -1 },
  { label: '+1 h', h: 1 },
  { label: '+1 d', h: 24 },
]

// Permalink: the whole scenario lives in the URL query (?site=&t=&plan=&m=&sun=&dark=&earth=).
const params = new URLSearchParams(location.search)
const num = (k: string, d: number) => {
  const v = Number(params.get(k))
  return params.has(k) && Number.isFinite(v) ? v : d
}

export default function App() {
  const [sites, setSites] = useState<SiteSummary[]>([])
  const [siteId, setSiteId] = useState('')
  const [site, setSite] = useState<Site | null>(null)
  const [i, setI] = useState(num('t', 0))
  const [planned, setPlanned] = useState(num('plan', 0))
  const [th, setTh] = useState<Thresholds>({
    missionDays: num('m', DEFAULT_THRESHOLDS.missionDays),
    minSunPct: num('sun', DEFAULT_THRESHOLDS.minSunPct),
    maxDarkH: num('dark', DEFAULT_THRESHOLDS.maxDarkH),
    minEarthPct: num('earth', DEFAULT_THRESHOLDS.minEarthPct),
  })
  const [error, setError] = useState('')

  useEffect(() => {
    loadSites()
      .then((s) => {
        setSites(s)
        const wanted = params.get('site')
        setSiteId(s.some((x) => x.id === wanted) ? wanted! : (s[0]?.id ?? ''))
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  useEffect(() => {
    if (!siteId) return
    const q = new URLSearchParams({
      site: siteId, t: String(i), plan: String(planned),
      m: String(th.missionDays), sun: String(th.minSunPct), dark: String(th.maxDarkH), earth: String(th.minEarthPct),
    })
    history.replaceState(null, '', `?${q}`)
  }, [siteId, i, planned, th])

  useEffect(() => {
    if (!siteId) return
    loadSite(siteId).then(setSite).catch((e) => setError(String(e.message ?? e)))
  }, [siteId])

  const clampI = (n: number) => Math.min(Math.max(n, 0), (site?.samples ?? 1) - 1)

  useEffect(() => {
    if (!site) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      e.preventDefault()
      const step = (e.shiftKey ? 24 : 1) * (e.key === 'ArrowLeft' ? -1 : 1)
      setI((n) => Math.min(Math.max(n + step, 0), site.samples - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [site])

  return (
    <div className="app">
      <header className="top">
        <h1>Lunar South Pole Mission Planner</h1>
        <label className="site-pick">
          <span>Site</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {[...new Set(sites.map((s) => s.group))].map((g) => (
              <optgroup key={g} label={g}>
                {sites
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </header>

      {error && <p className="error">{error}</p>}
      {!site && !error && <p className="loading">Loading site data</p>}

      {site && (
        <>
          <main className="layout">
            <section className="dial-wrap" aria-label="Horizon dial">
              <HorizonDial site={site} i={i} />
              <p className="caption">
                Seen from above, north up. Ring = terrain horizon; dashed ring = flat horizon (0°). Elevation is
                stretched to make the low polar sky readable, so the drawing is not to scale. Paths show the next 14
                days.
              </p>
            </section>

            <section className="readout" aria-live="polite">
              <Status site={site} i={i} />
              <div className="bodies">
                <Body site={site} i={i} b="sun" />
                <Body site={site} i={i} b="earth" />
              </div>
              <SiteFacts site={site} />
            </section>
          </main>

          <section className="panel" aria-label="Landing date planner">
            <Planner site={site} i={i} setI={setI} planned={planned} setPlanned={setPlanned} th={th} setTh={setTh} />
          </section>

          <section className="panel" aria-label="Availability timeline">
            <Timeline site={site} i={i} onPick={setI} />
          </section>

          <div className="lower">
            <section className="panel" aria-label="Seasons">
              <Seasons site={site} i={i} />
            </section>
            <section className="panel" aria-label="Lander survival calculator">
              <Survival site={site} i={i} />
            </section>
          </div>

          <footer className="foot">
            {site.provenance} Times are to the nearest hour.
          </footer>

          <section className="time" aria-label="Time">
            <YearStrip site={site} i={i} />
            <input
              type="range"
              min={0}
              max={site.samples - 1}
              value={i}
              onChange={(e) => setI(Number(e.target.value))}
              aria-label="Time, hourly through the data period"
            />
            <div className="time-row">
              <div className="steps">
                {STEPS.map((s) => (
                  <button key={s.label} onClick={() => setI(clampI(i + s.h))}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="keys">
                <kbd>←</kbd> <kbd>→</kbd> 1 hour, with <kbd>Shift</kbd> 1 day
              </p>
              <Legend />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Status({ site, i }: { site: Site; i: number }) {
  const s = stateAt(site, i)
  return (
    <div className={`status st-${s}-border`}>
      <span className={`swatch st-${s}`} aria-hidden="true" />
      {STATE_LABEL[s]}
    </div>
  )
}

function Body({ site, i, b }: { site: Site; i: number; b: 'sun' | 'earth' }) {
  const t = site[b]
  const name = b === 'sun' ? 'Sun' : 'Earth'
  const visible = t.frac[i] > 0
  const h = hoursToChange(t.frac, i)
  const next = b === 'sun' ? (visible ? 'Sunset' : 'Sunrise') : visible ? 'Earthset' : 'Earthrise'
  const hz = horizonAt(site, t.az[i])
  const since = hoursSinceChange(t.frac, i)
  const sinceLabel =
    b === 'sun' ? (visible ? 'In sunlight for' : 'In darkness for') : visible ? 'Earth in view for' : 'Out of contact for'
  return (
    <div className={`body-card body-card-${b}`}>
      <h2>
        {name}
        <span className={visible ? 'pill on' : 'pill off'}>{visible ? 'In view' : 'Hidden'}</span>
      </h2>
      <p className="hero">{formatDeg(t.el[i])}</p>
      <p className="hero-label">elevation above flat horizon</p>
      <dl>
        <dt>Terrain horizon there</dt>
        <dd>{formatDeg(hz)}</dd>
        <dt>Disc above terrain</dt>
        <dd>{Math.round(t.frac[i] * 100)}%</dd>
        <dt>{next}</dt>
        <dd>{h === null ? 'None before the data ends' : `in ${formatDuration(h)}`}</dd>
        <dt>{sinceLabel}</dt>
        <dd>
          {since.atStart ? 'at least ' : ''}
          {formatDuration(since.h)}
        </dd>
        {t.power && (
          <>
            <dt>Power index (simplified)</dt>
            <dd>{Math.round(t.power[i] * 100)}%</dd>
          </>
        )}
        <dt>Azimuth</dt>
        <dd>{t.az[i].toFixed(1)}°</dd>
      </dl>
    </div>
  )
}

function SiteFacts({ site }: { site: Site }) {
  const m = site.metrics
  const lon = site.lon > 180 ? site.lon - 360 : site.lon
  return (
    <div className="facts">
      <h2>
        Over {new Date(site.start_utc).getUTCFullYear()}
        <span className={`pill kind-${site.kind}`}>{KIND_LABEL[site.kind]}</span>
      </h2>
      <dl>
        <dt>Sunlit</dt>
        <dd>{m.sunlit_pct.toFixed(1)}% of the time</dd>
        <dt>Earth in view</dt>
        <dd>{m.earth_visible_pct.toFixed(1)}%</dd>
        <dt>Both</dt>
        <dd>{m.sun_and_earth_pct.toFixed(1)}%</dd>
        <dt>Mean power index</dt>
        <dd>{m.mean_power_index_pct.toFixed(1)}%</dd>
        <dt>Longest darkness</dt>
        <dd>{formatDuration(m.longest_dark_h)}</dd>
        <dt>Longest without Earth</dt>
        <dd>{formatDuration(m.longest_no_earth_h)}</dd>
        <dt>Location</dt>
        <dd>
          {Math.abs(site.lat).toFixed(3)}° S, {Math.abs(lon).toFixed(2)}° {lon >= 0 ? 'E' : 'W'}
        </dd>
        <dt>Terrain height</dt>
        <dd>{site.site_height_m.toFixed(0)} m (+{site.obs_height_m} m mast)</dd>
      </dl>
      <p className="note">{site.note}</p>
      <p className="note">
        Coordinates: <a href={site.source_url} target="_blank" rel="noreferrer">{site.source}</a>
      </p>
    </div>
  )
}

function Legend() {
  const items = [
    ['both', 'Power and contact'],
    ['sun', 'Power only'],
    ['earth', 'Contact only'],
    ['none', 'Neither'],
  ] as const
  return (
    <ul className="legend">
      {items.map(([k, l]) => (
        <li key={k}>
          <span className={`swatch st-${k}`} aria-hidden="true" />
          {l}
        </li>
      ))}
    </ul>
  )
}
