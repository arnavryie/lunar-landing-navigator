# Lunar Landing Site Navigator — QA Verification Checklist

**Date:** 14 November 2026  
**Evaluator:** Workstream 1 (Release & Quality)  

> **Status:** section 1 rows were rerun on 14 Nov 2026 (`npm run check:engine`, `npm run build`). The section 2 notes describe expected behaviour; they are **not a record of a hand test yet**. Mark each item after checking it in a browser.
**Target Viewports:** 1280 × 720, 1366 × 768, 1920 × 1080  
**Target Browsers:** Google Chrome, Microsoft Edge, Mozilla Firefox, Safari  

---

## 1. Automated Parity & Build Verifications

| Check | Command | Pass Criteria | Result | Notes |
|---|---|---|---|---|
| **Celestial & Terrain Engine Parity** | `npm run check:engine` (check 1) | Direction < 0.001°, Sunlit/Earth diff = 0.00 pp | **PASS** | Direction: 3.49e-7°, Sunlit/Earth: 0.00 pp, Horizon diff: 0.000° across 8 polar test points |
| **Finder Fast Estimate vs. Exact Engine** | `npm run check:engine` (check 2) | Difference < 3.0 pp over full year | **PASS** | Worst difference: 0.28 pp; windowed tracks match exactly |
| **TypeScript & Bundle Compilation** | `npm run build` | 0 TS errors, 0 Vite build errors | **PASS** | `tsc -b && vite build` built clean in 375 ms |

---

## 2. Interactive Viewport & Feature Matrix

### A. Site & Plan Tab (`web/src/App.tsx`, `Planner.tsx`, `HorizonDial.tsx`)
- **1280 × 720:**
  - Status: **not yet hand-tested**
  - Horizon dial scales to view height; countdowns and elevation hero numbers align horizontally without text clipping.
  - Interactive "Why?" explainer buttons open native accessible dialog cards with keyboard trap and Esc key dismissal.
  - Moon vs Earth contrast card displays live solar elevations and city picker without vertical overflow.
  - Mission replay cards render with one-click historical telemetry loader.
- **1366 × 768:**
  - Status: **not yet hand-tested**
  - Primary target laptop resolution. Horizon dial, status badges, and 14-day path projections are fully visible above the fold. Time controls remain pinned cleanly to the bottom.
- **1920 × 1080:**
  - Status: **not yet hand-tested**
  - Max-width containers (`1440px`) prevent excessive horizontal spreading. Contrast card and historical replay cards form balanced responsive grids.

### B. Find Sites Tab (`web/src/Finder.tsx`)
- **1280 × 720:**
  - Status: **not yet hand-tested**
  - Candidate table and map coordinate viewer load in under 1 second. Slope filters and mission duration sliders respond smoothly.
- **1366 × 768:**
  - Status: **not yet hand-tested**
  - Top 5 candidate re-calculation workers fire asynchronously with progress indicator; numbered map badges correlate to ranked table rows.
- **1920 × 1080:**
  - Status: **not yet hand-tested**
  - Layout maintains side-by-side split between polar map canvas and ranked candidate inspector.

### C. Whole-Moon Globe Tab (`web/src/Globe.tsx`)
- **1280 × 720 / 1366 × 768 / 1920 × 1080:**
  - Status: **not yet hand-tested**
  - True-Sun lighting shader renders Lunar-Lambert scattering accurately. SVS CGI Moon Kit texture displays sharp features. Camera presets (Overview, South Pole, Fly to Site) transition smoothly at 60 FPS.
  - When a historical mission replay site (e.g. Chandrayaan-3 or IM-1) is selected, a fallback banner guides the user back to the 2027 analysis year.

### D. Map Tab (`web/src/MapView.tsx`)
- **1280 × 720 / 1366 × 768 / 1920 × 1080:**
  - Status: **not yet hand-tested**
  - 85–90° S polar stereographic projection renders LOLA relief, NASA illumination, and permanent shadow layers. Click-anywhere Web Worker computes custom point horizons and ephemeris in ~0.8s with complete engine parity.

### E. 3D Terrain Tab (`web/src/Terrain3D.tsx`)
- **1280 × 720 / 1366 × 768 / 1920 × 1080:**
  - Status: **not yet hand-tested**
  - GPU ray-marching shader casts real horizon shadows over 1024×1024 LOLA elevation mesh. Time-scrubber advances shadows dynamically. Self-check button confirms 191/192 agreement against Python pipeline.

### F. Compare Scenarios Tab (`web/src/Compare.tsx`)
- **1280 × 720 / 1366 × 768 / 1920 × 1080:**
  - Status: **not yet hand-tested**
  - Multi-column scenario comparison highlights best metrics in bold. Synchronized mission timelines scroll in unison. CSV and JSON exports generate valid files.

### G. Validation View (`web/src/Validation.tsx`)
- **1280 × 720 / 1366 × 768 / 1920 × 1080:**
  - Status: **not yet hand-tested**
  - Reached via header badge "Validated against JPL Horizons...". Shows all 6 scientific verification benchmarks with reproducible command lines, exact tolerances, and modeling assumptions.
