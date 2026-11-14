import { useEffect, useMemo, useState } from 'react'
import { computeCustomPoint } from './customPoint'
import {
  MARGIN, VIABILITY_LABEL, formatDate, formatDuration, viability, windowStats,
  type Site, type SiteSummary, type Thresholds, type Viability, type WindowStats,
} from './data'
import { siteTracks } from './engine'
import { MapView, type Dot } from './MapView'
import { Field } from './Planner'

// F7 alternatives finder. Coarse stage: ~5,500 precomputed candidate spots (best spot per 2.9 km tile, coarse
// 1 deg horizons, pipeline/export_candidates.py), evaluated in the browser for the user's own mission window.
// Fine stage: the top few are recomputed with the exact engine (same as a map click) and re-ranked.

const base = import.meta.env.BASE_URL
const R_KM = 1737.4
const D2R = Math.PI / 180
const SHORTLIST = 8
const EXACT = 5
const SPREAD_KM = 5 // shortlisted spots at least this far apart, so the list offers real alternatives
/** Score weights, shown on screen. Only spots that are viable or marginal are scored. */
const W = { power: 0.4, comms: 0.25, dark: 0.2, slope: 0.15 }
const RANK: Record<Viability, number> = { viable: 3, marginal: 2, not: 1, nodata: 0 }

interface Cands {
  n: number
  rec: Float32Array // n x 6: lat, lon, height, slope, nasa sun %, nasa earth %
  masks: Float32Array // n x 360, deg
  vectors: Float32Array
  hours: number
  start: string
  obs: number
}
let cached: Promise<Cands> | null = null
async function load(): Promise<Cands> {
  const get = (p: string) => fetch(base + p).then((r) => (r.ok ? r : Promise.reject(new Error(`${p}: ${r.status}`))))
  const [meta, mapMeta] = await Promise.all([get('data/finder/meta.json').then((r) => r.json()), get('data/map/meta.json').then((r) => r.json())])
  const [rec, m8, vec] = await Promise.all(['data/finder/candidates.f32', 'data/finder/masks.i8', `data/map/${mapMeta.vectors.file}`].map((p) => get(p).then((r) => r.arrayBuffer())))
  const masks = Float32Array.from(new Int8Array(m8), (v) => v * meta.mask.unit_deg)
  return { n: meta.count, rec: new Float32Array(rec), masks, vectors: new Float32Array(vec), hours: mapMeta.vectors.hours, start: mapMeta.vectors.start_utc, obs: meta.obs_height_m }
}

interface Hit {
  k: number
  lat: number
  lon: number
  slope: number
  km: number | null // distance from the selected site
  stats: WindowStats | null
  v: Viability
  score: number
  parts: Record<keyof typeof W, number>
  exact?: boolean
}

function score(s: WindowStats, slope: number, th: Thresholds, maxSlope: number) {
  const parts = {
    power: s.sunPct / 100,
    comms: s.earthPct / 100,
    dark: 1 - Math.min(1, s.longestDarkH / Math.max(1, th.maxDarkH * MARGIN.darkFactor)),
    slope: 1 - Math.min(1, slope / Math.max(0.1, maxSlope)),
  }
  const total = 100 * (Object.keys(W) as (keyof typeof W)[]).reduce((a, k) => a + W[k] * parts[k], 0)
  return { parts, total }
}

const kmBetween = (a: number, b: number, c: number, d: number) =>
  R_KM * 2 * Math.asin(Math.sqrt(Math.sin(((c - a) * D2R) / 2) ** 2 + Math.cos(a * D2R) * Math.cos(c * D2R) * Math.sin(((d - b) * D2R) / 2) ** 2))
const fmtPoint = (lat: number, lon: number) => {
  const w = lon > 180 ? lon - 360 : lon
  return `${Math.abs(lat).toFixed(2)}° S, ${Math.abs(w).toFixed(1)}° ${w >= 0 ? 'E' : 'W'}`
}
const rankSort = (a: Hit, b: Hit) => RANK[b.v] - RANK[a.v] || b.score - a.score

