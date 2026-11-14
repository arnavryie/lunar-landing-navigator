import type { RoverSolarConfig } from '../types.ts'

const D2R = Math.PI / 180

/**
 * Calculate solar incidence angle cosine: cos(theta_incidence).
 * In lunar polar regions, Sun elevation is typically 0 deg to 1.5 deg above the local horizon.
 * A tilted panel (e.g. 75-90 deg from horizontal) intercepts low-skimming polar sunlight efficiently.
 */
export function calculateSolarIncidenceCosine(
  solarConfig: RoverSolarConfig,
  sunElevationDeg: number,
  sunAzimuthDeg: number,
): number {
  if (sunElevationDeg <= -0.5) return 0 // Sun below mean spherical horizon

  const sunElRad = sunElevationDeg * D2R
  const panelTiltRad = solarConfig.panelTiltDeg * D2R // 90 deg = vertical panel

  if (solarConfig.trackingMode === 'sun_tracking') {
    // Array rotates / tracks solar azimuth, maintaining optimal azimuth alignment
    // Normal vector is inclined at panelTiltDeg towards the Sun
    // Dot product: cos(theta) = cos(sunEl) * sin(panelTilt) + sin(sunEl) * cos(panelTilt)
    const cosInc = Math.cos(sunElRad) * Math.sin(panelTiltRad) + Math.sin(sunElRad) * Math.cos(panelTiltRad)
    return Math.max(0, Math.min(1, cosInc))
  }

  // Fixed orientation panel
  const azDiffRad = (sunAzimuthDeg - solarConfig.panelAzimuthDeg) * D2R
  const cosInc =
    Math.sin(sunElRad) * Math.cos(panelTiltRad) +
    Math.cos(sunElRad) * Math.sin(panelTiltRad) * Math.cos(azDiffRad)

  return Math.max(0, Math.min(1, cosInc))
}

/**
 * Calculate instantaneous solar array electrical generation in Watts.
 */
export function calculateSolarOutputWatts(
  solarConfig: RoverSolarConfig,
  sunElevationDeg: number,
  sunAzimuthDeg: number,
  sunFraction: number, // 0.0 (shadow) to 1.0 (full disc above terrain)
): number {
  if (sunFraction <= 0.001 || sunElevationDeg <= -0.5) return 0

  const cosIncidence = calculateSolarIncidenceCosine(solarConfig, sunElevationDeg, sunAzimuthDeg)
  const cellEfficiencyFactor = solarConfig.efficiencyPct / 28.0 // Normalized around 28% multi-junction GaAs baseline
  const dustFactor = Math.max(0.5, Math.min(1.0, solarConfig.dustDegradationFactor))

  const powerWatts =
    solarConfig.ratedOutputW *
    cellEfficiencyFactor *
    dustFactor *
    cosIncidence *
    sunFraction

  return Math.max(0, powerWatts)
}
