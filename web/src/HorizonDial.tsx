import { formatUtc, timeAt, type Site } from './data'

// Map view from above: north up, east right, azimuth clockwise.
// Radius grows with elevation; the terrain silhouette is the filled ring.
const SIZE = 600
const C = SIZE / 2
const R_IN = 92
const R_OUT = 272
const EL_LO = -8
const PATH_HOURS = 14 * 24

interface Props {
  site: Site
  i: number
}

export function HorizonDial({ site, i }: Props) {
  const hz = site.horizon.el_deg
  // Outer edge fits the terrain and the highest Sun/Earth of the year (low at the pole, up to 90° elsewhere).
  const peak = Math.max(...hz, ...site.sun.el, ...site.earth.el)
  const elHi = Math.min(90, Math.max(8, Math.ceil(peak) + 2))
  const span = elHi - EL_LO
  const pxPerDeg = (R_OUT - R_IN) / span
  const rOf = (el: number) => R_IN + (Math.min(Math.max(el, EL_LO), elHi) - EL_LO) * pxPerDeg
  const xy = (az: number, r: number): [number, number] => {
    const a = (az * Math.PI) / 180
    return [C + r * Math.sin(a), C - r * Math.cos(a)]
  }
  const pt = (az: number, el: number) => xy(az, rOf(el)).map((v) => v.toFixed(1)).join(',')

  const terrain =
    'M' + hz.map((el, k) => pt(k * site.horizon.az_step_deg, el)).join('L') + 'Z ' +
    `M${C},${C - R_IN} a${R_IN},${R_IN} 0 1,0 0.01,0Z`

  const gridStep = span <= 20 ? 2 : span <= 50 ? 5 : 15
  const grid: number[] = []
  for (let e = Math.ceil(EL_LO / gridStep) * gridStep; e <= elHi; e += gridStep) grid.push(e)

  const track = (b: 'sun' | 'earth') => {
    const t = site[b]
    const end = Math.min(i + PATH_HOURS, t.az.length)
    const pts: string[] = []
    for (let j = i; j < end; j += 2) pts.push(pt(t.az[j], t.el[j]))
    return pts.join(' ')
  }

  const body = (b: 'sun' | 'earth', label: string, radiusDeg: number) => {
    const t = site[b]
    const [x, y] = xy(t.az[i], rOf(t.el[i]))
    const [hx, hy] = xy(t.az[i], R_IN)
    const visible = t.frac[i] > 0
    const r = Math.max(radiusDeg * pxPerDeg, 6)
    const clipped = t.el[i] < EL_LO
    return (
      <g className={`body body-${b}`}>
        <line x1={hx} y1={hy} x2={x} y2={y} className="hand" />
        <circle cx={x} cy={y} r={r} className={visible ? 'disc on' : 'disc off'} />
        {/* Label on the outer side of the disc so it never covers the clock in the centre. */}
        <text
          x={x >= C ? x + r + 6 : x - r - 6}
          y={y + 4}
          textAnchor={x >= C ? 'start' : 'end'}
          className="body-label"
        >
          {label}
          {clipped ? ' (below scale)' : ''}
        </text>
      </g>
    )
  }

  const t = timeAt(site, i)
  const label =
    `Horizon dial for ${site.name} at ${formatUtc(t)}. Sun at azimuth ${site.sun.az[i].toFixed(0)} degrees, ` +
    `elevation ${site.sun.el[i].toFixed(2)}, ${site.sun.frac[i] > 0 ? 'visible' : 'hidden'}. ` +
    `Earth at azimuth ${site.earth.az[i].toFixed(0)}, elevation ${site.earth.el[i].toFixed(2)}, ` +
    `${site.earth.frac[i] > 0 ? 'visible' : 'hidden'}.`

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="dial" role="img" aria-label={label}>
      <circle cx={C} cy={C} r={R_OUT} className="sky" />
      {grid.map((e) => (
        <circle key={e} cx={C} cy={C} r={rOf(e)} className={e === 0 ? 'grid zero' : 'grid'} />
      ))}
      <path d={terrain} className="terrain" fillRule="evenodd" />
      <circle cx={C} cy={C} r={rOf(0)} className="flat-horizon" />
      {grid.map((e) => (
        <text key={e} x={C + 4} y={C - rOf(e) - 3} className="grid-label">
          {e > 0 ? '+' : e < 0 ? '−' : ''}
          {Math.abs(e)}°
        </text>
      ))}
      {Array.from({ length: 36 }, (_, k) => {
        const az = k * 10
        const [x1, y1] = xy(az, R_OUT)
        const [x2, y2] = xy(az, R_OUT + (az % 30 ? 5 : 10))
        return <line key={az} x1={x1} y1={y1} x2={x2} y2={y2} className="tick" />
      })}
      {Array.from({ length: 12 }, (_, k) => {
        const az = k * 30
        const [x, y] = xy(az, R_OUT + 22)
        const name = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[az]
        return (
          <text key={az} x={x} y={y + 4} className={name ? 'az-label cardinal' : 'az-label'}>
            {name ?? `${az}°`}
          </text>
        )
      })}
      <polyline points={track('earth')} className="path path-earth" />
      <polyline points={track('sun')} className="path path-sun" />
      {body('earth', 'Earth', 0.95)}
      {body('sun', 'Sun', 0.27)}
      <text x={C} y={C - 8} className="clock-date">
        {t.toISOString().slice(0, 10)}
      </text>
      <text x={C} y={C + 22} className="clock-time">
        {t.toISOString().slice(11, 16)}
      </text>
      <text x={C} y={C + 42} className="clock-utc">
        UTC
      </text>
    </svg>
  )
}
