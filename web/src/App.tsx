import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_ARRAY, DEFAULT_THRESHOLDS, KIND_LABEL, peakWatts, type SolarArray, STATE_LABEL, formatDeg, formatDuration, getSiteScienceStats, horizonAt, hoursSinceChange, hoursToChange, inAnalysisYear, loadSite, loadSites,
  loadValidation, stateAt,
  type Site, type SiteSummary, type Thresholds, type Validation as ValidationData,
} from './data'
import { HorizonDial } from './HorizonDial'
import { Compare, type Scenario } from './Compare'
import { computeCustomPoint } from './customPoint'
import { Finder } from './Finder'
import { MapView } from './MapView'
import { Ellipse, type EllipseOverlay } from './Ellipse'
import { saved as ellipseSaved } from './ellipseCheck'
import { Planner } from './Planner'
import { Seasons } from './Seasons'
import { Sources } from './Sources'
import { Survival } from './Survival'
import { Timeline } from './Timeline'
import { YearStrip } from './YearStrip'
// WS2
import { Why } from './explain/Why'
import { Contrast } from './explain/Contrast'
// WS3
import { Replays } from './Replays'
import { Validation } from './Validation'
import { ARTEMIS_3_SITES, type ArtemisSiteData } from './data/artemisData'
// WS5
import './styles/analysis.css'
// Lander Systems
import { LanderSystems } from './LanderSystems'
// Any landing year
import { DEFAULT_YEAR, loadVectors, loadYears, siteForYear } from './years'
// Typed coordinates
import { CoordInput } from './CoordInput'

