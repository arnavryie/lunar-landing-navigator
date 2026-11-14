import type { ReactNode } from 'react'
import { dailyHours, formatDeg, formatDuration, horizonAt, hoursToChange, type Site } from '../data'

export type Topic = 'sun-skims' | 'ridge-blocks' | 'earth-wobbles' | 'five-km' | 'dates-matter'

export interface CardContent {
  title: string
  explanation: string
  diagram: ReactNode
  liveLabel: string
  liveValue: string
}

export function getCardContent(topic: Topic, site: Site, i: number): CardContent {
  switch (topic) {
    case 'sun-skims': {
      const sunEl = site.sun.el[i] ?? 0
      // Find highest sun in this synodic cycle (~709 hours forward, clamped by samples)
      let maxMonth = sunEl
      const endHour = Math.min(site.samples, i + 709)
      for (let h = i; h < endHour; h++) {
        const el = site.sun.el[h]
        if (el > maxMonth) maxMonth = el
      }

      return {
        title: 'Why does the Sun skim the horizon?',
        explanation:
          "The Moon is almost upright in space — tilted only about 1.5° compared to Earth's 23.4°. At the lunar poles, the Sun never climbs high overhead. Instead, it circles around you like a flashlight beam resting flat on a tabletop.",
        diagram: (
          <svg viewBox="0 0 160 80" className="explain-diagram" aria-hidden="true">
            {/* Horizon ground line */}
            <line x1="10" y1="65" x2="150" y2="65" stroke="var(--c-border)" strokeWidth="2" />
            <text x="80" y="75" textAnchor="middle" fontSize="9" fill="var(--c-muted)">Lunar Horizon</text>
            {/* Surface stick figure / lander */}
            <circle cx="80" cy="58" r="3" fill="#1fa38a" />
            <line x1="80" y1="61" x2="80" y2="65" stroke="#1fa38a" strokeWidth="1.5" />
            {/* Sun skimming low */}
            <line x1="80" y1="60" x2="140" y2="48" stroke="#c98419" strokeWidth="1.5" strokeDasharray="3 2" />
            <circle cx="140" cy="48" r="7" fill="#c98419" />
            <text x="140" y="37" textAnchor="middle" fontSize="9" fill="#c98419" fontWeight="bold">Sun ~1.5°</text>
          </svg>
        ),
        liveLabel: 'Right now at this site:',
        liveValue: `Current Sun: ${formatDeg(sunEl)} · Highest this month: ${formatDeg(maxMonth)}`,
      }
    }

    case 'ridge-blocks': {
      const sunAz = site.sun.az[i] ?? 0
      const sunEl = site.sun.el[i] ?? 0
      const horizonEl = horizonAt(site, sunAz)
      const isBlocked = sunEl < horizonEl

      return {
        title: 'Why does a distant ridge cause darkness?',
        explanation:
          'Because the Sun sits so low, even a gentle hill or crater rim a few kilometres away can block it completely. There is no air on the Moon to scatter daylight, so the moment a mountain peak blocks the Sun, daylight turns instantly into black shadow.',
        diagram: (
          <svg viewBox="0 0 160 80" className="explain-diagram" aria-hidden="true">
            {/* Flat terrain */}
            <path d="M 10 65 L 50 65 Q 70 30, 95 38 T 120 65 L 150 65" fill="none" stroke="var(--c-border)" strokeWidth="2" />
            <polygon points="50,65 75,32 95,38 120,65" fill="#4a515a" opacity="0.3" />
            <text x="85" y="28" textAnchor="middle" fontSize="8" fill="var(--c-muted)">Ridge (+{formatDeg(horizonEl)})</text>
            {/* Observer */}
            <circle cx="35" cy="62" r="3" fill="#1fa38a" />
            {/* Blocked ray */}
            <line x1="145" y1="30" x2="85" y2="40" stroke="#c98419" strokeWidth="1.5" strokeDasharray="3 2" />
            <line x1="85" y1="40" x2="35" y2="62" stroke="#4a515a" strokeWidth="1.5" strokeDasharray="2 2" />
            <circle cx="145" cy="30" r="6" fill="#c98419" />
          </svg>
        ),
        liveLabel: 'Obstruction check right now:',
        liveValue: `Sun elevation: ${formatDeg(sunEl)} vs Terrain ridge: ${formatDeg(horizonEl)} (${isBlocked ? 'Blocked in shadow' : 'Clear above ridge'})`,
      }
    }

    case 'earth-wobbles': {
      const earthEl = site.earth.el[i] ?? 0
      const earthFrac = site.earth.frac[i] ?? 0
      const isVisible = earthFrac > 0
      const hToChange = hoursToChange(site.earth.frac, i)

      return {
        title: 'Why does Earth wobble in the lunar sky?',
        explanation:
          "The Moon always shows the same face to Earth, but its orbit is slightly oval and tilted. This causes a gentle wobble called 'libration'. From the south pole, Earth hangs near the horizon, slowly bobbing up and down by about ±7° over a 27-day cycle.",
        diagram: (
          <svg viewBox="0 0 160 80" className="explain-diagram" aria-hidden="true">
            <line x1="10" y1="65" x2="150" y2="65" stroke="var(--c-border)" strokeWidth="2" />
            {/* Wobble loop */}
            <ellipse cx="120" cy="45" rx="10" ry="16" fill="none" stroke="#5590d8" strokeWidth="1" strokeDasharray="2 2" />
            <circle cx="120" cy="38" r="6" fill="#5590d8" />
            <text x="120" y="26" textAnchor="middle" fontSize="8" fill="#5590d8" fontWeight="bold">Earth ±7° Loop</text>
            {/* Lander */}
            <circle cx="35" cy="62" r="3" fill="#1fa38a" />
            <line x1="35" y1="62" x2="114" y2="40" stroke="#5590d8" strokeWidth="1" strokeDasharray="3 2" />
          </svg>
        ),
        liveLabel: 'Earth line-of-sight status:',
        liveValue: `Earth elevation: ${formatDeg(earthEl)} · ${isVisible ? 'Visible (DTE link active)' : 'Occulted below horizon'} · ${hToChange !== null ? `Changes in ${formatDuration(hToChange)}` : 'Steady over window'}`,
      }
    }

    case 'five-km': {
      const sunPct = site.metrics.sunlit_pct

      return {
        title: 'Why does a 5 km difference make or break a landing?',
        explanation:
          'Because the Sun is so low, mountains act like giant sundials casting shadows tens of kilometres long. Walking just 5 kilometres from a high crater rim down into a basin can turn 80% annual sunlight into 0% pitch-black cryogenic freeze.',
        diagram: (
          <svg viewBox="0 0 160 80" className="explain-diagram" aria-hidden="true">
            {/* High rim to deep crater */}
            <path d="M 10 35 L 50 35 L 90 70 L 150 70" fill="none" stroke="var(--c-border)" strokeWidth="2" />
            <circle cx="45" cy="32" r="3" fill="#1fa38a" />
            <text x="45" y="24" textAnchor="middle" fontSize="7" fill="#1fa38a" fontWeight="bold">Rim: 80% Sun</text>
            <circle cx="115" cy="67" r="3" fill="#4a515a" />
            <text x="115" y="61" textAnchor="middle" fontSize="7" fill="var(--c-muted)">5 km away: 0% Sun</text>
          </svg>
        ),
        liveLabel: 'Annual sunlight fraction here:',
        liveValue: `${site.name}: ${sunPct.toFixed(1)}% annual sunlight at 2m height`,
      }
    }

    case 'dates-matter': {
      const sunHours = dailyHours(site, 'sun')
      const maxH = Math.max(...sunHours, 24)

      return {
        title: 'Why do landing dates matter so much?',
        explanation:
          "A single lunar day lasts about 29.5 Earth days. As the Moon orbits the Sun over the course of the year, the polar tilt tilts slightly toward or away from the Sun. A landing site bathed in sunlight in January can be plunged into total darkness by July.",
        diagram: (
          <svg viewBox="0 0 160 60" className="explain-diagram" aria-hidden="true">
            {/* Sparkline of daily sun hours */}
            <path
              d={sunHours
                .map((h, idx) => {
                  const x = 10 + (idx / Math.max(1, sunHours.length - 1)) * 140
                  const y = 50 - (h / maxH) * 40
                  return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
                })
                .join(' ')}
              fill="none"
              stroke="#c98419"
              strokeWidth="1.5"
            />
            <line x1="10" y1="52" x2="150" y2="52" stroke="var(--c-border)" strokeWidth="1" />
            <text x="15" y="58" fontSize="7" fill="var(--c-muted)">Jan</text>
            <text x="80" y="58" textAnchor="middle" fontSize="7" fill="var(--c-muted)">Jul</text>
            <text x="145" y="58" textAnchor="end" fontSize="7" fill="var(--c-muted)">Dec</text>
          </svg>
        ),
        liveLabel: 'Yearly illumination variation:',
        liveValue: `365-day seasonal light curve: peaks during south-polar summer (Dec–Feb)`,
      }
    }
  }
}
