# Lunar South Pole Mission Planner

> **NASA Space Apps Challenge 2026** · Team Stranded · Dr. D.Y. Patil Institute of Technology, Pune  
> Challenge: **Lunar Landing Site Navigator**

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Validation: JPL Horizons](https://img.shields.io/badge/JPL%20Horizons-0.00003%C2%B0%20Match-green.svg)
![Validation: NASA LOLA](https://img.shields.io/badge/LOLA%20Illumination-r%20%3D%200.99-green.svg)
![Build](https://img.shields.io/badge/Build-Passing-brightgreen.svg)

---

## 1. What It Is

The **Lunar South Pole Mission Planner** is a scientific web application that computes and visualizes hour-by-hour solar illumination, direct-to-Earth communication line-of-sight, and terrain horizon occultations across the Moon's rugged south pole for every hour of 2027. Built with React, TypeScript, and Three.js, it translates complex celestial ephemerides and high-resolution NASA Lunar Reconnaissance Orbiter (LRO) elevation grids into intuitive, interactive tools—featuring an azimuth-elevation horizon dial, landing date slippage planner, whole-Moon 3D globe, GPU-accelerated terrain shadow engine, candidate landing site finder, multi-scenario comparisons, and historical mission replays for Chandrayaan-3 and IM-1 Odysseus.

| Screen | Description |
|---|---|
| **Site & Plan** | Top-down horizon dial showing real-time Sun and Earth clock hands with true angular disc sizes against 360° terrain obstacles, countdown timers to sunset and Earthset, landing slip budget planner, and lander battery survival calculator. |
| **Find Sites** | Evaluates ~5,500 candidate polar spots across 85–90° S; filters by mission duration, max slope, and viability thresholds, re-ranking the top 5 with an exact browser engine. |
| **Whole-Moon Globe** | Photorealistic 3D Moon rendered with real Sun vectors, lunar-Lambert photometric shading, NASA SVS CGI Moon Kit colour, LOLA topographic relief, and true libration angles. |
| **South Pole Map** | Polar stereographic projection of 85–90° S with LOLA shaded relief, NASA cumulative illumination, permanent shadow regions (PSRs), and an instant click-anywhere custom point calculator powered by a Web Worker. |
| **3D Terrain Shadows** | High-fidelity 1024×1024 LOLA terrain mesh with GPU-accelerated ray marching that computes true topographic shadows from lunar curvature and surface relief. |
| **Compare Scenarios** | Side-by-side multi-site and multi-date trade-off matrix with synchronized mission timelines and CSV/JSON export. |
| **Explainers & Contrast** | Interactive "Why?" cards illustrating lunar axial tilt, libration loops, and ridge blockages, accompanied by a Moon vs. Earth solar elevation contrast tool. |
| **Mission Replays** | Historical telemetry validation reproducing the touchdown illumination and direct-to-Earth contact for Chandrayaan-3 (Statio Shiv Shakti) and IM-1 Odysseus (Malapert A). |
| **Validation Proofs** | Dedicated audit page detailing exact differences against JPL Horizons and NASA Goddard illumination benchmarks. |

---

## 2. Live Deployment

- **GitHub Pages:** [https://arnavryie.github.io/lunar-landing-navigator/](https://arnavryie.github.io/lunar-landing-navigator/)
- Fully client-side, zero backend server required; all data precomputed and compressed into static JSON and binary assets (~21 MB total).

---

## 3. What Problem It Solves

Missions targeting the lunar south pole face extreme operational constraints: because the Moon's axial tilt is only ~1.5°, the Sun skims the horizon at 1°–2° elevation, causing ridges just a few kilometres away to plunge landing sites into prolonged cryogenic darkness. While comprehensive data exists in specialized tools like NASA QuickMap, Moon Trek, and JPL Horizons, their specialized interfaces make rapid cross-site and multi-date evaluation difficult for mission architects, educators, and the public. When hardware anomalies or launch windows slip, planners need immediate answers to assess alternative dates at the current site or evaluate nearby candidate landing sites without days of manual trajectory recomputation.

---

## 4. How It Works

Our architecture splits rigorous astronomical processing between an offline Python pipeline and a high-performance in-browser TypeScript engine:

1. **Planetary Ephemeris (`pipeline/ephemeris.py`):** Uses Skyfield and the JPL DE421 ephemeris in the Moon Moon-Fixed Mean Earth frame (`MOON_ME_DE421`) to compute sub-arcsecond Sun and Earth positions across the Moon's surface.
2. **Terrain Horizons (`pipeline/horizon.py`):** Samples NASA LRO LOLA 240 m topography (`LDEM_60S_240M`) across 360° of azimuth with spherical lunar curvature corrections ($d / 2R_{\text{moon}}$).
3. **Illumination & Occultation Timelines (`pipeline/timeline.py`):** Evaluates geometric disc intersections to determine partial and total visibility of the solar disc and terrestrial communications link for all 8,760 hours of the year.
4. **Browser Engine (`web/src/engine.ts` & `engine.worker.ts`):** Re-implements identical celestial trigonometry and horizon ray-tracing inside a Web Worker. Clicking any point on the polar map computes full annual horizons and illumination metrics in ~0.8 seconds without server requests.

---

## 5. Accuracy & Scientific Validation

Every metric displayed in the application is audited against official NASA benchmarks:

- **JPL Horizons Ephemeris Comparison:** Worst-case Sun/Earth directional error is **0.000033° (0.12 arcseconds)** across 70,080 test samples (pass mark: 0.001°).
- **NASA LOLA Polar Illumination Benchmark:** Compared against NASA Goddard PGDA Product 69 (Mazarico et al., 2011) over an 18.6-year nodal precession cycle:
  - Solar illumination correlation: **r = 0.991** (median difference 0.31 percentage points).
  - Earth visibility correlation: **r = 0.995** (median difference 0.17 percentage points).
- **Browser vs. Python Engine Parity:** Directional difference is **3.49 × 10⁻⁷°**; annual sunlit and Earth-visible percentages match within **0.00 percentage points**.
- **GPU 3D Shadows vs. Pipeline:** 191 of 192 test moments agree on Sun/Earth illumination state.
- **Finder Quick Estimates vs. Exact Physics:** Worst difference across 5,487 polar candidate spots is **0.28 percentage points** over a full year (limit: 3.0 pp).

---

## 6. Run It Yourself

### Prerequisites
- Node.js 20+ or [Bun](https://bun.sh)
- Modern browser with WebGL 2 support (Chrome, Edge, Firefox, Safari)

### Web Application (Quick Start)
```bash
git clone https://github.com/arnavryie/lunar-landing-navigator.git
cd lunar-landing-navigator/web
bun install          # or npm install
bun run dev          # opens development server on http://localhost:5173
```

### Automated Parity Checks
Run the automated engine and finder verification test suite:
```bash
bun scripts/check-engine.ts
# Expect:
# worst direction 3.49e-7 deg, sunlit 0.00 pp, earth 0.00 pp, horizon 0.000 deg -> PASS
# finder: coarse vs exact worst 0.28 pp over a year (limit 3), windowed tracks match -> PASS
```

### Production Build
```bash
bun run build
# Compiles clean static distribution in web/dist/
```

### Python Ephemeris Pipeline (Optional)
Only required if re-generating ephemerides or downloading raw NASA DEMs:
```bash
cd pipeline
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python ephemeris.py   # verifies ephemeris calculations
```

---

## 7. Data Sources & Provenance

1. **NASA LRO LOLA Topography:** Gridded elevation datasets `LDEM_60S_240M` and `LDEM_16` ([PDS Geosciences](https://pds-geosciences.wustl.edu/missions/lro/lola.htm)).
2. **JPL DE421 Ephemeris & NAIF SPICE Kernels:** Generic planetary kernels for solar and lunar position modeling ([NASA NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/)).
3. **NASA JPL Horizons On-Line Ephemeris System:** Independent validation reference ([NASA JPL SSD](https://ssd.jpl.nasa.gov/horizons/)).
4. **NASA Goddard PGDA Product 69:** Lunar Polar Illumination and Earth Visibility (Mazarico et al., 2011) ([NASA PGDA](https://pgda.gsfc.nasa.gov/products/69)).
5. **NASA SVS CGI Moon Kit:** Lunar Reconnaissance Orbiter Camera (LROC) Wide Angle Camera colour basemap ([NASA SVS 4720](https://svs.gsfc.nasa.gov/4720/)).
6. **IAU & LROC Gazetteers:** Official nomenclature and verified landing site coordinates ([USGS / IAU](https://planetarynames.wr.usgs.gov/)).
7. **ISRO Chandrayaan-3 Telemetry:** Vikram lander landing coordinates and operational timeline ([ISRO](https://www.isro.gov.in/Chandrayaan3_Details.html)).
8. **Intuitive Machines IM-1 Odysseus:** Malapert A landing coordinates and operational logs ([Intuitive Machines](https://www.intuitivemachines.com/im-1)).

---

## 8. Operational Assumptions & Limitations

- **Analysis Period:** Primary forward analysis covers the full calendar year 2027 (8,760 hourly samples). Historical mission replays cover their respective operational epochs.
- **Topographic Resolution:** 240 m per pixel polar DEM (1.9 km for equatorial sites). Metric-scale boulders and micro-craters are smoothed out, which may slightly overestimate illumination on knife-edge crater rims.
- **Mast Height:** Fixed at 2.0 metres above local terrain for solar arrays and communications antennas.
- **Disc Calculation:** Solar and terrestrial discs are treated with spherical geometry against terrain silhouettes; any non-zero fraction of the disc above the horizon is registered as illuminated/visible.
- **Atmosphere:** Airless celestial bodies (no atmospheric refraction or twilight).
- **Scale:** 3D models and horizon dial elevations are visually scaled for clarity in the low polar sky (explicitly labeled on-screen).

---

## 9. Team Stranded

- **Arnav Ryie** (`@arnavryie`)
- **Mohit Aher** (`@mohitbaher`)
- **Pratik Sonar** (`@Mystic945`)
- **Sanskar Arnale** (`@SanskarArnale-07`)

*Dr. D.Y. Patil Institute of Technology, Pune · NASA Space Apps Challenge 2026*
