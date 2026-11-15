import { useEffect, useMemo, useState } from 'react'
import { computeCustomPoint } from './customPoint'
import { VERDICT_LABEL, computeSamples, judge, saved as ellipseSaved, verdictOf } from './ellipseCheck'
import { ellipseSamples } from './ellipseGeometry'
import {
  MARGIN, VIABILITY_LABEL, formatDate, formatDuration, loadArtemis, viability, windowStats,
  type Region, type Site, type SiteSummary, type Thresholds, type Viability, type WindowStats,
} from './data'
import { polarRowCol, siteTracks } from './engine'
import { loadMapData, slopeGrid, type MapData } from './mapData'
import { MapView, type Dot } from './MapView'
import { Field } from './Planner'
import { DEFAULT_YEAR, loadVectors, siteForYear, yearOf } from './years'

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
const W_BASE = { power: 0.4, comms: 0.25, dark: 0.2, slope: 0.15, landing: 0 }
/** With the landing ellipse on (the default), a quarter of the score is the landing area. */
const W_LAND = { power: 0.3, comms: 0.2, dark: 0.15, slope: 0.1, landing: 0.25 }
type Part = keyof typeof W_BASE
const PARTS = Object.keys(W_BASE) as Part[]
const VRANK = { ok: 3, caution: 2, fail: 1 } as const
const RANK: Record<Viability, number> = { viable: 3, marginal: 2, not: 1, nodata: 0 }
/** "Year-round ideal" preset: whole data year as the mission. Example thresholds: only a handful of the
 *  5,487 candidates pass (coarse check: 7 viable, 22 viable or marginal at slope <= 8 deg). */
const YEAR_ROUND: Thresholds = { missionDays: 365, minSunPct: 70, maxDarkH: 168, minEarthPct: 50 }
/** Saved spots that passed the landing check (pipeline/sites.json group). */
const SAFE_GROUP = 'Safe landing spots (found by us)'
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
  chance: number // chance of landing on viable ground (points weighted by the landing bell curve)
  target?: WindowStats | null // the spot itself, computed exactly as the ellipse's first point
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
  parts: Record<Part, number>
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

