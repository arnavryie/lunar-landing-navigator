# Workstream 3: Evidence (F5 mission replays and the validation page)

**Read `00-START-HERE.md` first.** Your branch: `ws3-evidence`.

## Your mission
Prove the tool matches reality. Two parts:
1. **Mission replays:** load a real lander at its real site on its **real landing date**, and show what our tool says about sunlight and Earth contact then, next to what actually happened (from official sources).
2. **Validation page:** one screen that shows every check we run (method, number, pass mark), so an expert judge can trust the numbers.

This is step 7 of the demo (`PROJECT_PLAN.md` section 14), and #6 builds the pitch around it, so **share a first working replay early** (even rough) with #6.

---

## P1 task: mission replays (M–L)

### 3.1 Pick 2–3 missions and collect sourced facts
Candidates (the sites are already in `pipeline/sites.json` with sourced coordinates): **IM-2 Athena**, **IM-1 Odysseus**, **Chandrayaan-3 Vikram**.
- For each, from **official sources only** (the space agency or company, or NASA/LROC), write down: landing date and time in UTC, the source URL, and 1–2 sentences on what happened to power and communications afterwards.
- Put the facts in `pipeline/sites.json` (you own it) as new entries with their own ids, e.g. `replay-im2-athena`, group `"Mission replays"`, plus a `replay` object:
  ```json
  "replay": { "landing_utc": "YYYY-MM-DDTHH:MM:00Z", "days_before": 2, "days_after": 30,
              "outcome": "…", "outcome_source": "…", "outcome_url": "https://…" }
  ```
  Keep the existing 2027 entries (`im2-athena` etc.) unchanged; replays are separate ids.
- **Don't write a fact you can't link to an official page.** If a landing time is only known to the minute in one source, cite that source.

### 3.2 Export replay data with the real dates (pipeline)
- The app's normal data covers 2027 only. Replays need the real dates (2023–2025), and the ephemeris covers 1900–2050, so that's fine.
- In `pipeline/export_sites.py` (you own it): when an entry has `replay`, build the time range from `landing_utc − days_before` to `landing_utc + days_after` hourly, instead of 2027. Write the same JSON format as now with `start_utc` = window start and `samples` = number of hours. The existing functions (`me_vectors`, `horizon_mask`, `site_timeline`, `metrics`) already take any times; **don't edit those modules** (they're validated).
- Copy the `replay` object into the site JSON so the app can show the outcome.
- Run `python export_sites.py`. Check that the 2027 site files didn't change (`git diff --stat web/public/data/sites/` should show only new replay files plus `sites.json`).

### 3.3 Replay panel in the app
- New `web/src/Replays.tsx`: a card per mission in the Site view: name, landing date, **"Load replay"** button, and once loaded:
  - **Our tool at landing:** Sun visible? time to sunset (`hoursToChange(site.sun.frac, i)`), Earth in view? time to Earthset. Use the helpers in `web/src/data.ts`.
  - **What really happened:** the sourced outcome text plus the link.
  - One honest sentence on limits, e.g. "Our numbers are for a 2 m mast at the lander's coordinates, on 240 m terrain. A tipped-over lander or local boulders aren't modelled."
- "Load replay" sets the site to the replay id and the time to the landing hour: `i = (landing_utc − start_utc) / 1 h`.
- CSS in `web/src/styles/evidence.css`.

### 3.4 Keep the 2027-only screens honest
The Find sites, Globe and 3D tabs compute from 2027 data using the time index `i`. With a replay selected, that index means a 2023–2025 date, so those tabs would show the wrong moment.
- Add to the end of `web/src/data.ts` (append-only, under `// --- WS3: replays ---`): `export const inAnalysisYear = (s: Site) => s.start_utc.startsWith('2027-01-01') && s.samples === 8760`.
- In `App.tsx`, in the `view === 'find'`, `'globe'` and `'3d'` blocks: if the selected site is a replay (`site && !inAnalysisYear(site)`), render a short notice instead ("These views cover 2027. Replays are shown on Site and plan.") with a button back. That's your edit in those blocks; wrap it in `{/* WS3 */}`.
- Also check the Site view panels with a 32-day replay: the year strip, seasons and planner should still work, because they read `site.samples` and `site.start_utc`. Fix anything that assumes a full year by **telling the owner** (#2 for explainers, #4 for the planner) or, for `YearStrip.tsx`, `Seasons.tsx`, `Timeline.tsx` and `Survival.tsx` (nobody else owns these), fix them yourself.

---

## P1 task: validation page (M)

### 3.5 `web/src/Validation.tsx`, a full-page view
- Open it from the existing header badge "Validated against JPL Horizons…" (in `App.tsx`, the `<a className="badge">`): make it switch to a new view `'validation'` instead of jumping to `#sources`. Add `'validation'` to the `View` type and the URL `view` list. No new header tab is needed. Wrap edits in `{/* WS3 */}`.
- One section per check: **what is compared, how, the number, the pass mark, and how to rerun it.**

| Check | Number (from the change log; re-run, don't copy blindly) | Rerun with |
|---|---|---|
| Sun/Earth positions vs JPL Horizons | worst 0.000033° | `python validate_horizons.py` → `validation/step1_horizons.json` |
| Sunlit/Earth % vs NASA LOLA illumination maps (80 points, 18.6 years) | r = 0.991 (Sun), 0.995 (Earth); median diff 0.31 / 0.17 points | `python validate_illumination.py` → `validation/step3_illumination.json` |
| Browser engine vs Python | direction 3.5e-7°, sunlit/Earth 0.00 points | `npm run check:engine` |
| Finder quick estimate vs exact | worst 0.28 points over a year | `npm run check:engine` (second line) |
| GPU 3D shadows vs pipeline | 191 of 192 agree | 3D tab → "Check shadows against the pipeline" |
| Mission replays | your 3.3 results | Replay panel |

- `web/public/data/validation.json` already holds the Horizons and illumination summaries (written by `export_sites.py`, `write_validation_summary()`); load it with `loadValidation()` from `data.ts`.
- Add the **assumptions** list (2 m mast, 240 m terrain, hourly steps, disc rule, no refraction) and the **limits** each tab shows.

### 3.6 Sources panel
You own `web/src/Sources.tsx`. Add the replay sources. Other workstreams may append one line each to `SOURCES`; keep their lines when merging.

---

## Files you own
`pipeline/sites.json`, `pipeline/export_sites.py`, `pipeline/validate_*.py`, `validation/`, `web/public/data/sites*`, `web/public/data/validation.json`, `web/src/Replays.tsx`, `web/src/Validation.tsx`, `web/src/Sources.tsx`, `web/src/YearStrip.tsx`, `Seasons.tsx`, `Timeline.tsx`, `Survival.tsx`, `web/src/styles/evidence.css`, the `{/* WS3 */}` edits in `App.tsx`, the WS3 block at the end of `data.ts`.

## Interfaces others rely on
- `inAnalysisYear(site)` in `data.ts` (#4 may use it in the Globe and Find views later).
- Replay sites use the normal `Site` format, so Compare, the planner and the explainers work with them unchanged.

## Done when
- 2–3 replays load in one click; each shows our prediction at landing next to a sourced outcome.
- Every number on the validation page matches a rerun of its check.
- No mission fact without an official link.
- Change-log row added.
