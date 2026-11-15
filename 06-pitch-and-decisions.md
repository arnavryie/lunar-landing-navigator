# Workstream 6: Pitch, submission and team decisions

**Read `00-START-HERE.md` first.** Your branch: `ws6-pitch` (mostly documents in `docs/pitch/`).

## Your mission
Turn a working tool into a winning submission: the demo script, slides, video and submission text. You also **run the open team decisions** so the others aren't blocked. You don't write app code, so you can start on day one in parallel with everyone. Use the app as it is today and mark the parts that depend on other workstreams.

---

## P1 tasks

### 6.1 Check the official rules first (S, day one)
- Read the **official NASA Space Apps 2026** rules and submission page: deadline (with time zone), what must be submitted (project page, video and/or slides, length limits, link requirements), judging criteria, and any rule on AI tools or third-party data.
- Write them into `docs/pitch/rules-checklist.md` with the source link. **Don't rely on memory or past years**; formats change.
- Share the deadline and format with the whole team immediately.

### 6.2 Team decisions (S, first two days)
Run these and record each result in section 13 of `PROJECT_PLAN.md` (you own that section) plus a change-log row:

| Decision | Options | Notes |
|---|---|---|
| **Product name** | Team vote | ✅ Decided 2026-11-15: **Lunar Statio** (subtitle: South Pole Mission Planner) |
| **Default viability thresholds** | Keep the example values (14 days, sunlit ≥ 60%, darkness ≤ 48 h, Earth ≥ 50%) or sourced real values | If you use "real" values, they need a source (e.g. a published lander's battery or comms requirement). Otherwise keep them and call them examples on screen |
| **Analysis period** | Keep 2027, or two years | **Recommend keeping 2027.** Two years would mean rerunning the pipeline and the finder data and doubling download size, and it would touch #3, #4 and #5. Decide on day one or not at all |
| **Missions to replay** | IM-2 Athena, IM-1 Odysseus, Chandrayaan-3 | #3 sources the facts; agree on the 2–3 with them |
| **Team credits** | How names appear | Give to #1 for the README |

### 6.3 Demo script (M)
- Start from the storyline in section 14 of `PROJECT_PLAN.md` (7 steps, ~3 minutes). **Replace every placeholder number with real output from the app** (open the app, do the step, write down what it shows). Keep the permalink for each step so it can be reopened exactly.
- Map the steps to tabs that exist today:
  1. 3D: Play the shadow time-lapse.
  2. Site and plan: pick a site and date, read the hero numbers.
  3. "Why?" card: comes from #2. Until it lands, write the line and mark it `[WS2]`.
  4. +14 days slip button: the planner verdict changes.
  5. Find sites: better spots for the new date (and #4's "Find alternatives" button once merged).
  6. Compare: original vs alternative.
  7. Mission replay and validation page: from #3, marked `[WS3]`.
- Write it as `docs/pitch/demo-script.md`: what to click, what to say, how long, and the exact permalink.
- **Plan B:** record a screen capture of the full demo once the app is deployed (#1), in case the venue Wi-Fi fails. Also keep a local build that runs offline (`npm run build`, then `npm run preview`).

### 6.4 Slides and video (L)
- Follow the format from 6.1. Suggested slide order: problem (the Sun skims the horizon; slips make sites dark) → our answer (one screenshot) → how it works (pipeline in one diagram) → **accuracy** (validation numbers, from #3's page) → demo moments → what's next → team.
- Every number on a slide must be visible in the app or on the validation page. Ask #3 if unsure.
- Visual style: the app's colour language (amber Sun, blue Earth, green both, grey neither) and dark background.
- Video: follow the official length limit; script it from the demo script.

### 6.5 Submission text (S)
- Project summary, how it addresses the challenge (use the "Brief requirements vs our features" table in section 1 of `PROJECT_PLAN.md`), data and tools used (list from `web/src/Sources.tsx`), what's validated, limits, the live link (from #1) and the repository link.
- If the rules ask about AI tool use, answer accurately.

## P2 tasks
- **Rehearse** at least twice on the deployed link with a timer; note any slow or confusing step and send it to the owner as a GitHub issue.
- **Judge Q&A sheet** `docs/pitch/qa.md`: likely expert questions with honest answers (why 240 m terrain, why 2 m mast, why hourly, what's not modelled, how we validated). Pull answers from `PROJECT_PLAN.md` and the validation page; never improvise a number.

---

## Files you own
`docs/pitch/*`, section 13 of `PROJECT_PLAN.md`, change-log rows for decisions.

## Interfaces you rely on
- #1: deployed link and README.
- #2: "Why?" card for demo step 3.
- #3: replays and validation page for step 7.
- #4: "Find alternatives" button for step 5.
Until each lands, write the step with a `[WS<n>]` marker and the expected behaviour, then fill it in.

## Done when
- The demo runs within the time limit on the deployed link, twice in a row, with no surprises.
- Every claim on a slide is backed by a number in the app.
- The submission is complete and in by the official deadline (with time-zone margin).
- Decisions are recorded in section 13 with change-log rows.