// three.js is large: load the 3D view only when it's opened.
const Terrain3D = lazy(() => import('./Terrain3D').then((m) => ({ default: m.Terrain3D })))
const Globe = lazy(() => import('./Globe').then((m) => ({ default: m.Globe })))

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
  // Any landing year: baseSite is the site as loaded or computed; site is it recomputed for the chosen year.
  const [baseSite, setBaseSite] = useState<Site | null>(null)
  const [year, setYear] = useState(num('y', DEFAULT_YEAR))
  const [years, setYears] = useState<number[]>([DEFAULT_YEAR])
  const [yearVectors, setYearVectors] = useState<Float32Array | null>(null)
  const [arr, setArr] = useState<SolarArray>(DEFAULT_ARRAY) // solar array for the watts readouts
  const [i, setI] = useState(num('t', 0))
  const [planned, setPlanned] = useState(num('plan', 0))
  const [th, setTh] = useState<Thresholds>({
    missionDays: num('m', DEFAULT_THRESHOLDS.missionDays),
    minSunPct: num('sun', DEFAULT_THRESHOLDS.minSunPct),
    maxDarkH: num('dark', DEFAULT_THRESHOLDS.maxDarkH),
    minEarthPct: num('earth', DEFAULT_THRESHOLDS.minEarthPct),
  })
  const [error, setError] = useState('')
  const [validation, setValidation] = useState<ValidationData | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(6) // hours per frame
  type View = 'site' | 'find' | 'compare' | 'globe' | 'map' | '3d' | 'validation' | 'lander'
  const [view, setView] = useState<View>((['find', 'compare', 'globe', 'map', '3d', 'validation', 'lander'] as const).find((v) => v === params.get('view')) ?? 'site')
  const [findRadius, setFindRadius] = useState(0) // radius for Find sites when opened from the planner
  useEffect(() => {
    if (view !== 'find') setFindRadius(0)
  }, [view])
  const [ellipse, setEllipse] = useState<EllipseOverlay | null>(null)
  // The ellipse overlay belongs to the site it was drawn for (it stays when switching between Map and 3D).
  const ell = ellipse && site && ellipse.focus.lat === site.lat && ellipse.focus.lon === site.lon ? ellipse : null

  // Artemis III candidate matching site
  const artemisMatch = useMemo(() => {
    if (!site) return null
    return (
      ARTEMIS_3_SITES.find((a) => {
        if (site.id === `artemis-${a.id}`) return true
        if (site.name.toLowerCase().includes(a.name.toLowerCase())) return true
        const dLon = Math.abs((((a.lon - site.lon) % 360) + 540) % 360 - 180)
        return Math.hypot(a.lat - site.lat, dLon * Math.cos(((a.lat + site.lat) * 0.5 * Math.PI) / 180)) < 0.5
      }) ?? null
    )
  }, [site])
  const [busy, setBusy] = useState(false)
  const [pickError, setPickError] = useState('')
  const [scenarios, setScenarios] = useState<Scenario[]>(
    (params.get('cmp') ?? '')
      .split(',')
      .map((x) => x.split('@'))
      .filter(([id, t]) => id && Number.isFinite(Number(t)))
      .map(([id, t, y]) => ({ siteId: id, t: Number(t), ...(Number(y) ? { y: Number(y) } : {}) })),
  )

  // Entering Compare with nothing set up: current site and time vs the next site at the same time.
  const openCompare = () => {
    if (scenarios.length < 2 && site) {
      const other = sites.find((x) => x.id !== site.id)?.id ?? site.id
      setScenarios([{ siteId: site.id, t: i, y: year }, { siteId: other, t: i, y: year }])
    }
    setView('compare')
  }

  const pickArtemisSite = (a: ArtemisSiteData) => {
    setSiteId(`artemis-${a.id}`)
    setBusy(true)
    setPickError('')
    computeCustomPoint(a.lat, a.lon)
      .then((c) => {
        const customSite: Site = {
          ...c,
          id: `artemis-${a.id}`,
          group: 'Artemis III Candidate Landing Sites',
          name: `${a.name} (Artemis III Candidate)`,
        }
        setSites((prev) => [
          ...prev.filter((x) => x.id !== `artemis-${a.id}`),
          {
            id: customSite.id,
            group: customSite.group,
            name: customSite.name,
            kind: 'custom',
            metrics: customSite.metrics,
            lat: customSite.lat,
            lon: customSite.lon,
          },
        ])
        setBaseSite(customSite)
        setSiteId(`artemis-${a.id}`)
      })
      .catch((e) => setPickError(`Couldn't compute that point: ${e.message}`))
      .finally(() => setBusy(false))
  }

  // F6a: a map click becomes site 'custom', computed in a Web Worker.
  const pickPoint = (lat: number, lon: number) => {
    const artemisMatch = ARTEMIS_3_SITES.find((a) => {
      const dLon = Math.abs((((a.lon - lon) % 360) + 540) % 360 - 180)
      return Math.hypot(a.lat - lat, dLon * Math.cos(((a.lat + lat) * 0.5 * Math.PI) / 180)) < 0.35
    })
    if (artemisMatch) {
      pickArtemisSite(artemisMatch)
      return
    }
    setBusy(true)
    setPickError('')
    computeCustomPoint(lat, lon)
      .then((c) => {
        const { id, group, name, kind, metrics } = c
        setSites((prev) => [...prev.filter((x) => x.id !== 'custom'), { id, group, name, kind, metrics, lat: c.lat, lon: c.lon }])
        setBaseSite(c)
        setSiteId('custom')
      })
      .catch((e) => setPickError(`Couldn't compute that point: ${e.message}`))
      .finally(() => setBusy(false))
  }

  const addToCompare = () => {
    if (!site) return
    const other = sites.find((x) => x.id !== site.id)?.id ?? site.id
    const mine = { siteId: site.id, t: i, y: year }
    setScenarios(scenarios.length < 2 ? [mine, { siteId: other, t: i, y: year }] : scenarios.length < 4 ? [...scenarios, mine] : [...scenarios.slice(0, 3), mine])
    setView('compare')
  }

  useEffect(() => {
    loadValidation().then(setValidation, () => setValidation(null))
  }, [])

  // Play: advance time a few frames a second; stops at the end of the data.
  useEffect(() => {
    if (!playing || !site) return
    const id = setInterval(() => {
      setI((n) => {
        if (n + speed >= site.samples - 1) {
          setPlaying(false)
          return site.samples - 1
        }
        return n + speed
      })
    }, 120)
    return () => clearInterval(id)
  }, [playing, speed, site])

  useEffect(() => {
    loadSites()
      .then((s) => {
        setSites(s)
        const wanted = params.get('site')
        const pin = (params.get('pin') ?? '').split(',').map(Number)
        if (wanted?.startsWith('artemis-')) {
          const a = ARTEMIS_3_SITES.find((x) => `artemis-${x.id}` === wanted)
          if (a) pickArtemisSite(a)
        } else if (wanted === 'custom' && pin.length === 2 && pin.every(Number.isFinite)) {
          pickPoint(pin[0], pin[1])
        } else {
          setSiteId(s.some((x) => x.id === wanted) ? wanted! : (s[0]?.id ?? ''))
        }
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  useEffect(() => {
    if (!siteId) return
    const q = new URLSearchParams({
      site: siteId, y: String(year), t: String(i), plan: String(planned),
      m: String(th.missionDays), sun: String(th.minSunPct), dark: String(th.maxDarkH), earth: String(th.minEarthPct),
    })
    if (view !== 'site') q.set('view', view)
    if (siteId === 'custom' && site?.kind === 'custom') q.set('pin', `${site.lat},${site.lon}`)
    if (scenarios.length) q.set('cmp', scenarios.map((x) => `${x.siteId}@${x.t}${x.y ? `@${x.y}` : ''}`).join(','))
    history.replaceState(null, '', `?${q}`)
  }, [siteId, year, i, planned, th, view, scenarios, site])

  useEffect(() => {
    if (!siteId || siteId === 'custom' || siteId.startsWith('artemis-')) return
    loadSite(siteId).then(setBaseSite).catch((e) => setError(String(e.message ?? e)))
  }, [siteId])

  // Any landing year: recompute the site for the chosen year (replays keep their real dates).
  useEffect(() => {
    loadYears().then(setYears, () => setYears([DEFAULT_YEAR]))
  }, [])
  useEffect(() => {
    if (!baseSite) return
    let live = true
    siteForYear(baseSite, year)
      .then((s) => {
        if (!live) return
        setSite(s)
        setI((n) => Math.min(n, s.samples - 1))
      })
      .catch((e) => setError(String(e.message ?? e)))
    return () => {
      live = false
    }
  }, [baseSite, year])
  useEffect(() => {
    let live = true
    loadVectors(year).then((v) => live && setYearVectors(v), () => live && setYearVectors(null))
    return () => {
      live = false
    }
  }, [year])

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
        <a className="mark" href="./" title="About this planner">
          <Mark />
          <h1>
            Lunar South Pole
            <span>Mission Planner</span>
          </h1>
        </a>
        {site && view !== 'compare' ? (
          <p className="sheet-id" aria-label="Current sheet">
            <b>{site.name}</b>
            <span>
              {Math.abs(site.lat).toFixed(3)}° {site.lat >= 0 ? 'N' : 'S'}, {Math.abs(site.lon > 180 ? site.lon - 360 : site.lon).toFixed(2)}° {(site.lon > 180 ? site.lon - 360 : site.lon) >= 0 ? 'E' : 'W'}
            </span>
            <span>{site.replay ? 'Replay' : year}</span>
          </p>
        ) : (
          <span />
        )}
        <div className="tools-row">
        {/* WS3 */}
        <button
          type="button"
          className="badge"
          onClick={() => setView('validation')}
          title="How the numbers were checked: open the validation proofs"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Checked against JPL Horizons{validation ? <b>max error {validation.horizons.worst_deg.toFixed(5)}°</b> : null}
        </button>
        </div>
        <nav className="views" aria-label="Screens">
          <button aria-pressed={view === 'site'} onClick={() => setView('site')}>
            Site and plan
          </button>
          <button aria-pressed={view === 'find'} onClick={() => setView('find')}>
            Find sites
          </button>
          <button aria-pressed={view === 'globe'} onClick={() => setView('globe')}>
            Globe
          </button>
          <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
            Map
          </button>
          <button aria-pressed={view === '3d'} onClick={() => setView('3d')}>
            3D
          </button>
          <button aria-pressed={view === 'compare'} onClick={openCompare}>
            Compare
          </button>
          {/* Lander Systems */}
          <button aria-pressed={view === 'lander'} onClick={() => setView('lander')}>
            Lander systems
          </button>
          <button onClick={() => { location.search = '?view=explorer' }}>
            Explorer 3D/2D
          </button>
        </nav>
        <div className="controls-row">
        {view !== 'compare' && (
          <label className="site-pick">
            <span>Site</span>
            <select
              value={siteId}
              onChange={(e) => {
                const val = e.target.value
                if (val.startsWith('artemis-')) {
                  const a = ARTEMIS_3_SITES.find((x) => `artemis-${x.id}` === val)
                  if (a) pickArtemisSite(a)
                } else {
                  setSiteId(val)
                }
              }}
            >
              <optgroup label="Artemis III Candidate Landing Sites">
                {ARTEMIS_3_SITES.map((a) => (
                  <option key={`artemis-${a.id}`} value={`artemis-${a.id}`}>
                    {a.name} ({a.lat}° S, {Math.abs(a.lon)}° {a.lon < 0 ? 'W' : 'E'})
                  </option>
                ))}
              </optgroup>
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
        )}
        {/* Any landing year */}
        {view !== 'compare' && (
          <label className="site-pick year-pick" title={site?.replay ? 'Mission replays use their real dates' : 'Landing year: every site is recomputed for it'}>
            <span>Year</span>
            <select value={site?.replay ? '' : year} disabled={!!site?.replay} onChange={(e) => setYear(Number(e.target.value))}>
              {site?.replay && <option value="">{new Date(site.start_utc).getUTCFullYear()} (replay)</option>}
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* Typed coordinates: same browser computation as a map click */}
        {view !== 'compare' && <CoordInput onGo={pickPoint} busy={busy} error={pickError} />}
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {!site && !error && <p className="loading">Loading site data</p>}

      {view === 'find' && (
        <section className="panel" aria-label="Alternatives finder">
          {/* WS3 */}
          {site && !inAnalysisYear(site) ? (
            <div className="replay-notice-card">
              <p>The site finder works on whole calendar years (pick the year at the top). Mission replays use their real dates and are shown on the Site and plan tab.</p>
              <button type="button" className="primary" onClick={() => setView('site')}>Return to Site &amp; Plan</button>
            </div>
          ) : (
            <Finder
              sites={sites}
              site={site}
              i={i}
              setI={setI}
              th={th}
              setTh={setTh}
              onPickSite={setSiteId}
              onPickPoint={pickPoint}
              busy={busy}
              pickError={pickError}
              onOpenSite={() => setView('site')}
              onCompare={addToCompare}
              onOpenMap={() => setView('map')}
              initialRadius={findRadius}
            />
          )}
        </section>
      )}

      {view === 'globe' && (
        <section className="panel" aria-label="Whole-Moon globe">
          {/* WS3 */}
          {site && !inAnalysisYear(site) ? (
            <div className="replay-notice-card">
              <p>The whole-Moon globe works on whole calendar years (pick the year at the top). Mission replays are shown on the Site and plan tab.</p>
              <button type="button" className="primary" onClick={() => setView('site')}>Return to Site &amp; Plan</button>
            </div>
          ) : (
            <Suspense fallback={<p className="loading">Loading the globe</p>}>
              <Globe
                site={site}
                sites={sites}
                i={i}
                onPickSite={setSiteId}
                onPickArtemisSite={pickArtemisSite}
                onOpen3D={() => setView('3d')}
                onOpenSite={() => setView('site')}
                onOpenArtemis={() => setView('3d')}
                onPickPoint={pickPoint}
                vectors={yearVectors}
              />
            </Suspense>
          )}
        </section>
      )}

      {view === '3d' && (
        <section className="panel" aria-label="3D south-pole terrain">
          {/* WS3 */}
          {site && !inAnalysisYear(site) ? (
            <div className="replay-notice-card">
              <p>3D GPU shadows work on whole calendar years (pick the year at the top). Mission replays are shown on the Site and plan tab.</p>
              <button type="button" className="primary" onClick={() => setView('site')}>Return to Site &amp; Plan</button>
            </div>
          ) : (
            <Suspense fallback={<p className="loading">Loading the 3D view</p>}>
              <Terrain3D
                site={site}
                sites={sites}
                i={i}
                setI={setI}
                planned={planned}
                setPlanned={setPlanned}
                th={th}
                setTh={setTh}
                onPickPoint={pickPoint}
                onPickArtemisSite={pickArtemisSite}
                onOpenSite={() => setView('site')}
                onFindAlternatives={
                  site && inAnalysisYear(site)
                    ? () => {
                        setFindRadius(site.lat <= -84 ? 25 : 0)
                        setView('find')
                      }
                    : undefined
                }
                ellipse={ell}
                vectors={yearVectors}
              />
            </Suspense>
          )}
        </section>
      )}

      {/* WS3 */}
      {view === 'validation' && (
        <section className="panel" aria-label="Validation proofs and scientific checks">
          <Validation onReturnToSite={() => setView('site')} />
        </section>
      )}

      {/* Lander Systems */}
      {view === 'lander' && (
        <section className="panel" aria-label="Lander systems engineering simulator">
          <LanderSystems site={site} i={i} year={year} vectors={yearVectors} />
        </section>
      )}

      {view === 'map' && (
        <section className="panel" aria-label="South-pole map">
          <MapView
            sites={sites}
            site={site}
            onPickSite={setSiteId}
            onPickPoint={pickPoint}
            busy={busy}
            pickError={pickError}
            onOpenSite={() => setView('site')}
            onCompare={addToCompare}
            dots={ell?.dots}
            outline={ell?.outline}
            focus={ell?.focus}
            cells={ell?.cells}
            verdict={ell?.verdict}
            maxSlope={ell?.maxSlope ?? ellipseSaved.maxSlope}
            areaKm={ell?.focus.km ?? ellipseSaved.spec.lengthKm}
            extra={site && !busy && <Ellipse site={site} th={th} i={i} onOverlay={setEllipse} />}
            onOpenArtemis={() => setView('3d')}
          />
        </section>
      )}

      {site && view === 'compare' && scenarios.length >= 2 && (
        <section className="panel" aria-label="Compare scenarios">
          <Compare sites={sites} scenarios={scenarios} setScenarios={setScenarios} th={th} year={year} arr={arr} />
          <footer className="foot">{site.provenance} Times are to the nearest hour.</footer>
        </section>
      )}

      {site && view === 'site' && (
        <>
          {artemisMatch && (
            <div className="region-strip">
              <span>
                <strong>Artemis III candidate region:</strong> {artemisMatch.name} ({Math.abs(artemisMatch.lat).toFixed(2)}° S, {Math.abs(artemisMatch.lon).toFixed(1)}° {artemisMatch.lon < 0 ? 'W' : 'E'}) · {artemisMatch.resources.water_ice_potential} water ice · {artemisMatch.minerals.crust_type}
              </span>
              <button type="button" onClick={() => setView('3d')}>
                Minerals and resources in 3D
              </button>
            </div>
          )}
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
                <Body site={site} i={i} b="sun" arr={arr} />
                <Body site={site} i={i} b="earth" />
              </div>
              <SiteFacts site={site} arr={arr} />
              {/* WS2 */}
              <Contrast site={site} i={i} />
              {/* WS3 */}
              <Replays
                currentSite={site}
                currentHourIndex={i}
                onLoadReplay={(id, hour) => {
                  setSiteId(id)
                  setI(hour)
                }}
              />
            </section>
          </main>

          {/* Artemis III Candidate Region Mineral & Resource Panel */}
          {artemisMatch && (
            <section className="panel region-panel" aria-label="Artemis III candidate region resources">
              <div className="region-head">
                <h3>On-site minerals and resources: {artemisMatch.name}</h3>
                <span className="region-tag">{artemisMatch.resources.water_ice_potential} water ice potential</span>
              </div>
              <p className="region-body">{artemisMatch.geology}</p>
              <div className="region-cols">
                <div>
                  <strong>Mineral composition</strong>
                  <div className="chips">
                    {artemisMatch.minerals.primary.map((m) => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                  <p>{artemisMatch.minerals.details}</p>
                </div>
                <div>
                  <strong>Water ice and cryogenic volatiles</strong>
                  <p>{artemisMatch.resources.water_ice_details}</p>
                  <p>
                    Depth: <b>{artemisMatch.resources.depth_estimate}</b> · Volatiles: {artemisMatch.resources.volatiles.join(', ')}
                  </p>
                </div>
                <div>
                  <strong>In-situ resource utilisation (ISRU)</strong>
                  <p>{artemisMatch.resources.isru_applications}</p>
                  <p>Extractable elements: {artemisMatch.resources.isru_elements.join(' · ')}</p>
                </div>
              </div>
              <button type="button" className="region-go" onClick={() => setView('3d')}>
                Terrain and resources in 3D
              </button>
            </section>
          )}

          <section className="panel" aria-label="Landing date planner">
            <Planner
              site={site}
              i={i}
              setI={setI}
              planned={planned}
              setPlanned={setPlanned}
              th={th}
              setTh={setTh}
              onFindAlternatives={
                inAnalysisYear(site)
                  ? () => {
                      setFindRadius(site.lat <= -84 ? 25 : 0)
                      setView('find')
                    }
                  : undefined
              }
            />
          </section>

          <section className="panel" aria-label="Availability timeline">
            <Timeline site={site} i={i} onPick={setI} />
          </section>

          <div className="lower">
            <section className="panel" aria-label="Seasons">
              <Seasons site={site} i={i} />
            </section>
            <section className="panel" aria-label="Lander survival calculator">
              <Survival site={site} i={i} arr={arr} setArr={setArr} />
            </section>
          </div>

          <section className="panel" aria-label="Data sources and validation">
            <Sources v={validation} />
          </section>

          <footer className="foot">
            {site.provenance} Times are to the nearest hour.
          </footer>

        </>
      )}

      {site && (view === 'site' || view === '3d' || view === 'globe') && (
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
              <button className="play" onClick={() => setPlaying(!playing)} aria-pressed={playing}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
                <option value={1}>1 h per step</option>
                <option value={6}>6 h per step</option>
                <option value={24}>1 day per step</option>
              </select>
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
      )}
    </div>
  )
}

function Status({ site, i }: { site: Site; i: number }) {
  const s = stateAt(site, i)
  return (
    <div className={`status st-${s}-border`}>
      <span className={`swatch st-${s}`} aria-hidden="true" />
      <span style={{ flex: 1 }}>{STATE_LABEL[s]}</span>
      {/* WS2 */}
      <Why topic="ridge-blocks" site={site} i={i} />
    </div>
  )
}

function Body({ site, i, b, arr = DEFAULT_ARRAY }: { site: Site; i: number; b: 'sun' | 'earth'; arr?: SolarArray }) {
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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
        <p className="hero">{formatDeg(t.el[i])}</p>
        {/* WS2 */}
        <Why topic={b === 'sun' ? 'sun-skims' : 'earth-wobbles'} site={site} i={i} />
      </div>
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
            <dt title="Visible Sun disc x cos(elevation), for a vertical panel turned to the Sun; array set in Lander survival">Solar array output</dt>
            <dd>
              {Math.round(t.power[i] * peakWatts(arr))} W ({Math.round(t.power[i] * 100)}% of full sunlight)
            </dd>
          </>
        )}
        <dt>Azimuth</dt>
        <dd>{t.az[i].toFixed(1)}°</dd>
      </dl>
    </div>
  )
}

function SiteFacts({ site, arr = DEFAULT_ARRAY }: { site: Site; arr?: SolarArray }) {
  const m = site.metrics
  const lon = site.lon > 180 ? site.lon - 360 : site.lon
  const sc = getSiteScienceStats(site)
  return (
    <div className="facts">
      <h2>
        {inAnalysisYear(site) ? `Over ${new Date(site.start_utc).getUTCFullYear()}` : `Over this ${Math.round(site.samples / 24)}-day replay`}
        <span className={`pill kind-${site.kind}`}>{KIND_LABEL[site.kind]}</span>
      </h2>
      <dl>
        <dt>Sunlit</dt>
        <dd>{m.sunlit_pct.toFixed(1)}% of the time</dd>
        <dt>Earth in view</dt>
        <dd>{m.earth_visible_pct.toFixed(1)}%</dd>
        <dt>Both</dt>
        <dd>{m.sun_and_earth_pct.toFixed(1)}%</dd>
        <dt title="Average over the period, including darkness; array set in Lander survival">Mean array output</dt>
        <dd>
          {Math.round((m.mean_power_index_pct / 100) * peakWatts(arr))} W ({m.mean_power_index_pct.toFixed(1)}% of full sunlight)
        </dd>
        {/* WS5: Science & Water Ice */}
        <dt>Distance to Water Ice</dt>
        <dd style={{ color: sc.distToPsrKm <= 5 ? 'var(--ice)' : 'inherit', fontWeight: 600 }}>
          {sc.inPsr ? '0.0 km (Inside PSR)' : `${sc.distToPsrKm.toFixed(1)} km`}
        </dd>
        <dt>Thermal regime</dt>
        <dd>~{sc.tempK} K ({sc.iceTrapped ? 'Cold Trap' : 'Surface'})</dd>
        <dt>Trade-off zone</dt>
        <dd>
          <span className={`tradeoff-chip chip-${sc.zone}`}>{sc.zoneLabel}</span>
        </dd>
        <dt>Longest darkness</dt>
        <dd>{formatDuration(m.longest_dark_h)}</dd>
        <dt>Longest without Earth</dt>
        <dd>{formatDuration(m.longest_no_earth_h)}</dd>
        <dt>Location</dt>
        <dd>
          {Math.abs(site.lat).toFixed(3)}° {site.lat >= 0 ? 'N' : 'S'}, {Math.abs(lon).toFixed(2)}° {lon >= 0 ? 'E' : 'W'}
        </dd>
        <dt>Terrain height</dt>
        <dd>{site.site_height_m.toFixed(0)} m (+{site.obs_height_m} m mast)</dd>
      </dl>
      <p className="note">{site.note}</p>
      <p className="note">
        Coordinates: <a href={site.source_url} target="_blank" rel="noreferrer">{site.source}</a>
      </p>
      <ExternalTools site={site} />
    </div>
  )
}

/** Open the site in NASA's specialist tools. Their links don't take coordinates reliably, so we copy them
 *  for the tools' search boxes (QuickMap's search accepts "lat,lon"). */
function ExternalTools({ site }: { site: Site }) {
  const [copied, setCopied] = useState(false)
  const coords = `${site.lat},${site.lon > 180 ? site.lon - 360 : site.lon}`
  return (
    <p className="note tools">
      <button
        onClick={() => navigator.clipboard.writeText(coords).then(() => setCopied(true), () => setCopied(false))}
        onBlur={() => setCopied(false)}
      >
        {copied ? 'Copied' : 'Copy coordinates'}
      </button>
      <span>
        then search in{' '}
        <a href="https://quickmap.lroc.im-ldi.com/" target="_blank" rel="noreferrer">LROC QuickMap</a> or{' '}
        <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">NASA Moon Trek</a>
      </span>
    </p>
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

/** The sheet's mark: the Moon's limb seen edge-on at the pole, with the Sun skimming the horizon. */
function Mark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="15.5" fill="none" stroke="var(--line-2)" />
      <path d="M3.2 21.5c4.2-1.9 6.6-3.6 9-3.2 2.2.4 3.1 2.4 5.4 2.3 2.6-.1 4-2.9 6.6-3 2.2-.1 4.2 1.3 6.6 2.6" fill="none" stroke="var(--ink)" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="24.2" cy="15.4" r="2.6" fill="var(--sun)" />
      <path d="M17 1.5v3M17 29.5v3M1.5 17h3M29.5 17h3" stroke="var(--ink-3)" />
    </svg>
  )
}
