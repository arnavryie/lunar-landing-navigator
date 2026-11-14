# Start here (everyone reads this)

Six people, six workstreams, all working **at the same time**. This file is shared by everyone. Your own task file is one of:

| # | File | Workstream |
|---|---|---|
| 1 | [01-release-and-quality.md](01-release-and-quality.md) | Put the app online, README, testing on laptops and browsers |
| 2 | [02-explainers.md](02-explainers.md) | F8 "Why?" cards and the Moon-vs-Earth card |
| 3 | [03-evidence-replays-validation.md](03-evidence-replays-validation.md) | F5 real mission replays and the validation page |
| 4 | [04-finder-and-planner.md](04-finder-and-planner.md) | F7/F3 extensions: Artemis III regions, "find alternatives" button, best landing date |
| 5 | [05-analysis-views.md](05-analysis-views.md) | F4/F1 science-vs-engineering view, assessment report, landing-ellipse spread, Explore/Planner modes |
| 6 | [06-pitch-and-decisions.md](06-pitch-and-decisions.md) | Demo script, slides, video, submission, team decisions |

Read this file, then your own. For deeper background: `PROJECT_PLAN.md` (the full plan; section numbers below refer to it) and `AI_CONTEXT.md` (a short brief to paste into an AI assistant).

---

## 1. The project in 60 seconds

**Challenge:** NASA Space Apps 2026, lunar south pole. A lander near the south pole needs **sunlight** (power) and **Earth in view** (direct radio contact). At the pole the Sun only skims the horizon, so a ridge a few kilometres away can mean days of darkness. Launches slip, and a site that was perfect on the planned date can be dark on the new date.

**Our tool:** a web app that shows, for any south-pole site and any hour of 2027, whether the Sun and Earth are above the real terrain horizon, and helps re-plan when the date slips.

**Already built** (as of 14 Nov 2026, branch `lunar-mission-planner`):

| Tab | What it does | Main file |
|---|---|---|
| Site and plan | Horizon dial, hero numbers, timelines, seasons, survival calculator, landing-date planner with slip buttons | `web/src/App.tsx`, `Planner.tsx` |
| Find sites | Ranks ~5,500 candidate spots for your mission window, top 5 checked exactly | `web/src/Finder.tsx` |
| Globe | Whole Moon lit by the real Sun, Sun/Earth models, site markers | `web/src/Globe.tsx` |
| Map | 85–90° S map, NASA layers, click anywhere to analyse a point | `web/src/MapView.tsx` |
| 3D | 80–90° S terrain with shadows computed on the GPU | `web/src/Terrain3D.tsx` |
| Compare | 2–4 site/date scenarios side by side, CSV/JSON export | `web/src/Compare.tsx` |

**How the numbers are made** (`pipeline/`, Python):
1. `ephemeris.py`: Sun and Earth positions (Skyfield, JPL DE421, Moon frame). Checked against JPL Horizons: worst error 0.00003°.
2. `horizon.py`: terrain horizon from NASA LOLA elevation data (240 m), including the Moon's curvature.
3. `timeline.py`: hour-by-hour visibility and metrics. Checked against NASA's illumination maps: correlation 0.99.
4. `export_*.py`: write the files in `web/public/data/` that the app loads.

The browser repeats the same maths for clicked points (`web/src/engine.ts`), and `npm run check:engine` proves it still matches Python.

**Colour language (use it everywhere):** amber `#c98419` = Sun, blue `#5590d8` = Earth, green `#1fa38a` = both, grey `#4a515a` = neither.

**Honesty rules (non-negotiable):**
- Every fact from outside (coordinates, dates, mission outcomes) must come from an **official source** and be cited in the app.
- Anything not to scale or approximate says so on screen.
- Never present a guess as a measurement. If you can't source it, leave it out or label it "illustrative".
- Do not use, copy or mention code from any other team's project. Everything here is our own.

---

## 2. Set up (about 20 minutes)

**You need:** Git, Node.js **24 or newer** (the check script runs `.ts` files directly), Python **3.12 or newer**, and Chrome or Edge.

```bash
git clone <our team repository URL>
cd <repo folder>
git checkout lunar-mission-planner
```

**Web app** (enough for most workstreams; all data the app needs is already committed):
```bash
cd web
npm install
npm run dev          # opens on http://localhost:5173
npm run check:engine # must print PASS twice
npm run build        # must finish without errors
```

