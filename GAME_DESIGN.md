# GAME_DESIGN.md — "Клумба: цветочная головоломка"

Short name: **"Клумба"**. Working title "Garden" in code/repo. A browser logic puzzle game for Yandex Games.

## Theme

A cozy garden. Each colored region of the grid is a flower bed; the player plants exactly one flower per bed. Mascot: a small ladybug who gives hints (placeholder, drawn with SVG for now).

## Rules

An N×N grid is divided into N colored regions ("flower beds"). The player places flowers so that:

- each region contains exactly one flower;
- each row contains exactly one flower;
- each column contains exactly one flower;
- flowers never touch each other, not even diagonally (no two flowers in adjacent cells, including diagonal neighbors).

## Controls

- Single tap on an empty cell → white X mark ("no flower here"), placed immediately, no delay.
- Double tap (a second tap within ~300 ms on the same cell, while it shows an X) → the X becomes a flower.
- Single tap on an X with no quick follow-up → clears back to empty.
- The pre-placed flower, any correctly planted flower, and any red X marks all lock immediately and can't be changed — tapping or dragging over them does nothing.

A flower always needs a deliberate double tap; a single tap never plants one directly. Works the same with mouse and touch, and `touch-action: none` on the board plus a non-zoomable viewport keep a fast double-tap from triggering the browser's zoom gesture, and keep the page from scrolling while dragging on the board.

**Drag to mark.** Press and drag across cells to mark or clear several at once: if the drag starts on an empty cell, every empty cell it passes gets a white X; if it starts on a white X, every white X it passes is cleared. Flowers, the pre-placed flower, and red X marks are never touched by a drag — the drag just passes over them. A drag never triggers the double-tap flower placement, regardless of how it moves.

## Starting flower

At the start of every level, one flower from the solution is already planted and locked — the player always has a confirmed starting point and can't change or remove it.

## Mistake feedback

If the player plants a flower in a cell that breaks a rule or isn't part of the level's one true solution, that cell gets a red X (visually distinct from the plain white "no flower" X) with a short shake, one water drop pops/fades away, and the cell locks — the red X stays as a permanent marker that no flower belongs there.

## Level-complete fill

The instant the last correct flower is planted, every remaining empty cell on the board gets a white X in a quick staggered wave (each cell appearing ~35ms after the last), and only once that wave finishes does the win screen appear. A solved board is never left with ambiguous empty cells.

## Level generator

1. Place N flowers on an N×N grid satisfying all rules (one per row/column, no touching).
2. Grow colored regions outward from each flower to partition the grid into N connected regions.
3. Run a solver against the generated puzzle (regions only, flower positions hidden) to verify the solution is unique.
4. If not unique, regenerate.

Grid size by level: 1-2 → 4×4, 3-5 → 5×5, 6-9 → 6×6, 10-14 → 7×7, 15+ → 8×8 (the cap). Every level has exactly one pre-placed, locked flower regardless of size.

8×8 generation is verified fast: across levels 15-74 the slowest observed build was ~74ms, far under the 1-second budget, so no precomputation/caching was needed. `tests/progression-speed.test.js` guards this (fails if any 8×8 build in a 60-level sample takes ≥1000ms) and also locks in the exact size-per-level table above.

**Deterministic by level.** Every random choice in generation (flower placement, region growth, which solution flower is pre-placed) is drawn from a seeded PRNG (`js/rng.js`, mulberry32) seeded by the level number itself — never `Math.random`. Level N therefore looks exactly the same — same beds, same colors, same pre-placed flower — for every player, every time, every reload. `tests/determinism.test.js` builds each of a sample of levels twice and asserts the results are identical.

## Saving in-progress play

