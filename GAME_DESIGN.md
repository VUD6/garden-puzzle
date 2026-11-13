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

Tap/click cycles a cell through three states:

1. First tap → X mark ("no flower here").
2. Second tap → flower.
3. Third tap → clear (empty).

Works with mouse and touch.

## Level generator

1. Place N flowers on an N×N grid satisfying all rules (one per row/column, no touching).
2. Grow colored regions outward from each flower to partition the grid into N connected regions.
3. Run a solver against the generated puzzle (regions only, flower positions hidden) to verify the solution is unique.
4. If not unique, regenerate.

Grid size grows with level progression, from 4×4 up to 8×8.

## Lives

- 3 lives per level, shown as water drops (💧-style, drawn in SVG) instead of hearts.
- A life (water drop) is lost when a flower is placed in a cell that violates the rules (wrong row/column/region conflict or touching another flower).

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
- [ ] Step 1: Core gameplay loop
- [ ] Step 2: Tutorial
- [ ] Step 3: Main menu and loading screen
- [ ] Step 4: Hints and soft currency
- [ ] Step 5: Sounds and music
- [ ] Step 6: Daily challenge
- [ ] Step 7: Yandex Games SDK integration

No game code implemented yet — documentation only.
