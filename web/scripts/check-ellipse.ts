// Self-check for src/ellipseGeometry.ts: run with `npm run check:ellipse`.
import assert from 'node:assert/strict'
import { ellipseOutline, ellipseSamples, kmBetween } from '../src/ellipseGeometry.ts'

for (const c of [{ lat: -89.67, lon: 129.78 }, { lat: -86, lon: 30 }, { lat: -85.2, lon: 300 }]) {
  for (const headingDeg of [0, 45, 90]) {
    const e = { lengthKm: 6, widthKm: 2, headingDeg }
    const ring = ellipseOutline(c, e, 72)
    // Long-axis ends are 3 km away, short-axis ends 1 km (within 1%).
    assert.ok(Math.abs(kmBetween(c, ring[0]) - 3) < 0.03, `long axis ${kmBetween(c, ring[0])}`)
    assert.ok(Math.abs(kmBetween(c, ring[18]) - 1) < 0.01, `short axis ${kmBetween(c, ring[18])}`)
    const { points, spacingM } = ellipseSamples(c, e)
    assert.equal(points[0], c)
    assert.ok(spacingM >= 240 && points.length > 30 && points.length < 70, `${points.length} points`)
    for (const p of points) assert.ok(kmBetween(c, p) <= 3.03)
  }
  // Heading 0 points the long axis north (away from the pole): its end is further from the pole.
  const n = ellipseOutline(c, { lengthKm: 6, widthKm: 2, headingDeg: 0 })[0]
  assert.ok(n.lat > c.lat + 0.08)
  // Heading 90 points it east: longitude increases, latitude barely changes.
  const east = ellipseOutline(c, { lengthKm: 6, widthKm: 2, headingDeg: 90 })[0]
  assert.ok(((east.lon - c.lon + 540) % 360) - 180 > 0 && Math.abs(east.lat - c.lat) < 0.3 * (n.lat - c.lat))
}
// Ellipse smaller than one 240 m terrain pixel: only the target.
assert.equal(ellipseSamples({ lat: -89, lon: 0 }, { lengthKm: 0.1, widthKm: 0.1, headingDeg: 0 }).points.length, 1)
console.log('ellipse check passed')
