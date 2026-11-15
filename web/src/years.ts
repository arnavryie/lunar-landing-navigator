// Any landing year: Sun/Earth vectors per year (pipeline/export_vectors.py) and a site recomputed for that year
// from its stored terrain horizon, with the same engine as map clicks (engine.ts, checked against Python).
import { siteTracks, trackMetrics } from './engine.ts'
import type { Site } from './data.ts'

const base = `${import.meta.env?.BASE_URL ?? '/'}data/map/`
export const DEFAULT_YEAR = 2027

let years: Promise<number[]> | null = null
/** Years that have a vectors file, from meta.json (written by export_vectors.py). */
export const loadYears = () =>
  (years ??= fetch(base + 'meta.json')
    .then((r) => r.json())
    .then((m) => (m.vectors.years as number[] | undefined) ?? [DEFAULT_YEAR]))

const vec = new Map<number, Promise<Float32Array>>()
export function loadVectors(year: number): Promise<Float32Array> {
  if (!vec.has(year))
    vec.set(
      year,
      fetch(`${base}vectors_${year}.f32`).then(async (r) => {
        if (!r.ok) throw new Error(`No Sun/Earth data for ${year}. Run: python pipeline/export_vectors.py ${year}`)
        return new Float32Array(await r.arrayBuffer())
      }),
    )
  return vec.get(year)!
}

export const yearOf = (s: Pick<Site, 'start_utc'>) => new Date(s.start_utc).getUTCFullYear()

const r = (a: Float64Array, nd: number) => Array.from(a, (v) => Math.round(v * 10 ** nd) / 10 ** nd)

/** The same site over another calendar year. Mission replays keep their real dates. Rounded like the
 *  pipeline's files, so the year the site was computed for comes back unchanged (scripts/check-years.ts). */
export function retime(s: Site, year: number, v: Float32Array): Site {
  if (s.replay || yearOf(s) === year) return s
  const t = siteTracks(v, s.lat, s.lon, s.site_height_m + s.obs_height_m, s.horizon.el_deg, s.horizon.az_step_deg)
  return {
    ...s,
    start_utc: `${year}-01-01T00:00:00Z`,
    step_h: 1,
    samples: v.length / 6,
    metrics: trackMetrics(t),
    sun: { az: r(t.sun.az, 2), el: r(t.sun.el, 3), frac: r(t.sun.frac, 3), power: r(t.sun.power, 3) },
    earth: { az: r(t.earth.az, 2), el: r(t.earth.el, 3), frac: r(t.earth.frac, 3) },
  }
}

export const siteForYear = async (s: Site, year: number) => (s.replay || yearOf(s) === year ? s : retime(s, year, await loadVectors(year)))
