import type { Tracks } from '../../engine.ts'
import type {
  CandidateFeasibility,
  RechargeCandidate,
  RoverMissionConfig,
  SimulationRunResult,
  SimulationStepTelemetry,
} from '../types.ts'
import { calculateSolarOutputWatts } from './solarModel.ts'
import { yearStartMs } from '../types.ts'

export interface CandidateSimulationInput {
  id: string
  name: string
  lat: number
  lon: number
  elevationM: number
  slopeDeg: number
  distanceKm: number
  bearingDeg: number
  cardinalDirection: string
  route: RechargeCandidate['route']
  tracks: Tracks
  sunlitWindowDurationH: number
  sunlitWindowStartH: number
  sunlitWindowEndH: number
  hoursToSunrise: number
  totalSunlitHoursInHorizon: number
  meanSunElevationDeg: number
}

/**
 * Authoritative discrete physical simulation of rover mission phases:
 * Phase 1: Standby
 * Phase 2: Transit to destination (mobility + hotel - transit solar)
 * Phase 3: Solar Array Recharge at destination (continuous solar generation - recharge hotel, with capacity saturation & curtailment)
 * Phase 4: Post-Recharge Science Operations (continuous solar generation - science operations hotel)
 *
 * Implements strict energy conservation:
 * E_final = E_initial + totalSolar - totalHotel - totalMobility - totalCurtailed
 */
