# Workstream 4: Finder and planner extensions (F7, F3)

**Read `00-START-HERE.md` first.** Your branch: `ws4-finder`.

## Your mission
Make the re-planning story seamless: **"the launch slipped → here are better spots for the new date → here is the best date for my spot"**. And put NASA's **Artemis III candidate regions** on the map, which judges will look for.

You own the map-based screens (`MapView.tsx`, `Finder.tsx`, `Globe.tsx`) and the planner (`Planner.tsx`), so nobody else edits them. Read the F7 entry and the 2026-11-14 F7 change-log row in `PROJECT_PLAN.md` to see how the finder works (coarse candidate spots, then exact re-check of the top 5).

---

## P1 tasks

### 4.1 Artemis III candidate regions (M)
- NASA has published candidate landing regions near the south pole (first a list of 13 regions in 2022, updated to a smaller list in 2024). **Use the latest official NASA announcement**, and cite it.
- NASA publishes regions as areas on a map, not exact outlines with coordinates. Pick one honest representation and label it:
  - **Points:** one sourced centre per region (e.g. from the official map, or the named feature's coordinates in the IAU Gazetteer), drawn as a labelled marker, captioned "approximate centre".
  - **Outlines:** only if you find official coordinates or a published shapefile. Never trace outlines by eye and present them as official.
- Data file: `pipeline/artemis_regions.json` (you own it) → copy into `web/public/data/artemis.json` with `{ name, lat, lon, source, source_url, approximate: true }` per region.
- Show them as a toggleable overlay on the **Map**, **Find sites** and **Globe** tabs (you own all three). In Find sites add a search option "Within N km of an Artemis III region".
- Append one line to `SOURCES` in `web/src/Sources.tsx` (#3 owns it; appending is allowed).

### 4.2 "Find alternatives for this date" in the planner (S)
- In `Planner.tsx`, add an optional prop `onFindAlternatives?: () => void` and a button next to the slip buttons. It should appear when the slipped date is marginal or not viable, but can always be shown.
- In `App.tsx` (only this edit, wrapped in `{/* WS4 */}`): pass `onFindAlternatives={() => setView('find')}` to `<Planner … />`. The finder already reads the same time `i` and thresholds `th`, so it opens on the slipped date with the same mission needs.
- Nice touch: if the selected site is polar, open the finder already set to "Within 25 km of <site>". That needs a way to pass the radius in. Add an optional `initialRadius` prop to `Finder` and pass it from the same App edit.

## P2 tasks

### 4.3 "Best landing date for this site" (M)
- In the planner or the finder: for the selected site, scan every landing day of 2027 with the existing rule (`dailyViability(site, th)` in `data.ts` already returns one result per day) and list the best windows. Show the top 3 with their sunlit %, longest darkness and Earth %, plus a "jump to this date" button (`setI(day * 24)`).
- This is mostly UI over an existing function; keep it small.

### 4.4 Auto-zoom to the search radius (S)
- When the finder uses a radius, zoom the map to the nearest zoom level that contains the circle, and draw the circle.

## Stretch (only after P1 and P2)

### 4.5 Water-ice option (L)
- Science value = close to permanently shadowed regions (PSRs) where ice can survive. Simple version: distance from each candidate to the nearest PSR pixel, from the existing PSR layer (`web/public/data/map/psr.png`, 85–90° S), as an optional score term "science". Full version: Diviner ice-stability temperatures (PDS Diviner polar products); that's new data and a pipeline step, so only if time allows.
- Coordinate with #5: their science-vs-engineering view may want the same "distance to PSR" number. Agree on one helper in `data.ts` (append-only) so it's computed once.

### 4.6 F9 relay mode (L)
- Only if everything else is done; see F9 in section 6 of `PROJECT_PLAN.md`.

---

## Files you own
`web/src/Finder.tsx`, `MapView.tsx`, `Globe.tsx`, `Planner.tsx`, `pipeline/export_candidates.py`, `pipeline/artemis_regions.json`, `web/public/data/artemis.json`, `web/public/data/finder/`, `web/src/styles/finder.css`, the `{/* WS4 */}` edit in `App.tsx`.
- `index.css` already holds some finder and map styles; leave them there, and put new ones in `styles/finder.css`.
- If you regenerate finder data (`python export_candidates.py`, ~12 minutes on 8 cores), `npm run check:engine` must still PASS.

## Interfaces you rely on
- `viability`, `windowStats`, `dailyViability`, `Thresholds` in `data.ts`; `siteTracks` in `engine.ts`; `computeCustomPoint(lat, lon, false)` in `customPoint.ts` for exact numbers.
- #3 may add `inAnalysisYear(site)` to `data.ts`. When it lands you can use it, but #3 already guards the Find/Globe tabs in `App.tsx`, so you don't depend on it.

## Interfaces others rely on
- `Planner`'s new optional prop must default to "no button", so nothing breaks before the App edit merges.
- If #5 asks for a map overlay (e.g. landing-ellipse points), add an optional prop to `MapView` for them rather than letting them edit it.

## Done when
- A judge goes from "launch slipped" to "3 better spots for the new date" in under a minute.
- Artemis III regions are visible on Map, Find sites and Globe, sourced and labelled approximate.
- `npm run check:engine` passes; change-log row added.
