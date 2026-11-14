// Lunar Solar Recharge Planner — Data Types and Configuration Interfaces

export interface RoverBatteryConfig {
  totalCapacityKwh: number     // Nameplate battery capacity (kWh), e.g. 15.0
  currentSocPct: number        // Current state of charge (0-100%), e.g. 40.0
  minReservePct: number        // Minimum emergency reserve threshold (%), e.g. 20.0
}

export interface RoverSolarConfig {
  ratedOutputW: number         // Nameplate solar array output (W), e.g. 450
  efficiencyPct: number        // Panel cell efficiency (%), e.g. 28.0
  panelTiltDeg: number         // Panel tilt from horizontal (deg, 90 = vertical for polar sun), e.g. 80.0
  panelAzimuthDeg: number      // Panel relative azimuth (0 = omni/tracking, 0-360 = fixed direction), default 0 (sun-tracking)
  trackingMode: 'sun_tracking' | 'fixed_vertical' | 'fixed_tilt'
  dustDegradationFactor: number // Dust/radiation derating (0.5 - 1.0), e.g. 0.95
}

export interface RoverPowerConfig {
  thermalManagementW: number   // Thermal heaters / cold survival (W), e.g. 75
  avionicsW: number            // Guidance, navigation, computers (W), e.g. 40
  communicationsW: number      // RF comms (W), e.g. 25
  scienceInstrumentsW: number  // Payload / spectrometers / drills (W), e.g. 30
  standbySystemsW: number      // Quiescent hotel load (W), e.g. 15
}

export interface RoverMobilityConfig {
  speedKmh: number             // Average ground traverse speed (km/h), e.g. 0.15 (~4.2 cm/s)
  mobilityPowerW: number       // Drive locomotion actuator power (W), e.g. 180
  terrainFactor: number        // Regolith rolling resistance / sinkage multiplier (1.0 - 2.5), e.g. 1.25
  maxTravelDistanceKm: number  // Maximum single-sortie range constraint (km), e.g. 5.0
}

export interface MissionLocationConfig {
  startLat: number             // Rover starting latitude (deg S), e.g. -89.475
  startLon: number             // Rover starting east longitude (deg), e.g. 222.56
  startHourIndex: number       // Simulation start hour index in 2027 (0 - 8759)
  searchRadiusKm: number       // Radius to discover candidate recharge sites (km), e.g. 3.0
  planningHorizonH: number     // Forward simulation planning window (hours), e.g. 96
}

export interface RoverMissionConfig {
  battery: RoverBatteryConfig
  solar: RoverSolarConfig
  power: RoverPowerConfig
  mobility: RoverMobilityConfig
  mission: MissionLocationConfig
}

export interface Waypoint {
  lat: number
  lon: number
  elevationM: number
  slopeDeg: number
  distanceFromStartKm: number
  legDistanceKm: number
  isSunlit: boolean
  sunFrac: number
}

export interface RouteProfile {
  totalDistanceKm: number
  estimatedTravelTimeH: number
  departureHourIndex: number
  arrivalHourIndex: number
  waypoints: Waypoint[]
  maxSlopeDeg: number
  averageSlopeDeg: number
  elevationGainM: number
  elevationLossM: number
  mobilityEnergyGrossKwh: number
  transitHotelEnergyKwh: number
  transitSolarEnergyRecoveredKwh: number
  netTransitEnergyKwh: number
  arrivalEnergyKwh: number
  arrivalSocPct: number
  isSafeTraverse: boolean
}

export type CandidateFeasibility = 'FEASIBLE' | 'CAUTION' | 'INFEASIBLE'

export interface SimulationStepTelemetry {
  hourIndex: number
  stepTimeH: number
  utcDateStr: string
  phase: 'standby' | 'transit' | 'recharge' | 'post_recharge'
  phaseLabel: string
  roverLat: number
  roverLon: number
  roverElevM: number
  sunElevationDeg: number
  sunAzimuthDeg: number
  isDirectSunlit: boolean
  sunFraction: number
  solarGenerationW: number
  locomotionDrawW: number
  hotelDrawW: number
  netPowerW: number
  curtailedPowerW: number
  storedEnergyKwh: number
  socPct: number
  distanceCoveredKm: number
}

export interface SimulationRunResult {
  candidateId: string
  candidateName: string
  steps: SimulationStepTelemetry[]
  totalDurationH: number

  // Authoritative Energy Ledger (all in kWh)
  initialBatteryKwh: number
  departureSocPct: number

