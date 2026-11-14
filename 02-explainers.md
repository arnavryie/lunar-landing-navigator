# Workstream 2: Explainers (F8 "Why?" cards and Moon vs Earth)

**Read `00-START-HERE.md` first.** Your branch: `ws2-explainers`.

## Your mission
The brief asks us to explain **why small changes in place and date matter** and to make **Moon-vs-Earth differences obvious**. Judges are not all lunar experts. Your cards turn our numbers into "aha" moments: next to a number like "Sunset in 3 days", a small **Why?** button opens a short card with a simple diagram, using the live values for the selected site and time.

You work almost entirely in your own folder `web/src/explain/`, so you can work in parallel with everyone. Background physics: `PROJECT_PLAN.md` sections 2 (physics for the team), 3 (glossary) and F8 in section 6.

---

## P1 tasks

### 2.1 The `Why` component (S)
- `web/src/explain/Why.tsx`: `export function Why({ topic, site, i }: { topic: Topic; site: Site; i: number })` renders a small "Why?" text button; clicking it opens a card (a native `<dialog>` is the least code; it must close with Esc and a Close button, and trap focus).
- `web/src/explain/cards.tsx`: one entry per topic: title, 2–4 short sentences, a small SVG diagram, and a "Right now at this site" line computed from `site` and `i`.
- CSS in `web/src/styles/explain.css` (imported by `Why.tsx`). Use the colour language from `00-START-HERE.md`.

### 2.2 Five cards (M)
Write each in plain words (aim for a 12-year-old to follow). Use only physics you can check in section 2 of `PROJECT_PLAN.md`; when in doubt, ask, don't guess.

| Topic | Key idea | Live value to show (from `data.ts` / `site`) |
|---|---|---|
| `sun-skims` | The Moon's axis is tilted only about 1.5°, so at the pole the Sun circles along the horizon instead of rising high | Sun elevation now: `site.sun.el[i]`; highest this month: max of `site.sun.el` over the next 709 hours |
| `ridge-blocks` | When the Sun is only ~1° up, a ridge a few km away is enough to hide it | Terrain horizon in the Sun's direction: `horizonAt(site, site.sun.az[i])` vs `site.sun.el[i]` |
| `earth-wobbles` | Earth hangs almost still in the lunar sky but wobbles a few degrees (libration), so at the pole it rises and sets over weeks | Earth elevation now: `site.earth.el[i]`; time to Earthset: `hoursToChange(site.earth.frac, i)` |
| `five-km` | Two spots 5 km apart can have very different light because they see different horizons | Compare this site's sunlit % with a nearby curated site (`site.metrics.sunlit_pct`) |
| `dates-matter` | A lunar day lasts ~29.5 Earth days and the seasons shift light through the year | `dailyHours(site, 'sun')`: hours of sunlight per day across the year (small chart) |

### 2.3 Moon-vs-Earth contrast card (S–M)
- A card on the Site view: "Highest Sun here this month: **1.2°**. In **[city]** today: **58°**."
- City picker (a `<select>` of ~10 world cities with hard-coded latitude/longitude). **No geolocation permission.**
- Compute the city's Sun elevation in plain TypeScript with a standard low-precision solar-position formula (NOAA or "Astronomical Almanac" approximation, good to ~1°); put it in `web/src/explain/solar.ts` with a tiny self-check (e.g. equator at the March equinox at local noon ≈ 90°). Cite the formula's source in a code comment.
- Add 3 contrast facts: a lunar day lasts ~29.5 Earth days; darkness can last days, not hours; no air, so no twilight and a black sky.

## P2 tasks
### 2.4 Assumptions and glossary in plain words (S)
- A "How to read this" card listing the key assumptions shown on screen: 2 m mast height, 240 m terrain, hourly steps, 2027 only, the disc rule ("visible" = any part of the Sun's or Earth's disc above the terrain). Source text: the notes already on each tab and `web/src/Sources.tsx`.

## Stretch
### 2.5 Guided Explore walkthrough (L)
- A 5–6 step guided tour ("1. This is the south pole… 2. Press Play…"). Only after #5 has built the Explore/Planner toggle (`web/src/mode.ts`); until then build it behind a temporary button.

---

## Where you plug into `App.tsx` (your only edits outside your folder)
Wrap each edit in `{/* WS2 */}` comments.
1. Import `Why` and `Contrast` at the top.
2. Inside the existing `Body` component (search for `function Body`): one `<Why topic=... site={site} i={i} />` after the Sun/Earth elevation number.
3. Inside `Status` (search `function Status`): one `<Why topic="ridge-blocks" … />`.
4. In the Site view, after `<SiteFacts site={site} />`: `<Contrast site={site} i={i} />`.

That's all. #5 edits the header area of `App.tsx` and #3 edits the view blocks, so your edits won't collide if you keep to these spots.

## Files you own
`web/src/explain/*`, `web/src/styles/explain.css`, the small `App.tsx` edits listed above.

## Interfaces you rely on (all already exist in `web/src/data.ts`)
`Site`, `timeAt`, `horizonAt`, `hoursToChange`, `dailyHours`, `formatDuration`, `formatDeg`. Don't change them; if you need a new helper, add it to your own folder.

## Done when
- A non-expert can answer "why is this site dark next week?" from the app alone.
- Every card shows at least one live number for the selected site and time.
- Cards open and close with the keyboard and look right at 1366 × 768.
- Change-log row added.
