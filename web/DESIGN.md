# Design system: "Survey sheet"

The planner is drawn like a lunar map sheet at night: warm graphite paper, hairline neatlines with
coordinate ticks, legends set like a map key, and sources printed as the sheet's credits. Colour is
reserved for data. Tokens are in `src/index.css` `:root`; the landing page adds `src/styles/landing.css`.

## Colour

| Token | Value | Use |
|---|---|---|
| `--sheet` | `#181715` | Page ground |
| `--plate` | `#0f0e0c` | Inset plates: dial sky, map, 3D, globe, calendar |
| `--raise` / `--raise-2` | `#201f1c` / `#2a2824` | Fields, inputs, hover |
| `--line` / `--line-2` | `#34322d` / `#4c4942` | Hairlines / ticks and strong rules |
| `--ink` / `--ink-2` / `--ink-3` | `#ebe7dd` / `#aaa598` / `#8f8b80` | Text, secondary, captions |
| `--sun` `--earth` `--both` `--none` | `#c98419` `#5590d8` `#1fa38a` `#4a515a` | **Meaning colours, unchanged** (CVD-checked). Never reuse for anything else |
| `--region` | `#cf86c3` | NASA Artemis III candidate regions (chart-magenta overprint) |
| `--ice` | `#9fd3cf` | Permanently shadowed regions / water ice |
| `--ok` `--warn` `--bad` | `#6fcf9f` `#e6c15a` `#f08a7a` | Verdicts |

Selection, focus and "active" use `--ink` (inverted chip), not a hue: blue means Earth, amber means Sun.
Older names (`--night`, `--surface`, `--rule`, `--text`, `--muted`) are aliases, so workstream CSS keeps working.

## Type

Archivo variable (self-hosted, `@fontsource-variable/archivo`), one family. Hierarchy from weight and
`font-stretch` (100% body, 106–112% headings and figures, up to 120% for big letters), tabular numerals
everywhere. No monospace, no tracked uppercase labels.

## Form

- Corners: `--radius-s` 2px, `--radius-m` 3px. No pills, no glows, no gradient text.
- Sections are ruled (top hairline with tick marks), not boxed. No nested cards.
- Drawn figures sit on a `--plate` inside a 1px neatline with corner registration ticks (`.plate`, `.dial-wrap`).
- Status is a 2px top rule in the status colour (`.verdict`, `.body-card`), never a thick left stripe.
- The collar (header) ends in a tick scale; the active screen is an ink underline.

## Voice

Interface copy is sentence case and plain ("Open in Site and plan", not "Open in Site & Plan Tab (Horizon Dial) ↗").
No ALL-CAPS labels in HTML, no decorative arrows on buttons, no emoji. Map labels drawn on canvases may stay in caps
(a cartographic convention). Claims carry a source number on the front page ([1]–[5]).

## Motion

- One authored moment per page: on the front page, the Sun's bearing circling the pole on Fig. 1 (real DE421 vectors,
  18 simulated hours per second, paused for `prefers-reduced-motion`).
- Screens settle in once (360 ms, `--ease-out`); hovers 150 ms; buttons move 1 px on press.
- Everything is disabled under `prefers-reduced-motion`.

## Front page

Bare URL → `Landing.tsx`; any query string (permalinks, `?view=…`) → the planner. It is set as a short technical note:
Fig. 1 (NASA PGDA long-term sunlight map of 85–90° S in a polar-chart frame, with the hour's Sun and Earth bearings
from DE421), a title block, a year scrubber, Fig. 2 (a real site's hourly calendar), contents, method in prose with
live `validation.json` numbers, numbered references, and a colophon. Margin labels sit beside each section on wide
screens. No three.js on this page.
