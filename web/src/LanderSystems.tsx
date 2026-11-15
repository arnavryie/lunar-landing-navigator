import { useEffect, useMemo, useRef, useState } from 'react'
import type { Site } from './data.ts'
import './styles/lander.css'
import {
  DEFAULT_ROVER_CONFIG,
  type RoverMissionConfig,
} from './lander/types.ts'
import { loadPlannerDataset, type PlannerDataset } from './lander/engine/mapLoader.ts'
import { discoverAndRankCandidates } from './lander/engine/candidateFinder.ts'
import { runMissionSimulation } from './lander/engine/energyModel.ts'
import { RoverConfiguration } from './lander/components/RoverConfiguration.tsx'
import { IlluminationMap } from './lander/components/IlluminationMap.tsx'
import { SimulationControls } from './lander/components/SimulationControls.tsx'
import { RechargeRecommendation } from './lander/components/RechargeRecommendation.tsx'
import { CandidateLocations } from './lander/components/CandidateLocations.tsx'
import { MissionTimeline } from './lander/components/MissionTimeline.tsx'
import { MethodologySection } from './lander/components/MethodologySection.tsx'

interface LanderSystemsProps {
  site?: Site | null
  i?: number
  year?: number // Any landing year
  vectors?: Float32Array | null // that year's Sun/Earth vectors
}

