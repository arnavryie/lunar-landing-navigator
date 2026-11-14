/**
 * Solar position approximation for Earth cities.
 *
 * Implements the standard NOAA Solar Calculations / Astronomical Almanac
 * approximation (accurate to within ~1 degree for civilian educational comparisons).
 * Formula source: NOAA Earth System Research Laboratory (ESRL) Solar Calculator
 * https://gml.noaa.gov/grad/solcalc/solareqns.html
 */

export interface EarthCity {
  id: string
  name: string
  lat: number // degrees, north positive
  lon: number // degrees, east positive
}

export const CITIES: EarthCity[] = [
  { id: 'pune', name: 'Pune, India', lat: 18.52, lon: 73.85 },
  { id: 'mumbai', name: 'Mumbai, India', lat: 19.07, lon: 72.88 },
  { id: 'london', name: 'London, UK', lat: 51.51, lon: -0.13 },
  { id: 'new-york', name: 'New York, USA', lat: 40.71, lon: -74.01 },
  { id: 'tokyo', name: 'Tokyo, Japan', lat: 35.68, lon: 139.77 },
  { id: 'sydney', name: 'Sydney, Australia', lat: -33.87, lon: 151.21 },
  { id: 'nairobi', name: 'Nairobi, Kenya', lat: -1.29, lon: 36.82 },
  { id: 'oslo', name: 'Oslo, Norway', lat: 59.91, lon: 10.75 },
  { id: 'santiago', name: 'Santiago, Chile', lat: -33.45, lon: -70.67 },
  { id: 'reykjavik', name: 'Reykjavik, Iceland', lat: 64.15, lon: -21.94 },
  { id: 'honolulu', name: 'Honolulu, USA', lat: 21.31, lon: -157.86 },
]

/**
 * Computes solar declination in degrees for a given day-of-year (1-366) and hour (0-24).
 */
export function solarDeclinationDeg(date: Date): number {
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60

  // Fractional year (radians)
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (hour - 12) / 24)

  // Solar declination (radians) via NOAA
  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  return (declRad * 180) / Math.PI
}

/**
 * Computes the maximum (solar noon) elevation of the Sun today at a given latitude.
 * At solar noon on Earth, max elevation = 90° - |latitude - declination|.
 */
export function maxSolarElevationToday(latDeg: number, date: Date = new Date()): number {
  const decl = solarDeclinationDeg(date)
  const zenithNoon = Math.abs(latDeg - decl)
  return Math.max(0, Math.round((90 - zenithNoon) * 10) / 10)
}

/**
 * Self-check:
 * Equator (lat 0°) at March Equinox (around March 21, declination ≈ 0°)
 * has local noon solar elevation ≈ 90°.
 */
export function selfCheckSolarCalculation(): boolean {
  const equinox = new Date(Date.UTC(2027, 2, 21, 12, 0)) // March 21 noon
  const elev = maxSolarElevationToday(0, equinox)
  return Math.abs(elev - 90) < 1.5 // within 1.5 degrees
}
