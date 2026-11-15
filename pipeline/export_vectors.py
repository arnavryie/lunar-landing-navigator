"""Sun and Earth vectors for any calendar year, so the app can plan any landing year.

  .venv/Scripts/python export_vectors.py 2028            one year
  .venv/Scripts/python export_vectors.py 2024-2040       a range
  .venv/Scripts/python export_vectors.py --check         2027 matches the file export_map.py wrote

Writes ../web/public/data/map/vectors_<year>.f32 (hourly from 1 Jan 00:00 UTC, 8760 or 8784 hours;
same layout as export_map.py: float32 [sun x,y,z, earth x,y,z] km, MOON_ME frame, from the Moon's centre)
and lists the years in meta.json ("vectors.years"). The app recomputes every site for the chosen year
from these vectors and the site's stored terrain horizon, with the same maths as the 2027 data.
DE421 and the lunar orientation kernel cover 1900-2050.
"""
import json
import sys
from pathlib import Path

import numpy as np

from ephemeris import me_vectors, ts

OUT = Path(__file__).parent.parent / "web" / "public" / "data" / "map"
FIRST, LAST = 1900, 2049  # moon_pa_de421_1900-2050.bpc; the last year must end before 2050-01-01


def hours_in(year):
    return 8784 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 8760


def vectors(year):
    v = me_vectors(ts.utc(year, 1, 1, range(hours_in(year))))
    return np.concatenate([v["sun"], v["earth"]]).T.astype("<f4")


def write(years):
    for y in years:
        if not FIRST <= y <= LAST:
            sys.exit(f"{y}: the ephemeris covers {FIRST}-{LAST}")
        vectors(y).tofile(OUT / f"vectors_{y}.f32")
        print("wrote", f"vectors_{y}.f32")
    meta_path = OUT / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    have = sorted(int(p.stem.split("_")[1]) for p in OUT.glob("vectors_*.f32"))
    meta["vectors"]["years"] = have
    meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print("years in meta.json:", have[0], "-", have[-1], f"({len(have)})")


def check():
    old = np.fromfile(OUT / "vectors_2027.f32", dtype="<f4")
    new = vectors(2027).ravel()
    assert old.shape == new.shape, (old.shape, new.shape)
    assert np.array_equal(old, new), np.abs(old - new).max()
    assert hours_in(2028) == 8784 and hours_in(2100) == 8760 and hours_in(2000) == 8784
    print("check: regenerated 2027 is identical to vectors_2027.f32 -> PASS")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--check"]:
        check()
    elif len(args) == 1 and "-" in args[0]:
        a, b = map(int, args[0].split("-"))
        write(range(a, b + 1))
    elif args:
        write(int(a) for a in args)
    else:
        sys.exit(__doc__)