export function simulateMissionLedger(
  config: RoverMissionConfig,
  candidate: CandidateSimulationInput,
  vectors: Float32Array,
  startHourIndex: number,
  horizonHours: number,
): SimulationRunResult {
  const batteryCapKwh = config.battery.totalCapacityKwh
  const minReservePct = config.battery.minReservePct
  const departureSocPct = config.battery.currentSocPct
  const initialBatteryKwh = batteryCapKwh * (departureSocPct / 100)

  const route = candidate.route
  const travelDurationH = Math.max(0.01, route.estimatedTravelTimeH)
  const totalHoursAvailable = Math.floor(vectors.length / 6)
  const totalSimHours = Math.min(horizonHours, totalHoursAvailable - startHourIndex - 1)
  const startUtcMs = yearStartMs(config.mission) + startHourIndex * 3600000

  // Power draws (Watts)
  const hotelStandbyWatts =
    config.power.thermalManagementW +
    config.power.avionicsW +
    config.power.communicationsW +
    config.power.standbySystemsW // 155 W nominal

  const hotelPostRechargeWatts = hotelStandbyWatts + config.power.scienceInstrumentsW

  const slopePenalty = 1 + route.averageSlopeDeg / 15.0
  const driveWatts = config.mobility.mobilityPowerW * config.mobility.terrainFactor * slopePenalty

  // Phase accumulators (kWh)
  // 1. Destination Theoretical Solar Potential (independent of rover reachability)
  let theoreticalSolarPotentialKwh = 0
  let theoreticalRechargePotentialKwh = 0
  const tracksLength = candidate.tracks.sun.frac.length
  const winStart = candidate.sunlitWindowStartH
  const winEnd = Math.min(tracksLength, candidate.sunlitWindowEndH)

  for (let s = winStart; s < winEnd; s++) {
    const sIdx = startHourIndex + s
    if (sIdx * 6 + 2 >= vectors.length) break
    const sSunX = vectors[6 * sIdx]
    const sSunY = vectors[6 * sIdx + 1]
    const sSunZ = vectors[6 * sIdx + 2]
    const sDist = Math.hypot(sSunX, sSunY, sSunZ)
    const sEl = candidate.tracks.sun.el[s] ?? (Math.asin(sSunZ / sDist) * 180) / Math.PI
    const sAz = candidate.tracks.sun.az[s] ?? ((Math.atan2(sSunY, sSunX) * 180) / Math.PI + 360) % 360
    const sFrac = candidate.tracks.sun.frac[s] ?? 0
    const sWatts = calculateSolarOutputWatts(config.solar, sEl, sAz, sFrac)
    const sSolarKwh = sWatts / 1000
    const sHotelKwh = hotelStandbyWatts / 1000
    theoreticalSolarPotentialKwh += sSolarKwh
    theoreticalRechargePotentialKwh += Math.max(0, sSolarKwh - sHotelKwh)
  }

  let isDestinationReached = false
  let isFailureOccurred = false
  let failureReason = ''
  let failureHourIndex: number | null = null
  let failureTimeH: number | null = null
  let failureDistanceKm: number | null = null

  // 2. Track energy components throughout simulation
  let transitMobilityKwh = 0
  let transitHotelKwh = 0
  let transitSolarKwh = 0
  let transitCurtailedKwh = 0

  let rechargeSolarKwh = 0
  let rechargeHotelKwh = 0
  let rechargeCurtailedKwh = 0

  let postRechargeSolarKwh = 0
  let postRechargeHotelKwh = 0
  let postRechargeCurtailedKwh = 0

  let totalSolarGeneratedKwh = 0
  let totalHotelEnergyKwh = 0
  let totalMobilityEnergyKwh = 0
  let totalCurtailedSolarKwh = 0

  let currentBatteryKwh = initialBatteryKwh
  let minBatteryKwh = initialBatteryKwh
  let minSocReachedPct = departureSocPct

  let arrivalBatteryKwh = initialBatteryKwh
  let arrivalSocPct = departureSocPct
  let arrivalRecorded = false

  const steps: SimulationStepTelemetry[] = []

  // Add initial state at T=0
  const initialSunX = vectors[6 * startHourIndex]
  const initialSunY = vectors[6 * startHourIndex + 1]
  const initialSunZ = vectors[6 * startHourIndex + 2]
  const initialSunDist = Math.hypot(initialSunX, initialSunY, initialSunZ)
  const initialSunEl = (Math.asin(initialSunZ / initialSunDist) * 180) / Math.PI
  const initialSunAz = ((Math.atan2(initialSunY, initialSunX) * 180) / Math.PI + 360) % 360
  const initialSunFrac = candidate.tracks.sun.frac[0] ?? 0
  const initialSolarGenW = calculateSolarOutputWatts(
    config.solar,
    initialSunEl,
    initialSunAz,
    initialSunFrac,
  )

  steps.push({
    hourIndex: startHourIndex,
    stepTimeH: 0,
    utcDateStr: new Date(startUtcMs).toISOString(),
    phase: 'transit',
    phaseLabel: 'Departure / Transit',
    roverLat: config.mission.startLat,
    roverLon: config.mission.startLon,
    roverElevM: route.waypoints[0]?.elevationM || 0,
    sunElevationDeg: initialSunEl,
    sunAzimuthDeg: initialSunAz,
    isDirectSunlit: initialSunFrac > 0.05,
    sunFraction: initialSunFrac,
    solarGenerationW: initialSolarGenW,
    locomotionDrawW: driveWatts,
    hotelDrawW: hotelStandbyWatts,
    netPowerW: initialSolarGenW - (driveWatts + hotelStandbyWatts),
    curtailedPowerW: 0,
    storedEnergyKwh: currentBatteryKwh,
    socPct: departureSocPct,
    distanceCoveredKm: 0,
  })

  // Hourly step simulation: step h simulates the 1-hour interval [h, h + 1]
  for (let h = 0; h < totalSimHours; h++) {
    const currentHourIndex = startHourIndex + h
    const nextHourIndex = currentHourIndex + 1
    const stepUtcDate = new Date(startUtcMs + (h + 1) * 3600000).toISOString()

    const sunX = vectors[6 * nextHourIndex]
    const sunY = vectors[6 * nextHourIndex + 1]
    const sunZ = vectors[6 * nextHourIndex + 2]
    const sunDist = Math.hypot(sunX, sunY, sunZ)
    const sunElevationDeg = (Math.asin(sunZ / sunDist) * 180) / Math.PI
    const sunAzimuthDeg = ((Math.atan2(sunY, sunX) * 180) / Math.PI + 360) % 360

    let phase: SimulationStepTelemetry['phase'] = 'transit'
    let phaseLabel = 'Transit to Ridge'
    let roverLat = config.mission.startLat
    let roverLon = config.mission.startLon
    let roverElevM = 0
    let distanceCoveredKm = 0

    let stepDriveHours = 0
    let stepStationaryHours = 0
    let stepMobilityEnergyKwh = 0
    let stepHotelEnergyKwh = 0
    let stepSolarEnergyKwh = 0
    let stepSunFraction = 0
    let isDirectSunlit = false

    // Timing relative to travel duration
    const tIntervalStart = h
    const tIntervalEnd = h + 1

    if (tIntervalEnd <= travelDurationH) {
      // 1. Entire hour is in TRANSIT
      phase = 'transit'
      phaseLabel = 'Transit to Ridge'
      stepDriveHours = 1.0
      stepStationaryHours = 0.0

      const transitFrac = Math.min(1.0, (h + 0.5) / travelDurationH)
      distanceCoveredKm = route.totalDistanceKm * Math.min(1.0, tIntervalEnd / travelDurationH)

      const wpIdx = Math.min(
        route.waypoints.length - 1,
        Math.floor(transitFrac * (route.waypoints.length - 1)),
      )
      const wp = route.waypoints[wpIdx]
      if (wp) {
        roverLat = wp.lat
        roverLon = wp.lon
        roverElevM = wp.elevationM
        stepSunFraction = wp.sunFrac
        isDirectSunlit = wp.isSunlit
      }

      stepMobilityEnergyKwh = (driveWatts / 1000) * 1.0
      stepHotelEnergyKwh = (hotelStandbyWatts / 1000) * 1.0
      const solarW = calculateSolarOutputWatts(
        config.solar,
        sunElevationDeg,
        sunAzimuthDeg,
        stepSunFraction,
      )
      stepSolarEnergyKwh = (solarW / 1000) * 1.0

      const netDrainKwh = stepMobilityEnergyKwh + stepHotelEnergyKwh - stepSolarEnergyKwh
      if (netDrainKwh > 0 && currentBatteryKwh - netDrainKwh <= 1e-6) {
        // BATTERY EXHAUSTION DURING TRANSIT: Vehicle loses power and halts
        const dtFail = Math.max(0, Math.min(1.0, currentBatteryKwh / netDrainKwh))
        const actualMobKwh = stepMobilityEnergyKwh * dtFail
        const actualHotKwh = stepHotelEnergyKwh * dtFail
        const actualSolKwh = stepSolarEnergyKwh * dtFail

        transitMobilityKwh += actualMobKwh
        transitHotelKwh += actualHotKwh
        transitSolarKwh += actualSolKwh
        totalMobilityEnergyKwh += actualMobKwh
        totalHotelEnergyKwh += actualHotKwh
        totalSolarGeneratedKwh += actualSolKwh

        currentBatteryKwh = 0.0
        minBatteryKwh = 0.0
        minSocReachedPct = 0.0

        const failTime = h + dtFail
        const failDistKm = Math.min(route.totalDistanceKm, (failTime / travelDurationH) * route.totalDistanceKm)

        isDestinationReached = false
        isFailureOccurred = true
        failureTimeH = Number(failTime.toFixed(2))
        failureDistanceKm = Number(failDistKm.toFixed(2))
        failureHourIndex = startHourIndex + Math.ceil(failTime)
        failureReason = `Battery exhausted to 0.0% SoC at T+${failTime.toFixed(1)}h during transit (${failDistKm.toFixed(2)} km from start, ${route.totalDistanceKm.toFixed(2)} km required). Rover stranded in darkness.`

        steps.push({
          hourIndex: startHourIndex + Math.ceil(failTime),
          stepTimeH: Number(failTime.toFixed(2)),
          utcDateStr: new Date(startUtcMs + failTime * 3600000).toISOString(),
          phase: 'transit',
          phaseLabel: 'Stranded (Battery Depleted)',
          roverLat,
          roverLon,
          roverElevM,
          sunElevationDeg,
          sunAzimuthDeg,
          isDirectSunlit: false,
          sunFraction: 0,
          solarGenerationW: 0,
          locomotionDrawW: 0,
          hotelDrawW: 0,
          netPowerW: 0,
          curtailedPowerW: 0,
          storedEnergyKwh: 0,
          socPct: 0,
          distanceCoveredKm: failDistKm,
        })
        break // Stop the physically executable simulation at point of failure
      }

      transitMobilityKwh += stepMobilityEnergyKwh
      transitHotelKwh += stepHotelEnergyKwh
      transitSolarKwh += stepSolarEnergyKwh
      totalMobilityEnergyKwh += stepMobilityEnergyKwh
      totalHotelEnergyKwh += stepHotelEnergyKwh
      totalSolarGeneratedKwh += stepSolarEnergyKwh
    } else if (tIntervalStart < travelDurationH && tIntervalEnd > travelDurationH) {
      // 2. Interval crosses the arrival moment!
      phase = 'recharge'
      phaseLabel = 'Arrival & Recharge'
      stepDriveHours = travelDurationH - tIntervalStart
      stepStationaryHours = 1.0 - stepDriveHours

      distanceCoveredKm = route.totalDistanceKm
      roverLat = candidate.lat
      roverLon = candidate.lon
      roverElevM = candidate.elevationM

      // Mobility draw during the driving portion
      const transitMobKwh = (driveWatts / 1000) * stepDriveHours
      const transitHotKwh = (hotelStandbyWatts / 1000) * stepDriveHours
      const transitWp = route.waypoints[route.waypoints.length - 1]
      const transitSunFrac = transitWp?.sunFrac ?? 0
      const transitSolarW = calculateSolarOutputWatts(
        config.solar,
        sunElevationDeg,
        sunAzimuthDeg,
        transitSunFrac,
      )
      const transitSolKwh = (transitSolarW / 1000) * stepDriveHours
      const netDriveDrain = transitMobKwh + transitHotKwh - transitSolKwh

      if (netDriveDrain > 0 && currentBatteryKwh - netDriveDrain <= 1e-6) {
        // Battery depleted during final driving portion
        const dtFailDrive = Math.max(0, Math.min(stepDriveHours, currentBatteryKwh / (netDriveDrain / stepDriveHours)))
        const actualMobKwh = (driveWatts / 1000) * dtFailDrive
        const actualHotKwh = (hotelStandbyWatts / 1000) * dtFailDrive
        const actualSolKwh = (transitSolarW / 1000) * dtFailDrive

        transitMobilityKwh += actualMobKwh
        transitHotelKwh += actualHotKwh
        transitSolarKwh += actualSolKwh
        totalMobilityEnergyKwh += actualMobKwh
        totalHotelEnergyKwh += actualHotKwh
        totalSolarGeneratedKwh += actualSolKwh

        currentBatteryKwh = 0.0
        minBatteryKwh = 0.0
        minSocReachedPct = 0.0

        const failTime = h + dtFailDrive
        const failDistKm = Math.min(route.totalDistanceKm, (failTime / travelDurationH) * route.totalDistanceKm)

        isDestinationReached = false
        isFailureOccurred = true
        failureTimeH = Number(failTime.toFixed(2))
        failureDistanceKm = Number(failDistKm.toFixed(2))
        failureHourIndex = startHourIndex + Math.ceil(failTime)
        failureReason = `Battery exhausted to 0.0% SoC at T+${failTime.toFixed(1)}h during final transit segment (${failDistKm.toFixed(2)} km from start). Rover stranded in darkness.`

        steps.push({
          hourIndex: startHourIndex + Math.ceil(failTime),
          stepTimeH: Number(failTime.toFixed(2)),
          utcDateStr: new Date(startUtcMs + failTime * 3600000).toISOString(),
          phase: 'transit',
          phaseLabel: 'Stranded (Battery Depleted)',
          roverLat,
          roverLon,
          roverElevM,
          sunElevationDeg,
          sunAzimuthDeg,
          isDirectSunlit: false,
          sunFraction: 0,
          solarGenerationW: 0,
          locomotionDrawW: 0,
          hotelDrawW: 0,
          netPowerW: 0,
          curtailedPowerW: 0,
          storedEnergyKwh: 0,
          socPct: 0,
          distanceCoveredKm: failDistKm,
        })
        break
      }

      transitMobilityKwh += transitMobKwh
      transitHotelKwh += transitHotKwh
      transitSolarKwh += transitSolKwh
      totalMobilityEnergyKwh += transitMobKwh

      // Capture arrival state
      const netTransitDelta = transitSolKwh - (transitMobKwh + transitHotKwh)
      arrivalBatteryKwh = Math.max(0, Math.min(batteryCapKwh, currentBatteryKwh + netTransitDelta))
      arrivalSocPct = (arrivalBatteryKwh / batteryCapKwh) * 100
      arrivalRecorded = true
      isDestinationReached = true

      // CHECK MANDATORY RESERVE CONSTRAINT AT ARRIVAL
      if (arrivalSocPct < minReservePct - 0.01) {
        isFailureOccurred = true
        currentBatteryKwh = arrivalBatteryKwh
        minBatteryKwh = Math.min(minBatteryKwh, arrivalBatteryKwh)
        minSocReachedPct = Math.min(minSocReachedPct, arrivalSocPct)
        totalHotelEnergyKwh += transitHotKwh
        totalSolarGeneratedKwh += transitSolKwh
        failureTimeH = Number(travelDurationH.toFixed(2))
        failureDistanceKm = Number(route.totalDistanceKm.toFixed(2))
        failureHourIndex = startHourIndex + Math.ceil(travelDurationH)
        failureReason = `Mandatory reserve constraint breached: Arrived with ${arrivalSocPct.toFixed(1)}% SoC, failing the ${minReservePct.toFixed(0)}% safety reserve threshold by ${(minReservePct - arrivalSocPct).toFixed(1)}%. Mission aborted.`

        steps.push({
          hourIndex: startHourIndex + Math.ceil(travelDurationH),
          stepTimeH: Number(travelDurationH.toFixed(2)),
          utcDateStr: new Date(startUtcMs + travelDurationH * 3600000).toISOString(),
          phase: 'transit',
          phaseLabel: 'Arrival (Reserve Breached)',
          roverLat: candidate.lat,
          roverLon: candidate.lon,
          roverElevM: candidate.elevationM,
          sunElevationDeg,
          sunAzimuthDeg,
          isDirectSunlit: false,
          sunFraction: 0,
          solarGenerationW: 0,
          locomotionDrawW: 0,
          hotelDrawW: 0,
          netPowerW: 0,
          curtailedPowerW: 0,
          storedEnergyKwh: arrivalBatteryKwh,
          socPct: arrivalSocPct,
          distanceCoveredKm: route.totalDistanceKm,
        })
        break // Stop simulation at point of failure
      }

      // Rover is reserve-compliant: proceed with destination recharge during remaining hour portion
      const destSunFrac = candidate.tracks.sun.frac[nextHourIndex - startHourIndex] ?? 0
      stepSunFraction = destSunFrac
      isDirectSunlit = destSunFrac > 0.05
      const destSolarW = calculateSolarOutputWatts(
        config.solar,
        sunElevationDeg,
        sunAzimuthDeg,
        destSunFrac,
      )
      const rechargeSolKwh = (destSolarW / 1000) * stepStationaryHours
      const rechargeHotKwh = (hotelStandbyWatts / 1000) * stepStationaryHours

      rechargeSolarKwh += rechargeSolKwh
      rechargeHotelKwh += rechargeHotKwh
      totalHotelEnergyKwh += transitHotKwh + rechargeHotKwh
      totalSolarGeneratedKwh += transitSolKwh + rechargeSolKwh

      stepMobilityEnergyKwh = transitMobKwh
      stepHotelEnergyKwh = transitHotKwh + rechargeHotKwh
      stepSolarEnergyKwh = transitSolKwh + rechargeSolKwh
    } else {
      // 3. Rover is STATIONARY at destination
      if (!arrivalRecorded) {
        arrivalBatteryKwh = currentBatteryKwh
        arrivalSocPct = (arrivalBatteryKwh / batteryCapKwh) * 100
        arrivalRecorded = true
        isDestinationReached = true

        // CHECK MANDATORY RESERVE CONSTRAINT AT ARRIVAL
        if (arrivalSocPct < minReservePct - 0.01) {
          isFailureOccurred = true
          minBatteryKwh = Math.min(minBatteryKwh, arrivalBatteryKwh)
          minSocReachedPct = Math.min(minSocReachedPct, arrivalSocPct)
          failureTimeH = Number(travelDurationH.toFixed(2))
          failureDistanceKm = Number(route.totalDistanceKm.toFixed(2))
          failureHourIndex = startHourIndex + Math.ceil(travelDurationH)
          failureReason = `Mandatory reserve constraint breached: Arrived with ${arrivalSocPct.toFixed(1)}% SoC, failing the ${minReservePct.toFixed(0)}% safety reserve threshold by ${(minReservePct - arrivalSocPct).toFixed(1)}%. Mission aborted.`

          steps.push({
            hourIndex: startHourIndex + Math.ceil(travelDurationH),
            stepTimeH: Number(travelDurationH.toFixed(2)),
            utcDateStr: new Date(startUtcMs + travelDurationH * 3600000).toISOString(),
            phase: 'transit',
            phaseLabel: 'Arrival (Reserve Breached)',
            roverLat: candidate.lat,
            roverLon: candidate.lon,
            roverElevM: candidate.elevationM,
            sunElevationDeg,
            sunAzimuthDeg,
            isDirectSunlit: false,
            sunFraction: 0,
            solarGenerationW: 0,
            locomotionDrawW: 0,
            hotelDrawW: 0,
            netPowerW: 0,
            curtailedPowerW: 0,
            storedEnergyKwh: arrivalBatteryKwh,
            socPct: arrivalSocPct,
            distanceCoveredKm: route.totalDistanceKm,
          })
          break // Stop simulation at point of failure
        }
      }

      roverLat = candidate.lat
      roverLon = candidate.lon
      roverElevM = candidate.elevationM
      distanceCoveredKm = route.totalDistanceKm
      stepDriveHours = 0.0
      stepStationaryHours = 1.0

      const trackIdx = Math.min(
        candidate.tracks.sun.frac.length - 1,
        nextHourIndex - startHourIndex,
      )
      stepSunFraction = candidate.tracks.sun.frac[trackIdx] ?? 0
      const trackSunEl = candidate.tracks.sun.el[trackIdx] ?? sunElevationDeg
      const trackSunAz = candidate.tracks.sun.az[trackIdx] ?? sunAzimuthDeg
      isDirectSunlit = stepSunFraction > 0.05 && trackSunEl > -0.5

      const hoursAfterArrival = h + 1 - travelDurationH
      const isInRechargeWindow = hoursAfterArrival <= candidate.sunlitWindowDurationH

      const solarW = calculateSolarOutputWatts(
        config.solar,
        trackSunEl,
        trackSunAz,
        stepSunFraction,
      )
      stepSolarEnergyKwh = (solarW / 1000) * 1.0

      if (isInRechargeWindow) {
        phase = 'recharge'
        phaseLabel = isDirectSunlit ? 'Solar Array Recharge' : 'Recharge Standby'
        stepHotelEnergyKwh = (hotelStandbyWatts / 1000) * 1.0
        rechargeSolarKwh += stepSolarEnergyKwh
        rechargeHotelKwh += stepHotelEnergyKwh
      } else {
        phase = 'post_recharge'
        phaseLabel = 'Post-Recharge Science Ops'
        stepHotelEnergyKwh = (hotelPostRechargeWatts / 1000) * 1.0
        postRechargeSolarKwh += stepSolarEnergyKwh
        postRechargeHotelKwh += stepHotelEnergyKwh
      }

      totalSolarGeneratedKwh += stepSolarEnergyKwh
      totalHotelEnergyKwh += stepHotelEnergyKwh
    }

    const netStepDeltaKwh = stepSolarEnergyKwh - stepHotelEnergyKwh - stepMobilityEnergyKwh
    const tentativeBatteryKwh = currentBatteryKwh + netStepDeltaKwh

    let stepCurtailedKwh = 0
    if (tentativeBatteryKwh > batteryCapKwh) {
      stepCurtailedKwh = tentativeBatteryKwh - batteryCapKwh
      currentBatteryKwh = batteryCapKwh
    } else if (tentativeBatteryKwh < 0) {
      stepCurtailedKwh = 0
      currentBatteryKwh = 0
    } else {
      stepCurtailedKwh = 0
      currentBatteryKwh = tentativeBatteryKwh
    }

    totalCurtailedSolarKwh += stepCurtailedKwh
    if (phase === 'transit') transitCurtailedKwh += stepCurtailedKwh
    else if (phase === 'recharge') rechargeCurtailedKwh += stepCurtailedKwh
    else postRechargeCurtailedKwh += stepCurtailedKwh

    const currentSocPct = (currentBatteryKwh / batteryCapKwh) * 100
    if (currentSocPct < minSocReachedPct) {
      minSocReachedPct = currentSocPct
      minBatteryKwh = currentBatteryKwh
    }

    const avgSolarW = stepSolarEnergyKwh * 1000
    const avgHotelW = stepHotelEnergyKwh * 1000
    const avgDriveW = stepMobilityEnergyKwh * 1000
    const netPowerW = avgSolarW - (avgHotelW + avgDriveW)
    const curtailedPowerW = stepCurtailedKwh * 1000

    steps.push({
      hourIndex: nextHourIndex,
      stepTimeH: h + 1,
      utcDateStr: stepUtcDate,
      phase,
      phaseLabel,
      roverLat,
      roverLon,
      roverElevM,
      sunElevationDeg,
      sunAzimuthDeg,
      isDirectSunlit,
      sunFraction: stepSunFraction,
      solarGenerationW: avgSolarW,
      locomotionDrawW: avgDriveW,
      hotelDrawW: avgHotelW,
      netPowerW,
      curtailedPowerW,
      storedEnergyKwh: currentBatteryKwh,
      socPct: currentSocPct,
      distanceCoveredKm,
    })
  }

  // Ensure arrival battery is recorded
  if (!arrivalRecorded) {
    arrivalBatteryKwh = currentBatteryKwh
    arrivalSocPct = (arrivalBatteryKwh / batteryCapKwh) * 100
  }

  let finalBatteryKwh = currentBatteryKwh
  let finalSocPct = (finalBatteryKwh / batteryCapKwh) * 100

  // Feasibility evaluation
  const arrivalReserveMarginPct = arrivalSocPct - minReservePct
  let feasibility: CandidateFeasibility = 'FEASIBLE'
  let recommendationVerdict: SimulationRunResult['recommendationVerdict'] = 'RECOMMENDED'
  let verdictReason = ''

  if (isFailureOccurred || minSocReachedPct <= 0.05 || arrivalReserveMarginPct < -0.01) {
    feasibility = 'INFEASIBLE'
    recommendationVerdict = 'INSUFFICIENT ENERGY'
    verdictReason =
      failureReason ||
      `Battery exhausts or breaches safety reserve during mission (arrival ${arrivalSocPct.toFixed(1)}% vs ${minReservePct.toFixed(0)}% required reserve).`
  } else if (arrivalReserveMarginPct < 2.0 || route.maxSlopeDeg > 18.0) {
    feasibility = 'CAUTION'
    recommendationVerdict = 'FEASIBLE WITH CAUTION'
    verdictReason = `Reachable with caution: narrow reserve margin (${arrivalReserveMarginPct >= 0 ? '+' : ''}${arrivalReserveMarginPct.toFixed(1)}%) or steep traversal slopes (max ${route.maxSlopeDeg.toFixed(1)}°).`
  } else if (finalBatteryKwh - initialBatteryKwh <= 0.2) {
    feasibility = 'CAUTION'
    recommendationVerdict = 'FEASIBLE WITH CAUTION'
    verdictReason = `Reachable safely, but yields minimal net energy benefit (+${(finalBatteryKwh - initialBatteryKwh).toFixed(2)} kWh) due to short illumination window or hotel consumption.`
  } else {
    feasibility = 'FEASIBLE'
    recommendationVerdict = 'RECOMMENDED'
    const storedRec = Math.max(0, finalBatteryKwh - arrivalBatteryKwh)
    const netBen = finalBatteryKwh - initialBatteryKwh
    verdictReason = `Optimal recharge opportunity: ${candidate.sunlitWindowDurationH}h continuous sunlight, recovering +${storedRec.toFixed(2)} kWh stored battery energy (+${netBen.toFixed(2)} kWh net mission benefit) with safe +${arrivalReserveMarginPct.toFixed(1)}% arrival reserve buffer.`
  }

  // If mission is infeasible, halt simulation outcomes at failure point: do not credit destination recharge
  if (feasibility === 'INFEASIBLE') {
    finalBatteryKwh = isDestinationReached ? arrivalBatteryKwh : 0.0
    finalSocPct = (finalBatteryKwh / batteryCapKwh) * 100
    totalSolarGeneratedKwh = transitSolarKwh
    totalHotelEnergyKwh = transitHotelKwh
    totalMobilityEnergyKwh = transitMobilityKwh
    totalCurtailedSolarKwh = transitCurtailedKwh
    rechargeSolarKwh = 0.0
    rechargeHotelKwh = 0.0
    rechargeCurtailedKwh = 0.0
    postRechargeSolarKwh = 0.0
    postRechargeHotelKwh = 0.0
    postRechargeCurtailedKwh = 0.0
  }

  // Separation of Potentials vs Actual Simulated Recovery
  const isExecutable = feasibility !== 'INFEASIBLE' && isDestinationReached
  const reachableRechargePotentialKwh = isExecutable
    ? Math.max(0, rechargeSolarKwh - rechargeHotelKwh)
    : 0.0
  const actualStoredEnergyRecoveredKwh = isExecutable
    ? Math.max(0, finalBatteryKwh - arrivalBatteryKwh)
    : 0.0

  const netStoredEnergyRecoveredKwh = actualStoredEnergyRecoveredKwh
  const netMissionEnergyBenefitKwh = finalBatteryKwh - initialBatteryKwh
  const transitNetExpenditureKwh = initialBatteryKwh - arrivalBatteryKwh

  // Mathematical Reconciliation Check
  // E_final must equal: E_initial + totalSolar - totalHotel - totalMobility - totalCurtailed
  const expectedFinalKwh =
    initialBatteryKwh +
    totalSolarGeneratedKwh -
    totalHotelEnergyKwh -
    totalMobilityEnergyKwh -
    totalCurtailedSolarKwh

  const reconciliationDeltaKwh = Math.abs(finalBatteryKwh - expectedFinalKwh)
  const isEnergyConserved = reconciliationDeltaKwh < 1e-5

  const missionSuccessful =
    isDestinationReached &&
    minSocReachedPct >= minReservePct &&
    netMissionEnergyBenefitKwh > 0 &&
    feasibility !== 'INFEASIBLE'

  let summaryVerdict = ''
  if (missionSuccessful) {
    summaryVerdict = `Mission Nominal: Relocated ${route.totalDistanceKm.toFixed(2)} km to ${candidate.name}. Battery replenished from ${departureSocPct.toFixed(0)}% to ${finalSocPct.toFixed(0)}% (+${netMissionEnergyBenefitKwh.toFixed(2)} kWh net mission gain).`
  } else if (!isDestinationReached) {
    summaryVerdict = `Mission Infeasible: Rover stranded in transit before reaching destination. ${failureReason}`
  } else if (arrivalReserveMarginPct < 0) {
    summaryVerdict = `Reserve Constraint Violation: Battery dropped to ${arrivalSocPct.toFixed(1)}% SoC upon arrival, breaching the ${minReservePct.toFixed(0)}% reserve threshold.`
  } else {
    summaryVerdict = `Energy Stagnation: Solar replenishment did not offset mission consumption, resulting in non-positive net benefit.`
  }

  return {
    candidateId: candidate.id,
    candidateName: candidate.name,
    steps,
    totalDurationH: totalSimHours,
    initialBatteryKwh,
    departureSocPct,

    transitDurationH: isDestinationReached ? travelDurationH : (failureTimeH ?? travelDurationH),
    transitDistanceKm: isDestinationReached
      ? route.totalDistanceKm
      : Math.min(route.totalDistanceKm, ((failureTimeH ?? travelDurationH) / travelDurationH) * route.totalDistanceKm),
    transitMobilityEnergyKwh: transitMobilityKwh,
    transitHotelEnergyKwh: transitHotelKwh,
    transitSolarGeneratedKwh: transitSolarKwh,
    transitCurtailedEnergyKwh: transitCurtailedKwh,
    transitNetExpenditureKwh,

    arrivalBatteryKwh,
    arrivalSocPct,
    arrivalReserveMarginPct,

    rechargeDurationH: isExecutable ? candidate.sunlitWindowDurationH : 0,
    rechargeSolarGeneratedKwh: isExecutable ? rechargeSolarKwh : 0,
    rechargeHotelEnergyKwh: isExecutable ? rechargeHotelKwh : 0,
    rechargePotentialNetKwh: reachableRechargePotentialKwh,
    rechargeStoredEnergyKwh: actualStoredEnergyRecoveredKwh,
    rechargeCurtailedSolarKwh: isExecutable ? rechargeCurtailedKwh : 0,

    postRechargeDurationH: isExecutable ? Math.max(0, totalSimHours - (travelDurationH + candidate.sunlitWindowDurationH)) : 0,
    postRechargeSolarGeneratedKwh: isExecutable ? postRechargeSolarKwh : 0,
    postRechargeHotelEnergyKwh: isExecutable ? postRechargeHotelKwh : 0,
    postRechargeStoredEnergyKwh: isExecutable ? Math.max(0, finalBatteryKwh - (arrivalBatteryKwh + actualStoredEnergyRecoveredKwh)) : 0,
    postRechargeCurtailedSolarKwh: isExecutable ? postRechargeCurtailedKwh : 0,

    finalBatteryKwh,
    finalSocPct,
    minBatteryKwh,
    minSocReachedPct,

    totalSolarGeneratedKwh,
    totalHotelEnergyKwh,
    totalMobilityEnergyKwh,
    totalCurtailedSolarKwh,
    netStoredEnergyRecoveredKwh,
    netMissionEnergyBenefitKwh,

    theoreticalSolarPotentialKwh,
    theoreticalRechargePotentialKwh,
    reachableRechargePotentialKwh,
    actualStoredEnergyRecoveredKwh,
    isDestinationReached,
    failureReason,
    failureHourIndex,
    failureTimeH,
    failureDistanceKm,

    reconciliationDeltaKwh,
    isEnergyConserved,

    missionSuccessful,
    feasibility,
    recommendationVerdict,
    verdictReason,
    summaryVerdict,
  }
}

/**
 * Top-level runner maintaining backward compatibility with LanderSystems.tsx
 */
export function runMissionSimulation(
  _config: RoverMissionConfig,
  candidate: RechargeCandidate,
  _vectors: Float32Array,
): SimulationRunResult {
  // If the candidate already has the authoritative simulation, return it
  if (candidate.simulation) {
    return candidate.simulation
  }

  return candidate.simulation
}
