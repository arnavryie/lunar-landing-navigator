import { useState } from 'react'
import { ARTEMIS_3_SITES } from './data/artemisData'
import { ARTEMIS_III_URL, ARTEMIS_NOTE } from './data'

interface Props {
  onAnalyzeSite: (lat: number, lon: number) => void
  onOpen3D: () => void
  onOpenMap: () => void
  onOpenGlobe: () => void
}

export function ArtemisSection({ onAnalyzeSite, onOpen3D, onOpenMap, onOpenGlobe }: Props) {
  const [selectedId, setSelectedId] = useState<string>(ARTEMIS_3_SITES[0].id)
  const [filterIce, setFilterIce] = useState<string>('all')

  const selectedSite = ARTEMIS_3_SITES.find((s) => s.id === selectedId) ?? ARTEMIS_3_SITES[0]

  const filteredSites = ARTEMIS_3_SITES.filter((s) => {
    if (filterIce === 'all') return true
    return s.resources.water_ice_potential === filterIce
  })

  return (
    <div className="artemis-page" style={{ padding: '4px 0 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Overview Banner */}
      <div
        className="artemis-hero"
        style={{
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.8) 0%, rgba(15, 23, 42, 0.4) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: 'var(--radius-m)',
          padding: '20px 24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span
              style={{
                display: 'inline-block',
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 700,
                color: '#38bdf8',
                marginBottom: '6px',
              }}
            >
              NASA Artemis Program Candidate Landing Regions
            </span>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.4rem', color: '#f8fafc', fontWeight: 600 }}>
              Artemis III Landing Sites: Minerals, Volatiles &amp; Lander Resources
            </h2>
            <p style={{ margin: 0, fontSize: '0.88rem', color: '#94a3b8', maxWidth: '820px', lineHeight: 1.55 }}>
              On October 28, 2024, NASA downselected 9 candidate landing regions near the lunar South Pole for the Artemis III human landing mission.
              Each region contains diverse geological structures, potential water-ice cold traps, and minerals essential for In-Situ Resource Utilization (ISRU).
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <a
              href="https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.76rem',
                padding: '6px 12px',
                borderRadius: 'var(--radius-s)',
                background: 'rgba(255,255,255,0.06)',
                color: '#cbd5e1',
                border: '1px solid var(--rule)',
                textDecoration: 'none',
              }}
            >
              NASA Announcement (Oct 2024) ↗
            </a>
            <a
              href={ARTEMIS_III_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.76rem',
                padding: '6px 12px',
                borderRadius: 'var(--radius-s)',
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Artemis III Mission Page ↗
            </a>
          </div>
        </div>
      </div>

      {/* 9 Regions Quick Selector Bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#e2e8f0', fontWeight: 600 }}>
            Select Candidate Landing Region (9 Official NASA Sites)
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--muted)' }}>Filter by Water Ice:</span>
            <select
              value={filterIce}
              onChange={(e) => setFilterIce(e.target.value)}
              style={{
                background: 'rgba(15, 23, 42, 0.9)',
                color: '#e2e8f0',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius-s)',
                padding: '3px 8px',
                fontSize: '0.78rem',
              }}
            >
              <option value="all">All 9 Sites</option>
              <option value="Exceptional">Exceptional Ice Potential</option>
              <option value="Very High">Very High Ice Potential</option>
              <option value="High">High Ice Potential</option>
              <option value="Strategic">Strategic Ground / Power</option>
            </select>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
            gap: '8px',
          }}
        >
          {filteredSites.map((site) => {
            const isSelected = site.id === selectedId
            const iceBadgeBg =
              site.resources.water_ice_potential === 'Exceptional'
                ? 'rgba(34, 197, 94, 0.18)'
                : site.resources.water_ice_potential === 'Very High'
                ? 'rgba(56, 189, 248, 0.18)'
                : site.resources.water_ice_potential === 'Strategic'
                ? 'rgba(245, 158, 11, 0.18)'
                : 'rgba(168, 85, 247, 0.18)'
            const iceBadgeColor =
              site.resources.water_ice_potential === 'Exceptional'
                ? '#4ade80'
                : site.resources.water_ice_potential === 'Very High'
                ? '#38bdf8'
                : site.resources.water_ice_potential === 'Strategic'
                ? '#fbbf24'
                : '#c084fc'

            return (
              <button
                key={site.id}
                type="button"
                onClick={() => setSelectedId(site.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-s)',
                  background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                  border: isSelected ? '1px solid #38bdf8' : '1px solid var(--rule)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.86rem', color: isSelected ? '#38bdf8' : '#f1f5f9' }}>{site.name}</strong>
                  <span
                    style={{
                      fontSize: '0.64rem',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      background: iceBadgeBg,
                      color: iceBadgeColor,
                      fontWeight: 600,
                    }}
                  >
                    {site.resources.water_ice_potential}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                  {Math.abs(site.lat).toFixed(2)}° S, {Math.abs(site.lon).toFixed(1)}° {site.lon < 0 ? 'W' : 'E'} · Elev: +{site.elevation_km} km
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected Site Detailed Lander Dossier */}
      <section
        style={{
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1px solid rgba(56, 189, 248, 0.4)',
          borderRadius: 'var(--radius-m)',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Header with Title and Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc', fontWeight: 600 }}>{selectedSite.name}</h3>
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 600,
                  background: 'rgba(56, 189, 248, 0.2)',
                  color: '#38bdf8',
                  border: '1px solid currentColor',
                }}
              >
                {selectedSite.resources.water_ice_potential} Water Ice Potential
              </span>
              <span
                style={{
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 600,
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                }}
              >
                {selectedSite.minerals.crust_type}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '4px' }}>
              Coordinates: <strong>{Math.abs(selectedSite.lat).toFixed(3)}° S, {Math.abs(selectedSite.lon).toFixed(2)}° {selectedSite.lon < 0 ? 'W' : 'E'}</strong> · Summit Elevation: <strong>+{selectedSite.elevation_km} km</strong>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="primary"
              style={{
                fontSize: '0.8rem',
                padding: '6px 14px',
                background: '#0284c7',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-s)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={() => onAnalyzeSite(selectedSite.lat, selectedSite.lon)}
            >
              Analyze in Site &amp; Plan Tab →
            </button>
            <button
              type="button"
              style={{
                fontSize: '0.8rem',
                padding: '6px 12px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#e2e8f0',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius-s)',
                cursor: 'pointer',
              }}
              onClick={onOpen3D}
            >
              View 3D Terrain
            </button>
            <button
              type="button"
              style={{
                fontSize: '0.8rem',
                padding: '6px 12px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#e2e8f0',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius-s)',
                cursor: 'pointer',
              }}
              onClick={onOpenMap}
            >
              View on Map
            </button>
            <button
              type="button"
              style={{
                fontSize: '0.8rem',
                padding: '6px 12px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#e2e8f0',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius-s)',
                cursor: 'pointer',
              }}
              onClick={onOpenGlobe}
            >
              View on Globe
            </button>
          </div>
        </div>

        {/* Geological summary */}
        <p style={{ margin: 0, fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.55 }}>
          {selectedSite.geology}
        </p>

        {/* 3 Key Lander Resource Pillars */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: '14px', marginTop: '4px' }}>
          {/* Pillar 1: Water Ice & Volatiles */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.8)',
              padding: '14px 16px',
              borderRadius: 'var(--radius-s)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: '#38bdf8', fontSize: '0.9rem' }}>Water Ice &amp; Cryogenic Volatiles</strong>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Cold Trap Deposits</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.5 }}>
              {selectedSite.resources.water_ice_details}
            </p>
            <div style={{ fontSize: '0.76rem', color: 'var(--muted)', marginTop: '2px' }}>
              Subsurface Depth: <strong style={{ color: '#f1f5f9' }}>{selectedSite.resources.depth_estimate}</strong>
            </div>
            <div>
              <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginBottom: '4px' }}>Detected Volatile Inventory:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {selectedSite.resources.volatiles.map((v) => (
                  <span
                    key={v}
                    style={{
                      background: 'rgba(56, 189, 248, 0.12)',
                      color: '#7dd3fc',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontSize: '0.72rem',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                    }}
                  >
                    {v}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Pillar 2: Mineral Composition */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.8)',
              padding: '14px 16px',
              borderRadius: 'var(--radius-s)',
              border: '1px solid var(--rule)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>Crustal Mineral Composition</strong>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Lunar Geology</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {selectedSite.minerals.primary.map((m) => (
                <span
                  key={m}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#f8fafc',
                    padding: '2px 7px',
                    borderRadius: '3px',
                    fontSize: '0.74rem',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                  }}
                >
                  {m}
                </span>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.5 }}>
              {selectedSite.minerals.details}
            </p>
            <div style={{ fontSize: '0.76rem', color: 'var(--muted)', marginTop: '2px' }}>
              Crustal Category: <strong style={{ color: '#f1f5f9' }}>{selectedSite.minerals.crust_type}</strong>
            </div>
          </div>

          {/* Pillar 3: Lander In-Situ Resource Utilization (ISRU) */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.8)',
              padding: '14px 16px',
              borderRadius: 'var(--radius-s)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: '#f59e0b', fontSize: '0.9rem' }}>Lander ISRU Applications</strong>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Consumables &amp; Fuel</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.5 }}>
              {selectedSite.resources.isru_applications}
            </p>
            <div>
              <div style={{ fontSize: '0.74rem', color: 'var(--muted)', marginBottom: '4px' }}>Extractable Elements:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {selectedSite.resources.isru_elements.map((el) => (
                  <span
                    key={el}
                    style={{
                      background: 'rgba(245, 158, 11, 0.12)',
                      color: '#fde047',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontSize: '0.72rem',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                    }}
                  >
                    {el}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Operational & Strategic Context */}
        <div
          style={{
            background: 'rgba(2, 6, 23, 0.5)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-s)',
            border: '1px solid var(--rule)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '12px',
            fontSize: '0.8rem',
          }}
        >
          <div>
            <span style={{ color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>Illumination Profile:</span>
            <span style={{ color: '#f1f5f9' }}>{selectedSite.operations.illumination}</span>
          </div>
          <div>
            <span style={{ color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>Direct-to-Earth Communications:</span>
            <span style={{ color: '#f1f5f9' }}>{selectedSite.operations.earth_comms}</span>
          </div>
          <div>
            <span style={{ color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>Strategic Mission Value:</span>
            <span style={{ color: '#f1f5f9' }}>{selectedSite.operations.strategic_value}</span>
          </div>
        </div>

        <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
          Scientific Grounding: {selectedSite.source} · NASA PDS LOLA, LRO Diviner, LCROSS Spectrometry.
        </div>
      </section>

      {/* Comprehensive 9-Site Comparison Matrix Table */}
      <section
        style={{
          background: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius-m)',
          padding: '20px 24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', color: '#f8fafc', fontWeight: 600 }}>
              Comparative Resource Matrix: All 9 Artemis III Landing Regions
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
              Side-by-side comparison of mineralogy, cryogenic volatiles, water ice potential, and lander ISRU capabilities.
            </p>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.78rem',
              color: '#cbd5e1',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 10px' }}>Region Name</th>
                <th style={{ padding: '8px 10px' }}>Lat / Lon</th>
                <th style={{ padding: '8px 10px' }}>Elev.</th>
                <th style={{ padding: '8px 10px' }}>Water Ice Potential</th>
                <th style={{ padding: '8px 10px' }}>Subsurface Depth</th>
                <th style={{ padding: '8px 10px' }}>Primary Minerals</th>
                <th style={{ padding: '8px 10px' }}>Lander ISRU Utility</th>
                <th style={{ padding: '8px 10px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {ARTEMIS_3_SITES.map((site) => {
                const isCurrent = site.id === selectedId
                return (
                  <tr
                    key={site.id}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                      background: isCurrent ? 'rgba(56, 189, 248, 0.08)' : undefined,
                    }}
                  >
                    <td style={{ padding: '10px 10px', fontWeight: 600, color: isCurrent ? '#38bdf8' : '#f8fafc' }}>
                      {site.name}
                    </td>
                    <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                      {Math.abs(site.lat).toFixed(2)}° S, {Math.abs(site.lon).toFixed(1)}° {site.lon < 0 ? 'W' : 'E'}
                    </td>
                    <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                      +{site.elevation_km} km
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontWeight: 600,
                          background:
                            site.resources.water_ice_potential === 'Exceptional'
                              ? 'rgba(34, 197, 94, 0.2)'
                              : site.resources.water_ice_potential === 'Very High'
                              ? 'rgba(56, 189, 248, 0.2)'
                              : site.resources.water_ice_potential === 'Strategic'
                              ? 'rgba(245, 158, 11, 0.2)'
                              : 'rgba(168, 85, 247, 0.2)',
                          color:
                            site.resources.water_ice_potential === 'Exceptional'
                              ? '#4ade80'
                              : site.resources.water_ice_potential === 'Very High'
                              ? '#38bdf8'
                              : site.resources.water_ice_potential === 'Strategic'
                              ? '#fbbf24'
                              : '#c084fc',
                        }}
                      >
                        {site.resources.water_ice_potential}
                      </span>
                    </td>
                    <td style={{ padding: '10px 10px' }}>{site.resources.depth_estimate}</td>
                    <td style={{ padding: '10px 10px' }}>
                      <span style={{ color: '#e2e8f0' }}>{site.minerals.primary.slice(0, 2).join(', ')}</span>
                      {site.minerals.primary.length > 2 && <span style={{ color: 'var(--muted)' }}> +{site.minerals.primary.length - 2} more</span>}
                    </td>
                    <td style={{ padding: '10px 10px', maxWidth: '240px' }}>
                      <span style={{ fontSize: '0.74rem' }}>{site.resources.isru_applications}</span>
                    </td>
                    <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        style={{
                          padding: '4px 8px',
                          fontSize: '0.72rem',
                          background: isCurrent ? '#0284c7' : 'rgba(255,255,255,0.06)',
                          color: '#fff',
                          border: isCurrent ? 'none' : '1px solid var(--rule)',
                          borderRadius: 'var(--radius-s)',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setSelectedId(site.id)
                          onAnalyzeSite(site.lat, site.lon)
                        }}
                      >
                        Analyze →
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="chart-note" style={{ marginTop: '12px' }}>
          {ARTEMIS_NOTE} Mineralogy derived from Moon Mineralogy Mapper (M³) and Clementine multispectral data. Volatile quantities calibrated against NASA LCROSS impact plume ground-truth.
        </p>
      </section>
    </div>
  )
}
