// Checks the in-browser engine (src/engine.ts) against the Python pipeline (public/data/map/check.json).
// Run from web/:  node scripts/check-engine.ts
// Pass marks from the plan: Sun/Earth direction within 0.001 deg, sunlit % within 0.5 percentage points.
import { readFileSync } from 'node:fs'
import { horizonMask, siteTracks, trackMetrics, heightM, type Grid } from '../src/engine.ts'

const dir = new URL('../public/data/map/', import.meta.url)
const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8'))
const buf = readFileSync(new URL(meta.dem.file, dir))
const grid: Grid = { dn: new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), n: meta.dem.n, scaleM: meta.dem.scale_m }
const vb = readFileSync(new URL(meta.vectors.file, dir))
const vectors = new Float32Array(vb.buffer, vb.byteOffset, vb.byteLength / 4)
const checks = JSON.parse(readFileSync(new URL('check.json', dir), 'utf8'))

let worstDir = 0, worstSun = 0, worstEarth = 0, worstHz = 0
for (const c of checks) {
  const mask = horizonMask(grid, c.lat, c.lon, meta.obs_height_m)
  const tracks = siteTracks(vectors, c.lat, c.lon, heightM(grid, c.lat, c.lon) + meta.obs_height_m, mask)
  const m = trackMetrics(tracks)
  for (const s of c.samples)
    for (const b of ['sun', 'earth'] as const) {
      const daz = Math.abs(((tracks[b].az[s.h] - s[`${b}_az`] + 540) % 360) - 180) * Math.cos((s[`${b}_el`] * Math.PI) / 180)
      worstDir = Math.max(worstDir, Math.hypot(daz, tracks[b].el[s.h] - s[`${b}_el`]))
    }
  let hz = 0
  c.horizon_el.forEach((v: number, k: number) => (hz = Math.max(hz, Math.abs(mask[k] - v))))
  worstHz = Math.max(worstHz, hz)
  const dSun = Math.abs(m.sunlit_pct - c.metrics.sunlit_pct)
  const dEarth = Math.abs(m.earth_visible_pct - c.metrics.earth_visible_pct)
  worstSun = Math.max(worstSun, dSun)
  worstEarth = Math.max(worstEarth, dEarth)
  console.log(`${c.lat.toFixed(3)} ${c.lon.toFixed(2)}  sunlit ${m.sunlit_pct} vs ${c.metrics.sunlit_pct}  earth ${m.earth_visible_pct} vs ${c.metrics.earth_visible_pct}  max horizon diff ${hz.toFixed(3)} deg`)
}
const pass = worstDir < 0.001 && worstSun <= 0.5 && worstEarth <= 0.5
console.log(`\nworst direction ${worstDir.toExponential(2)} deg, sunlit ${worstSun.toFixed(2)} pp, earth ${worstEarth.toFixed(2)} pp, horizon ${worstHz.toFixed(3)} deg -> ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
