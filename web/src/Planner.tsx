import { useMemo, useState } from 'react'
import {
  DEFAULT_THRESHOLDS, MARGIN, VIABILITY_LABEL, dailyViability, formatDate, formatDuration, hoursToChange,
  slipBudget, timeAt, viability, windowStats,
  type DayEval, type Site, type Thresholds, type Viability, type WindowStats,
} from './data'

const LUNAR_MONTH_H = 709 // 29.53 days
const SLIPS = [
  { label: '+1 d', h: 24 },
  { label: '+7 d', h: 7 * 24 },
  { label: '+14 d', h: 14 * 24 },
  { label: '+1 lunar month', h: LUNAR_MONTH_H },
]
const RANK: Record<Viability, number> = { viable: 3, marginal: 2, not: 1, nodata: 0 }

interface Props {
  site: Site
  i: number
  setI: (i: number) => void
  planned: number // landing day index (landing at 00:00 UTC)
  setPlanned: (d: number) => void
  th: Thresholds
  setTh: (t: Thresholds) => void
  /** Opens Find sites for the selected date; no button when absent. */
  onFindAlternatives?: () => void
}

/** F3: viability thresholds, landing-date calendar, slip buttons, before/after card and slip budget. */
export function Planner({ site, i, setI, planned, setPlanned, th, setTh, onFindAlternatives }: Props) {
  const days = useMemo(() => dailyViability(site, th), [site, th])
  const [hover, setHover] = useState<number | null>(null)
  const [custom, setCustom] = useState(3)
  const [copied, setCopied] = useState(false)
  const hours = th.missionDays * 24
  const last = site.samples - 1
  const slipH = i - planned * 24
  const budget = slipBudget(days, planned)
  const best = useMemo(() => bestWindows(days, planned), [days, planned])
  const today = days[Math.floor(i / 24)]

  const plan = (d: number) => {
    const day = Math.min(Math.max(d, 0), days.length - 1)
    setPlanned(day)
    setI(day * 24)
  }
  const slip = (h: number) => setI(Math.min(Math.max(i + h, 0), last))
  const setNum = (k: keyof Thresholds, v: string) => setTh({ ...th, [k]: Math.max(k === 'missionDays' ? 1 : 0, Number(v) || 0) })

  const months = useMemo(() => {
    const rows: { label: string; cells: { d: number; dom: number }[] }[] = []
    days.forEach((_, d) => {
      const t = timeAt(site, d * 24)
      if (t.getUTCDate() === 1 || d === 0)
        rows.push({ label: t.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), cells: [] })
      rows[rows.length - 1].cells.push({ d, dom: t.getUTCDate() })
    })
    return rows
  }, [site, days])

  const shown = hover ?? Math.floor(i / 24)
  const shownEval = days[shown]

  return (
    <div className="chart planner">
      <div className="chart-head">
        <h2>Landing date planner</h2>
        <button
          onClick={() => navigator.clipboard.writeText(location.href).then(() => setCopied(true), () => setCopied(false))}
          onBlur={() => setCopied(false)}
        >
          {copied ? 'Link copied' : 'Copy link to this scenario'}
        </button>
      </div>

      <div className="planner-grid">
        <div className="planner-side">
          <fieldset className="thresholds">
            <legend>Mission needs</legend>
            <Field label="Mission length" unit="days" value={th.missionDays} step={1} onChange={(v) => setNum('missionDays', v)} />
            <Field label="Sunlit at least" unit="%" value={th.minSunPct} step={5} onChange={(v) => setNum('minSunPct', v)} />
            <Field label="Darkness at most" unit="h" value={th.maxDarkH} step={6} onChange={(v) => setNum('maxDarkH', v)} />
            <Field label="Earth in view at least" unit="%" value={th.minEarthPct} step={5} onChange={(v) => setNum('minEarthPct', v)} />
            <button className="link" onClick={() => setTh(DEFAULT_THRESHOLDS)}>
              Reset to example values
            </button>
          </fieldset>
          <p className="chart-note">
            Viable: meets all three over the whole mission, counted from landing at 00:00 UTC. Marginal: misses by at
            most {MARGIN.sunPct} points of sunlight or Earth view, or {Math.round((MARGIN.darkFactor - 1) * 100)}% more
            darkness. Example values; set your mission's own.
          </p>

          <label className="plan-date">
            <span>Planned landing</span>
            <input
              type="date"
              value={formatDate(timeAt(site, planned * 24))}
              min={formatDate(timeAt(site, 0))}
              max={formatDate(timeAt(site, last))}
              onChange={(e) => {
                const ms = Date.parse(e.target.value) - Date.parse(site.start_utc)
                if (!Number.isNaN(ms)) plan(Math.round(ms / 86_400_000))
              }}
            />
          </label>

          <div className="slips" role="group" aria-label="Slip the landing">
            {SLIPS.map((s) => (
              <button key={s.label} onClick={() => slip(s.h)}>
                {s.label}
              </button>
            ))}
            <span className="custom">
              <input type="number" min={1} value={custom} aria-label="Custom slip in days" onChange={(e) => setCustom(Math.max(1, Number(e.target.value) || 1))} />
              <button onClick={() => slip(custom * 24)}>+{custom} d</button>
            </span>
            {slipH !== 0 && (
              <button className="link" onClick={() => setI(planned * 24)}>
                Back to planned date
              </button>
            )}
          </div>

          <p className="budget">
            {budget.canSlip !== null ? (
              <>
                The planned date is viable. You can slip up to{' '}
                <strong>
                  {budget.canSlip} day{budget.canSlip === 1 ? '' : 's'}
                </strong>{' '}
                and stay viable.{' '}
              </>
            ) : (
              <>The planned date is {VIABILITY_LABEL[days[planned].status].toLowerCase()}. </>
            )}
            {budget.nextViable !== null ? (
              <>
                {budget.canSlip !== null ? 'After that, the next' : 'The next'} viable window opens on{' '}
                <button className="link" onClick={() => setI(budget.nextViable! * 24)}>
                  {formatDate(timeAt(site, budget.nextViable * 24))}
                </button>
                .
              </>
            ) : (
              'No later viable date in the data.'
            )}
          </p>

          {onFindAlternatives && (
            <button className={today && today.status !== 'viable' ? 'find-alt is-needed' : 'find-alt'} onClick={onFindAlternatives}>
              Find other spots for {formatDate(timeAt(site, Math.floor(i / 24) * 24))}
            </button>
          )}

          <div className="best-dates">
            <h3>Best 3 landing windows after the planned date</h3>
            {best.length ? (
              <ol>
                {best.map((w) => (
                  <li key={w.day}>
                    <button className="link" onClick={() => setI(w.day * 24)}>
                      {formatDate(timeAt(site, w.day * 24))}
                    </button>{' '}
                    <span className={`v-tag v-${w.status}`}>{VIABILITY_LABEL[w.status]}</span>{' '}
                    <span className="muted">
                      sunlit {w.stats.sunPct.toFixed(0)}%, longest darkness {formatDuration(w.stats.longestDarkH)}, Earth{' '}
                      {w.stats.earthPct.toFixed(0)}%
                      {w.len > 1 && ` (best day of a ${w.len}-day window from ${formatDate(timeAt(site, w.from * 24))})`}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No viable or marginal landing date after the planned date in the data.</p>
            )}
            <p className="chart-note">
              One date per run of good days, picked by verdict, then shortest longest-darkness, then most sunlight and Earth view; listed by date. Click a date to compare it with the plan.
            </p>
          </div>
        </div>

        <div className="planner-cal">
          <div className="cal" onMouseLeave={() => setHover(null)} role="img" aria-label="Calendar of landing dates coloured by viability. Click a day to plan a landing on it.">
            {months.map((m) => (
              <div className="cal-row" key={m.label + m.cells[0].d}>
                <span className="cal-month">{m.label}</span>
                {m.cells.map((c) => (
                  <span
                    key={c.d}
                    className={[
                      'cell',
                      `v-${days[c.d].status}`,
                      c.d === planned ? 'is-planned' : '',
                      c.d === Math.floor(i / 24) ? 'is-current' : '',
                    ].join(' ')}
                    style={{ gridColumn: c.dom + 1 }}
                    onMouseEnter={() => setHover(c.d)}
                    onClick={() => plan(c.d)}
                  />
                ))}
              </div>
            ))}
          </div>
          <p className="cal-info">
            <strong>{formatDate(timeAt(site, shown * 24))}</strong> {VIABILITY_LABEL[shownEval.status]}
            {shownEval.stats && (
              <span className="muted">
                {' '}
                Sunlit {shownEval.stats.sunPct.toFixed(0)}%, longest darkness {formatDuration(shownEval.stats.longestDarkH)}, Earth in view{' '}
                {shownEval.stats.earthPct.toFixed(0)}%
              </span>
            )}
          </p>
          <ul className="legend">
            {(['viable', 'marginal', 'not', 'nodata'] as const).map((v) => (
              <li key={v}>
                <span className={`swatch cell v-${v}`} aria-hidden="true" />
                {VIABILITY_LABEL[v]}
              </li>
            ))}
            <li>
              <span className="swatch cell is-planned" aria-hidden="true" />
              Planned
            </li>
            <li>
              <span className="swatch cell is-current" aria-hidden="true" />
              Selected time
            </li>
          </ul>
        </div>
      </div>

      <BeforeAfter site={site} plannedI={planned * 24} newI={i} hours={hours} th={th} />
    </div>
  )
}

type Window = { day: number; from: number; len: number; status: Viability; stats: WindowStats }

/** Up to 3 landing windows from day p on: each run of consecutive viable (or, if none, marginal) days gives its best day. */
function bestWindows(days: DayEval[], p: number, n = 3): Window[] {
  const better = (a: WindowStats, b: WindowStats) =>
    a.longestDarkH - b.longestDarkH || b.sunPct - a.sunPct || b.earthPct - a.earthPct
  const runs = (status: Viability) => {
    const out: Window[] = []
    for (let d = Math.max(p, 0); d < days.length; d++) {
      const e = days[d]
      if (e.status !== status || !e.stats) continue
      const last = out[out.length - 1]
      if (last && last.from + last.len === d) {
        last.len++
        if (better(e.stats, last.stats) < 0) Object.assign(last, { day: d, stats: e.stats })
      } else out.push({ day: d, from: d, len: 1, status, stats: e.stats })
    }
    return out.sort((a, b) => better(a.stats, b.stats))
  }
  const viable = runs('viable')
  return (viable.length ? viable : runs('marginal')).slice(0, n).sort((a, b) => a.day - b.day)
}

export function Field(p: { label: string; unit: string; value: number; step: number; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <input type="number" min={0} step={p.step} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
      <span className="unit">{p.unit}</span>
    </label>
  )
}

function atLanding(frac: number[], i: number, up: string, down: string, rise: string) {
  const h = hoursToChange(frac, i)
  const when = h === null ? 'not before the data ends' : `in ${formatDuration(h)}`
  return frac[i] > 0 ? `${up}, ${down} ${when}` : `Hidden, ${rise} ${when}`
}

function BeforeAfter({ site, plannedI, newI, hours, th }: { site: Site; plannedI: number; newI: number; hours: number; th: Thresholds }) {
  const a = windowStats(site, plannedI, hours)
  const b = windowStats(site, newI, hours)
  const va = viability(a, th)
  const vb = viability(b, th)
  const slipH = newI - plannedI
  type Row = { label: string; before: string; after: string; trend?: number }
  const num = (f: (s: WindowStats) => number, fmt: (v: number) => string, higherIsBetter: boolean): Omit<Row, 'label'> => ({
    before: a ? fmt(f(a)) : '–',
    after: b ? fmt(f(b)) : '–',
    trend: a && b ? Math.sign(f(b) - f(a)) * (higherIsBetter ? 1 : -1) : undefined,
  })
  const rows: Row[] = [
    { label: 'Verdict', before: VIABILITY_LABEL[va], after: VIABILITY_LABEL[vb], trend: Math.sign(RANK[vb] - RANK[va]) },
    { label: 'Sunlit during mission', ...num((s) => s.sunPct, (v) => `${v.toFixed(0)}%`, true) },
    { label: 'Longest darkness', ...num((s) => s.longestDarkH, formatDuration, false) },
    { label: 'Earth in view during mission', ...num((s) => s.earthPct, (v) => `${v.toFixed(0)}%`, true) },
    {
      label: 'Sun at landing',
      before: atLanding(site.sun.frac, plannedI, 'Up', 'sets', 'rises'),
      after: atLanding(site.sun.frac, newI, 'Up', 'sets', 'rises'),
    },
    {
      label: 'Earth at landing',
      before: atLanding(site.earth.frac, plannedI, 'In view', 'sets', 'rises'),
      after: atLanding(site.earth.frac, newI, 'In view', 'sets', 'rises'),
    },
  ]
  const word = (t?: number) => (t === undefined || t === 0 ? 'Same' : t > 0 ? 'Better' : 'Worse')
  return (
    <div className="before-after">
      <h3>
        {slipH === 0 ? 'Planned landing' : `Slipped by ${formatDuration(Math.abs(slipH))}${slipH < 0 ? ' earlier' : ''}`}
        <span className="muted">
          {' '}
          {formatDate(timeAt(site, plannedI))} → {timeAt(site, newI).toISOString().slice(0, 16).replace('T', ' ')} UTC,{' '}
          {th.missionDays}-day mission
        </span>
      </h3>
      <table>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Planned</th>
            <th scope="col">After slip</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.before}</td>
              <td>{r.after}</td>
              <td className={r.trend === undefined ? '' : r.trend > 0 ? 'up' : r.trend < 0 ? 'down' : ''}>
                {r.trend === undefined ? '' : `${r.trend > 0 ? '▲' : r.trend < 0 ? '▼' : '='} ${word(r.trend)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