The current board (every cell's X/flower/red-X mark and lock state), remaining water drops, and the level's running score are saved to localStorage after every move, keyed by level number. Reloading mid-level restores exactly where the player left off. The saved board is cleared when the level is completed (solved) or explicitly restarted (Retry); a level never resumes stale progress after either of those.

## Rules bar

Above the board, three small cards each show a tiny 3×3 diagram (CSS/SVG) next to a short rule reminder, all text through i18n:

- **"1 flower per bed"** — a flower in the center cell; the top row and left column cells (same bed color) show X; the remaining cells are neutral.
- **"1 flower per row and column"** — a flower in the top-middle cell; X on the other two top-row cells and on the two cells below it in the middle column; the rest neutral.
- **"Flowers can't touch"** — a flower in the center cell; X on all 8 surrounding cells.

## Bed tracker

A row above the board shows one small icon per flower bed, colored to match that bed, in a fixed left-to-right order (by bed index). Once a bed has its correct flower, its icon shows a small flower; otherwise it stays a plain colored swatch.

## Feedback and scoring

- Planting a flower correctly earns 10 points: a floating "+10" pops up near that cell and fades out, and the score display updates immediately. The cell locks the instant it's correct (see Controls above), so it can never be re-earned within the same attempt — and as a belt-and-suspenders safeguard, each cell's points are tracked as "awarded" in the saved board state too, so even a hypothetical future bug that unlocked a cell couldn't double-award it.
- Score is tracked two ways: the current level's score (resets each attempt, saved/restored with the board so a reload mid-level doesn't lose it), and the running total across the whole game. The total only ever gains a level's points once — on that level's first-ever completion — so retrying or somehow replaying an already-completed level never inflates it (best time and star rating can still improve on a replay, just not the total score). While playing, the displayed total previews the current level's in-progress score on top of the real banked total; once won, it shows the real banked total exactly.
- Finishing a level with no mistakes shows a big animated "Perfect!"; finishing after at least one mistake shows "Done!" instead — either way the level's score earned is shown alongside it.

## Win screen rating

No fake "you beat N% of players" claims anywhere — that kind of stat only appears once it can be real (see Roadmap step 8). Instead, the win screen shows:

- **1-3 stars**, computed from mistakes made and time taken this level: 3 stars needs zero mistakes and finishing within `gridSize × 10` seconds; 2 stars needs at most one mistake and finishing within `gridSize × 20` seconds; otherwise 1 star. Stars pop in with a short staggered animation.
- **A rank title** tied 1:1 to the star count: 1 star → "Gardener" ("Садовник"), 2 stars → "Skilled gardener" ("Умелый садовник"), 3 stars → "Master gardener" ("Мастер-садовник").
- **Best time for the level**, persisted per level in localStorage and updated whenever a run beats it.

## Lives

- 3 lives per level, shown as water drops (💧-style, drawn in SVG) instead of hearts.
- A life (water drop) is lost when a flower is placed in a cell that breaks a rule or isn't part of the unique solution (see Mistake feedback above).

## Soft currency: seeds

- Earned through play, spent on hints (see Roadmap step 4).

## Flower collection

- Different flower types unlock as the player progresses through levels.
- The game starts with one flower type; more are added and become plantable as levels advance.

## Accessibility

- Every flower bed region must be distinguishable not only by color but also by a subtle pattern (dots, stripes, etc.) drawn in SVG/CSS.
- A settings toggle lets the player turn region patterns on/off — **off by default** (patterns are an accessibility aid, not the normal look).
- A "Reduce motion" setting disables ambient particles and the longer decorative animations (bloom overshoot, pollen sparkles, win-screen sway), and is also honored automatically from the OS-level `prefers-reduced-motion: reduce` media query.
- A "Vibrate on mistake" setting (on by default) triggers a short `navigator.vibrate` pulse on a wrong placement, where supported.

## Loading screen, main menu, and navigation

