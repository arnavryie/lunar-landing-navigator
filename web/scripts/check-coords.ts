// Typed coordinates parser (src/coords.ts). Run from web/:  node scripts/check-coords.ts
import assert from 'node:assert/strict'
import { parseCoords } from '../src/coords.ts'

assert.deepEqual(parseCoords('89.45', '222.7'), { lat: -89.45, lon: 222.7 })
assert.deepEqual(parseCoords('-89.45', '-137.3'), { lat: -89.45, lon: 222.7 })
assert.deepEqual(parseCoords('89.45 S', '137.3 W'), { lat: -89.45, lon: 222.7 })
assert.deepEqual(parseCoords('-86.5, 30', ''), { lat: -86.5, lon: 30 })
assert.deepEqual(parseCoords('90', '360'), { lat: -90, lon: 0 })
for (const [a, b] of [['84.9', '10'], ['89 N', '10'], ['91', '0'], ['', '5'], ['abc', '5'], ['89', '400']])
  assert.equal(typeof parseCoords(a, b), 'string', `${a}, ${b} should be rejected`)
console.log('coords: parser -> PASS')
