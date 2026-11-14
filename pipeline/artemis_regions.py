"""NASA's nine south-pole candidate landing regions (Oct 2024) as approximate centre points.

NASA publishes the regions only as boxes on a map, with no coordinates. This reads each box centre off
NASA's map and converts it to latitude/longitude:
  - Map: "The 9 candidate landing regions", Credit NASA/GSFC/ASU/JSC/AGDT, Image 1 in George et al.,
    "Artemis III Site Selection Update: Downselection From Thirteen to Nine Candidate Regions", LPSC 2026
    (https://ntrs.nasa.gov/citations/20250011660), 709 x 548 px. Same map as the 28 Oct 2024 NASA release.
  - Pixel positions were measured from the yellow box outlines; the pole from the green star; the scale
    from the 0-25-50 km bar (0 km at x=22, 50 km at x=110.5, so 1.77 px/km).
  - The map is a south polar view with 0 deg longitude up and east to the right (checked: Malapert Massif
    comes out at ~86.0 S, 0 E, where the Malapert massif is). Polar stereographic, R = 1737.4 km.
Accuracy: about +-5 km (scale bar read to ~2 px, box edges to ~2 px). Each region is roughly 20 km across.
Writes web/public/data/artemis.json.  Run: python artemis_regions.py
"""
import json
import math
from pathlib import Path

R_KM = 1737.4
POLE = (370.1, 378.4)  # green star, px
PX_PER_KM = (110.5 - 22.0) / 50.0
# Box centres in px (x right, y down). The three touching boxes (Mons Mouton Plateau, Mons Mouton,
# Nobile Rim 1) were read from their separate outlines.
BOXES = {
    "Peak near Cabeus B": (49.5, 253.0),
    "Haworth": (302.5, 216.5),
    "Malapert Massif": (369.5, 161.5),
    "Mons Mouton Plateau": (527.0, 114.0),
    "Mons Mouton": (501.0, 167.5),
    "Nobile Rim 1": (520.0, 183.0),
    "Nobile Rim 2": (650.5, 208.5),
    "de Gerlache Rim 2": (284.0, 337.0),
    "Slater Plain": (495.5, 467.0),
}
SOURCE = "NASA, Artemis III candidate landing regions (28 Oct 2024); centres read from NASA's region map"
SOURCE_URL = "https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/"
MAP_URL = "https://ntrs.nasa.gov/citations/20250011660"


def to_lat_lon(x, y):
    dx, dy = x - POLE[0], POLE[1] - y  # dy positive toward 0 deg longitude (map up)
    r = math.hypot(dx, dy) / PX_PER_KM
    colat = math.degrees(2 * math.atan(r / (2 * R_KM)))
    return -(90 - colat), math.degrees(math.atan2(dx, dy))  # east positive


def main():
    lat, lon = to_lat_lon(*BOXES["Malapert Massif"])
    assert abs(lat + 86.0) < 0.2 and abs(lon) < 3, (lat, lon)  # self-check against the known massif position
    out = []
    for name, (x, y) in BOXES.items():
        lat, lon = to_lat_lon(x, y)
        out.append({"name": name, "lat": round(lat, 2), "lon": round(lon, 1), "approximate": True,
                    "source": SOURCE, "source_url": SOURCE_URL, "map_url": MAP_URL})
        print(f"{name:22s} {lat:7.2f} {lon:7.1f}")
    path = Path(__file__).parent.parent / "web" / "public" / "data" / "artemis.json"
    path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print("wrote", path)


if __name__ == "__main__":
    main()
