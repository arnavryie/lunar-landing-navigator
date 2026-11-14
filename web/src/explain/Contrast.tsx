import { useState } from 'react'
import { formatDeg, timeAt, type Site } from '../data'
import { CITIES, maxSolarElevationToday } from './solar'
import '../styles/explain.css'

export function Contrast({ site, i }: { site: Site; i: number }) {
  const [cityId, setCityId] = useState('pune')
  const selectedCity = CITIES.find((c) => c.id === cityId) ?? CITIES[0]

  // Highest Sun at this site over the next lunar day-night cycle (~709 h), or until the data ends
  const sunElNow = site.sun.el[i] ?? 0
  let maxLunarMonth = sunElNow
  const endHour = Math.min(site.samples, i + 709)
  for (let h = i; h < endHour; h++) {
    const el = site.sun.el[h]
    if (el > maxLunarMonth) maxLunarMonth = el
  }

  // The city's noon Sun on the same date as the selected hour, so both sides compare the same day
  const date = timeAt(site, i)
  const earthSunElev = maxSolarElevationToday(selectedCity.lat, date)
  const days = Math.round((endHour - i) / 24)

  return (
    <div className="contrast-card">
      <div className="contrast-header">
        <h4>Moon vs Earth: how high the Sun gets</h4>
        <div className="city-picker-wrap">
          <label htmlFor="city-select" className="city-label">Compare with:</label>
          <select
            id="city-select"
            className="city-select"
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
          >
            {CITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="contrast-stat-grid">
        <div className="contrast-stat lunar">
          <span className="contrast-label">Highest Sun here, next {days} days</span>
          <span className="contrast-value">{formatDeg(maxLunarMonth)}</span>
          <span className="contrast-hint">{site.name}</span>
        </div>

        <div className="contrast-vs">vs</div>

        <div className="contrast-stat earth">
          <span className="contrast-label">Solar noon in {selectedCity.name}</span>
          <span className="contrast-value">+{earthSunElev.toFixed(1)}°</span>
          <span className="contrast-hint">Noon on {date.toUTCString().slice(5, 16)}</span>
        </div>
      </div>

      <div className="contrast-facts">
        <div className="fact-item">
          <strong>29.5 Earth days</strong>
          <span>One day-night cycle on the Moon lasts about an Earth month.</span>
        </div>
        <div className="fact-item">
          <strong>Days of darkness</strong>
          <span>Near the pole, darkness can last days or weeks, so batteries must be sized for it.</span>
        </div>
        <div className="fact-item">
          <strong>No twilight</strong>
          <span>With no air to scatter light, shadows have sharp edges and there is no dusk.</span>
        </div>
      </div>
    </div>
  )
}
