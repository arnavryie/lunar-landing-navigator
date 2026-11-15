# Demo: the 7-slide deck, the 30-second video, and the live demo

All numbers below were read from the live site on 14 Nov 2026 (14-day mission; example needs: sunlit ≥ 60%, darkness ≤ 48 h, Earth in view ≥ 50%). Reopen any step from its link.

Live site: https://lunar-mission-planner-three.vercel.app

## The story in one line
"Your lander's site is perfect on 14 January. The launch slips a week, and the same site gets a 6½-day night. In two clicks our tool finds a spot 21 km away that still works."

## Key scenes (real numbers + links)

| # | Scene | What the app shows | Link |
|---|---|---|---|
| 1 | The Sun skims the horizon | IM-2 Athena site (84.79° S), 14 Jan 2027 00:00 UTC: Sun at **+2.07°**, the terrain horizon there **+2.08°**: only **47%** of the Sun's disc is above the ridge. Highest Sun in the next 30 days: **+5.8°**. Pune's noon Sun that day: **+49.9°**. | https://lunar-mission-planner-three.vercel.app/?site=im2-athena&t=312&plan=13 |
| 2 | The planned landing works | 14-day mission from 14 Jan: **viable**: sunlit **100%**, longest darkness **0 h**, Earth in view **100%**. Sunset in **14 d 11 h**, Earthset in **14 d 18 h**. Slip budget: **2 days**. | same link |
| 3 | Launch slips 7 days | 21 Jan: **not viable**: sunlit **53%**, longest darkness **6 d 13 h**, Earth **78%**. (A 14-day slip is worse: sunlit **3%**, darkness **13 d 13 h**.) | https://lunar-mission-planner-three.vercel.app/?site=im2-athena&t=480&plan=13 |
| 4 | Find other spots | "Find other spots for 2027-01-21 →" opens Find sites within 25 km: best spot **85.46° S, 27.1° E, 21.1 km away: viable**, sunlit **94%**, longest darkness **11 h**, Earth **51%**, slope 6.9° (checked exactly). | click the button on the link above |
| 5 | Or move the date | Same site, next viable window opens **11 Feb 2027**; best windows **14 Jan, 7 Sep, 7 Oct 2027** (100% / 0 h / 100%). | link from scene 3, planner panel |
| 6 | Proof | Validation page: JPL Horizons worst **0.000033°**; NASA illumination maps **r = 0.991 / 0.995**; browser vs Python **3.5×10⁻⁷°**. Replay: IM-1 Odysseus (22 Feb 2024): our model has Sun and Earth up at landing, first sunset **2 Mar 2024**; NASA reported operations expected through 29 Feb. | https://lunar-mission-planner-three.vercel.app/?view=validation |
| 7 | NASA's regions | Find sites → "Within 10 km of a NASA candidate region": for a 16 Jan 2027 landing, **40 viable** of 102 spots. | https://lunar-mission-planner-three.vercel.app/?site=mons-mouton&view=find&t=360 (then pick that search) |

Careful with wording: these are **NASA's candidate regions (Oct 2024)**. NASA has since made Artemis III an Earth-orbit test (2027), with south-pole landings planned from 2028. Don't say "Artemis III will land here".

---

## Option A (recommended): 7-slide deck
Easier to get right in a day, nothing to record, judges read it at their own pace. Must be ≤ 7 slides including the title. English. Big screenshots, few words. Export as PDF and share a public link (Google Drive "anyone with the link", or upload it next to the site).

1. **Title:** Lunar Statio, South Pole Mission Planner. Team Stranded (names), Pune. Challenge: Lunar Landing Site Navigator. One screenshot of the horizon dial.
2. **The problem:** "At the south pole the Sun skims the horizon." Scene 1 numbers: Sun +2.07° vs ridge +2.08°; Pune +49.9° the same day. "Launches slip, and a perfect site can go dark."
3. **Our answer (user experience):** screenshot of Site and plan: pick a site and date → power and Earth contact at a glance → slip → re-plan.
4. **Demo moment:** scenes 2→3→4 as three small screenshots with the numbers: viable 100% / 0 h → +7 days: 53% / 6 d 13 h → 21 km away: viable 94% / 11 h.
5. **How it works + NASA data:** one diagram: LOLA terrain + JPL ephemeris → horizon + Sun/Earth discs → hour by hour 2027 → browser. Logos-free list of NASA data (LOLA, PGDA illumination maps, JPL DE421/Horizons, LROC, SVS) and ISRO (Chandrayaan-3).
6. **Why you can trust it:** validation numbers (scene 6) and the IM-1 replay.
7. **What's next:** a mission team could plug in their lander's real battery and comms limits; more years; finer terrain near a chosen site; NASA's candidate regions already on the map. Live link.

## Option B: 30-second video (hard limit: 30 s)
Screen recording of the live site plus voice-over (English, or another language with English subtitles). About 75 words maximum.

- **0:00-0:03** "Hi, we're Team Stranded from Pune."
- **0:03-0:08** "Lunar Landing Site Navigator: at the Moon's south pole the Sun only skims the horizon." *(dial, scene 1)*
- **0:08-0:20** "This site is perfect on January 14th. The launch slips a week, and it faces six days of darkness. One click finds a spot 21 kilometres away that still works." *(scenes 2, 3, 4)*
- **0:20-0:30** "Built on NASA terrain and JPL ephemerides, checked against NASA's own maps. Re-planning a landing now takes seconds." *(validation page, then the globe)*

Time it. If it's over 30 s, cut words, not speed.

## Live demo for local judges (about 3 minutes)
Open the scene links in tabs beforehand. If the Wi-Fi fails, run it locally (`cd web`, `npm run build`, `npm run preview`).
1. Scene 1 (30 s): read the Sun vs ridge numbers; point at the dial.
2. Scene 2 → press **+7 d** (40 s): read the before/after table.
3. **Find other spots** (40 s): the 21 km alternative; click it to open it in Site and plan.
4. Scene 5 (20 s): next viable window and best dates.
5. Scene 6 (30 s): validation page, then the IM-1 replay card.
6. Close (20 s): globe with the real Sun and NASA's regions; "what's next".
