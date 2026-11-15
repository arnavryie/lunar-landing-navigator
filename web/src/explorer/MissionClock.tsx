import { useCallback, useId, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, PointerEvent } from 'react'
import './missionClock.css'

export interface MissionClockProps {
  timeMs: number // current simulated time, UTC epoch milliseconds
  onChange: (ms: number) => void // called continuously while dragging / on key presses
  minMs: number // clamp range (inclusive)
  maxMs: number
  sunBearingDeg?: number | null // bearing of the Sun seen from the lunar south pole, 0-360 (outer ring)
  earthBearingDeg?: number | null // bearing of Earth seen from the south pole, 0-360 (outer ring)
  sunElevationDeg?: number | null // optional, shown as small text
  lunarDayFrac?: number | null // 0..1 progress through the synodic day, arc on the outer ring
  size?: number // px, default 260
}

type Hand = 'hour' | 'minute' | 'second'

interface DragState {
  hand: Hand
  pointerId: number
  startMs: number
  lastAngle: number
  accumDeg: number
}

const MIN_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const IST_OFFSET_MS = 5.5 * HOUR_MS

/** ms of simulated time per degree of hand rotation. */
const MS_PER_DEG: Record<Hand, number> = {
  hour: HOUR_MS / 15,
  minute: MIN_MS / 6,
  second: 1000 / 6,
}

