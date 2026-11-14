# Workstream 1: Release and quality

**Read `00-START-HERE.md` first.** Your branch: `ws1-release`.

## Your mission
Make the app reachable by a public link that works on any judge's laptop, write the README that lets a stranger understand and rebuild the project, and be the team's tester. You go first in importance: everyone else will test their work on your deployed link, so **get a first deployment up on day one**, even before the README is polished.

You can work fully in parallel: you don't need anyone else's features. Redeploy whenever their pull requests land.

---

## P1 tasks (needed for the demo)

### 1.1 Deploy the app (M)
- **Recommended host: GitHub Pages via GitHub Actions.** It's free, needs no extra account, and the app is fully static (no server). Alternatives: Netlify or Vercel, but they need a team account; agree with #6 before choosing.
- Steps:
  1. Add `.github/workflows/deploy.yml` that on push to `lunar-mission-planner` runs, in `web/`, `npm ci`, `npm run check:engine`, `npm run build`, then publishes `web/dist` to Pages (`actions/upload-pages-artifact` + `actions/deploy-pages`).
  2. Pages serves the site under `/<repo-name>/`, so set the base path for the build: in `web/vite.config.ts` add `base: process.env.BASE_PATH ?? '/'`, and set `BASE_PATH` in the workflow. All data loading already uses `import.meta.env.BASE_URL`, so nothing else should need changing. **Verify that** by loading every tab on the deployed site.
  3. In the repository settings, Pages source = GitHub Actions. Repository settings belong to the repo owner; ask them to change it if you can't.
- **Check after deploying:** every tab loads (Site and plan, Find sites, Globe, Map, 3D, Compare), the Map click-anywhere works (it uses a Web Worker), the 3D shadows render, a copied permalink reopens the same view, and the browser console shows no errors.
- **Data size:** about 21 MB in `web/public/data/`. Measure first-load time on a normal connection (Chrome DevTools → Network → "Fast 4G"). Write the numbers in the README.

### 1.2 README (M)
Create `README.md` at the repository root (replace the default Vite text in `web/README.md` with one line pointing to it). Sections:
1. **What it is**: one paragraph, plus one screenshot per tab (save in `docs/img/`).
2. **Live link.**
3. **What problem it solves**: the brief in 3 sentences (copy the spirit of section 1 of `PROJECT_PLAN.md`).
4. **How it works**: the pipeline steps and the browser engine (use section 1 of `00-START-HERE.md`).
5. **Accuracy**: the validation numbers (JPL Horizons 0.00003°, NASA illumination maps r = 0.99, browser vs Python identical, GPU shadows 191/192, finder estimates within 0.3 points). Take them from the change log in `PROJECT_PLAN.md`; don't invent any.
6. **Run it yourself**: setup from `00-START-HERE.md` section 2.
7. **Data sources and credits**: the same list as the in-app Sources panel (`web/src/Sources.tsx`).
8. **Limits**: 2027 only, 240 m terrain, 2 m mast height, not-to-scale models. Collect them from each tab's on-screen notes.
9. **Team**: names as the team wants them shown (ask #6).

### 1.3 Test pass (M), then repeat before the final demo
- Screens: 1280 × 720, 1366 × 768, 1920 × 1080. Browsers: Chrome, Edge, Firefox (Safari if anyone has a Mac).
- For each tab, write what you saw in a checklist file `docs/qa-checklist.md`: works / broken / ugly, with a screenshot for anything broken.
- **Fix layout bugs yourself only in `web/src/index.css`.** Bugs inside another workstream's component: open a GitHub issue and tag the owner (see the ownership table).
- Known things to look at: the Map and Find sites screens leave a wide empty gap between map and side panel on wide screens; long side panels push content below the fold at 1366 × 768.

---

## P2 tasks

### 1.4 Loading speed (S–M), only if 1.1 shows it's slow
- Ideas in order of effort: confirm the host compresses `.i16`/`.f32`/`.i8` files (check the `content-encoding` response header); start fetching the map data only when a tab opens (most already do); last resort, halve the DEM resolution beyond 30 km from the pole (would need the pipeline and a rerun of `check:engine`; agree with #4 first).

### 1.5 Guard the checks (S)
- The deploy workflow must fail if `npm run check:engine` fails. Add a short "Checks" section in the README saying what each check proves.
- Before the final demo, open the 3D tab and press "Check shadows against the pipeline": expect 191 of 192 agreeing.

## Stretch (only if everything above is done)
- **Phone-friendly layout (L):** the plan says laptop-first; phones only if time remains. Don't start this before the final demo is rehearsed.

---

## Files you own
`README.md`, `docs/img/`, `docs/qa-checklist.md`, `.github/workflows/`, `web/vite.config.ts`, `web/src/index.css` (layout fixes only), `web/README.md`. Bug fixes in frozen files (`engine*.ts`, `customPoint.ts`, `Terrain3D.tsx`) only with `check:engine` passing and a note to the team.

## Interfaces you rely on
None. Other workstreams will add tabs or panels; just redeploy and re-test.

## Done when
- A public link opens on a fresh laptop and every tab works.
- A new person can rebuild the app and the data from the README alone.
- `docs/qa-checklist.md` shows a full pass on the three laptop sizes the day before the demo.