**Python pipeline** (only needed by #3, #4, #5 when you create new data):
```bash
cd pipeline
python -m venv .venv
.venv/Scripts/activate        # Windows; on macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```
- The ephemeris kernels download themselves into `pipeline/kernels/` on first run.
- The NASA terrain files are large (not in git). Download into `pipeline/data/lola/`:
  - `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_60s_240m.img` (+ `.lbl`), about 120 MB
  - `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img` (+ `.lbl`)
  - Only if you rebuild map layers: `http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/` files `AVGVISIB_85S_060M_201608.IMG`, `AVGVISIB_85S_060M_201608_EARTH.IMG`, `LPSR_85S_060M_201608.IMG`
- Check it works: `python horizon.py` and `python timeline.py` run their self-checks.

---

## 3. How six people work at the same time without collisions

### Git
- Make your own branch from `lunar-mission-planner`: `ws1-release`, `ws2-explainers`, `ws3-evidence`, `ws4-finder`, `ws5-analysis`, `ws6-pitch`.
- Open a pull request back into `lunar-mission-planner` when a task works. Small and frequent PRs beat one big one.
- **Never push to `main`. Never force-push.** Before opening a PR: `git pull origin lunar-mission-planner` into your branch and fix conflicts.
- Don't commit big raw data (`pipeline/data/`, `pipeline/kernels/` are git-ignored on purpose), secrets or `node_modules`.

### Who owns which file
**Edit only files you own.** For shared files, follow the rule in the right-hand column exactly.

| File / folder | Owner | Rule for everyone else |
|---|---|---|
| `README.md` (new, repo root), `web/vite.config.ts`, `.github/` | #1 | Don't touch |
| `web/src/index.css` | #1 (layout fixes only) | **Don't add to it.** Put your CSS in your own file `web/src/styles/<your-ws>.css` and import it from your component |
| `web/src/engine.ts`, `engine.worker.ts`, `customPoint.ts`, `Terrain3D.tsx` | frozen (#1 may fix bugs) | Read-only. Call `computeCustomPoint(lat, lon, false)` to get exact numbers for any 80–90° S point without changing the selected site |
| `web/src/explain/` (new) | #2 | Don't touch |
| `pipeline/sites.json`, `pipeline/export_sites.py`, new `pipeline/export_replays.py`, `pipeline/validate_*.py`, `web/src/Sources.tsx`, new `web/src/Replays.tsx`, new `web/src/Validation.tsx`, `YearStrip.tsx`, `Seasons.tsx`, `Timeline.tsx`, `Survival.tsx` | #3 | Need a new source credited? Append one line to the `SOURCES` array in `Sources.tsx` (on conflict keep both lines) |
| `web/src/Finder.tsx`, `MapView.tsx`, `Globe.tsx`, `Planner.tsx`, `pipeline/export_candidates.py`, new Artemis III data files | #4 | Don't touch; ask #4 |
| `web/src/Compare.tsx`, `HorizonDial.tsx`, new `Report.tsx`, `Ellipse.tsx`, `mode.ts`, new `pipeline/export_ellipse.py` | #5 | Don't touch; ask #5 |
| `docs/pitch/` (new), section 13 of `PROJECT_PLAN.md` | #6 | Send decisions to #6 |
| `web/src/data.ts` | shared | **Append only**, at the end, under a comment `// --- WS<n>: <what> ---`. Don't change existing functions |
| `web/src/App.tsx` | shared | Only the small edits your task file names, in the place it names. Keep each edit short; wrap it with `{/* WS<n> */}` comments so merges are easy |
| `pipeline/ephemeris.py`, `horizon.py`, `timeline.py`, `export_map.py` | frozen | Import from them; don't edit (they are validated) |
| `PROJECT_PLAN.md` change log (section 17), `AI_CONTEXT.md` | everyone | Add **one new row at the top** of the change log per finished task. On merge conflicts, keep everyone's rows |

### Before every pull request
1. `npm run build` passes.
2. `npm run check:engine` prints PASS (if you touched data, pipeline or engine-adjacent code).
3. You looked at your change at **1366 × 768** and **1920 × 1080** in Chrome (laptop-first; phones are not a target).
4. One change-log row added in `PROJECT_PLAN.md`.

### If you're blocked by someone else
Don't wait and don't edit their file. Build against a stub (a fake value or a hard-coded example), mark it `// TODO WS<n>`, and message the owner. Every task file lists the interfaces you can rely on.

---

## 4. Team-wide definitions

- **Viable / marginal / not viable**: the rule in `web/src/data.ts` → `viability()`. Example thresholds: 14-day mission, sunlit ≥ 60%, longest darkness ≤ 48 h, Earth in view ≥ 50%. The team still has to agree real values (#6 runs that decision).
- **Analysis period**: 2027, hourly (8,760 hours). `site.start_utc`, `site.samples` and `timeAt(site, i)` give the date of hour `i`.
- **Selected site / time**: held in `App.tsx` (`site`, `i`) and saved in the URL, so any screen state can be shared as a link.
