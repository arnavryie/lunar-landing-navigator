# AI Context Brief: Lunar South Pole Mission Planner

> **What this file is:** paste or attach it at the start of any AI chat (ChatGPT, Claude, Gemini, Cursor, Copilot, v0, Lovable…) so the AI works with the same context as the rest of the team.
> **Source of truth:** [PROJECT_PLAN.md](PROJECT_PLAN.md). If this file and the plan disagree, the plan wins. Attach both when the AI's task touches features or design decisions.
> **Snapshot:** plan v1.3, 14 November 2026. Status: Phase 1 in progress; step 1 (Sun/Earth calculator in `lunar-mission-planner/pipeline/`) matches JPL Horizons to 0.00002°; step 2 (terrain horizon mask from LOLA `LDEM_60S_240M` + global `LDEM_16` fallback, curvature included) done. The PDS polar projection formula is mirrored east–west; use the orientation in `pipeline/horizon.py`. Step 3 (Sun/Earth visibility timelines, `pipeline/timeline.py`) matches NASA's LOLA illumination maps (correlation 0.99, median diff < 0.4 percentage points). Step 4: first app screen (F1 horizon dial + hero numbers + year strip) in `lunar-mission-planner/web/`, fed by `pipeline/export_sites.py`. Curated sites with cited coordinates live in `pipeline/sites.json`; never add a site without a source. F2 (availability timeline, seasons, power index, survival calculator) is built. F3 MVP (viability thresholds, landing-date calendar, slip + before/after, slip budget, URL permalinks) is built; viability logic lives in `web/src/data.ts`. F4 compare view (`web/src/Compare.tsx`: 2–4 scenarios, synced mission timelines, best-per-row table, CSV/JSON export, permalinks) is built. F6a Map screen is built: layers, hover, and click-anywhere computed in a Web Worker (`web/src/engine.ts`) that must keep matching Python (`npm run check:engine`). F6b 3D terrain is built (`web/src/Terrain3D.tsx`): shadows come from a GPU ray march over the DEM (not shadow maps); use the in-app 'Check shadows against the pipeline' button after any shader change. GPU float32 can't subtract ~1,739 km lengths accurately: keep the small-number formulation. F6c globe is built as its own Globe tab (`web/src/Globe.tsx`): NASA CGI Moon Kit colour + our LDEM_16 relief normals (`pipeline/export_globe.py`), lit from the true Sun vector; scene axes from ME are (x, z, −y). Sun/Earth models stay labelled 'not to scale; directions accurate'. F7 finder is built (`web/src/Finder.tsx` + `pipeline/export_candidates.py` → `web/public/data/finder/`): coarse 1° horizons for 5,487 spots evaluated for the user's mission window, top 5 recomputed exactly; `npm run check:engine` also checks the coarse stage. Re-run export_candidates.py if the DEM, the obs height or the tile rule changes. Remaining work is split into six workstreams in PROJECT_PLAN.md section 12.1 (owners, files, done-when); respect its one-owner-per-file rule. Per-person briefs live in `docs/tasks/` (start with `00-START-HERE.md`). **This branch is now built solo** (teammates build a separate version): follow the order in PROJECT_PLAN.md section 12.2; the ownership rules no longer apply, the briefs are just task checklists.

---

## 0. How to use this file (for teammates)
1. Start a new chat and attach this file (plus `PROJECT_PLAN.md` for feature work).
2. Paste the starter prompt below, then your task.
3. If the AI suggests a new feature or changes a decision, **don't just build it**. Bring it to the team so it goes into `PROJECT_PLAN.md` with a change-log line first.

**Starter prompt:**
```
You are helping a NASA Space Apps 2026 hackathon team build a web app.
Read the attached AI_CONTEXT.md fully and follow its "Rules for the AI" section.
Before writing code, restate in 3 bullets what you understood my task to be,
which feature code (F1–F10) it belongs to, and any assumption you are making.
My task: <describe it here>
```

---

