"""F7: candidate landing spots for the alternatives finder (coarse stage of a coarse-to-fine search).

  .venv/Scripts/python export_candidates.py [--count]

The 85-90 S map grid (240 m) is cut into TILE x TILE pixel tiles. In each tile we keep one candidate: the pixel
with slope <= MAX_SLOPE that has the most NASA-average sunlight + Earth visibility. Each candidate gets a coarse
horizon mask (1 deg azimuth, 240 m steps; the app's exact engine uses 0.5 deg and 120 m). The browser then
computes Sun/Earth visibility for the user's own mission window from these masks, ranks the spots, and
recomputes the top few exactly.

Writes to ../web/public/data/finder/:
  candidates.f32   n x 6 float32: lat, lon (deg E), height (m), slope (deg, 240 m), NASA sunlit %, NASA Earth %
  masks.i8         n x 360 int8: horizon elevation in 0.1 deg units (clipped to +-12.7 deg), azimuth 0..359
  meta.json
"""
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from export_map import crop_n, nasa_layer
from horizon import DEM_N, DEM_SCALE_M, R_M, _dem, height_m, horizon_mask
from timeline import OBS_HEIGHT_M

OUT = Path(__file__).parent.parent / "web" / "public" / "data" / "finder"
TILE = 12  # pixels of 240 m -> 2.9 km tiles
MAX_SLOPE = 15.0  # loosest slope a user can ask for
MIN_SUN = 25.0  # NASA long-term sunlit %; spots below this rarely reach a useful window threshold


def map_lat_lon(n):
    """(lat, lon) of every pixel centre of the pole-centred n x n 240 m grid (inverse of horizon.polar_rowcol)."""
    c = n / 2 - 0.5
    rows, cols = np.mgrid[0:n, 0:n]
    x, y = (cols - c) * DEM_SCALE_M, -(rows - c) * DEM_SCALE_M
    lat = -90 + np.degrees(2 * np.arctan(np.hypot(x, y) / (2 * R_M)))
    return lat, np.degrees(np.arctan2(x, y)) % 360


def candidates():
    n = crop_n(-85)
    sun, ok = nasa_layer("AVGVISIB_85S_060M_201608", n)
    earth, _ = nasa_layer("AVGVISIB_85S_060M_201608_EARTH", n)
    sun, earth = sun * 0.004, earth * 0.004  # DN -> %
    a = DEM_N // 2 - n // 2
    dem = _dem()[a - 1:a + n + 1, a - 1:a + n + 1].astype(np.float64) * 0.5
    gx = (dem[1:-1, 2:] - dem[1:-1, :-2]) / (2 * DEM_SCALE_M)
    gy = (dem[2:, 1:-1] - dem[:-2, 1:-1]) / (2 * DEM_SCALE_M)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))  # same as the map's slope layer
    lat, lon = map_lat_lon(n)
    good = ok & (lat <= -85) & (slope <= MAX_SLOPE) & (sun >= MIN_SUN)
    score = np.where(good, sun + earth, -1)
    out = []
    for r0 in range(0, n - TILE + 1, TILE):
        for c0 in range(0, n - TILE + 1, TILE):
            t = score[r0:r0 + TILE, c0:c0 + TILE]
            k = np.unravel_index(t.argmax(), t.shape)
            if t[k] < 0:
                continue
            r, c = r0 + k[0], c0 + k[1]
            out.append((lat[r, c], lon[r, c], slope[r, c], sun[r, c], earth[r, c]))
    return np.array(out)


def coarse_horizon(ll):
    la, lo = ll
    el = horizon_mask(la, lo, az_step_deg=1.0, obs_height_m=OBS_HEIGHT_M, step_m=DEM_SCALE_M)["horizon_el_deg"]
    return np.clip(np.round(el * 10), -128, 127).astype(np.int8), float(height_m(la, lo))


def main():
    cand = candidates()
    print(f"{len(cand)} candidates ({TILE * DEM_SCALE_M / 1000:.1f} km tiles)")
    if "--count" in sys.argv:
        return
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with ProcessPoolExecutor(8) as ex:  # each worker loads the 120 MB DEM once
        res = list(ex.map(coarse_horizon, [(float(a), float(b)) for a, b in cand[:, :2]], chunksize=64))
    print(f"  horizons: {time.time() - t0:.0f} s")
    masks = np.stack([m for m, _ in res])
    heights = np.array([h for _, h in res])
    rec = np.column_stack([cand[:, 0], cand[:, 1], heights, cand[:, 2], cand[:, 3], cand[:, 4]]).astype("<f4")
    rec.tofile(OUT / "candidates.f32")
    masks.tofile(OUT / "masks.i8")
    (OUT / "meta.json").write_text(json.dumps({
        "count": len(cand), "fields": ["lat", "lon", "height_m", "slope_deg", "nasa_sun_pct", "nasa_earth_pct"],
        "mask": {"az_step_deg": 1, "unit_deg": 0.1, "clip_deg": 12.7, "range_step_m": DEM_SCALE_M},
        "tile_km": TILE * DEM_SCALE_M / 1000, "max_slope_deg": MAX_SLOPE, "min_nasa_sun_pct": MIN_SUN,
        "obs_height_m": OBS_HEIGHT_M,
        "source": "NASA LOLA LDEM_60S_240M (horizons, slope); NASA PGDA AVGVISIB maps (choosing the spot within each tile)",
    }, indent=1))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
