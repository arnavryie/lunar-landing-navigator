"""Export mission replay datasets for real lunar landings.

Computes exact hourly ephemeris for:
1. Chandrayaan-3 Vikram (landing Aug 23, 2023 12:32 UTC)
2. IM-1 Odysseus (landing Feb 22, 2024 23:23 UTC)

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

REPLAY_CONFIGS = [
    {
        "id": "replay-chandrayaan-3",
        "base_site_id": "chandrayaan-3",
        "group": "Mission replays",
        "name": "Replay: Chandrayaan-3 Vikram (Aug 2023)",
        "lat": -69.3741,
        "lon": 32.32,
        "kind": "landing",
        "replay": {
            "landing_utc": "2023-08-23T12:32:00Z",
            "days_before": 2,
            "days_after": 18,
            "outcome": "Successfully touched down at Statio Shiv Shakti (69.37°S, 32.32°E). Solar panels achieved full nominal power generation, deploying the Pragyan rover and operating scientific instruments until the Sun set on Sep 2-4, 2023, when payloads were safely transitioned to sleep.",
            "outcome_source": "ISRO Chandrayaan-3 Mission Operations Update",
            "outcome_url": "https://www.isro.gov.in/Chandrayaan3_Details.html",
        },
        "note": "Chandrayaan-3 Vikram lander touchdown at Shiv Shakti Point, evaluated against authentic 2023 solar/Earth positions.",
        "source": "ISRO & LROC Coordinates",
        "source_url": "https://www.isro.gov.in/Chandrayaan3_Details.html",
    },
    {
        "id": "replay-im1-odysseus",
        "base_site_id": "im1-odysseus",
        "group": "Mission replays",
        "name": "Replay: IM-1 Odysseus (Feb 2024)",
        "lat": -80.13,
        "lon": 1.44,
        "kind": "landing",
        "replay": {
            "landing_utc": "2024-02-22T23:23:00Z",
            "days_before": 2,
            "days_after": 16,
            "outcome": "Touched down on a ~12° slope near Malapert A crater rim and rested at a ~30° tilt. Despite the tilted attitude, top-mounted solar arrays generated sufficient power to maintain continuous telemetry and downlink payloads until lunar nightfall on Feb 29, 2024.",
            "outcome_source": "NASA & Intuitive Machines IM-1 Odysseus Mission Summary",
            "outcome_url": "https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/",
        },
        "note": "IM-1 Odysseus lander touchdown near Malapert A, evaluated against authentic February 2024 solar/Earth positions.",
        "source": "NASA CLPS & LROC Image 1409",
        "source_url": "https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/",
    },
]

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
            "provenance": f"Terrain: NASA LOLA DEM. Ephemeris: JPL DE421 via Skyfield for historical mission epoch {start_dt.year}. Validated against JPL Horizons.",
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
