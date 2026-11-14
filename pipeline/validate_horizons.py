"""Phase 1 gate, step 1: compare our Sun/Earth az/el against JPL Horizons.

Run:  .venv/Scripts/python validate_horizons.py
Horizons replies are cached in reference/horizons/ so re-runs work offline.
Writes ../validation/step1_horizons.json and exits 1 if any difference
exceeds TOLERANCE_DEG.
"""
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ephemeris import sun_earth_altaz, ts

TOLERANCE_DEG = 0.01  # ~2% of the Sun's 0.53 deg disk
START, STOP, STEP = "2027-01-01 00:00", "2027-01-31 00:00", "1h"
# Test points, not real sites: near the pole, polar region, and mid-latitude
# (catches azimuth-convention errors a near-pole point can hide). (lat, east lon)
# Avoid round values like (-45, 0) and (-45, 90): on 2026-11-14 Horizons returned
# Moon-CENTRE elevations there (site offset ignored, ~0.25 deg error for Earth),
# while 7 other probe points matched our topocentric values to ~0.0002 deg.
POINTS = {"near_pole": (-89.5, 0.0), "polar": (-84.0, 155.0), "mid_lat": (-44.6, 91.2)}
BODIES = {"sun": "10", "earth": "399"}

HERE = Path(__file__).parent
CACHE = HERE / "reference" / "horizons"
REPORT = HERE.parent / "validation" / "step1_horizons.json"


def horizons(body_id, lat, lon):
    """Return (datetimes, az, el) from Horizons, airless apparent, site alt 0 km."""
    path = CACHE / f"{body_id}_{lat}_{lon}_{START[:10]}_{STOP[:10]}_{STEP}.txt"
    if not path.exists():
        q = lambda v: f"'{v}'"
        params = {
            "format": "json", "COMMAND": q(body_id), "OBJ_DATA": q("NO"),
            "MAKE_EPHEM": q("YES"), "EPHEM_TYPE": q("OBSERVER"),
            "CENTER": q("coord@301"), "COORD_TYPE": q("GEODETIC"),
            "SITE_COORD": q(f"{lon},{lat},0"), "START_TIME": q(START),
            "STOP_TIME": q(STOP), "STEP_SIZE": q(STEP), "QUANTITIES": q("4"),
            "APPARENT": q("AIRLESS"), "ANG_FORMAT": q("DEG"),
            "CSV_FORMAT": q("YES"), "EXTRA_PREC": q("YES"),
        }
        url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=60) as r:
            text = json.load(r)["result"]
        if "$$SOE" not in text:
            sys.exit(f"Horizons returned no table:\n{text[:2000]}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    text = path.read_text()
    rows = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    times, az, el = [], [], []
    for row in rows:
        cols = [c.strip() for c in row.split(",")]
        times.append(datetime.strptime(cols[0], "%Y-%b-%d %H:%M"))
        az.append(float(cols[3]))
        el.append(float(cols[4]))
    return times, np.array(az), np.array(el)


def separation_deg(az1, el1, az2, el2):
    """Angle between two sky directions (robust for tiny angles)."""
    def vec(az, el):
        a, e = np.radians(az), np.radians(el)
        return np.stack([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
    v1, v2 = vec(az1, el1), vec(az2, el2)
    cross = np.linalg.norm(np.cross(v1, v2, axis=0), axis=0)
    return np.degrees(np.arctan2(cross, (v1 * v2).sum(axis=0)))


def main():
    results, worst = [], 0.0
    for pname, (lat, lon) in POINTS.items():
        for body, body_id in BODIES.items():
            times, h_az, h_el = horizons(body_id, lat, lon)
            t = ts.utc([d.year for d in times], [d.month for d in times],
                       [d.day for d in times], [d.hour for d in times],
                       [d.minute for d in times])
            ours = sun_earth_altaz(lat, lon, t)
            sep = separation_deg(ours[f"{body}_az"], ours[f"{body}_el"], h_az, h_el)
            d_el = np.abs(ours[f"{body}_el"] - h_el)
            r = {
                "point": pname, "lat_deg": lat, "east_lon_deg": lon, "body": body,
                "samples": len(times),
                "max_separation_deg": float(sep.max()),
                "max_elevation_diff_deg": float(d_el.max()),
                "mean_separation_deg": float(sep.mean()),
            }
            results.append(r)
            worst = max(worst, r["max_separation_deg"])
            print(f"{pname:9s} {body:5s} n={r['samples']}  max sep {r['max_separation_deg']:.6f} deg"
                  f"  max |d_el| {r['max_elevation_diff_deg']:.6f} deg")

    passed = worst <= TOLERANCE_DEG
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({
        "check": "Sun/Earth topocentric az/el: Skyfield (DE421, MOON_ME_DE421) vs JPL Horizons (DE441, MEAN_ME), airless",
        "period_utc": [START, STOP], "step": STEP, "tolerance_deg": TOLERANCE_DEG,
        "worst_separation_deg": worst, "passed": passed, "results": results,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, indent=2))
    print(f"\nworst {worst:.6f} deg vs tolerance {TOLERANCE_DEG} deg -> {'PASS' if passed else 'FAIL'}")
    print(f"report: {REPORT}")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
