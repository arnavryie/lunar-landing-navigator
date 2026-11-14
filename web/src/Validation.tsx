import { useEffect, useState, type ReactNode } from 'react'
import {
  loadEngineCheck, loadSite, loadValidation, replayAtLanding,
  type EngineCheck, type Site, type Validation as ValidationData,
} from './data'
import { REPLAY_MISSIONS } from './Replays'
import './styles/evidence.css'

// Every number here is read from a file a check script wrote (validation.json from the pipeline,
// engine_check.json from `npm run check:engine`) or computed from replay data; nothing is typed in.
const fmtDate = (d: Date | null) => (d ? d.toUTCString().slice(5, 22) + ' UTC' : 'none within the replay window')

function Card({ n, title, badge, pass, desc, rows, rerun }: {
  n: number; title: string; badge: string; pass?: boolean; desc: string; rows: [string, ReactNode][]; rerun: ReactNode
}) {
  return (
    <div className="val-card">
      <div className={`val-badge ${pass === false ? 'fail' : 'pass'}`}>{badge}</div>
      <h3>{n}. {title}</h3>
      <p className="val-desc">{desc}</p>
      <div className="val-metrics-table">
        {rows.map(([k, v]) => (
          <div className="val-row" key={k}><span>{k}</span><strong>{v}</strong></div>
        ))}
      </div>
      <div className="val-cmd">{rerun}</div>
    </div>
  )
}

const verdict = (p: boolean | undefined) => (p === undefined ? 'Loading…' : p ? 'PASS' : 'FAIL')