export function LanderSystems({ site, i, year = 2027, vectors }: LanderSystemsProps) {
  const [baseConfig, setConfig] = useState<RoverMissionConfig>(() => {
    // If a site is active from App, use its coordinates
    if (site && site.lat <= -84) {
      return {
        ...DEFAULT_ROVER_CONFIG,
        mission: {
          ...DEFAULT_ROVER_CONFIG.mission,
          startLat: site.lat,
          startLon: site.lon > 180 ? site.lon - 360 : site.lon,
          startHourIndex: typeof i === 'number' ? i : 50,
        },
      }
    }
    return DEFAULT_ROVER_CONFIG
  })

  const [baseDataset, setDataset] = useState<PlannerDataset | null>(null)
  // Any landing year: the simulation runs on the chosen year's vectors and dates.
  const yearStartUtc = `${year}-01-01T00:00:00Z`
  const config = useMemo(() => ({ ...baseConfig, mission: { ...baseConfig.mission, yearStartUtc } }), [baseConfig, yearStartUtc])
  const dataset = useMemo(() => (baseDataset && vectors ? { ...baseDataset, vectors } : baseDataset), [baseDataset, vectors])
  const [dataError, setDataError] = useState<string>('')
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)

  // Simulation playback state
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(6) // hours per tick
  const [currentSimOffsetH, setCurrentSimOffsetH] = useState(0)

  // Load the planner dataset
  useEffect(() => {
    loadPlannerDataset()
      .then(setDataset)
      .catch((err) => setDataError(String(err.message || err)))
  }, [])

  const prevSiteIdRef = useRef<string | undefined>(site?.id)
  useEffect(() => {
    if (site && site.id !== prevSiteIdRef.current && site.lat <= -84) {
      prevSiteIdRef.current = site.id
      setConfig((prev) => ({
        ...prev,
        mission: {
          ...prev.mission,
          startLat: site.lat,
          startLon: site.lon > 180 ? site.lon - 360 : site.lon,
        },
      }))
    }
  }, [site])

  const handleResetConfig = () => {
    setConfig(DEFAULT_ROVER_CONFIG)
    setSelectedCandidateId(null)
    setCurrentSimOffsetH(0)
    setIsPlaying(false)
  }

  // Candidate discovery & ranking computation
  const { candidates, recommended } = useMemo(() => {
    if (!dataset) return { candidates: [], recommended: null }
    return discoverAndRankCandidates(config, dataset)
  }, [config, dataset])

  // Active target candidate (either selected or top recommended)
  const activeCandidate = useMemo(() => {
    if (!candidates || candidates.length === 0) return null
    if (selectedCandidateId) {
      const match = candidates.find((c) => c.id === selectedCandidateId)
      if (match) return match
    }
    return recommended
  }, [candidates, selectedCandidateId, recommended])

  // Continuous mission energy simulation run
  const simulationResult = useMemo(() => {
    if (!dataset || !activeCandidate) return null
    return runMissionSimulation(config, activeCandidate, dataset.vectors)
  }, [config, activeCandidate, dataset])

  // Current simulation step telemetry
  const currentStepTelemetry = useMemo(() => {
    if (!simulationResult || simulationResult.steps.length === 0) return null
    const idx = Math.min(currentSimOffsetH, simulationResult.steps.length - 1)
    return simulationResult.steps[idx]
  }, [simulationResult, currentSimOffsetH])

  const currentAbsoluteHourIndex = config.mission.startHourIndex + currentSimOffsetH

  // Playback timer loop
  useEffect(() => {
    if (!isPlaying || !simulationResult) return
    const interval = setInterval(() => {
      setCurrentSimOffsetH((prev) => {
        const next = prev + playbackSpeed
        if (next >= simulationResult.totalDurationH) {
          setIsPlaying(false)
          return simulationResult.totalDurationH
        }
        return next
      })
    }, 150)
    return () => clearInterval(interval)
  }, [isPlaying, playbackSpeed, simulationResult])

  const handlePickRoverLocation = (lat: number, lon: number) => {
    setConfig((prev) => ({
      ...prev,
      mission: {
        ...prev.mission,
        startLat: lat,
        startLon: lon,
      },
    }))
    setCurrentSimOffsetH(0)
    setIsPlaying(false)
  }

  return (
    <div className="planner-page" aria-label="Lunar Rover Solar Recharge Planner">
      {/* 1. Page Header & Technical Identity */}
      <header className="planner-header">
        <div className="planner-title-row">
          <h2>
            Lander systems: solar recharge planner
          </h2>
          <div className="planner-actions">
            {site && (
              <span className="pill" style={{ color: 'var(--text)' }}>
                Active Site: <strong>{site.name}</strong>
              </span>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={handleResetConfig}
              title="Reset rover and mission configuration to default parameters"
            >
              Reset configuration
            </button>
          </div>
        </div>

        {/* Prominent Required Disclaimer */}
        <div className="disclaimer-banner" role="region" aria-label="Simulation Disclaimer">
          <span className="icon" aria-hidden="true">ℹ</span>
          <div>
            <strong>Illustrative demonstration configuration — not representative of a specific spacecraft.</strong>{' '}
            This engineering system analyzes time-dependent lunar surface solar illumination, kinematic traverse energy,
            and solar panel replenishment dynamics. Real slopes at rover wheelbase scale (1–2 m) are steeper than regional 240 m averages.
          </div>
        </div>

        {/* 2. Top Mission Status Indicators (HUD) */}
        <div className="mission-hud" role="region" aria-label="Mission Energy Status Telemetry">
          <div className="hud-item">
            <span className="hud-label">Rover stored energy</span>
            <span className="hud-value">
              {currentStepTelemetry
                ? currentStepTelemetry.storedEnergyKwh.toFixed(1)
                : ((config.battery.totalCapacityKwh * config.battery.currentSocPct) / 100).toFixed(1)}{' '}
              <span className="hud-unit">kWh</span>
            </span>
            <span
              className="hud-sub"
              style={{
                color:
                  (currentStepTelemetry?.socPct ?? config.battery.currentSocPct) >= config.battery.minReservePct
                    ? '#6fcf9f'
                    : '#f08a7a',
              }}
            >
              {(currentStepTelemetry?.socPct ?? config.battery.currentSocPct).toFixed(1)}% SoC (Min {config.battery.minReservePct.toFixed(0)}%)
            </span>
          </div>

          <div className="hud-item">
            <span className="hud-label">Current illumination</span>
            <span
              className="hud-value"
              style={{
                color: currentStepTelemetry?.isDirectSunlit ? 'var(--sun)' : 'var(--muted)',
              }}
            >
              {currentStepTelemetry?.isDirectSunlit ? 'Direct Sunlight' : 'Cold Shadow'}
            </span>
            <span className="hud-sub">
              Sun El: {currentStepTelemetry?.sunElevationDeg.toFixed(1) ?? '1.2'}° (Frac: {Math.round((currentStepTelemetry?.sunFraction ?? 0) * 100)}%)
            </span>
          </div>

          <div className="hud-item">
            <span className="hud-label">Next sunlight opportunity</span>
            <span className="hud-value" style={{ color: 'var(--sun)' }}>
              {activeCandidate ? `${activeCandidate.sunlitWindowDurationH} h Window` : 'Searching...'}
            </span>
            <span className="hud-sub">
              {activeCandidate?.hoursToSunrise === 0
                ? 'Illuminated at arrival'
                : `Sunrise in ${activeCandidate?.hoursToSunrise ?? 0}h`}
            </span>
          </div>

          <div className="hud-item">
            <span className="hud-label">Recharge feasibility</span>
            <div style={{ marginTop: '4px' }}>
              <span
                className={`hud-badge ${
                  activeCandidate?.feasibility === 'FEASIBLE'
                    ? 'nominal'
                    : activeCandidate?.feasibility === 'CAUTION'
                    ? 'caution'
                    : 'infeasible'
                }`}
              >
                {activeCandidate?.feasibility ?? 'EVALUATING'}
              </span>
            </div>
            <span className="hud-sub" style={{ fontSize: '0.74rem', marginTop: '2px' }}>
              {activeCandidate?.recommendationVerdict ?? 'Computing candidates...'}
            </span>
          </div>
        </div>
      </header>

      {/* 3. Rover and Mission Configuration Panel */}
      <RoverConfiguration
        config={config}
        onChange={setConfig}
        onReset={handleResetConfig}
      />

      {dataError && <p className="error">{dataError}</p>}
      {!dataset && !dataError && <p className="loading">Loading NASA LOLA terrain and ephemeris maps...</p>}

      {dataset && (
        <>
          {/* 4. Centrepiece Interactive Lunar Illumination Map */}
          <IlluminationMap
            dataset={dataset}
            config={config}
            recommendedCandidate={recommended}
            candidateList={candidates}
            selectedCandidateId={selectedCandidateId}
            onSelectCandidate={setSelectedCandidateId}
            currentSimulationStep={currentStepTelemetry}
            currentHourIndex={currentAbsoluteHourIndex}
            onPickRoverLocation={handlePickRoverLocation}
          />

          {/* 5. Simulation Playback Controls Bar */}
          <SimulationControls
            currentHourIndex={currentAbsoluteHourIndex}
            startHourIndex={config.mission.startHourIndex}
            yearStartUtc={yearStartUtc}
            totalSimulationHours={simulationResult?.totalDurationH ?? 96}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            currentStepTelemetry={currentStepTelemetry}
            onPlayToggle={() => setIsPlaying(!isPlaying)}
            onSpeedChange={setPlaybackSpeed}
            onStepChange={setCurrentSimOffsetH}
            onReset={() => {
              setIsPlaying(false)
              setCurrentSimOffsetH(0)
            }}
          />

          {/* 6. Two-Column Split: Primary Recommendation & Candidate Ranking */}
          <div className="planner-two-col">
            <RechargeRecommendation
              candidate={activeCandidate}
              config={config}
              alternativeCandidates={candidates}
              onSelectCandidate={setSelectedCandidateId}
            />

            <CandidateLocations
              candidates={candidates}
              selectedCandidateId={selectedCandidateId}
              recommendedCandidateId={recommended?.id || null}
              onSelectCandidate={setSelectedCandidateId}
            />
          </div>

          {/* 7. Mission Illumination & Battery Energy Progression Profile */}
          {simulationResult && (
            <MissionTimeline
              telemetrySteps={simulationResult.steps}
              minReservePct={config.battery.minReservePct}
              totalCapacityKwh={config.battery.totalCapacityKwh}
              currentStepIndex={currentSimOffsetH}
              onSeekStep={setCurrentSimOffsetH}
            />
          )}

          {/* 8. Scientific Methodology, Provenance & Caveats */}
          <MethodologySection />
        </>
      )}
    </div>
  )
}
