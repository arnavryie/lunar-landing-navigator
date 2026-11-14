import { Suspense, lazy, useEffect, useState } from 'react'
import {
  DEFAULT_THRESHOLDS, KIND_LABEL, STATE_LABEL, formatDeg, formatDuration, getSiteScienceStats, horizonAt, hoursSinceChange, hoursToChange, inAnalysisYear, loadSite, loadSites,
  loadValidation, stateAt,
  type Site, type SiteSummary, type Thresholds, type Validation as ValidationData,
} from './data'
import { HorizonDial } from './HorizonDial'
import { Compare, type Scenario } from './Compare'
import { computeCustomPoint } from './customPoint'
import { Finder } from './Finder'
import { MapView } from './MapView'
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
  type View = 'site' | 'find' | 'compare' | 'globe' | 'map' | '3d' | 'validation'
  const [view, setView] = useState<View>((['find', 'compare', 'globe', 'map', '3d', 'validation'] as const).find((v) => v === params.get('view')) ?? 'site')
  const [findRadius, setFindRadius] = useState(0) // radius for Find sites when opened from the planner
  useEffect(() => {
    if (view !== 'find') setFindRadius(0)
  }, [view])
  const [busy, setBusy] = useState(false)
  const [pickError, setPickError] = useState('')
  const [scenarios, setScenarios] = useState<Scenario[]>(
    (params.get('cmp') ?? '')
      .split(',')
      .map((x) => x.split('@'))
      .filter(([id, t]) => id && Number.isFinite(Number(t)))
      .map(([id, t]) => ({ siteId: id, t: Number(t) })),
  )

  // Entering Compare with nothing set up: current site and time vs the next site at the same time.
  const openCompare = () => {
    if (scenarios.length < 2 && site) {
      const other = sites.find((x) => x.id !== site.id)?.id ?? site.id
      setScenarios([{ siteId: site.id, t: i }, { siteId: other, t: i }])
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
        setSite(customSite)
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
        setSite(c)
        setSiteId('custom')
      })
      .catch((e) => setPickError(`Couldn't compute that point: ${e.message}`))
      .finally(() => setBusy(false))
  }

  const addToCompare = () => {
    if (!site) return
    const other = sites.find((x) => x.id !== site.id)?.id ?? site.id
    const mine = { siteId: site.id, t: i }
    setScenarios(scenarios.length < 2 ? [mine, { siteId: other, t: i }] : scenarios.length < 4 ? [...scenarios, mine] : [...scenarios.slice(0, 3), mine])
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
      site: siteId, t: String(i), plan: String(planned),
      m: String(th.missionDays), sun: String(th.minSunPct), dark: String(th.maxDarkH), earth: String(th.minEarthPct),
    })
    if (view !== 'site') q.set('view', view)
    if (siteId === 'custom' && site?.kind === 'custom') q.set('pin', `${site.lat},${site.lon}`)
    if (scenarios.length) q.set('cmp', scenarios.map((x) => `${x.siteId}@${x.t}`).join(','))
    history.replaceState(null, '', `?${q}`)
  }, [siteId, i, planned, th, view, scenarios, site])

  useEffect(() => {
    if (!siteId || siteId === 'custom' || siteId.startsWith('artemis-')) return
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
        <nav className="seg views" aria-label="Screens">
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
        </nav>
        {/* WS3 */}
        <button
          type="button"
          className="badge"
          onClick={() => setView('validation')}
          title="How the numbers were checked — open scientific validation proofs"
        >
          <span aria-hidden="true">✓</span> Validated against JPL Horizons{validation ? `, max error ${validation.horizons.worst_deg.toFixed(5)}°` : ''} • See proofs →
        </button>
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
      </header>

      {error && <p className="error">{error}</p>}
      {!site && !error && <p className="loading">Loading site data</p>}

      {view === 'find' && (
        <section className="panel" aria-label="Alternatives finder">
          {/* WS3 */}
          {site && !inAnalysisYear(site) ? (
            <div className="replay-notice-card">
              <p>The site finder is calibrated for the 2027 analysis year. Historical mission replays are shown on the Site and plan tab.</p>
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
              <p>The whole-Moon globe covers the 2027 orbital model. Historical mission replays are shown on the Site and plan tab.</p>
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
              <p>3D GPU shadow maps cover the 2027 analysis year. Historical mission replays are shown on the Site and plan tab.</p>
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
            onOpenArtemis={() => setView('3d')}
          />
        </section>
      )}

      {site && view === 'compare' && scenarios.length >= 2 && (
        <section className="panel" aria-label="Compare scenarios">
          <Compare sites={sites} scenarios={scenarios} setScenarios={setScenarios} th={th} />
          <footer className="foot">{site.provenance} Times are to the nearest hour.</footer>
        </section>
      )}

      {site && view === 'site' && (
        <>
          {(() => {
            const artemisMatch = ARTEMIS_3_SITES.find((a) => {
              if (site.id === `artemis-${a.id}`) return true
              if (site.name.toLowerCase().includes(a.name.toLowerCase())) return true
              const dLon = Math.abs((((a.lon - site.lon) % 360) + 540) % 360 - 180)
              return Math.hypot(a.lat - site.lat, dLon * Math.cos(((a.lat + site.lat) * 0.5 * Math.PI) / 180)) < 0.5
            })
            if (!artemisMatch) return null
            return (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  borderRadius: 'var(--radius-s)',
                  padding: '8px 14px',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '0.84rem', color: '#e2e8f0' }}>
                  <strong style={{ color: '#38bdf8' }}>NASA Artemis III Candidate Region Active:</strong> {artemisMatch.name} ({Math.abs(artemisMatch.lat).toFixed(2)}° S, {Math.abs(artemisMatch.lon).toFixed(1)}° {artemisMatch.lon < 0 ? 'W' : 'E'}) · {artemisMatch.resources.water_ice_potential} Water Ice · {artemisMatch.minerals.crust_type}
                </div>
                <button
                  type="button"
                  style={{
                    fontSize: '0.74rem',
                    padding: '3px 9px',
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-s)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  onClick={() => setView('3d')}
                >
                  View Minerals &amp; Resources in 3D Tab →
                </button>
              </div>
            )
          })()}
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
          {(() => {
            const artemisMatch = ARTEMIS_3_SITES.find((a) => {
              if (site.id === `artemis-${a.id}`) return true
              if (site.name.toLowerCase().includes(a.name.toLowerCase())) return true
              const dLon = Math.abs((((a.lon - site.lon) % 360) + 540) % 360 - 180)
              return Math.hypot(a.lat - site.lat, dLon * Math.cos(((a.lat + site.lat) * 0.5 * Math.PI) / 180)) < 0.5
            })
            if (!artemisMatch) return null
            return (
              <section className="panel" style={{ borderColor: 'rgba(56, 189, 248, 0.4)', marginTop: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, color: '#38bdf8', fontSize: '1rem' }}>
                      Artemis III Candidate Region: On-Site Minerals &amp; Resources
                    </h3>
                    <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', border: '1px solid currentColor' }}>
                      {artemisMatch.resources.water_ice_potential} Water Ice Potential
                    </span>
                  </div>
                  <button
                    type="button"
                    style={{
                      fontSize: '0.74rem',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-s)',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    onClick={() => setView('3d')}
                  >
                    View in 3D Tab (Terrain &amp; Resources Matrix) →
                  </button>
                </div>
                <p style={{ margin: '8px 0', fontSize: '0.84rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                  {artemisMatch.geology}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginTop: '10px' }}>
                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px', borderRadius: 'var(--radius-s)', border: '1px solid var(--rule)' }}>
                    <strong style={{ color: '#e2e8f0', fontSize: '0.82rem' }}>Mineral Composition:</strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '6px 0' }}>
                      {artemisMatch.minerals.primary.map((m) => (
                        <span key={m} style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '3px', fontSize: '0.74rem' }}>
                          {m}
                        </span>
                      ))}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--muted)' }}>{artemisMatch.minerals.details}</p>
                  </div>

                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px', borderRadius: 'var(--radius-s)', border: '1px solid var(--rule)' }}>
                    <strong style={{ color: '#38bdf8', fontSize: '0.82rem' }}>Water Ice &amp; Cryogenic Volatiles:</strong>
                    <p style={{ margin: '6px 0', fontSize: '0.78rem', color: '#cbd5e1' }}>{artemisMatch.resources.water_ice_details}</p>
                    <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)' }}>
                      Depth: <strong>{artemisMatch.resources.depth_estimate}</strong> · Volatiles: {artemisMatch.resources.volatiles.join(', ')}
                    </p>
                  </div>

                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px', borderRadius: 'var(--radius-s)', border: '1px solid var(--rule)' }}>
                    <strong style={{ color: '#f59e0b', fontSize: '0.82rem' }}>Lander In-Situ Resource Utilization (ISRU):</strong>
                    <p style={{ margin: '6px 0', fontSize: '0.78rem', color: '#cbd5e1' }}>{artemisMatch.resources.isru_applications}</p>
                    <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--muted)' }}>
                      Extractable Elements: {artemisMatch.resources.isru_elements.join(' · ')}
                    </p>
                  </div>
                </div>
              </section>
            )
          })()}

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
              <Survival site={site} i={i} />
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
        <dt>Mean power index</dt>
        <dd>{m.mean_power_index_pct.toFixed(1)}%</dd>
        {/* WS5: Science & Water Ice */}
        <dt>Distance to Water Ice</dt>
        <dd style={{ color: sc.distToPsrKm <= 5 ? '#38bdf8' : 'inherit', fontWeight: 600 }}>
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