## 1. Rules for the AI (read these first)
1. **The team are not aerospace experts.** Act as an honest mentor: explain physics in plain language, say clearly if an idea is unrealistic, and give a verdict (keep / simplify / drop) with a reason. Don't just add features.
2. **Correctness beats features.** A wrong number in the demo hurts more than a missing feature. Never invent physical constants, mission facts, coordinates or dates. If unsure, say "verify against <source>" instead of guessing.
3. **Stay inside the plan.** Only build features listed in section 5. Anything listed in section 8 (Out of scope / rejected) must not be built. New ideas are proposals for the team, not code.
4. **Respect the tiers.** Core (F1–F5) first, then Differentiators (F6–F8), then Stretch (F9–F10). Don't help start a higher tier while a lower one is half-working.
5. **Precompute, don't compute live.** Heavy physics (ephemeris, terrain horizons, illumination grids) runs offline in Python. The browser loads precomputed JSON/binary files. Only the stretch features F9/F10 compute live.
6. **Professional tone.** NASA/ISRO/ESA-grade look. No cartoon styling, no gamification, no emoji in the UI.
7. **Label honestly.** Anything simplified or illustrative is labelled ("approximate", "not to scale", "simplified index").
8. **Keep it simple.** Smallest working solution, few dependencies, no premature abstraction. This is a hackathon.

---

## 2. The challenge in one paragraph
Build an **intuitive tool** to compare lunar landing **sites and dates**, especially near the **south pole**, by showing the **Sun and Earth relative to the local horizon**. The Sun decides **power** (solar panels); the Earth decides **direct-to-Earth (DTE) radio contact**. Existing NASA tools (QuickMap, Moon Trek, JPL Horizons) have the data but are too complex for quick comparison. **The main use case is re-planning:** when a launch slips, quickly find alternative dates at the same site, or alternative nearby sites.

- **Only hard requirement:** show Sun and Earth positions relative to the horizon at a chosen site and date. Everything else is optional.
- **Brief stresses twice:** solar elevation shown prominently; time remaining until sunset and Earthset.
- **Audience:** mission planners, educators, the public.
- **Judged on:** usefulness, clarity, creativity.
- **Format chosen:** web app for **laptop screens first**. Design and test at laptop widths only; a phone layout is Phase 3 stretch, only if time remains. Test at 1280×720, 1366×768 and 1920×1080; the dial, Sun/Earth readout and pinned time bar must fit on one screen at 1280×720.
- **Tagline:** *"On the Moon, a mission needs two lights to survive: the Sun for power, and the Earth for a voice home."*

---

## 3. Physics the AI must get right
| # | Fact | Consequence for the code |
|---|---|---|
| 1 | Moon's axis tilt is only ~1.5°, so at the pole the Sun circles just above/below the horizon all lunar day. | Flat-horizon models are wrong. Terrain decides everything. |
| 2 | Libration moves Earth up/down by ~±7° in the polar sky. | DTE contact comes and goes on a monthly cycle. |
| 3 | Mountains 50–100+ km away can block the low Sun. | Horizon masks need a **wide-area** DEM. |
| 4 | No atmosphere; surface curves away. | Horizon = terrain + curvature drop (≈ d / 2R radians, ~0.8° at 50 km). **No refraction.** |
| 5 | The Sun is a ~0.5° disk. | Report **fraction of Sun visible**, not just lit/unlit. |
| 6 | Rovers are very slow (Pragyan ~1 cm/s; VIPER-class ~0.2 m/s max). | Rover planner (stretch) needs a 5–20 m grid. |

- Work in the Moon's own body-fixed frame (Moon mean-Earth, "ME"); this handles libration automatically.
- Lunar day ≈ 29.5 Earth days. Lunar "seasons" cycle ≈ 1 year.
- All numbers above are approximate; the plan's section 15 lists what still needs verifying.

**Glossary:** DTE = direct-to-Earth comms · Ephemeris = table of body positions over time · Horizon mask = terrain horizon elevation for each of 360 azimuths at a site · Sky plot = azimuth vs elevation chart · PSR = permanently shadowed region · Slip = landing-date delay · Viability = site-date meets mission thresholds.

---

## 4. Design system
- **Simple first, depth on demand.** Two modes on the same data:
  - **Explore mode:** guided, with explanations (public, educators).
  - **Planner mode:** dense, all numbers (mission planners).
- **Hero numbers always visible, large:** solar elevation now · time to sunset (countdown) · time to Earthset (countdown) · status chips (sunlit/dark, Earth in view/out).
- **Colour language (use everywhere: globe, charts, timelines, maps).** Exact values, validated for colour-blind viewers on the dark background: amber `#c98419`, blue `#5590d8`, green `#1fa38a`; keep them in `web/src/index.css`.

  | Colour | Meaning |
  |---|---|
  | Amber | Sunlit / power |
  | Blue | Earth visible / DTE |
  | Violet | Relay visible (stretch) |
  | Green | Power AND comms |
  | Dark grey | Neither / blocked |

