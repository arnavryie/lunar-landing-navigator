import { useState } from 'react'

export function MethodologySection() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <section className="methodology-panel" aria-label="Scientific Assumptions and Engineering Limitations">
      <div
        className="methodology-header"
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--earth)' }}>ℹ</span>
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
            Method, sources and caveats
          </h4>
        </div>
        <button
          type="button"
          className="btn-link"
          style={{ fontSize: '0.82rem', color: 'var(--earth)' }}
        >
          {isOpen ? '▴ Collapse Methodology' : '▾ Expand Methodology (Data Sources & Caveats)'}
        </button>
      </div>

      {isOpen && (
        <div className="methodology-content">
          <div className="methodology-grid">
            <div className="meth-col">
              <h5>1. Ephemeris and Sun direction</h5>
              <p>
                Solar and Earth vectors originate from the <strong>JPL DE421</strong> planetary ephemeris computed in the
                Moon Mean Earth / Polar Axis (MOON_ME_DE421) frame via Skyfield. Evaluated against official JPL Horizons vectors,
                maximum directional error is under <strong>0.00003°</strong>.
              </p>
              <p>
                At the lunar south pole, solar elevation skims between <strong>-1.54° and +1.54°</strong> above the mean sphere.
                Calculations explicitly compute terrain horizon blockage and partial solar disc fraction ($0.0$ to $1.0$).
              </p>
            </div>

            <div className="meth-col">
              <h5>2. Terrain and LOLA resolution</h5>
              <p>
                Topography derives from NASA Lunar Reconnaissance Orbiter (LRO) LOLA <strong>LDEM_60S_240M</strong> elevation data,
                resampled to 240 m per pixel. Bilinear interpolation computes elevations and slopes.
              </p>
              <p>
                <strong>Resolution Caveat:</strong> The 240 m DEM resolves regional craters, ridges, and slopes, but
                does <em>not</em> resolve sub-metre boulders, micro-craters, or local regolith loose traps. Real slopes at rover
                wheelbase scale (1–2 m) are significantly steeper than regional 240 m averages.
              </p>
            </div>

            <div className="meth-col">
              <h5>3. Rover motion and solar panel model</h5>
              <p>
                Mobility power draws are calculated with an empirical slope penalty multiplier:
                <br />
                <code>P_locomotion = P_drive × regolith_factor × (1 + slope / 15°)</code>
                <br />
                This approximates mechanical energy expenditure across loose regolith and incline, but does not substitute
                for rigorous terramechanics wheel-soil slip modeling (Bekker equation).
              </p>
              <p>
                Solar panels are modeled with a steep tilt angle (75°–90°) optimized for grazing polar sunlight,
                with cell efficiency normalized at 28.5% (multi-junction GaAs) and user-configurable dust/radiation de-rating.
              </p>
            </div>

            <div className="meth-col">
              <h5>4. Permanent shadow and communications</h5>
              <p>
                Permanently Shadowed Regions (PSRs) represent cryogenic cold traps identified in NASA PGDA maps.
                PSR classification does <em>not</em> prove the existence of accessible surface water ice deposits.
              </p>
              <p>
                Earth visibility indicates purely geometric line-of-sight above the lunar terrain horizon. Actual radio link
                budget depends on antenna gain, transmitter power, Earth elevation above the local horizon (multipath fading),
                and Deep Space Network (DSN) ground station scheduling.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
