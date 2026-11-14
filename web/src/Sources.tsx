import type { Validation } from './data'

const SOURCES = [
  { name: 'NASA LRO LOLA gridded topography (PDS): LDEM_60S_240M, LDEM_16', use: 'Terrain horizons', url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm' },
  { name: 'JPL DE421 ephemeris and NAIF lunar frame kernels', use: 'Sun and Earth positions (computed with Skyfield)', url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/' },
  { name: 'Skyfield', use: 'Ephemeris library', url: 'https://rhodesmill.org/skyfield/' },
  { name: 'JPL Horizons', use: 'Reference for checking Sun and Earth positions', url: 'https://ssd.jpl.nasa.gov/horizons/' },
  { name: 'NASA PGDA Lunar Polar Illumination (Mazarico et al. 2011)', use: 'Reference for checking sunlight and Earth visibility', url: 'https://pgda.gsfc.nasa.gov/products/69' },
  { name: 'LROC, NASA, IAU Gazetteer of Planetary Nomenclature', use: 'Site coordinates (cited per site)', url: 'https://planetarynames.wr.usgs.gov/' },
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
            <li>The power index is simplified: a vertical panel that turns to face the Sun, no efficiency or temperature effects.</li>
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
