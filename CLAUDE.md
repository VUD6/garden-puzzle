# CLAUDE.md — Project Rules

Project: "Garden" — a browser logic puzzle game for Yandex Games.

## Tech constraints
- Plain HTML5, CSS, JavaScript only. No bundlers, no build step, no external dependencies/libraries.
- `index.html` must be in the project root and be directly openable/playable.
- Total build size must stay under 100 MB (Yandex Games limit).

## Architecture
- Keep **game logic** (grid, rules, generator, solver, state) separate from **platform code** (ads, saves, leaderboards).
- Platform code lives in a single module (e.g. `platform.js`) with stub functions for now (save/load, show ad, etc.). It will later wrap the Yandex Games SDK without changing call sites elsewhere.
- All user-facing text goes through a simple i18n module (Russian + English). No hardcoded UI strings in game logic or markup.

## Yandex Games constraints
- Sound must stop/mute when the page loses focus (visibility change / blur).
- Layout must adapt to window resize and screen orientation change (portrait/landscape).
- Progress must be saved (via the platform save module; localStorage as the stub backend for now).
- Ads only through the Yandex SDK (via the platform module) — never ad-hoc.
- No external links (no navigating away from the game).

## Input
- Must work with both mouse and touch.
- Must work on phone (portrait) and desktop, responsive at all sizes in between.

## Process
- Work in small steps.
- After each working step: update `GAME_DESIGN.md` (status section) and make a git commit.
