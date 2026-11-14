import { useState } from 'react'
import { formatDeg, type Site } from '../data'
import { CITIES, maxSolarElevationToday } from './solar'
import '../styles/explain.css'

export function Contrast({ site, i }: { site: Site; i: number }) {
  const [cityId, setCityId] = useState('pune')
  const selectedCity = CITIES.find((c) => c.id === cityId) ?? CITIES[0]

  // Calculate highest sun at this lunar site over the next month (709 hours)
  const sunElNow = site.sun.el[i] ?? 0
  let maxLunarMonth = sunElNow
  const endHour = Math.min(site.samples, i + 709)
  for (let h = i; h < endHour; h++) {
    const el = site.sun.el[h]
    if (el > maxLunarMonth) maxLunarMonth = el
  }

  // Earth city max noon solar elevation today
  const earthSunElev = maxSolarElevationToday(selectedCity.lat)

  return (
    <div className="contrast-card">
      <div className="contrast-header">
        <h4>Moon vs. Earth Solar Contrast</h4>
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
          <span className="contrast-label">Highest Sun here this month</span>
          <span className="contrast-value">{formatDeg(maxLunarMonth)}</span>
          <span className="contrast-hint">{site.name} (grazing horizon)</span>
        </div>

        <div className="contrast-vs">vs</div>

        <div className="contrast-stat earth">
          <span className="contrast-label">Solar noon in {selectedCity.name}</span>
          <span className="contrast-value">+{earthSunElev.toFixed(1)}°</span>
          <span className="contrast-hint">Earth sky (overhead sun)</span>
        </div>
      </div>

      <div className="contrast-facts">
        <div className="fact-item">
          <strong>29.5 Earth Days</strong>
          <span>A single day-night cycle on the Moon lasts nearly an entire Earth month.</span>
        </div>
        <div className="fact-item">
          <strong>Days of Darkness</strong>
          <span>Polar nights last days or weeks at a time, requiring massive battery reserves or RTGs.</span>
        </div>
        <div className="fact-item">
          <strong>Zero Twilight</strong>
          <span>No air means zero light diffusion. Shadow boundaries are razor-sharp freeze zones.</span>
        </div>
      </div>
    </div>
  )
}
