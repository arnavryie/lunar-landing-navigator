import { useState } from 'react'
import type { RoverMissionConfig } from '../types.ts'

interface RoverConfigurationProps {
  config: RoverMissionConfig
  onChange: (cfg: RoverMissionConfig) => void
  onReset: () => void
}

export function RoverConfiguration({ config, onChange, onReset }: RoverConfigurationProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState('viper')

  const updateBattery = <K extends keyof RoverMissionConfig['battery']>(k: K, v: RoverMissionConfig['battery'][K]) => {
    onChange({ ...config, battery: { ...config.battery, [k]: v } })
  }

  const updateSolar = <K extends keyof RoverMissionConfig['solar']>(k: K, v: RoverMissionConfig['solar'][K]) => {
    onChange({ ...config, solar: { ...config.solar, [k]: v } })
  }

  const updatePower = <K extends keyof RoverMissionConfig['power']>(k: K, v: RoverMissionConfig['power'][K]) => {
    onChange({ ...config, power: { ...config.power, [k]: v } })
  }

  const updateMobility = <K extends keyof RoverMissionConfig['mobility']>(k: K, v: RoverMissionConfig['mobility'][K]) => {
    onChange({ ...config, mobility: { ...config.mobility, [k]: v } })
  }

  const updateMission = <K extends keyof RoverMissionConfig['mission']>(k: K, v: RoverMissionConfig['mission'][K]) => {
    onChange({ ...config, mission: { ...config.mission, [k]: v } })
  }

  const handlePreset = (p: string) => {
    setSelectedPreset(p)
    if (p === 'viper') {
      onChange({
        ...config,
        battery: { totalCapacityKwh: 14.0, currentSocPct: 35.0, minReservePct: 20.0 },
        solar: {
          ratedOutputW: 450,
          efficiencyPct: 28.5,
          panelTiltDeg: 80.0,
          panelAzimuthDeg: 0,
          trackingMode: 'sun_tracking',
          dustDegradationFactor: 0.95,
        },
        power: { thermalManagementW: 70, avionicsW: 40, communicationsW: 25, scienceInstrumentsW: 30, standbySystemsW: 15 },
        mobility: { speedKmh: 0.15, mobilityPowerW: 175, terrainFactor: 1.25, maxTravelDistanceKm: 5.0 },
      })
    } else if (p === 'heavy') {
      onChange({
        ...config,
        battery: { totalCapacityKwh: 45.0, currentSocPct: 40.0, minReservePct: 25.0 },
        solar: {
          ratedOutputW: 1200,
          efficiencyPct: 30.0,
          panelTiltDeg: 85.0,
          panelAzimuthDeg: 0,
          trackingMode: 'sun_tracking',
          dustDegradationFactor: 0.92,
        },
        power: { thermalManagementW: 220, avionicsW: 110, communicationsW: 60, scienceInstrumentsW: 90, standbySystemsW: 45 },
        mobility: { speedKmh: 0.25, mobilityPowerW: 480, terrainFactor: 1.35, maxTravelDistanceKm: 12.0 },
      })
    } else if (p === 'scout') {
      onChange({
        ...config,
        battery: { totalCapacityKwh: 6.0, currentSocPct: 30.0, minReservePct: 20.0 },
        solar: {
          ratedOutputW: 220,
          efficiencyPct: 27.0,
          panelTiltDeg: 75.0,
          panelAzimuthDeg: 0,
          trackingMode: 'fixed_vertical',
          dustDegradationFactor: 0.96,
        },
        power: { thermalManagementW: 35, avionicsW: 20, communicationsW: 15, scienceInstrumentsW: 20, standbySystemsW: 10 },
        mobility: { speedKmh: 0.12, mobilityPowerW: 85, terrainFactor: 1.2, maxTravelDistanceKm: 3.5 },
      })
    }
  }

  const handleLocationPreset = (presetKey: string) => {
    if (presetKey === 'shackleton_rim') {
      updateMission('startLat', -89.67)
      updateMission('startLon', 129.78)
    } else if (presetKey === 'connecting_ridge') {
      updateMission('startLat', -89.4749)
      updateMission('startLon', 222.557)
    } else if (presetKey === 'mons_mouton') {
      updateMission('startLat', -84.6)
      updateMission('startLon', 31.0)
    } else if (presetKey === 'haworth_floor') {
      updateMission('startLat', -87.4)
      updateMission('startLon', 355.0)
    }
  }

  const usableEnergyKwh = Math.max(
    0,
    config.battery.totalCapacityKwh * ((config.battery.currentSocPct - config.battery.minReservePct) / 100),
  )

  const totalHotelWatts =
    config.power.thermalManagementW +
    config.power.avionicsW +
    config.power.communicationsW +
    config.power.standbySystemsW

  return (
    <section className="config-box" aria-label="Rover and Mission Configuration">
      <div className="config-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            Rover and mission parameters
          </h3>
          <span className="pill" style={{ fontSize: '0.75rem' }}>
            Usable Energy: {usableEnergyKwh.toFixed(2)} kWh
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <select
            value={selectedPreset}
            onChange={(e) => handlePreset(e.target.value)}
            className="config-select"
            aria-label="Rover Preset Profile"
          >
            <option value="viper">VIPER-Inspired Scout (14 kWh, 450W) [Illustrative]</option>
            <option value="heavy">Heavy Exploration Platform (45 kWh, 1.2kW)</option>
            <option value="scout">Micro-Sortie Scout (6 kWh, 220W)</option>
          </select>
          <button
            type="button"
            className="btn-link"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ fontSize: '0.82rem', color: 'var(--earth)' }}
          >
            {showAdvanced ? '▴ Hide Advanced' : '▾ Advanced Settings'}
          </button>
          <button type="button" className="btn-secondary" onClick={onReset} title="Reset to default demonstration values">
            Reset
          </button>
        </div>
      </div>

      <div className="config-grid">
        {/* Card 1: Battery */}
        <div className="config-col">
          <div className="config-col-title">Battery storage</div>
          <label className="cfg-field" title="Total nameplate battery electrical storage capacity">
            <span>Total capacity</span>
            <input
              type="number"
              min={1}
              max={100}
              step={0.5}
              value={config.battery.totalCapacityKwh}
              onChange={(e) => updateBattery('totalCapacityKwh', Math.max(1, Number(e.target.value)))}
            />
            <span className="cfg-unit">kWh</span>
          </label>
          <label className="cfg-field" title="Current battery state of charge (percentage)">
            <span>Current SoC</span>
            <input
              type="number"
              min={5}
              max={100}
              step={1}
              value={config.battery.currentSocPct}
              onChange={(e) => updateBattery('currentSocPct', Math.min(100, Math.max(5, Number(e.target.value))))}
            />
            <span className="cfg-unit">%</span>
          </label>
          <label className="cfg-field" title="Minimum reserve threshold to protect vehicle survival">
            <span>Min reserve</span>
            <input
              type="number"
              min={5}
              max={40}
              step={1}
              value={config.battery.minReservePct}
              onChange={(e) => updateBattery('minReservePct', Math.min(50, Math.max(5, Number(e.target.value))))}
            />
            <span className="cfg-unit">%</span>
          </label>
        </div>

        {/* Card 2: Solar Panels */}
        <div className="config-col">
          <div className="config-col-title">Solar array</div>
          <label className="cfg-field" title="Nameplate rated solar array power under 1 AU AM0 illumination">
            <span>Rated output</span>
            <input
              type="number"
              min={50}
              max={5000}
              step={25}
              value={config.solar.ratedOutputW}
              onChange={(e) => updateSolar('ratedOutputW', Math.max(50, Number(e.target.value)))}
            />
            <span className="cfg-unit">W</span>
          </label>
          <label className="cfg-field" title="Panel tilt relative to horizontal (90 deg = vertical, ideal for low polar sun)">
            <span>Array tilt</span>
            <input
              type="number"
              min={45}
              max={90}
              step={5}
              value={config.solar.panelTiltDeg}
              onChange={(e) => updateSolar('panelTiltDeg', Math.min(90, Math.max(45, Number(e.target.value))))}
            />
            <span className="cfg-unit">deg</span>
          </label>
          <label className="cfg-field" title="Tracking mechanism or fixed vertical mount">
            <span>Orientation</span>
            <select
              value={config.solar.trackingMode}
              onChange={(e) => updateSolar('trackingMode', e.target.value as RoverMissionConfig['solar']['trackingMode'])}
              className="cfg-select"
            >
              <option value="sun_tracking">Sun-Tracking Gimbal</option>
              <option value="fixed_vertical">Fixed Vertical (90°)</option>
              <option value="fixed_tilt">Fixed tilted array</option>
            </select>
            <span className="cfg-unit" />
          </label>
        </div>

        {/* Card 3: Mobility */}
        <div className="config-col">
          <div className="config-col-title">Mobility &amp; drive</div>
          <label className="cfg-field" title="Average ground traversal speed across lunar regolith">
            <span>Traverse speed</span>
            <input
              type="number"
              min={0.02}
              max={2.0}
              step={0.02}
              value={config.mobility.speedKmh}
              onChange={(e) => updateMobility('speedKmh', Math.max(0.02, Number(e.target.value)))}
            />
            <span className="cfg-unit">km/h</span>
          </label>
          <label className="cfg-field" title="Mechanical wheel actuator draw on flat ground">
            <span>Drive power</span>
            <input
              type="number"
              min={20}
              max={1500}
              step={10}
              value={config.mobility.mobilityPowerW}
              onChange={(e) => updateMobility('mobilityPowerW', Math.max(20, Number(e.target.value)))}
            />
            <span className="cfg-unit">W</span>
          </label>
          <label className="cfg-field" title="Terrain difficulty multiplier accounting for wheel sinkage &amp; rolling resistance">
            <span>Terrain factor</span>
            <input
              type="number"
              min={1.0}
              max={2.5}
              step={0.05}
              value={config.mobility.terrainFactor}
              onChange={(e) => updateMobility('terrainFactor', Math.max(1.0, Number(e.target.value)))}
            />
            <span className="cfg-unit">×</span>
          </label>
        </div>

        {/* Card 4: Location & Search */}
        <div className="config-col">
          <div className="config-col-title">Mission origin &amp; search</div>
          <label className="cfg-field" title="Preselected lunar south polar locations">
            <span>Preset spot</span>
            <select
              onChange={(e) => handleLocationPreset(e.target.value)}
              className="cfg-select"
              defaultValue="connecting_ridge"
            >
              <option value="connecting_ridge">Connecting Ridge (-89.47° S)</option>
              <option value="shackleton_rim">Shackleton Crater (-89.67° S)</option>
              <option value="mons_mouton">Mons Mouton (-84.60° S)</option>
              <option value="haworth_floor">Haworth Crater Floor (-87.40° S)</option>
            </select>
            <span className="cfg-unit" />
          </label>
          <label className="cfg-field" title="Search radius for candidate recharge ridges">
            <span>Search radius</span>
            <input
              type="number"
              min={1.0}
              max={10.0}
              step={0.5}
              value={config.mission.searchRadiusKm}
              onChange={(e) => updateMission('searchRadiusKm', Math.min(10.0, Math.max(1.0, Number(e.target.value))))}
            />
            <span className="cfg-unit">km</span>
          </label>
          <label className="cfg-field" title="Planning evaluation horizon in hours">
            <span>Horizon window</span>
            <input
              type="number"
              min={24}
              max={240}
              step={12}
              value={config.mission.planningHorizonH}
              onChange={(e) => updateMission('planningHorizonH', Math.min(240, Math.max(24, Number(e.target.value))))}
            />
            <span className="cfg-unit">hours</span>
          </label>
        </div>
      </div>

      {/* Advanced Collapsible Settings */}
      {showAdvanced && (
        <div className="config-advanced" aria-label="Advanced Rover Subsystems">
          <div className="config-col-title" style={{ marginTop: '8px' }}>
            Detailed Hotel Subsystems &amp; Degradation Parameters (Continuous Standby: {totalHotelWatts} W)
          </div>
          <div className="config-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <label className="cfg-field" title="Thermal survival heaters">
              <span>Heating load</span>
              <input
                type="number"
                min={0}
                step={5}
                value={config.power.thermalManagementW}
                onChange={(e) => updatePower('thermalManagementW', Math.max(0, Number(e.target.value)))}
              />
              <span className="cfg-unit">W</span>
            </label>
            <label className="cfg-field" title="Avionics and computer guidance">
              <span>Avionics</span>
              <input
                type="number"
                min={0}
                step={5}
                value={config.power.avionicsW}
                onChange={(e) => updatePower('avionicsW', Math.max(0, Number(e.target.value)))}
              />
              <span className="cfg-unit">W</span>
            </label>
            <label className="cfg-field" title="Radio communications">
              <span>RF Comms</span>
              <input
                type="number"
                min={0}
                step={5}
                value={config.power.communicationsW}
                onChange={(e) => updatePower('communicationsW', Math.max(0, Number(e.target.value)))}
              />
              <span className="cfg-unit">W</span>
            </label>
            <label className="cfg-field" title="Science payload standby power">
              <span>Instruments</span>
              <input
                type="number"
                min={0}
                step={5}
                value={config.power.scienceInstrumentsW}
                onChange={(e) => updatePower('scienceInstrumentsW', Math.max(0, Number(e.target.value)))}
              />
              <span className="cfg-unit">W</span>
            </label>
            <label className="cfg-field" title="Solar cell dust de-rating factor">
              <span>Dust derating</span>
              <input
                type="number"
                min={0.7}
                max={1.0}
                step={0.01}
                value={config.solar.dustDegradationFactor}
                onChange={(e) => updateSolar('dustDegradationFactor', Math.min(1.0, Math.max(0.7, Number(e.target.value))))}
              />
              <span className="cfg-unit">fac</span>
            </label>
          </div>
        </div>
      )}
    </section>
  )
}
