// Plain Node script, no test framework/dependency. Run with: node tests/index-html-version.test.js
// Covers the cache-busting fix for stale JS on phones (tools/stamp-version.ps1):
// every LOCAL <link rel="stylesheet" href="..."> and <script src="..."> tag
// in index.html must carry a ?v=<token> query, and every one of those
// tokens must be identical - mirrors the script's own -Check logic in pure
// JS so it runs in the regular Node test suite without invoking PowerShell.
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function isLocalUrl(url) {
  if (!url) return false;
  if (url.startsWith('//')) return false; // protocol-relative
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return false; // has a URI scheme
  return true;
}

// The Yandex Games SDK tag (<script src="/sdk.js">) looks local by
// isLocalUrl's own rule, but it's Yandex's fixed CDN path, not one of our
// own cache-busted assets - tools/stamp-version.ps1 carves it out with its
// own identical Test-SdkTag check, so it's excluded here too rather than
// expected to carry (or share) a ?v= token.
function isSdkTag(url) {
  return !!url && url.split('?')[0] === '/sdk.js';
}

const tagPattern = /<(?:link|script)\b[^>]*>/g;
const hrefAttrPattern = /href\s*=\s*"([^"]*)"/;
const srcAttrPattern = /src\s*=\s*"([^"]*)"/;
const relStylesheetPattern = /rel\s*=\s*"stylesheet"/;

const tags = [];
let match;
while ((match = tagPattern.exec(html)) !== null) {
  const tagText = match[0];
  let attrMatch = null;

  if (/^<link\b/.test(tagText)) {
    if (!relStylesheetPattern.test(tagText)) continue;
    attrMatch = hrefAttrPattern.exec(tagText);
  } else if (/^<script\b/.test(tagText)) {
    attrMatch = srcAttrPattern.exec(tagText);
  } else {
    continue;
  }

  if (!attrMatch) continue;
  const url = attrMatch[1];
  if (!isLocalUrl(url)) continue;

  tags.push({ tagText, url });
}

assert(tags.length > 0, 'found at least one local <link rel="stylesheet">/<script src> tag to check');

// --- The Yandex SDK tag: present, and NEVER carries a ?v= token of its own
// (tools/stamp-version.ps1 must never stamp it - see its own Test-SdkTag) ---
const sdkTags = tags.filter((t) => isSdkTag(t.url));
assert(sdkTags.length === 1, `exactly one Yandex SDK tag is present (found ${sdkTags.length})`);
sdkTags.forEach((t) => {
  assert(t.url === '/sdk.js', `the Yandex SDK tag's src is exactly "/sdk.js", with no query string (got "${t.url}")`);
});

// Every remaining check below is about our OWN locally-versioned assets -
// the SDK tag is intentionally excluded from here on.
const versionedTags = tags.filter((t) => !isSdkTag(t.url));

// --- Known tags: every local css/js file referenced by index.html today ---
const expectedFiles = [
  'css/style.css', 'css/winter-ornaments.css', 'css/winter-popups.css', 'css/daily-gift.css', 'css/winter-win.css',
  'js/i18n.js', 'js/platform.js', 'js/audio.js', 'js/themes.js', 'js/rng.js', 'js/grid.js', 'js/rules.js', 'js/solver.js',
  'js/generator.js', 'js/levelstart.js', 'js/helpers.js', 'js/state.js', 'js/menu.js', 'js/checkin.js',
  'js/daily-challenge.js', 'js/platform-yandex.js', 'js/platform-playgama.js', 'js/platform-adapter.js', 'js/cloudsave.js',
  'js/router.js', 'js/render.js', 'js/input.js', 'js/tutorial.js', 'js/zoomguard.js', 'js/main.js',
];
const foundBaseUrls = tags.map((t) => t.url.split('?')[0]);
expectedFiles.forEach((file) => {
  assert(foundBaseUrls.includes(file), `index.html still references ${file} as a local <link>/<script> tag`);
});

// --- Every local tag OTHER than the SDK tag has a ?v= token, and all of
// those tokens are identical ---
const tokens = new Set();
versionedTags.forEach((t) => {
  const queryIndex = t.url.indexOf('?');
  assert(queryIndex !== -1, `has a ?v= query: ${t.tagText}`);
  if (queryIndex === -1) return;
  const query = t.url.slice(queryIndex + 1);
  assert(/^v=.+/.test(query), `the query is exactly a v=<token> (got "${query}") in: ${t.tagText}`);
  const tokenMatch = /^v=(.+)$/.exec(query);
  if (tokenMatch) tokens.add(tokenMatch[1]);
});

assert(tokens.size === 1, `all non-SDK tags share exactly one token (found ${tokens.size}: ${Array.from(tokens).join(', ')})`);

// --- Sanity: the token looks like tools/stamp-version.ps1's yyyyMMdd-HHmm format ---
const [onlyToken] = tokens;
if (tokens.size === 1) {
  assert(/^\d{8}-\d{4}$/.test(onlyToken), `the token looks like yyyyMMdd-HHmm (got "${onlyToken}")`);
}

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
