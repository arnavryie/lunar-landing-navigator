# Space Apps 2026 submission (draft for the Project tab)

**Deadline:** Sunday 15 Nov 2026, 11:59 PM local time of your Local Event (Pune). Submission opened Sat 14 Nov, 9:00 AM. You can resubmit until the deadline; only the last saved version is judged.
Source: https://www.spaceappschallenge.org/resources/project-submission-guide/ (read 14 Nov 2026).

## Before you click "Submit for Judging"
- [ ] Every team member is a confirmed participant at the **same** Local Event.
- [ ] Every required field below is filled, **in English**.
- [ ] **Demo link** works in a private browser window with no login: a 7-slide deck (max 7, title slide included) **or** a video of 30 seconds or less. Over the limit = not eligible for global judging.
- [ ] **Final project link** works with no login. Use the live site (below). The GitHub repos are private; judges can't open them.
- [ ] No images/video/audio of anyone under 18. No NASA logos in anything AI-generated.
- [ ] Optional but recommended: request a FortiGuard web-filter classification for the live site (category: "Education" or "Web-based application", company "N/A") so judges' networks don't block it. The guide links the form.
- [ ] Tick "Terms and Conditions" and "Confirm All Work is Original", then **Submit for Judging**, and check the green confirmation banner.

Judging: Impact, Creativity, Validity, Relevance, Presentation, each 1-5 (2026 Judging and Awards Guide).

---

## Project Name
Lunar Statio (South Pole Mission Planner)

## High-Level Project Summary
*(~150 words)*

Near the Moon's south pole the Sun never climbs more than a few degrees, so a ridge kilometres away can put a landing site in darkness for days, and Earth (needed for direct radio contact) bobs in and out of view. When a launch slips, a site that was perfect can go dark. Our web app shows, for any south-pole spot and any hour of 2027, whether the Sun and Earth are above the real terrain horizon, computed from NASA LOLA elevation data and JPL ephemerides. A mission planner picks a site and landing date, sees power and Earth contact at a glance, presses "+7 days" to see what a slip does, and then finds better spots for the new date or better dates for the same spot. Every number is checked: Sun/Earth directions match JPL Horizons to 0.00003°, and our sunlight maps correlate 0.99 with NASA's.

## Link to Project Demo
`<public link to the 7-slide deck or the 30-second video>` *(see demo-script.md; test it in a private window)*

## Link to Final Project
https://lunar-mission-planner-three.vercel.app

## Detailed Project Description

**What it does**
- **Site and plan:** a horizon dial shows the Sun and Earth against the site's real 360° terrain horizon at the selected hour, with time to sunset and Earthset, a year of lighting at a glance, and a lander survival (battery) calculator.
- **Landing-date planner:** set mission needs (length, minimum sunlight, maximum darkness, minimum Earth view). Each day of 2027 is marked viable / marginal / not viable. Slip buttons (+1 d, +7 d, +14 d, +1 lunar month) show a before/after comparison, how many days the plan can slip and stay viable, the next viable window, and the best 3 landing windows.
- **Find sites:** ranks about 5,500 candidate spots (85-90° S) for the user's exact mission window, then recomputes the top 5 exactly. One click from the planner: "Find other spots for this date". Can search near a site or near NASA's candidate landing regions.
- **Map, 3D, Globe:** a click-anywhere south-pole map with NASA illumination, Earth-visibility and permanent-shadow layers; 3D terrain (80-90° S) with shadows computed on the GPU; a whole-Moon globe lit by the real Sun with NASA's nine candidate landing regions (Oct 2024).
- **Compare:** 2-4 site/date scenarios side by side, CSV/JSON export, shareable links for any screen state.
- **Evidence:** mission replays of Chandrayaan-3 (ISRO) and IM-1 Odysseus at their real landing dates next to what the agencies reported, and a validation page that reads every number from the checks' own output files.

**How it works**
1. Python pipeline: Sun and Earth positions from JPL DE421 (Skyfield, Moon-fixed frame); terrain horizons from NASA LOLA 240 m elevation data including the Moon's curvature; hour-by-hour visibility of the Sun's and Earth's discs (fraction above the terrain) for all 8,760 hours of 2027.
2. The browser repeats the same maths in a Web Worker for any clicked point (no server); a check script proves it matches Python (3.5×10⁻⁷° direction difference, 0.00 points of sunlight).
3. Static site (React, TypeScript, three.js), deployed on Vercel.

**Validation** (all shown in the app): Sun/Earth directions vs JPL Horizons, worst 0.000033° over 4,326 directions; long-term sunlight and Earth visibility vs NASA's LOLA illumination maps at 80 points, correlation 0.991 / 0.995, median difference 0.31 / 0.17 points; finder quick estimate vs exact, worst 0.28 points; GPU shadows vs pipeline, 191 of 192 agree.

**Limits we state on screen:** 240 m terrain (boulders and small craters aren't seen), 2 m mast, hourly steps, 2027 only (replays use their real dates), example viability thresholds rather than a specific lander's.

**Benefits / what we hope to achieve:** re-planning after a launch slip takes seconds instead of a specialist workflow, and mission teams, students and the public can see why a few kilometres or a few days decide whether a lander survives.

**Tools:** Python (NumPy, Skyfield), TypeScript, React, Vite, three.js; hosted on Vercel.

## Use of Super Intelligence (SI)
*(Not shown to judges, but must be accurate. **The team must check and edit this**; especially the last sentence, since the rules say SI should not be used to come up with the idea.)*

Yes. We used Claude (Anthropic), through Claude Code, as a coding and research assistant. It wrote much of the Python pipeline, the web app code and the documentation under our direction, ran our validation checks, and helped look up and verify sources (which we cite in the app). We chose the challenge and directed the approach and features; every number in the app comes from the pipeline and checks, not from the AI. AI use is acknowledged in the README and the site's metadata. No AI-generated images, video or audio are used.

## NASA Data
- NASA LRO LOLA gridded elevation: LDEM_60S_240M (south polar, 240 m) and LDEM_16 (global), PDS Geosciences Node. Terrain horizons, slopes, 3D terrain, globe relief.
- NASA Goddard PGDA Lunar Polar Illumination (Mazarico et al. 2011): long-term sunlight, Earth visibility and permanent-shadow maps; map layers and our validation reference.
- JPL DE421 planetary ephemeris and NAIF SPICE kernels (Moon frame), via Skyfield; JPL Horizons as the independent check.
- NASA SVS CGI Moon Kit (LROC WAC colour): globe surface.
- LROC (LRO Camera) landing-site locations; NASA's LRO page and 23 Feb 2024 release for IM-1 Odysseus.
- NASA's Artemis III candidate landing regions (28 Oct 2024 release) and region map (George et al., LPSC 2026, NTRS 20250011660).

## Space Agency Partner Data and Other References
- **ISRO (2026 Space Agency Partner):** Chandrayaan-3 mission updates (landing date, rover and lander operations): https://www.isro.gov.in/Chandrayaan3.html
- IAU / USGS Gazetteer of Planetary Nomenclature (feature names).
- Open-source software: Skyfield, NumPy, React, Vite, three.js (all under their own licences).
- Full list with links: the "Data sources" panel in the app and the README.
