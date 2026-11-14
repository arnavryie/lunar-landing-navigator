import type { Tracks } from '../../engine.ts'
import type {
  CandidateFeasibility,
  RechargeCandidate,
  RoverMissionConfig,
  SimulationRunResult,
  SimulationStepTelemetry,
} from '../types.ts'
import { calculateSolarOutputWatts } from './solarModel.ts'

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
  const startUtcMs = Date.parse('2027-01-01T00:00:00Z') + startHourIndex * 3600000

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

      transitMobilityKwh += stepMobilityEnergyKwh
      transitHotelKwh += stepHotelEnergyKwh
      transitSolarKwh += stepSolarEnergyKwh
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

      transitMobilityKwh += transitMobKwh
      transitHotelKwh += transitHotKwh
      transitSolarKwh += transitSolKwh

      // Capture EXACT arrival battery state at the transition moment
      if (!arrivalRecorded) {
        const netTransitDelta = transitSolKwh - (transitMobKwh + transitHotKwh)
        arrivalBatteryKwh = Math.max(0, Math.min(batteryCapKwh, currentBatteryKwh + netTransitDelta))
        arrivalSocPct = (arrivalBatteryKwh / batteryCapKwh) * 100
        arrivalRecorded = true
      }

      // Recharge at destination during the stationary portion
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

      stepMobilityEnergyKwh = transitMobKwh
      stepHotelEnergyKwh = transitHotKwh + rechargeHotKwh
      stepSolarEnergyKwh = transitSolKwh + rechargeSolKwh
    } else {
      // 3. Rover is STATIONARY at destination
      if (!arrivalRecorded) {
        arrivalBatteryKwh = currentBatteryKwh
        arrivalSocPct = (arrivalBatteryKwh / batteryCapKwh) * 100
        arrivalRecorded = true
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
    }

    // Step Energy Balance
    totalSolarGeneratedKwh += stepSolarEnergyKwh
    totalHotelEnergyKwh += stepHotelEnergyKwh
    totalMobilityEnergyKwh += stepMobilityEnergyKwh

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

  const finalBatteryKwh = currentBatteryKwh
  const finalSocPct = (finalBatteryKwh / batteryCapKwh) * 100

  // Recharge phase net calculations
  const rechargePotentialNetKwh = rechargeSolarKwh - rechargeHotelKwh
  const rechargeStoredEnergyKwh = Math.max(0, finalBatteryKwh - arrivalBatteryKwh)

  // Net Mission Energy Benefit
  const netStoredEnergyRecoveredKwh = finalBatteryKwh - arrivalBatteryKwh
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

  // Feasibility evaluation
  const arrivalReserveMarginPct = arrivalSocPct - minReservePct
  let feasibility: CandidateFeasibility = 'FEASIBLE'
  let recommendationVerdict: SimulationRunResult['recommendationVerdict'] = 'RECOMMENDED'
  let verdictReason = ''

  if (minSocReachedPct <= 0.05 || arrivalSocPct < minReservePct - 1.0) {
    feasibility = 'INFEASIBLE'
    recommendationVerdict = 'INSUFFICIENT ENERGY'
    verdictReason = `Battery exhausts during mission (min ${minSocReachedPct.toFixed(1)}% SoC, arrival ${arrivalSocPct.toFixed(1)}%), breaching the ${minReservePct.toFixed(0)}% safety reserve threshold.`
  } else if (arrivalReserveMarginPct < 2.0 || route.maxSlopeDeg > 18.0) {
    feasibility = 'CAUTION'
    recommendationVerdict = 'FEASIBLE WITH CAUTION'
    verdictReason = `Reachable with caution: narrow reserve margin (${arrivalReserveMarginPct >= 0 ? '+' : ''}${arrivalReserveMarginPct.toFixed(1)}%) or steep traversal slopes (max ${route.maxSlopeDeg.toFixed(1)}°).`
  } else if (netMissionEnergyBenefitKwh <= 0.2) {
    feasibility = 'CAUTION'
    recommendationVerdict = 'FEASIBLE WITH CAUTION'
    verdictReason = `Reachable safely, but yields minimal net energy benefit (+${netMissionEnergyBenefitKwh.toFixed(2)} kWh) due to short illumination window or hotel consumption.`
  } else {
    feasibility = 'FEASIBLE'
    recommendationVerdict = 'RECOMMENDED'
    verdictReason = `Optimal recharge opportunity: ${candidate.sunlitWindowDurationH}h continuous sunlight, recovering +${rechargeStoredEnergyKwh.toFixed(2)} kWh stored battery energy (+${netMissionEnergyBenefitKwh.toFixed(2)} kWh net mission benefit) with safe +${arrivalReserveMarginPct.toFixed(1)}% arrival reserve buffer.`
  }

  const missionSuccessful =
    minSocReachedPct >= minReservePct &&
    netMissionEnergyBenefitKwh > 0 &&
    feasibility !== 'INFEASIBLE'

  let summaryVerdict = ''
  if (missionSuccessful) {
    summaryVerdict = `Mission Nominal: Relocated ${route.totalDistanceKm.toFixed(2)} km to ${candidate.name}. Battery replenished from ${departureSocPct.toFixed(0)}% to ${finalSocPct.toFixed(0)}% (+${netMissionEnergyBenefitKwh.toFixed(2)} kWh net mission gain).`
  } else if (minSocReachedPct < minReservePct) {
    summaryVerdict = `Reserve Constraint Violation: Battery dropped to ${minSocReachedPct.toFixed(1)}% SoC, breaching the ${minReservePct.toFixed(0)}% reserve threshold.`
  } else {
    summaryVerdict = `Energy Stagnation: Solar replenishment did not offset mission consumption, resulting in negative net benefit.`
  }

  return {
    candidateId: candidate.id,
    candidateName: candidate.name,
    steps,
    totalDurationH: totalSimHours,
    initialBatteryKwh,
    departureSocPct,

    transitDurationH: travelDurationH,
    transitDistanceKm: route.totalDistanceKm,
    transitMobilityEnergyKwh: transitMobilityKwh,
    transitHotelEnergyKwh: transitHotelKwh,
    transitSolarGeneratedKwh: transitSolarKwh,
    transitCurtailedEnergyKwh: transitCurtailedKwh,
    transitNetExpenditureKwh,

    arrivalBatteryKwh,
    arrivalSocPct,
    arrivalReserveMarginPct,

    rechargeDurationH: candidate.sunlitWindowDurationH,
    rechargeSolarGeneratedKwh: rechargeSolarKwh,
    rechargeHotelEnergyKwh: rechargeHotelKwh,
    rechargePotentialNetKwh,
    rechargeStoredEnergyKwh,
    rechargeCurtailedSolarKwh: rechargeCurtailedKwh,

    postRechargeDurationH: Math.max(0, totalSimHours - (travelDurationH + candidate.sunlitWindowDurationH)),
    postRechargeSolarGeneratedKwh: postRechargeSolarKwh,
    postRechargeHotelEnergyKwh: postRechargeHotelKwh,
    postRechargeStoredEnergyKwh: Math.max(0, finalBatteryKwh - (arrivalBatteryKwh + rechargeStoredEnergyKwh)),
    postRechargeCurtailedSolarKwh: postRechargeCurtailedKwh,

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
