import { useEffect, useMemo, useState } from 'react'
import { computeCustomPoint } from './customPoint'
import { computeSamples, judge, saved as ellipseSaved } from './ellipseCheck'
import { ellipseSamples } from './ellipseGeometry'
import {
  MARGIN, VIABILITY_LABEL, formatDate, formatDuration, loadArtemis, viability, windowStats,
  type Region, type Site, type SiteSummary, type Thresholds, type Viability, type WindowStats,
} from './data'
import { polarRowCol, siteTracks } from './engine'
import { loadMapData, slopeGrid, type MapData } from './mapData'
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
const ELLIPSE_POINTS = 12 // grid points per landing ellipse (+ the target and 12 on the edge): ~25 exact points per spot

/** Landing-ellipse check of one shortlisted spot. */
interface EllCheck {
  total: number
  done: number
  viable: number
  marginal: number
  worstSun: number
  worstDark: number
  steep: number
}

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
  km: number | null // distance from the search centre (the site, or the nearest NASA region)
  near?: string // nearest NASA region, when searching near regions
  stats: WindowStats | null
  v: Viability
  score: number
  parts: Record<keyof typeof W, number>
  exact?: boolean
  ell?: { good: number; flat: number } // quick landing-area screen (see ellipseScreen)
}

/** Quick landing-area screen from the 240 m map layers: over a circle `km` wide around the spot,
 *  `flat` = share of ground no steeper than maxSlope, `good` = average of 0.6 x NASA long-term sunlit % + 0.4 x Earth
 *  in view % (the finder's power : comms weights), counting too-steep ground as 0. Pixels off the map or without NASA data are skipped. Used only to choose which spots to check exactly. */
function ellipseScreen(m: MapData, slope: Float32Array, lat: number, lon: number, km: number, maxSlope: number) {
  const [r0, c0] = polarRowCol(lat, lon, m.n, m.scale)
  const R = (km * 500) / m.scale
  let n = 0
  let flat = 0
  let good = 0
  for (let r = Math.ceil(r0 - R); r <= r0 + R; r++)
    for (let c = Math.ceil(c0 - R); c <= c0 + R; c++) {
      if ((r - r0) ** 2 + (c - c0) ** 2 > R * R || r < 1 || c < 1 || r >= m.n - 1 || c >= m.n - 1) continue
      const k = r * m.n + c
      if (m.sun[k] === 255 || m.earth[k] === 255) continue
      n++
      if (slope[k] <= maxSlope) {
        flat++
        good += 0.6 * m.sun[k] + 0.4 * m.earth[k]
      }
    }
  return n ? { good: good / n, flat: flat / n } : { good: 0, flat: 0 }
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
  /** Show the selected spot's landing ellipse on the Map tab. */
  onOpenMap?: () => void
  /** Open with a radius search (km) around the selected site, e.g. from the planner's "Find other spots". */
  initialRadius?: number
}

