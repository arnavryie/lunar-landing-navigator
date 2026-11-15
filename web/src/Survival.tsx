import { useState } from 'react'
import { DEFAULT_ARRAY, formatDuration, nextDarkness, peakWatts, type Site, type SolarArray } from './data'

/** Lander survival: can the battery carry the survival load through the darkness? Pure arithmetic: W x h. */
export function Survival({ site, i, arr = DEFAULT_ARRAY, setArr }: { site: Site; i: number; arr?: SolarArray; setArr?: (a: SolarArray) => void }) {
  const [watts, setWatts] = useState(100)
  const [wh, setWh] = useState(20000)
  const year = new Date(site.start_utc).getUTCFullYear()
  const next = nextDarkness(site.sun.frac, i)
  const worst = site.metrics.longest_dark_h

  return (
    <div className="chart survival">
      <div className="chart-head">
        <h2>Lander survival</h2>
      </div>
      <div className="inputs">
        <label>
          <span>Power draw in darkness</span>
          <input type="number" min={0} step={10} value={watts} onChange={(e) => setWatts(Math.max(0, Number(e.target.value)))} />
          <span className="unit">W</span>
        </label>
        <label>
          <span>Usable battery</span>
          <input type="number" min={0} step={500} value={wh} onChange={(e) => setWh(Math.max(0, Number(e.target.value)))} />
          <span className="unit">Wh</span>
        </label>
      </div>
      {setArr && (
        <div className="inputs">
          <label>
            <span>Solar array area</span>
            <input type="number" min={0} step={0.1} value={arr.areaM2} onChange={(e) => setArr({ ...arr, areaM2: Math.max(0, Number(e.target.value)) })} />
            <span className="unit">m²</span>
          </label>
          <label>
            <span>Cell efficiency</span>
            <input type="number" min={0} max={100} step={1} value={arr.effPct} onChange={(e) => setArr({ ...arr, effPct: Math.min(100, Math.max(0, Number(e.target.value))) })} />
            <span className="unit">%</span>
          </label>
        </div>
      )}
      <p className="chart-note">
        Example values; enter your lander's own. Full sunlight on this array: {Math.round(peakWatts(arr))} W (vertical panel turned to the Sun).
      </p>
      <Balance site={site} arr={arr} watts={watts} />
      <Verdict
        title={next && next.startsIn === 0 ? 'Darkness in progress (remaining)' : 'Next darkness after the selected time'}
        hours={next?.length ?? 0}
        detail={
          !next
            ? 'No darkness before the data ends.'
            : `${next.startsIn === 0 ? 'Now' : `Starts in ${formatDuration(next.startsIn)}`}, lasts ${formatDuration(next.length)}${next.open ? ' or more (continues past the data)' : ''}.`
        }
        watts={watts}
        wh={wh}
      />
      <Verdict
        title={`Longest darkness in ${year}`}
        hours={worst}
        detail={`${formatDuration(worst)}.`}
        watts={watts}
        wh={wh}
      />
      <p className="chart-note">
        Assumes a full battery when darkness starts and no charging while the Sun is completely hidden. A partly visible
        Sun counts as light. Battery needed = power draw × hours of darkness.
      </p>
    </div>
  )
}

function Verdict(p: { title: string; hours: number; detail: string; watts: number; wh: number }) {
  const need = p.watts * p.hours
  const ok = need <= p.wh
  const lasts = p.watts > 0 ? p.wh / p.watts : Infinity
  return (
    <div className={ok ? 'verdict ok' : 'verdict fail'}>
      <h3>{p.title}</h3>
      <p className="muted">{p.detail}</p>
      <p className="verdict-line">
        <span aria-hidden="true">{ok ? '✓' : '✕'}</span>{' '}
        {ok ? 'Survives' : `Battery runs out after ${formatDuration(Math.floor(lasts))}`}
      </p>
      <p className="muted">Battery needed: {Math.ceil(need).toLocaleString('en')} Wh</p>
    </div>
  )
}

/** Average array output over the whole period (darkness included) against the power draw. */
function Balance({ site, arr, watts }: { site: Site; arr: SolarArray; watts: number }) {
  const mean = (site.metrics.mean_power_index_pct / 100) * peakWatts(arr)
  const ok = mean >= watts
  const span = site.replay ? 'this replay' : String(new Date(site.start_utc).getUTCFullYear())
  return (
    <div className={ok ? 'verdict ok' : 'verdict fail'}>
      <h3>Energy balance over {span}</h3>
      <p className="muted">Average array output {Math.round(mean)} W, darkness included, against a {watts} W draw.</p>
      <p className="verdict-line">
        <span aria-hidden="true">{ok ? '✓' : '✕'}</span> {ok ? `Covers the draw on average (+${Math.round(mean - watts)} W)` : `Short by ${Math.round(watts - mean)} W on average`}
      </p>
    </div>
  )
}