export function Validation({ onReturnToSite }: { onReturnToSite: () => void }) {
  const [val, setVal] = useState<ValidationData | null>(null)
  const [eng, setEng] = useState<EngineCheck | null>(null)
  const [replays, setReplays] = useState<Site[]>([])

  useEffect(() => {
    loadValidation().then(setVal, () => setVal(null))
    loadEngineCheck().then(setEng, () => setEng(null))
    Promise.all(REPLAY_MISSIONS.map((m) => loadSite(m.id))).then(setReplays, () => setReplays([]))
  }, [])

  const h = val?.horizons, il = val?.illumination, e = eng?.engine, f = eng?.finder
  const na = '…'

  return (
    <div className="validation-page">
      <div className="validation-top">
        <button type="button" className="validation-back-btn" onClick={onReturnToSite}>
          ← Back to Mission Planner
        </button>
        <h2>How we checked the numbers</h2>
        <p className="validation-lead">
          For each check: what is compared, the result, the pass mark set before the run, and how to rerun it.
          {eng && <> Browser checks last run {eng.run_utc.replace('T', ' ')}.</>}
        </p>
      </div>

      <div className="validation-grid">
        <Card n={1} title="Sun and Earth directions vs NASA JPL Horizons" pass={h?.passed}
          badge={`${verdict(h?.passed)}${h ? `: worst ${h.worst_deg.toExponential(1)}°` : ''}`}
          desc="Our Sun and Earth directions (Skyfield, JPL DE421, Moon frame) against JPL Horizons for the same sites and hours."
          rows={[
            ['Worst direction difference', h ? `${h.worst_deg.toFixed(6)}° (${(h.worst_deg * 3600).toFixed(2)} arcsec)` : na],
            ['Pass mark', h ? `under ${h.tolerance_deg}°` : na],
            ['Compared', h ? `${h.samples.toLocaleString('en')} directions, ${h.points} sites, ${h.period_utc[0].slice(0, 10)} to ${h.period_utc[1].slice(0, 10)}` : na],
          ]}
          rerun={<code>python pipeline/validate_horizons.py</code>} />

        <Card n={2} title="Sunlit and Earth-in-view % vs NASA illumination maps" pass={il?.passed}
          badge={`${verdict(il?.passed)}${il ? `: r = ${il.sun.correlation.toFixed(3)} / ${il.earth.correlation.toFixed(3)}` : ''}`}
          desc="Our long-term sunlit and Earth-in-view percentages against NASA's LOLA-based maps (Mazarico et al. 2011), over an 18.6-year cycle."
          rows={[
            ['Points compared', il ? il.points : na],
            ['Correlation (Sun / Earth)', il ? `${il.sun.correlation.toFixed(3)} / ${il.earth.correlation.toFixed(3)}` : na],
            ['Median difference', il ? `${il.sun.median_abs_diff_pp} / ${il.earth.median_abs_diff_pp} points` : na],
            ['90% of points within', il ? `${il.sun.p90_abs_diff_pp} / ${il.earth.p90_abs_diff_pp} points` : na],
            ['Worst point', il ? `${il.sun.max_abs_diff_pp} / ${il.earth.max_abs_diff_pp} points` : na],
            ['Pass mark', 'correlation ≥ 0.9 and median difference ≤ 5 points'],
          ]}
          rerun={<code>python pipeline/validate_illumination.py</code>} />

        <Card n={3} title="Browser engine vs the Python pipeline" pass={e?.passed}
          badge={`${verdict(e?.passed)}${e ? `: ${e.direction_deg.toExponential(1)}°` : ''}`}
          desc="Map clicks are computed in your browser (engine.ts). This repeats the pipeline's calculation for test points and compares."
          rows={[
            ['Test points', e ? e.points : na],
            ['Worst direction difference', e ? `${e.direction_deg.toExponential(2)}°` : na],
            ['Worst sunlit / Earth difference', e ? `${e.sunlit_pp.toFixed(2)} / ${e.earth_pp.toFixed(2)} points` : na],
            ['Worst horizon difference', e ? `${e.horizon_deg.toFixed(4)}°` : na],
            ['Pass mark', 'direction under 0.001°, sunlit and Earth within 0.5 points'],
          ]}
          rerun={<code>npm run check:engine</code>} />

        <Card n={4} title="Site finder quick estimate vs exact" pass={f?.passed}
          badge={`${verdict(f?.passed)}${f ? `: worst ${f.worst_pp.toFixed(2)} points` : ''}`}
          desc="Find sites ranks thousands of spots with coarse 1° horizons, then recomputes the top 5 exactly. This compares the two over a full year."
          rows={[
            ['Spots compared', f ? f.candidates : na],
            ['Worst yearly sunlit / Earth difference', f ? `${f.worst_pp.toFixed(2)} points` : na],
            ['Mission-window maths matches a full-year run', f ? (f.window_match ? 'yes' : 'no') : na],
            ['Pass mark', f ? `within ${f.limit_pp} points, windows identical` : na],
          ]}
          rerun={<code>npm run check:engine</code>} />

        <Card n={5} title="3D shadows (GPU) vs the pipeline" badge="Last run: 191 of 192 agree"
          desc="The 3D tab draws shadows on the graphics card. This compares its lit-or-not answer with the pipeline for test spots and hours."
          rows={[
            ['Agreeing values', '191 of 192 (last run, 14 Nov 2026)'],
            ['The one miss', "Mons Mouton, with the Sun's upper edge 0.004° from the terrain"],
          ]}
          rerun={<span>Rerun live: 3D tab → "Check shadows against the pipeline"</span>} />

        <Card n={6} title="Mission replays: our model vs what was reported" badge="Comparison, not a pass mark"
          desc="Real landers at their real landing dates. Agencies don't publish hour-by-hour sunlight, so this is a consistency check."
          rows={replays.map((s) => {
            const a = replayAtLanding(s)
            return [s.name.replace('Replay: ', ''), <>
              Our model at landing: Sun {a.sunUp ? 'up' : 'blocked'}, Earth {a.earthUp ? 'in view' : 'hidden'}; first sunset {fmtDate(a.sunset)}.
              {' '}Reported: {s.replay!.outcome}{' '}
              <a href={s.replay!.outcome_url} target="_blank" rel="noopener noreferrer">{s.replay!.outcome_source} ↗</a>
            </>] as [string, ReactNode]
          })}
          rerun={<span>Site and plan → Mission replays</span>} />
      </div>

      <div className="val-assumptions">
        <h3>Assumptions</h3>
        <div className="assumptions-grid">
          <div className="assump-box">
            <strong>2 m mast</strong>
            <p>Solar panels and antenna are taken as 2 m above the ground.</p>
          </div>
          <div className="assump-box">
            <strong>240 m terrain</strong>
            <p>NASA LOLA elevation (240 m south of 60° S; 1.9 km elsewhere), including the Moon's curvature. Smaller features aren't seen.</p>
          </div>
          <div className="assump-box">
            <strong>Hourly steps</strong>
            <p>Visibility is computed once per hour; events can be off by up to an hour.</p>
          </div>
          <div className="assump-box">
            <strong>No refraction</strong>
            <p>The Moon has no atmosphere, so light travels in straight lines.</p>
          </div>
          <div className="assump-box">
            <strong>Sun and Earth as discs</strong>
            <p>We report the fraction of each disc above the terrain, not just a centre point.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