export function Finder(p: Props) {
  const { site, i, th } = p
  const [data, setData] = useState<Cands | null>(null)
  const [err, setErr] = useState('')
  const [maxSlope, setMaxSlope] = useState(Math.min(15, ellipseSaved.maxSlope)) // shared with the Map's landing ellipse
  const polar = site && site.lat <= -84 ? site : null // radius search needs a polar site
  const [radius, setRadius] = useState(polar ? (p.initialRadius ?? 0) : 0) // 0 = whole 85-90 S region
  const [anchor, setAnchor] = useState<{ name: string; lat: number; lon: number } | null>(
    polar && p.initialRadius ? { name: polar.name, lat: polar.lat, lon: polar.lon } : null,
  ) // radius centre, frozen when chosen
  const [exact, setExact] = useState<{ key: string; hits: Map<number, WindowStats | null>; done: number } | null>(null)
  const [nearRegions, setNearRegions] = useState(false) // radius is around NASA's candidate regions, not the site
  const [regions, setRegions] = useState<Region[]>([])
  const [ellOn, setEllOn] = useState(false)
  const [ellKm, setEllKm] = useState(ellipseSaved.spec.lengthKm) // same size as the Map's ellipse to start with
  const [ell, setEll] = useState<{ key: string; res: Map<number, EllCheck> } | null>(null)
  const [map, setMap] = useState<MapData | null>(null)
  useEffect(() => {
    ellipseSaved.maxSlope = maxSlope
    ellipseSaved.spec = { ...ellipseSaved.spec, lengthKm: ellKm }
  }, [maxSlope, ellKm])

  useEffect(() => {
    ;(cached ??= load()).then(setData, (e) => setErr(String(e.message ?? e)))
    loadArtemis().then(setRegions, () => setRegions([]))
    loadMapData().then(setMap, () => setMap(null))
  }, [])

  const hours = th.missionDays * 24
  const origin = polar
  const centre = radius && !nearRegions ? anchor : null
  const key = `${i}|${hours}|${th.minSunPct}|${th.maxDarkH}|${th.minEarthPct}|${maxSlope}|${radius}|${nearRegions}|${centre?.lat},${centre?.lon}`

  // Coarse stage: every candidate within the slope and area limits, for this exact mission window.
  const coarse = useMemo(() => {
    if (!data) return null
    const t0 = performance.now()
    const out: Hit[] = []
    const fits = i + hours <= data.hours
    for (let k = 0; k < data.n; k++) {
      const [lat, lon, h, slope] = data.rec.subarray(6 * k, 6 * k + 4)
      if (slope > maxSlope) continue
      let km = centre ? kmBetween(centre.lat, centre.lon, lat, lon) : null
      let near: string | undefined
      if (radius && nearRegions) {
        for (const r of regions) {
          const d = kmBetween(r.lat, r.lon, lat, lon)
          if (km === null || d < km) [km, near] = [d, r.name]
        }
        if (km === null) continue
      }
      if (radius && km! > radius) continue
      let stats: WindowStats | null = null
      if (fits) {
        const t = siteTracks(data.vectors, lat, lon, h + data.obs, data.masks.subarray(360 * k, 360 * k + 360), 1, i, hours)
        stats = windowStats({ samples: hours, sun: t.sun, earth: t.earth }, 0, hours)
      }
      const v = viability(stats, th)
      const sc = stats && (v === 'viable' || v === 'marginal') ? score(stats, slope, th, maxSlope) : null
      out.push({ k, lat, lon, slope, km, near, stats, v, score: sc?.total ?? 0, parts: sc?.parts ?? { power: 0, comms: 0, dark: 0, slope: 0 } })
    }
    // Landing-ellipse mode: among spots whose centre works, prefer those with the most flat, long-term-lit ground
    // around them, so the shortlist is chosen for the whole landing area, not just its centre.
    if (ellOn && map && ellKm > 0) {
      const slope = slopeGrid(map)
      for (const h of out) if (h.v === 'viable' || h.v === 'marginal') h.ell = ellipseScreen(map, slope, h.lat, h.lon, ellKm, maxSlope)
      out.sort((a, b) => RANK[b.v] - RANK[a.v] || (b.ell?.good ?? 0) - (a.ell?.good ?? 0) || b.score - a.score)
    } else out.sort(rankSort)
    const picks: Hit[] = []
    for (const h of out) {
      if (picks.length === SHORTLIST || (h.v !== 'viable' && h.v !== 'marginal')) break
      if (picks.every((q) => kmBetween(q.lat, q.lon, h.lat, h.lon) >= SPREAD_KM)) picks.push(h)
    }
    return { hits: out, picks, ms: performance.now() - t0 }
  }, [data, i, hours, th, maxSlope, radius, centre, nearRegions, regions, ellOn, ellKm, map])

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

  // Landing ellipse: check a circle as wide as the ellipse's long side around every shortlisted spot
  // (the approach direction isn't known while choosing a site, so a circle covers every direction).
  const ellKey = `${key}|${ellKm}`
  useEffect(() => {
    if (!coarse || !ellOn || ellKm <= 0) return setEll(null)
    let alive = true
    const res = new Map<number, EllCheck>()
    setEll({ key: ellKey, res })
    ;(async () => {
      for (const h of coarse.picks) {
        const { points } = ellipseSamples({ lat: h.lat, lon: h.lon }, { lengthKm: ellKm, widthKm: ellKm, headingDeg: 0 }, ELLIPSE_POINTS)
        const c: EllCheck = { total: points.length, done: 0, viable: 0, marginal: 0, worstSun: 100, worstDark: 0, steep: 0 }
        res.set(h.k, c)
        await computeSamples(points, () => alive, (_, pt) => {
          c.done++
          if (pt) {
            const { stats, v, steep } = judge(pt, i, hours, th, maxSlope)
            if (steep) c.steep++
            if (v === 'viable') c.viable++
            if (v === 'marginal') c.marginal++
            if (stats) [c.worstSun, c.worstDark] = [Math.min(c.worstSun, stats.sunPct), Math.max(c.worstDark, stats.longestDarkH)]
          }
          setEll({ key: ellKey, res: new Map(res) })
        })
        if (!alive) return
      }
    })()
    return () => {
      alive = false
    }
  }, [coarse, ellOn, ellKm]) // eslint-disable-line react-hooks/exhaustive-deps
  const ellRes = ell?.key === ellKey ? ell.res : null
  const ellDone = !!coarse && !!ellRes && coarse.picks.every((h) => { const c = ellRes.get(h.k); return c && c.done === c.total })

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
    const out = list.sort(rankSort).filter((h) => h.v === 'viable' || h.v === 'marginal')
    // Once every ellipse is checked, spots whose whole ellipse works come first (stable sort keeps the score order).
    if (ellDone && ellRes) {
      const share = (k: number) => { const c = ellRes.get(k)!; return c.viable / c.total }
      out.sort((a, b) => share(b.k) - share(a.k))
    }
    return out
  }, [coarse, exact, key, th, maxSlope, ellDone, ellRes])

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
                    {h.km !== null && <span className="muted"> · {h.km.toFixed(1)} km from {h.near ? `${h.near} region` : 'the site'}</span>}
                  </span>
                  <span className="short-nums">
                    {VIABILITY_LABEL[h.v]} · sunlit {h.stats!.sunPct.toFixed(0)}% · {h.stats!.longestDarkH ? `longest dark ${formatDuration(h.stats!.longestDarkH)}` : 'no darkness'} · Earth {h.stats!.earthPct.toFixed(0)}% ·
                    slope {h.slope.toFixed(1)}°
                  </span>
                  {ellRes?.get(h.k) && <EllipseLine c={ellRes.get(h.k)!} km={ellKm} maxSlope={maxSlope} />}
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
      {coarse && !ranked.length && (
        <p className="muted">
          No spot meets these needs for this window. Try another landing date, a longer darkness limit or a steeper slope
          {radius ? (
            <>
              , or{' '}
              <button className="link" onClick={() => setRadius(0)}>
                search the whole region
              </button>
            </>
          ) : null}
          .
        </p>
      )}

      {coarse && ranked.length > 0 && (
        <p className="chart-note">
          Score out of 100: power {W.power * 100} (sunlit %), comms {W.comms * 100} (Earth in view %), darkness {W.dark * 100} (shorter
          longest night), slope {W.slope * 100} (flatter). Weights are our choice, shown so you can disagree.{' '}
          {checking > 0 && exact && exact.done < checking ? `Checking the top ${checking} exactly… ${exact.done}/${checking}.` : ''}
          {drift !== null && exact && exact.done >= checking ? ` Top ${exact.hits.size} recomputed exactly; quick estimates were within ${drift.toFixed(1)} points.` : ''}
          {ellRes && (ellDone ? ' Sorted by how much of each landing ellipse is viable, then by score.' : ' Checking landing ellipses; the list re-sorts when all are done.')}
        </p>
      )}

      <fieldset className="thresholds">
        <legend>Landing ellipse</legend>
        <label className="radio">
          <input type="checkbox" checked={ellOn} onChange={(e) => setEllOn(e.target.checked)} />
          Choose spots for their whole landing area
        </label>
        {ellOn && (
          <>
            <Field label="Ellipse length (long side)" unit="km" value={ellKm} step={0.5} onChange={(v) => setEllKm(Math.min(20, Math.max(0, Number(v) || 0)))} />
            <p className="chart-note">
              The approach direction isn't fixed while choosing a site, so each spot's landing area is a circle this wide
              (covers the ellipse in any direction). Step 1, every spot: the shortlist favours spots with the most flat
              (≤ slope limit) ground with long-term sunlight and Earth view around them (NASA 240 m layers). Step 2, the shortlist: ~21 points per
              spot computed exactly for your dates, about 4 s per spot; the list then sorts by how much of each area is
              viable. For a set direction and full detail, pick a spot and use the Map tab.
            </p>
          </>
        )}
      </fieldset>

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
            value={radius ? `${nearRegions ? 'a' : 's'}${radius}` : '0'}
            onChange={(e) => {
              const v = e.target.value
              setRadius(Number(v.replace(/^[as]/, '')))
              setNearRegions(v.startsWith('a'))
              if (origin && v.startsWith('s')) setAnchor({ name: origin.name, lat: origin.lat, lon: origin.lon })
            }}
          >
            <option value="0">Whole region, 85–90° S</option>
            {[10, 25, 50].map((r) => (
              <option key={r} value={`s${r}`} disabled={!origin}>
                Within {r} km of {radius && anchor && !nearRegions ? anchor.name : origin ? origin.name : 'a polar site'}
              </option>
            ))}
            {[5, 10].map((r) => (
              <option key={`a${r}`} value={`a${r}`} disabled={!regions.length}>
                Within {r} km of a NASA candidate region
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
              {ellOn && p.onOpenMap && (
                <button
                  onClick={() => {
                    Object.assign(ellipseSaved, { circle: true, autoRun: true })
                    p.onOpenMap!()
                  }}
                >
                  See its landing area on the Map
                </button>
              )}
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

function EllipseLine({ c, km, maxSlope }: { c: EllCheck; km: number; maxSlope: number }) {
  if (c.done < c.total)
    return <span className="short-nums muted">Landing ellipse {km} km: checking {c.done}/{c.total}…</span>
  const all = c.viable === c.total
  return (
    <span className={`short-nums ell-line${all ? ' ell-ok' : ''}`}>
      Landing ellipse {km} km: {all ? `all ${c.total} points viable` : `${c.viable} of ${c.total} viable${c.marginal ? `, ${c.marginal} marginal` : ''}`} · worst sunlit{' '}
      {c.worstSun.toFixed(0)}%, worst dark {c.worstDark ? formatDuration(c.worstDark) : '0 h'} ·{' '}
      {c.steep ? `${c.steep} steeper than ${maxSlope}°` : `slope ≤ ${maxSlope}° everywhere`}
    </span>
  )
}
