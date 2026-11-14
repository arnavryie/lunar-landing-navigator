# AGENTS.md — Lunar South Pole Mission Planner

## 1. Project Identity

You are working on the **Lunar South Pole Mission Planner**, a NASA Space Apps Challenge 2026 project.

The application helps mission planners evaluate lunar south-pole landing sites by analysing:

- Solar visibility and power availability.
- Direct-to-Earth visibility and communication windows.
- Terrain obstruction and lunar surface geometry.
- Landing-date changes and mission delays.
- Alternative landing locations.
- Site comparisons and mission viability.

The central problem:

A lunar lander needs sunlight for power and Earth in view for direct communication. Near the lunar south pole, small terrain variations and changes in landing dates can significantly affect mission viability.

The application must make these engineering decisions understandable, scientifically defensible and easy to explore.

## 2. Source of Truth

Before making changes, inspect:

1. `00-START-HERE.md`
2. The relevant workstream document (`01` through `06`).
3. `PROJECT_PLAN.md`
4. `AI_CONTEXT.md`

These documents define the current project requirements.

Do not independently redefine agreed functionality, architecture, terminology or scientific assumptions.

If instructions conflict:
- Follow the latest documented team decision.
- Preserve existing scientific correctness.
- Identify conflicts before making potentially destructive changes.
- Do not silently remove another workstream's functionality.

## 3. Scientific Integrity — Highest Priority

Scientific correctness takes priority over visual appearance.

Never:
- Invent scientific measurements.
- Present illustrative values as real measurements.
- Fabricate NASA or JPL data.
- Replace real calculations with arbitrary constants.
- Claim that Earth visibility guarantees successful radio communication.
- Describe approximate coordinates as exact.
- Remove scientific caveats to make the interface look simpler.

Always:
- Preserve units and coordinate conventions.
- Distinguish geometric visibility from actual RF communication.
- Label approximations clearly.
- Cite official sources for external scientific claims.
- Preserve provenance and validation information.
- Clearly identify limitations in terrain resolution and temporal sampling.

When a calculation is changed, explain:
1. What changed.
2. Why it changed.
3. What scientific assumptions are involved.
4. How it was validated.

## 4. Existing Architecture

### Frontend
Location: `web/`

Technology:
- React
- TypeScript
- Vite
- Three.js
- Web Workers

### Scientific pipeline
Location: `pipeline/`

Technology:
- Python
- Skyfield
- JPL DE421 ephemeris
- NASA LOLA terrain data

### Important scientific modules

- `pipeline/ephemeris.py`: Sun and Earth positions.
- `pipeline/horizon.py`: Terrain horizon calculations.
- `pipeline/timeline.py`: Hourly visibility and mission metrics.
- `web/src/engine.ts`: Browser-side scientific calculations.
- `web/src/engine.worker.ts`: Background computation.

Do not duplicate existing scientific logic without understanding the original implementation.

## 5. Existing Application Workspaces

The application contains six main tabs:

1. **Site and Plan** — Site metrics, horizon dial, timelines, seasons, survival calculations and landing-date planning.
2. **Find Sites** — Ranked candidate locations based on mission constraints.
3. **Globe** — Interactive lunar globe with real solar lighting and site markers.
4. **Map** — South-pole map with NASA layers and location selection.
5. **3D** — Lunar terrain visualisation with GPU-computed shadows.
6. **Compare** — Side-by-side comparison of multiple site/date scenarios.

Do not remove, redesign or restructure an existing workspace unless the task explicitly requires it.

## 6. Aerospace Visual System

The interface should feel like a professional aerospace mission-planning instrument.

Design principles:

- Technical, precise and information-rich.
- Clear visual hierarchy.
- Restrained use of colour.
- Consistent spacing and typography.
- Functional visualisation rather than decoration.
- Simple first, depth on demand.
- Responsive desktop layouts.

### Typography

- Inter for interface typography.
- IBM Plex Mono for telemetry and numerical data.

### Semantic colours

Use the project's shared colour language:

| Colour | Meaning |
|---|---|
| Amber `#c98419` | Sun |
| Blue `#5590d8` | Earth |
| Green `#1fa38a` | Both visible |
| Grey `#4a515a` | Neither visible |

