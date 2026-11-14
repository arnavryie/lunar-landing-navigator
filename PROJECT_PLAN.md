# Lunar South Pole Mission Planner: Project Plan

> **NASA Space Apps Challenge 2026** · Team planning document · v1.4 · 14 November 2026
> **Status:** Phase 1 in progress. Step 1 done: Sun/Earth calculator (`lunar-mission-planner/pipeline/ephemeris.py`) matches JPL Horizons. Step 2 done: terrain horizon mask (`pipeline/horizon.py`, LOLA 240 m). Step 3 done: Sun/Earth visibility timelines + metrics (`pipeline/timeline.py`), validated against NASA's LOLA illumination maps. Step 4 done: first web app screen (`lunar-mission-planner/web/`, React + Vite + TypeScript) with the F1 horizon dial, hero numbers and a year strip; Curated site list done: 8 sites with cited coordinates. F2 done (availability timeline, seasons, power index, thermal context, lander survival calculator). F3 MVP done (viability thresholds, landing-date calendar, slip buttons + before/after card, slip budget, permalinks). F4 done (compare 2–4 scenarios, synced mission timelines, best-per-row table, CSV/JSON export). Phase 1 features are built. F6a map done (layers, hover, click-anywhere computed in the browser and checked against Python). F6b 3D terrain done (GPU shadows from our horizon physics, checked against the pipeline). F6c globe MVP done (true-Sun lighting, Sun/Earth models, site markers, sight lines). F7 alternatives finder MVP done (Find sites tab, coarse-to-fine, checked against the exact engine). Next: deploy + README, then F8.
> "Lunar South Pole Mission Planner" is a working title; the final name is still to be decided.
> Companion PDF for sharing: [Lunar_South_Pole_Mission_Planner_Concept.pdf](Lunar_South_Pole_Mission_Planner_Concept.pdf), a short 5-page feature summary (each feature in 3–4 lines). Detailed report: [Lunar_South_Pole_Mission_Planner_Detailed_Report.pdf](Lunar_South_Pole_Mission_Planner_Detailed_Report.pdf) (16 pages)
>
> 📌 **Living document.** This file is the single source of truth. Every feature, idea or decision the team discusses is added here immediately, and logged in the [change log](#17-change-log). The PDF is a snapshot and may lag behind this file.

*"On the Moon, a mission needs two lights to survive: the Sun for power, and the Earth for a voice home."*

---

## Contents
1. [The challenge](#1-the-challenge)
2. [Background physics for the team](#2-background-physics-for-the-team)
3. [Glossary](#3-glossary)
4. [Design principles](#4-design-principles)
5. [Feature overview](#5-feature-overview)
6. [Feature details (F1–F10)](#6-feature-details-f1f10)
7. [Ideas parked from brainstorming](#7-ideas-parked-from-brainstorming)
8. [Decision log](#8-decision-log)
9. [Out of scope](#9-out-of-scope)
10. [Architecture and data](#10-architecture-and-data)
11. [Roadmap](#11-roadmap)
12. [Team roles](#12-team-roles)
13. [Open decisions](#13-open-decisions)
14. [Demo storyline](#14-demo-storyline)
15. [Reference numbers](#15-reference-numbers)
16. [How the plan evolved](#16-how-the-plan-evolved)
17. [Change log](#17-change-log)

---

## 1. The challenge

### Problem in plain language
Missions to the Moon's south pole face extreme lighting and communication limits. Tools like **NASA's QuickMap, Moon Trek and JPL Horizons** already have the data, but they are built for detailed analysis and are **hard for non-specialists to use for quick comparison**.

**The task:** build an **intuitive tool** that lets mission planners, educators and the public **compare landing sites and dates quickly**. It should show the **Sun and Earth relative to the horizon**, so users can judge **power** (solar) and **direct-to-Earth communication**.

### Three key takeaways from the official brief
1. **Only one item is strictly required:** show the Sun and Earth relative to the horizon at a chosen site and date. Everything else is "you may consider".
2. **The pain point is complexity.** Ease of use and speed are the winning qualities, not more analysis depth.
3. **The main use case is re-planning.** Hardware delays or launch slips force teams to evaluate **alternative dates at the same site** or **alternative sites nearby**, fast.

### Brief requirements vs our features
| Brief item | Status | Where we cover it |
|---|---|---|
| Sun and Earth vs horizon at a site on a date | **Required** | F1 site view, F6 globe |
| Curated sites (Apollo, CLPS, other commercial, other countries) + custom coordinates | Optional | F1/F6 site list; custom point: click anywhere on the F6 south-pole map (85°S–90°S) or type lat/lon |
| Side-by-side or sequential comparison | Optional | F4 comparison |
| Pick landing date and time | Optional | Date/time control on every view |
| How conditions change across lunar days and seasons | Optional | F2 timeline + seasons view; F3 date calendar |
| Time remaining before sunset / Earthset | Optional, stressed twice | F2 hero numbers (countdowns) |
| Solar elevation shown prominently | Optional, stressed twice | F2 hero numbers |
| Sunlight duration, Earth visibility windows | Optional | F2 timeline and metrics |
| 2D maps, 3D surface, creative visuals | Optional | F1 horizon dial; F6 2D south-pole map, 3D terrain view, whole-Moon globe |
| Animations and timelines | Optional | F6 time scrubbing, F2 timeline |
| Usable by planners, educators and the public | Optional | Explore/Planner modes; F8 explainer |
| Re-evaluate alternative dates or nearby sites after delays | Main use case | F3 slip planner, F7 alternatives finder |
| Why small location/date changes have big effects | Consideration | F8 explainer; F3 before/after deltas |
| Make lunar vs terrestrial differences apparent | Consideration | F8 Moon-vs-Earth cards |
| Real topography (LOLA), steep craters, shadows | Consideration | F1 horizons from LOLA; F6 3D terrain with shadows from the same horizon physics |
| Libration and orbital variations | Consideration | Computed in the Moon's own reference frame |
| No atmosphere: horizon = terrain + lunar curvature, no refraction | Consideration | F1 horizon calculation |
| Ephemeris from Horizons or precomputed datasets | Consideration | Precomputed offline, validated against Horizons ([section 10](#10-architecture-and-data), F5) |
| Power generation *potential* (not just Sun position) | Objective | F2 power-potential index *(added v1.2)* |
| Sun position also sets thermal conditions for equipment | Background | F2 thermal context indicators *(added v1.2)* |
| Represent steep slopes and deep craters with extreme shadow | Consideration | F6 slope + shadow layers *(slope layer added v1.2)* |
| Support coordination between science and engineering teams | Background + engagement | F4 science-vs-engineering view + shareable scenarios *(added v1.2)* |

**Allowed formats:** web app, mobile app, interactive visualisation, educational game. **We chose a web app, built for laptop screens first** (decided 2026-11-14). A phone-friendly layout comes later, only if time remains. F8 covers the education angle instead of a game, to keep a professional tone.

**Judging:** usefulness, clarity, creativity.

> ⚠️ The pasted brief was cut off at its resource list ("For data and resources related to this challenge, refer to th…"). Check the rest and add any recommended datasets to [section 10](#10-architecture-and-data).

---

## 2. Background physics for the team
None of us are aerospace specialists, and we don't need to be. These six facts explain almost every design decision.

| # | Fact | What it means for us |
|---|---|---|
| 1 | **The Sun never climbs high at the pole.** The Moon's axis is tilted only ~1.5°, so the Sun circles just above or below the horizon. | A small hill decides whether a spot is lit. A flat-horizon model is wrong. |
| 2 | **Earth bobs near the horizon.** The Moon's rocking (libration) moves Earth up and down by ~±7°. | Direct-to-Earth contact comes and goes on a monthly cycle. At the exact pole on flat ground, Earth is visible roughly half the time; slopes facing the near side see it more. |
| 3 | **Far-away mountains set the horizon.** At such low angles, peaks 50–100+ km away can block the Sun. | Horizons must come from a wide-area terrain model. |
| 4 | **No air, and a curved surface.** No atmosphere bends light, and distant terrain sits lower because the surface curves away (~0.8° lower at 50 km). | Horizon = terrain + curvature, no refraction. At the pole 0.8° is the difference between light and dark. |
| 5 | **The Sun is a disk, not a dot.** It's ~0.5° wide, so a ridge can cover part of it. | Report the *fraction of the Sun visible*, not just lit/unlit. |
| 6 | **Rovers are extremely slow.** Pragyan ~1 cm/s (~100 m in total); VIPER-class tops out near 0.2 m/s. | Rover trips are hundreds of metres to a few km. The stretch rover planner needs a 5–20 m grid. |

The "two lights" insight: **sunlight and radio line-of-sight are the same geometry problem.** The Sun decides power and the Earth decides comms.

---

## 3. Glossary
| Term | Meaning |
|---|---|
| **DTE** | Direct-to-Earth: the lander talks straight to Earth with no relay. |
| **Lunar day** | Sunrise to sunrise on the Moon: ~29.5 Earth days. |
| **Lunar seasons** | A slow (~1 year) cycle in how high the Sun gets at the pole, from the Moon's small axial tilt. |
| **Ephemeris** | A table of where bodies (Sun, Earth, Moon) are at each moment. JPL Horizons is NASA's reference source. |
| **Libration** | The Moon's slight apparent wobble, which moves Earth around in the lunar sky. |
| **LOLA / DEM** | LOLA = laser altimeter on NASA's Lunar Reconnaissance Orbiter. Its elevation maps are DEMs (digital elevation models). |
| **Horizon mask** | For one site, the terrain horizon's elevation angle in every compass direction (360 values). |
| **Sky plot** | A chart of azimuth (compass direction) vs elevation (angle above horizon) showing paths across the sky. |
| **Viability** | Whether a site-date meets mission thresholds (min sunlight, max darkness, min Earth visibility). |
| **Slip** | A delay to the planned landing date. |
| **Terminator** | The line between day and night on the Moon. |
| **PSR** | Permanently shadowed region: crater floors that never see sunlight, where water ice may be trapped. |
| **Diviner** | LRO instrument measuring surface temperature; ice is stable below ~110 K. |
| **Relay orbiter** | A satellite around the Moon that passes messages between the surface and Earth. |
| **Keplerian elements** | Six numbers describing an orbit (size, shape, tilt, orientation, position along it). |
| **Frozen orbit** | A lunar orbit chosen to stay stable instead of drifting; used by relay orbiters. |
| **SOC** | State of charge: how full the battery is. |
| **LOS / blackout** | Loss of signal: a period with no communication link. |
| **Point of no return** | The last moment a rover can turn back and still reach a safe, sunlit zone before its battery runs out. |

---

## 4. Design principles
- **Simple first, depth on demand.** The brief's complaint is that existing tools are too complex. The first screen answers the key questions in seconds; detail opens on request.
  - **Explore mode:** guided, with explanations (public, educators).
  - **Planner mode:** dense, all numbers (mission planners).
- **Hero numbers always visible:** solar elevation, time to sunset, time to Earthset.
- **Professional, agency-grade look** (NASA / ISRO / ESA level). **Not kiddish, no gamification.** Clean and restrained: thin rules, monospaced numbers. References: NASA's Eyes on the Solar System, LRO QuickMap, JPL Horizons.
- **One colour language everywhere** (globe, timelines, maps, charts):
  | Colour | Meaning |
  |---|---|
  | 🟡 Amber | Sunlit / power |
  | 🔵 Blue | Earth visible / DTE |
  | 🟣 Violet | Relay visible |
  | 🟢 Green | Power AND comms |
  | ⚫ Dark grey | Neither / blocked |
- **Agency conventions:** UTC (ISO-8601), SI units, selenographic lat/lon, coordinate frame stated (Moon mean-Earth / "ME" frame).
- **Data provenance:** every number can show its source and resolution (e.g. "horizon from LOLA, 240 m/px").
- **Honest labels:** "not to scale", "approximate", "illustrative" wherever they apply.
- **Export and share:** CSV/JSON download; permalinks that restore the exact scenario.
- **Accessibility basics:** colour-blind-safe palette (colour never the only cue), keyboard navigation, readable contrast.
- **Correctness beats features.** A wrong number in the demo costs more than a missing feature.

### Screens and visuals *(added v1.4)*
How the app looks and how the screens connect. **One selected point and one selected time are shared by every screen.** Change either anywhere (picker, map click, calendar, slider) and everything updates.

- **Top bar (always visible):** site picker · selected point (lat/lon) · Explore/Planner toggle · "Copy link to this scenario".
- **Time bar (pinned to the bottom, already built):** year strip, hourly slider, ±1 h / ±1 d buttons; a play button is added for the 3D time-lapse.
- **Screens.** Tabs: Site and plan · Find sites · Globe · Map · 3D · Compare (zooming in: whole Moon → south-pole map → 3D terrain).

| Screen | Main visual | Status |
|---|---|---|
| **Site** | Horizon dial, hero numbers, availability timeline, seasons, survival calculator (F1, F2) | ✅ Built |
| **Plan** | Landing-date calendar, slip buttons, before/after card, slip budget (F3) | ✅ Built |
| **Find sites** | South-pole map with every candidate spot coloured viable / marginal / not for your mission window, ranked shortlist with score breakdown (F7) | ✅ Built (F7 MVP) |
| **Globe** | Whole Moon lit from the true Sun direction, Sun/Earth models (not to scale, true directions), site markers, sight lines (F6c) | ✅ Built (F6c MVP) |
| **Map** | 2D south-pole map; click anywhere to pick a point; toggle layers (F6) | ✅ Built (F6a MVP) |
| **3D** | South-pole terrain in 3D with real Sun shadows and Earth visibility (F6b) | ✅ Built (F6b MVP) |
| **Compare** | 2–4 scenarios side by side (F4) | ✅ Built (MVP + 4 scenarios) |
| **Validation** | Horizons and LOLA comparisons, assumptions, sources (F5) | Phase 1 (check) / Phase 3 (full page) |

- **Visual rules:** dark background; amber = Sun, blue = Earth, green = both, grey = neither (exact colours in `web/src/index.css`). Every exaggerated or not-to-scale view says so on screen. Every layer shows its source and resolution. Hovering any chart, map pixel or terrain point shows the numbers behind it.

---

## 5. Feature overview
| Code | Feature | Tier | One line |
|---|---|---|---|
| F1 | Site view | 🟢 Core | 360° terrain horizon (with curvature) + sky plot of Sun and Earth paths |
| F2 | Hero metrics, timeline, seasons | 🟢 Core | Big numbers for solar elevation, time to sunset/Earthset; availability timeline; year view |
| F3 | Scenario and slip planner | 🟢 Core | Date calendar heatmap, "slip by N days" before/after, nearby alternatives |
| F4 | Site comparison | 🟢 Core | 2–4 site-date scenarios side by side |
| F5 | Credibility layer | 🟢 Core | Validation vs NASA data, assumptions panel, provenance, export |
| F6 | Lunar globe, south-pole map, 3D terrain | 🔵 Differentiator | Click anywhere on a 2D south-pole map; 3D terrain with real shadows; whole-Moon globe |
| F7 | Alternatives finder | 🔵 Differentiator | Constraints in, ranked shortlist out; water-ice option |
| F8 | Explainer + Moon vs Earth | 🔵 Differentiator | "Why?" cards linked from the data; contrast with Earth |
| F9 | Relay mode | ⚪ Stretch | Comms through a user-defined relay orbiter |
| F10 | Rover excursion planner | ⚪ Stretch | Safe trips into shadow with a guaranteed way back |

**Tier rules:**
- **Core:** what the brief asks for. Ship all of it, correct and polished, before anything else.
- **Differentiator:** what makes us stand out. Start only after core works and matches JPL Horizons.
- **Stretch:** beyond the brief. Build only if every core and differentiator feature is finished.

**What makes us stand out:**
- **Built for when plans change.** The slip planner answers "what now?" in seconds; today it takes several specialist tools.
- **The "two lights" framing.** Sun = power, Earth = comms, same geometry, one colour language.
- **It explains itself.** Key numbers link to a short "Why?", so a student and an engineer can use the same screen.
- **Honesty as a feature.** Everything validated, sourced and labelled with its accuracy.

---

## 6. Feature details (F1–F10)

### 🟢 F1 Site view: the one required item
- **What:** for one site and time, the 360° terrain horizon plus a sky plot of where the Sun and Earth are now and their paths over the chosen period.
- **Why:** the brief's only hard requirement. Shows exactly which ridge blocks the Sun or Earth, and when.
- **Horizon calculation:**
  - terrain from a **wide-area** LOLA model (distant mountains matter);
  - **plus the Moon's curvature** (distant point drops by ~d / 2R);
  - **no atmospheric refraction**;
  - Sun as a **0.5° disk**, so partial sunlight is reported.
- **Inputs:** site (curated, or custom lat/lon inside the precomputed region); date/time; period.
- **Outputs:** horizon profile, current Sun/Earth positions, tracks, optional first-person panorama.
- **MVP:** horizon profile with curvature, sky plot, current positions, tracks.
- **Stretch:** first-person horizon panorama rendered from terrain.
- **Horizon dial** *(added v1.3, Phase 1)*: the main way the sky plot is shown. At the pole the Sun circles the whole horizon over a lunar day, so the view is a circular dial: the terrain silhouette as a ring, the Sun and Earth moving around it like clock hands. Intended as the tool's signature visual.
- **Landing-ellipse dispersion** *(added v1.3, Phase 2)*: landers land somewhere inside an uncertainty ellipse, not exactly on target.
  - Draw the ellipse (size from a lander preset or user input) on the map.
  - Show the **range** of outcomes inside it, e.g. "sunlight: worst case 31%, typical 55%, best case 78%", for each key metric.
  - Uses the precomputed grids; also feeds F4 and F7 (rank sites by worst case inside the ellipse).

### 🟢 F2 Hero metrics, timeline and seasons
- **Hero numbers (large, top-level):** **solar elevation** now · **time to sunset** (countdown) · **time to Earthset** (countdown) · status chips (sunlit/dark, Earth in view/out).
- **Timeline:** parallel Gantt-style tracks for Sunlit (shaded by fraction of Sun visible), Earth visible (DTE), Both, and lunar-eclipse events.
- **Metrics:** sunlight duration and %; **longest continuous darkness**; Earth visibility windows and %; time to next sunrise/Earthrise; **longest gap without Earth contact**.
- **Seasons view:** a year-long strip of max Sun height, sunlight % and Earth visibility across lunar days and seasons.
- **Why:** the brief stresses solar elevation and time to sunset/Earthset twice. Worst cases matter more than averages: batteries are sized for the longest darkness, operations for the longest silence.
- **MVP:** hero numbers, Sun and DTE tracks, core metrics, seasons strip for curated sites.
- **Stretch:** partial-Sun shading; eclipse flag (a few times a year Earth blocks the Sun for hours).
- **Power potential index** *(added v1.2)*: the share of full-Sun power a solar panel would get, from the visible Sun fraction and the Sun's angle on the panel.
  - Default panel: vertical and turning to face the Sun. This is common at the pole because the Sun is so low; a flat, horizontal panel would get almost nothing.
  - Shown as a simplified index, clearly labelled, not a power prediction.
  - Why: the brief asks to assess power *generation potential*, not only where the Sun is.
- **Thermal context** *(added v1.2)*: the brief notes the Sun also sets equipment temperature. We don't model temperature; we show cold-exposure indicators (hours since sunset, longest darkness), labelled as indicators.
- **Lander survival calculator** *(added v1.3, Phase 1)*: the user enters the lander's average power use during darkness (W) and its usable battery (Wh).
  - Output: "Survives the longest darkness at this site: yes / no", and the minimum battery needed (= power × longest darkness, plus a safety margin).
  - Much simpler than the F10 rover planner; turns F2's numbers into an engineering decision.

### 🟢 F3 Scenario and slip planner: "The launch slipped. What now?"
- **What:** a re-planning mode. When a delay moves the landing date, it shows which dates still work at the same site, and which nearby sites work on the new date.
- **Viability rule:** the user sets thresholds (min sunlight %, max continuous darkness, min Earth visibility, mission length). Each site-date is marked **viable / marginal / not viable**. Sensible defaults provided.
- **Date calendar:** heatmap with one cell per candidate landing date over months, coloured by viability. Hover shows key numbers; click opens the scenario.
- **Slip by N days:** buttons for +1 d, +7 d, +14 d, +1 lunar month, custom. A **before/after card** shows what got better or worse (sunlight, time to sunset at landing, longest darkness, Earth visibility, time to Earthset).
- **Nearby alternatives:** for the new date, sites within X km ranked by viability, shown on the map, one click to compare (F4).
- **Saved scenarios:** a list of site-date scenarios; shareable by permalink.
- **MVP:** viability rule, date calendar, slip buttons with before/after card, for curated sites.
- **Stretch:** nearby alternatives across the precomputed grid (shares the engine with F7); saved scenario sets.
- **Slip budget** *(added v1.3, Phase 1)*: for a planned date, "you can slip up to 9 days and stay viable; after that, the next viable window opens on …". Read straight off the date calendar's viability data.

### 🟢 F4 Site comparison
- **What:** 2–4 scenarios (different sites, or one site on different dates) side by side or sequentially.
- **Outputs:** synchronised timelines; hero numbers per scenario; metric table with the best value per row highlighted; CSV/JSON export.
- **MVP:** two scenarios, synced timelines, metric table.
- **Stretch:** four scenarios; a difference view highlighting where they diverge.
- **Science vs engineering view** *(added v1.2)*: the brief says site selection must balance science and engineering teams.
  - Group each scenario's numbers into **Engineering** (power, comms, darkness, slope) and **Science** (e.g. water-ice proximity from F7).
  - The trade-off is visible at a glance, and a permalink lets both teams review the same scenario.
- **Site assessment report** *(added v1.3, Phase 3)*: one click exports a scenario (or a comparison) as an agency-style briefing PDF using the browser's print function.
  - Contents: site and date, hero numbers, timeline and dial, science-vs-engineering summary, landing-ellipse range, assumptions, data sources, tool version.

### 🟢 F5 Credibility layer
- **Validation:**
  - Sun/Earth directions vs **JPL Horizons**;
  - sunlight % vs published **LOLA illumination maps (Mazarico et al., 2011)**;
  - errors shown openly on a validation page.
- **Assumptions panel:** terrain resolution, time step, and what we do *not* model, stated plainly.
- **Provenance and export:** source and resolution on every number; CSV/JSON; permalinks.
- **MVP:** Horizons comparison (the Phase 1 gate) and assumptions panel.
- **Stretch:** full validation page including the illumination-map comparison.
- **Mission replays** *(added v1.3, Phase 2)*: load real missions at their real landing site and date, e.g. Chandrayaan-3, IM-1 Odysseus, IM-2 Athena.
  - Show what our tool predicts (sunlight, time to sunset, Earth visibility) next to what actually happened, e.g. a mission ending at sunset, or a lander that tipped into shadow and lost power.
  - Proves the tool matches reality, and gives the pitch real stories.
  - ⚠️ Every mission fact (coordinates, dates, outcomes) must come from official sources, with the source cited in the app.

### 🔵 F6 Lunar globe, south-pole map and 3D terrain
F6 has three views sharing one engine and one data set: a **2D south-pole map** (pick any point), a **3D south-pole terrain view** (see the shadows), and the **whole-Moon globe** (context). *(Map and 3D terrain added v1.4.)*

#### F6a 2D south-pole map with click-anywhere *(added v1.4; first Phase 2 item)*
- **What:** a top-down map of 85°S–90°S with 0°E at the top (same orientation as `horizon.py`). Drawn on a plain canvas, no map library. Shows a lat/lon grid, a scale bar and curated site markers.
- **Layers (toggle on/off):**
  - shaded relief (base layer, from our LOLA DEM);
  - NASA sunlight % and Earth-visibility % (PGDA `AVGVISIB_85S_060M_201608` and its Earth version, already used for validation);
  - permanently shadowed regions (`LPSR_85S_060M_201608`);
  - slope (from our DEM);
  - Artemis III candidate regions (approximate, sourced);
  - "lit now / Earth in view now" at the selected time (from the F6b shadow shader).
- **Hover:** lat/lon, terrain height, slope, and the value of the active layer.
- **Click anywhere:** a pin drops and, in about a second, the dial, hero numbers, timeline, planner and comparison all switch to that point. "Add to comparison" from the pin. The pin is saved in the permalink.
- **How the click works (no server).** The browser runs the same maths as the Python pipeline, in a Web Worker:
  1. horizon mask for the point from a cropped DEM (80°S–90°S at 240 m, so every clickable point has ≥ 150 km of terrain around it);
  2. Sun and Earth position vectors in the Moon ME frame for every hour of the analysis year, exported once from Skyfield (~200 KB). The browser converts them to the point's local sky, including Earth parallax (the point is 1,737 km from the Moon's centre);
  3. the same visibility and metrics as `timeline.py`, in the same format as the per-site files, so every existing panel works unchanged.
- **Self-check (must pass before the demo):** for every curated site, the browser result matches the Python pipeline: Sun/Earth direction within 0.001°, sunlit % within 0.5 percentage points. Python is already checked against Horizons, so the browser inherits that accuracy.
- **Limits, stated in the app:** custom points only in 85°S–90°S (elsewhere use curated sites); same 240 m resolution limit as the pipeline.
- **Data cost:** DEM crop ~13 MB raw (int16), less compressed. If loading is too slow, halve the resolution beyond 30 km.

#### F6b 3D south-pole terrain view *(added v1.4, Phase 2)*
- **What:** the same DEM crop as a Three.js 3D surface (downsampled to ~1024 × 1024 vertices). Vertical exaggeration slider, default 1×, labelled whenever it is above 1×.
- **Shadows come from our horizon physics, not from Three.js shadow maps.** A shader tests each terrain pixel by stepping across the heightmap toward the Sun, with curvature included, exactly like the horizon mask.
  - Why: with the Sun only 1–2° above the horizon over a 300 km scene, standard shadow maps are inaccurate, so the picture would disagree with our numbers.
  - Recomputed only when the time changes, not every frame.
- **Earth too:** the same test toward Earth gives an Earth-visible tint. Colours: amber = lit, blue = Earth in view, green = both, dark = neither.
- **Camera presets:** overhead; standing at the selected point looking at the Sun; looking at Earth; low angle over Shackleton crater.
- **Selected point:** pin plus line-of-sight rays to the Sun and Earth (solid = clear, red dashed = blocked).
- **Shadow time-lapse:** press play and shadows sweep around the pole over a lunar day.
- **Self-check:** shader lit/dark matches the pipeline at the curated sites for sample hours.
- **Fallback if the shader misses its time box:** plain directional light, labelled "lighting illustrative".

#### F6c Whole-Moon globe ("Google Earth for the Moon")
- **What:** an interactive 3D Moon to spin and zoom, from the whole globe down to site terrain, like Google Earth for Earth.
- **On the surface:**
  - site markers (curated + custom) and Artemis III candidate regions (approximate);
  - sunlight and Earth-visibility heatmaps, permanently shadowed regions, F3 viability colouring;
  - **slope layer** *(added v1.2)*: steep crater walls highlighted, since the brief asks how to represent steep slopes and deep craters;
  - line-of-sight rays to the Sun and Earth (red when blocked);
  - the true day/night line for the selected time.
- **Sun and Earth:** 3D reference models. **Sizes and distances NOT to scale, directions TRUE** (the Sun's direction drives the lighting). Labelled "Not to scale; directions accurate".
- **Relay orbiter (with F9):** orbit drawn around the Moon; this part can be to scale.
- **Time control:** scrub or play; lighting and models move together.
- **MVP:** globe, site markers, correct Sun lighting, Sun/Earth reference models, time scrubbing. ✅ *Built 2026-11-14 as its own **Globe** tab (`web/src/Globe.tsx`); see change log.*
- **Stretch:** heatmap layers, metre-level terrain zoom, line-of-sight rays, orbit drawing.
- **Shadow time-lapse** *(added v1.3, Phase 2)*: an animated sweep of sunlight and shadow across the south-pole region over a lunar day; crater shadows rotate like clock hands. A key demo moment. *(v1.4: built in the F6b 3D view with the shadow shader, not from precomputed grids.)*
- **Reality check:** directions must come from the real ephemeris; wrong lighting is the first thing an expert notices.
- **Globe textures:** NASA CGI Moon Kit (LROC colour + LOLA elevation), lit from the true Sun direction.
- **Engine: Three.js** *(decided v1.4)*, for all three views.
  - Runs offline with NASA's Moon Kit textures and our own DEM, with no account or token.
  - One engine for the globe and the terrain, and full control of the shadow shader.
  - CesiumJS's lunar terrain is served through a Cesium ion account and gives less control over the shading.

### 🔵 F7 Alternatives finder (was "site finder")
- **What:** state mission constraints; the tool searches the south-pole region and ranks locations. Powers F3's nearby alternatives and also works region-wide.
- **Inputs:**
  - min sunlight %, max continuous darkness;
  - min Earth visibility and max gap without contact;
  - max landing slope (typically ~8–10°, verify);
  - mission duration and date window; search radius.
- **Science option:** **water-ice prospecting** only (closeness to PSRs + Diviner ice-stability temperature), plus "engineering only".
- **Outputs:**
  - suitability heatmap;
  - ranked shortlist with a **score breakdown** explaining each rank;
  - one click to compare (F4);
  - Artemis III regions overlay.
- **Method:** coarse-to-fine. A quick pass on a coarse grid and time step, shortlist the top ~20, then compute those in detail.
- **MVP:** filters on precomputed sunlight, Earth visibility and slope; ranked list. ✅ *Built 2026-11-14 as the **Find sites** tab; it goes further than this MVP: visibility is computed for the user's own mission window, not from yearly averages (see change log).*
- **Stretch:** water-ice scoring.

### 🔵 F8 Explainer and Moon vs Earth
- **"Why?" cards:** key numbers link to a short illustrated explanation tied to the current data:
  - the Sun skimming the horizon (1.5° tilt);
  - a ridge blocking the Sun;
  - libration moving Earth;
  - why 5 km can change everything;
  - why dates and seasons matter;
  - why there is no twilight (no air).
- **Moon-vs-Earth contrast cards:**
  - "Highest Sun here this month: 1.2°; in your chosen city today: 58°";
  - a lunar day lasts ~29.5 Earth days;
  - darkness can last days, not hours;
  - black sky, hard-edged shadows.
- **Explore mode:** a guided path for classrooms and the public, using the same data as Planner mode.
- **Why:** the brief asks to explain why small changes matter and to make lunar vs terrestrial differences apparent. Covers education without turning the product into a game.
- **MVP:** 4–5 "Why?" cards with simple diagrams; one contrast card on the site view.
- **Stretch:** guided Explore-mode walkthrough.

### ⚪ F9 Relay mode (stretch)
- **Why stretch:** the brief focuses on direct-to-Earth communication "without relay satellites".
- **Link rule:** works only when **both** hold: the orbiter is above the site's terrain horizon (plus a minimum antenna angle) **and** the orbiter can see Earth.
- **Orbit input, three levels:**
  - **Presets:** low polar circular (~100 km); elliptical frozen orbit (~12 h, high point over the south pole). This is the type real south-pole relays use.
  - **Simple:** highest/lowest altitude, tilt, where the high point sits.
  - **Advanced:** full Keplerian elements + epoch.
- **Accuracy:** two-body orbit model (Moon's gravity only), labelled "approximate". Fine for days to weeks; real low orbits drift because lunar gravity is lumpy. Halo/NRHO orbits excluded.
- **Outputs:** relay track in F2; combined comms (DTE **or** relay); orbit on F6; can feed F7 ranking by **max comm gap**.
- **Insight to present:**
  - with a high elliptical orbit the orbiter is high in the sky, so terrain rarely matters;
  - with a low orbit it skims the horizon, so terrain dominates.
- **Real examples to cite (verify status):** Chandrayaan-2 orbiter supporting Chandrayaan-3, China's Queqiao-2, ESA's Lunar Pathfinder, NASA's planned LCRNS.

### ⚪ F10 Rover excursion planner (stretch)
- **Why stretch:** not asked for in the brief. A strong showcase only once everything else works.
- **Core idea:** **the safe zone moves.** A ridge lit now may be dark in 12 hours, so the planner returns the rover to where sunlight and contact **will be** when it arrives. This is a real planning problem: NASA's VIPER rover team had to plan around exactly this.
- **Rover profile:**
  - speed (and slowdown on slopes), max slope;
  - battery capacity (Wh) and usable fraction;
  - power while driving, doing science, idling, surviving (one number covers heaters);
  - solar charging power when lit;
  - comm capability and longest acceptable blackout;
  - safety margin %.
  - Presets: Pragyan-class, VIPER-class (approximate), custom.
- **Outputs:**
  - reachable-and-returnable zone map;
  - point-of-no-return line and a "turn back by" time;
  - max science time at the target;
  - return destination and arrival time;
  - battery chart with phases (outbound → science → return → recharge);
  - comm blackout durations (flagged if over the limit);
  - multi-trip schedule across a lunar day (stretch-of-stretch).
- **Example:** a rover with a 12 h battery enters a dark crater → "stay at most 4 h 10 m, turn back by 14:32 UTC, arrive at the lit ridge 19:05 UTC with 22% battery".
- **Method:** time-indexed lit/contact grid for a small high-resolution region → "time to safety" field by searching backwards from safe cells → trip allowed where outbound + return energy ≤ battery × (1 − margin). Runs in a browser Web Worker.
- **MVP:** constant speed and power; zone, turn-back time, arrival time, battery chart for one few-km region near Shackleton crater on a 5–20 m grid.
- **Stretch:** slope-dependent speed and power, drawn optimal route, comm constraint, multi-trip scheduling.
- **Reality check:** real rovers are slow, so the grid must be fine. Thermal behaviour is simplified to one survival-power number, stated as an assumption.

---

## 7. Ideas parked from brainstorming
These came up in the first brainstorm but were never formally decided. They're kept here so nothing is lost; revisit only if time allows.

| Idea | What it was | Status / thought |
|---|---|---|
| **"Look up from the Moon" phone view** | Hold your phone up and see the real lunar horizon with the Sun and Earth, using the phone's gyroscope through the browser (no app). | Parked. Great live-demo moment; could become an F1 stretch item (first-person panorama + gyroscope). |
| **Lunar weather-forecast cards** | Each site shown like a weather app: "Sunny 87%, Earth visible until Tue 14:00, 41 h darkness ahead". | Parked. Partly absorbed by F2 hero numbers and F8 Explore mode. |
| **"Two Lights" map** | Terrain rendered with the Sun (gold) and Earth (blue) as two light sources; green = both. | **Absorbed** into the colour language and F6 heatmaps. |
| **Reverse search** | "Where and when should I land?" | **Absorbed** into F7 Alternatives finder. |
| **Survival game** | Lander battery drains in shadow; leaderboard. | **Dropped**: not professional enough. |
| **Sonification** | Sunlight as sound, for blind users. | **Dropped**: tone. Accessibility is covered by design basics instead. |

### Brainstorm round 2 (2026-11-14)
Mentor verdicts: ⭐ = strongly recommend, 🟡 = maybe later, ❌ = not worth it.
**All seven ⭐ ideas were promoted into the plan in v1.3** (see [section 6](#6-feature-details-f1f10)). 🟡 ideas stay parked; ❌ ideas are rejected.

| Idea | What it is | Verdict and fit |
|---|---|---|
| ⭐ **Mission replays** | Load real missions (e.g. Chandrayaan-3, IM-1 Odysseus, IM-2 Athena) at their real site and date. Show what our tool predicts: sunlight, time to sunset, Earth visibility. Compare with what actually happened (e.g. a lander tipping into shadow and losing power; a mission ending at sunset). **Verify every mission fact.** | **✅ Promoted v1.3 → F5.** Validation and storytelling in one. Proves the tool matches reality; a powerful pitch moment. Fits F5 + F3. Low cost once the core works. |
| ⭐ **Landing-ellipse dispersion** | Landers don't touch down exactly on target; they land somewhere inside an uncertainty ellipse (km-scale, varies by lander; verify values). Draw the ellipse and show the **range** of outcomes inside it: "worst case 31% sunlight, best case 78%". | **✅ Promoted v1.3 → F1.** How real site-selection teams think; directly answers "small location changes have big effects". Uses the same precomputed grids. Fits F1/F4/F7. |
| ⭐ **Slip budget** | For a planned date: "you can slip up to 9 days and stay viable; after that, the next window opens on …". | **✅ Promoted v1.3 → F3.** Tiny extension of F3 with very high value for the brief's main use case. |
| ⭐ **Horizon dial** | At the pole the Sun circles the whole horizon over a lunar day. A circular dial with the terrain silhouette as a ring, and the Sun and Earth moving around it like clock hands. | **✅ Promoted v1.3 → F1.** The most intuitive way to show pole geometry; a signature visual. Design option for F1's sky plot. |
| ⭐ **Lander survival calculator** | Enter the lander's power use (W) and battery (Wh). The tool says whether it survives the site's longest darkness, and what battery it would need. | **✅ Promoted v1.3 → F2.** Turns metrics into an engineering decision in one step. Much simpler than the F10 rover planner. Fits F2. |
| ⭐ **Site assessment report** | One click exports a scenario as an agency-style briefing (metrics, charts, assumptions, data sources) as PDF via the browser's print. | **✅ Promoted v1.3 → F4.** Supports science-engineering coordination; looks very professional; cheap to build. Fits F4/F5. |
| ⭐ **Shadow time-lapse** | Animated sweep of shadows across the south-pole region over a lunar day; crater shadows rotate like clock hands. | **✅ Promoted v1.3 → F6.** Huge demo wow for little extra work once illumination grids exist. Fits F6. |
| 🟡 **Earthrise view with Earth phase** | First-person view of Earth rising over a ridge, showing its correct phase (Earth's phase seen from the Moon is opposite the Moon's phase seen from Earth). Earthshine lights the terrain when the Sun is down. | Beautiful and educational. Fits F8 or the F1 panorama stretch. |
| 🟡 **Complementary site pairs** | Find two or three sites whose sunlit periods cover each other's darkness, so at least one always has power. | A real concept for future multi-site bases. Easy once timelines exist (combine them). Stretch. |
| 🟡 **Uncertainty bands** | Show how much a result could change from terrain resolution, e.g. "sunset 14:20 ± 40 min". | Very credible to experts. Fits F5; needs some method work. |
| 🟡 **Embeddable site card** | A small widget teachers or other sites can embed, showing live hero numbers for one site. | Reach for educators; easy if data is static JSON. |
| 🟡 **3D-printed terrain + lamp (booth demo)** | 3D-print the Shackleton region from LOLA data and shine a lamp at a very low angle to show the long shadows live. | Physical, unforgettable for in-person judging; only if someone has a 3D printer. Pitch prop, not software. |
| ❌ **VR / WebXR walk on the rim** | Stand on the crater rim in a VR headset. | Cool, but judges rarely have headsets and it doesn't speed up comparison. |
| ❌ **Natural-language AI query** | "Find sites near Shackleton viable in March 2027." | Same reason we dropped the chatbot: risk of wrong answers, adds little over good filters. |
| ❌ **Power beaming, lasers, sci-fi infrastructure** | Beaming power into dark craters. | Not grounded in the brief or near-term missions. |

### Review of older build notes (2026-11-14)
Two earlier notes (a resource plan and a build list) were checked against what is now built. Verdicts: ✅ already done, ⭐ worth adding, 🟡 maybe later, ❌ don't.

| Idea from the old notes | Verdict | Why |
|---|---|---|
| Validate Sun/Earth against JPL Horizons | ✅ Done, beyond the note | 3 points × 721 hourly steps, worst 0.000033° (note asked for 2 sites × 3 dates) |
| Check % sunlit against QuickMap's LOLA illumination layer | ✅ Done, stronger | We compared directly with NASA's LOLA illumination maps (the data behind that layer) at 80 points: correlation 0.99. A QuickMap screenshot can still go on a slide |
| Go / marginal / no-go verdict, timeline bars, metric cards, grouped site picker, best-dates heatmap | ✅ Done | F3 viability, F2 timeline and readouts, F3 calendar |
| In-browser `astronomy-engine`, 10-minute steps, browser-side horizon logic | ❌ Superseded | Plan decision: precompute in Python (Skyfield + our own LOLA horizons), validated; the browser only loads results |
| "Not building: own LOLA ray-marching" | ❌ Superseded | We built it from NASA LOLA data and validated it |
| Crediting another team's horizon masks | ❌ Never | All horizons are our own, computed from NASA LOLA; only NASA/JPL/IAU/LROC sources are credited |
| "Validated against JPL Horizons, max error X°" badge + data sources panel in the app | ✅ Done (2026-11-14) | Header badge links to a 'Data sources and validation' panel (checks, known limits, sources) |
| "Open in QuickMap / Moon Trek" link per site | ✅ Done, simplified (2026-11-14) | QuickMap's share links use projected metres and a test landed 0.7° off, so instead: 'Copy coordinates' + links to QuickMap (new address quickmap.lroc.im-ldi.com) and Moon Trek, whose search boxes take lat,lon |
| Play button for time | ✅ Done (2026-11-14) | Play/Pause with 1 h, 6 h or 1 day per step |
| README + deployed URL | ⭐ Required (Phase 3) | Submission needs both; free static hosting works |
| Mast height choice (1, 2, 5, 10 m) | 🟡 Later | Real effect (height adds sunlight at the pole) but 4× the precomputed data; fits F1 Planner mode |
| Custom lat/lon | 🟡 Phase 2 | Plan item; needs a precomputed grid (shares the F7 engine), since the browser has no terrain data |
| ~20 sites incl. Artemis III | 🟡 When sourced | NASA publishes Artemis III regions, not points; add only with cited coordinates |
| 360° horizon panorama (strip) | 🟡 Planned | Already in the plan as the classic azimuth-elevation view for Planner mode |
| CSA content, Canadian rover target | 🟡 Optional | Only if a target has published coordinates |

---

## 8. Decision log
All decisions confirmed by the team on 14 November 2026. v1.1 rows follow the official brief.

| Idea | Decision | Now | Reason |
|---|---|---|---|
| Sun/Earth vs terrain horizon | ✅ Keep (core) | F1 | The brief's only hard requirement |
| Timeline, metrics, countdowns | ✅ Promoted | F2 | Hero numbers; brief stresses them twice |
| Seasons view | ✅ Added (v1.1) | F2 | Brief asks about lunar days and seasons |
| Lunar curvature, no refraction | ✅ Added (v1.1) | F1 | Named in the brief; ~0.8° at 50 km matters at the pole |
| "Plan slipped" scenario mode | ✅ Added (v1.1) | F3 | The brief's main use case |
| Curated sites + custom coordinates | ✅ Keep | F1, F6 | Custom points limited to the precomputed region |
| Side-by-side comparison | ✅ Keep | F4 | Asked for in the brief |
| Validation, assumptions panel, eclipse flag, partial Sun | ✅ Keep | F5, F2 | Make experts trust the numbers |
| 3D Sun-Earth-Moon solar system | 🔁 Reshaped | F6 | Became a Google-Earth-style Moon globe; Sun/Earth not to scale but in true directions |
| Site finder (mission-profile search) | 🔁 Reframed (v1.1) | F7 | "Find alternatives when plans change" serves the brief directly |
| Explainer, Moon vs Earth | ✅ Added (v1.1) | F8 | Brief asks to explain why small changes matter |
| Power potential index | ✅ Added (v1.2) | F2 | Brief asks to assess power *generation potential*; simplified, labelled index |
| Thermal context indicators | ✅ Added (v1.2) | F2 | Brief notes the Sun sets equipment temperature; indicators only, no thermal model |
| Science vs engineering view | ✅ Added (v1.2) | F4 | Brief stresses balancing science and engineering teams |
| Slope layer on globe | ✅ Added (v1.2) | F6 | Brief asks how to represent steep slopes and deep craters |
| Horizon dial | ✅ Added (v1.3) | F1 | Most intuitive picture of pole geometry; signature visual |
| Slip budget | ✅ Added (v1.3) | F3 | Tiny addition aimed at the brief's main use case |
| Lander survival calculator | ✅ Added (v1.3) | F2 | Turns metrics into an engineering decision |
| Landing-ellipse dispersion | ✅ Added (v1.3) | F1 | How real site-selection teams handle landing uncertainty |
| Mission replays | ✅ Added (v1.3) | F5 | Proves the tool against real outcomes; pitch stories |
| Shadow time-lapse | ✅ Added (v1.3) | F6 | Demo wow; reuses illumination grids (v1.4: shader in the 3D view) |
| 2D south-pole map with click-anywhere | ✅ Added (v1.4) | F6a | Any point in 85°S–90°S becomes a site; browser runs the pipeline maths in a Web Worker, checked against Python |
| 3D south-pole terrain view | ✅ Added (v1.4) | F6b | Shows *why* a site is lit or dark; hosts the shadow time-lapse |
| 3D engine: Three.js | ✅ Decided (v1.4) | F6 | Offline, no account, one engine for globe and terrain, full shader control |
| Terrain shadows from horizon physics (shader), not Three.js shadow maps | ✅ Decided (v1.4) | F6b | Shadow maps are inaccurate at 1–2° Sun; picture must agree with the numbers |
| Site assessment report | ✅ Added (v1.3) | F4 | Agency-style briefing for team coordination |
| Relay orbiter mode (user-supplied orbit) | ⬇️ Demoted (v1.1) | F9 | Brief focuses on direct-to-Earth |
| Energy/traverse simulator | 🔀 Merged | F10 | Merged with the dark-zone excursion idea |
| Dark-zone excursion with safe return | ⬇️ Demoted (v1.1) | F10 | Not in the brief; strong but optional |
| Multiple science objectives (ice, SPA geology, long-duration station) | ➖ Reduced | F7 | Water ice only; hydrogen maps too coarse (tens of km/pixel) |
| Detailed rover thermal model | ➖ Simplified | F10 | One survival-power number |
| Professional, agency-grade UI | ✅ Keep, refined | All | Professional, but simple first with depth on demand |
| Educational game | ❌ Not built | — | Allowed by the brief, but F8 covers education professionally |
| Ground-station (DSN / IDSN) layer | ❌ Drop | — | DSN's three sites give near-continuous coverage; little insight |
| Survival game, sonification | ❌ Drop | — | Didn't fit the professional direction |
| Ephemeris library: Skyfield (not SPICE) | ✅ Decided | Pipeline | Same JPL data and accuracy as SPICE, much easier for a non-expert team; supports the Moon ME frame. Used in one small module, so swapping later is cheap. JPL Horizons is the validation reference, not the engine |
| Codebase location | ✅ Decided | All | Everything built from scratch in `lunar-mission-planner/` |
| Frontend stack: React + Vite + TypeScript | ✅ Decided | Web app | Best known by teammates' AI tools; static site, so any free static host works. Dial and strip are hand-drawn SVG, no chart library yet |
| Typeface: Public Sans with tabular figures | ✅ Decided | Web app | U.S. government's open typeface (agency-grade); tabular figures keep numbers aligned without a separate monospace font |
| Target device: laptop first | ✅ Decided | Web app | Judges and the demo use laptop screens; the globe, comparisons and charts need the space. Design and test for laptop widths only. A phone-friendly layout is Phase 3 stretch, only if time remains. Don't delete the phone-width layout that already works, but don't spend time on it |

---

## 9. Out of scope
If a judge asks, the answer is: *"Out of scope for the hackathon; listed as future work."*

- Radio link budgets and data rates
- Detailed thermal modelling
- Science objectives beyond water ice
- Ground-station (DSN / IDSN) scheduling
- Halo / NRHO orbits (e.g. the Gateway orbit; need three-body modelling)
- Multiple simultaneous relay orbiters
- AI chatbot interface
- A to-scale solar-system view
- Games and sonification
- Native mobile app
- Phone-friendly layout, until the laptop version is done (Phase 3 stretch, only if time remains)

---

## 10. Architecture and data

### How it fits together
```
OFFLINE (Python, run once)          PRECOMPUTED DATA              WEB APP (browser)
─────────────────────────           ────────────────              ─────────────────
Ephemeris (Skyfield)        ──┐                                ┌─► F1–F2 Site view + hero metrics
Terrain (LOLA DEMs)         ──┼──►  Sun/Earth direction tables ──┼─► F3–F4 Slip planner + comparison
  horizons incl. curvature    │     Horizon masks per site       ├─► F6 Lunar globe
Science layers (PSR, Diviner)─┤     Daily metrics, 1+ year       ├─► F7–F8 Alternatives + explainer
Validation (Horizons, LOLA) ──┘     Lit / Earth-visible grids    └─► F9–F10 Relay + rover (stretch,
                                    Slope & science rasters            computed live)
                                    Globe tiles, validation
```
- **Heavy work offline:** terrain horizons with curvature, a year or more of daily metrics per site, and illumination grids, computed once in Python.
- **The web app loads precomputed results**, so comparisons and slip checks are instant.
- **Computed live in the browser:**
  - custom-point horizon and visibility when the user clicks the F6a map (Web Worker, same maths as the pipeline, checked against it);
  - terrain shadows and Earth visibility in the F6b 3D view (shader);
  - stretch only: the user-defined relay orbit (two-body propagation) and the rover planner (Web Worker).
- **Extra exports for the browser (v1.4):** an 80°S–90°S DEM crop (240 m), hourly Sun/Earth position vectors in the Moon ME frame, and map layer images (shaded relief, slope, NASA sunlight/Earth %, PSRs).

### Data sources
| Source | Used for | Notes |
|---|---|---|
| JPL Horizons | Reference positions; validation | NASA's authoritative ephemeris service; named in the brief |
| Skyfield + JPL DE ephemeris + lunar frame kernels | Sun/Earth directions from any lunar site, offline | Working in the Moon's own frame handles libration automatically. DE421-era Moon frame files are known to work in Skyfield (cover 1900–2050); test DE440-era files before switching |
| LOLA south-pole DEMs | Horizon masks, slopes, terrain meshes | Wide-area DEM for distant horizons; 5–20 m DEM for the rover region |
| LOLA illumination maps (Mazarico et al., 2011) | Validation of our sunlight % | Published reference results |
| PSR maps, Diviner temperature | Water-ice option (F7) | Ice stable below ~110 K |
| NASA CGI Moon Kit (LROC colour + LOLA elevation) | Globe textures | Free NASA visualisation assets |
| NASA Artemis III candidate regions | Overlay | Approximate outlines from NASA announcements |

Confirmed so far (Phase 1):
- **Ephemeris:** JPL `de421.bsp`, `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf`, `pck00008.tpc` (frame MOON_ME_DE421).
- **Terrain:** PDS LOLA GDR `LDEM_60S_240M` (240 m/px, polar stereographic, 60°S–90°S; replaced `LDEM_75S_240M`, same data, wider so Chandrayaan-3 at 69°S fits), with the global `LDEM_16` (~1.9 km/px) as fallback beyond it and for low-latitude contrast sites. Both MEAN EARTH/POLAR AXIS of DE421 — same frame as our ephemeris). Heights relative to a 1737.4 km sphere. ⚠️ The projection's forward formula in PDS `DSMAP_POLAR.CAT` is mirrored east–west; the correct orientation (0°E up, 90°E right) was verified against the global LOLA map and is a permanent self-check in `horizon.py`.
- **Known limit:** one 240 m DEM for all distances smooths obstacles within ~1 km. Upgrade path: nest a 20–60 m DEM (`LDEM_85S_20M`, 460 MB; `LDEM_80S_40M`, 462 MB) for the first few km.
- **Validation reference:** NASA PGDA "Lunar Polar Illumination" (Mazarico), `AVGVISIB_85S_060M_201608` (Sun) and `..._EARTH` (Earth): % of hourly steps over 18.6 years with any part of the disc visible, from a 60 m DEM. Same projection and frame as our terrain. PSR map `LPSR_85S_060M_201608` is available in the same place.
- Still to confirm: Diviner layers, globe textures.

---

## 11. Roadmap
| Phase | Goal | Contents | Done when |
|---|---|---|---|
| **1 Core** | The brief, correct and easy | Python pipeline (ephemeris; horizons with curvature for ~10 curated sites + a south-pole grid; a year of daily metrics); F1; F2; F3 calendar + slip buttons + slip budget; F1 horizon dial; F2 lander survival calculator; F4; F5 Horizons check | Sun/Earth positions match JPL Horizons; a slip scenario answered in seconds for every curated site |
| **2 Differentiators** | Stand out | F6a south-pole map + click-anywhere (first); F6b 3D terrain + shadow shader; F6c globe; F7 alternatives finder (+ F3 nearby alternatives); F8 explainer + contrast cards; Explore/Planner modes; F4 science-vs-engineering view; F6 slope layer; F1 landing-ellipse dispersion; F6 shadow time-lapse; F5 mission replays | End-to-end demo path works on one laptop |
| **3 Polish + stretch** | Expert trust, smooth pitch | F5 full validation page; export + permalinks; F4 site assessment report; presentation and video. Then, only if time remains: F9 relay, F10 rover MVP, phone-friendly layout | Validation published in-app; demo rehearsed |

> **Gating rules:**
> - Don't start Phase 2 until Phase 1 numbers match JPL Horizons.
> - ⚠️ **Scope warning (v1.3):** the plan is now large. If time runs short, cut in this order: F10, F9, then Phase 3 extras (assessment report, full validation page), then Phase 2 items with the least demo value. Never cut Phase 1.
> - Don't start stretch features while a core or differentiator feature is half-working. Finish it or cut it.

---

## 12. Team roles
Adapt to team size.

| Role | Owns |
|---|---|
| Data and science pipeline | Python: ephemeris, horizons with curvature, daily metrics, grids, validation numbers |
| App UI and charts | F1, F2, F4: layout, hero numbers, sky plot, timelines, seasons strip, design system, Explore/Planner modes |
| Scenario logic | F3 slip planner + viability rule; F7 alternatives finder |
| Map and 3D | F6: south-pole map + click-anywhere (browser port of the pipeline maths, with the pipeline owner), 3D terrain + shadow shader, globe, Sun/Earth models, layers |
| Content, pitch and docs | F8 explainer cards + contrast copy; assumptions text; demo, slides, video, submission |

### 12.1 Remaining work split six ways *(added 2026-11-14)*
Everything not yet built, as of commit `88bc64d` (Site and plan, Find sites, Globe, Map, 3D and Compare are done). One person per workstream. **P1** = needed for the demo, **P2** = do if P1 is done, **Stretch** = only if time remains (cut order from section 11 still applies). Size: S ≈ half a day, M ≈ 1–2 days, L ≈ 3+ days.

| # | Workstream | P1 | P2 | Stretch | Owns (files) | Done when |
|---|---|---|---|---|---|---|
| 1 | **Release and quality** | Deploy (static host; check the ~21 MB of data loads) and README (what it is, how to run pipeline + web, data sources) **M** · Test pass on 1280×720, 1366×768, 1920×1080 in Chrome/Edge/Firefox; fix layout bugs **M** | Loading speed: compress/halve data if the deployed site is slow **S** · Keep `npm run check:engine` and the 3D shadow check passing before each release **S** | Phone-friendly layout **L** | `README.md`, hosting config, `web/vite.config.*`, `index.css` layout fixes | Public link works on a fresh laptop; README lets a new person rebuild everything |
| 2 | **Explainers (F8)** | 4–5 "Why?" cards (Sun skimming the horizon, a ridge blocking the Sun, libration moving Earth, why 5 km matters, why dates matter) linked from the numbers they explain **M** · One Moon-vs-Earth contrast card on the site view (city picker, no location permission) **S** | Assumptions and glossary text shown in the app, in plain words **S** | Guided Explore-mode walkthrough **L** | new `web/src/Explain*.tsx`, card text | A non-expert can answer "why is this site dark next week?" from the app alone |
| 3 | **Evidence: mission replays + validation page (F5)** | 2–3 mission replays (e.g. Chandrayaan-3, IM-1 Odysseus, IM-2 Athena): real site + real landing date loaded in one click, with official sources cited **M** | Full validation page: Horizons, NASA illumination maps, browser vs Python, GPU vs pipeline, finder coarse vs exact, with numbers and method **M** | — | `pipeline/sites.json` (mission entries), new `web/src/Replays.tsx`, `web/src/Sources.tsx` | Every mission fact has an official source in the app; validation numbers match the change log |
| 4 | **Finder and planner extensions (F7/F3)** | Artemis III candidate regions: sourced outlines or points, overlaid on Map, Find sites and Globe **M** · "Find alternatives for this date" button in the landing-date planner, opening Find sites with the same needs **S** | "Best landing date for this site" search (scan the year with the planner's rule) **M** · Auto-zoom the map to the search radius **S** | Water-ice option (closeness to permanent shadow + Diviner ice-stability temperature) **L** · F9 relay mode **L** | `web/src/Finder.tsx`, `pipeline/export_candidates.py`, new Artemis data file; coordinates any `MapView.tsx` change with #5 | A judge can go from "launch slipped" to "here are 3 better spots for the new date" in under a minute |
| 5 | **Analysis views (F1/F4)** | Science-vs-engineering view in Compare (engineering numbers next to science value, e.g. distance to permanent shadow) **M** · Site assessment report: one-click print-to-PDF of a scenario or comparison **M** | Landing-ellipse spread: how the numbers change across the landing ellipse around a site **M** · Explore/Planner mode toggle (simple vs expert detail) **M** | F10 rover excursion planner **L** | `web/src/Compare.tsx`, new `web/src/Report.tsx`, `HorizonDial.tsx`, `App.tsx` header | Printed report reads like an agency briefing; science and engineering trade-off visible on one screen |
| 6 | **Pitch and decisions** | Demo script following section 14, rehearsed on the deployed link **M** · Slides and video **L** · Submission text **S** | Team decisions from section 13: product name, real default viability thresholds, analysis period (one or two years) **S** | — | `docs/` (slides, script, video notes), section 13 of this plan | Demo runs in the time limit with no live surprises; every claim on a slide is backed by a number in the app |

**Task briefs:** one self-contained file per workstream in `docs/tasks/` (`00-START-HERE.md` is shared: project summary, setup, file-ownership map, git rules; then `01-…` to `06-…`). Give each person `00` + their own file. The briefs supersede the rules below where they differ.

**Working rules for six people:**
- Each workstream works on its own branch from `lunar-mission-planner` and merges back through a pull request; no direct pushes to `main`.
- One owner per file. Shared files: `App.tsx` (tabs, header) → #5 merges first, others rebase; `MapView.tsx` → #4 and #1 agree before editing; `pipeline/sites.json` → #3 adds missions, #4 adds Artemis III data in its own file.
- Run `npm run check:engine` before every merge that touches `engine.ts`, the pipeline, or `data/`.
- New data must cite its source in the app (Sources panel) and in section 10.
- Add a change-log line here for every finished item (see section 17).
- **All six start at the same time.** No workstream waits for another: each builds against stubs (marked `// TODO WS<n>`) where it needs someone else's piece. Helpful early merges: #1's first deployment, #5's `mode.ts`, #3's first replay, #6's decisions (name, thresholds, analysis period) on day one.

### 12.2 Build order from here *(added 2026-11-14, revised same day)*
Decision: work continues on the team repository's `lunar-mission-planner` branch, with Arnav's workstream 1–3 commit (`1631e0f`: deploy template, README, two replays, validation page, Why cards, contrast card) merged in. A private copy without it exists at `mohitbaher/lunar-mission-planner`. The `docs/tasks/` briefs stay as detailed checklists. Order = demo value per day of work:

| Step | What | From | Size |
|---|---|---|---|
| 1 | Read the official 2026 rules: deadline (time zone), submission format, video/slide limits, AI-tool rules | 6.1 | S |
| 2 | **Make the merged work honest and working:** validation page is hard-coded, so read the numbers from `validation.json` / the checks and remove claims no check measures ("bit-for-bit", "100% agreement on viable candidates", "verified until Feb 29": our model puts IM-1 sunset about 2 days later); check every replay fact against its official page; "Over 2024" label on a 20-day replay; `check:engine` back to node (bun isn't required anywhere else); move `docs/workflows/deploy.yml` to `.github/workflows/` so it runs | review of `1631e0f` | S–M |
| 3 | Deploy to GitHub Pages (needs a public repo or a paid plan) | 1.1 | S |
| 4 | Finish the slip story: "Find alternatives" button in the planner, best landing date for a site | 4.2, 4.3 | S + M |
| 5 | Artemis III candidate regions (official NASA source, approximate centres) | 4.1 | M |
| 6 | Demo script with real numbers, slides, video, submission text | 6.3–6.5 | L |
| 7 | Only if time remains: IM-2 Athena replay, science-vs-engineering in Compare, print report | 3.1, 5.1, 5.2 | M each |

**Cut:** landing-ellipse spread, Explore/Planner modes, phone layout, water-ice, F9, F10.

---

## 13. Open decisions
| Decision | Options | Recommendation |
|---|---|---|
| 3D engine for the globe | CesiumJS or Three.js | ✅ **Decided v1.4: Three.js** for globe, terrain and map shading (see F6) |
| Default viability thresholds (F3) | Min sunlight, max darkness, min Earth visibility, mission length | Placeholder example values in the app: 14-day mission, sunlit ≥ 60%, darkness ≤ 48 h, Earth in view ≥ 50%; marginal = misses by ≤ 10 points or ≤ 50% more darkness. Editable and shown on screen. **Team still to agree real defaults** (e.g. from a reference lander's battery and comms needs) |
| Reference location for Moon-vs-Earth cards (F8) | Browser location or city picker | City picker: no location permission needed |
| Team size and available time | Decides how much of Phases 2–3 is realistic | Confirm before assigning roles |
| Product name | Working title in use | Choose before slides and branding |
| Curated site list | Apollo, CLPS targets, other commercial and national missions (Chandrayaan, Chang'e…), south-pole candidates | ✅ First version done (8 sites, `pipeline/sites.json`). Still to add: Artemis III candidate regions (NASA publishes regions, not centre points; needs a sourced point per region), Shackleton–de Gerlache connecting ridge (no sourced coordinates found yet) |
| Analysis period and time step | e.g. two years at hourly steps | Agree with pipeline owner by file size; must cover a full seasons cycle |
| High-res region for F10 (stretch) | Any few-km region near the pole | Near Shackleton crater rim: lit ridges next to permanent shadow |
| Missions to replay (F5) | Chandrayaan-3, IM-1 Odysseus, IM-2 Athena, others | Pick 2–3 with well-documented official facts (site, date, outcome); cite sources in the app |
| Landing-ellipse presets (F1) | Per-lander ellipse sizes, or one generic default | Generic default plus user input; add real presets only with sourced values |
| Horizon dial vs classic sky plot (F1) | Dial as main view, or both | Dial as main view in Explore mode; classic azimuth-elevation plot available in Planner mode |

---

## 14. Demo storyline
About 3 minutes. Numbers are illustrative placeholders; replace them with real tool output.

| Step | What the judge sees | Message |
|---|---|---|
| 1 | 3D south pole opens; press play: shadows sweep around the pole like clock hands | "At the pole, the Sun skims the horizon." |
| 2 | Pick a south-pole site and date: hero numbers + sky plot | "Sun 0.9° up, sunset in 3 days, Earthset in 11 hours. Answered in one glance." |
| 3 | Tap "Why?": Moon-vs-Earth card | "Your city's Sun today: 58°. Here: under 1°. That's why terrain decides everything." |
| 4 | "Launch slipped two weeks": press +14 days | "Darkness at landing jumps from 0 to 40 hours. Not viable." |
| 5 | Calendar shows the next good window; click a spot 6 km away on the south-pole map and it works | "What took several specialist tools now takes seconds." |
| 6 | Compare original vs alternative side by side | "A few kilometres change everything." |
| 7 | Mission replay of a real landing, then the validation page | "Our predictions match what really happened, and every number is checked against NASA data." |

---

## 15. Reference numbers
⚠️ Approximate. **Verify each against a primary source** before it goes into the product or the pitch.

| Quantity | Approx. value | Status |
|---|---|---|
| Tilt of Moon's axis to the ecliptic (max Sun elevation at pole) | ~1.5° | Verify |
| Earth's elevation swing from the pole (libration) | ~±7° | Verify |
| Angular width of the Sun | ~0.5° | Verify |
| Mean lunar radius | ~1737.4 km | Verify |
| Horizon drop from curvature at distance d | d / (2R) rad → ~0.8° at 50 km | Derived; verify method |
| Lunar day (sunrise to sunrise) | ~29.5 Earth days | Verify |
| Lunar seasons cycle at the pole | ~1 year | Verify exact period |
| Typical max landing slope | ~8–10° | Verify per lander |
| Water-ice stability temperature | below ~110 K | Verify |
| PSR crater floor temperature | as low as ~40 K | Verify |
| Pragyan speed / total distance | ~1 cm/s / ~100 m | Verify |
| VIPER-class top speed | ~0.2 m/s | Verify |
| Elliptical frozen relay orbit period | ~12 h | Verify per mission |
| Low lunar orbit altitude (preset) | ~100 km | Preset choice |
| Landing-ellipse size | km-scale; varies by lander | Verify per lander before adding presets |

---

## 16. How the plan evolved
1. **Problem understood:** a lunar south-pole Sun/Earth visibility site-comparison tool.
2. **First brainstorm:** "Two Lights" map, phone sky view, weather-forecast cards, reverse search, survival game, sonification.
3. **Direction set:** professional, agency-grade (NASA/ISRO level), not kiddish. Team ideas added: 3D Sun-Earth-Moon view, comm modes (direct vs relay), energy model between charges, rover-constraint + science-objective site search.
4. **Rover idea expanded:** dark-zone excursions with guaranteed return to light and comms, tracking where light will be over time.
5. **Mentor review** (team are not aerospace experts): kept, simplified or dropped each idea; added physics reality checks (slow rovers → fine grids; DSN coverage → drop ground stations; water ice only; validation and assumptions panel).
6. **Globe and relay clarified:** Google-Earth-style Moon with Sun/Earth not to scale but in true directions; relay from user-supplied orbit with presets.
7. **v1.0 PDF** shared with the team.
8. **Official brief checked (v1.1):** added slip planner, explainer, Moon-vs-Earth, seasons, curvature, hero numbers; reframed the site finder; moved relay and rover planner to stretch; new rule "simple first, depth on demand"; features renumbered by priority.
9. **This file created** as the living source of truth, with parked ideas and full stretch-feature detail that the v1.1 PDF shortened.

---

## 17. Change log
Newest first. Every new feature, idea or decision gets a line here when it's added.

| Date | Change |
|---|---|
| 2026-11-14 | Work continues on the team repository branch `lunar-mission-planner` with Arnav's workstream 1–3 commit merged (build and both `check:engine` checks pass with node). Review found overclaims on the hard-coded validation page, unverified replay outcome text, a "Over 2024" label on 20-day replays, `check:engine` switched to bun, and the deploy workflow parked in `docs/workflows/` (inactive). Section 12.2 rewritten as the build order from here, with these fixes as step 2. |
| 2026-11-14 | Solo build moved to its own private repository `mohitbaher/lunar-mission-planner` (default branch `lunar-mission-planner`, full history). The team repository stays as the git remote `team`; the teammates' commit there is not merged. |
| 2026-11-14 | Section 12.2 added: solo build order. Teammates build a separate version; this branch is built by one person without relying on the `docs/tasks/` briefs. Order: rules check → deploy + README → finish slip story (find-alternatives button, best landing date) → mission replays + validation page → 2–3 "Why?" cards → pitch. Cut: ellipse, modes, contrast card, phone layout, water-ice, F9, F10. |
| 2026-11-14 | Workstream 1 (Release & Quality) completed: GitHub Pages deployment workflow (`.github/workflows/deploy.yml`) with automated `check:engine` and build validation; `BASE_PATH` support in `web/vite.config.ts`; comprehensive 9-section root `README.md` documenting architecture, accuracy benchmarks, reproduction instructions, and Team Stranded attribution; `docs/qa-checklist.md` multi-viewport testing matrix; clean build verified (`bun run build`). |
| 2026-11-14 | Workstream 2 (Explainers F8 & Contrast) completed: accessible `<Why>` dialog cards in `web/src/explain/` covering `sun-skims`, `ridge-blocks`, `earth-wobbles`, `five-km`, and `dates-matter` with live telemetry and SVG visual diagrams; Moon vs Earth solar elevation contrast card (`web/src/explain/Contrast.tsx`) with 11 hardcoded world cities and NOAA solar position algorithm (`web/src/explain/solar.ts`) with self-check; styled in `web/src/styles/explain.css`. |
| 2026-11-14 | Workstream 3 (Evidence F5 & Replays) completed: historical mission replays exported via `pipeline/export_replays.py` for Chandrayaan-3 Vikram (Aug 2023) and IM-1 Odysseus (Feb 2024); live touchdown model evaluation vs official ISRO/Intuitive Machines outcomes in `web/src/Replays.tsx`; full-page scientific validation audit screen (`web/src/Validation.tsx`) linked from header badge covering all 6 checks; Sources expanded in `web/src/Sources.tsx`. |
| 2026-11-14 | Task briefs written for the six workstreams: `docs/tasks/00-START-HERE.md` (shared: 60-second project summary, setup incl. data downloads, file-ownership map, `App.tsx` edit spots, git/PR rules, pre-PR checklist) + `01-release-and-quality.md`, `02-explainers.md`, `03-evidence-replays-validation.md`, `04-finder-and-planner.md`, `05-analysis-views.md`, `06-pitch-and-decisions.md` (each: mission, P1/P2/stretch tasks with method hints, owned files, interfaces relied on / provided, done-when). Designed so all six work at once: one owner per file, append-only shared files (`data.ts`, Sources list, change log), per-workstream CSS files, short marked `App.tsx` edits. 12.1 updated to point to them. |
| 2026-11-14 | Section 12.1 added: all remaining work split into six workstreams (1 release and quality, 2 explainers F8, 3 mission replays + validation page, 4 finder/planner extensions incl. Artemis III regions, 5 analysis views + assessment report, 6 pitch and team decisions), each with P1/P2/stretch tasks, sizes, owned files and a 'done when'; plus working rules (branch per workstream, one owner per file, run check:engine before merging). |
| 2026-11-14 | F7 MVP done: **Find sites** tab (`web/src/Finder.tsx`, reuses the Map canvas). **Coarse stage:** `pipeline/export_candidates.py` cuts the 85–90°S 240 m grid into 2.9 km tiles and keeps one spot per tile: the pixel with slope ≤ 15° and the most NASA long-term light + Earth view, only where NASA sunlit ≥ 25%. 5,487 spots, each with a coarse horizon (1° azimuth, 240 m steps, int8 at 0.1°) → `data/finder/` (2.1 MB; ~11.5 min on 8 cores, run once). The browser computes Sun/Earth visibility for **the user's exact mission window** (landing date + length, same needs as the F3 planner and shared with it) for every spot in under a second, applies the F3 viability rule, a max-slope filter (default 8°, 240 m slopes) and an optional search radius (10/25/50 km around the selected polar site; the centre is frozen when chosen). **Ranking:** viable before marginal, then a 0–100 score shown as a stacked bar: power 40 (sunlit %), comms 25 (Earth %), darkness 20 (shorter longest night), slope 15 (flatter); weights are stated on screen as our choice. Shortlist of 8, spread ≥ 5 km apart so it offers real alternatives. **Fine stage:** the top 5 are recomputed with the exact engine (0.5° horizon, 120 m steps; Web Worker, now with message ids so several requests can run) and re-ranked; rows say 'exact' or 'estimate' and the panel reports how far the estimates were (e.g. within 0.3 points). Map: viable = filled dot, marginal = ring, not viable = faint speck, shortlist = numbered badges; clicking a row or badge analyses that spot exactly and makes it the selected site (then Open in Site and plan / Add to comparison). **Self-check** added to `npm run check:engine`: coarse vs exact yearly sunlit/Earth % worst 0.28 pp (limit 3), windowed tracks identical to the full-year run. Example: 14-day mission landing 15 Jan 2027 → 223 viable, 103 marginal of 3,887 spots with slope ≤ 8°; within 25 km of Shackleton → 26 viable, none closer than 10 km (the floor is permanently shadowed; the rim is ~10.5 km out). **Limits:** one candidate per 2.9 km tile picked by NASA's long-term averages, so a spot that is only good in a particular window can be missed; 240 m slopes understate lander-scale slopes; analysis year 2027 only. Not done: water-ice option, Artemis III overlay, auto-zoom to the radius, a 'best landing date' search. |
| 2026-11-14 | F6c MVP done: **Globe** tab (`web/src/Globe.tsx`, lazy-loaded, shares the three.js chunk with 3D). Moon lit from the true Sun direction for the selected hour (same Skyfield vectors as Map/3D), lunar-Lambert shading (half Lambert, half Lommel-Seeliger: little limb darkening, like the real full Moon). Colour = NASA SVS CGI Moon Kit `lroc_color_2k.jpg` (0°E centred; checked: Tycho at −11° and the Apollo 11 marker lands on Tranquility Base). Relief = normals from our own LOLA LDEM_16 (`pipeline/export_globe.py` → `data/globe/relief.png`, 1440×720, 1.7 MB, self-check: synthetic slope). Relief slider 1–4×. **Sun and Earth models**: directions true, sizes/distances not to scale (labelled); Earth is lit by the same Sun so its phase is right; a model hides when the camera is behind it. Camera presets: Sun-Earth-Moon overview, as seen from Earth, from the Sun, south pole, fly to site. Site markers (click to select, nearest within 12 px), selected one coloured by its Sun/Earth state, labels hidden on the far side, Sun/Earth sight lines from the site (red dashed when blocked, from the pipeline). Dashed 80°S ring = 3D terrain area; 'See its terrain shadows in 3D' link for polar sites. Side panel: sub-solar and sub-Earth points (shows libration). **Limits:** terrain doesn't cast shadows on the globe (3D view does); equirectangular textures smear within ~2° of the poles (3D view covers 80–90°S); 2k colour only. Not done (stretch): heatmap/PSR/slope layers on the globe, Artemis III regions, orbit drawing, metre-level zoom. Sources panel credits the Moon Kit. |
| 2026-11-14 | F6b MVP done: **3D** screen (`web/src/Terrain3D.tsx`, three.js 0.187, lazy-loaded so other screens stay light). Terrain = the 80–90°S LOLA crop (240 m) as a 1024×1024 mesh with true lunar curvature; vertical exaggeration slider 1–5× (label says 'not to scale' above 1×). **Shadows from our physics, not shadow maps:** a GPU shader steps from every terrain point toward the Sun and toward Earth over the real heightmap in 3D (curvature built in, 2 m height, finer steps near the point), then applies the same visible-disc rule as the pipeline; colours amber / blue / green / grey = Sun / Earth / both / neither, grey relief only for readability. Recomputed when the time changes; Play in the time bar is the shadow time-lapse (~8 frames/s at 6 h per step). **Camera presets:** overview, overhead, over Shackleton (shows its sunlit rim around a dark floor), from the selected site looking at the Sun / at Earth; free orbit/pan/zoom. **Selected site:** pin plus 60 km lines to the Sun and Earth (solid = visible, red dashed = blocked, from the pipeline values). **Self-check button:** shader vs pipeline at the curated sites within 80.5–90°S, 24 moments across 2027: 191 of 192 Sun/Earth visible-or-not values agree; the one miss is a true edge case (Mons Mouton, Sun's upper limb 0.004° from the terrain). Bug found and fixed on the way: GPU `length()` of a 1,739 km vector is only good to ~10 m, which hid a peak's own nearby slope (first check: 46/48); the ray's rise is now computed from small numbers. Not yet: whole-Moon globe (F6c), Earth/Sun 3D models, picking points by clicking in 3D. |
| 2026-11-14 | F6a MVP done: **Map** screen (`web/src/MapView.tsx`). Canvas map of 85–90°S, 0°E up (same orientation as the pipeline), zoom 85–90 / 87.5–90 / 88.7–90°S, lat circles and 30° meridians, scale bar, curated site markers (labels shift to avoid overlap). **Layers:** shaded relief (from our LOLA DEM), NASA sunlit %, NASA Earth in view %, NASA permanent shadow (PGDA `LPSR_85S_060M_201608`, newly downloaded), slope (from the 240 m DEM, labelled as underestimating lander-scale slopes); each with its source and a colour ramp legend. **Hover:** lat/lon, terrain height, slope, NASA sunlit / Earth / PSR values. **Click anywhere:** a Web Worker (`web/src/engine.ts` + `engine.worker.ts`) runs the same maths as `horizon.py` + `timeline.py` on a DEM crop of 80–90°S (13 MB int16) and hourly Sun/Earth vectors exported from Skyfield (210 KB float32); ~0.8 s per point. The point becomes site 'custom': dial, readouts, planner and Compare all work on it; 'Open in Site and plan' and 'Add to comparison' buttons; clicking a site marker selects that site. Pin saved in the permalink (`site=custom&pin=lat,lon`), recomputed on reload (tested, also inside a Compare link). **Self-check** (`npm run check:engine`, `web/scripts/check-engine.ts`) against Python reference points from `pipeline/export_map.py`: 8 points, Sun/Earth direction within 3.5×10⁻⁷° (pass mark 0.001°), sunlit % and Earth % identical, horizons identical. Not yet: Artemis III regions layer (needs sourced outlines), 'lit now' layer (comes with the F6b shader), pan/free zoom. |
| 2026-11-14 | F4 done (`web/src/Compare.tsx`). Top bar now switches between **Site and plan** and **Compare** (first step toward the screens in section 4). **Scenarios:** 2–4 columns, each a site + UTC landing time (datetime input); quick adds 'another site, same time' and 'same site, 14 days later'; remove down to 2. Opening Compare starts with the current site and time vs the next site. **Metric table:** Mission (verdict, sunlit %, longest darkness, Earth %, longest without Earth, over the planner's mission length and thresholds), At landing (Sun/Earth elevation, sets/rises in), Whole year (sunlit %, Earth %, longest darkness, mean power index). Best value per row is bold with a 'Best' tag (not colour alone); no tag when values tie or the row has no better direction. **Synced mission timelines:** Sunlit / Earth / Both tracks per scenario, aligned from each landing (day 0 to N), one shared hover line that reads every scenario at the same mission hour. **Export:** CSV (formatted table) and JSON (raw values, thresholds, provenance). **Permalink:** view and scenarios in the URL (`view=compare&cmp=site@hour,…`); reload restores them (tested). Example: IM-2 Athena vs best-lit spot, both 12 Jan 2027: both viable; Athena wins on Earth contact (100% vs 89%), the best-lit spot on sunlight (100% vs 86%); best-lit 14 days later is not viable (Earth in view too little). Not yet: science-vs-engineering view (Phase 2, needs F7 water-ice data), site assessment report (Phase 3). |
| 2026-11-14 | Quick wins from the build-notes review added to the app. **Validation badge** in the header ('Validated against JPL Horizons, max error 0.00003°'), linking to a new **Data sources and validation** panel: Horizons check (4,326 comparisons), sunlit % and Earth % vs NASA LOLA illumination maps (80 points), known limits (240 m terrain, hourly steps, 2 m mast, simplified power index), and sources (LOLA PDS, JPL DE421 + NAIF kernels, Skyfield, Horizons, NASA PGDA, LROC/NASA/IAU). Numbers come from `web/public/data/validation.json`, written by `export_sites.py` from `validation/`. **Per-site tools:** 'Copy coordinates' + links to LROC QuickMap and NASA Moon Trek (deep links not used: QuickMap's projected-metre link format wasn't reliable in testing). **Play/Pause** in the time bar (1 h, 6 h or 1 day per step). Fixes: latitude now shows N for northern sites (Apollo 11 was shown as S); the illumination report now names the current terrain map (LDEM_60S_240M); re-run, results unchanged. |
| 2026-11-14 | Reviewed two older build notes against the current build (section 7, 'Review of older build notes'). Most items are done or superseded by the Python-precompute decision. Proposed small additions: Horizons badge + data sources panel (F5), QuickMap/Moon Trek links, play button; README + deployed URL required. Parked: mast-height choice, custom lat/lon (grid), more sites once sourced. Rejected: crediting another team's data (all horizons are our own). |
| 2026-11-14 | v1.4 visuals: added "Screens and visuals" (section 4: shared point + time, top bar, time bar, Site / Plan / Map / 3D / Compare / Validation screens, visual rules). F6 split into **F6a 2D south-pole map with click-anywhere** (85°S–90°S, layers, browser Web Worker runs the pipeline maths, checked against Python), **F6b 3D south-pole terrain** (Three.js, shadows from a horizon-physics shader, not shadow maps; Earth tint; camera presets; line-of-sight rays; hosts the shadow time-lapse) and **F6c whole-Moon globe**. Decided: **Three.js** for all 3D. Updated brief mapping, feature overview, decision log, open decisions, architecture, roadmap, roles, demo steps 1 and 5. |
| 2026-11-14 | F3 MVP done (`web/src/Planner.tsx`, logic in `web/src/data.ts`). **Viability rule:** user sets mission length, minimum sunlit %, maximum continuous darkness, minimum Earth-in-view %; each landing date (landing 00:00 UTC) is viable / marginal / not viable / runs past the data, counted from the precomputed hourly visibility (no new physics). Example thresholds are placeholders (open decision). **Landing-date calendar:** one cell per day of 2027 (months × days), ordinal lightness ramp (light = viable) so it reads in colour-blindness; hover shows sunlit %, longest darkness, Earth %; click plans a landing on that day; planned and selected days outlined. Also a native date input. **Slip buttons:** +1 d, +7 d, +14 d, +1 lunar month (709 h), custom N days, back to planned date; the dial and all panels follow the slipped date. **Before/after card:** verdict, sunlit %, longest darkness, Earth % during the mission (with ▲/▼ better/worse in words, not colour alone), Sun and Earth at landing (sets/rises in). **Slip budget:** 'you can slip up to N days and stay viable; after that the next viable window opens on …' (clickable). **Permalinks:** site, selected time, planned day and thresholds live in the URL; 'Copy link to this scenario' button; reloading restores the scenario (tested). Example (IM-2 Athena, 14-day mission): planned 12 Jan is viable with a 4-day slip budget; +14 d makes it not viable (sunlit 86% → 18%). The calendar shows the viable windows drifting through the year. Not yet (stretch): nearby alternatives, saved scenario lists. |
| 2026-11-14 | Moved into git: `lunar-mission-planner/` is now a git repo, pushed as the `lunar-mission-planner` branch on GitHub. This plan, AI_CONTEXT.md and both PDFs now live in the repo root next to `pipeline/` and `web/`. Every change gets committed and pushed to that branch. |
| 2026-11-14 | Laptop-first layout applied to the app. Test sizes: 1280×720, 1366×768, 1920×1080. The dial is sized to the window height, Sun and Earth readouts sit side by side, and the time controls (year strip, slider, step buttons) are pinned to the bottom of the window, so the dial, readout and time controls fit on one screen and stay usable while scrolling to the charts. Keyboard: ← → step 1 hour, Shift+← → step 1 day (not while typing in a field). Page width cap raised from 1200 to 1440 px. The existing narrow-screen rules were kept untouched, as decided. |
| 2026-11-14 | Decided: the web app targets **laptop screens first**. A phone-friendly layout is Phase 3 stretch, only if time remains. From now on, design and test at laptop widths only. Updated the format line, decision log, out-of-scope list, roadmap and AI_CONTEXT.md. |
| 2026-11-14 | F2 done. **Availability timeline:** Gantt tracks (Sunlit / Earth in view / Both) over 7, 30 or 90 days around the selected time; hover shows time, state and % of each disc visible; click moves the selected time. **Seasons:** two charts (one scale each) of hours in view per day across the year for Sun and Earth, with hover. **Power-potential index** (simplified, labelled): visible Sun-disc fraction × cos(Sun elevation), i.e. a vertical panel that turns to face the Sun; computed in the pipeline (`timeline.power_index`, self-checked), shown per hour and as a yearly mean. Contrast it reveals: Apollo 11 mean 30.9% vs the best-lit polar spot 72.8%, because a vertical panel suits a low Sun. **Thermal context:** 'in darkness for / in sunlight for' (and the Earth equivalents) next to longest darkness; no thermal model. **Lander survival calculator:** user enters survival power (W) and usable battery (Wh); checks the darkness in progress or next after the selected time, and the longest darkness of the year; shows survives / runs out after N h and battery needed (W × h). Assumes a full battery and no charging while the Sun is fully hidden. **Colours re-validated** with a colour-blind checker on the dark background: Sun #c98419, Earth #5590d8, both #1fa38a (the earlier bright amber/green pair was too close for some colour-blind viewers). Chart text is HTML so it stays readable on phones. Checked in the browser at phone and desktop widths. |
| 2026-11-14 | Curated site list v1 (`pipeline/sites.json`), every coordinate cited in the app: **South pole:** best-lit spot near the pole (derived from NASA's illumination map, 89.4749°S 222.557°E, 88.4% lit over 18.6 years); Shackleton crater centre (IAU Gazetteer, 89.67°S 129.78°E); Mons Mouton centre (IAU, 84.60°S 31.00°E); IM-2 Athena as landed (LROC, 84.7906°S 29.1957°E); IM-1 Odysseus (NASA/LROC, 80.13°S 1.44°E). **South polar region:** Chandrayaan-3 Vikram, Statio Shiv Shakti (LROC, 69.3741°S 32.32°E). **Contrast:** Chang'e-4, far side (LROC, 45.4561°S 177.5885°E; Earth never visible); Apollo 11 (NASA ALSJ, 0.67409°N 23.47298°E). Terrain map switched to `LDEM_60S_240M` + global `LDEM_16` fallback (illumination check re-run: unchanged). Cross-check: our Chang'e-4 terrain height −5930 m vs LROC's −5927 m. Test points removed. App: sites grouped in the picker, kind pill (landing / named feature / derived), source link per site; dial scale now extends to the year's highest Sun/Earth (up to 90° at low latitudes). Note: best-lit spot shows 79.7% sunlit in 2027 at 2 m height on our 240 m map vs NASA's 88.4% (18.6-year average, 60 m map, surface). |
| 2026-11-14 | Phase 1 step 4 done: web app started in `lunar-mission-planner/web/` (React + Vite + TS). One screen: site picker; F1 horizon dial (map view from above, north up; terrain silhouette ring, dashed flat-horizon ring, Sun/Earth as clock hands with true-size discs, filled = visible / hollow = hidden, next-14-day paths, UTC clock in the centre; elevation stretched and labelled "not to scale"); hero readout per body (elevation, terrain horizon at that azimuth, % of disc visible, time to sunset/sunrise and Earthset/Earthrise to the nearest hour); power/comms status; year strip coloured by state (green both, amber power only, blue contact only, grey neither) with an hourly time slider and ±1 h / ±1 d buttons; site facts for the year. Data comes from `pipeline/export_sites.py` → `web/public/data/` (1 year from 2027, ~300 KB JSON per site). Checked in the browser on desktop and phone width. Not yet: curated sites, permalinks, Explore/Planner modes, classic az-el plot. |
| 2026-11-14 | Phase 1 step 3 done: per-site hourly timelines of visible Sun-disc fraction and Earth-disc fraction (any part visible = visible, NASA's definition), with metrics: sunlit %, mean Sun-disc %, Earth-visible %, both %, longest darkness, longest gap without Earth. Validated against NASA LOLA illumination maps at 80 random points (85.5–89.8°S, 18.6 years hourly): Sun correlation 0.991, median difference 0.31 percentage points (71/80 within 2 pp); Earth correlation 0.995, median 0.17 pp (65/80 within 2 pp). Largest misses (up to 15 pp) are where we over-predict light, as expected from our coarser 240 m DEM smoothing nearby obstacles; this supports the nested 20–60 m DEM upgrade. Ephemeris refactored to compute Sun/Earth once for many sites (re-validated vs Horizons: 0.000033°). Report `validation/step3_illumination.json`. Analysis period for app data still an open decision (script default: 1 year from 2027). |
| 2026-11-14 | Phase 1 step 2 done: horizon mask from LOLA `LDEM_75S_240M` with exact sphere geometry (curvature included, no refraction), 0.5° azimuth steps, 2 m observer height, out to the DEM edge. Self-checks pass (synthetic mountain within 0.007° of an independent 3D calculation; DEM orientation vs global LOLA map). Sanity on DEM-derived test points: lowest point near the pole (89.63°S 118.5°E, Shackleton floor) has horizon 18–27° all round, so never sunlit (matches its known permanent shadow); highest point (89.45°S 222.7°E) has horizon below 0° all round. Found that the PDS projection formula is mirrored east–west. Masks in `lunar-mission-planner/data/horizons/`. |
| 2026-11-14 | Phase 1 step 1 done: Skyfield Sun/Earth az/el (DE421, MOON_ME_DE421, airless) vs JPL Horizons (DE441) for 3 test points, 30 days hourly (Jan 2027): worst difference 0.000014° (tolerance 0.01°). Report in `lunar-mission-planner/validation/step1_horizons.json` (for F5). Found a Horizons quirk: at exactly (45°S, 0°E) and (45°S, 90°E) it ignores the site position and returns Moon-centre values (~0.25° off for Earth), so test points avoid round coordinates. |
| 2026-11-14 | Decided: Skyfield is the ephemeris library (not SPICE). All code built from scratch in `lunar-mission-planner/`. First build step = Sun/Earth position calculator for one site, validated against JPL Horizons. |
| 2026-11-14 | Added AI_CONTEXT.md: condensed briefing for teammates to attach to their AI tools (rules for the AI, physics, design system, F1–F10, architecture, out-of-scope list). This file stays the source of truth. |
| 2026-11-14 | Detailed v1.3 report PDF created alongside the summary: Lunar_South_Pole_Mission_Planner_Detailed_Report.pdf (16 pages, mirrors this file). |
| 2026-11-14 | PDF regenerated as a short v1.3 "Team Feature Summary" (5 pages): each feature in 3–4 lines, plus a one-page plan. Full detail stays in this file. |
| 2026-11-14 | v1.3: all seven ⭐ ideas promoted. F1 horizon dial (Phase 1) + landing-ellipse dispersion (Phase 2); F2 lander survival calculator (Phase 1); F3 slip budget (Phase 1); F4 site assessment report (Phase 3); F5 mission replays (Phase 2); F6 shadow time-lapse (Phase 2). Updated decision log, roadmap (+ scope warning and cut order), demo step 7, open decisions, reference numbers. |
| 2026-11-14 | Brainstorm round 2 added to section 7 (awaiting team decision): 7 strongly recommended (mission replays, landing-ellipse dispersion, slip budget, horizon dial, lander survival calculator, site assessment report, shadow time-lapse), 5 maybe-later, 3 rejected. |
| 2026-11-14 | v1.2: team accepted all four additions (F2 power-potential index, F2 thermal context, F4 science-vs-engineering view, F6 slope layer). Added to decision log; F4 view and slope layer scheduled in Phase 2, F2 items in Phase 1. |
| 2026-11-14 | Re-checked the full brief line by line. Proposed (pending team OK): F2 power-potential index and thermal context indicators, F4 science-vs-engineering view, F6 slope layer. Added 5 rows to the brief mapping table. Brief's resource list still cut off. |
| 2026-11-14 | Made this file the living source of truth; rule: every discussed feature/idea is added here immediately. Added: Earth visible ~half the time at the exact pole, Moon ME frame, VIPER precedent for F10. |
| 2026-11-14 | File created from all discussions so far (v1.1 plan + parked ideas + full F9/F10 detail + plan history). |
| 2026-11-14 | v1.1: plan aligned to the official brief (see [section 16](#16-how-the-plan-evolved), step 8). |
| 2026-11-14 | v1.0: first team concept PDF. |
