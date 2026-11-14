import { useEffect, useState } from 'react'
import {
  VIABILITY_LABEL, formatDeg, formatDuration, hoursToChange, loadSite, timeAt, viability, windowStats,
  type Site, type SiteSummary, type Thresholds, type Viability, type WindowStats,
} from './data'

export interface Scenario {
  siteId: string
  t: number // landing time, hour index into the data year
}

const LETTERS = ['A', 'B', 'C', 'D']
const MAX = 4
const RANK: Record<Viability, number> = { viable: 3, marginal: 2, not: 1, nodata: 0 }

interface Eval {
  sc: Scenario
  site: Site
  w: WindowStats | null
  v: Viability
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
  { group: 'Whole year', label: 'Sunlit', get: (e) => e.site.metrics.sunlit_pct, fmt: pct, best: 'high' },
  { group: 'Whole year', label: 'Earth in view', get: (e) => e.site.metrics.earth_visible_pct, fmt: pct, best: 'high' },
  { group: 'Whole year', label: 'Longest darkness', get: (e) => e.site.metrics.longest_dark_h, fmt: formatDuration, best: 'low' },
  { group: 'Whole year', label: 'Mean power index', get: (e) => e.site.metrics.mean_power_index_pct, fmt: pct, best: 'high' },
]

const utcInput = (d: Date) => d.toISOString().slice(0, 13) + ':00'

/** F4: 2-4 site-date scenarios side by side, synced mission timelines, metric table, export. */
export function Compare(p: {
  sites: SiteSummary[]
  scenarios: Scenario[]
  setScenarios: (s: Scenario[]) => void
  th: Thresholds
}) {
  const { sites, scenarios, setScenarios, th } = p
  const [loaded, setLoaded] = useState<Record<string, Site>>({})
  const [hover, setHover] = useState<number | null>(null)
  const hours = th.missionDays * 24

  useEffect(() => {
    for (const s of scenarios)
      if (!loaded[s.siteId]) loadSite(s.siteId).then((site) => setLoaded((m) => ({ ...m, [site.id]: site })))
  }, [scenarios, loaded])

  const evals: (Eval | null)[] = scenarios.map((sc) => {
    const site = loaded[sc.siteId]
    if (!site) return null
    const w = windowStats(site, sc.t, hours)
    return { sc, site, w, v: viability(w, th) }
  })
  const ready = evals.every(Boolean) ? (evals as Eval[]) : null

  const update = (k: number, patch: Partial<Scenario>) => setScenarios(scenarios.map((s, j) => (j === k ? { ...s, ...patch } : s)))
  const last = scenarios[scenarios.length - 1]
  const unusedSite = sites.find((s) => !scenarios.some((x) => x.siteId === s.id))?.id ?? last.siteId
  const samples = ready?.[0]?.site.samples ?? 8760

  return (
    <div className="chart compare">
      <div className="chart-head">
        <h2>Compare scenarios</h2>
        <div className="compare-actions">
          <button disabled={scenarios.length >= MAX} onClick={() => setScenarios([...scenarios, { siteId: unusedSite, t: last.t }])}>
            Add another site, same time
          </button>
          <button
            disabled={scenarios.length >= MAX}
            onClick={() => setScenarios([...scenarios, { siteId: last.siteId, t: Math.min(last.t + 14 * 24, samples - 1) }])}
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
        {th.minSunPct}%, darkness at most {th.maxDarkH} h, Earth in view at least {th.minEarthPct}%). Best value per row is marked.
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
                min={utcInput(timeAt(ready[k].site, 0))}
                max={utcInput(timeAt(ready[k].site, samples - 1))}
                onChange={(e) => {
                  const h = Math.round((Date.parse(e.target.value + ':00Z') - Date.parse(ready[k].site.start_utc)) / 3_600_000)
                  if (Number.isFinite(h)) update(k, { t: Math.min(Math.max(h, 0), samples - 1) })
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
