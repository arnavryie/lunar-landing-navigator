import { useEffect, useMemo, useRef, useState } from 'react'
import { computeCustomPoint } from './customPoint'
import { ellipseOutline, ellipseSamples, type EllipseSpec, type LatLon } from './ellipseGeometry'
import type { Dot } from './MapView'
import { Field } from './Planner'
import {
  VIABILITY_LABEL, formatDuration, formatUtc, inAnalysisYear, timeAt, viability, windowStats,
  type Site, type Thresholds, type Viability, type WindowStats,
} from './data'

// F1 landing-ellipse dispersion: the lander comes down somewhere inside the ellipse, not exactly on the target.
// Every sample point is computed exactly (same engine as a map click) and judged with the planner's mission needs.

export interface EllipseOverlay {
  dots: Dot[]
  outline: LatLon[]
  focus: LatLon & { km: number }
}

interface Sample extends LatLon {
  slope: number
  samples: number
  sun: { frac: Float32Array }
  earth: { frac: Float32Array }
}

interface Props {
  site: Site
  th: Thresholds
  i: number // landing time (hour index), shared with Site and plan
  onOverlay: (o: EllipseOverlay | null) => void
}

const DEFAULT: EllipseSpec = { lengthKm: 4, widthKm: 2, headingDeg: 0 } // example only, not a specific lander

type Run = { key: string; points: (Sample | null)[]; total: number; spacingM: number }
// Inputs and results outlive the panel, so switching to the 3D tab and back keeps them.
const saved: { spec: EllipseSpec; circle: boolean; maxSlope: number; run: Run | null } = { spec: DEFAULT, circle: false, maxSlope: 8, run: null }

