import { useEffect, useState } from 'react'
import {
  DEFAULT_ARRAY, VIABILITY_LABEL, arrayEnergyWh, formatDeg, peakWatts, type SolarArray, formatDuration, getSiteScienceStats, hoursToChange, loadSite, timeAt, viability, windowStats,
  type Site, type SiteSummary, type Thresholds, type Viability, type WindowStats,
} from './data'
import './styles/analysis.css'
import { DEFAULT_YEAR, loadYears, siteForYear } from './years'

export interface Scenario {
  siteId: string
  t: number // landing time, hour index into the data year
  y?: number // Any landing year: the scenario's calendar year (default: the year picked at the top)
}

const LETTERS = ['A', 'B', 'C', 'D']
const MAX = 4
const RANK: Record<Viability, number> = { viable: 3, marginal: 2, not: 1, nodata: 0 }

interface Eval {
  sc: Scenario
  site: Site
  w: WindowStats | null
  v: Viability
  kwh: number // solar array energy over the mission window
  meanW: number // average array output over the whole period
}

interface Row {
  group: string
  label: string
  get: (e: Eval) => number | null
  fmt: (n: number, e: Eval) => string
  best?: 'high' | 'low'
}

const pct = (n: number) => `${n.toFixed(0)}%`
const change = (e: Eval, b: 'sun' | 'earth') => hoursToChange(e.site[b].frac, e.sc.t)

const ROWS: Row[] = [
  { group: 'Mission', label: 'Verdict', get: (e) => RANK[e.v], fmt: (_, e) => VIABILITY_LABEL[e.v], best: 'high' },
  { group: 'Mission', label: 'Sunlit', get: (e) => e.w?.sunPct ?? null, fmt: pct, best: 'high' },
  { group: 'Mission', label: 'Longest darkness', get: (e) => e.w?.longestDarkH ?? null, fmt: formatDuration, best: 'low' },
  { group: 'Mission', label: 'Earth in view', get: (e) => e.w?.earthPct ?? null, fmt: pct, best: 'high' },
  { group: 'Mission', label: 'Solar energy', get: (e) => (e.w ? e.kwh : null), fmt: (n) => `${n.toFixed(1)} kWh`, best: 'high' },
  { group: 'Mission', label: 'Longest without Earth', get: (e) => e.w?.longestNoEarthH ?? null, fmt: formatDuration, best: 'low' },
  { group: 'At landing', label: 'Sun elevation', get: (e) => e.site.sun.el[e.sc.t], fmt: formatDeg },
  {
    group: 'At landing', label: 'Sun', get: (e) => change(e, 'sun'),
    fmt: (n, e) => (e.site.sun.frac[e.sc.t] > 0 ? `Up, sets in ${formatDuration(n)}` : `Down, rises in ${formatDuration(n)}`),
  },
  { group: 'At landing', label: 'Earth elevation', get: (e) => e.site.earth.el[e.sc.t], fmt: formatDeg },
  {
    group: 'At landing', label: 'Earth', get: (e) => change(e, 'earth'),
    fmt: (n, e) => (e.site.earth.frac[e.sc.t] > 0 ? `In view, sets in ${formatDuration(n)}` : `Hidden, rises in ${formatDuration(n)}`),
  },
  // Science (Water Ice & Volatiles)
  { group: 'Science (Water Ice)', label: 'Distance to Ice PSR', get: (e) => getSiteScienceStats(e.site).distToPsrKm, fmt: (n) => `${n.toFixed(1)} km`, best: 'low' },
  { group: 'Science (Water Ice)', label: 'Cold trap temp', get: (e) => getSiteScienceStats(e.site).tempK, fmt: (n) => `~${n} K (${n < 110 ? 'Ice Stable' : 'Thermal Boundary'})` },
  { group: 'Science (Water Ice)', label: 'Crater depth drop', get: (e) => getSiteScienceStats(e.site).depthDropM, fmt: (n) => `-${n.toLocaleString('en')} m` },
  { group: 'Science (Water Ice)', label: 'Trade-off Sweet Spot', get: (e) => getSiteScienceStats(e.site).scienceScore, fmt: (_, e) => getSiteScienceStats(e.site).zoneLabel, best: 'high' },
  // Whole Year
  { group: 'Whole year', label: 'Sunlit', get: (e) => e.site.metrics.sunlit_pct, fmt: pct, best: 'high' },
  { group: 'Whole year', label: 'Earth in view', get: (e) => e.site.metrics.earth_visible_pct, fmt: pct, best: 'high' },
  { group: 'Whole year', label: 'Longest darkness', get: (e) => e.site.metrics.longest_dark_h, fmt: formatDuration, best: 'low' },
  { group: 'Whole year', label: 'Mean array output', get: (e) => e.meanW, fmt: (n) => `${n.toFixed(0)} W`, best: 'high' },
]