interface Props {
  sites: SiteSummary[]
  site: Site | null
  i: number
  setI: (i: number) => void
  th: Thresholds
  setTh: (t: Thresholds) => void
  onPickSite: (id: string) => void
  onPickPoint: (lat: number, lon: number) => void
  busy: boolean
  pickError: string
  onOpenSite: () => void
  onCompare: () => void
}

export function Finder(p: Props) {
  const { site, i, th } = p
  const [data, setData] = useState<Cands | null>(null)
  const [err, setErr] = useState('')
  const [maxSlope, setMaxSlope] = useState(8)
  const [radius, setRadius] = useState(0) // 0 = whole 85-90 S region
  const [anchor, setAnchor] = useState<{ name: string; lat: number; lon: number } | null>(null) // radius centre, frozen when chosen
  const [exact, setExact] = useState<{ key: string; hits: Map<number, WindowStats | null>; done: number } | null>(null)

  useEffect(() => {
    ;(cached ??= load()).then(setData, (e) => setErr(String(e.message ?? e)))
  }, [])

  const hours = th.missionDays * 24
  const origin = site && site.lat <= -84 ? site : null // radius search needs a polar site
  const centre = radius ? anchor : null
  const key = `${i}|${hours}|${th.minSunPct}|${th.maxDarkH}|${th.minEarthPct}|${maxSlope}|${radius}|${centre?.lat},${centre?.lon}`

  // Coarse stage: every candidate within the slope and area limits, for this exact mission window.
  const coarse = useMemo(() => {
    if (!data) return null
    const t0 = performance.now()
    const out: Hit[] = []
    const fits = i + hours <= data.hours
    for (let k = 0; k < data.n; k++) {
      const [lat, lon, h, slope] = data.rec.subarray(6 * k, 6 * k + 4)
      if (slope > maxSlope) continue
      const km = centre ? kmBetween(centre.lat, centre.lon, lat, lon) : null
      if (centre && km! > radius) continue
      let stats: WindowStats | null = null
      if (fits) {
        const t = siteTracks(data.vectors, lat, lon, h + data.obs, data.masks.subarray(360 * k, 360 * k + 360), 1, i, hours)
        stats = windowStats({ samples: hours, sun: t.sun, earth: t.earth }, 0, hours)
      }
      const v = viability(stats, th)
      const sc = stats && (v === 'viable' || v === 'marginal') ? score(stats, slope, th, maxSlope) : null
      out.push({ k, lat, lon, slope, km, stats, v, score: sc?.total ?? 0, parts: sc?.parts ?? { power: 0, comms: 0, dark: 0, slope: 0 } })
    }
    out.sort(rankSort)
    const picks: Hit[] = []
    for (const h of out) {
      if (picks.length === SHORTLIST || (h.v !== 'viable' && h.v !== 'marginal')) break
      if (picks.every((q) => kmBetween(q.lat, q.lon, h.lat, h.lon) >= SPREAD_KM)) picks.push(h)
    }
    return { hits: out, picks, ms: performance.now() - t0 }
  }, [data, i, hours, th, maxSlope, radius, centre])

  // Fine stage: recompute the top few exactly (0.5 deg horizon, 120 m steps, same engine as a map click).
  useEffect(() => {
    if (!coarse) return
    const top = coarse.picks.slice(0, EXACT)
    let cancelled = false
    const hits = new Map<number, WindowStats | null>()
    setExact({ key, hits, done: 0 })
    ;(async () => {
      for (const h of top) {
        const s = await computeCustomPoint(h.lat, h.lon, false).catch(() => null)
        if (cancelled) return
        hits.set(h.k, s ? windowStats(s, i, hours) : null)
        setExact({ key, hits, done: hits.size })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [coarse]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merge exact results into the ranking.
  const ranked = useMemo(() => {
    if (!coarse) return []
    const list = coarse.picks.map((h) => {
      if (exact?.key !== key || !exact.hits.has(h.k)) return h
      const stats = exact.hits.get(h.k) ?? null
      const v = viability(stats, th)
      const sc = stats && (v === 'viable' || v === 'marginal') ? score(stats, h.slope, th, maxSlope) : null
      return { ...h, stats, v, score: sc?.total ?? 0, parts: sc?.parts ?? h.parts, exact: true }
    })
    return list.sort(rankSort).filter((h) => h.v === 'viable' || h.v === 'marginal')
  }, [coarse, exact, key, th, maxSlope])

  const counts = useMemo(() => {
    const c = { viable: 0, marginal: 0, not: 0, nodata: 0 }
    coarse?.hits.forEach((h) => c[h.v]++)
    return c
  }, [coarse])

  // How far the coarse estimate was from the exact numbers for the spots checked.
  const drift = useMemo(() => {
    if (!coarse || exact?.key !== key) return null
    let worst = 0
    for (const h of coarse.picks.slice(0, EXACT)) {
      const e = exact.hits.get(h.k)
      if (e && h.stats) worst = Math.max(worst, Math.abs(e.sunPct - h.stats.sunPct), Math.abs(e.earthPct - h.stats.earthPct))
    }
    return exact.hits.size ? worst : null
  }, [coarse, exact, key])

  const dots: Dot[] = useMemo(() => {
    const rankOf = new Map(ranked.map((h, j) => [h.k, j + 1]))
    return (coarse?.hits ?? []).map((h) => ({ lat: h.lat, lon: h.lon, v: h.v, rank: rankOf.get(h.k) }))
  }, [coarse, ranked])

  const start = data ? Date.parse(data.start) : 0
  const setNum = (k: keyof Thresholds, v: string) => p.setTh({ ...th, [k]: Math.max(k === 'missionDays' ? 1 : 0, Number(v) || 0) })
  const checking = exact?.key === key && coarse ? Math.min(EXACT, coarse.picks.length) : 0

  const side = (
    <div className="finder">
      {err && <p className="error">Couldn't load the finder data: {err}</p>}

      {!data && !err && <p className="loading">Loading candidate spots (about 2 MB, once)</p>}
      {coarse && (
        <p className="finder-count" aria-live="polite">
          <strong>{counts.viable}</strong> viable, <strong>{counts.marginal}</strong> marginal of {coarse.hits.length.toLocaleString('en')} spots
          {counts.nodata ? ' (mission runs past the 2027 data)' : ''}.
        </p>
      )}

      {ranked.length > 0 && (
        <ol className="shortlist">
          {ranked.map((h, j) => (
            <li key={h.k}>
              <button className="short-row" onClick={() => p.onPickPoint(h.lat, h.lon)} title="Analyse this spot exactly and make it the selected site">
                <span className="short-rank">{j + 1}</span>
                <span className="short-main">
                  <span className="short-where">
                    {fmtPoint(h.lat, h.lon)}
                    {h.km !== null && <span className="muted"> · {h.km.toFixed(1)} km away</span>}
                  </span>
                  <span className="short-nums">
                    {VIABILITY_LABEL[h.v]} · sunlit {h.stats!.sunPct.toFixed(0)}% · {h.stats!.longestDarkH ? `longest dark ${formatDuration(h.stats!.longestDarkH)}` : 'no darkness'} · Earth {h.stats!.earthPct.toFixed(0)}% ·
                    slope {h.slope.toFixed(1)}°
                  </span>
                  <span className="score-bar" aria-label={`Score ${h.score.toFixed(0)} of 100`}>
                    {(Object.keys(W) as (keyof typeof W)[]).map((c) => (
                      <span key={c} className={`sb-${c}`} style={{ width: `${W[c] * h.parts[c] * 100}%` }} title={`${c}: ${(W[c] * h.parts[c] * 100).toFixed(0)} of ${W[c] * 100}`} />
                    ))}
                  </span>
                </span>
                <span className="short-score">
                  {h.score.toFixed(0)}
                  <span className="muted">{h.exact ? 'exact' : 'estimate'}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {coarse && !ranked.length && <p className="muted">No spot meets these needs for this window. Try another landing date, a longer darkness limit or a steeper slope.</p>}

      {coarse && ranked.length > 0 && (
        <p className="chart-note">
          Score out of 100: power {W.power * 100} (sunlit %), comms {W.comms * 100} (Earth in view %), darkness {W.dark * 100} (shorter
          longest night), slope {W.slope * 100} (flatter). Weights are our choice, shown so you can disagree.{' '}
          {checking > 0 && exact && exact.done < checking ? `Checking the top ${checking} exactly… ${exact.done}/${checking}.` : ''}
          {drift !== null && exact && exact.done >= checking ? ` Top ${exact.hits.size} recomputed exactly; quick estimates were within ${drift.toFixed(1)} points.` : ''}
        </p>
      )}

      <fieldset className="thresholds">
        <legend>Mission</legend>
        <label className="field wide">
          <span>Landing</span>
          <input
            type="date"
            value={data ? formatDate(new Date(start + i * 3_600_000)) : ''}
            min={data ? formatDate(new Date(start)) : undefined}
            max={data ? formatDate(new Date(start + (data.hours - 1) * 3_600_000)) : undefined}
            onChange={(e) => {
              const ms = Date.parse(e.target.value) - start
              if (!Number.isNaN(ms)) p.setI(Math.max(0, Math.round(ms / 86_400_000) * 24))
            }}
          />
        </label>
        <Field label="Mission length" unit="days" value={th.missionDays} step={1} onChange={(v) => setNum('missionDays', v)} />
        <Field label="Sunlit at least" unit="%" value={th.minSunPct} step={5} onChange={(v) => setNum('minSunPct', v)} />
        <Field label="Darkness at most" unit="h" value={th.maxDarkH} step={6} onChange={(v) => setNum('maxDarkH', v)} />
        <Field label="Earth in view at least" unit="%" value={th.minEarthPct} step={5} onChange={(v) => setNum('minEarthPct', v)} />
        <Field label="Slope at most" unit="°" value={maxSlope} step={1} onChange={(v) => setMaxSlope(Math.min(15, Math.max(0, Number(v) || 0)))} />
        <label className="field wide">
          <span>Search</span>
          <select
            value={radius}
            onChange={(e) => {
              setRadius(Number(e.target.value))
              if (origin) setAnchor({ name: origin.name, lat: origin.lat, lon: origin.lon })
            }}
          >
            <option value={0}>Whole region, 85–90° S</option>
            {[10, 25, 50].map((r) => (
              <option key={r} value={r} disabled={!origin}>
                Within {r} km of {radius && anchor ? anchor.name : origin ? origin.name : 'a polar site'}
              </option>
            ))}
          </select>
        </label>
        <p className="chart-note">Same needs as the landing-date planner; changing them here changes them there.</p>
      </fieldset>

      <div className="pick-box">
        {p.busy && <p>Computing that spot exactly…</p>}
        {p.pickError && <p className="error">{p.pickError}</p>}
        {!p.busy && site?.kind === 'custom' && (
          <>
            <p>
              <strong>{site.name}</strong> is now the selected site.
            </p>
            <div className="pick-actions">
              <button onClick={p.onOpenSite}>Open in Site and plan</button>
              <button onClick={p.onCompare}>Add to comparison</button>
            </div>
          </>
        )}
        {!p.busy && site?.kind !== 'custom' && <p className="muted">Click a ranked spot to analyse it exactly, then open or compare it.</p>}
      </div>
      <p className="chart-note">
        Candidates: the best spot (NASA long-term light + Earth view, slope ≤ 15°) in each 2.9 km tile with ≥ 25% average
        sunlight. Slopes are at 240 m; real slopes at lander scale are steeper, so check the final site with higher-resolution
        data.
      </p>
    </div>
  )

  return (
    <MapView
      sites={p.sites}
      site={site}
      onPickSite={p.onPickSite}
      onPickPoint={p.onPickPoint}
      busy={p.busy}
      pickError={p.pickError}
      onOpenSite={p.onOpenSite}
      onCompare={p.onCompare}
      dots={dots}
      side={side}
    />
  )
}
