// Typed coordinates: the same browser computation as a map click, so the same 85-90 S area of the terrain map.
const MIN_S = 85

/** Parse "89.5" / "-89.5" / "89.5 S" as south latitude, and "-45" / "45 W" / "315" as east longitude 0-360. */
export function parseCoords(latText: string, lonText: string): { lat: number; lon: number } | string {
  if (latText.includes(',') && !lonText.trim()) [latText, lonText] = latText.split(',')
  const num = (t: string) => Number(t.trim().replace(/°/g, '').replace(/\s*[NSEW]$/i, ''))
  const la = num(latText)
  const lo = num(lonText)
  if (!latText.trim() || !lonText.trim() || !Number.isFinite(la) || !Number.isFinite(lo)) return 'Enter a latitude and a longitude, e.g. 89.45 S, 222.7 E.'
  if (/n\s*$/i.test(latText.trim()) && la !== 0) return 'Only the south polar region (85° to 90° S) can be computed here.'
  const lat = -Math.abs(la) // south pole only; a sign or an "S" both mean south
  if (Math.abs(la) > 90) return 'Latitude must be between 85° and 90° S.'
  if (-lat < MIN_S)
    return `${Math.abs(la)}° S is outside the browser terrain map (${MIN_S}° to 90° S). For other places, add the site to pipeline/sites.json and run export_sites.py.`
  const west = /w\s*$/i.test(lonText.trim())
  const e = west ? -Math.abs(lo) : lo
  if (e < -180 || e > 360) return 'Longitude must be -180 to 360 (east positive, or add W).'
  return { lat, lon: Math.round((((e % 360) + 360) % 360) * 1e6) / 1e6 } // rounded: no float noise in the pin
}
