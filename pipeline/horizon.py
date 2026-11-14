"""Terrain horizon mask for a lunar site, from LOLA, incl. curvature.

For each azimuth (clockwise from north, same convention as ephemeris.py) we
march outward along the great circle and keep the highest elevation angle of
the terrain. Geometry is exact on a 1737.4 km sphere, so the lunar curvature
drop (~d^2/2R) is built in. No atmosphere, so no refraction.

Terrain: the 240 m south polar LOLA map (60-90 S) where it has data, else the
global LOLA map at 16 px/deg (~1.9 km/px) for low-latitude contrast sites.

  python horizon.py    self-checks (synthetic terrain + DEM orientation)
App data files are written by export_sites.py.
"""
from functools import cache
from pathlib import Path

import numpy as np

R_M = 1737400.0  # LOLA reference sphere
HERE = Path(__file__).parent
LOLA = HERE / "data" / "lola"

# PDS LRO-L-LOLA-4-GDR-V1.0, frame MEAN EARTH/POLAR AXIS OF DE421 (same as ephemeris.py).
# ponytail: one 240 m DEM for near and far terrain; small obstacles within ~1 km are
# smoothed out. Upgrade: nest a 20-60 m DEM (ldem_85s_20m / ldem_80s_40m) for the first few km.
DEM_FILE, DEM_N, DEM_SCALE_M = "ldem_60s_240m.img", 7760, 240.0
GLOBAL_FILE, GLOBAL_PPD = "ldem_16.img", 16  # 2880 x 5760, row 0 at 90 N, col 0 at 0 E
MAX_RANGE_M = 500_000.0


@cache
def _dem():
    return np.fromfile(LOLA / DEM_FILE, "<i2").reshape(DEM_N, DEM_N)


@cache
def _global():
    return np.fromfile(LOLA / GLOBAL_FILE, "<i2").reshape(180 * GLOBAL_PPD, 360 * GLOBAL_PPD)


def polar_rowcol(lat_deg, lon_deg, n, scale_m):
    """Fractional 0-based (row, col) in a LOLA south polar stereographic map of n x n pixels.

    0 E points up (row decreasing), 90 E points right. The forward formula in the
    PDS DSMAP_POLAR.CAT is mirrored east-west; this orientation was verified
    against the global LOLA map (see self_check).
    """
    r = 2 * R_M * np.tan(np.radians(90 + np.asarray(lat_deg)) / 2)
    lon = np.radians(lon_deg)
    c = n / 2 - 0.5
    return c - r * np.cos(lon) / scale_m, c + r * np.sin(lon) / scale_m


def _bilinear(grid, row, col, wrap_cols=False):
    n_r, n_c = grid.shape
    i0, j0 = np.floor(row).astype(int), np.floor(col).astype(int)
    ok = (i0 >= 0) & (i0 < n_r - 1)
    if wrap_cols:
        j0, j1 = j0 % n_c, (j0 + 1) % n_c
    else:
        ok &= (j0 >= 0) & (j0 < n_c - 1)
        j1 = j0 + 1
    i0, j0, j1 = np.where(ok, i0, 0), np.where(ok, j0, 0), np.where(ok, j1, 0)
    fi, fj = row - np.floor(row), col - np.floor(col)
    h = (grid[i0, j0] * (1 - fi) * (1 - fj) + grid[i0, j1] * (1 - fi) * fj
         + grid[i0 + 1, j0] * fi * (1 - fj) + grid[i0 + 1, j1] * fi * fj) * 0.5  # DN * 0.5 m
    return np.where(ok, h, np.nan)


def polar_height_m(lat_deg, lon_deg):
    """240 m polar map only; NaN outside it."""
    return _bilinear(_dem(), *polar_rowcol(lat_deg, lon_deg, DEM_N, DEM_SCALE_M))


def global_height_m(lat_deg, lon_deg):
    row = (90 - np.asarray(lat_deg)) * GLOBAL_PPD - 0.5
    col = np.asarray(lon_deg) % 360 * GLOBAL_PPD - 0.5
    return _bilinear(_global(), row, col, wrap_cols=True)


def height_m(lat_deg, lon_deg):
    """LOLA height above the 1737.4 km sphere: 240 m polar map, falling back to the global map."""
    h = polar_height_m(lat_deg, lon_deg)
    missing = np.isnan(h)
    if missing.any():
        h = np.where(missing, global_height_m(lat_deg, lon_deg), h)
    return h


def dem_source(lat_deg, lon_deg):
    if np.isnan(polar_height_m(lat_deg, lon_deg)):
        return f"LOLA {GLOBAL_FILE.split('.')[0].upper()} (~1.9 km/px, global)"
    return f"LOLA {DEM_FILE.split('.')[0].upper()} (240 m/px)"


