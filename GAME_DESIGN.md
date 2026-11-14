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
- A settings toggle lets the player turn region patterns on/off.

## Visual style

- Soft pastel colors, rounded cells, smooth animations, one consistent style across all graphics.
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
- [ ] Step 2: Tutorial
- [ ] Step 3: Main menu and loading screen
- [ ] Step 4: Hints and soft currency
- [ ] Step 5: Daily check-in
- [ ] Step 6: Sounds and music
- [ ] Step 7: Daily challenge
- [ ] Step 8: Yandex Games SDK integration

Playable at `index.html` (open directly in a browser, no server/build step needed).
