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
- Single tap on a flower → clears back to empty, immediately.
- The pre-placed flower and any red X marks are locked and can't be changed.

A flower always needs a deliberate double tap; a single tap never plants one directly. Works the same with mouse and touch, and `touch-action: manipulation` plus a non-zoomable viewport keep a fast double-tap from triggering the browser's zoom gesture on phones.

## Starting flower

At the start of every level, one flower from the solution is already planted and locked — the player always has a confirmed starting point and can't change or remove it.

## Mistake feedback

If the player plants a flower in a cell that breaks a rule or isn't part of the level's one true solution, that cell gets a red X (visually distinct from the plain white "no flower" X) with a short shake, one water drop pops/fades away, and the cell locks — the red X stays as a permanent marker that no flower belongs there.

## Level generator

1. Place N flowers on an N×N grid satisfying all rules (one per row/column, no touching).
2. Grow colored regions outward from each flower to partition the grid into N connected regions.
3. Run a solver against the generated puzzle (regions only, flower positions hidden) to verify the solution is unique.
4. If not unique, regenerate.

Grid size grows with level progression, from 4×4 up to 8×8.

**Deterministic by level.** Every random choice in generation (flower placement, region growth, which solution flower is pre-placed) is drawn from a seeded PRNG (`js/rng.js`, mulberry32) seeded by the level number itself — never `Math.random`. Level N therefore looks exactly the same — same beds, same colors, same pre-placed flower — for every player, every time, every reload. `tests/determinism.test.js` builds each of a sample of levels twice and asserts the results are identical.

## Saving in-progress play

The current board (every cell's X/flower/red-X mark and lock state) and remaining water drops are saved to localStorage after every move, keyed by level number. Reloading mid-level restores exactly where the player left off. The saved board is cleared when the level is completed (solved) or explicitly restarted (Retry); a level never resumes stale progress after either of those.

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
5. Sounds and music with separate toggles.
6. Daily challenge (same puzzle for everyone, seeded by date), unlocked at level 15.
7. Yandex Games SDK integration: rewarded ads, saves, language detection.

## Status

- [x] Naming, theme, and accessibility decisions locked in (title "Клумба: цветочная головоломка", ladybug mascot, water-drop lives, seed currency, flower collection, pattern accessibility toggle).
- [x] Step 1: Core gameplay loop — grid/rules/solver/generator (unique-solution guaranteed), 3 water-drop lives, win screen, next level, level number saved via `platform.js`/localStorage, responsive square board (phone portrait through desktop), region color + pattern accessibility toggle. One flower type for now (collection system deferred to a later step). Verified by `tests/generator.test.js` (1000 checks, 0 failures) and by driving `index.html` in a real browser (tap cycle, conflict/life loss, fail+retry, win+next-level, resize/orientation).
- [x] Playtest fixes on the core loop: one solution flower is pre-placed and locked at the start of every level; wrong flower placements (rule-breaking or simply not part of the unique solution) now get a permanent red X — visually distinct from the plain "no flower" X — with a one-shot shake, and a matching water-drop pop/fade; confirmed the tap cycle never places a flower on a single tap; confirmed the patterns toggle is instant and its on/off state persists via localStorage. Re-verified with the Node test suite and a real-browser playthrough.
- [x] Second round of playtest fixes: levels are now fully deterministic by level number via a seeded PRNG (`js/rng.js`), verified identical across repeated builds by `tests/determinism.test.js`; in-progress board + lives now save to localStorage after every move and restore on reload, clearing on level completion or Retry; controls switched to single-tap-places-X / double-tap-(<300ms)-promotes-to-flower / single-tap-clears, with locked cells (pre-placed flower, red X) unaffected. Along the way, fixed a bug where a life-loss animation still in flight when Retry was clicked could later fire and incorrectly re-empty a drop that had already been reset to full. Verified by `tests/state.test.js`, `tests/determinism.test.js`, and a real-browser playthrough (double-tap timing, locked cells, save/restore across reload, fail→retry).
- [ ] Step 2: Tutorial
- [ ] Step 3: Main menu and loading screen
- [ ] Step 4: Hints and soft currency
- [ ] Step 5: Sounds and music
- [ ] Step 6: Daily challenge
- [ ] Step 7: Yandex Games SDK integration

Playable at `index.html` (open directly in a browser, no server/build step needed).
