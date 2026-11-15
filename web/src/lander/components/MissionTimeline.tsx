import { useRef, useState } from 'react'
import type { SimulationStepTelemetry } from '../types.ts'

interface MissionTimelineProps {
  telemetrySteps: SimulationStepTelemetry[]
  minReservePct: number
  totalCapacityKwh: number
  currentStepIndex: number
  onSeekStep: (stepIndex: number) => void
}

export function MissionTimeline({
  telemetrySteps,
  minReservePct,
  totalCapacityKwh,
  currentStepIndex,
  onSeekStep,
}: MissionTimelineProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  if (!telemetrySteps || telemetrySteps.length === 0) {
    return (
      <div className="timeline-panel">
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
          No simulation telemetry points available.
        </div>
      </div>
    )
  }

  const svgWidth = 880
  const svgHeight = 260
  const padLeft = 55
  const padRight = 30
  const padTop = 20
  const padBottom = 35

  const plotWidth = svgWidth - padLeft - padRight
  const plotHeight = svgHeight - padTop - padBottom

  const maxStep = telemetrySteps.length - 1
  const toX = (idx: number) => padLeft + (idx / Math.max(1, maxStep)) * plotWidth
  const toY = (soc: number) => padTop + (1 - Math.min(100, Math.max(0, soc)) / 100) * plotHeight

  // Battery Reserve Line
  const reserveY = toY(minReservePct)

  // Construct SVG Path for SoC Line
  const socPathData = telemetrySteps
    .map((step, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(idx).toFixed(1)} ${toY(step.socPct).toFixed(1)}`)
    .join(' ')

  const socAreaGrad = `${socPathData} L ${toX(maxStep).toFixed(1)} ${(padTop + plotHeight).toFixed(1)} L ${toX(0).toFixed(1)} ${(padTop + plotHeight).toFixed(1)} Z`

  // Interactive mouse seeking
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const frac = Math.max(0, Math.min(1, (mouseX - (padLeft / svgWidth) * rect.width) / ((plotWidth / svgWidth) * rect.width)))
    const targetIdx = Math.round(frac * maxStep)
    setHoverIndex(targetIdx)
  }

  const handleClick = () => {
    if (hoverIndex !== null) {
      onSeekStep(hoverIndex)
    }
  }

  const activeIdx = hoverIndex !== null ? hoverIndex : Math.min(currentStepIndex, maxStep)
  const activeStep = telemetrySteps[activeIdx] || telemetrySteps[0]

  // Time grid ticks (5-6 intervals)
  const tickCount = 6
  const tickIndices: number[] = []
  for (let i = 0; i < tickCount; i++) {
    tickIndices.push(Math.round((i / (tickCount - 1)) * maxStep))
  }

  return (
    <div className="timeline-panel" aria-label="Mission Illumination & Battery Energy Progression Profile">
      <div className="card-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <h3>
          Illumination and battery state of charge
        </h3>
        <div style={{ fontSize: '0.84rem', color: 'var(--muted)' }}>
          Cursor: <strong style={{ color: 'var(--text)' }}>T+{activeStep.stepTimeH}h</strong> ({activeStep.phaseLabel}) —{' '}
          <strong style={{ color: activeStep.socPct >= minReservePct ? '#6fcf9f' : '#f08a7a' }}>
            {activeStep.socPct.toFixed(1)}% SoC
          </strong>{' '}
          ({activeStep.storedEnergyKwh.toFixed(2)} kWh) • Solar:{' '}
          <span style={{ color: 'var(--sun)' }}>{activeStep.solarGenerationW.toFixed(0)} W</span> • Net:{' '}
          <span style={{ color: activeStep.netPowerW >= 0 ? '#6fcf9f' : '#f08a7a' }}>
            {activeStep.netPowerW >= 0 ? '+' : ''}{activeStep.netPowerW.toFixed(0)} W
          </span>
          {activeStep.curtailedPowerW > 0 && (
            <span style={{ color: 'var(--muted)', marginLeft: '6px' }}>
              ({activeStep.curtailedPowerW.toFixed(0)} W curtailed at cap)
            </span>
          )}
        </div>
      </div>

      <div className="timeline-chart-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="timeline-svg"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
          onClick={handleClick}
          role="img"
          aria-label="Synchronized timeline showing solar illumination bands, battery percentage curve, and mission phases"
        >
          <defs>
            <linearGradient id="batterySoCGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1fa38a" stopOpacity="0.4" />
              <stop offset="60%" stopColor="#5590d8" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#181715" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Phase Background Shading */}
          {telemetrySteps.map((step, idx) => {
            if (idx === 0) return null
            const x1 = toX(idx - 1)
            const x2 = toX(idx)
            const fill =
              step.phase === 'transit'
                ? '#201f1c'
                : step.phase === 'recharge'
                ? '#282216'
                : '#1b1915'
            return (
              <rect
                key={idx}
                x={x1}
                y={padTop}
                width={Math.max(1, x2 - x1)}
                height={plotHeight}
                fill={fill}
                opacity="0.8"
              />
            )
          })}

          {/* Sunlit Band Strip along top */}
          {telemetrySteps.map((step, idx) => {
            if (idx === 0) return null
            const x1 = toX(idx - 1)
            const x2 = toX(idx)
            if (!step.isDirectSunlit) return null
            return (
              <rect
                key={`sun-${idx}`}
                x={x1}
                y={padTop + 2}
                width={Math.max(1, x2 - x1)}
                height={6}
                fill="#c98419"
                opacity="0.9"
              />
            )
          })}

          {/* Horizontal Gridlines & Y-Axis Labels (0%, 25%, 50%, 75%, 100%) */}
          {[0, 25, 50, 75, 100].map((val) => {
            const y = toY(val)
            return (
              <g key={val}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={padLeft + plotWidth}
                  y2={y}
                  stroke="#373531"
                  strokeWidth="1"
                  strokeDasharray={val === 0 || val === 100 ? undefined : '2 4'}
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  fill="#aaa598"
                  fontSize="11"
                  textAnchor="end"
                >
                  {val}%
                </text>
              </g>
            )
          })}

          {/* Reserve Threshold Line */}
          <line
            x1={padLeft}
            y1={reserveY}
            x2={padLeft + plotWidth}
            y2={reserveY}
            stroke="#c98419"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <text
            x={padLeft + plotWidth - 6}
            y={reserveY - 5}
            fill="#c98419"
            fontSize="10"
            fontWeight="600"
            textAnchor="end"
          >
            Min Reserve ({minReservePct}%)
          </text>

          {/* SoC Area Fill */}
          <path d={socAreaGrad} fill="url(#batterySoCGrad)" pointerEvents="none" />

          {/* SoC Curve Path */}
          <path
            d={socPathData}
            fill="none"
            stroke="#1fa38a"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />

          {/* X-Axis Time Ticks */}
          {tickIndices.map((idx) => {
            const step = telemetrySteps[idx]
            if (!step) return null
            const x = toX(idx)
            return (
              <g key={idx}>
                <line x1={x} y1={padTop + plotHeight} x2={x} y2={padTop + plotHeight + 5} stroke="#34322d" />
                <text
                  x={x}
                  y={padTop + plotHeight + 18}
                  fill="#aaa598"
                  fontSize="11"
                  textAnchor="middle"
                >
                  +{step.stepTimeH}h
                </text>
              </g>
            )
          })}

          {/* Active Simulation Step Indicator (Green cursor) */}
          <g pointerEvents="none">
            <line
              x1={toX(Math.min(currentStepIndex, maxStep))}
              y1={padTop}
              x2={toX(Math.min(currentStepIndex, maxStep))}
              y2={padTop + plotHeight}
              stroke="#5590d8"
              strokeWidth="1.5"
            />
            <circle
              cx={toX(Math.min(currentStepIndex, maxStep))}
              cy={toY(telemetrySteps[Math.min(currentStepIndex, maxStep)]?.socPct || 50)}
              r="4.5"
              fill="#5590d8"
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          </g>

          {/* Hover Crosshair (White dashed cursor) */}
          {hoverIndex !== null && hoverIndex !== currentStepIndex && (
            <g pointerEvents="none">
              <line
                x1={toX(hoverIndex)}
                y1={padTop}
                x2={toX(hoverIndex)}
                y2={padTop + plotHeight}
                stroke="#ebe7dd"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={toX(hoverIndex)}
                cy={toY(telemetrySteps[hoverIndex]?.socPct || 50)}
                r="4.5"
                fill="#1fa38a"
                stroke="#ebe7dd"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Legend & Guide Bar */}
      <div className="timeline-legend-row">
        <div className="timeline-legend-items">
          <div className="timeline-legend-entry">
            <span style={{ width: '12px', height: '3px', background: '#1fa38a', borderRadius: '1px' }} />
            <span>Battery State of Charge (%)</span>
          </div>
          <div className="timeline-legend-entry">
            <span style={{ width: '12px', height: '0', borderTop: '2px dashed #c98419' }} />
            <span>Minimum Reserve ({minReservePct}%)</span>
          </div>
          <div className="timeline-legend-entry">
            <span style={{ width: '10px', height: '6px', background: '#c98419', borderRadius: '1px' }} />
            <span>Direct solar illumination</span>
          </div>
          <div className="timeline-legend-entry">
            <span style={{ width: '10px', height: '10px', background: '#201f1c', border: '1px solid #34322d' }} />
            <span>Transit phase</span>
          </div>
          <div className="timeline-legend-entry">
            <span style={{ width: '10px', height: '10px', background: '#282216', border: '1px solid #c98419' }} />
            <span>Solar recharge phase</span>
          </div>
        </div>

        <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem', color: 'var(--muted)' }}>
          Battery Capacity: <strong>{totalCapacityKwh.toFixed(1)} kWh</strong> • Click timeline to seek simulation time
        </div>
      </div>
    </div>
  )
}
