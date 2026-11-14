"""Export mission replay datasets for real lunar landings.

Computes hourly Sun/Earth visibility around the real landing date of each sites.json entry that has a
"replay" object. Run after export_sites.py (which rewrites sites.json in web/public/data without replays).

Uses ephemeris.py with DE421 ephemeris in the MOON_ME frame,
applying the site's authentic LOLA terrain horizon mask.
"""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import numpy as np

import ephemeris
from timeline import disc_fraction, power_index, metrics, longest_run, OBS_HEIGHT_M

HERE = Path(__file__).parent
DATA_DIR = HERE.parent / "web" / "public" / "data"
SITES_DIR = DATA_DIR / "sites"

# Replay entries (facts + official sources) live in sites.json next to the 2027 sites; they carry a "replay" object.
# Each reuses the horizon of its 2027 counterpart, whose id is the replay id without "replay-".
REPLAY_CONFIGS = [s | {"base_site_id": s["id"].removeprefix("replay-")}
                  for s in json.loads((HERE / "sites.json").read_text(encoding="utf-8")) if "replay" in s]

def r(a, nd):
    return np.round(a, nd).tolist()

def main():
    sites_index_file = DATA_DIR / "sites.json"
    index_data = json.loads(sites_index_file.read_text(encoding="utf-8")) if sites_index_file.exists() else []

    # Filter out existing replay entries from index
    index_data = [s for s in index_data if not s["id"].startswith("replay-")]

    for cfg in REPLAY_CONFIGS:
        # Load base site to reuse its authentic terrain horizon and height
        base_file = SITES_DIR / f"{cfg['base_site_id']}.json"
        if not base_file.exists():
            print(f"Warning: {base_file} not found, skipping {cfg['id']}")
            continue
        base_site = json.loads(base_file.read_text(encoding="utf-8"))

        horizon = base_site["horizon"]
        site_height_m = base_site["site_height_m"]
        lat = cfg["lat"]
        lon = cfg["lon"]

        landing_dt = datetime.fromisoformat(cfg["replay"]["landing_utc"].replace("Z", "+00:00"))
        start_dt = landing_dt - timedelta(days=cfg["replay"]["days_before"])
        end_dt = landing_dt + timedelta(days=cfg["replay"]["days_after"])
        total_hours = int((end_dt - start_dt).total_seconds() // 3600)

        # Generate timestamps
        times = [start_dt + timedelta(hours=h) for h in range(total_hours)]
        t_objs = ephemeris.ts.utc([t.year for t in times], [t.month for t in times], [t.day for t in times], [t.hour for t in times])

        # Compute ephemeris vectors
        vecs = ephemeris.me_vectors(t_objs)
        aa = ephemeris.altaz_from_vectors(vecs, lat, lon, float(site_height_m) + OBS_HEIGHT_M)

        # Compute horizon clearance and disc fractions
        az_step = horizon["az_step_deg"]
        h_el = np.array(horizon["el_deg"])
        n_az = len(h_el)
        az_grid = np.linspace(0, 360, n_az, endpoint=False)

        tl = {}
        for b in ("sun", "earth"):
            hz = np.interp(aa[f"{b}_az"], az_grid, h_el, period=360)
            tl[f"{b}_frac"] = disc_fraction(aa[f"{b}_el"], aa[f"{b}_radius"], hz)
            tl[f"{b}_el"] = aa[f"{b}_el"]
            tl[f"{b}_az"] = aa[f"{b}_az"]
        tl["power"] = power_index(tl["sun_frac"], tl["sun_el"])

        m = metrics(tl)

        data = {
            **cfg,
            "site_height_m": site_height_m,
            "obs_height_m": OBS_HEIGHT_M,
            "start_utc": start_dt.strftime("%Y-%m-%dT%H:00:00Z"),
            "step_h": 1,
            "samples": total_hours,
            "metrics": m,
            "provenance": f"Terrain: NASA LOLA DEM. Ephemeris: JPL DE421 via Skyfield for historical mission epoch {start_dt.year}. Ephemeris method checked against JPL Horizons (2027).",
            "horizon": horizon,
            "sun": {
                "az": r(tl["sun_az"], 2),
                "el": r(tl["sun_el"], 3),
                "frac": r(tl["sun_frac"], 3),
                "power": r(tl["power"], 3),
            },
            "earth": {
                "az": r(tl["earth_az"], 2),
                "el": r(tl["earth_el"], 3),
                "frac": r(tl["earth_frac"], 3),
            },
        }

        out_path = SITES_DIR / f"{cfg['id']}.json"
        out_path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        print(f"Wrote {out_path} ({total_hours} hours)")

        index_data.append({
            "id": cfg["id"],
            "group": cfg["group"],
            "name": cfg["name"],
            "lat": lat,
            "lon": lon,
            "kind": cfg["kind"],
            "metrics": m,
        })

    sites_index_file.write_text(json.dumps(index_data, indent=1), encoding="utf-8")
    print(f"Updated {sites_index_file} with {len(index_data)} total sites")

if __name__ == "__main__":
    main()
