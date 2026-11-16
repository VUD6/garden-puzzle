// Theme registry: purely visual presentation data (CSS token overrides, bed
// colors, piece art, mascot icon, i18n keys). Never touches
// rng.js/generator.js/solver.js/state.js - switching themes must never
// change what level N looks like board-wise (same beds, same solution),
// only how it is drawn.
(function (root) {
  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function hexToHsl(hex) {
    const [r8, g8, b8] = hexToRgb(hex);
    const r = r8 / 255;
    const g = g8 / 255;
    const b = b8 / 255;
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

  // Perceptual-ish RGB distance ("redmean" approximation) - cheap, no color-
  // space conversion needed, good enough to catch two bed colors that read
  // as "basically the same" to the eye. Used by tests/themes.test.js to
  // guard the winter palette's distinguishability.
  function colorDistance(hexA, hexB) {
    const [r1, g1, b1] = hexToRgb(hexA);
    const [r2, g2, b2] = hexToRgb(hexB);
    const rMean = (r1 + r2) / 2;
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
  }

  function srgbChannelToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(srgbChannelToLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // WCAG-style contrast ratio (1 to 21). Used both to pick the winter
  // palette's readable tones and by tests/themes.test.js to guard that the
  // gingerbread's body/outline stay legible against every winter bed color.
  function contrastRatio(hexA, hexB) {
    const l1 = relativeLuminance(hexA);
    const l2 = relativeLuminance(hexB);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Three shades, all pushed well away from the given color's own lightness
  // (lighter base -> darker shades, darker base -> lighter shades) so a piece
  // drawn in these shades always contrasts against its own bed tile, then
  // nudged a little further shade by shade for some depth - each stage
  // clamped independently so no shade can ever collapse to pure black/white.
  // Used by the garden theme's flower (the winter gingerbread uses a fixed
  // palette instead - see GINGERBREAD_BODY/GINGERBREAD_OUTLINE below).
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

  // --- Winter piece art: a gingerbread person with a FIXED warm-brown body
  // and cream icing (not hue-derived like the flower) - a fixed palette
  // reads reliably on every one of the 8 winter bed colors, including the
  // lighter yellow/orange ones, which tests/themes.test.js verifies via
  // contrastRatio(). A few icing details (bow, buttons, smile) keep it
  // readable as a face/figure rather than a flat blob. ---
  const GINGERBREAD_BODY = '#4f2f18';
  const GINGERBREAD_OUTLINE = '#fbf2e4';
  const GINGERBREAD_BOW = '#c0433f';

  const GINGERBREAD_PARTS = [
    { tag: 'circle', fill: 'body', delay: 0, outline: true, attrs: { cx: 12, cy: 5.6, r: 2.8 } },
    { tag: 'rect', fill: 'body', delay: 10, outline: true, attrs: { x: 8.4, y: 8.6, width: 7.2, height: 8, rx: 3 } },
    { tag: 'rect', fill: 'body', delay: 20, outline: true, attrs: { x: 3.6, y: 9.8, width: 5, height: 2.8, rx: 1.4, transform: 'rotate(-28 6.1 11.2)' } },
    { tag: 'rect', fill: 'body', delay: 20, outline: true, attrs: { x: 15.4, y: 9.8, width: 5, height: 2.8, rx: 1.4, transform: 'rotate(28 17.9 11.2)' } },
    { tag: 'rect', fill: 'body', delay: 30, outline: true, attrs: { x: 7.8, y: 16, width: 3, height: 6, rx: 1.5, transform: 'rotate(14 9.3 19)' } },
    { tag: 'rect', fill: 'body', delay: 30, outline: true, attrs: { x: 13.2, y: 16, width: 3, height: 6, rx: 1.5, transform: 'rotate(-14 14.7 19)' } },
    { tag: 'path', fill: 'bow', delay: 70, attrs: { d: 'M10.5 8.5 L12 9.9 L10.5 10.7 Z' } },
    { tag: 'path', fill: 'bow', delay: 70, attrs: { d: 'M13.5 8.5 L12 9.9 L13.5 10.7 Z' } },
    { tag: 'circle', fill: 'bow', delay: 75, attrs: { cx: 12, cy: 9.9, r: 0.55 } },
    { tag: 'circle', fill: 'outline', delay: 90, attrs: { cx: 10.9, cy: 5.2, r: 0.9 } },
    { tag: 'circle', fill: 'outline', delay: 90, attrs: { cx: 13.1, cy: 5.2, r: 0.9 } },
    { tag: 'circle', fill: 'outline', delay: 100, attrs: { cx: 12, cy: 12.5, r: 0.9 } },
    { tag: 'circle', fill: 'outline', delay: 110, attrs: { cx: 12, cy: 14.8, r: 0.9 } },
  ];

  function attrsToString(attrs) {
    return Object.keys(attrs)
      .map(function (key) { return key + '="' + attrs[key] + '"'; })
      .join(' ');
  }

  const GINGERBREAD_FILL_BY_KEY = { body: GINGERBREAD_BODY, bow: GINGERBREAD_BOW, outline: GINGERBREAD_OUTLINE };

  // hex is accepted for API parity with flowerArt(hex)/pieceArt(hex) but
  // unused - the gingerbread's palette is intentionally fixed so it reads
  // the same, reliably contrasting figure on every bed color.
  function gingerbreadArt(hex) { // eslint-disable-line no-unused-vars
    let parts = '';
    GINGERBREAD_PARTS.forEach(function (part) {
      const outline = part.outline ? ' stroke="' + GINGERBREAD_OUTLINE + '" stroke-width="0.4"' : '';
      parts +=
        '<' + part.tag + ' class="piece-part" style="animation-delay:' + part.delay + 'ms" fill="' +
        GINGERBREAD_FILL_BY_KEY[part.fill] + '"' + outline + ' ' + attrsToString(part.attrs) + '/>';
    });
    parts +=
      '<path class="piece-part" style="animation-delay:120ms" stroke="' + GINGERBREAD_OUTLINE +
      '" stroke-width="0.8" stroke-linecap="round" fill="none" d="M10.4 7 Q12 8.1 13.6 7"/>';
    return '<svg viewBox="0 0 24 24">' + parts + '</svg>';
  }

  // --- Shared mascot: a ladybug, optionally wearing a small Santa hat
  // overlay. One component used by the loading screen, menu, and tutorial
  // bubble. ---
  const LADYBUG_BODY_SVG =
    '<ellipse cx="24" cy="24" rx="18" ry="14" fill="#e0544f"/>' +
    '<line x1="24" y1="11" x2="24" y2="37" stroke="#2a1f1c" stroke-width="2"/>' +
    '<circle cx="16" cy="18" r="3" fill="#2a1f1c"/>' +
    '<circle cx="32" cy="18" r="3" fill="#2a1f1c"/>' +
    '<circle cx="16" cy="29" r="3" fill="#2a1f1c"/>' +
    '<circle cx="32" cy="29" r="3" fill="#2a1f1c"/>' +
    '<circle cx="24" cy="24" r="3" fill="#2a1f1c"/>' +
    '<circle cx="24" cy="10" r="9" fill="#2a1f1c"/>' +
    '<circle cx="20" cy="8" r="1.6" fill="#fdf6ee"/>' +
    '<circle cx="28" cy="8" r="1.6" fill="#fdf6ee"/>' +
    '<path d="M16 2 Q12 -2 10 2" stroke="#2a1f1c" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M32 2 Q36 -2 38 2" stroke="#2a1f1c" stroke-width="1.5" fill="none" stroke-linecap="round"/>';

  // Kept entirely within y >= 0 (the shared 0 0 48 40 viewBox) so it's never
  // clipped, and reused unscaled across every mascot slot.
  const SANTA_HAT_SVG =
    '<ellipse cx="22" cy="4.6" rx="10" ry="2.6" fill="#fbf2e4"/>' +
    '<path d="M15 4.2 Q21 0.3 31 3.6 Q25 1.8 18 4.6 Z" fill="#c0433f"/>' +
    '<circle cx="30.5" cy="3.3" r="2.3" fill="#fbf2e4"/>';

  function mascotSvg(withHat) {
    return '<svg viewBox="0 0 48 40">' + LADYBUG_BODY_SVG + (withHat ? SANTA_HAT_SVG : '') + '</svg>';
  }

  // Must stay in sync with the garden :root defaults in css/style.css
  // (--region-0..7) - the garden theme applies no overrides, it just uses
  // those defaults as-is, so this array has to match them exactly.
  const GARDEN_BED_COLORS = ['#c97b84', '#6f9bc4', '#cdb15a', '#6fb08a', '#a888c9', '#cc8c5c', '#5cb3a8', '#c47bb0'];

  // 8 candy tones (mint, strawberry, lemon, grape, blueberry, orange
  // sherbet, lime, bubblegum), tuned (via tests/themes.test.js's color-
  // distance/contrast checks) to stay clearly distinguishable from each
  // other and from the light winter background, with medium
  // lightness/saturation rather than pale pastels so they still pop on a
  // light page.
  const WINTER_BED_COLORS = ['#4fb892', '#e24b64', '#e8c23a', '#8a5fc2', '#4f7fd1', '#e8863f', '#8cc43f', '#c94a9e'];

  function tokensForBedColors(colors) {
    const tokens = {};
    colors.forEach(function (color, i) { tokens['--region-' + i] = color; });
    return tokens;
  }

  const WINTER_TOKENS = Object.assign(tokensForBedColors(WINTER_BED_COLORS), {
    // Warm cream-to-pale-pink vertical gradient - no pure white anywhere.
    '--bg-top': '#fdf0ea',
    '--bg-bottom': '#f7e3d0',
    '--ink': '#4a3220',
    '--ink-soft': '#8a7260',
    '--panel': '#fff8f0',
    '--panel-soft': '#f6e9d8',
    '--panel-border': '#e6d2b8',
    '--mark-ink': '#4a3220',
    '--drop-empty': '#9c7f5e',
    '--overlay-scrim': 'rgba(74, 50, 34, 0.32)',
    // A cozier, slightly deeper pine green than garden's accent, chosen so
    // "Done!" text (--result-done via --accent) still clears a 3:1 contrast
    // ratio against the light panel - see tests/themes.test.js.
    '--accent': '#3e8f57',
    '--accent-ink': '#0d1f14',
    '--accent-glow': 'rgba(62, 143, 87, 0.5)',
    // Candy-cane rim: a diagonal red/off-white stripe (never pure #fff, per
    // the project's no-pure-white-or-black palette rule).
    '--board-frame-bg': 'repeating-linear-gradient(45deg, #b8413f 0px 10px, #fbf2e4 10px 20px)',
    // "Icy-candy" tile: a gentle highlight, a cool blue-grey lower edge, and
    // a light translucent sheen - same geometry/press behavior as the
    // garden tile, just re-colored for the light page.
    '--tile-highlight': 'inset 0 2px 0 rgba(255, 250, 240, 0.45)',
    '--tile-edge': 'inset 0 -3px 0 rgba(90, 110, 140, 0.28)',
    '--tile-edge-pressed': 'inset 0 -1px 0 rgba(90, 110, 140, 0.18)',
    '--tile-shadow': '0 2px 4px rgba(60, 50, 30, 0.22)',
    '--tile-shadow-pressed': '0 1px 2px rgba(60, 50, 30, 0.16)',
    '--tile-sheen': 'inset 0 0 0 100px rgba(255, 250, 240, 0.14)',
    '--tile-lock-ring': 'inset 0 0 0 3px rgba(255, 250, 240, 0.55)',
    // Snow motes (ambient particles + plant/claim sparkle) - a near-white
    // mote needs its own visible blue-grey glow to read against a light
    // page, which is why that glow is its own token (see --particle-glow
    // below) rather than reusing --pollen-color for both fill and shadow.
    '--pollen-color': '#eef5ff',
    '--particle-glow': 'rgba(130, 160, 200, 0.55)',
    // Decoupled from --pollen-color so the check-in notification dot stays
    // readable sitting on a light panel (a near-white dot on a near-white
    // panel would otherwise vanish).
    '--notification-dot-color': '#3f6fc0',
    // Decoupled from --pollen-color for the same reason: "Perfect!" text
    // sits directly on the light panel.
    '--result-perfect-color': '#b8701a',
    // The plain gold star reads fine on a dark panel but washes out on a
    // light one; winter uses a darker gold fill with a strong dark-gold
    // outline so the star shape still pops even though the fill's own
    // contrast is modest (see tests/themes.test.js).
    '--star-filled-fill': '#d99a2b',
    '--star-filled-stroke': '#8a5a12',
  });

  const THEMES = {
    garden: {
      id: 'garden',
      pieceNameKey: 'pieceNameFlower',
      bedColors: GARDEN_BED_COLORS,
      pieceArt: flowerArt,
      wantsSantaHat: false,
      // The night-garden look already IS the :root default - nothing to
      // override here, which is what keeps "garden theme: exactly today's
      // look" true for free.
      tokens: {},
      helperIconSvg: noHelperIconSvg,
    },
    winter: {
      id: 'winter',
      pieceNameKey: 'pieceNameGingerbread',
      bedColors: WINTER_BED_COLORS,
      pieceArt: gingerbreadArt,
      wantsSantaHat: true,
      tokens: WINTER_TOKENS,
      // Exposed for tests/themes.test.js's contrast checks (the gingerbread
      // ignores its hex argument and always draws in these two colors).
      pieceColors: { body: GINGERBREAD_BODY, outline: GINGERBREAD_OUTLINE },
      // TODO(design): fill in real per-helper SVG art for winter; falls
      // back to render.js's plain-letter glyph until then.
      helperIconSvg: winterHelperIconSvg,
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

  // Default helper-icon hook: no themed art yet, so render.js's
  // helperIconFor() falls back to its plain-letter glyph. A theme can
  // override this with its own function(id) -> SVG string (or null for any
  // id it doesn't have art for yet) without touching render.js.
  function winterHelperIconSvg(id) {
    switch (id) {
      case 'finder':
        return '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="13.5" cy="13.5" r="8.6" fill="var(--winter-icon-snow)" stroke="var(--winter-icon-blue)" stroke-width="3"/><path d="m20 20 7 7" stroke="var(--winter-icon-blue)" stroke-width="4" stroke-linecap="round"/><path d="M14 8q0 5 5 6-5 0-5 5-1-5-6-5 5-1 6-6" fill="var(--winter-icon-gold)"/></svg>';
      case 'random':
        return '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="4" width="24" height="24" rx="6" transform="rotate(-12 16 16)" fill="var(--winter-icon-berry)"/><path d="M10 10h.1M22 10h.1M16 16h.1M10 22h.1M22 22h.1" stroke="var(--panel)" stroke-width="3.4" stroke-linecap="round"/></svg>';
      case 'snowman':
        return '<svg viewBox="0 0 32 32" aria-hidden="true"><g stroke="var(--winter-icon-pine)" stroke-width="1.8"><circle cx="16" cy="22" r="8" fill="var(--winter-icon-snow)"/><circle cx="16" cy="11" r="6" fill="var(--winter-icon-snow)"/></g><path d="M9 7h14M13 6V2h6v4" stroke="var(--winter-icon-pine)" stroke-width="2.6" stroke-linecap="round"/><path d="M10 16h12l-2 5" fill="none" stroke="var(--winter-icon-berry)" stroke-width="2.5"/><path d="M14 11h.1m4 0h.1" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/></svg>';
      default:
        return null;
    }
  }

  function noHelperIconSvg(id) { // eslint-disable-line no-unused-vars
    return null;
  }

  const Themes = {
    DEFAULT_THEME_ID,
    THEMES,
    applyTheme,
    getTheme,
    getCurrentTheme,
    contrastShades,
    colorDistance,
    contrastRatio,
    mascotSvg,
  };

  root.Garden = root.Garden || {};
  root.Garden.themes = Themes;
})(typeof window !== 'undefined' ? window : globalThis);
