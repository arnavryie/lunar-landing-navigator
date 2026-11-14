import type { RechargeCandidate, RoverMissionConfig } from '../types.ts'

interface RechargeRecommendationProps {
  candidate: RechargeCandidate | null
  config: RoverMissionConfig
  alternativeCandidates?: RechargeCandidate[]
  onSelectCandidate?: (id: string) => void
}

export function RechargeRecommendation({
  candidate,
  config,
  alternativeCandidates = [],
  onSelectCandidate,
}: RechargeRecommendationProps) {
  if (!candidate) {
    return (
      <div className="recommendation-card infeasible" aria-label="Recharge Recommendation">
        <div className="rec-header">
          <div>
            <div className="rec-pretitle">PRIMARY MISSION RECOMMENDATION</div>
            <h3 className="rec-title">
              <span style={{ color: '#e0705c' }}>✕</span> NO SUITABLE RECHARGE LOCATION FOUND
            </h3>
          </div>
          <span className="rec-badge infeasible">INSUFFICIENT ENERGY</span>
        </div>
        <p className="rec-summary" style={{ color: '#f08a7a' }}>
          No candidate terrain within the configured {config.mission.searchRadiusKm.toFixed(1)} km search radius can be reached
          without violating the rover's {config.battery.minReservePct.toFixed(0)}% battery reserve threshold or traversing unsafe slopes.
        </p>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>
          Recommendations: Increase initial state of charge, reduce drive speed to lower motor draw, or extend search radius.
        </p>
      </div>
    )
  }

  const sim = candidate.simulation
  const verdictClass = sim.feasibility.toLowerCase()
  const isPositiveBenefit = sim.netMissionEnergyBenefitKwh > 0

  const departureDateStr = new Date(
    Date.parse('2027-01-01T00:00:00Z') + config.mission.startHourIndex * 3600000,
  )
    .toISOString()
    .replace('T', ' ')
    .replace(':00.000Z', ' UTC')

  const arrivalDateStr = new Date(
    Date.parse('2027-01-01T00:00:00Z') + (config.mission.startHourIndex + Math.ceil(sim.transitDurationH)) * 3600000,
  )
    .toISOString()
    .replace('T', ' ')
    .replace(':00.000Z', ' UTC')

  // Find 2 alternative candidates for comparison
  const nextBestAlternatives = alternativeCandidates
    .filter((c) => c.id !== candidate.id)
    .slice(0, 2)

  return (
    <div className={`recommendation-card ${verdictClass}`} aria-label="Recommended Recharge Location Card">
      {/* Header */}
      <div className="rec-header">
        <div>
          <div className="rec-pretitle">PRIMARY MISSION RECOMMENDATION</div>
          <h3 className="rec-title">
            <span style={{ color: 'var(--sun)' }}>★</span> {candidate.name}
          </h3>
        </div>
        <span className={`rec-badge ${verdictClass}`}>
          {sim.recommendationVerdict}
        </span>
      </div>

      <div className="rec-summary">{sim.verdictReason}</div>

      {sim.feasibility === 'INFEASIBLE' && (
        <div style={{ background: 'rgba(224, 112, 92, 0.12)', border: '1px solid #e0705c', borderRadius: '4px', padding: '10px 14px', marginBottom: '14px', fontSize: '0.84rem', color: '#f08a7a' }}>
          <strong>MISSION INFEASIBLE:</strong> {sim.failureReason}
        </div>
      )}

      {/* Hero Telemetry Grid */}
      <div className="rec-hero-grid">
        <div className="rec-hero-item">
          <span className="rec-hero-label">Target Direction</span>
          <span className="rec-hero-val" style={{ color: 'var(--earth)' }}>
            {candidate.cardinalDirection}
          </span>
          <span className="rec-hero-sub">Azimuth {candidate.bearingDeg.toFixed(0)}°</span>
        </div>

        <div className="rec-hero-item">
          <span className="rec-hero-label">Traverse Distance</span>
          <span className="rec-hero-val">{sim.transitDistanceKm.toFixed(2)} km</span>
          <span className="rec-hero-sub">
            {!sim.isDestinationReached
              ? `Stranded @ ${(sim.failureDistanceKm ?? 0).toFixed(2)} km`
              : `Elev: ${candidate.elevationM > 0 ? '+' : ''}${candidate.elevationM} m`}
          </span>
        </div>

        <div className="rec-hero-item">
          <span className="rec-hero-label">Transit Time</span>
          <span className="rec-hero-val">{sim.transitDurationH.toFixed(1)} h</span>
          <span className="rec-hero-sub">
            {!sim.isDestinationReached
              ? `Halted @ ${(sim.failureTimeH ?? 0).toFixed(1)} h (0% SoC)`
              : `@${config.mobility.speedKmh} km/h (Max ${candidate.route.maxSlopeDeg.toFixed(0)}°)`}
          </span>
        </div>

        <div className="rec-hero-item">
          <span className="rec-hero-label">Continuous Sun</span>
          <span className="rec-hero-val" style={{ color: sim.isDestinationReached && sim.feasibility !== 'INFEASIBLE' ? 'var(--sun)' : 'var(--muted)' }}>
            {sim.rechargeDurationH} h
          </span>
          <span className="rec-hero-sub">
            {sim.feasibility === 'INFEASIBLE'
              ? `Reachable: 0h (${candidate.totalSunlitHoursInHorizon}h pot.)`
              : `Total ${candidate.totalSunlitHoursInHorizon}h in window`}
          </span>
        </div>

        <div className="rec-hero-item">
          <span className="rec-hero-label">Arrival Battery</span>
          <span
            className="rec-hero-val"
            style={{
              color: sim.arrivalReserveMarginPct >= 5 && sim.isDestinationReached ? '#6fcf9f' : sim.arrivalReserveMarginPct >= 0 && sim.isDestinationReached ? '#e5a83b' : '#f08a7a',
            }}
          >
            {sim.arrivalSocPct.toFixed(1)}%
          </span>
          <span className="rec-hero-sub">
            {!sim.isDestinationReached
              ? 'Stranded mid-route'
              : `${sim.arrivalBatteryKwh.toFixed(2)} kWh (${sim.arrivalReserveMarginPct >= 0 ? '+' : ''}${sim.arrivalReserveMarginPct.toFixed(1)}% vs res)`}
          </span>
        </div>

        <div className="rec-hero-item">
          <span className="rec-hero-label">Net Mission Benefit</span>
          <span
            className="rec-hero-val"
            style={{ color: isPositiveBenefit && sim.feasibility !== 'INFEASIBLE' ? '#6fcf9f' : '#f08a7a' }}
          >
            {isPositiveBenefit && sim.feasibility !== 'INFEASIBLE' ? '+' : ''}{sim.netMissionEnergyBenefitKwh.toFixed(2)} kWh
          </span>
          <span className="rec-hero-sub">
            {sim.feasibility === 'INFEASIBLE'
              ? `Final SoC: ${sim.finalSocPct.toFixed(0)}% (Aborted)`
              : `Final SoC: ${sim.finalSocPct.toFixed(0)}% (${sim.finalBatteryKwh.toFixed(1)} kWh)`}
          </span>
        </div>
      </div>

      {/* Authoritative Mission Energy Reconciliation Ledger */}
      <div className="rec-breakdown-table">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
            Authoritative Mission Energy Ledger
          </span>
          <span
            className="pill"
            style={{
              fontSize: '0.72rem',
              color: sim.isEnergyConserved ? '#6fcf9f' : '#f08a7a',
              border: `1px solid ${sim.isEnergyConserved ? 'var(--both)' : '#e0705c'}`,
            }}
          >
            {sim.isEnergyConserved ? '✔ Energy Balance Conserved (Δ = 0.00 kWh)' : '⚠ Energy Ledger Discrepancy'}
          </span>
        </div>

        <dl className="metric-table">
          <dt>Coordinates &amp; Heading</dt>
          <dd>
            {Math.abs(candidate.lat).toFixed(4)}°S, {candidate.lon.toFixed(3)}°E ({candidate.cardinalDirection}, {candidate.bearingDeg.toFixed(0)}°)
          </dd>

          <dt>Mission Departure (T+0h)</dt>
          <dd>{departureDateStr}</dd>

          <dt>Predicted Arrival (T+{sim.transitDurationH.toFixed(1)}h)</dt>
          <dd>{arrivalDateStr}</dd>

          <dt>1. Initial Stored Battery Energy</dt>
          <dd style={{ fontWeight: 600 }}>
            {sim.initialBatteryKwh.toFixed(2)} kWh <span className="muted">({sim.departureSocPct.toFixed(1)}% SoC)</span>
          </dd>

          <dt>2. Transit Locomotion Drive Draw</dt>
          <dd style={{ color: '#f08a7a' }}>
            −{sim.transitMobilityEnergyKwh.toFixed(2)} kWh{' '}
            <span className="muted">({sim.transitDurationH.toFixed(1)}h @ {((sim.transitMobilityEnergyKwh / sim.transitDurationH) * 1000).toFixed(0)} W avg)</span>
          </dd>

          <dt>3. Transit Hotel Subsystems Load</dt>
          <dd style={{ color: '#f08a7a' }}>
            −{sim.transitHotelEnergyKwh.toFixed(2)} kWh <span className="muted">(thermal, avionics, comms, standby)</span>
          </dd>

          <dt>4. Transit Solar Harvesting (if illuminated)</dt>
          <dd style={{ color: 'var(--sun)' }}>
            +{sim.transitSolarGeneratedKwh.toFixed(2)} kWh
          </dd>

          <dt style={{ borderTop: '1px dashed var(--rule)', paddingTop: '4px' }}>
            <strong>= Arrival Battery State</strong>
          </dt>
          <dd style={{ borderTop: '1px dashed var(--rule)', paddingTop: '4px', fontWeight: 600 }}>
            {sim.arrivalBatteryKwh.toFixed(2)} kWh{' '}
            <span style={{ color: sim.arrivalReserveMarginPct >= 0 ? '#6fcf9f' : '#f08a7a' }}>
              ({sim.arrivalSocPct.toFixed(1)}% SoC, {sim.arrivalReserveMarginPct >= 0 ? '+' : ''}{sim.arrivalReserveMarginPct.toFixed(1)}% reserve margin)
            </span>
          </dd>

          <dt>5. Gross Solar Generated at Ridge (Credited)</dt>
          <dd style={{ color: sim.rechargeSolarGeneratedKwh > 0 ? 'var(--sun)' : 'var(--muted)', fontWeight: 600 }}>
            +{sim.rechargeSolarGeneratedKwh.toFixed(2)} kWh{' '}
            <span className="muted">
              {sim.feasibility === 'INFEASIBLE'
                ? `(0.00 kWh credited; ${sim.theoreticalSolarPotentialKwh.toFixed(2)} kWh unharvested site potential)`
                : `(${sim.rechargeDurationH}h sunlit window)`}
            </span>
          </dd>

          <dt>6. Subsystems Consumption During Recharge</dt>
          <dd style={{ color: sim.rechargeHotelEnergyKwh > 0 ? '#f08a7a' : 'var(--muted)' }}>
            −{sim.rechargeHotelEnergyKwh.toFixed(2)} kWh{' '}
            <span className="muted">
              {sim.rechargeDurationH > 0
                ? `(${sim.rechargeDurationH}h @ ${((sim.rechargeHotelEnergyKwh / Math.max(1, sim.rechargeDurationH)) * 1000).toFixed(0)} W)`
                : '(0h recharge dwell)'}
            </span>
          </dd>

          <dt>
            <strong>= Reachable Net Solar Potential</strong>
          </dt>
          <dd style={{ fontWeight: 600 }}>
            {sim.reachableRechargePotentialKwh >= 0 ? '+' : ''}{sim.reachableRechargePotentialKwh.toFixed(2)} kWh{' '}
            <span className="muted">
              {sim.feasibility === 'INFEASIBLE'
                ? `(Reachable: 0.00 kWh; Theoretical site net: ${sim.theoreticalRechargePotentialKwh.toFixed(2)} kWh)`
                : '(generation minus hotel before battery limit)'}
            </span>
          </dd>

          <dt>7. Curtailed Solar Energy (overflow beyond 100% capacity)</dt>
          <dd style={{ color: 'var(--muted)' }}>
            −{sim.rechargeCurtailedSolarKwh.toFixed(2)} kWh{' '}
            <span className="muted">
              {sim.rechargeCurtailedSolarKwh > 0
                ? `(unusable once battery reached ${config.battery.totalCapacityKwh.toFixed(1)} kWh cap)`
                : '(none curtailed)'}
            </span>
          </dd>

          <dt style={{ borderTop: '1px dashed var(--rule)', paddingTop: '4px' }}>
            <strong>= Actual Stored Energy Added to Battery</strong>
          </dt>
          <dd style={{ borderTop: '1px dashed var(--rule)', paddingTop: '4px', color: sim.rechargeStoredEnergyKwh > 0 ? '#6fcf9f' : 'var(--muted)', fontWeight: 600 }}>
            +{sim.rechargeStoredEnergyKwh.toFixed(2)} kWh
          </dd>

          <dt style={{ borderTop: '1px solid var(--rule)', paddingTop: '6px' }}>
            <strong>Final Stored Battery Energy</strong>
          </dt>
          <dd style={{ borderTop: '1px solid var(--rule)', paddingTop: '6px', fontWeight: 600 }}>
            {sim.finalBatteryKwh.toFixed(2)} kWh <span className="muted">({sim.finalSocPct.toFixed(1)}% SoC)</span>
          </dd>

          <dt>
            <strong>Primary Mission Net Energy Benefit</strong>
          </dt>
          <dd style={{ color: isPositiveBenefit && sim.feasibility !== 'INFEASIBLE' ? '#6fcf9f' : '#f08a7a', fontWeight: 700, fontSize: '0.95rem' }}>
            {isPositiveBenefit && sim.feasibility !== 'INFEASIBLE' ? '+' : ''}{sim.netMissionEnergyBenefitKwh.toFixed(2)} kWh{' '}
            <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
              {sim.feasibility === 'INFEASIBLE'
                ? `(Net loss of ${Math.abs(sim.netMissionEnergyBenefitKwh).toFixed(2)} kWh due to failed recharge)`
                : `(Final ${sim.finalBatteryKwh.toFixed(2)} kWh − Initial ${sim.initialBatteryKwh.toFixed(2)} kWh)`}
            </span>
          </dd>
        </dl>
      </div>

      {/* Alternative Candidate Comparison Section (Priority 4) */}
      {nextBestAlternatives.length > 0 && (
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '10px' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: '8px' }}>
            Comparison with Next-Best Alternatives
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
            {nextBestAlternatives.map((alt) => (
              <div
                key={alt.id}
                style={{
                  background: 'var(--night)',
                  border: '1px solid var(--rule)',
                  borderRadius: 'var(--radius-s)',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>
                    #{alt.rankingRank} {alt.name}
                  </span>
                  <span className={`cand-status-pill ${alt.feasibility.toLowerCase()}`}>
                    {alt.feasibility}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                  {alt.distanceKm.toFixed(2)} km ({alt.cardinalDirection}) • {alt.sunlitWindowDurationH}h sun
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                  <span style={{ fontSize: '0.78rem', color: alt.netMissionBenefitKwh > 0 ? '#6fcf9f' : '#f08a7a' }}>
                    Net: {alt.netMissionBenefitKwh > 0 ? '+' : ''}{alt.netMissionBenefitKwh.toFixed(2)} kWh (Arr: {alt.arrivalSocPct.toFixed(0)}%)
                  </span>
                  {onSelectCandidate && (
                    <button
                      type="button"
                      className="btn-link"
                      style={{ fontSize: '0.75rem', color: 'var(--earth)', padding: 0 }}
                      onClick={() => onSelectCandidate(alt.id)}
                    >
                      Compare →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