  // Transit Phase
  transitDurationH: number
  transitDistanceKm: number
  transitMobilityEnergyKwh: number
  transitHotelEnergyKwh: number
  transitSolarGeneratedKwh: number
  transitCurtailedEnergyKwh: number
  transitNetExpenditureKwh: number // (mobility + hotel - solar - curtailed)

  // Arrival State
  arrivalBatteryKwh: number
  arrivalSocPct: number
  arrivalReserveMarginPct: number // arrivalSocPct - minReservePct

  // Recharge Phase
  rechargeDurationH: number
  rechargeSolarGeneratedKwh: number
  rechargeHotelEnergyKwh: number
  rechargePotentialNetKwh: number // solarGenerated - hotelEnergy
  rechargeStoredEnergyKwh: number // actual kWh added to battery during recharge
  rechargeCurtailedSolarKwh: number // excess solar energy once battery reached 100%

  // Post-Recharge Phase
  postRechargeDurationH: number
  postRechargeSolarGeneratedKwh: number
  postRechargeHotelEnergyKwh: number
  postRechargeStoredEnergyKwh: number
  postRechargeCurtailedSolarKwh: number

  // Final Mission State
  finalBatteryKwh: number
  finalSocPct: number
  minBatteryKwh: number
  minSocReachedPct: number

  // Mission Totals
  totalSolarGeneratedKwh: number
  totalHotelEnergyKwh: number
  totalMobilityEnergyKwh: number
  totalCurtailedSolarKwh: number
  netStoredEnergyRecoveredKwh: number // finalBatteryKwh - arrivalBatteryKwh
  netMissionEnergyBenefitKwh: number // finalBatteryKwh - initialBatteryKwh

  // Mathematical Reconciliation Check: final === initial + solar - hotel - mobility - curtailed
  reconciliationDeltaKwh: number
  isEnergyConserved: boolean

  // Operational Verdicts
  missionSuccessful: boolean
  feasibility: CandidateFeasibility
  recommendationVerdict: 'RECOMMENDED' | 'FEASIBLE WITH CAUTION' | 'INSUFFICIENT ENERGY' | 'NO SUITABLE RECHARGE LOCATION FOUND'
  verdictReason: string
  summaryVerdict: string
}

export interface RechargeCandidate {
  id: string
  name: string
  lat: number
  lon: number
  elevationM: number
  slopeDeg: number
  distanceKm: number
  bearingDeg: number
  cardinalDirection: string
  
  // Illumination metrics
  isCurrentlySunlit: boolean
  hoursToSunrise: number
  sunlitWindowDurationH: number
  sunlitWindowStartH: number
  sunlitWindowEndH: number
  totalSunlitHoursInHorizon: number
  meanSunElevationDeg: number
  
  // Route profile
  route: RouteProfile

  // Authoritative continuous mission simulation result
  simulation: SimulationRunResult

  // Summary shortcuts (mirrored from simulation for quick access)
  rechargePowerNetW: number
  solarGenerationKwh: number
  hotelLoadDuringRechargeKwh: number
  curtailedSolarKwh: number
  netEnergyRecoveredKwh: number
  netMissionBenefitKwh: number
  arrivalSocPct: number
  finalSocPct: number
  
  // Ranking
  feasibility: CandidateFeasibility
  rankingScore: number
  rankingRank: number
  recommendationVerdict: 'RECOMMENDED' | 'FEASIBLE WITH CAUTION' | 'INSUFFICIENT ENERGY' | 'NO SUITABLE RECHARGE LOCATION FOUND'
  verdictReason: string
}

export const DEFAULT_ROVER_CONFIG: RoverMissionConfig = {
  battery: {
    totalCapacityKwh: 15.0,
    currentSocPct: 38.0, // Depleted rover seeking recharge
    minReservePct: 20.0,
  },
  solar: {
    ratedOutputW: 480,
    efficiencyPct: 28.5,
    panelTiltDeg: 80.0, // Steeply tilted for polar low-horizon sun
    panelAzimuthDeg: 0,
    trackingMode: 'sun_tracking',
    dustDegradationFactor: 0.95,
  },
  power: {
    thermalManagementW: 75,
    avionicsW: 40,
    communicationsW: 25,
    scienceInstrumentsW: 30,
    standbySystemsW: 15,
  },
  mobility: {
    speedKmh: 0.15, // ~4.2 cm/sec nominal traverse speed
    mobilityPowerW: 180,
    terrainFactor: 1.25,
    maxTravelDistanceKm: 6.0,
  },
  mission: {
    startLat: -89.4749, // Best-lit ridge near Shackleton
    startLon: 222.557,
    startHourIndex: 50,
    searchRadiusKm: 3.5,
    planningHorizonH: 96,
  },
}
