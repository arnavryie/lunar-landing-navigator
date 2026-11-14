import { useState, type MouseEvent } from 'react'
import { STATE_LABEL, formatUtc, stateAt, timeAt, tipStyle, type Site } from './data'

const WINDOWS = [7, 30, 90] // days
const ROWS = [
  { key: 'sun', label: 'Sunlit', cls: 'st-sun' },
  { key: 'earth', label: 'Earth in view', cls: 'st-earth' },
  { key: 'both', label: 'Both', cls: 'st-both' },
] as const

type Row = (typeof ROWS)[number]['key']

function on(site: Site, row: Row, j: number) {
  const s = site.sun.frac[j] > 0
  const e = site.earth.frac[j] > 0
  return row === 'sun' ? s : row === 'earth' ? e : s && e
}

/** Gantt-style availability tracks around the selected time. Click to move the time there.
 *  Bars are SVG in hour units (stretched to width); all text is HTML so it stays readable. */
export function Timeline({ site, i, onPick }: { site: Site; i: number; onPick: (i: number) => void }) {
  const [days, setDays] = useState(30)
  const [hover, setHover] = useState<number | null>(null)
  const span = Math.min(days * 24, site.samples)
  const start = Math.min(Math.max(i - Math.floor(span / 4), 0), site.samples - span)
  const pct = (j: number) => `${((j - start) / span) * 100}%`

  const runs = (row: Row) => {
    const out: [number, number][] = []
    for (let j = start; j < start + span; j++) {
      if (!on(site, row, j)) continue
      const last = out[out.length - 1]
      if (last && last[1] === j) last[1] = j + 1
      else out.push([j, j + 1])
    }
    return out
  }

  const ticks: { j: number; label: string }[] = []
  const tickEvery = days <= 7 ? 1 : days <= 30 ? 5 : 15
  for (let j = start; j < start + span; j++) {
    const d = timeAt(site, j)
    if (d.getUTCHours() === 0 && (d.getUTCDate() - 1) % tickEvery === 0)
      ticks.push({ j, label: d.toISOString().slice(5, 10) })
  }

  const indexAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 0.9999)
    return start + Math.floor(f * span)
  }

  return (
    <div className="chart">
      <div className="chart-head">
        <h2>Availability</h2>
        <div className="seg" role="group" aria-label="Time window">
          {WINDOWS.map((d) => (
            <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <div className="gantt">
        <div className="gantt-labels" aria-hidden="true">
          {ROWS.map((r) => (
            <span key={r.key}>{r.label}</span>
          ))}
        </div>
        <div
          className="gantt-plot"
          role="img"
          aria-label={`Sunlit, Earth in view and both, ${days} days from ${formatUtc(timeAt(site, start))}. Click to move the selected time.`}
          onMouseMove={(e) => setHover(indexAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => onPick(indexAt(e))}
        >
          {ROWS.map((row) => (
            <svg key={row.key} viewBox={`${start} 0 ${span} 1`} preserveAspectRatio="none" className="track">
              <rect x={start} y={0} width={span} height={1} className="track-bg" />
              {runs(row.key).map(([a, b]) => (
                <rect key={a} x={a} y={0} width={b - a} height={1} className={row.cls} />
              ))}
              <line x1={i + 0.5} x2={i + 0.5} y1={0} y2={1} className="cursor" vectorEffect="non-scaling-stroke" />
              {hover !== null && (
                <line x1={hover + 0.5} x2={hover + 0.5} y1={0} y2={1} className="crosshair" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          ))}
          <div className="ticks" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t.j} style={{ left: pct(t.j) }}>
                {t.label}
              </span>
            ))}
          </div>
          {hover !== null && (
            <div className="tooltip" style={tipStyle((hover - start) / span)}>
              <strong>{formatUtc(timeAt(site, hover))}</strong>
              <span>{STATE_LABEL[stateAt(site, hover)]}</span>
              <span>Sun disc {Math.round(site.sun.frac[hover] * 100)}% visible</span>
              <span>Earth disc {Math.round(site.earth.frac[hover] * 100)}% visible</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