/* ---- geometry (viewBox centred on 0,0) ---- */
const VB = 175
const R_FACE = 130
const R_GLOW = 133
const R_RING = 146
const R_LABEL = 159
const R_NUM = 105
const HAND_LEN: Record<Hand, number> = { hour: 66, minute: 96, second: 108 }
const HAND_TAIL: Record<Hand, number> = { hour: 12, minute: 16, second: 24 }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad2 = (n: number): string => String(n).padStart(2, '0')
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
/** Wrap a degree delta into [-180, 180). */
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180
const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** Point on a circle; bearing 0 = top, clockwise. */
function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [r * Math.sin(a), -r * Math.cos(a)]
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function fmtHM(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** Hand angles (0 = top, clockwise) for a UTC instant. */
function handAngles(ms: number): Record<Hand, number> {
  const msOfDay = ((ms % DAY_MS) + DAY_MS) % DAY_MS
  const hours = msOfDay / HOUR_MS
  const minutes = (msOfDay % HOUR_MS) / MIN_MS
  const seconds = (msOfDay % MIN_MS) / 1000
  return { hour: hours * 15, minute: minutes * 6, second: seconds * 6 }
}

/**
 * Keeps a displayed angle continuous (takes the shortest path from the previous
 * value) so CSS transitions never spin the long way round past 0°/360°.
 */
function useContinuousAngle(target: number): number {
  const prevRef = useRef<number | null>(null)
  const prev = prevRef.current
  let out = target
  if (prev !== null) {
    out = prev + wrap180(target - prev)
    if (Math.abs(out) > 36_000) out = target // keep numbers small over long sessions
  }
  prevRef.current = out
  return out
}

function arcPath(r: number, frac: number): string {
  const f = clamp(frac, 0, 1)
  if (f <= 0) return ''
  if (f >= 0.9999) {
    return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r}`
  }
  const [x, y] = polar(r, f * 360)
  const large = f > 0.5 ? 1 : 0
  return `M 0 ${-r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(3)} ${y.toFixed(3)}`
}

const HOUR_NUMS = Array.from({ length: 24 }, (_, i) => i)
const MINOR_TICKS = Array.from({ length: 96 }, (_, i) => i).filter((i) => i % 4 !== 0)

export function MissionClock(props: MissionClockProps): JSX.Element {
  const {
    timeMs,
    onChange,
    minMs,
    maxMs,
    sunBearingDeg,
    earthBearingDeg,
    sunElevationDeg,
    lunarDayFrac,
    size = 260,
  } = props

  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [dragHand, setDragHand] = useState<Hand | null>(null)

  const target = handAngles(timeMs)
  const hourDeg = useContinuousAngle(target.hour)
  const minuteDeg = useContinuousAngle(target.minute)
  const secondDeg = useContinuousAngle(target.second)

  const emit = useCallback(
    (ms: number) => {
      const lo = Math.min(minMs, maxMs)
      const hi = Math.max(minMs, maxMs)
      onChange(clamp(Math.round(ms), lo, hi))
    },
    [onChange, minMs, maxMs],
  )

  /** Pointer position → {angle (0=top, cw), radius in viewBox units}. */
  const pointerPolar = useCallback((clientX: number, clientY: number): { angle: number; r: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const scale = (2 * VB) / rect.width
    const dx = (clientX - rect.left - rect.width / 2) * scale
    const dy = (clientY - rect.top - rect.height / 2) * scale
    const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    return { angle, r: Math.hypot(dx, dy) }
  }, [])

  const onPointerDown = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      const p = pointerPolar(e.clientX, e.clientY)
      if (!p || p.r > R_RING + 8) return

      // Prefer the hand element that was pressed; otherwise the angularly closest hand.
      let hand: Hand | null = null
      const el = e.target instanceof Element ? e.target.closest('[data-hand]') : null
      const attr = el?.getAttribute('data-hand')
      if (attr === 'hour' || attr === 'minute' || attr === 'second') hand = attr

      if (!hand) {
        const angles: Record<Hand, number> = handAngles(timeMs)
        const all: Hand[] = ['second', 'minute', 'hour']
        const reachable = all.filter((h) => HAND_LEN[h] >= p.r - 10)
        const pool = reachable.length > 0 ? reachable : all
        let best = Infinity
        for (const h of pool) {
          const d = Math.abs(wrap180(p.angle - angles[h]))
          if (d < best) {
            best = d
            hand = h
          }
        }
      }
      if (!hand) return

      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.focus({ preventScroll: true })
      dragRef.current = {
        hand,
        pointerId: e.pointerId,
        startMs: timeMs,
        lastAngle: p.angle,
        accumDeg: 0,
      }
      setDragHand(hand)
    },
    [pointerPolar, timeMs],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const p = pointerPolar(e.clientX, e.clientY)
      if (!p || p.r < 6) return // angle is unstable at the hub
      const delta = wrap180(p.angle - drag.lastAngle)
      drag.lastAngle = p.angle
      if (delta === 0) return
      drag.accumDeg += delta

      const unit = MS_PER_DEG[drag.hand]
      const lo = Math.min(minMs, maxMs)
      const hi = Math.max(minMs, maxMs)
      const raw = drag.startMs + drag.accumDeg * unit
      const next = clamp(raw, lo, hi)
      // Don't let accumulated rotation run past the clamp, so reversing responds at once.
      if (next !== raw) drag.accumDeg = (next - drag.startMs) / unit
      onChange(Math.round(next))
    },
    [pointerPolar, onChange, minMs, maxMs],
  )

  const endDrag = useCallback((e: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDragHand(null)
  }, [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      let step = 0
      switch (e.key) {
        case 'ArrowRight':
          step = e.shiftKey ? HOUR_MS : MIN_MS
          break
        case 'ArrowLeft':
          step = e.shiftKey ? -HOUR_MS : -MIN_MS
          break
        case 'PageUp':
          step = DAY_MS
          break
        case 'PageDown':
          step = -DAY_MS
          break
        default:
          return
      }
      e.preventDefault()
      emit(timeMs + step)
    },
    [emit, timeMs],
  )

  const timeStr = fmtTime(timeMs)
  const dateStr = fmtDate(timeMs)
  const istStr = fmtHM(timeMs + IST_OFFSET_MS)
  const ariaText = `Mission clock: ${timeStr} UTC, ${dateStr} (IST ${istStr}). Drag the hands, or use arrow keys for minutes, Shift+arrow for hours, Page Up/Down for days.`

  const showSun = isNum(sunBearingDeg)
  const showEarth = isNum(earthBearingDeg)
  const showArc = isNum(lunarDayFrac)
  const sunPos = showSun ? polar(R_RING, sunBearingDeg) : null
  const earthPos = showEarth ? polar(R_RING, earthBearingDeg) : null
  const sunLabel = showSun ? polar(R_LABEL, sunBearingDeg) : null
  const earthLabel = showEarth ? polar(R_LABEL, earthBearingDeg) : null

  const gradId = `mc-face-${uid}`
  const glowId = `mc-glow-${uid}`
  const sunGlowId = `mc-sunglow-${uid}`

  const renderHand = (hand: Hand, deg: number): JSX.Element => (
    <g
      className={`mc-hand mc-hand-${hand}${dragHand === hand ? ' mc-hand-active' : ''}`}
      style={{ transform: `rotate(${deg}deg)` }}
      data-hand={hand}
    >
      <line className="mc-hand-line" x1={0} y1={HAND_TAIL[hand]} x2={0} y2={-HAND_LEN[hand]} />
      {hand === 'second' && <circle className="mc-second-tip" cx={0} cy={HAND_TAIL[hand]} r={3.2} />}
      <line className="mc-hand-hit" x1={0} y1={HAND_TAIL[hand]} x2={0} y2={-HAND_LEN[hand] - 6} />
    </g>
  )

  return (
    <div className={`mc-root${dragHand ? ' mc-dragging' : ''}`} style={{ width: size }}>
      <div
        className="mc-dial"
        role="slider"
        tabIndex={0}
        aria-label={ariaText}
        aria-valuemin={minMs}
        aria-valuemax={maxMs}
        aria-valuenow={timeMs}
        aria-valuetext={`${timeStr} UTC, ${dateStr}`}
        onKeyDown={onKeyDown}
        style={{ width: size, height: size }}
      >
        <svg
          ref={svgRef}
          className="mc-svg"
          width={size}
          height={size}
          viewBox={`${-VB} ${-VB} ${2 * VB} ${2 * VB}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id={gradId} cx="50%" cy="42%" r="62%">
              <stop offset="0%" stopColor="#111823" />
              <stop offset="100%" stopColor="#0b0f14" />
            </radialGradient>
            <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" />
            </filter>
            <filter id={sunGlowId} x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* outer "lunar day" ring */}
          <circle className="mc-ring" r={R_RING} />
          {showArc && <path className="mc-ring-arc" d={arcPath(R_RING, lunarDayFrac)} />}

          {/* face + cyan glow */}
          <circle className="mc-glow" r={R_GLOW} filter={`url(#${glowId})`} />
          <circle className="mc-face" r={R_FACE} fill={`url(#${gradId})`} />
          <circle className="mc-face-edge" r={R_FACE} />

          {/* ticks */}
          {MINOR_TICKS.map((i) => {
            const [x1, y1] = polar(R_FACE - 7, i * 3.75)
            const [x2, y2] = polar(R_FACE - 2, i * 3.75)
            return <line key={`m${i}`} className="mc-tick-minor" x1={x1} y1={y1} x2={x2} y2={y2} />
          })}
          {HOUR_NUMS.map((h) => {
            const major = h % 6 === 0
            const [x1, y1] = polar(R_FACE - (major ? 17 : 12), h * 15)
            const [x2, y2] = polar(R_FACE - 2, h * 15)
            return (
              <line
                key={`h${h}`}
                className={major ? 'mc-tick-major' : 'mc-tick-hour'}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
              />
            )
          })}

          {/* numerals */}
          {HOUR_NUMS.map((h) => {
            const major = h % 6 === 0
            const [x, y] = polar(major ? R_NUM - 3 : R_NUM, h * 15)
            return (
              <text
                key={`n${h}`}
                className={major ? 'mc-num mc-num-major' : 'mc-num'}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {h}
              </text>
            )
          })}

          {/* Sun / Earth markers on the outer ring */}
          {earthPos && earthLabel && (
            <g className="mc-marker mc-marker-earth">
              <circle cx={earthPos[0]} cy={earthPos[1]} r={5} />
              <text x={earthLabel[0]} y={earthLabel[1]} textAnchor="middle" dominantBaseline="central">
                Earth
              </text>
            </g>
          )}
          {sunPos && sunLabel && (
            <g className="mc-marker mc-marker-sun">
              <circle cx={sunPos[0]} cy={sunPos[1]} r={5.5} filter={`url(#${sunGlowId})`} />
              <text x={sunLabel[0]} y={sunLabel[1]} textAnchor="middle" dominantBaseline="central">
                Sun
              </text>
            </g>
          )}

          {/* centre readout (under the hands) */}
          <g className="mc-readout">
            <text className="mc-readout-time" x={0} y={38} textAnchor="middle">
              {timeStr}
            </text>
            <text className="mc-readout-date" x={0} y={53} textAnchor="middle">
              {dateStr} <tspan className="mc-readout-utc">UTC</tspan>
            </text>
            <text className="mc-readout-ist" x={0} y={65} textAnchor="middle">
              IST {istStr}
            </text>
            {isNum(sunElevationDeg) && (
              <text className="mc-readout-sun" x={0} y={-44} textAnchor="middle">
                Sun {sunElevationDeg >= 0 ? '+' : '−'}
                {Math.abs(sunElevationDeg).toFixed(2)}° at pole
              </text>
            )}
          </g>

          {/* hands */}
          {renderHand('hour', hourDeg)}
          {renderHand('minute', minuteDeg)}
          {renderHand('second', secondDeg)}
          <circle className="mc-hub" r={6} />
          <circle className="mc-hub-dot" r={2.2} />
        </svg>
      </div>
      <p className="mc-caption">
        Hour hand turns once per 24 h · outer ring: Sun and Earth bearing from the south pole
      </p>
    </div>
  )
}

export default MissionClock
