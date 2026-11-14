"""F6c: relief (normal) map for the whole-Moon globe, from our global LOLA DEM.

  .venv/Scripts/python export_globe.py

Writes ../web/public/data/globe/relief.png: equirectangular, 0 E in the centre and 180 W at the left edge
(same layout as NASA's CGI Moon Kit colour map), row 0 at 90 N. Each pixel is the local surface normal
in (east, north, up) components, stored as (c * 0.5 + 0.5) * 255 in R, G, B.
The colour map (lroc_color_2k.jpg) is NASA's CGI Moon Kit file, copied unchanged (credited in the app's Sources panel).
"""
from pathlib import Path

import numpy as np

from export_map import png_gray
from horizon import GLOBAL_PPD, R_M, _global

OUT = Path(__file__).parent.parent / "web" / "public" / "data" / "globe"
DOWN = 4  # 16 px/deg -> 4 px/deg (1440 x 720, ~7.6 km/px at the equator; matches the 2k colour map)


def relief_normals(h_m, ppd):
    """Local (east, north, up) unit normals of an equirectangular height grid, row 0 at 90 N, columns wrap."""
    rows, cols = h_m.shape
    lat = np.radians(90 - (np.arange(rows) + 0.5) / ppd)
    step = np.radians(1 / ppd) * R_M
    dh_dcol = (np.roll(h_m, -1, 1) - np.roll(h_m, 1, 1)) / 2
    dh_drow = np.gradient(h_m, axis=0)
    # ponytail: east spacing clamped near the poles (equirectangular rows collapse there); the 3D terrain view covers 80-90 S properly
    de = dh_dcol / (step * np.maximum(np.cos(lat), 0.02))[:, None]
    dn = -dh_drow / step
    n = np.stack([-de, -dn, np.ones_like(h_m)], axis=-1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def self_check():
    """A plane rising 1 m per 100 m to the east must tilt the normal west by atan(0.01)."""
    ppd = 4
    lon_m = (np.arange(360 * ppd) + 0.5) / ppd * np.radians(1) * R_M
    h = np.tile(lon_m * 0.01, (180 * ppd, 1))
    n = relief_normals(h, ppd)[180 * ppd // 2, 10]  # equator row, away from the wrap seam
    assert abs(n[0] + 0.01 / np.sqrt(1.0001)) < 1e-4 and abs(n[1]) < 1e-9, n
    print("relief self-check ok", n.round(5))


def main():
    self_check()
    OUT.mkdir(parents=True, exist_ok=True)
    h = _global().astype(np.float64) * 0.5
    n = relief_normals(h, GLOBAL_PPD)
    n = np.roll(n, n.shape[1] // 2, axis=1)  # 0 E at the left -> 180 W at the left, 0 E centred
    r, c = n.shape[0] // DOWN, n.shape[1] // DOWN
    n = n.reshape(r, DOWN, c, DOWN, 3).mean(axis=(1, 3))
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    png_gray(OUT / "relief.png", np.round((n * 0.5 + 0.5) * 255))
    print("wrote", OUT / "relief.png", n.shape)


if __name__ == "__main__":
    main()
