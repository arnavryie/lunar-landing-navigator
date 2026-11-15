import { useEffect } from 'react'
import type { SimulationStepTelemetry } from '../types.ts'

interface SimulationControlsProps {
  currentHourIndex: number
  startHourIndex: number
  totalSimulationHours: number
  isPlaying: boolean
  playbackSpeed: number
  currentStepTelemetry: SimulationStepTelemetry | null
  onPlayToggle: () => void
  onSpeedChange: (speed: number) => void
  onStepChange: (hourOffset: number) => void
  onReset: () => void
  yearStartUtc?: string // Any landing year
}

export function SimulationControls({
  currentHourIndex,
  startHourIndex,
  totalSimulationHours,
  isPlaying,
  playbackSpeed,
  currentStepTelemetry,
  onPlayToggle,
  onSpeedChange,
  onStepChange,
  onReset,
  yearStartUtc = '2027-01-01T00:00:00Z',
}: SimulationControlsProps) {
  const currentOffset = Math.max(0, currentHourIndex - startHourIndex)
  const maxOffset = Math.max(1, totalSimulationHours)

  const utcDateStr = currentStepTelemetry
    ? currentStepTelemetry.utcDateStr.replace('T', ' ').replace(':00.000Z', ' UTC')
    : new Date(Date.parse(yearStartUtc) + currentHourIndex * 3600000)
        .toISOString()
        .replace('T', ' ')
        .replace(':00.000Z', ' UTC')

  const phaseLabel = currentStepTelemetry?.phaseLabel || 'Simulation Standby'
  const phaseClass = currentStepTelemetry?.phase || 'standby'

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.shiftKey ? 24 : 1
        onStepChange(Math.min(maxOffset, currentOffset + step))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const step = e.shiftKey ? 24 : 1
        onStepChange(Math.max(0, currentOffset - step))
      } else if (e.key === ' ') {
        e.preventDefault()
        onPlayToggle()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentOffset, maxOffset, onStepChange, onPlayToggle])

  return (
    <div className="sim-controls-bar" aria-label="Simulation Time and Playback Controls">
      <div className="sim-time-readout">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span className="sim-clock-utc">{utcDateStr}</span>
          <span className="sim-t-offset">T+{currentOffset}h</span>
        </div>
        <div className={`sim-phase-badge ${phaseClass}`}>{phaseLabel}</div>
      </div>

      <div className="sim-scrubber-wrapper">
        <input
          type="range"
          min={0}
          max={maxOffset}
          value={currentOffset}
          onChange={(e) => onStepChange(Number(e.target.value))}
          className="sim-scrubber"
          aria-label="Simulation Hour Scrubber"
        />
        <div className="sim-time-markers">
          <span>T+0h (Departure)</span>
          <span>T+{Math.round(maxOffset * 0.5)}h</span>
          <span>T+{maxOffset}h (Mission End)</span>
        </div>
      </div>

      <div className="sim-buttons-row">
        <button
          type="button"
          className="btn-playback"
          onClick={onPlayToggle}
          title={isPlaying ? 'Pause Simulation [Space]' : 'Play Simulation [Space]'}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>

        <select
          value={playbackSpeed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="sim-speed-select"
          aria-label="Playback Rate"
          title="Hours advanced per simulation frame"
        >
          <option value={1}>1 h / step</option>
          <option value={6}>6 h / step</option>
          <option value={24}>24 h / step</option>
        </select>

        <div className="sim-step-group">
          <button
            type="button"
            className="btn-step"
            onClick={() => onStepChange(Math.max(0, currentOffset - 24))}
            title="Step backward 1 day (-24 hours)"
          >
            −1d
          </button>
          <button
            type="button"
            className="btn-step"
            onClick={() => onStepChange(Math.max(0, currentOffset - 1))}
            title="Step backward 1 hour [←]"
          >
            −1h
          </button>
          <button
            type="button"
            className="btn-step"
            onClick={() => onStepChange(Math.min(maxOffset, currentOffset + 1))}
            title="Step forward 1 hour [→]"
          >
            +1h
          </button>
          <button
            type="button"
            className="btn-step"
            onClick={() => onStepChange(Math.min(maxOffset, currentOffset + 24))}
            title="Step forward 1 day (+24 hours)"
          >
            +1d
          </button>
        </div>

        <button
          type="button"
          className="btn-secondary"
          onClick={onReset}
          title="Reset simulation to initial departure hour"
        >
          Reset time
        </button>
      </div>
    </div>
  )
}