export function Ellipse({ site, th, i, onOverlay }: Props) {
  const [spec, setSpec] = useState(saved.spec)
  const [circle, setCircle] = useState(saved.circle)
  const [maxSlope, setMaxSlope] = useState(saved.maxSlope) // 8 deg = same default as Find sites
  const [run, setRunState] = useState(saved.run)
  const setRun = (r: Run) => setRunState((saved.run = r))
  useEffect(() => {
    Object.assign(saved, { spec, circle, maxSlope })
  }, [spec, circle, maxSlope])
  const runId = useRef(0)

  const e: EllipseSpec = circle ? { lengthKm: spec.lengthKm, widthKm: spec.lengthKm, headingDeg: 0 } : spec
  const centre = { lat: site.lat, lon: site.lon }
  const key = `${site.lat},${site.lon}|${e.lengthKm},${e.widthKm},${e.headingDeg}`
  const usable = site.lat <= -85 && inAnalysisYear(site)
  const current = run?.key === key ? run : null
  const hours = th.missionDays * 24

  const analyse = async () => {
    const id = ++runId.current
    const { points, spacingM } = ellipseSamples(centre, e)
    const out: (Sample | null)[] = []
    setRun({ key, points: out, total: points.length, spacingM })
    await Promise.all(
      points.map(async (p, j) => {
        const s = await computeCustomPoint(p.lat, p.lon, false).catch(() => null)
        if (id !== runId.current) return
        out[j] = s && {
          ...p,
          slope: s.slope_deg ?? NaN,
          samples: s.samples,
          sun: { frac: Float32Array.from(s.sun.frac) },
          earth: { frac: Float32Array.from(s.earth.frac) },
        }
        setRun({ key, points: out.slice(), total: points.length, spacingM })
      }),
    )
  }

  // Judge every finished point for the current landing time and mission needs (no recompute needed when those change).
  const judged = useMemo(() => {
    if (!current) return []
    return current.points.flatMap((p, j) => {
      if (!p) return []
      const stats = windowStats(p, i, hours)
      const steep = p.slope > maxSlope
      const v: Viability = stats && steep ? 'not' : viability(stats, th)
      return [{ ...p, j, stats, steep, v }]
    })
  }, [current, i, hours, th, maxSlope])

  const done = current ? current.points.filter((p) => p !== undefined).length : 0
  const finished = !!current && done === current.total

  useEffect(() => {
    if (!usable) return onOverlay(null)
    const longKm = Math.max(e.lengthKm, e.widthKm)
    onOverlay({
      outline: ellipseOutline(centre, e),
      dots: judged.map((p) => ({ lat: p.lat, lon: p.lon, v: p.v, cross: true })),
      focus: { ...centre, km: Math.max(longKm, 1) },
    })
  }, [key, judged, usable]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!usable)
    return (
      <div className="pick-box ellipse">
        <h3>Landing ellipse</h3>
        <p className="muted">
          {site.lat > -85
            ? 'Available for points from 85° S to the pole (the range the browser engine covers). Click a point on the map.'
            : 'Mission replays are outside the 2027 analysis year; pick a 2027 site or click the map.'}
        </p>
      </div>
    )

  const set = (k: keyof EllipseSpec, v: string) => setSpec({ ...spec, [k]: Math.max(0, Number(v) || 0) })
  const counts = { viable: 0, marginal: 0, not: 0, nodata: 0 }
  judged.forEach((p) => counts[p.v]++)
  const steep = judged.filter((p) => p.steep).length
  const target = judged.find((p) => p.j === 0)

  const rows = (
    [
      { label: 'Sunlit', get: (s: WindowStats) => s.sunPct, fmt: (v: number) => `${v.toFixed(0)}%`, higher: true },
      { label: 'Longest darkness', get: (s: WindowStats) => s.longestDarkH, fmt: formatDuration, higher: false },
      { label: 'Earth in view', get: (s: WindowStats) => s.earthPct, fmt: (v: number) => `${v.toFixed(0)}%`, higher: true },
    ] as const
  ).map((r) => {
    const vals = judged.flatMap((p) => (p.stats ? [r.get(p.stats)] : []))
    return { label: r.label, fmt: r.fmt, t: target?.stats ? r.get(target.stats) : null, ...spread(vals, r.higher) }
  })
  const slopes = judged.map((p) => p.slope).filter(Number.isFinite)
  const sl = spread(slopes, false)

  return (
    <div className="pick-box ellipse">
      <h3>Landing ellipse</h3>
      <p className="chart-note">
        The lander should come down inside this ellipse (typically about 99% of the time), longer along its flight path.
        Default size is an example, not a specific lander.
      </p>
      <fieldset className="thresholds">
        <legend>Ellipse around {site.kind === 'custom' ? 'the picked point' : site.name}</legend>
        <label className="radio">
          <input type="checkbox" checked={circle} onChange={(ev) => setCircle(ev.target.checked)} />
          Circle (same size every way)
        </label>
        <Field label={circle ? 'Diameter' : 'Length (along flight)'} unit="km" value={spec.lengthKm} step={0.5} onChange={(v) => set('lengthKm', v)} />
        {!circle && (
          <>
            <Field label="Width (across)" unit="km" value={spec.widthKm} step={0.5} onChange={(v) => set('widthKm', v)} />
            <Field label="Approach direction" unit="°" value={spec.headingDeg} step={15} onChange={(v) => set('headingDeg', v)} />
            <p className="chart-note">Clockwise from north; at the pole, north is away from the pole.</p>
          </>
        )}
        <Field label="Max slope" unit="°" value={maxSlope} step={1} onChange={(v) => setMaxSlope(Math.max(0, Number(v) || 0))} />
      </fieldset>
      <p className="chart-note">
        Landing {formatUtc(timeAt(site, i))}, {th.missionDays}-day mission: sunlit ≥ {th.minSunPct}%, darkness ≤ {th.maxDarkH} h,
        Earth ≥ {th.minEarthPct}% (set on Site and plan).
      </p>
      <div className="pick-actions">
        <button className="primary" onClick={analyse} disabled={!!current && !finished}>
          {current && !finished ? `Computing ${done} of ${current.total} points…` : current ? 'Run again' : 'Analyse ellipse'}
        </button>
      </div>

      {current && judged.length > 0 && (
        <>
          <div className={`verdict ${finished && counts.viable === judged.length ? 'ok' : counts.viable < judged.length ? 'fail' : ''}`}>
            <p className="verdict-line">
              {counts.viable === judged.length && finished
                ? `All ${judged.length} sampled points meet your mission needs`
                : `${counts.viable} of ${judged.length} sampled points viable`}
            </p>
            <p className="muted">
              {counts.marginal} marginal · {counts.not} not viable{steep ? ` (${steep} steeper than ${maxSlope}°)` : ''}
              {counts.nodata ? ` · ${counts.nodata} run past the 2027 data` : ''}
              {target ? ` · target point: ${VIABILITY_LABEL[target.v].toLowerCase()}` : ''}
            </p>
          </div>
          <table className="ellipse-table">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Target</th>
                <th scope="col">Worst</th>
                <th scope="col">Typical</th>
                <th scope="col">Best</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.t === null ? '–' : r.fmt(r.t)}</td>
                  <td>{r.worst === null ? '–' : r.fmt(r.worst)}</td>
                  <td>{r.median === null ? '–' : r.fmt(r.median)}</td>
                  <td>{r.best === null ? '–' : r.fmt(r.best)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Slope (240 m)</th>
                <td>{target && Number.isFinite(target.slope) ? `${target.slope.toFixed(1)}°` : '–'}</td>
                <td>{sl.worst === null ? '–' : `${sl.worst.toFixed(1)}°`}</td>
                <td>{sl.median === null ? '–' : `${sl.median.toFixed(1)}°`}</td>
                <td>{sl.best === null ? '–' : `${sl.best.toFixed(1)}°`}</td>
              </tr>
            </tbody>
          </table>
          <p className="chart-note">
            Map: ● viable, ○ marginal, × not viable. {current.total} points
            {current.spacingM ? ` about ${(current.spacingM / 1000).toFixed(2)} km apart plus 12 on the edge` : ''}, each computed
            exactly. Typical = median. Terrain is 240 m per pixel: boulders and small craters are smaller than that, and real
            landers avoid them with onboard hazard detection, so this checks Sun, Earth and slope, not touchdown safety.
            {current.total === 1 ? ' This ellipse is smaller than one terrain pixel, so only the target is checked.' : ''}
          </p>
        </>
      )}
    </div>
  )
}

/** Worst / median / best of a list; `higher` = bigger is better. */
function spread(vals: number[], higher: boolean) {
  if (!vals.length) return { worst: null, median: null, best: null }
  const s = [...vals].sort((a, b) => a - b)
  const lo = s[0]
  const hi = s[s.length - 1]
  const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  return higher ? { worst: lo, median: mid, best: hi } : { worst: hi, median: mid, best: lo }
}
