import { useMemo, useState, type MouseEvent } from 'react'
import { dailyHours, formatDate, timeAt, tipStyle, type Site } from './data'

/** Hours per day the body is in view, across the year: the lunar seasons. Two charts, one scale each. */
export function Seasons({ site, i }: { site: Site; i: number }) {
  return (
    <div className="chart">
      <div className="chart-head">
        <h2>Seasons</h2>
      </div>
      <p className="chart-note">
        Hours per day in view across {new Date(site.start_utc).getUTCFullYear()}. Each lunar day lasts about 29.5 Earth
        days; the slow swell across the year is the lunar season.
      </p>
      <DailyArea site={site} i={i} b="sun" title="Sun: hours lit per day" />
      <DailyArea site={site} i={i} b="earth" title="Earth: hours in view per day" />
    </div>
  )
}

function DailyArea({ site, i, b, title }: { site: Site; i: number; b: 'sun' | 'earth'; title: string }) {
  const hours = useMemo(() => dailyHours(site, b), [site, b])
  const [hover, setHover] = useState<number | null>(null)
  const n = hours.length
  // Step area in (day, hours) units; y flipped so 24 h is at the top.
  let path = `M0,24`
  hours.forEach((v, d) => (path += `L${d},${24 - v}L${d + 1},${24 - v}`))
  path += `L${n},24Z`
  const today = Math.floor(i / 24)
  const avg = hours.reduce((a, v) => a + v, 0) / n

  const dayAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)))
  }

  return (
    <div className="area-block">
      <h3 className="mini-title">
        {title}
        <span className="muted">, average {avg.toFixed(1)} h</span>
      </h3>
      <div className="area-wrap">
        <div className="y-labels" aria-hidden="true">
          <span>24 h</span>
          <span>12 h</span>
          <span>0 h</span>
        </div>
        <div
          className="area-plot"
          role="img"
          aria-label={`${title}, average ${avg.toFixed(1)} hours per day`}
          onMouseMove={(e) => setHover(dayAt(e))}
          onMouseLeave={() => setHover(null)}
        >
          <svg viewBox={`0 0 ${n} 24`} preserveAspectRatio="none" className="area">
            {[0, 12, 24].map((v) => (
              <line key={v} x1={0} x2={n} y1={v} y2={v} className="grid" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={path} className={`area-${b}`} />
            <line x1={today + 0.5} x2={today + 0.5} y1={0} y2={24} className="cursor" vectorEffect="non-scaling-stroke" />
            {hover !== null && (
              <line x1={hover + 0.5} x2={hover + 0.5} y1={0} y2={24} className="crosshair" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {hover !== null && (
            <div className="tooltip" style={tipStyle((hover + 0.5) / n)}>
              <strong>{formatDate(timeAt(site, hover * 24))}</strong>
              <span>{hours[hover]} h in view</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
