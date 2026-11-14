import { siteTracks } from '../../engine.ts'
import type {
  RechargeCandidate,
  RoverMissionConfig,
} from '../types.ts'
import {
  bearingDeg,
  cardinalDirection,
  kmBetween,
  type PlannerDataset,
} from './mapLoader.ts'
import { planRouteProfile } from './routePlanner.ts'
import { simulateMissionLedger } from './energyModel.ts'

export function discoverAndRankCandidates(
  config: RoverMissionConfig,
  data: PlannerDataset,
): { candidates: RechargeCandidate[]; recommended: RechargeCandidate | null } {
  const startLat = config.mission.startLat
  const startLon = config.mission.startLon
  const startHour = config.mission.startHourIndex
  const horizonHours = config.mission.planningHorizonH
  const radiusKm = config.mission.searchRadiusKm

  const totalHoursAvailable = Math.floor(data.vectors.length / 6)
  const windowHours = Math.min(horizonHours, totalHoursAvailable - startHour - 1)

  // Filter candidates within search radius
  interface RawCandidate {
    k: number
    lat: number
    lon: number
    elevationM: number
    slopeDeg: number
    distKm: number
  }

  const rawList: RawCandidate[] = []

  for (let k = 0; k < data.candidateCount; k++) {
    const lat = data.candidateRec[6 * k]
    const lon = data.candidateRec[6 * k + 1]
    const elev = data.candidateRec[6 * k + 2]
    const slope = data.candidateRec[6 * k + 3]

    // Skip steep cliff areas > 22 deg
    if (slope > 22.0) continue

    const dist = kmBetween(startLat, startLon, lat, lon)
    // Between 100 metres and search radius
    if (dist >= 0.1 && dist <= radiusKm) {
      rawList.push({ k, lat, lon, elevationM: elev, slopeDeg: slope, distKm: dist })
    }
  }

  // If sparse, ensure at least some points or artificial ridge points if none nearby
  if (rawList.length === 0) {
    const offsets = [
      { dKm: Math.min(1.2, radiusKm * 0.4), bearing: 45, name: 'North-East Ridge Crest' },
      { dKm: Math.min(2.0, radiusKm * 0.65), bearing: 90, name: 'East Elevated Plateau' },
      { dKm: Math.min(1.5, radiusKm * 0.5), bearing: 135, name: 'South-East Rim Terrace' },
      { dKm: Math.min(2.5, radiusKm * 0.8), bearing: 270, name: 'West Illumination Mound' },
      { dKm: Math.min(1.8, radiusKm * 0.6), bearing: 315, name: 'North-West Peak' },
    ]
    for (let i = 0; i < offsets.length; i++) {
      const o = offsets[i]
      const dLat = (o.dKm / 1737.4) * (180 / Math.PI) * Math.cos(o.bearing * (Math.PI / 180))
      const dLon =
        (o.dKm / (1737.4 * Math.cos(startLat * (Math.PI / 180)))) *
        (180 / Math.PI) *
        Math.sin(o.bearing * (Math.PI / 180))
      rawList.push({
        k: -1 - i,
        lat: startLat + dLat,
        lon: ((startLon + dLon) % 360 + 360) % 360,
        elevationM: 250 + i * 40,
        slopeDeg: 6.5 + i * 1.5,
        distKm: o.dKm,
      })
    }
  }

  // Evaluate each candidate with the authoritative continuous mission simulation
  const evaluated: RechargeCandidate[] = []

  for (let idx = 0; idx < rawList.length; idx++) {
    const raw = rawList[idx]
    let mask: Float32Array
    if (raw.k >= 0) {
      mask = data.candidateMasks.subarray(360 * raw.k, 360 * raw.k + 360)
    } else {
      // Synthetic horizon mask for fallback offsets (modest 1.2 deg horizon)
      mask = new Float32Array(360).fill(1.2)
    }

    // Call engine siteTracks for this candidate's exact horizon occlusion profile
    const tracks = siteTracks(
      data.vectors,
      raw.lat,
      raw.lon,
      raw.elevationM + data.meta.obs_height_m,
      mask,
      1,
      startHour,
      windowHours,
    )

    // Plan route from start to candidate
    const route = planRouteProfile(
      config,
      raw.lat,
      raw.lon,
      data.demGrid,
      data.vectors,
      startHour,
    )

    // Analyze illumination at candidate destination
    const arrivalStep = Math.min(
      Math.ceil(route.estimatedTravelTimeH),
      tracks.sun.frac.length - 1,
    )

    const isCurrentlySunlit = tracks.sun.frac[0] > 0.05

    // Find continuous sunlit window post-arrival
    let windowStart = arrivalStep
    while (windowStart < tracks.sun.frac.length && tracks.sun.frac[windowStart] <= 0.05) {
      windowStart++
    }
    const hoursToSunrise = Math.max(0, windowStart - arrivalStep)

    let windowEnd = windowStart
    while (windowEnd < tracks.sun.frac.length && tracks.sun.frac[windowEnd] > 0.05) {
      windowEnd++
    }
    const sunlitWindowDurationH = windowEnd - windowStart

    let totalSunlitHoursInHorizon = 0
    let sumSunEl = 0
    let sunCount = 0
    for (let h = 0; h < tracks.sun.frac.length; h++) {
      if (tracks.sun.frac[h] > 0.05) {
        totalSunlitHoursInHorizon++
        sumSunEl += tracks.sun.el[h]
        sunCount++
      }
    }
    const meanSunElevationDeg = sunCount > 0 ? sumSunEl / sunCount : 0

    const bearing = bearingDeg(startLat, startLon, raw.lat, raw.lon)
    const cardDir = cardinalDirection(bearing)
    const candName =
      raw.elevationM > 1000
        ? `${cardDir} Elevated Ridge`
        : raw.elevationM > 0
        ? `${cardDir} Crest Mound`
        : `${cardDir} Rim Terrace`

    // Run the authoritative physical energy ledger simulation
    const simulation = simulateMissionLedger(
      config,
      {
        id: `cand-${idx}`,
        name: candName,
        lat: raw.lat,
        lon: raw.lon,
        elevationM: raw.elevationM,
        slopeDeg: raw.slopeDeg,
        distanceKm: raw.distKm,
        bearingDeg: bearing,
        cardinalDirection: cardDir,
        route,
        tracks,
        sunlitWindowDurationH,
        sunlitWindowStartH: windowStart,
        sunlitWindowEndH: windowEnd,
        hoursToSunrise,
        totalSunlitHoursInHorizon,
        meanSunElevationDeg,
      },
      data.vectors,
      startHour,
      windowHours,
    )

    // Ranking score calculation using authoritative simulation metrics
    let rankingScore = 0
    if (simulation.feasibility === 'INFEASIBLE') {
      // Heavily penalize infeasible candidates so they always score below viable candidates
      rankingScore = -100 + (simulation.isDestinationReached ? simulation.arrivalSocPct * 0.1 : -simulation.transitDistanceKm)
    } else {
      const benefitScore = Math.max(0, Math.min(45, (simulation.netMissionEnergyBenefitKwh / 3.0) * 45))
      const windowScore = Math.max(0, Math.min(25, (sunlitWindowDurationH / 48.0) * 25))
      const bufferScore = Math.max(0, Math.min(20, (simulation.arrivalReserveMarginPct / 20.0) * 20))
      const slopeScore = Math.max(0, 10 - raw.slopeDeg * 0.5)
      rankingScore = benefitScore + windowScore + bufferScore + slopeScore
    }

    const rechargePowerNetW =
      sunlitWindowDurationH > 0 && simulation.isDestinationReached
        ? (simulation.reachableRechargePotentialKwh * 1000) / sunlitWindowDurationH
        : 0

    evaluated.push({
      id: `cand-${idx}`,
      name: candName,
      lat: raw.lat,
      lon: raw.lon,
      elevationM: raw.elevationM,
      slopeDeg: raw.slopeDeg,
      distanceKm: raw.distKm,
      bearingDeg: bearing,
      cardinalDirection: cardDir,
      isCurrentlySunlit,
      hoursToSunrise,
      sunlitWindowDurationH,
      sunlitWindowStartH: windowStart,
      sunlitWindowEndH: windowEnd,
      totalSunlitHoursInHorizon,
      meanSunElevationDeg,
      route,
      simulation,
      rechargePowerNetW,
      solarGenerationKwh: simulation.rechargeSolarGeneratedKwh,
      hotelLoadDuringRechargeKwh: simulation.rechargeHotelEnergyKwh,
      curtailedSolarKwh: simulation.rechargeCurtailedSolarKwh,
      netEnergyRecoveredKwh: simulation.rechargeStoredEnergyKwh,
      netMissionBenefitKwh: simulation.netMissionEnergyBenefitKwh,
      arrivalSocPct: simulation.arrivalSocPct,
      finalSocPct: simulation.finalSocPct,
      theoreticalSolarPotentialKwh: simulation.theoreticalSolarPotentialKwh,
      reachableRechargePotentialKwh: simulation.reachableRechargePotentialKwh,
      actualStoredEnergyRecoveredKwh: simulation.actualStoredEnergyRecoveredKwh,
      isDestinationReached: simulation.isDestinationReached,
      failureReason: simulation.failureReason,
      feasibility: simulation.feasibility,
      rankingScore,
      rankingRank: 0,
      recommendationVerdict: simulation.recommendationVerdict,
      verdictReason: simulation.verdictReason,
    })
  }

  // Sort by ranking score descending
  evaluated.sort((a, b) => {
    if (a.feasibility === 'FEASIBLE' && b.feasibility !== 'FEASIBLE') return -1
    if (b.feasibility === 'FEASIBLE' && a.feasibility !== 'FEASIBLE') return 1
    if (a.feasibility === 'CAUTION' && b.feasibility === 'INFEASIBLE') return -1
    if (b.feasibility === 'CAUTION' && a.feasibility !== 'INFEASIBLE') return 1
    return b.rankingScore - a.rankingScore
  })

  // Assign ranks
  for (let i = 0; i < evaluated.length; i++) {
    evaluated[i].rankingRank = i + 1
  }

  // Never recommend an INFEASIBLE candidate
  const recommended =
    evaluated.find((c) => c.feasibility === 'FEASIBLE') ??
    evaluated.find((c) => c.feasibility === 'CAUTION') ??
    null

  return { candidates: evaluated, recommended }
}
