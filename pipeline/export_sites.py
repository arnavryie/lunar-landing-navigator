"""Write the precomputed data files the web app loads.

  .venv/Scripts/python export_sites.py

For every site in sites.json: terrain horizon + hourly Sun/Earth az/el and
visible-disc fractions. Output: ../web/public/data/sites.json (index) and
../web/public/data/sites/<id>.json.
"""
import json
from pathlib import Path

import numpy as np

from ephemeris import me_vectors, ts
from horizon import dem_source, height_m, horizon_mask
from timeline import OBS_HEIGHT_M, metrics, site_timeline

HERE = Path(__file__).parent
OUT = HERE.parent / "web" / "public" / "data"
# ponytail: analysis period is still an open team decision; 1 year from 2027 for now.
START_YEAR, HOURS = 2027, 8760
INDEX_KEYS = ("id", "group", "name", "lat", "lon", "kind")


def provenance(lat, lon):
    return (f"Terrain: NASA {dem_source(lat, lon)}. Ephemeris: JPL DE421 via Skyfield, MOON_ME frame. "
            "Curvature included, no refraction. Validated against JPL Horizons and NASA LOLA "
            "illumination maps.")


def r(a, nd):
    return np.round(a, nd).tolist()


def main():
    sites = json.loads((HERE / "sites.json").read_text(encoding="utf-8"))
    vecs = me_vectors(ts.utc(START_YEAR, 1, 1, range(HOURS)))
    (OUT / "sites").mkdir(parents=True, exist_ok=True)
    index = []
    for s in sites:
        mask = horizon_mask(s["lat"], s["lon"], obs_height_m=OBS_HEIGHT_M)
        tl = site_timeline(s["lat"], s["lon"], vecs, mask=mask)
        m = metrics(tl)
        data = {
            **s,
            "site_height_m": round(float(height_m(s["lat"], s["lon"])), 1),
            "obs_height_m": OBS_HEIGHT_M,
            "start_utc": f"{START_YEAR}-01-01T00:00:00Z", "step_h": 1, "samples": HOURS,
            "metrics": m,
            "provenance": provenance(s["lat"], s["lon"]),
            "horizon": {"az_step_deg": 0.5, "el_deg": r(mask["horizon_el_deg"], 2),
                        "edge_limited_azimuths": int(mask["edge_limited"].sum())},
            "sun": {"az": r(tl["sun_az"], 2), "el": r(tl["sun_el"], 3), "frac": r(tl["sun_frac"], 3),
                    "power": r(tl["power"], 3)},
            "earth": {"az": r(tl["earth_az"], 2), "el": r(tl["earth_el"], 3), "frac": r(tl["earth_frac"], 3)},
        }
        (OUT / "sites" / f"{s['id']}.json").write_text(json.dumps(data, separators=(",", ":")))
        index.append({k: s[k] for k in INDEX_KEYS} | {"metrics": m})
        print(s["id"], m)
    (OUT / "sites.json").write_text(json.dumps(index, indent=1))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