/** landing = chance of landing on suitable ground (or the flat-ground share as an estimate); null = not used. */
function score(s: WindowStats, slope: number, th: Thresholds, maxSlope: number, landing: number | null = null) {
  const W = landing === null ? W_BASE : W_LAND
  const parts = {
    power: s.sunPct / 100,
    comms: s.earthPct / 100,
    dark: 1 - Math.min(1, s.longestDarkH / Math.max(1, th.maxDarkH * MARGIN.darkFactor)),
    slope: 1 - Math.min(1, slope / Math.max(0.1, maxSlope)),
    landing: landing ?? 0,
  }
  const total = 100 * PARTS.reduce((a, k) => a + W[k] * parts[k], 0)
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
  const year = site && !site.replay ? yearOf(site) : DEFAULT_YEAR
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
  const [ellOn, setEllOn] = useState(true) // landing-area suitability is part of the ranking by default
  const [ellKm, setEllKm] = useState(ellipseSaved.spec.lengthKm) // same size as the Map's ellipse to start with
  const [ell, setEll] = useState<{ key: string; res: Map<number, EllCheck> } | null>(null)
  const [map, setMap] = useState<MapData | null>(null)
  useEffect(() => {
    ellipseSaved.maxSlope = maxSlope
    ellipseSaved.spec = { ...ellipseSaved.spec, lengthKm: ellKm }
  }, [maxSlope, ellKm])

  useEffect(() => {
    loadArtemis().then(setRegions, () => setRegions([]))
    loadMapData().then(setMap, () => setMap(null))
  }, [])
  // Candidates load once; the Sun/Earth vectors follow the selected year.
  useEffect(() => {
    let live = true // a slower earlier year must not overwrite the current one
    Promise.all([(cached ??= load()), loadVectors(year)]).then(
      ([c, v]) => live && setData({ ...c, vectors: v, hours: v.length / 6, start: `${year}-01-01T00:00:00Z` }),
      (e) => live && setErr(String(e.message ?? e)),
    )
    return () => {
      live = false
    }
  }, [year])

  const hours = th.missionDays * 24
  const origin = polar
  const centre = radius && !nearRegions ? anchor : null
  const key = `${year}|${i}|${hours}|${th.minSunPct}|${th.maxDarkH}|${th.minEarthPct}|${maxSlope}|${radius}|${nearRegions}|${centre?.lat},${centre?.lon}`

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
      out.push({ k, lat, lon, slope, km, near, stats, v, score: sc?.total ?? 0, parts: sc?.parts ?? { power: 0, comms: 0, dark: 0, slope: 0, landing: 0 } })
    }
    // Landing-ellipse mode: among spots whose centre works, prefer those with the most flat, long-term-lit ground
    // around them, so the shortlist is chosen for the whole landing area, not just its centre.
    if (ellOn && map && ellKm > 0) {
      const slope = slopeGrid(map)
      for (const h of out)
        if (h.stats && (h.v === 'viable' || h.v === 'marginal')) {
          h.ell = ellipseScreen(map, slope, h.lat, h.lon, ellKm, maxSlope)
          const sc = score(h.stats, h.slope, th, maxSlope, h.ell.flat) // landing part: flat-ground share until checked
          ;[h.score, h.parts] = [sc.total, sc.parts]
        }
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
        const s = await computeCustomPoint(h.lat, h.lon, false).then((x) => siteForYear(x, year)).catch(() => null)
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
  const W = ellOn ? W_LAND : W_BASE
  const ellKey = `${key}|${ellKm}`
  useEffect(() => {
    if (!coarse || !ellOn || ellKm <= 0) return setEll(null)
    let alive = true
    const res = new Map<number, EllCheck>()
    setEll({ key: ellKey, res })
    ;(async () => {
      for (const h of coarse.picks) {
        const { points, weights } = ellipseSamples({ lat: h.lat, lon: h.lon }, { lengthKm: ellKm, widthKm: ellKm, headingDeg: 0 }, ELLIPSE_POINTS)
        const c: EllCheck = { total: points.length, done: 0, viable: 0, marginal: 0, worstSun: 100, worstDark: 0, steep: 0, chance: 0 }
        res.set(h.k, c)
        await computeSamples(points, () => alive, (j, pt) => {
          c.done++
          if (pt) {
            const { stats, v, steep } = judge(pt, i, hours, th, maxSlope)
            if (j === 0) c.target = stats
            if (steep) c.steep++
            if (v === 'viable') [c.viable, c.chance] = [c.viable + 1, c.chance + weights[j]]
            if (v === 'marginal') c.marginal++
            if (stats) [c.worstSun, c.worstDark] = [Math.min(c.worstSun, stats.sunPct), Math.max(c.worstDark, stats.longestDarkH)]
          }
          setEll({ key: ellKey, res: new Map(res) })
        }, year)
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
      const c = ellRes?.get(h.k)
      const checked = !!c && c.done === c.total
      // Exact numbers for the spot itself: from the exact stage, or from the landing check's first point.
      const fromEll = checked && c!.target !== undefined
      const isExact = (exact?.key === key && exact.hits.has(h.k)) || fromEll
      const stats = fromEll ? (c!.target ?? null) : isExact ? (exact!.hits.get(h.k) ?? null) : h.stats
      const v = isExact ? viability(stats, th) : h.v
      // Landing part of the score: the checked chance, else the flat-ground estimate (ellipse mode only).
      const landing = ellOn ? (checked ? c!.chance : (h.ell?.flat ?? 0)) : null
      const sc = stats && (v === 'viable' || v === 'marginal') ? score(stats, h.slope, th, maxSlope, landing) : null
      return { ...h, stats, v, score: sc?.total ?? 0, parts: sc?.parts ?? h.parts, exact: isExact || h.exact, landingChecked: checked }
    })
    const out = list.sort(rankSort).filter((h) => h.v === 'viable' || h.v === 'marginal')
    // Once every landing area is checked: suitability first (meets needs, some risk, too risky), then the score.
    if (ellDone && ellRes) out.sort((a, b) => VRANK[verdictOf(ellRes.get(b.k)!.chance)] - VRANK[verdictOf(ellRes.get(a.k)!.chance)] || b.score - a.score)
    return out
  }, [coarse, exact, key, th, maxSlope, ellDone, ellRes, ellOn])

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

  const safe = p.sites.filter((s) => s.group === SAFE_GROUP)
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
          {counts.nodata ? ` (mission runs past the end of ${year})` : ''}.
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
                    {PARTS.filter((c) => W[c]).map((c) => (
                      <span key={c} className={`sb-${c}`} style={{ width: `${W[c] * h.parts[c] * 100}%` }} title={`${c}: ${(W[c] * h.parts[c] * 100).toFixed(0)} of ${W[c] * 100}`} />
                    ))}
                  </span>
                </span>
                <span className="short-score">
                  {h.score.toFixed(0)}
                  <span className="muted">{h.exact ? 'exact' : 'estimate'}</span>
                  {ellOn && <LandingBadge c={ellRes?.get(h.k)} />}
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
          longest night), slope {W.slope * 100} (flatter at the target)
          {W.landing ? `, landing ${W.landing * 100} (chance of landing on suitable ground across the ${ellKm} km ellipse; until checked, the share of flat ground)` : ''}
          . Weights are our choice, shown so you can disagree.
          {ellOn && ' The list puts landing areas that meet your needs first, then some risk, then too risky; the score orders each group.'}{' '}
          {checking > 0 && exact && exact.done < checking ? `Checking the top ${checking} exactly… ${exact.done}/${checking}.` : ''}
          {drift !== null && exact && exact.done >= checking ? ` Top ${exact.hits.size} recomputed exactly; quick estimates were within ${drift.toFixed(1)} points.` : ''}
          {ellRes && !ellDone && ' Checking landing areas; the list re-sorts by suitability when all are done.'}
        </p>
      )}

      {safe.length > 0 && (
        <fieldset className="thresholds">
          <legend>{SAFE_GROUP}</legend>
          <div className="pick-actions">
            {safe.map((s) => (
              <button key={s.id} onClick={() => p.onPickSite(s.id)} title={`${s.name}: ${fmtPoint(s.lat, s.lon)}`}>
                {s.name.replace('Safe landing spot ', '')}
              </button>
            ))}
          </div>
          <p className="chart-note">
            Spots this tab rated "Meets your needs" (≥ 95% chance over a 4 km landing circle) for one landing date each,
            saved as sites for the picker, Map, Globe and Compare. They are safe only for the date named; check other dates
            here.
          </p>
        </fieldset>
      )}

      <fieldset className="thresholds">
        <legend>Landing ellipse</legend>
        <label className="radio">
          <input type="checkbox" checked={ellOn} onChange={(e) => setEllOn(e.target.checked)} />
          Include the landing ellipse (where the lander may actually touch down)
        </label>
        {ellOn && (
          <>
            <Field label="Ellipse length (long side)" unit="km" value={ellKm} step={0.5} onChange={(v) => setEllKm(Math.min(20, Math.max(0, Number(v) || 0)))} />
            <p className="chart-note">
              The approach direction isn't fixed while choosing a site, so each spot's landing area is a circle this wide
              (covers the ellipse in any direction). Step 1, every spot: the shortlist favours spots with the most flat
              (≤ slope limit) ground with long-term sunlight and Earth view around them (NASA 240 m layers). Step 2, the shortlist: ~21 points per
              spot computed exactly for your dates, about 4 s per spot; the list then sorts by the chance of landing on
              ground that meets your needs (points near the centre count most, as landers come down there more often).
              Map layers "Landing terrain" and "Landing area" show where the ground itself allows a landing. For a set direction and full detail, pick a spot and use the Map tab.
            </p>
          </>
        )}
      </fieldset>

      <fieldset className="thresholds">
        <legend>Mission</legend>
        <div className="pick-actions">
          <button
            onClick={() => {
              p.setI(0)
              p.setTh(YEAR_ROUND)
            }}
            title={`Land 1 Jan ${year} and stay the whole year: finds spots that keep power, Earth contact and a safe landing area whatever the launch date`}
          >
            Year-round ideal sites (all of {year})
          </button>
        </div>
        {th.missionDays * 24 >= (data?.hours ?? Infinity) && (
          <p className="chart-note">
            Whole-year search: sunlit ≥ {th.minSunPct}%, darkness ≤ {th.maxDarkH} h, Earth ≥ {th.minEarthPct}%. These are
            example values (team to agree). Over a full year no spot near the pole stays lit all the time. The best still
            has a dark spell of about 3 days, so the lander must survive one. The spots that pass are small sunlit ridge
            tops: in our check, even a 1 km landing circle around them had at most 2 of 21 points pass. So a lander needs
            pin-point landing to use them, or a chosen landing date: a 14-day window has spots with 95% or more of the
            landing area suitable.
          </p>
        )}
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
      maxSlope={maxSlope}
      areaKm={ellKm || 4}
    />
  )
}