const utcInput = (d: Date) => d.toISOString().slice(0, 13) + ':00'

/** F4: 2-4 site-date scenarios side by side, synced mission timelines, metric table, export. */
export function Compare(p: {
  sites: SiteSummary[]
  scenarios: Scenario[]
  setScenarios: (s: Scenario[]) => void
  th: Thresholds
  year?: number
  arr?: SolarArray
}) {
  const arr = p.arr ?? DEFAULT_ARRAY
  const { sites, scenarios, setScenarios, th } = p
  const yr = (sc: Scenario) => sc.y ?? p.year ?? DEFAULT_YEAR
  const keyOf = (sc: Scenario) => `${sc.siteId}@${yr(sc)}`
  const [years, setYears] = useState<number[]>([DEFAULT_YEAR])
  useEffect(() => {
    loadYears().then(setYears, () => {})
  }, [])
  const [loaded, setLoaded] = useState<Record<string, Site>>({})
  const [hover, setHover] = useState<number | null>(null)
  const hours = th.missionDays * 24

  useEffect(() => {
    for (const s of scenarios)
      if (!loaded[keyOf(s)])
        loadSite(s.siteId)
          .then((site) => siteForYear(site, yr(s)))
          .then((site) => setLoaded((m) => ({ ...m, [keyOf(s)]: site })))
  }, [scenarios, loaded])

  const evals: (Eval | null)[] = scenarios.map((sc) => {
    const site = loaded[keyOf(sc)]
    if (!site) return null
    const w = windowStats(site, sc.t, hours)
    return { sc, site, w, v: viability(w, th), kwh: arrayEnergyWh(site, sc.t, hours, arr) / 1000, meanW: (site.metrics.mean_power_index_pct / 100) * peakWatts(arr) }
  })
  const ready = evals.every(Boolean) ? (evals as Eval[]) : null

  const update = (k: number, patch: Partial<Scenario>) => setScenarios(scenarios.map((s, j) => (j === k ? { ...s, ...patch } : s)))
  const last = scenarios[scenarios.length - 1]
  const unusedSite = sites.find((s) => !scenarios.some((x) => x.siteId === s.id))?.id ?? last.siteId
  const samples = ready?.at(-1)?.site.samples ?? 8760 // the last scenario's data length

  return (
    <div className="chart compare">
      <div className="chart-head">
        <h2>Compare scenarios</h2>
        <div className="compare-actions">
          <button disabled={scenarios.length >= MAX} onClick={() => setScenarios([...scenarios, { siteId: unusedSite, t: last.t, y: yr(last) }])}>
            Add another site, same time
          </button>
          <button
            disabled={scenarios.length >= MAX}
            onClick={() => {
              // Past the end of the year: roll into the next year when it is available.
              const t = last.t + 14 * 24
              const y = yr(last)
              const next = t >= samples && years.includes(y + 1) && !ready?.at(-1)?.site.replay
              setScenarios([...scenarios, next ? { siteId: last.siteId, t: t - samples, y: y + 1 } : { siteId: last.siteId, t: Math.min(t, samples - 1), y }])
            }}
          >
            Add same site, 14 days later
          </button>
          <button disabled={!ready} onClick={() => ready && download('csv', ready, th)}>
            Export CSV
          </button>
          <button disabled={!ready} onClick={() => ready && download('json', ready, th)}>
            Export JSON
          </button>
        </div>
      </div>
      <p className="chart-note">
        Mission window: {th.missionDays} days from each landing time. Thresholds come from the landing date planner (sunlit at least{' '}
        {th.minSunPct}%, darkness at most {th.maxDarkH} h, Earth in view at least {th.minEarthPct}%). Solar energy is for a {arr.areaM2} m², {arr.effPct}% array (vertical, turned to the Sun), set in Lander survival. Best value per row is marked.
      </p>

      <div className="cmp-grid" style={{ gridTemplateColumns: `200px repeat(${scenarios.length}, minmax(0, 1fr))` }}>
        <div />
        {scenarios.map((sc, k) => (
          <div className="cmp-head" key={k}>
            <div className="cmp-title">
              <span className="cmp-letter">{LETTERS[k]}</span>
              {scenarios.length > 2 && (
                <button className="link" onClick={() => setScenarios(scenarios.filter((_, j) => j !== k))}>
                  Remove
                </button>
              )}
            </div>
            <select value={sc.siteId} onChange={(e) => update(k, { siteId: e.target.value })} aria-label={`Scenario ${LETTERS[k]} site`}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {ready && (
              <input
                type="datetime-local"
                step={3600}
                aria-label={`Scenario ${LETTERS[k]} landing time, UTC`}
                value={utcInput(timeAt(ready[k].site, sc.t))}
                min={ready[k].site.replay ? utcInput(timeAt(ready[k].site, 0)) : `${years[0]}-01-01T00:00`}
                max={ready[k].site.replay ? utcInput(timeAt(ready[k].site, ready[k].site.samples - 1)) : `${years.at(-1)}-12-31T23:00`}
                onChange={(e) => {
                  const ms = Date.parse(e.target.value + ':00Z')
                  if (!Number.isFinite(ms)) return
                  const site = ready[k].site
                  // Any landing year: a date in another year switches this scenario to that year.
                  const y = new Date(ms).getUTCFullYear()
                  if (!site.replay && y !== yr(sc) && years.includes(y)) return update(k, { y, t: Math.round((ms - Date.UTC(y, 0, 1)) / 3_600_000) })
                  const h = Math.round((ms - Date.parse(site.start_utc)) / 3_600_000)
                  update(k, { t: Math.min(Math.max(h, 0), site.samples - 1) })
                }}
              />
            )}
            <span className="muted cmp-utc">UTC landing</span>
          </div>
        ))}

        {!ready && <p className="loading">Loading scenarios</p>}
        {ready &&
          ROWS.map((r, ri) => {
            const vals = ready.map((e) => r.get(e))
            const nums = vals.filter((v): v is number => v !== null)
            const target = r.best === 'high' ? Math.max(...nums) : r.best === 'low' ? Math.min(...nums) : null
            const distinct = new Set(nums).size > 1
            const newGroup = ri === 0 || ROWS[ri - 1].group !== r.group
            return (
              <div key={r.group + r.label} style={{ display: 'contents' }}>
                {newGroup && (
                  <div className="cmp-group-row" style={{ gridColumn: '1 / -1' }}>
                    {r.group}
                    {r.group === 'Mission' && <span className="muted"> ({th.missionDays} days from landing)</span>}
                  </div>
                )}
                <div className="cmp-label">{r.label}</div>
                {vals.map((v, k) => {
                  const best = target !== null && distinct && v === target
                  return (
                    <div key={k} className={best ? 'cmp-cell best' : 'cmp-cell'}>
                      {v === null ? '–' : r.fmt(v, ready[k])}
                      {best && <span className="best-tag">Best</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
      </div>

      {ready && (
        <div className="cmp-timelines">
          <h3 className="mini-title">
            Mission timelines, aligned from landing
            <span className="muted">, hover to compare the same moment</span>
          </h3>
          {ready.map((e, k) => (
            <MissionTracks key={k} letter={LETTERS[k]} e={e} hours={hours} hover={hover} setHover={setHover} />
          ))}
          <div className="ticks cmp-ticks" aria-hidden="true">
            {Array.from({ length: th.missionDays + 1 }, (_, d) => d)
              .filter((d) => d % Math.max(1, Math.ceil(th.missionDays / 14)) === 0)
              .map((d) => (
                <span key={d} style={{ left: `${((d * 24) / hours) * 100}%` }}>
                  day {d}
                </span>
              ))}
          </div>
          <p className="cal-info">
            {hover === null
              ? 'Hover the tracks to read every scenario at the same mission hour.'
              : `Day ${Math.floor(hover / 24)}, hour ${hover % 24}: ` +
                ready
                  .map((e, k) => {
                    const j = e.sc.t + hover
                    if (j >= e.site.samples) return `${LETTERS[k]} past the data`
                    const s = e.site.sun.frac[j] > 0 ? 'Sun up' : 'dark'
                    const g = e.site.earth.frac[j] > 0 ? 'Earth in view' : 'no Earth'
                    return `${LETTERS[k]} ${s}, ${g}`
                  })
                  .join('; ')}
          </p>
        </div>
      )}

      {ready && <ScienceQuadrantChart evals={ready} th={th} />}
    </div>
  )
}

function ScienceQuadrantChart(p: { evals: Eval[]; th: Thresholds }) {
  const { evals, th } = p
  const [activeLetter, setActiveLetter] = useState<string | null>(null)

  const w = 680
  const h = 330
  const ml = 65
  const mr = 35
  const mt = 35
  const mb = 45
  const pw = w - ml - mr
  const ph = h - mt - mb

  const maxKm = 20
  const toX = (km: number) => ml + (Math.min(km, maxKm) / maxKm) * pw
  const toY = (pct: number) => mt + ph - (Math.min(100, Math.max(0, pct)) / 100) * ph

  const splitX = toX(5.0)
  const splitY = toY(th.minSunPct)

  return (
    <div className="science-tradeoff-section">
      <div className="science-tradeoff-header">
        <div>
          <h3>Science and engineering trade-off</h3>
          <p>
            Balances Engineering power survival (Sunlight %) against Science return (Proximity to permanently shadowed water ice).
          </p>
        </div>
      </div>

      <div className="quadrant-legend">
        <div className="quadrant-legend-item">
          <span className="quadrant-legend-dot dot-sweet-spot" />
          <span><strong>Sweet spot:</strong> Sun ≥ {th.minSunPct}% &amp; Ice ≤ 5 km</span>
        </div>
        <div className="quadrant-legend-item">
          <span className="quadrant-legend-dot dot-safe-dry" />
          <span><strong>Safe but dry:</strong> Sun ≥ {th.minSunPct}%, Ice &gt; 5 km</span>
        </div>
        <div className="quadrant-legend-item">
          <span className="quadrant-legend-dot dot-cryo-danger" />
          <span><strong>Cryo hazard:</strong> Near/In Ice, Sun &lt; {th.minSunPct}%</span>
        </div>
        <div className="quadrant-legend-item">
          <span className="quadrant-legend-dot dot-non-viable" />
          <span><strong>Not viable:</strong> Low Sun &amp; Distant from Ice</span>
        </div>
      </div>

      <div className="quadrant-wrap">
        <svg viewBox={`0 0 ${w} ${h}`} className="quadrant-chart-svg" aria-label="Science vs Engineering quadrant plot">
          {/* Quadrant Backgrounds */}
          <rect x={ml} y={mt} width={splitX - ml} height={splitY - mt} fill="rgba(31, 163, 138, 0.12)" />
          <rect x={splitX} y={mt} width={w - mr - splitX} height={splitY - mt} fill="rgba(85, 144, 216, 0.08)" />
          <rect x={ml} y={splitY} width={splitX - ml} height={mt + ph - splitY} fill="rgba(230, 193, 90, 0.08)" />
          <rect x={splitX} y={splitY} width={w - mr - splitX} height={mt + ph - splitY} fill="rgba(117, 115, 111, 0.05)" />

          {/* Quadrant Titles */}
          <text x={ml + 12} y={mt + 20} fill="#1fa38a" fontSize="11" fontWeight="bold">Sweet spot</text>
          <text x={ml + 12} y={mt + 34} fill="#aaa598" fontSize="9">Power Viable + Ice Accessible (&lt;5 km)</text>

          <text x={splitX + 12} y={mt + 20} fill="#5590d8" fontSize="11" fontWeight="bold">Safe but dry</text>
          <text x={splitX + 12} y={mt + 34} fill="#aaa598" fontSize="9">Lander Survives · Ice Unreachable</text>

          <text x={ml + 12} y={splitY + 22} fill="#e6c15a" fontSize="11" fontWeight="bold">Cryo hazard</text>
          <text x={ml + 12} y={splitY + 36} fill="#aaa598" fontSize="9">Rich in Ice · Lander Freeze Hazard</text>

          <text x={splitX + 12} y={splitY + 22} fill="#8f8b80" fontSize="11" fontWeight="bold">Not viable</text>
          <text x={splitX + 12} y={splitY + 36} fill="#aaa598" fontSize="9">Low Power · Far from Ice</text>

          {/* Threshold Divider Lines */}
          <line x1={splitX} y1={mt} x2={splitX} y2={mt + ph} stroke="#cf86c3" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1={ml} y1={splitY} x2={w - mr} y2={splitY} stroke="#c98419" strokeWidth="1.5" strokeDasharray="3 3" />

          {/* X Axis Ticks */}
          {[0, 5, 10, 15, 20].map((km) => {
            const x = toX(km)
            return (
              <g key={km}>
                <line x1={x} y1={mt} x2={x} y2={mt + ph} stroke="#24221f" strokeWidth="0.5" />
                <text x={x} y={mt + ph + 16} fill="#aaa598" fontSize="10" textAnchor="middle">
                  {km === 20 ? '20+ km' : `${km} km`}
                </text>
              </g>
            )
          })}

          {/* Y Axis Ticks */}
          {[0, 25, 50, 75, 100].map((p) => {
            const y = toY(p)
            return (
              <g key={p}>
                <line x1={ml} y1={y} x2={w - mr} y2={y} stroke="#24221f" strokeWidth="0.5" />
                <text x={ml - 8} y={y + 4} fill="#aaa598" fontSize="10" textAnchor="end">
                  {p}%
                </text>
              </g>
            )
          })}

          {/* Axis Labels */}
          <text x={ml + pw / 2} y={h - 6} fill="#c9c4b8" fontSize="11" fontWeight="bold" textAnchor="middle">
            Distance to nearest water-ice cold trap (km)
          </text>
          <text
            x={-mt - ph / 2}
            y={16}
            transform="rotate(-90)"
            fill="#c98419"
            fontSize="11"
            fontWeight="bold"
            textAnchor="middle"
          >
            Mission sunlight (%)
          </text>

          {/* Scenario Points */}
          {evals.map((e, k) => {
            const sc = getSiteScienceStats(e.site)
            const sunPct = e.w?.sunPct ?? 0
            const cx = toX(sc.distToPsrKm)
            const cy = toY(sunPct)
            const letter = LETTERS[k]
            const isHover = activeLetter === letter

            let dotColor = '#5590d8'
            if (sc.zone === 'sweet_spot') dotColor = '#1fa38a'
            else if (sc.zone === 'cryo_danger') dotColor = '#e6c15a'
            else if (sc.zone === 'non_viable') dotColor = '#8f8b80'

            return (
              <g
                key={letter}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setActiveLetter(letter)}
                onMouseLeave={() => setActiveLetter(null)}
              >
                {/* Glow ring */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHover ? 18 : 14}
                  fill={dotColor}
                  fillOpacity={isHover ? 0.35 : 0.2}
                  stroke={dotColor}
                  strokeWidth={isHover ? 2 : 1}
                />
                {/* Solid core */}
                <circle cx={cx} cy={cy} r={8} fill={dotColor} />
                {/* Letter */}
                <text x={cx} y={cy + 3.5} fill="#14120e" fontSize="10" fontWeight="bold" textAnchor="middle">
                  {letter}
                </text>
                {/* Name Tag */}
                <text
                  x={cx}
                  y={cy - 16}
                  fill="#f2efe8"
                  fontSize="10"
                  fontWeight={isHover ? 'bold' : 'normal'}
                  textAnchor="middle"
                  style={{ textShadow: '0 1px 4px #000' }}
                >
                  {letter}: {e.site.name.slice(0, 18)}
                </text>
              </g>
            )
          })}
        </svg>

        {activeLetter && (() => {
          const idx = LETTERS.indexOf(activeLetter)
          const target = evals[idx]
          if (!target) return null
          const sc = getSiteScienceStats(target.site)
          return (
            <div className="science-badge-row">
              <span className="science-badge-title">Scenario {activeLetter} ({target.site.name}):</span>
              <span className="science-badge-val">Sunlit: {target.w?.sunPct?.toFixed(1) ?? '–'}%</span>
              <span>·</span>
              <span className="science-badge-val">Distance to Ice: {sc.distToPsrKm.toFixed(1)} km</span>
              <span>·</span>
              <span className="science-badge-val">Temp: ~{sc.tempK} K</span>
              <span>·</span>
              <span className="science-badge-val">Crater Relief: -{sc.depthDropM} m</span>
              <span>·</span>
              <span className={`tradeoff-chip chip-${sc.zone}`}>{sc.zoneLabel}</span>
            </div>
          )
        })()}
      </div>
    </div>
  )
}


function MissionTracks(p: { letter: string; e: Eval; hours: number; hover: number | null; setHover: (h: number | null) => void }) {
  const { e, hours } = p
  const rows = [
    { label: 'Sunlit', cls: 'st-sun', on: (j: number) => e.site.sun.frac[j] > 0 },
    { label: 'Earth in view', cls: 'st-earth', on: (j: number) => e.site.earth.frac[j] > 0 },
    { label: 'Both', cls: 'st-both', on: (j: number) => e.site.sun.frac[j] > 0 && e.site.earth.frac[j] > 0 },
  ]
  const runs = (on: (j: number) => boolean) => {
    const out: [number, number][] = []
    for (let h = 0; h < hours && e.sc.t + h < e.site.samples; h++) {
      if (!on(e.sc.t + h)) continue
      const l = out[out.length - 1]
      if (l && l[1] === h) l[1] = h + 1
      else out.push([h, h + 1])
    }
    return out
  }
  return (
    <div className="cmp-tracks">
      <div className="gantt-labels" aria-hidden="true">
        {rows.map((r) => (
          <span key={r.label}>
            {p.letter} {r.label}
          </span>
        ))}
      </div>
      <div
        className="gantt-plot"
        role="img"
        aria-label={`Scenario ${p.letter}: ${e.site.name}, sunlight and Earth visibility over the mission`}
        onMouseMove={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect()
          p.setHover(Math.min(hours - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * hours))))
        }}
        onMouseLeave={() => p.setHover(null)}
      >
        {rows.map((r) => (
          <svg key={r.label} viewBox={`0 0 ${hours} 1`} preserveAspectRatio="none" className="track">
            <rect x={0} y={0} width={hours} height={1} className="track-bg" />
            {runs(r.on).map(([a, b]) => (
              <rect key={a} x={a} y={0} width={b - a} height={1} className={r.cls} />
            ))}
            {p.hover !== null && (
              <line x1={p.hover + 0.5} x2={p.hover + 0.5} y1={0} y2={1} className="crosshair" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        ))}
      </div>
    </div>
  )
}

function download(kind: 'csv' | 'json', evals: Eval[], th: Thresholds) {
  const name = (e: Eval) => `${e.site.name} @ ${timeAt(e.site, e.sc.t).toISOString().slice(0, 16)}Z`
  let body: string
  if (kind === 'json') {
    body = JSON.stringify(
      {
        mission_days: th.missionDays,
        thresholds: th,
        scenarios: evals.map((e) => ({
          site: e.site.id, name: e.site.name, lat: e.site.lat, east_lon: e.site.lon,
          landing_utc: timeAt(e.site, e.sc.t).toISOString(),
          rows: Object.fromEntries(ROWS.map((r) => [`${r.group}: ${r.label}`, r.get(e)])),
          verdict: e.v,
        })),
        source: evals[0]?.site.provenance,
      },
      null,
      1,
    )
  } else {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const lines = [['Metric', ...evals.map(name)].map(q).join(',')]
    for (const r of ROWS) lines.push([q(`${r.group}: ${r.label}`), ...evals.map((e) => { const v = r.get(e); return v === null ? '' : q(r.fmt(v, e)) })].join(','))
    body = lines.join('\n')
  }
  const url = URL.createObjectURL(new Blob([body], { type: kind === 'csv' ? 'text/csv' : 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `lunar-comparison.${kind}`
  a.click()
  URL.revokeObjectURL(url)
}
