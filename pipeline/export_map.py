"""F6a: data for the 2D south-pole map and the in-browser click-anywhere engine.

  .venv/Scripts/python export_map.py

Writes to ../web/public/data/map/:
  dem_80s_240m.i16   LOLA heights (int16 DN, x0.5 m) cropped to 80-90 S, n x n, south polar stereographic,
                     same orientation as horizon.py (0 E up, 90 E right). Used for horizons, relief and slope.
  vectors_2027.f32   apparent Sun and Earth vectors from the Moon's centre, MOON_ME frame, km, float32,
                     hourly for the analysis year: [sun x,y,z, earth x,y,z] per hour.
  sun_pct.png, earth_pct.png, psr.png
                     NASA PGDA layers resampled to our 240 m grid over 85-90 S (8-bit grey; 255 = no data).
  meta.json          grid sizes, offsets and sources.
  check.json         Python results for test points, which web/scripts/check-engine.ts must reproduce.
"""
import json
import struct
import zlib
from pathlib import Path

import numpy as np

from ephemeris import me_vectors, ts
from export_sites import HOURS, START_YEAR
from horizon import DEM_N, DEM_SCALE_M, LOLA, R_M, _dem, horizon_mask
from timeline import OBS_HEIGHT_M, metrics, site_timeline

HERE = Path(__file__).parent
OUT = HERE.parent / "web" / "public" / "data" / "map"
NASA_N, NASA_SCALE = 5058, 60.0


def crop_n(lat_edge):
    """Even pixel count of a pole-centred square reaching lat_edge (deg S) at 240 m."""
    r = 2 * R_M * np.tan(np.radians(90 - abs(lat_edge)) / 2)
    return 2 * int(np.ceil(r / DEM_SCALE_M))


def png_gray(path, a):
    """Minimal 8-bit greyscale PNG writer (stdlib only)."""
    h, w = a.shape
    raw = b"".join(b"\x00" + row.tobytes() for row in a.astype(np.uint8))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def nasa_layer(name, n_map):
    """Mean of the 4x4 NASA 60 m pixels under each of our 240 m map pixels; 255 where outside."""
    m = np.fromfile(LOLA / f"{name}.IMG", "<i2").reshape(NASA_N, NASA_N).astype(np.float32)
    c, cn = n_map / 2 - 0.5, NASA_N / 2 - 0.5
    centre = cn + (np.arange(n_map) - c) * 4  # our pixel centre in NASA index space (x.5)
    idx = np.floor(centre - 1.5).astype(int)[:, None] + np.arange(4)  # 4 NASA pixels per axis
    ok = (idx >= 0).all(1) & (idx < NASA_N).all(1)
    idx = np.clip(idx, 0, NASA_N - 1)
    block = m[idx[:, None, :, None], idx[None, :, None, :]].mean(axis=(2, 3))
    return block, ok[:, None] & ok[None, :]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dem = _dem()
    c60 = DEM_N // 2
    n_dem = crop_n(-80)
    a = c60 - n_dem // 2
    dem[a:a + n_dem, a:a + n_dem].astype("<i2").tofile(OUT / "dem_80s_240m.i16")

    t = ts.utc(START_YEAR, 1, 1, range(HOURS))
    vecs = me_vectors(t)
    np.concatenate([vecs["sun"], vecs["earth"]]).T.astype("<f4").tofile(OUT / f"vectors_{START_YEAR}.f32")

    n_map = crop_n(-85)
    sun, ok = nasa_layer("AVGVISIB_85S_060M_201608", n_map)
    earth, _ = nasa_layer("AVGVISIB_85S_060M_201608_EARTH", n_map)
    psr, _ = nasa_layer("LPSR_85S_060M_201608", n_map)
    to_pct = lambda x: np.where(ok, np.clip(np.round(x * 0.004), 0, 100), 255)  # DN*0.00004*100
    png_gray(OUT / "sun_pct.png", to_pct(sun))
    png_gray(OUT / "earth_pct.png", to_pct(earth))
    png_gray(OUT / "psr.png", np.where(ok, (psr > 0) * 100, 255))  # DN +20000 = shadowed, -20000 = not; 100 here = shadowed

    (OUT / "meta.json").write_text(json.dumps({
        "dem": {"file": "dem_80s_240m.i16", "n": n_dem, "scale_m": DEM_SCALE_M, "lat_edge": -80, "dn_to_m": 0.5,
                "source": "NASA LOLA LDEM_60S_240M (PDS), cropped"},
        "vectors": {"file": f"vectors_{START_YEAR}.f32", "hours": HOURS, "start_utc": f"{START_YEAR}-01-01T00:00:00Z",
                    "source": "JPL DE421 + MOON_ME_DE421 via Skyfield, apparent, from the Moon's centre"},
        "layers": {"n": n_map, "scale_m": DEM_SCALE_M, "lat_edge": -85,
                   "source": "NASA PGDA Lunar Polar Illumination (Mazarico et al. 2011), 60 m, averaged to 240 m"},
        "obs_height_m": OBS_HEIGHT_M, "r_moon_m": R_M,
    }, indent=1))

    # Reference results the browser engine must match.
    rng = np.random.default_rng(7)
    pts = [(-89.4749, 222.557), (-89.67, 129.78)] + list(zip(rng.uniform(-89.8, -85.5, 6), rng.uniform(0, 360, 6)))
    sample_h = [0, 1234, 4321, 8000]
    checks = []
    for lat, lon in pts:
        mask = horizon_mask(lat, lon, obs_height_m=OBS_HEIGHT_M)
        tl = site_timeline(lat, lon, vecs, mask=mask)
        checks.append({
            "lat": float(lat), "lon": float(lon), "metrics": metrics(tl),
            "horizon_el": mask["horizon_el_deg"].round(4).tolist(),
            "samples": [{"h": h, **{f"{b}_{q}": float(tl[f"{b}_{q}"][h]) for b in ("sun", "earth") for q in ("az", "el", "frac")}}
                        for h in sample_h],
        })
        print(f"check point {lat:.3f} {lon:.2f}: {checks[-1]['metrics']}")
    (OUT / "check.json").write_text(json.dumps(checks))
    print("wrote", OUT, "dem", n_dem, "map", n_map)


if __name__ == "__main__":
    main()