def horizon_mask(lat_deg, lon_deg, az_step_deg=0.5, obs_height_m=2.0, step_m=120.0, height=height_m):
    """Return dict: az_deg, horizon_el_deg, range_m (how far terrain data reached), edge_limited."""
    az = np.arange(0.0, 360.0, az_step_deg)
    d = np.arange(step_m, MAX_RANGE_M, step_m)
    delta = d / R_M
    th = np.radians(az)[:, None]
    p1, l1 = np.radians(lat_deg), np.radians(lon_deg)
    lat2 = np.arcsin(np.sin(p1) * np.cos(delta) + np.cos(p1) * np.sin(delta) * np.cos(th))
    lon2 = l1 + np.arctan2(np.sin(th) * np.sin(delta) * np.cos(p1), np.cos(delta) - np.sin(p1) * np.sin(lat2))
    h = height(np.degrees(lat2), np.degrees(lon2))
    r0 = R_M + float(height(lat_deg, lon_deg)) + obs_height_m
    rp = R_M + h
    el = np.degrees(np.arctan2(rp * np.cos(delta) - r0, rp * np.sin(delta)))  # exact, curvature included
    valid = ~np.isnan(el)
    last = np.where(valid.any(axis=1), valid.shape[1] - 1 - np.argmax(valid[:, ::-1], axis=1), 0)
    el = np.where(valid, el, -np.inf)
    best = el.argmax(axis=1)
    return {
        "az_deg": az,
        "horizon_el_deg": el.max(axis=1),
        "range_m": d[last],
        "edge_limited": best >= last - 1,  # max came from the DEM edge: horizon may be underestimated
    }


def _enu(lat_deg, lon_deg):
    p, l = np.radians(lat_deg), np.radians(lon_deg)
    up = np.array([np.cos(p) * np.cos(l), np.cos(p) * np.sin(l), np.sin(p)])
    east = np.array([-np.sin(l), np.cos(l), 0.0])
    north = np.cross(up, east)
    return up, east, north


def self_check():
    # 1) Synthetic 5 km Gaussian mountain 50 km away at bearing 30 deg. Its expected
    #    elevation is computed independently with 3D vectors and local east/north axes,
    #    so this checks azimuth convention, great-circle stepping and curvature.
    lat0, lon0, H, D, bearing, obs = -88.0, 40.0, 5000.0, 50_000.0, 30.0, 2.0
    up, east, north = _enu(lat0, lon0)
    b = np.radians(bearing)
    u_peak = np.cos(D / R_M) * up + np.sin(D / R_M) * (np.cos(b) * north + np.sin(b) * east)

    def bump(lat, lon):
        p, l = np.radians(lat), np.radians(lon)
        u = np.stack([np.cos(p) * np.cos(l), np.cos(p) * np.sin(l), np.sin(p)], axis=-1)
        chord = np.linalg.norm(u - u_peak, axis=-1) * R_M
        return H * np.exp(-((chord / 3000.0) ** 2))

    P, S = (R_M + H) * u_peak, (R_M + obs) * up
    expected = np.degrees(np.arcsin((P - S) @ up / np.linalg.norm(P - S)))
    m = horizon_mask(lat0, lon0, az_step_deg=1.0, obs_height_m=obs, height=bump)
    got = m["horizon_el_deg"][int(bearing)]
    approx = np.degrees(np.arctan((H - obs - D**2 / (2 * R_M)) / D))
    print(f"synthetic peak: expected {expected:.4f}  got {got:.4f}  (flat-earth-minus-d^2/2R approx {approx:.4f})")
    assert abs(got - expected) < 0.02, "horizon geometry wrong"
    assert m["horizon_el_deg"].argmax() == int(bearing), "azimuth convention wrong"
    assert m["horizon_el_deg"][int(bearing) + 180] < 0, "mountain leaked to the opposite side"

    # 2) DEM orientation: polar map must agree with the global LOLA map (16 px/deg).
    rng = np.random.default_rng(0)
    lat, lon = rng.uniform(-79.5, -62, 2000), rng.uniform(0, 360, 2000)
    diff = np.median(np.abs(polar_height_m(lat, lon) - global_height_m(lat, lon)))
    flipped = np.median(np.abs(polar_height_m(lat, -lon) - global_height_m(lat, lon)))
    print(f"polar vs global DEM: median |diff| {diff:.0f} m (mirrored map: {flipped:.0f} m)")
    assert diff < 200 < flipped, "polar DEM orientation wrong"
    print("self-check PASS")


if __name__ == "__main__":
    self_check()
