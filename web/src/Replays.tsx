import { formatDeg, formatDuration, hoursToChange, type Site } from './data'
import './styles/evidence.css'

interface ReplayMissionMeta {
  id: string
  name: string
  lander: string
  agency: string
  landingUtc: string
  coordinates: string
  summary: string
  outcome: string
  sourceName: string
  sourceUrl: string
}

export const REPLAY_MISSIONS: ReplayMissionMeta[] = [
  {
    id: 'replay-chandrayaan-3',
    name: 'Chandrayaan-3 Vikram',
    lander: 'Vikram Lander + Pragyan Rover',
    agency: 'ISRO (India)',
    landingUtc: '2023-08-23T12:32:00Z',
    coordinates: '69.37° S, 32.32° E (Shiv Shakti Point)',
    summary: 'First soft landing in the lunar south polar region (~600 km from the pole).',
    outcome:
      'Landed under full solar illumination. Solar panels powered the lander, deployed the Pragyan rover, and completed 14 Earth days of experiments until sunset on Sep 2-4, 2023, when payloads were set to sleep.',
    sourceName: 'ISRO Chandrayaan-3 Mission Operations Update',
    sourceUrl: 'https://www.isro.gov.in/Chandrayaan3_Details.html',
  },
  {
    id: 'replay-im1-odysseus',
    name: 'IM-1 Odysseus (Nova-C)',
    lander: 'Intuitive Machines Nova-C',
    agency: 'NASA CLPS / Intuitive Machines',
    landingUtc: '2024-02-22T23:23:00Z',
    coordinates: '80.13° S, 1.44° E (Malapert A)',
    summary: 'First commercial lander on the Moon; landed near Malapert A (~300 km from the pole).',
    outcome:
      'Touched down on a ~12° slope and rested tilted at ~30°. Top-mounted solar panels received sunlight, enabling direct-to-Earth communication and telemetry downlink until lunar nightfall on Feb 29, 2024.',
    sourceName: 'NASA & Intuitive Machines IM-1 Mission Summary',
    sourceUrl: 'https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/',
  },
]

interface ReplaysProps {
  currentSite: Site | null
  currentHourIndex: number
  onLoadReplay: (siteId: string, hourIndex: number) => void
}

export function Replays({ currentSite, currentHourIndex, onLoadReplay }: ReplaysProps) {
  return (
    <div className="replays-section">
      <div className="replays-header">
        <div>
          <h4>Historic Mission Replays (Evidence & Ground Truth)</h4>
          <p className="replays-subtitle">
            Evaluate our topocentric physics engine against real lunar landing dates and official agency outcomes.
          </p>
        </div>
      </div>

      <div className="replays-grid">
        {REPLAY_MISSIONS.map((m) => {
          const isSelected = currentSite?.id === m.id
          const landingDate = new Date(m.landingUtc)

          // If this replay site is currently loaded, evaluate live metrics at current time index
          const sunFrac = isSelected && currentSite ? currentSite.sun.frac[currentHourIndex] ?? 0 : null
          const sunEl = isSelected && currentSite ? currentSite.sun.el[currentHourIndex] ?? 0 : null
          const earthFrac = isSelected && currentSite ? currentSite.earth.frac[currentHourIndex] ?? 0 : null
          const earthEl = isSelected && currentSite ? currentSite.earth.el[currentHourIndex] ?? 0 : null
          const hToSunset = isSelected && currentSite ? hoursToChange(currentSite.sun.frac, currentHourIndex) : null
          const hToEarthset = isSelected && currentSite ? hoursToChange(currentSite.earth.frac, currentHourIndex) : null

          const handleLoad = () => {
            // Landing hour offset = 2 days before = 48 hours from start_utc
            const hourOffset = 48
            onLoadReplay(m.id, hourOffset)
          }

          return (
            <div key={m.id} className={`replay-card ${isSelected ? 'active' : ''}`}>
              <div className="replay-card-top">
                <div>
                  <span className="replay-agency">{m.agency}</span>
                  <h5 className="replay-title">{m.name}</h5>
                  <span className="replay-meta">
                    {landingDate.toUTCString().slice(5, 22)} UTC · {m.coordinates}
                  </span>
                </div>
                <button
                  type="button"
                  className={`replay-btn ${isSelected ? 'selected' : ''}`}
                  onClick={handleLoad}
                >
                  {isSelected ? '✓ Loaded' : 'Load Replay'}
                </button>
              </div>

              <p className="replay-summary">{m.summary}</p>

              {isSelected && currentSite && (
                <div className="replay-live-analysis">
                  <div className="live-analysis-header">
                    <strong>Our Model at Touchdown Time:</strong>
                  </div>
                  <div className="live-chips">
                    <span className={`eval-chip ${sunFrac && sunFrac > 0 ? 'sunlit' : 'dark'}`}>
                      {sunFrac && sunFrac > 0 ? `☀️ Sunlit (${formatDeg(sunEl ?? 0)})` : '🌑 Sun Blocked'}
                      {hToSunset !== null && ` · Sunset in ${formatDuration(hToSunset)}`}
                    </span>
                    <span className={`eval-chip ${earthFrac && earthFrac > 0 ? 'earth' : 'no-earth'}`}>
                      {earthFrac && earthFrac > 0 ? `🌍 Earth in View (${formatDeg(earthEl ?? 0)})` : '🚫 Earth Occulted'}
                      {hToEarthset !== null && ` · Earthset in ${formatDuration(hToEarthset)}`}
                    </span>
                  </div>

                  <div className="replay-outcome-box">
                    <span className="outcome-label">What Really Happened:</span>
                    <p className="outcome-text">{m.outcome}</p>
                    <a
                      href={m.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="outcome-citation"
                    >
                      Source: {m.sourceName} ↗
                    </a>
                  </div>

                  <div className="replay-honesty-note">
                    Note: Our calculations assume an upright 2 m mast on 240 m LOLA terrain. Non-vertical lander tilt, local boulders, or crater rim shadows smaller than 240 m are not modelled.
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
