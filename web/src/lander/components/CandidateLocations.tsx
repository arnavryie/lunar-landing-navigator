import type { RechargeCandidate } from '../types.ts'

interface CandidateLocationsProps {
  candidates: RechargeCandidate[]
  selectedCandidateId: string | null
  recommendedCandidateId: string | null
  onSelectCandidate: (id: string) => void
}

export function CandidateLocations({
  candidates,
  selectedCandidateId,
  recommendedCandidateId,
  onSelectCandidate,
}: CandidateLocationsProps) {
  const topCandidates = candidates.slice(0, 8)

  return (
    <div className="candidates-panel" aria-label="Candidate Recharge Destinations Ranking">
      <div className="card-header" style={{ marginBottom: '8px' }}>
        <h3>
          <span style={{ color: 'var(--both)' }}>📍</span> Candidate Recharge Locations Ranking
        </h3>
        <span className="pill">{candidates.length} evaluated within search radius</span>
      </div>

      <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '0 0 12px 0' }}>
        Alternative elevated ridges and sunlit plateaus evaluated through continuous physical mission simulation. Select any candidate to preview its traverse profile, illumination window, and energy ledger.
      </p>

      <div className="candidates-table-wrap">
        <table className="candidates-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Destination</th>
              <th>Distance / Transit</th>
              <th>Direction</th>
              <th>Sunlit Window</th>
              <th>Max Slope</th>
              <th>Arrival SoC</th>
              <th>Solar Gen</th>
              <th>Net Benefit</th>
              <th>Feasibility</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {topCandidates.map((c) => {
              const isRecommended = c.id === recommendedCandidateId
              const isSelected = c.id === selectedCandidateId || (!selectedCandidateId && isRecommended)
              const sim = c.simulation
              const statusClass = sim.feasibility.toLowerCase()

              return (
                <tr key={c.id} className={`${isSelected ? 'selected-row' : ''} ${isRecommended ? 'recommended-row' : ''}`}>
                  <td style={{ fontWeight: 600 }}>
                    {isRecommended ? '★ 1' : `#${c.rankingRank}`}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: isRecommended ? 'var(--sun)' : 'var(--text)' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {Math.abs(c.lat).toFixed(3)}°S, {c.lon.toFixed(2)}°E (Elev: {c.elevationM > 0 ? '+' : ''}{c.elevationM}m)
                    </div>
                  </td>
                  <td>
                    <div>{sim.transitDistanceKm.toFixed(2)} km</div>
                    <div style={{ fontSize: '0.78rem', color: !sim.isDestinationReached ? '#f08a7a' : 'var(--muted)' }}>
                      {!sim.isDestinationReached
                        ? `Depleted @ ${(sim.failureTimeH ?? sim.transitDurationH).toFixed(1)} h`
                        : `${sim.transitDurationH.toFixed(1)} h`}
                    </div>
                  </td>
                  <td>
                    <div>{c.cardinalDirection}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {c.bearingDeg.toFixed(0)}° az
                    </div>
                  </td>
                  <td style={{ color: sim.isDestinationReached && sim.feasibility !== 'INFEASIBLE' ? 'var(--sun)' : 'var(--muted)' }}>
                    <strong>{sim.rechargeDurationH} h</strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block' }} title="Reachable recharge window (theoretical site total in brackets)">
                      {sim.feasibility === 'INFEASIBLE'
                        ? `(0h reach. / ${c.totalSunlitHoursInHorizon}h pot.)`
                        : `(${c.totalSunlitHoursInHorizon}h total)`}
                    </span>
                  </td>
                  <td style={{ color: c.route.maxSlopeDeg > 15 ? '#e5a83b' : 'var(--text)' }}>
                    {c.route.maxSlopeDeg.toFixed(1)}°
                  </td>
                  <td
                    style={{
                      fontWeight: 600,
                      color: sim.arrivalReserveMarginPct >= 0 && sim.isDestinationReached ? '#6fcf9f' : '#f08a7a',
                    }}
                  >
                    <div>{sim.arrivalSocPct.toFixed(1)}%</div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--muted)' }}>
                      {!sim.isDestinationReached
                        ? 'Stranded mid-route'
                        : sim.arrivalReserveMarginPct < 0
                        ? `Breached (${sim.arrivalBatteryKwh.toFixed(1)} kWh)`
                        : `${sim.arrivalBatteryKwh.toFixed(1)} kWh`}
                    </div>
                  </td>
                  <td style={{ color: sim.feasibility === 'INFEASIBLE' ? 'var(--muted)' : 'var(--sun)' }}>
                    <div>
                      {sim.rechargeSolarGeneratedKwh > 0 ? `+${sim.rechargeSolarGeneratedKwh.toFixed(1)} kWh` : '0.0 kWh'}
                    </div>
                    {sim.feasibility === 'INFEASIBLE' ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }} title="Theoretical solar generation at site if reachable">
                        ({sim.theoreticalSolarPotentialKwh.toFixed(1)}k site pot.)
                      </div>
                    ) : sim.rechargeCurtailedSolarKwh > 0 ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }} title="Solar energy curtailed once battery reached 100% capacity">
                        ({sim.rechargeCurtailedSolarKwh.toFixed(1)}k curtailed)
                      </div>
                    ) : null}
                  </td>
                  <td
                    style={{
                      fontWeight: 600,
                      color: sim.feasibility !== 'INFEASIBLE' && sim.netMissionEnergyBenefitKwh > 0 ? '#6fcf9f' : '#f08a7a',
                    }}
                  >
                    <div>
                      {sim.netMissionEnergyBenefitKwh > 0 ? '+' : ''}
                      {sim.netMissionEnergyBenefitKwh.toFixed(2)} kWh
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--muted)' }}>
                      {sim.feasibility === 'INFEASIBLE'
                        ? 'Unviable'
                        : `Final: ${sim.finalSocPct.toFixed(0)}%`}
                    </div>
                  </td>
                  <td>
                    <span className={`cand-status-pill ${statusClass}`}>
                      {sim.feasibility}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`btn-table-pick ${isSelected ? 'active' : ''}`}
                      onClick={() => onSelectCandidate(c.id)}
                    >
                      {isSelected ? 'Active Target' : 'Select'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
