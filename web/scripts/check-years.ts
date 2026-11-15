// Any-year check: recomputing each curated site from its stored horizon (src/years.ts) must reproduce the
// pipeline's own 2027 file, and every listed year must have a whole-year vectors file.
// Run from web/:  node scripts/check-years.ts
import { readFileSync } from 'node:fs'
import { retime } from '../src/years.ts'
import type { Site } from '../src/data.ts'

const data = new URL('../public/data/', import.meta.url)
const meta = JSON.parse(readFileSync(new URL('map/meta.json', data), 'utf8'))
const vec = (y: number) => {
  const b = readFileSync(new URL(`map/vectors_${y}.f32`, data))
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}
const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)

let ok = true
for (const y of meta.vectors.years as number[]) {
  const hours = vec(y).length / 6
  if (hours !== (leap(y) ? 8784 : 8760)) (ok = false), console.log(`${y}: ${hours} hours`)
}

const v27 = vec(2027)
const index: { id: string }[] = JSON.parse(readFileSync(new URL('sites.json', data), 'utf8'))
let worstEl = 0, worstFrac = 0, worstPct = 0, flips = 0, total = 0
for (const { id } of index) {
  const s: Site = JSON.parse(readFileSync(new URL(`sites/${id}.json`, data), 'utf8'))
  if (s.replay) continue
  // Pretend the file is for another year so retime() recomputes 2027 from scratch.
  const again = retime({ ...s, start_utc: '2026-01-01T00:00:00Z' }, 2027, v27)
  for (const b of ['sun', 'earth'] as const)
    for (let h = 0; h < s.samples; h++) {
      worstEl = Math.max(worstEl, Math.abs(again[b].el[h] - s[b].el[h]))
      worstFrac = Math.max(worstFrac, Math.abs(again[b].frac[h] - s[b].frac[h]))
      flips += +(again[b].frac[h] > 0 !== s[b].frac[h] > 0)
      total++
    }
  for (const k of ['sunlit_pct', 'earth_visible_pct', 'mean_power_index_pct'] as const)
    worstPct = Math.max(worstPct, Math.abs(again.metrics[k] - s.metrics[k]))
}
// Stored horizons are rounded to 0.01 deg and heights to 0.1 m, so a grazing disc's fraction moves a little
// (0.01 deg of a 0.27 deg Sun radius); what the app uses is visible or not, and the yearly percentages.
const pass = ok && worstEl <= 0.002 && worstFrac <= 0.05 && flips / total <= 1e-4 && worstPct <= 0.1
console.log(
  `years ${meta.vectors.years[0]}-${meta.vectors.years.at(-1)}; recomputed 2027 vs pipeline: elevation ${worstEl.toFixed(4)} deg, ` +
    `disc ${worstFrac.toFixed(4)}, visible/hidden differs ${flips} of ${total} hours, metrics ${worstPct.toFixed(3)} pp -> ${pass ? 'PASS' : 'FAIL'}`,
)
process.exit(pass ? 0 : 1)
