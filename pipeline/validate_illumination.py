"""Phase 1 gate, step 3: our sunlit % and Earth-visible % vs NASA's LOLA illumination maps.

Reference: AVGVISIB_85S_060M_201608 (+ _EARTH), LOLA team, method of Mazarico et al. 2011
(Icarus 211, 1066-1081): % of hourly timesteps over an 18.6-year lunar nutation cycle with
any part of the Sun (or Earth) disc visible, from a 60 m DEM.
Ours uses a 240 m DEM, so we average their map over our 240 m pixel before comparing.

Run:  .venv/Scripts/python validate_illumination.py
Writes ../validation/step3_illumination.json; exits 1 if the pass criteria fail.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ephemeris import me_vectors, ts
from horizon import LOLA, polar_rowcol
from timeline import site_timeline

# Pass criteria, fixed before the run: both maps must correlate >= 0.9 with ours and
# the median absolute difference must be <= 5 percentage points.
MIN_CORR, MAX_MEDIAN_DIFF_PP = 0.9, 5.0
N_POINTS, SEED = 80, 1
OBS_HEIGHT_M = 0.0  # NASA maps are for the surface
# ponytail: the exact 18.6-year window NASA used isn't in the label; any full
# nutation cycle gives nearly the same average.
START_YEAR, YEARS = 2009, 18.6
REF_N, REF_SCALE = 5058, 60.0
REPORT = Path(__file__).parent.parent / "validation" / "step3_illumination.json"


def ref_map(name):
    return np.fromfile(LOLA / f"{name}.IMG", "<i2").reshape(REF_N, REF_N) * 0.00004 * 100  # -> %


def ref_at(m, lat, lon):
    """Mean of the 4x4 block of 60 m pixels covering our 240 m footprint."""
    row, col = polar_rowcol(lat, lon, REF_N, REF_SCALE)
    i, j = int(np.floor(row)) - 1, int(np.floor(col)) - 1
    return float(m[i:i + 4, j:j + 4].mean())


def main():
    rng = np.random.default_rng(SEED)
    lats = rng.uniform(-89.8, -85.5, N_POINTS)
    lons = rng.uniform(0, 360, N_POINTS)
    n = int(round(YEARS * 365.25 * 24))
    print(f"ephemeris: {n} hourly steps from {START_YEAR} ...")
    vecs = me_vectors(ts.utc(START_YEAR, 1, 1, range(n)))
    refs = {"sun": ref_map("AVGVISIB_85S_060M_201608"), "earth": ref_map("AVGVISIB_85S_060M_201608_EARTH")}

    rows = []
    for k, (lat, lon) in enumerate(zip(lats, lons)):
        tl = site_timeline(lat, lon, vecs, obs_height_m=OBS_HEIGHT_M)
        row = {"lat_deg": round(lat, 4), "east_lon_deg": round(lon, 4)}
        for b in ("sun", "earth"):
            row[f"{b}_ours_pct"] = round(100 * float((tl[f"{b}_frac"] > 0).mean()), 2)
            row[f"{b}_nasa_pct"] = round(ref_at(refs[b], lat, lon), 2)
        rows.append(row)
        print(f"{k + 1:3d} {lat:8.3f} {lon:7.2f}  sun ours {row['sun_ours_pct']:6.2f} nasa {row['sun_nasa_pct']:6.2f}"
              f"   earth ours {row['earth_ours_pct']:6.2f} nasa {row['earth_nasa_pct']:6.2f}")

    summary, passed = {}, True
    for b in ("sun", "earth"):
        ours = np.array([r[f"{b}_ours_pct"] for r in rows])
        nasa = np.array([r[f"{b}_nasa_pct"] for r in rows])
        d = ours - nasa
        s = {
            "correlation": round(float(np.corrcoef(ours, nasa)[0, 1]), 4),
            "median_abs_diff_pp": round(float(np.median(np.abs(d))), 2),
            "mean_diff_pp": round(float(d.mean()), 2),
            "p90_abs_diff_pp": round(float(np.percentile(np.abs(d), 90)), 2),
            "max_abs_diff_pp": round(float(np.abs(d).max()), 2),
        }
        s["passed"] = s["correlation"] >= MIN_CORR and s["median_abs_diff_pp"] <= MAX_MEDIAN_DIFF_PP
        passed &= s["passed"]
        summary[b] = s
        print(f"\n{b}: {s}")

    REPORT.write_text(json.dumps({
        "check": "Sunlit % and Earth-visible % (any part of disc) vs NASA LOLA AVGVISIB_85S_060M_201608 maps",
        "ours": f"LDEM_75S_240M horizon, obs height {OBS_HEIGHT_M} m, {YEARS} yr hourly from {START_YEAR}",
        "criteria": {"min_correlation": MIN_CORR, "max_median_abs_diff_pp": MAX_MEDIAN_DIFF_PP},
        "summary": summary, "passed": bool(passed), "points": rows,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, indent=1))
    print(f"\n{'PASS' if passed else 'FAIL'}  report: {REPORT}")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
