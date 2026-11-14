# Workstream 5: Analysis views (F4 science vs engineering, assessment report, F1 landing ellipse, modes)

**Read `00-START-HERE.md` first.** Your branch: `ws5-analysis`.

## Your mission
The brief says site selection must **balance science and engineering teams**, and planners need something they can hand to a review board. You build:
1. a **science-vs-engineering view** in Compare;
2. a one-click **site assessment report** (print to PDF);
3. the **landing-ellipse spread**: how the numbers change if the lander touches down a little off target;
4. an **Explore / Planner mode** switch (simple vs expert).

You own `Compare.tsx`, `HorizonDial.tsx` and your new files, so you can work in parallel with everyone.

---

## P1 tasks

### 5.1 Science vs engineering in Compare (M)
- In `web/src/Compare.tsx`, add a second table (or a toggle) that puts, per scenario:
  - **Engineering:** sunlit %, longest darkness, Earth in view %. These already exist in Compare or `data.ts` (`windowStats`).
  - **Science:** distance to the nearest permanently shadowed region (PSR), where water ice may be trapped, and whether the site itself is in a PSR. Use the NASA PSR layer already in the app, `web/public/data/map/psr.png` (85–90° S, 240 m, value 100 = shadowed, 255 = no data; grid layout in `web/public/data/map/meta.json` → `layers`). For sites outside 85–90° S show "no data", not zero.
- Make the trade-off visible: e.g. a small scatter of "power (sunlit %)" vs "distance to ice (km)" with one dot per scenario. Use the colour language; label axes in words.
- **Shared helper:** #4 may need the same "distance to PSR" for their water-ice option. Write it once, append-only at the end of `web/src/data.ts` under `// --- WS5: science helpers ---`, e.g. `export async function distanceToPsrKm(lat: number, lon: number): Promise<number | null>`. Tell #4 when it's merged.

### 5.2 Site assessment report (M)
- `web/src/Report.tsx` + `web/src/styles/report.css` with `@media print` rules: when printing, hide the app and show only the report, A4 portrait.
- A **"Print report"** button in the header (your `App.tsx` edit, see below) calls `window.print()`. The browser's "Save as PDF" makes the file; no PDF library needed.
- Contents (from `PROJECT_PLAN.md` F4): site and date; hero numbers at landing; mission-window verdict (viable/marginal/not and why); a 14-day availability strip; the horizon dial (render `<HorizonDial>` again, since it's SVG and prints sharply); science-vs-engineering summary; landing-ellipse range (once 5.3 exists); assumptions; data sources (reuse the `SOURCES` list from `Sources.tsx`, read-only); tool version (git commit or date) and the permalink.
- Works for the Site view (one site) and for Compare (2–4 scenarios side by side).

## P2 tasks

### 5.3 Landing-ellipse spread (M–L)
A real landing lands somewhere inside an error ellipse, not exactly on the target. Show the **range** of results inside it.
- **Data (pipeline, new file you own: `pipeline/export_ellipse.py`):** for each curated site at or below 80° S, take a grid of points within ~5 km (e.g. every 500 m) and compute each point's horizon with `horizon_mask(lat, lon, az_step_deg=0.5, obs_height_m=OBS_HEIGHT_M)` from `horizon.py` (import it, don't edit it). Save the horizons as int8 at 0.1° (copy the pattern in `pipeline/export_candidates.py`) to `web/public/data/ellipse/<site-id>.i8`, plus a small JSON with the point lat/lon/heights. Use `ProcessPoolExecutor` as `export_candidates.py` does; each point takes ~0.3 s.
- **App (`web/src/Ellipse.tsx`):** the user sets the ellipse (semi-major and semi-minor axis in metres, orientation in degrees; give a generic default and say it's an example, not a specific lander's value). Select the grid points inside, compute each point's visibility for the mission window with `siteTracks(...)` + `windowStats(...)` (as `Finder.tsx` does), and show min / median / max of sunlit %, longest darkness and Earth % plus "N of M points viable".
- Show it in the Site view under the planner (your `App.tsx` edit) and in the report.
- If you want the points drawn on the map, ask #4 to add an optional overlay prop to `MapView` (they own it).
- Add a check: for 2–3 grid points, compare your browser result with `computeCustomPoint(lat, lon, false)`; the difference should be small. Print it in the console, or add it to `web/scripts/check-engine.ts` as a third PASS line (coordinate with #1, who guards that script).

### 5.4 Explore / Planner modes (M)
- `web/src/mode.ts`: a React context `ModeContext` with `'explore' | 'planner'` and a `useMode()` hook; saved in the URL as `mode=explore`.
- A toggle in the header (your `App.tsx` edit).
- **Explore:** the dial, hero numbers, explainer cards (#2) and seasons; hide the expert panels (thresholds, survival calculator, CSV export).
- **Planner:** everything (today's app).
- Hide panels by wrapping their existing JSX in `{mode === 'planner' && ( … )}`, adding lines **before and after** without reformatting the lines inside (#4 also edits the `<Planner …>` line; untouched inner lines merge cleanly).
- #2's stretch walkthrough will use `useMode()`; merge `mode.ts` early (even before the UI is finished) so they can build on it.

## Stretch
- Classic azimuth-elevation sky plot as an alternative to the dial in Planner mode (`HorizonDial.tsx` is yours). Plan, section 13.
- F10 rover excursion planner (L), only if everything else is done.

---

## Your `App.tsx` edits (wrap each in `{/* WS5 */}`)
1. Header: the Explore/Planner toggle and the "Print report" button, placed after the `<nav className="seg views">` block.
2. Site view: `<Ellipse … />` after the Planner section; `mode === 'planner'` wrappers around expert panels.
3. Provide `ModeContext` around the app's top-level `<div className="app">`.

## Files you own
`web/src/Compare.tsx`, `HorizonDial.tsx`, `Report.tsx`, `Ellipse.tsx`, `mode.ts`, `web/src/styles/report.css`, `web/src/styles/analysis.css`, `pipeline/export_ellipse.py`, `web/public/data/ellipse/`, the WS5 block in `data.ts`, the WS5 edits in `App.tsx`.

## Interfaces you rely on
`windowStats`, `viability`, `Thresholds`, `timeAt`, `formatDuration` (`data.ts`); `siteTracks` (`engine.ts`); `computeCustomPoint(lat, lon, false)` (`customPoint.ts`); `SOURCES` (`Sources.tsx`, read-only import).

## Done when
- The printed report reads like an agency briefing on one or two A4 pages.
- The science-vs-engineering trade-off is visible on one screen for 2–4 sites.
- The ellipse panel gives a range, with its method and default stated on screen.
- Change-log row added.
