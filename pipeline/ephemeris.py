"""Sun and Earth direction (azimuth, elevation) as seen from a site on the Moon.

Frame: MOON_ME (mean-Earth / polar axis), DE421-era lunar orientation, so
libration is included. Elevation is relative to the local *flat* horizon:
no terrain, no curvature, no refraction (the Moon has no atmosphere).
Azimuth is measured clockwise from north (north = 0, east = 90).

Two steps so many sites can share one ephemeris run:
  me_vectors(t)                   apparent Sun/Earth vectors from the Moon's centre, MOON_ME frame
  altaz_from_vectors(v, lat, lon) topocentric az/el for one site (subtracts the site position,
                                  so Earth parallax, up to ~0.26 deg, is exact)
Validated against JPL Horizons by validate_horizons.py.
"""
from pathlib import Path

import numpy as np
from skyfield.api import Loader, PlanetaryConstants

KERNELS = Path(__file__).parent / "kernels"
load = Loader(KERNELS)

ts = load.timescale()
eph = load("de421.bsp")
pc = PlanetaryConstants()
pc.read_text(load("moon_080317.tf"))
pc.read_text(load("pck00008.tpc"))
pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
MOON_ME = pc.build_frame_named("MOON_ME_DE421")

R_MOON_KM = 1737.4
RADIUS_KM = {"sun": 695700.0, "earth": 6378.137}


def me_vectors(t):
    """{'sun': (3, n) km, 'earth': (3, n) km}: apparent positions seen from the Moon's centre."""
    centre = eph["moon"].at(t)
    return {b: centre.observe(eph[b]).apparent().frame_xyz(MOON_ME).km for b in RADIUS_KM}


def altaz_from_vectors(vecs, lat_deg, lon_deg, elevation_m=0.0):
    """Return dict of arrays (deg): {body}_az, {body}_el, {body}_radius (angular radius of the disc)."""
    p, l = np.radians(lat_deg), np.radians(lon_deg)
    up = np.array([np.cos(p) * np.cos(l), np.cos(p) * np.sin(l), np.sin(p)])
    east = np.array([-np.sin(l), np.cos(l), 0.0])
    north = np.cross(up, east)
    site = (R_MOON_KM + elevation_m / 1000) * up
    out = {}
    for b, v in vecs.items():
        topo = v - site[:, None] if v.ndim == 2 else v - site
        dist = np.linalg.norm(topo, axis=0)
        out[f"{b}_az"] = np.degrees(np.arctan2(east @ topo, north @ topo)) % 360
        out[f"{b}_el"] = np.degrees(np.arcsin(up @ topo / dist))
        out[f"{b}_radius"] = np.degrees(np.arcsin(RADIUS_KM[b] / dist))
    return out


def sun_earth_altaz(lat_deg, lon_deg, t, elevation_m=0.0):
    """Convenience: one site. lat/lon selenographic, east-positive longitude."""
    return altaz_from_vectors(me_vectors(t), lat_deg, lon_deg, elevation_m)


if __name__ == "__main__":
    t = ts.utc(2027, 1, 1, 0)
    for k, v in sun_earth_altaz(-89.5, 0.0, t).items():
        print(f"{k:12s} {v:9.4f}")