function EllipseLine({ c, km, maxSlope }: { c: EllCheck; km: number; maxSlope: number }) {
  if (c.done < c.total)
    return <span className="short-nums muted">Landing ellipse {km} km: checking {c.done}/{c.total}…</span>
  const v = verdictOf(c.chance)
  return (
    <span className={`short-nums ell-line ell-${v}`}>
      <strong>
        {VERDICT_LABEL[v]}: {(100 * c.chance).toFixed(0)}% chance of landing on suitable ground
      </strong>{' '}
      ({km} km; {c.viable} of {c.total} points viable{c.marginal ? `, ${c.marginal} marginal` : ''}) · worst sunlit{' '}
      {c.worstSun.toFixed(0)}%, worst dark {c.worstDark ? formatDuration(c.worstDark) : '0 h'} ·{' '}
      {c.steep ? `${c.steep} steeper than ${maxSlope}°` : `slope ≤ ${maxSlope}° everywhere`}
    </span>
  )
}

/** Landing suitability next to the score: verdict colour and chance once checked. */
function LandingBadge({ c }: { c?: EllCheck }) {
  if (!c || c.done < c.total) return <span className="land-badge muted">landing: checking</span>
  const v = verdictOf(c.chance)
  return (
    <span className={`land-badge lb-${v}`} title={`${VERDICT_LABEL[v]}: ${(100 * c.chance).toFixed(0)}% chance of landing on suitable ground`}>
      {v === 'ok' ? '●' : v === 'caution' ? '○' : '×'} landing {(100 * c.chance).toFixed(0)}%
    </span>
  )
}
