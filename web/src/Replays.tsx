import { formatDeg, formatDuration, hoursToChange, replayAtLanding, type Site } from './data'
import './styles/evidence.css'

// Card list shown before a replay is loaded. Facts and sources come from the loaded site (pipeline/sites.json).
export const REPLAY_MISSIONS = [
  {
    id: 'replay-chandrayaan-3',
    name: 'Chandrayaan-3 Vikram',
    agency: 'ISRO (India)',
    when: '23 Aug 2023',
    coordinates: '69.37° S, 32.32° E (Statio Shiv Shakti)',
    summary: 'About 620 km from the pole.',
  },
  {
    id: 'replay-im1-odysseus',
    name: 'IM-1 Odysseus (Nova-C)',
    agency: 'NASA CLPS / Intuitive Machines',
    when: '22 Feb 2024, 23:24 UTC',
    coordinates: '80.13° S, 1.44° E (near Malapert A)',
    summary: 'About 300 km from the pole.',
  },
]

// The replay windows start days_before = 2 days ahead of landing (pipeline/sites.json), so landing is hour 48.
const LANDING_HOUR = 48

const fmtDate = (d: Date) => d.toUTCString().slice(5, 22) + ' UTC'

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
          <h4>Mission replays</h4>
          <p className="replays-subtitle">
            Real landers at their real landing dates: what our model shows, next to what the agency reported.
          </p>
        </div>
      </div>

      <div className="replays-grid">
        {REPLAY_MISSIONS.map((m) => {
          const s = currentSite?.id === m.id && currentSite.replay ? currentSite : null
          const i = currentHourIndex
          const hToSunset = s ? hoursToChange(s.sun.frac, i) : null
          const hToEarthset = s ? hoursToChange(s.earth.frac, i) : null
          const atLanding = s ? replayAtLanding(s) : null

          return (
            <div key={m.id} className={`replay-card ${s ? 'active' : ''}`}>
              <div className="replay-card-top">
                <div>
                  <span className="replay-agency">{m.agency}</span>
                  <h5 className="replay-title">{m.name}</h5>
                  <span className="replay-meta">
                    {m.when} · {m.coordinates}
                  </span>
                </div>
                <button type="button" className={`replay-btn ${s ? 'selected' : ''}`} onClick={() => onLoadReplay(m.id, LANDING_HOUR)}>
                  {s ? '✓ Loaded' : 'Load replay'}
                </button>
              </div>

              <p className="replay-summary">{m.summary}</p>

              {s && atLanding && (
                <div className="replay-live-analysis">
                  <div className="live-analysis-header">
                    <strong>Our model {i === atLanding.i ? 'at the landing hour' : 'at the selected hour'}:</strong>
                  </div>
                  <div className="live-chips">
                    <span className={`eval-chip ${s.sun.frac[i] > 0 ? 'sunlit' : 'dark'}`}>
                      {s.sun.frac[i] > 0 ? `☀️ Sunlit (${formatDeg(s.sun.el[i])})` : '🌑 Sun blocked'}
                      {hToSunset !== null && ` · ${s.sun.frac[i] > 0 ? 'sunset' : 'sunrise'} in ${formatDuration(hToSunset)}`}
                    </span>
                    <span className={`eval-chip ${s.earth.frac[i] > 0 ? 'earth' : 'no-earth'}`}>
                      {s.earth.frac[i] > 0 ? `🌍 Earth in view (${formatDeg(s.earth.el[i])})` : '🚫 Earth hidden'}
                      {hToEarthset !== null && ` · ${s.earth.frac[i] > 0 ? 'Earthset' : 'Earthrise'} in ${formatDuration(hToEarthset)}`}
                    </span>
                  </div>
                  <p className="replay-summary">
                    Our first sunset after landing: {atLanding.sunset ? fmtDate(atLanding.sunset) : 'not within the replay window'}.
                    {' '}First Earthset: {atLanding.earthset ? fmtDate(atLanding.earthset) : 'none within the replay window'}.
                  </p>

                  <div className="replay-outcome-box">
                    <span className="outcome-label">What the agency reported:</span>
                    <p className="outcome-text">{s.replay!.outcome}</p>
                    <a href={s.replay!.outcome_url} target="_blank" rel="noopener noreferrer" className="outcome-citation">
                      Source: {s.replay!.outcome_source} ↗
                    </a>
                  </div>

                  <div className="replay-honesty-note">
                    {s.replay!.landing_note && <>{s.replay!.landing_note} </>}
                    Our numbers are for an upright 2 m mast at these coordinates on 240 m terrain, in hourly steps. The lander's
                    real tilt, boulders and terrain smaller than 240 m aren't modelled.
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
