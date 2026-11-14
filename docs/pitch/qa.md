# Judge Q&A: short, honest answers

Never improvise a number; everything here is in the app or PROJECT_PLAN.md.

**How do you know the numbers are right?**
Four checks, all on the Validation page: Sun/Earth directions vs JPL Horizons (worst 0.000033°); long-term sunlight and Earth visibility vs NASA's LOLA illumination maps at 80 points (correlation 0.991 / 0.995, median difference 0.31 / 0.17 points; the worst single point is 15 points off, and we show that too); the browser vs the Python pipeline (3.5×10⁻⁷°); GPU shadows vs the pipeline (191 of 192 agree).

**Why 240 m terrain? Isn't that coarse?**
It's NASA's standard polar LOLA product and covers the whole region. Ridges kilometres away set the horizon, and 240 m captures those. Boulders and small craters near the lander aren't seen, so a final site needs higher-resolution data; the app says so.

**Why a 2 m mast?**
Our chosen height for the solar panels and antenna, stated on screen. A different height changes the horizon slightly at grazing angles; it's an adjustable assumption in the pipeline (`OBS_HEIGHT_M`).

**Why hourly steps?**
8,760 steps per year per site keeps the data small enough for the browser. Sunrise/sunset times can be off by up to an hour; the app states this.

**What do "viable" and the thresholds mean?**
A landing date is viable if, over the whole mission from landing, sunlight ≥ 60%, the longest darkness ≤ 48 h and Earth in view ≥ 50%. These are example values, shown and editable on screen; a real mission would use its own battery and comms limits.

**What isn't modelled?**
Lander tilt (IM-1 tipped over), local boulders, sub-240 m terrain, Earth-based ground-station availability, relay satellites, thermal limits, and dust. Only 2027 is precomputed (replays use their real dates).

**Did the mission replays "prove" the model?**
They're consistency checks, not proof: agencies don't publish hour-by-hour sunlight. Our model has Sun and Earth up at both landings; first sunsets on 4 Sep 2023 (Chandrayaan-3; ISRO put lander and rover to sleep by 4 Sep) and 2 Mar 2024 (IM-1; NASA expected operations through 29 Feb).

**Where do the NASA candidate regions come from?**
NASA's 28 Oct 2024 release lists nine regions but no coordinates. We read approximate centres off NASA's published map (about ±5 km) and label them approximate. NASA has since made Artemis III an Earth-orbit test; landings are planned from 2028.

**How is this different from NASA QuickMap or Moon Trek?**
Those show the data. Ours answers a planning question: "is this landing date viable for my mission, what happens if it slips, and where or when else works?", in seconds, for any spot and hour.

**Did you use AI?**
Yes, as a coding and research assistant (Claude via Claude Code); see the README. Every number comes from the pipeline and the checks.