Do not assign new meanings to these colours.

Avoid:
- Excessive nested cards.
- Decorative gradients without purpose.
- Unnecessary animations.
- Consumer-style emojis in mission controls.
- Tiny functional text.
- Arbitrary colour overrides.
- Redundant navigation.

## 7. Six Workstreams and File Ownership

Six team members work in parallel.

Each workstream has its own branch and file ownership.

| Branch | Responsibility |
|---|---|
| `ws1-release` | Deployment, README and quality |
| `ws2-explainers` | Why cards and Moon-vs-Earth |
| `ws3-evidence` | Mission replays and validation |
| `ws4-finder` | Artemis regions, finder and planner |
| `ws5-analysis` | Comparison, reports, landing ellipse and modes |
| `ws6-pitch` | Demo, slides, video and submission |

Read the relevant workstream document before modifying files.

### Shared-file rules

- `App.tsx`: Only small, explicitly marked workstream integrations.
- `data.ts`: Append-only additions under the relevant workstream marker.
- `Sources.tsx`: Coordinate changes with its owner.
- Do not overwrite another person's changes.
- Do not reorganise the project structure without team agreement.

### Frozen scientific files

Treat these as read-only unless WS1 is fixing a confirmed bug with team coordination:

- `engine.ts`
- `engine.worker.ts`
- `customPoint.ts`
- `Terrain3D.tsx`
- `pipeline/ephemeris.py`
- `pipeline/horizon.py`
- `pipeline/timeline.py`
- `pipeline/export_map.py`

Never modify these merely to simplify implementation.

## 8. Implementation Workflow

Before coding:

1. Inspect the existing implementation.
2. Identify the relevant files and their owners.
3. Understand existing interfaces and data structures.
4. Check whether another workstream depends on the functionality.
5. Plan the smallest safe implementation.

During implementation:

- Prefer focused changes over large rewrites.
- Reuse existing components and helpers.
- Maintain TypeScript type safety.
- Avoid unnecessary dependencies.
- Preserve existing functionality.
- Keep scientific calculations separate from presentation logic.
- Do not introduce mock data into production functionality.

After implementation:

1. Run relevant tests.
2. Check for TypeScript errors.
3. Inspect the affected UI.
4. Verify that existing features still work.
5. Report modified files and validation results.

## 9. Validation Commands

Run commands from `web/` unless otherwise specified.

Install dependencies:

`bun install`

Start development server:

`bun run dev`

Production build:

`bun run build`

Lint:

`bun run lint`

Scientific engine consistency check:

`bun run check:engine`

A successful engine check must report PASS for both comparisons.

If scientific data or pipeline-related functionality changes, validate the browser implementation against the Python implementation.

Never claim a test passed without actually running it.

## 10. Performance

The application handles substantial scientific datasets and 3D visualisation.

Prioritise:

- Efficient data loading.
- Web Worker computation for expensive operations.
- Avoiding unnecessary React re-renders.
- Efficient Three.js rendering.
- Appropriate resource disposal.
- Lazy loading where useful.
- Avoiding unnecessary dependencies.

Do not reduce terrain resolution or remove scientific detail merely to improve performance without discussing the trade-off with the relevant workstream owner.

## 11. Priorities

Work in this order:

1. Scientific correctness.
2. Core mission-planning functionality.
3. Reliability and validation.
4. Usability and accessibility.
5. Visual refinement.
6. Performance optimisation.
7. Stretch features.

Do not spend time implementing stretch features while core functionality is broken.

## 12. Agent Behaviour

You are expected to behave like a senior engineer working on a collaborative scientific software project.

Always:

- Inspect before modifying.
- Understand the existing architecture.
- Respect workstream ownership.
- Preserve existing functionality.
- Follow documented requirements.
- Use official sources for scientific information.
- Explain important technical decisions.
- Report incomplete work honestly.

Never:

- Rewrite entire files unnecessarily.
- Delete functionality without permission.
- Modify frozen scientific modules casually.
- Make unrelated UI changes.
- Invent data or validation results.
- Commit or push changes unless explicitly requested.
- Assume that a task is complete merely because the code was written.

**Final principle: Build a scientifically trustworthy lunar mission-planning system, not just an impressive-looking dashboard.**