- **Look:** clean, restrained, dark theme suits the subject; thin rules; **monospaced numbers**. References: NASA's Eyes on the Solar System, LRO QuickMap, JPL Horizons.
- **Conventions:** UTC in ISO-8601, SI units, selenographic lat/lon, coordinate frame stated.
- **Provenance:** every number can show its source and resolution (e.g. "horizon from LOLA, 240 m/px").
- **Accessibility:** colour-blind-safe palette, colour never the only cue, keyboard navigation, readable contrast.
- **Share/export:** CSV/JSON download; permalinks that restore the exact scenario (site, date, settings in the URL).

---

## 5. Features (build only these)

### 🟢 Core: ship all of it, correct and polished, first (Phase 1)
- **F1 Site view.** 360° terrain horizon (with curvature) + sky plot of Sun and Earth positions and paths. Main visual = **horizon dial**: terrain silhouette as a ring, Sun and Earth moving around it like clock hands (classic azimuth-elevation plot available in Planner mode). Sites: curated list or custom lat/lon inside the precomputed region. *Phase 2 add-on:* landing-ellipse dispersion (worst/typical/best case inside the landing uncertainty ellipse).
- **F2 Hero metrics, timeline, seasons.** Hero numbers; Gantt-style tracks (Sunlit, Earth visible, Both); metrics (sunlight %, longest darkness, Earth visibility %, longest gap without contact, next sunrise/Earthrise); year-long seasons strip. Also: **power-potential index** (visible Sun fraction × incidence on a vertical Sun-tracking panel, labelled "simplified index"), **thermal context indicators** (hours since sunset, longest darkness; no thermal model), **lander survival calculator** (user enters W and Wh → survives longest darkness yes/no + minimum battery).
- **F3 Scenario & slip planner.** User-set viability thresholds → each site-date viable / marginal / not viable. Date calendar heatmap. Slip buttons (+1 d, +7 d, +14 d, +1 lunar month, custom) with a before/after delta card. **Slip budget:** "you can slip up to N days; next viable window opens on …". Saved scenarios via permalink. *Stretch:* nearby alternatives within X km.
- **F4 Site comparison.** 2–4 scenarios side by side, synced timelines, metric table with best value per row highlighted, CSV/JSON export. *Phase 2:* science-vs-engineering grouped view. *Phase 3:* site assessment report PDF via browser print.
- **F5 Credibility layer.** Validate Sun/Earth directions against **JPL Horizons** (the Phase 1 gate); assumptions panel; provenance on every number. *Phase 2:* mission replays of real landings (every fact sourced and cited). *Phase 3:* full validation page incl. comparison with LOLA illumination maps (Mazarico et al., 2011).

### 🔵 Differentiators: only after core matches Horizons (Phase 2)
- **F6 Lunar globe, south-pole map, 3D terrain. Engine: Three.js (decided).**
  - **F6a 2D south-pole map (first Phase 2 item):** 85°S–90°S, 0°E up, plain canvas. Layers: shaded relief, NASA sunlight/Earth %, PSRs, slope, Artemis III regions, lit-now. **Click anywhere** → a Web Worker runs the pipeline maths (horizon from an 80°S–90°S 240 m DEM crop + exported hourly Sun/Earth vectors in Moon ME + `timeline.py` metrics) and every panel switches to that point. Must match Python at curated sites (0.001°, 0.5 pp).
  - **F6b 3D south-pole terrain:** Three.js mesh of the same DEM. **Shadows from a horizon-physics shader, never Three.js shadow maps** (inaccurate at 1–2° Sun). Earth-visible tint, camera presets, line-of-sight rays, **shadow time-lapse**. Fallback: plain light labelled "illustrative".
  - **F6c whole-Moon globe (MVP built):** NASA CGI Moon Kit colour + our LOLA relief, lit from the true Sun direction, site markers; still to add: Artemis III regions, heatmap layers. Sun/Earth models: **sizes and distances NOT to scale, directions TRUE**, labelled so.
  - Screens: Site / Plan / Map / 3D / Compare / Validation, one shared point + time (see PROJECT_PLAN.md section 4).
- **F7 Alternatives finder (MVP built: Find sites tab).** Constraints in (sunlight, darkness, Earth visibility, max slope ~8–10°, date window, radius) → suitability heatmap + ranked shortlist with score breakdown. Only science option: water-ice proximity. Coarse-to-fine search.
- **F8 Explainer + Moon vs Earth.** "Why?" cards linked from the data (Sun skims the horizon, ridge blocks Sun, libration, why 5 km matters, why dates matter, no twilight). Contrast cards ("Highest Sun here: 1.2°; in your city today: 58°"; use a city picker, not geolocation).

