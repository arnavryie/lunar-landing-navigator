import { useMemo } from 'react'
import { stateAt, timeAt, type Site, type State } from './data'

/** Power/comms state across the whole data period, with the current time marked.
 *  Bars are SVG in hour units (stretched to width); month labels are HTML. */
export function YearStrip({ site, i }: { site: Site; i: number }) {
  const runs = useMemo(() => {
    const out: { start: number; end: number; state: State }[] = []
    for (let j = 0; j < site.samples; j++) {
      const s = stateAt(site, j)
      const last = out[out.length - 1]
      if (last && last.state === s) last.end = j + 1
      else out.push({ start: j, end: j + 1, state: s })
    }
    return out
  }, [site])

  const months = useMemo(() => {
    const out: { j: number; label: string }[] = []
    for (let j = 0; j < site.samples; j++) {
      const d = timeAt(site, j)
      if (d.getUTCDate() === 1 && d.getUTCHours() === 0)
        out.push({ j, label: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) })
    }
    return out
  }, [site])

  return (
    <div className="strip" aria-hidden="true">
      <svg viewBox={`0 0 ${site.samples} 1`} preserveAspectRatio="none" className="strip-bars">
        {runs.map((r) => (
          <rect key={r.start} x={r.start} y={0} width={r.end - r.start} height={1} className={`st-${r.state}`} />
        ))}
        <line x1={i + 0.5} x2={i + 0.5} y1={0} y2={1} className="cursor" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="ticks">
        {months.map((m) => (
          <span key={m.j} style={{ left: `${(m.j / site.samples) * 100}%` }}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  )
}
