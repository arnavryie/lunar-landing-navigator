"""Step 3: per-site timelines of Sun visibility (power) and Earth visibility (DTE).

Combines ephemeris.py (Sun/Earth direction) with horizon.py (terrain horizon).
"Visible" means any part of the disc is above the terrain horizon, the same
definition NASA's LOLA illumination maps use.

  python timeline.py --check    disc-fraction self-check
App data files are written by export_sites.py.
"""
import numpy as np

from ephemeris import altaz_from_vectors
from horizon import height_m, horizon_mask

OBS_HEIGHT_M = 2.0  # height of panels / antenna above the ground


def disc_fraction(el, radius, horizon_el):
    """Visible fraction (0-1) of a disc centred at `el` with angular `radius`, above `horizon_el`.

    ponytail: the horizon is treated as a straight line across the disc (Sun 0.53 deg,
    Earth ~1.9 deg wide). Upgrade: sample the mask across the disc's azimuth span.
    """
    x = np.clip((el - horizon_el) / radius, -1.0, 1.0)
    return 1 - (np.arccos(x) - x * np.sqrt(1 - x * x)) / np.pi


def site_timeline(lat, lon, vecs, mask=None, obs_height_m=OBS_HEIGHT_M):
    if mask is None:
        mask = horizon_mask(lat, lon, obs_height_m=obs_height_m)
    aa = altaz_from_vectors(vecs, lat, lon, float(height_m(lat, lon)) + obs_height_m)
    out = {}
    for b in ("sun", "earth"):
        hz = np.interp(aa[f"{b}_az"], mask["az_deg"], mask["horizon_el_deg"], period=360)
        out[f"{b}_frac"] = disc_fraction(aa[f"{b}_el"], aa[f"{b}_radius"], hz)
        out[f"{b}_el"] = aa[f"{b}_el"]
        out[f"{b}_az"] = aa[f"{b}_az"]
    out["power"] = power_index(out["sun_frac"], out["sun_el"])
    return out


def power_index(sun_frac, sun_el):
    """Simplified power-potential index, 0-1: visible Sun-disc fraction x incidence factor
    for a vertical panel that turns to face the Sun (cos of Sun elevation).
    ponytail: no panel efficiency, temperature or shadowing by the lander itself."""
    return sun_frac * np.cos(np.radians(sun_el))


def longest_run(b):
    """Length of the longest run of True values (runs touching the period ends are truncated)."""
    if not b.any():
        return 0
    d = np.diff(np.r_[0, b.astype(np.int8), 0])
    return int((np.flatnonzero(d == -1) - np.flatnonzero(d == 1)).max())


def metrics(tl, step_h=1.0):
    sun, earth = tl["sun_frac"] > 0, tl["earth_frac"] > 0
    return {
        "sunlit_pct": round(100 * float(sun.mean()), 2),
        "mean_sun_disc_pct": round(100 * float(tl["sun_frac"].mean()), 2),
        "mean_power_index_pct": round(100 * float(tl["power"].mean()), 2),
        "earth_visible_pct": round(100 * float(earth.mean()), 2),
        "sun_and_earth_pct": round(100 * float((sun & earth).mean()), 2),
        "longest_dark_h": longest_run(~sun) * step_h,
        "longest_no_earth_h": longest_run(~earth) * step_h,
    }


def self_check():
    # Disc fraction vs brute-force pixel counting of a unit disc cut by a line.
    g = np.linspace(-1, 1, 2001)
    X, Y = np.meshgrid(g, g)
    inside = X**2 + Y**2 <= 1
    for off in (-1.2, -0.7, -0.2, 0.0, 0.3, 0.9, 1.5):
        brute = (inside & (Y > -off)).sum() / inside.sum()  # line `off` radii below centre
        got = disc_fraction(off, 1.0, 0.0)
        assert abs(got - brute) < 2e-3, (off, got, brute)
    assert longest_run(np.array([1, 1, 0, 1, 1, 1, 0], bool)) == 3
    assert longest_run(np.zeros(5, bool)) == 0
    # Power index: full disc at 0 deg -> 1; full disc at 60 deg -> 0.5; hidden -> 0.
    assert np.allclose(power_index(np.array([1.0, 1.0, 0.0]), np.array([0.0, 60.0, 1.0])), [1.0, 0.5, 0.0])
    print("self-check PASS")


if __name__ == "__main__":
    self_check()
