// Theme registry: purely visual presentation data (CSS token overrides, bed
// colors, piece art, piece-name i18n keys). Never touches rng.js/generator.js/
// solver.js/state.js - switching themes must never change what level N looks
// like board-wise (same beds, same solution), only how it is drawn.
(function (root) {
  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hsl(h, s, l) {
    return 'hsl(' + h.toFixed(0) + ' ' + clamp(s, 0, 100).toFixed(0) + '% ' + clamp(l, 0, 100).toFixed(0) + '%)';
  }

  // Three shades, all pushed well away from the given color's own lightness
  // (lighter base -> darker shades, darker base -> lighter shades) so a piece
  // drawn in these shades always contrasts against its own bed tile, then
  // nudged a little further shade by shade for some depth - each stage
  // clamped independently so no shade can ever collapse to pure black/white.
  // Shared by every theme's piece art, so a new bed color automatically gets
  // a piece that contrasts with it without a separate hardcoded palette.
  function contrastShades(hex) {
    const base = hexToHsl(hex);
    const sign = base.l > 52 ? -1 : 1;
    const l0 = clamp(base.l + sign * 42, 12, 90);
    const s0 = clamp(base.s + 20, 35, 95);
    const step = sign * 7;
    return {
      outer: hsl(base.h, s0, l0),
      middle: hsl(base.h, clamp(s0 - 10, 30, 95), clamp(l0 + step, 10, 92)),
      inner: hsl(base.h, clamp(s0 - 18, 25, 95), clamp(l0 + step * 2, 8, 94)),
    };
  }

  // --- Garden piece art: "rose spiral", unchanged from the original design -
  // three rings of petals, each smaller and rotated a bit further than the
  // last, opening outer-to-inner. ---
  const ROSE_RINGS = [
    { count: 6, angleOffset: 0, delayBase: 0, path: 'M12 5C13.8 7 14.2 9.4 12 12C9.8 9.4 10.2 7 12 5Z', shade: 'outer' },
    { count: 5, angleOffset: 30, delayBase: 110, path: 'M12 7C13.3 8.4 13.6 10 12 12C10.4 10 10.7 8.4 12 7Z', shade: 'middle' },
    { count: 4, angleOffset: 55, delayBase: 210, path: 'M12 9C12.9 9.8 13.1 10.6 12 12C10.9 10.6 11.1 9.8 12 9Z', shade: 'inner' },
  ];
  const RING_DELAY_STEP_MS = 20;

  function flowerArt(hex) {
    const shades = contrastShades(hex);
    let petals = '';
    ROSE_RINGS.forEach(function (ring) {
      for (let i = 0; i < ring.count; i++) {
        const angle = ring.angleOffset + (360 / ring.count) * i;
        const delay = ring.delayBase + i * RING_DELAY_STEP_MS;
        petals +=
          '<g transform="rotate(' + angle + ' 12 12)">' +
          '<path class="piece-part" style="animation-delay:' + delay + 'ms" fill="' + shades[ring.shade] + '" d="' + ring.path + '"/>' +
          '</g>';
      }
    });
    return '<svg viewBox="0 0 24 24">' + petals + '<circle cx="12" cy="12" r="1.3" fill="var(--flower-center)"/></svg>';
  }

  // --- Winter piece art: a simple gingerbread person, built from basic
  // shapes (not one intricate path) so it stays legible even on an 8x8
  // board's small cells. Shades reuse the exact same contrastShades() above
  // as the flower does: outer for the cookie body, middle for an icing belt
  // and cuffs, inner for the face/buttons - so any bed color automatically
  // gets a gingerbread that contrasts with it, just like the flower. ---
  const GINGERBREAD_PARTS = [
    { tag: 'circle', shade: 'outer', delay: 0, outline: true, attrs: { cx: 12, cy: 5.6, r: 2.8 } },
    { tag: 'rect', shade: 'outer', delay: 10, outline: true, attrs: { x: 8.4, y: 8.6, width: 7.2, height: 8, rx: 3 } },
    { tag: 'rect', shade: 'outer', delay: 20, outline: true, attrs: { x: 3.6, y: 9.8, width: 5, height: 2.8, rx: 1.4, transform: 'rotate(-28 6.1 11.2)' } },
    { tag: 'rect', shade: 'outer', delay: 20, outline: true, attrs: { x: 15.4, y: 9.8, width: 5, height: 2.8, rx: 1.4, transform: 'rotate(28 17.9 11.2)' } },
    { tag: 'rect', shade: 'outer', delay: 30, outline: true, attrs: { x: 7.8, y: 16, width: 3, height: 6, rx: 1.5, transform: 'rotate(14 9.3 19)' } },
    { tag: 'rect', shade: 'outer', delay: 30, outline: true, attrs: { x: 13.2, y: 16, width: 3, height: 6, rx: 1.5, transform: 'rotate(-14 14.7 19)' } },
    { tag: 'rect', shade: 'middle', delay: 70, attrs: { x: 8.4, y: 11.2, width: 7.2, height: 1.5 } },
    { tag: 'circle', shade: 'inner', delay: 90, attrs: { cx: 10.9, cy: 5.2, r: 0.9 } },
    { tag: 'circle', shade: 'inner', delay: 90, attrs: { cx: 13.1, cy: 5.2, r: 0.9 } },
    { tag: 'circle', shade: 'inner', delay: 110, attrs: { cx: 12, cy: 9.6, r: 0.9 } },
    { tag: 'circle', shade: 'inner', delay: 120, attrs: { cx: 12, cy: 14.3, r: 0.9 } },
  ];

  function attrsToString(attrs) {
    return Object.keys(attrs)
      .map(function (key) { return key + '="' + attrs[key] + '"'; })
      .join(' ');
  }

  // Body/limb pieces also get a thin "icing" outline stroke (the inner
  // shade) so the silhouette reads as a piped cookie rather than a flat
  // monochrome pictogram.
  function gingerbreadArt(hex) {
    const shades = contrastShades(hex);
    let parts = '';
    GINGERBREAD_PARTS.forEach(function (part) {
      const outline = part.outline ? ' stroke="' + shades.inner + '" stroke-width="0.4"' : '';
      parts +=
        '<' + part.tag + ' class="piece-part" style="animation-delay:' + part.delay + 'ms" fill="' +
        shades[part.shade] + '"' + outline + ' ' + attrsToString(part.attrs) + '/>';
    });
    parts +=
      '<path class="piece-part" style="animation-delay:110ms" stroke="' + shades.inner +
      '" stroke-width="0.8" stroke-linecap="round" fill="none" d="M10.4 7 Q12 8.1 13.6 7"/>';
    return '<svg viewBox="0 0 24 24">' + parts + '</svg>';
  }

  // Must stay in sync with the garden :root defaults in css/style.css
  // (--region-0..7) - the garden theme applies no overrides, it just uses
  // those defaults as-is, so this array has to match them exactly.
  const GARDEN_BED_COLORS = ['#c97b84', '#6f9bc4', '#cdb15a', '#6fb08a', '#a888c9', '#cc8c5c', '#5cb3a8', '#c47bb0'];

  // 8 candy tones: mint, strawberry, lemon, grape, blueberry, orange sherbet,
  // lime, bubblegum - spread across the hue wheel so they stay distinguishable
  // from each other (the accessibility pattern overlay is theme-independent
  // and keeps working on top of either set).
  const WINTER_BED_COLORS = ['#7fd8b9', '#6e8fd6', '#f0d868', '#a8d86a', '#a480cf', '#f2a868', '#e8637a', '#e26fc2'];

  function tokensForBedColors(colors) {
    const tokens = {};
    colors.forEach(function (color, i) { tokens['--region-' + i] = color; });
    return tokens;
  }

  const WINTER_TOKENS = Object.assign(tokensForBedColors(WINTER_BED_COLORS), {
    '--bg-top': '#0e1b33',
    // Candy-cane rim: a diagonal red/off-white stripe (never pure #fff, per
    // the project's no-pure-white-or-black palette rule).
    '--board-frame-bg': 'repeating-linear-gradient(45deg, #b8413f 0px 10px, #f4f1ea 10px 20px)',
    // "Ice" tile: slightly translucent (the sheen layer), a brighter top
    // highlight, and a cool blue-grey lower edge instead of black - same
    // geometry/press behavior as the garden tile, just re-colored.
    '--tile-highlight': 'inset 0 2px 0 rgba(244, 241, 234, 0.4)',
    '--tile-edge': 'inset 0 -3px 0 rgba(70, 95, 130, 0.35)',
    '--tile-edge-pressed': 'inset 0 -1px 0 rgba(70, 95, 130, 0.22)',
    '--tile-shadow': '0 2px 4px rgba(10, 20, 40, 0.28)',
    '--tile-shadow-pressed': '0 1px 2px rgba(10, 20, 40, 0.2)',
    '--tile-sheen': 'inset 0 0 0 100px rgba(244, 241, 234, 0.12)',
    // Ambient motes (snow) and the plant/claim sparkle reuse the same pollen
    // token, just re-colored to an off-white.
    '--pollen-color': '#eef2f7',
  });

  const THEMES = {
    garden: {
      id: 'garden',
      pieceNameKey: 'pieceNameFlower',
      bedColors: GARDEN_BED_COLORS,
      pieceArt: flowerArt,
      // The night-garden look already IS the :root default - nothing to
      // override here, which is what keeps "garden theme: exactly today's
      // look" true for free.
      tokens: {},
    },
    winter: {
      id: 'winter',
      pieceNameKey: 'pieceNameGingerbread',
      bedColors: WINTER_BED_COLORS,
      pieceArt: gingerbreadArt,
      tokens: WINTER_TOKENS,
    },
  };

  // Changing this one constant switches the game's default theme back to
  // 'garden' - nothing else needs to change.
  const DEFAULT_THEME_ID = 'winter';

  // Every token name any theme ever overrides, so applyTheme() can clear a
  // previous theme's inline overrides before applying the next one's -
  // otherwise switching winter -> garden would leave stale winter values
  // shadowing the (correct, unmodified) garden :root defaults.
  const ALL_TOKEN_NAMES = (function () {
    const names = new Set();
    Object.keys(THEMES).forEach(function (id) {
      Object.keys(THEMES[id].tokens).forEach(function (name) { names.add(name); });
    });
    return Array.from(names);
  })();

  let currentId = DEFAULT_THEME_ID;

  // Resolves id against the registry (falling back to the default for
  // anything unknown/missing/corrupted), applies it as the active theme, and
  // - in a browser - sets the data-theme attribute plus the token overrides
  // as inline styles on the root element. Returns the resolved id so callers
  // always know what actually ended up active.
  function applyTheme(id) {
    const resolved = THEMES[id] ? id : DEFAULT_THEME_ID;
    currentId = resolved;

    if (typeof document !== 'undefined') {
      const rootEl = document.documentElement;
      rootEl.dataset.theme = resolved;
      ALL_TOKEN_NAMES.forEach(function (name) { rootEl.style.removeProperty(name); });
      const tokens = THEMES[resolved].tokens;
      Object.keys(tokens).forEach(function (name) { rootEl.style.setProperty(name, tokens[name]); });
    }

    return resolved;
  }

  function getTheme(id) {
    return THEMES[id] || THEMES[DEFAULT_THEME_ID];
  }

  function getCurrentTheme() {
    return THEMES[currentId];
  }

  const Themes = {
    DEFAULT_THEME_ID,
    THEMES,
    applyTheme,
    getTheme,
    getCurrentTheme,
    contrastShades,
  };

  root.Garden = root.Garden || {};
  root.Garden.themes = Themes;
})(typeof window !== 'undefined' ? window : globalThis);