### ⚪ Stretch: only if everything above is finished (Phase 3)
- **F9 Relay mode.** User-defined relay orbit (presets / simple / Keplerian), two-body model labelled "approximate".
- **F10 Rover excursion planner.** Safe trips into shadow with guaranteed return to light and comms, "turn back by" time, battery chart. Small high-res region near Shackleton, Web Worker.

**Cut order if time runs short:** F10 → F9 → Phase 3 extras → lowest-demo Phase 2 items. **Never cut Phase 1.**

---

## 6. Architecture
```
OFFLINE (Python, run once)            PRECOMPUTED FILES                 WEB APP (browser)
Ephemeris (Skyfield)            ──┐   Sun/Earth direction tables  ──┐   F1–F2 site view, metrics
LOLA DEMs → horizons + curvature ─┼─► Horizon masks per site        ├─► F3–F4 slip planner, compare
PSR / Diviner layers            ──┤   Daily metrics, 1+ year        ├─► F6 globe
Validation vs Horizons / LOLA   ──┘   Lit / Earth-visible grids     └─► F7–F8 finder, explainer
                                      Slope + science rasters           (F9–F10 computed live)
```
- The browser never runs heavy physics for core features. It loads precomputed files so every comparison is instant.
- **Data sources:** JPL Horizons (reference + validation) · Skyfield with JPL DE ephemeris + lunar frame kernels · LOLA south-pole DEMs · LOLA illumination maps (validation) · PSR maps, Diviner temperatures (water ice) · NASA CGI Moon Kit (globe textures) · NASA Artemis III candidate regions (overlay).
- Exact files, resolutions and versions are **not yet confirmed**; don't hard-code assumptions about them without asking.

**Tech stack status (don't decide these alone; propose and ask the team):**
| Area | Decided | Still open |
|---|---|---|
| Offline pipeline | Python + Skyfield (not SPICE); code lives in `lunar-mission-planner/` | File format (JSON vs binary) |
| Web app | React + Vite + TypeScript in `lunar-mission-planner/web/`; Public Sans font; hand-drawn SVG charts | Charting library (if ever needed), hosting |
| 3D globe, map, terrain | Three.js; shadows from a horizon-physics shader; map on plain canvas | — |

---

## 7. Roadmap and gates
| Phase | Contents | Done when |
|---|---|---|
| 1 Core | Python pipeline (~10 curated sites + south-pole grid, ≥1 year daily metrics); F1 + dial; F2 + survival calculator; F3 calendar + slip + slip budget; F4; F5 Horizons check | Sun/Earth positions match JPL Horizons; a slip scenario answered in seconds for every curated site |
| 2 Differentiators | F6a map + click-anywhere (first); F6b 3D terrain + time-lapse; F6c globe + slope; F7; F8; Explore/Planner modes; F4 sci-vs-eng; F1 ellipse; F5 replays | End-to-end demo works on one laptop |
| 3 Polish + stretch | F5 validation page; export + permalinks; F4 report; pitch + video; then F9, F10 if time | Validation in-app; demo rehearsed |

**Gate:** don't start Phase 2 until Phase 1 numbers match JPL Horizons.

---

## 8. Do NOT build (out of scope or rejected)
Radio link budgets · detailed thermal model · science objectives other than water ice · DSN/ground-station layer · halo/NRHO orbits · multiple relay orbiters · **AI chatbot or natural-language query** · to-scale solar-system view · games, leaderboards, survival game · sonification · VR/WebXR · power beaming · native mobile app · phone-friendly layout (until the laptop version is done).

If a judge asks: *"Out of scope for the hackathon; listed as future work."*

---

## 9. Open decisions (ask the team, don't assume)
3D engine · default viability thresholds · product name (working title in use) · curated site list with verified coordinates · analysis period and time step (must cover a full seasons cycle) · which 2–3 missions to replay · landing-ellipse presets · team size and roles.

---

## 10. Demo storyline (what the app must make possible, ~3 min)
1. Globe opens; Sun lights the Moon; south pole in half-light.
2. Pick a site + date → hero numbers + horizon dial answer "power? comms?" at a glance.
3. "Why?" → Moon-vs-Earth card (your city's Sun 58°, here under 1°).
4. "Launch slipped two weeks" → +14 d → before/after card shows it's no longer viable.
5. Calendar shows the next window; nearby alternative a few km away works.
6. Compare original vs alternative side by side.
7. Mission replay of a real landing + validation page: "our numbers match reality and NASA data."

*(Numbers above are placeholders; real ones come from the tool.)*