- The game opens on a CSS/SVG-only loading screen (ladybug mascot, the title "Клумба", a three-dot pulse indicator) that hands off to `platform.gameReady()` once i18n, settings, and saves are ready - in practice that's all synchronous today, so the screen leaves almost immediately with a short ~300ms fade and never delays the first frame; a 5s hang-protection timeout forces the same transition on its own if a future async init step (e.g. the real Yandex SDK in step 8) ever stalls. A small router (`js/router.js`) handles the switch between three sibling screens - loading, menu, game - by toggling `hidden`, no frameworks or build step involved.
- The main menu (`js/menu.js`) shows the title, subtitle, mascot, and three buttons: "Играть" / "Продолжить · Уровень N", "Как играть", and "Настройки" - the latter two just call the existing tutorial and settings popup rather than duplicating their logic. The Play button reads "Продолжить · Уровень N" only once the saved board for the current level actually holds a player move beyond the pre-placed starting flower (an X, a red X, or a flower the player planted - detected via the existing `awardedCells` safeguard, since the pre-placed flower itself is never added there); with no save, an empty board, or only the starting flower, it reads plain "Играть". Either way, pressing it runs the tutorial first on first launch (while it isn't completed yet) and enters the game right after; once the tutorial is done, it goes straight to the game. A fourth button is a disabled, non-interactive daily-challenge teaser (lock icon + "Откроется на уровне 15") that hides itself from level 15 onward, so the menu never promises a feature that doesn't exist yet (that's roadmap step 7).
- The back button now performs a real transition back to the menu, replacing the old `platform.navigateToMenu` stub (screen navigation isn't a platform/SDK concern, so it no longer lives in `platform.js`). The game's state is never torn down when leaving it, so the board, lives, and score are exactly where the player left them both on returning to the menu and on pressing "Продолжить" afterward - including across a page reload, since they were already being saved to localStorage.

## Visual style

- **Theme: "night garden".** A soft dark-green gradient background (no pure white or pure black anywhere in the palette). All colors, radii, shadows, and animation durations/easings are design tokens (CSS custom properties) defined once in `:root` in `css/style.css`, so the look can be re-themed from one place.
- **Bed colors:** 8 muted pastel tones (`--region-0`..`--region-7`), chosen to stay clearly distinguishable from each other against the dark background.
- **Tiles ("candy tile" look):** one uniform gap between every cell — ~6-8px on small boards, scaled down on bigger ones but never below ~3px (`gapForSize()` in `js/render.js`: 8px at size ≤4, 7px at 5, 6px at 6, 4.5px at 7, 3px at 8) — identical whether two neighboring cells share a bed or not; beds are told apart only by color (plus the optional pattern toggle). Cells use a large `border-radius: 24%` (scales automatically with cell size) for a soft, chunky look, plus more volume than a flat tile: a soft lighter top highlight, a ~3px darker lower edge, and a gentle drop shadow (`--tile-highlight`/`--tile-edge`/`--tile-shadow`) — still calm, no harsh contrast. Pressing/dragging a cell reduces that lower edge and shifts the tile down by the matching `--tile-press-shift`, then springs back. Verified an 8×8 board keeps ~44px cells on a 390×844 phone-portrait viewport, comfortably over the 36px minimum tap target.
- **Flowers:** a single reusable "rose spiral" SVG component (`flowerSvgFor(region)` in `js/render.js`) — three rings of pointed petals (6 outer, 5 middle, 4 inner), each ring rotated a bit further than the last, opening outer-to-inner with a small scale+rotate overshoot ("spiral unfurl"). On the board it fills ~78% of its cell (`.cell-mark`) so it reads at a glance even on an 8×8 board; the per-bed tracker icon and win-screen bloom follow the same ~75-78% fill convention at their own sizes. The flower's color is *generated from its bed's own hue* at draw time (`flowerPalette()`: same hue, pushed at least ~40 lightness points lighter or darker — whichever increases contrast against the bed's own lightness — and nudged a little further ring by ring, each stage independently clamped so no ring can ever collapse to pure black/white), not a separate hardcoded palette, so any new bed color automatically gets a flower that contrasts with it. The exact same component renders the flower everywhere one appears: the board, the per-bed tracker row, the tutorial, and a small decorative bloom on the win screen. Once the level is solved, every flower on the board still sways gently in place. X marks use a single dark-ink tone (`--mark-ink`) chosen to stay readable on every bed color; a red disc + bold X (`--mark-wrong`) marks a mistake.
- **Cell feel:** pressing a cell "sinks" it (see Tiles above) and springs back with a slight overshoot; dragging to mark a run of cells sinks each cell in turn as the pointer passes over it; X marks pop in with a short scale animation.
- No fake "fastest player"/leaderboard-percentage banners anywhere on the board or win screen (see Win screen rating below — that rule still holds).
- **Top bar:** back button (left, returns to the main menu) and a settings button (right) frame a centered pair of pills — level number above, score (with a small leaf icon) below — plus three glowing water-drop lives next to the settings button; a lost drop fades and pops exactly as before.
- **Rules bar:** the three rule cards show inline on levels 1-5; from level 6 on they collapse behind a small "?" button that opens them in a dismissible popup instead, keeping the board bigger on larger levels.
- **Settings popup:** patterns, reduce motion, and vibration toggles plus a "Replay tutorial" button, opened from the top-bar settings button.
- **Tutorial:** the dimming/backdrop uses the same dark-green scrim as the rest of the UI; the one interactive cell gets a soft glowing ring instead of a hard highlight; hints are shown in a speech bubble anchored to a small ladybug mascot (SVG) rather than a bare box.
- **Ambient particles:** a handful of slow-drifting pollen/firefly motes rendered as small glowing dots behind the UI (plain CSS animation on ~10 tiny absolutely-positioned elements — no canvas, no blur over large areas, so it stays cheap on weak phones). Disabled entirely under "Reduce motion" or `prefers-reduced-motion`.
- Calm, cozy tone — not stressful despite the lives mechanic.
- CSS/SVG graphics only; no image/bitmap assets.

## Roadmap

1. **Core**: grid, rules check, generator with uniqueness check, lives, win screen, next level, level number saved in localStorage.
2. Tutorial on the first level.
3. Main menu and loading screen.
4. Hints and soft currency.
5. Daily check-in: a 7-day streak row, a small seed reward on day 4, a big reward on day 7, tracking both "current streak" and "best streak".
6. Sounds and music with separate toggles.
7. Daily challenge (same puzzle for everyone, seeded by date), unlocked at level 15.
8. Yandex Games SDK integration: rewarded ads, saves, language detection, leaderboards — once real leaderboards exist, add a genuine "you beat N% of players" stat to the win screen (never fake/hardcoded).

## Status

- [x] Naming, theme, and accessibility decisions locked in (title "Клумба: цветочная головоломка", ladybug mascot, water-drop lives, seed currency, flower collection, pattern accessibility toggle).
- [x] Step 1: Core gameplay loop — grid/rules/solver/generator (unique-solution guaranteed), 3 water-drop lives, win screen, next level, level number saved via `platform.js`/localStorage, responsive square board (phone portrait through desktop), region color + pattern accessibility toggle. One flower type for now (collection system deferred to a later step). Verified by `tests/generator.test.js` (1000 checks, 0 failures) and by driving `index.html` in a real browser (tap cycle, conflict/life loss, fail+retry, win+next-level, resize/orientation).
- [x] Playtest fixes on the core loop: one solution flower is pre-placed and locked at the start of every level; wrong flower placements (rule-breaking or simply not part of the unique solution) now get a permanent red X — visually distinct from the plain "no flower" X — with a one-shot shake, and a matching water-drop pop/fade; confirmed the tap cycle never places a flower on a single tap; confirmed the patterns toggle is instant and its on/off state persists via localStorage. Re-verified with the Node test suite and a real-browser playthrough.
- [x] Second round of playtest fixes: levels are now fully deterministic by level number via a seeded PRNG (`js/rng.js`), verified identical across repeated builds by `tests/determinism.test.js`; in-progress board + lives now save to localStorage after every move and restore on reload, clearing on level completion or Retry; controls switched to single-tap-places-X / double-tap-(<300ms)-promotes-to-flower / single-tap-clears, with locked cells (pre-placed flower, red X) unaffected. Along the way, fixed a bug where a life-loss animation still in flight when Retry was clicked could later fire and incorrectly re-empty a drop that had already been reset to full. Verified by `tests/state.test.js`, `tests/determinism.test.js`, and a real-browser playthrough (double-tap timing, locked cells, save/restore across reload, fail→retry).
- [x] Third round of playtest fixes: press-and-drag now marks/clears a run of cells at once (bypassing the double-tap logic entirely, with `touch-action: none` on the board so it never scrolls or zooms); added the rules-bar (3 static rule cards with a 3×3 diagram each) and a per-bed tracker row above the board; added scoring (+10 floating popup per correct flower, running total + per-level score both saved to localStorage) and a "Perfect!"/"Done!" animated result depending on whether any mistakes were made; added an off-by-default Auto-X setting that marks a just-placed flower's row/column/bed/neighbors with a staggered appear animation. Verified by `tests/drag-score-autox.test.js` plus the full existing Node suite, and a real-browser playthrough of all five changes (including responsive sizing with the two new bars).
- [x] Fourth round of playtest fixes: removed Auto-X entirely (and its toggle) per feedback that marking should stay fully manual; level completion now fills every remaining empty cell with a white X in a staggered wave before the win screen appears; redrew all three rule-card diagrams to the exact requested layouts; grid-size progression changed to 1-2→4, 3-5→5, 6-9→6, 10-14→7, 15+→8, with 8×8 generation speed verified (and now regression-tested) well under 1 second; the win screen now shows a 1-3 star rating (mistakes + time based), a matching rank title (Gardener/Skilled gardener/Master gardener), and the level's best time — with no fake "beat N% of players" text anywhere. Roadmap updated with a Daily check-in step (after Hints) and a note to add a real leaderboard-based "beat N%" stat once the Yandex SDK step has leaderboards. Verified by `tests/progression-speed.test.js`, `tests/drag-score-win.test.js` (renamed/rewritten from the auto-X version), the rest of the Node suite, and a real-browser playthrough (rule-card pixel check, win-fill wave timing, stars/rank/best-time, Perfect! vs Done!, drag still works).
- [x] Fixed a score exploit: a correctly planted flower now locks immediately (exactly like the pre-placed one) instead of staying tappable/clearable, closing off the obvious "clear and replant" points farm; added an `awardedCells` safeguard (persisted with the board) so a given cell's points can never be counted twice in one attempt even if a cell were somehow unlocked again; and the running total score is now only ever credited with a level's points on that level's *first-ever* completion — persisted via `loadBestTime`/`saveBestTime` as the "already completed" signal — so reloading right after a win (or any other way of replaying an already-won level) can no longer re-add its score, though best time and star rating still update normally on a replay. Verified by the new `tests/score-exploit.test.js` plus the rest of the Node suite, and a real-browser check that a correct flower can't be tapped or dragged away.
- [x] Step 2: Tutorial — a hand-made, fixed 4x4 level (never generated/solved) teaches the five core rules one at a time on a dimmed board where only the relevant cells are interactive: double-tap to plant (with a pointing-hand animation), one flower per bed, one flower per row/column, flowers can't touch diagonally, and tap-to-mark with X. Each step requires the player to actually perform the action before advancing (no "next" button anywhere except "Got it!" on the final screen). Shown automatically only on first launch (tracked via `platform.saveTutorialDone`/`loadTutorialDone` in localStorage) and replayable anytime via a "Replay tutorial" button (now in the settings popup). All text via i18n (Russian + English). Verified with a real-browser (Playwright) run through all five steps, the final screen, persistence across reload, and replay.
- [x] Visual redesign ("night garden"): full theme pass before the main-menu step — see the Visual style and Accessibility sections above for the design tokens, bed/flower color system, cell press/drag feel, bloom/sparkle/sway animations, redesigned top bar (back/settings icon buttons, level+score pills, glowing drops), rules bar inline-vs-popup collapse at level 6, settings popup (patterns now off by default, reduce motion, vibration), ladybug-mascot tutorial bubble, and ambient particles. Patterns default flipped to off (`platform.loadPatternsEnabled`); added `platform.saveReduceMotionEnabled`/`loadReduceMotionEnabled`, `saveVibrationEnabled`/`loadVibrationEnabled`, `vibrate`, and a `navigateToMenu` stub for the back button (wired for real once Step 3 exists). Verified by the full Node test suite (unaffected, since it covers game logic rather than rendering) and a real-browser (Playwright) pass: default settings values, settings popup open/close and toggles, rules bar inline on level 1 vs. collapsed-with-popup on level 6 (including backdrop-dismiss), a full level solve showing per-bed flower colors/bloom/win-sway and the star/rank/best-time screen, and the restyled tutorial overlay with the mascot speech bubble.
- [x] Tile and flower visual tweaks: cells now read as separate raised tiles — a 4-6px gap that scales down a bit on bigger boards (`gapForSize()` in `js/render.js`) plus a light-top/dark-bottom bevel (`--tile-bevel`) that the existing press/sink state still overrides; the border between two different beds is drawn clearly thicker/darker (`applyBedBorder()`, `--bed-border-color`) than the plain gap between same-bed cells, so each bed still reads as one shape. Flowers were redrawn as a single reusable "tile flower" SVG component (`flowerSvgFor(region)`): 5 rounded-square petals rotated around a contrasting center circle, alternating between two shades of that bed's color (`--flower-N`/`--flower-N-b`); the bloom animation now opens the petals one after another (staggered `animation-delay` per petal) with a small overshoot, instead of scaling the whole icon at once. No fake "fastest player"/percentage banners were added anywhere. Verified by the full Node test suite (unaffected) and a real-browser (Playwright) pass: close-up screenshots of the tile bevel/bed-border contrast and the new petal flower, a full 8×8 level solve showing the staggered bloom and per-bed flower colors on the win screen, and a measured cell size of ~44px for an 8×8 board on a 390×844 phone-portrait viewport (comfortably over the 36px minimum tap target).
- [x] Field spacing simplified, and a standalone flower-style picker added: removed the thicker bed-boundary borders from the previous round (`applyBedBorder()`/`bedBorderSides()`/`--bed-border-color` all deleted) in favor of one uniform gap around every cell — beds are now told apart only by color, as originally specified; `gapForSize()` now returns ~3-4px instead of 4-6px, and `--tile-bevel` was softened (lower opacities, smaller offsets) so the board reads as calm and flat-soft rather than heavily raised; the press/sink animation is untouched. Separately, added `flower-styles.html` — a standalone dev-only page (not linked from `index.html`, loads none of `js/`) comparing 6 candidate flower designs (tulip, daisy, lotus, minimal flat icon, sprout, rose-spiral) side by side, each shown planted on a sample bed tile, looping its own distinct bloom animation on a tile, and alone on a dark background, to pick a direction before changing the in-game flower art. Verified by the full Node test suite (unaffected), a real-browser screenshot confirming the uniform gap/no borders/softer bevel, and a real-browser pass over `flower-styles.html` (all 6 cards and 18 SVGs render with zero console errors; confirmed via computed `transform` that a bloom-loop restart actually re-runs from a near-zero scale back up to scale 1, not just a static image).
- [x] "Candy tile" board + rose-spiral flower, dev tools folder: cells got a chunkier look — `border-radius: 24%` (scales with cell size), a ~6-8px uniform gap that scales down to never below ~3px on bigger boards (`gapForSize()`), and more bevel volume (soft top highlight, ~3px darker lower edge, gentle drop shadow via `--tile-highlight`/`--tile-edge`/`--tile-shadow`) while staying calm; pressing now reduces that lower edge and shifts the tile down by `--tile-press-shift` to match, then springs back. The in-game flower was replaced by the "rose spiral" design from the style picker (three rings of petals opening outer-to-inner with a scale+rotate overshoot); its color is now *generated from the bed's own hue* at draw time (`flowerPalette()` in `js/render.js`: same hue, pushed lighter or darker - whichever contrasts - and progressively further ring by ring) instead of a separate hardcoded palette, so the one `flowerSvgFor(region)` component automatically produces a contrasting flower for any bed color, and renders identically on the board, the bed tracker, the tutorial, and a new small decorative bloom on the win screen. The gentle sway at level-complete is unchanged. `flower-styles.html` moved to `dev/flower-styles.html`; `CLAUDE.md` now explicitly excludes `/dev` and `/tests` from the shippable build/archive. Verified by the full Node test suite (unaffected) and a real-browser (Playwright) pass: computed `border-radius`/`box-shadow`/gap values, a measured ~44px cell size for an 8×8 board on a 390×844 phone-portrait viewport, a full level solve showing the rose bloom/contrast-derived colors/sway and the new win-screen flower, and the same component rendering correctly in the tutorial.
- [x] Bigger, more visible flowers: the board flower now fills ~78% of its cell (`.cell-mark` 62%→78%), up from a size that read too small, especially on 8×8 boards; `flowerPalette()` was also strengthened and fixed — the lightness push away from the bed's own color grew from ~38 to ~42+ points, and every ring (outer/middle/inner) is now independently clamped, fixing a latent bug where the innermost ring could collapse to pure lightness 0 or 100 (pure black/white) for some bed hues. The bed tracker's icons grew from 22px to 36px squares (`border-radius` switched to the same `24%` convention as the board tiles) with their flower fill bumped from 70% to 75%; the compact short-viewport variant grew from 16px to 28px to match. The win-screen decorative flower grew from 56px to 68px. The tutorial needed no separate change since it reuses the same shared `.cell-mark`/`flowerSvgFor()` plumbing. Verified by the full Node test suite (unaffected) and a real-browser (Playwright) pass: measured fill ratios (board 0.78, tutorial 0.78), bed-icon computed size (36px, `border-radius: 24%`), win-flower computed size (68px), a Node-side dump of the derived HSL palette for all 8 beds confirming no value clips to 0% or 100% lightness, and screenshots of the bed tracker, an 8×8 board, the win screen, and the tutorial all showing clearly larger, higher-contrast flowers.
- [x] Step 3: Main menu and loading screen - added a CSS/SVG-only loading screen (ladybug mascot, title, pulse indicator) that fades out in ~300ms via a new `platform.gameReady()` entry point, with a 5s hang-protection fallback; a new main menu (`js/menu.js`) with "Играть"/"Продолжить · Уровень N" (switching based on whether the saved board has an actual player move beyond the pre-placed flower), "Как играть" and "Настройки" (both reusing the existing tutorial/settings popup, not duplicated), and a disabled daily-challenge teaser that hides itself from level 15 on; a small screen router (`js/router.js`) switches between loading/menu/game; the back button now does a real menu transition instead of the old `platform.navigateToMenu` stub (removed, since navigation isn't a platform/SDK concern); the tutorial no longer auto-shows on page load - pressing "Играть" on first launch runs it first, then enters the game (`tutorial.start()` now takes an optional onComplete callback). See the Loading screen/main menu/navigation section above. Verified by `tests/menu-router.test.js` (router screen-switching, fade timing, hang-protection, the four "Играть"/"Продолжить" progress cases, the daily-lock level boundary, and the first-launch tutorial gate) plus the rest of the Node suite, and a real-browser (Playwright) pass: loading → menu → tutorial-via-Play → game → back → "Продолжить", a page reload on the menu keeping the saved board/score/"Продолжить" label, "Как играть" both before and after completion, settings opened from the menu, portrait (390×844) and landscape screenshots, zero console errors, and a measured ~300-370ms loading fade. That pass also caught and fixed a real bug: the board was being sized while `#gameScreen` was still `hidden` (so `boardWrap.clientWidth/Height` read 0), leaving it invisible the first time a player entered the game - `enterGame()` now re-renders once the screen is shown.
- [ ] Step 4: Hints and soft currency
- [ ] Step 5: Daily check-in
- [ ] Step 6: Sounds and music
- [ ] Step 7: Daily challenge
- [ ] Step 8: Yandex Games SDK integration

Playable at `index.html` (open directly in a browser, no server/build step needed).
