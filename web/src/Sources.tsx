import type { Validation } from './data'

const SOURCES = [
  { name: 'NASA LRO LOLA gridded topography (PDS): LDEM_60S_240M, LDEM_16', use: 'Terrain horizons; globe relief shading', url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm' },
  { name: 'JPL DE421 ephemeris and NAIF lunar frame kernels', use: 'Sun and Earth positions (computed with Skyfield)', url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/' },
  { name: 'Skyfield', use: 'Ephemeris library', url: 'https://rhodesmill.org/skyfield/' },
  { name: 'JPL Horizons', use: 'Reference for checking Sun and Earth positions', url: 'https://ssd.jpl.nasa.gov/horizons/' },
  { name: 'NASA PGDA Lunar Polar Illumination (Mazarico et al. 2011)', use: 'Reference for checking sunlight and Earth visibility', url: 'https://pgda.gsfc.nasa.gov/products/69' },
  { name: 'NASA SVS CGI Moon Kit (LROC WAC colour, lroc_color_2k.jpg)', use: 'Globe surface colour', url: 'https://svs.gsfc.nasa.gov/4720/' },
  { name: 'LROC, NASA, IAU Gazetteer of Planetary Nomenclature', use: 'Site coordinates (cited per site)', url: 'https://planetarynames.wr.usgs.gov/' },
  { name: 'ISRO Chandrayaan-3 mission updates', use: 'Chandrayaan-3 replay landing date and operations timeline', url: 'https://www.isro.gov.in/Chandrayaan3.html' },
  { name: 'NASA IM-1 Odysseus: LRO landing image and 23 Feb 2024 release', use: 'IM-1 replay landing time, coordinates and early operations', url: 'https://www.nasa.gov/news-release/nasa-tech-contributes-to-soft-moon-landing-agency-science-underway/' },
  { name: 'NASA, Artemis III candidate landing regions (Oct 2024); region map from George et al., LPSC 2026', use: 'Candidate landing regions on Map, Find sites and Globe (approximate centres read from the map)', url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/' },
]

/** Data sources, how the numbers were checked, and known limits. */
export function Sources({ v }: { v: Validation | null }) {
  return (
    <div className="chart" id="sources">
      <div className="chart-head">
        <h2>Data sources and validation</h2>
      </div>
      <div className="sources-grid">
        <div>
          <h3 className="mini-title">How the numbers were checked</h3>
          {v ? (
            <table className="val-table">
              <tbody>
                <tr>
                  <th scope="row">Sun and Earth direction vs JPL Horizons</th>
                  <td>
                    Max error {v.horizons.worst_deg.toFixed(5)}° over {v.horizons.samples.toLocaleString('en')} comparisons ({v.horizons.points} test points, hourly,{' '}
                    {v.horizons.period_utc[0].slice(0, 10)} to {v.horizons.period_utc[1].slice(0, 10)}). Pass mark {v.horizons.tolerance_deg}°.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Sunlit % vs NASA LOLA illumination map</th>
                  <td>
                    Correlation {v.illumination.sun.correlation.toFixed(3)}, median difference {v.illumination.sun.median_abs_diff_pp} percentage points ({v.illumination.points} random polar points, 18.6 years hourly)
                  </td>
                </tr>
                <tr>
                  <th scope="row">Earth-visible % vs NASA LOLA map</th>
                  <td>
                    Correlation {v.illumination.earth.correlation.toFixed(3)}, median difference {v.illumination.earth.median_abs_diff_pp} percentage points
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">Validation summary not found. Run pipeline/export_sites.py.</p>
          )}
          <h3 className="mini-title">Known limits</h3>
          <ul className="limits">
            <li>Terrain at 240 m per pixel (1.9 km for non-polar sites), so nearby boulders and small craters are smoothed out. This tends to overestimate light slightly on sharp peaks.</li>
            <li>Hourly time steps, so times are to the nearest hour.</li>
            <li>Panels and antenna 2 m above the ground; the horizon is treated as straight across the Sun's and Earth's discs.</li>
            <li>Solar array output = power index × 1361 W/m² × array area × efficiency. The power index is the visible part of the Sun's disc × cos(Sun elevation): a vertical panel turned to face the Sun. Not included: the Sun's distance changing over the year (about ±3.4%), temperature, dust and the lander's own shadow. Lander Systems has the detailed panel model.</li>
          </ul>
        </div>
        <div>
          <h3 className="mini-title">Sources</h3>
          <ul className="source-list">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
                <span className="muted">{s.use}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
