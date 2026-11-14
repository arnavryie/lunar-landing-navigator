import type { Grid } from '../../engine.ts'
import type { RouteProfile, RoverMissionConfig, Waypoint } from '../types.ts'
import { kmBetween, terrainAtCoord } from './mapLoader.ts'
import { calculateSolarOutputWatts } from './solarModel.ts'

/**
 * Plan an energy-aware, terrain-sampled route from rover position to candidate destination.
 */
export function planRouteProfile(
  config: RoverMissionConfig,
  destLat: number,
  destLon: number,
  demGrid: Grid,
  vectors: Float32Array,
  departureHourIndex: number,
): RouteProfile {
  const startLat = config.mission.startLat
  const startLon = config.mission.startLon
  const totalDistanceKm = kmBetween(startLat, startLon, destLat, destLon)

  const speedKmh = Math.max(0.02, config.mobility.speedKmh)
  const estimatedTravelTimeH = totalDistanceKm / speedKmh
  const arrivalHourIndex = departureHourIndex + Math.ceil(estimatedTravelTimeH)

  // Subsystem hotel load during movement (thermal, avionics, comms, standby)
  const hotelLoadWatts =
    config.power.thermalManagementW +
    config.power.avionicsW +
    config.power.communicationsW +
    config.power.standbySystemsW // instruments parked in standby during traversal

  // Sample route into intermediate waypoints (e.g. 12 steps)
  const numSteps = Math.max(8, Math.min(24, Math.ceil(totalDistanceKm * 4)))
  const waypoints: Waypoint[] = []

  let maxSlopeDeg = 0
  let totalSlope = 0
  let elevationGainM = 0
  let elevationLossM = 0
  let prevElevM = terrainAtCoord(demGrid, startLat, startLon).elevationM

  for (let s = 0; s <= numSteps; s++) {
    const frac = s / numSteps
    // Great-circle interpolation or planar approximation for short distances
    const lat = startLat + (destLat - startLat) * frac
    const lon = startLon + (destLon - startLon) * frac

    const { elevationM, slopeDeg } = terrainAtCoord(demGrid, lat, lon)
    const legDistKm = s === 0 ? 0 : totalDistanceKm / numSteps
    const distFromStart = totalDistanceKm * frac

    if (slopeDeg > maxSlopeDeg) maxSlopeDeg = slopeDeg
    totalSlope += slopeDeg

    if (s > 0) {
      const diffElev = elevationM - prevElevM
      if (diffElev > 0) elevationGainM += diffElev
      else elevationLossM += Math.abs(diffElev)
    }
    prevElevM = elevationM

    // Approximate solar illumination at waypoint during its transit timestamp
    const transitHour = Math.min(
      Math.floor(departureHourIndex + estimatedTravelTimeH * frac),
      Math.floor(vectors.length / 6 - 1),
    )
    const sunX = vectors[6 * transitHour]
    const sunY = vectors[6 * transitHour + 1]
    const sunZ = vectors[6 * transitHour + 2]
    const sunDist = Math.hypot(sunX, sunY, sunZ)
    const sunElevationDeg = (Math.asin(sunZ / sunDist) * 180) / Math.PI

    // Waypoint is illuminated if elevation is positive and not steep downslope into crater
    const isSunlit = sunElevationDeg > 0.1 && elevationM > -1200
    const sunFrac = isSunlit ? 1.0 : 0.0

    waypoints.push({
      lat,
      lon,
      elevationM,
      slopeDeg,
      distanceFromStartKm: distFromStart,
      legDistanceKm: legDistKm,
      isSunlit,
      sunFrac,
    })
  }

  const averageSlopeDeg = totalSlope / (numSteps + 1)

  // Energy consumption calculations
  // Drive power scales with terrain difficulty and slope penalty:
  const slopePenalty = 1 + averageSlopeDeg / 15.0
  const effectiveDriveWatts = config.mobility.mobilityPowerW * config.mobility.terrainFactor * slopePenalty
  const mobilityEnergyGrossKwh = (effectiveDriveWatts / 1000) * estimatedTravelTimeH
  const transitHotelEnergyKwh = (hotelLoadWatts / 1000) * estimatedTravelTimeH

  // Solar recovery along the path while moving
  let transitSolarEnergyRecoveredKwh = 0
  const dtStepH = estimatedTravelTimeH / numSteps
  for (let s = 0; s < waypoints.length; s++) {
    const wp = waypoints[s]
    if (wp.isSunlit) {
      const transitHour = Math.min(
        Math.floor(departureHourIndex + estimatedTravelTimeH * (s / numSteps)),
        Math.floor(vectors.length / 6 - 1),
      )
      const sunX = vectors[6 * transitHour]
      const sunY = vectors[6 * transitHour + 1]
      const sunZ = vectors[6 * transitHour + 2]
      const sunDist = Math.hypot(sunX, sunY, sunZ)
      const sunElevationDeg = (Math.asin(sunZ / sunDist) * 180) / Math.PI
      const sunAzimuthDeg = ((Math.atan2(sunY, sunX) * 180) / Math.PI + 360) % 360

      const powerW = calculateSolarOutputWatts(config.solar, sunElevationDeg, sunAzimuthDeg, wp.sunFrac)
      transitSolarEnergyRecoveredKwh += (powerW / 1000) * dtStepH
    }
  }

  // Net energy expended during transit
  const grossExpenditureKwh = mobilityEnergyGrossKwh + transitHotelEnergyKwh
  const netTransitEnergyKwh = Math.max(0, grossExpenditureKwh - transitSolarEnergyRecoveredKwh)

  // Battery state at arrival
  const startingStoredKwh = config.battery.totalCapacityKwh * (config.battery.currentSocPct / 100)
  const arrivalEnergyKwh = Math.max(0, startingStoredKwh - netTransitEnergyKwh)
  const arrivalSocPct = (arrivalEnergyKwh / config.battery.totalCapacityKwh) * 100

  const isSafeTraverse = maxSlopeDeg <= 18.0 && totalDistanceKm <= config.mobility.maxTravelDistanceKm

  return {
    totalDistanceKm,
    estimatedTravelTimeH,
    departureHourIndex,
    arrivalHourIndex,
    waypoints,
    maxSlopeDeg,
    averageSlopeDeg,
    elevationGainM,
    elevationLossM,
    mobilityEnergyGrossKwh,
    transitHotelEnergyKwh,
    transitSolarEnergyRecoveredKwh,
    netTransitEnergyKwh,
    arrivalEnergyKwh,
    arrivalSocPct,
    isSafeTraverse,
  }
}
