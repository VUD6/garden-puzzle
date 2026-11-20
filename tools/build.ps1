<#
.SYNOPSIS
  Builds a per-platform distributable zip of the game.

.DESCRIPTION
  Copies ONLY what index.html actually loads - index.html, css/, js/,
  fonts/ - into a throwaway temp directory (never the repo tree itself),
  writes that platform's id into the copy ONLY (a small generated
  js/platform-config.js setting window.GAME_PLATFORM, referenced by a
  <script> tag inserted into the copy's own index.html right after the SDK
  tag), zips the copy, and drops it at dist\garden-<platform>.zip. The
  repo's own index.html/js/ are never touched - local dev and GitHub Pages
  keep relying on js/platform-adapter.js's own default ('yandex' when
  window.GAME_PLATFORM is undefined - see GAME_DESIGN.md's "Platform
  layer" section), exactly as before this script existed.

  dev/, tests/, and tools/ are excluded structurally, not by a file-by-file
  denylist - they're simply never among the four items copied, same as
  CLAUDE.md's existing "what's shippable" rule.

  Adding a platform later: add its id to -Platform's ValidateSet below AND
  one entry to $platformConfigById - two small, self-contained edits in
  this one file, plus its own js/platform-<id>.js adapter file and
  <script> tag in index.html (see GAME_DESIGN.md). The copy/zip logic
  itself stays the same for every platform EXCEPT how the staged
  index.html's own <head>/SDK-tag area is rewritten - see the 'playgama'
  branch below for the one platform so far that needs anything beyond the
  shared "insert one config <script> tag" step every platform gets.

.PARAMETER Platform
  Which platform to build for. Defaults to 'yandex'.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build.ps1 -Platform yandex
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build.ps1 -Platform playgama
#>
[CmdletBinding()]
param(
    [ValidateSet('yandex', 'playgama')]
    [string]$Platform = 'yandex'
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath

# The Bridge SDK CDN script - v2 ("Current" per Playgama's own docs index at
# the time this was written; the sibling v1 doc tree is explicitly marked
# "Legacy" there). Must be the FIRST thing in <head>, loaded synchronously
# (no async/defer - see https://wiki.playgama.com/playgama/bridge-sdk/setup),
# so window.bridge already exists by the time every other script (all at
# the end of body) runs.
$playgamaBridgeScriptTag = '<script src="https://bridge.playgama.com/v2/stable/playgama-bridge.js"></script>'

# The ONLY per-platform data this script needs - everything else about the
# build (which files to copy, how to zip) is identical across platforms.
$platformConfigById = @{
    'yandex'   = "window.GAME_PLATFORM = 'yandex';`n"
    'playgama' = "window.GAME_PLATFORM = 'playgama';`n"
}
if (-not $platformConfigById.ContainsKey($Platform)) {
    throw "No platform-config template registered for '$Platform' - add one to `$platformConfigById in this script."
}

# What actually ships - must stay in sync with CLAUDE.md's "shippable
# build" rule (index.html, css/, js/, fonts/ only - never /dev, /tests,
# /tools, or any repo-root doc file).
$shippedItems = @('index.html', 'css', 'js', 'fonts')

$distDir = Join-Path $repoRoot 'dist'
if (-not (Test-Path -LiteralPath $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

$stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ('garden-build-' + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stagingDir | Out-Null

try {
    foreach ($item in $shippedItems) {
        $sourcePath = Join-Path $repoRoot $item
        if (-not (Test-Path -LiteralPath $sourcePath)) {
            throw "Expected '$item' at '$sourcePath' but it doesn't exist - is `$repoRoot ('$repoRoot') correct?"
        }
        Copy-Item -LiteralPath $sourcePath -Destination $stagingDir -Recurse
    }

    # The platform-id file - written into the STAGED js/ copy only, never
    # the repo's own js/. UTF8Encoding($false) avoids a BOM, matching the
    # plain-ASCII shape of every other js/ file in this repo.
    $configRelativePath = Join-Path 'js' 'platform-config.js'
    $configStagedPath = Join-Path $stagingDir $configRelativePath
    [System.IO.File]::WriteAllText($configStagedPath, $platformConfigById[$Platform], (New-Object System.Text.UTF8Encoding($false)))

    # Rewrites the STAGED index.html only - the repo's own index.html is
    # never opened for writing here. Read via [System.IO.File]::ReadAllText
    # with an explicit UTF8 encoding, NOT Get-Content -Raw (which, in
    # Windows PowerShell 5.1, decodes a BOM-less file using the system's
    # ANSI codepage rather than UTF-8) - index.html's own Cyrillic <title>/
    # meta-description text has no BOM, and Get-Content -Raw was silently
    # mangling it into mojibake in the STAGED/zipped output only (the repo's
    # own index.html was never touched, so this never showed up outside a
    # built zip - caught while verifying the first real dist\garden-
    # playgama.zip output). ReadAllText(path, Encoding.UTF8) still handles a
    # BOM correctly if one is ever added later, same as the already-correct
    # read/write helpers in tools/stamp-version.ps1.
    $stagedIndexPath = Join-Path $stagingDir 'index.html'
    $indexText = [System.IO.File]::ReadAllText($stagedIndexPath, [System.Text.Encoding]::UTF8)
    $sdkTag = '<script src="/sdk.js"></script>'
    $configTag = '<script src="js/platform-config.js"></script>'
    if ($indexText -notmatch [regex]::Escape($sdkTag)) {
        throw "Could not find '$sdkTag' in the staged index.html."
    }

    if ($Platform -eq 'playgama') {
        # Playgama's own game requirements (1.1.1/1.1.2) and setup docs are
        # explicit: the Bridge script must be the FIRST thing in <head>,
        # loaded synchronously - and the Yandex SDK tag has no business in a
        # non-Yandex build at all, so it's removed rather than left dead.
        # js/platform-config.js (window.GAME_PLATFORM = 'playgama') is
        # inserted where the SDK tag used to be, keeping it right before
        # every Garden.* script exactly like the 'yandex' branch below does.
        if ($indexText -notmatch '<head>') {
            throw "Could not find '<head>' in the staged index.html to insert the Bridge script tag after."
        }
        $indexText = $indexText.Replace('<head>', '<head>' + "`n" + $playgamaBridgeScriptTag)
        $indexText = $indexText.Replace($sdkTag, $configTag)
    } else {
        # 'yandex' (and any future platform that still wants the Yandex SDK
        # tag as its own anchor point) - inserted right after the SDK tag,
        # before every Garden.* script, exactly as before this platform
        # branch existed. The Yandex build's index.html is otherwise
        # byte-for-byte what it always was.
        $indexText = $indexText.Replace($sdkTag, $sdkTag + "`n" + $configTag)
    }

    [System.IO.File]::WriteAllText($stagedIndexPath, $indexText, (New-Object System.Text.UTF8Encoding($false)))

    $zipPath = Join-Path $distDir ("garden-$Platform.zip")
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    # tar -a -cf auto-detects the zip format from the .zip extension - the
    # same tool and the same relative-path invocation shape as the existing
    # manual release command (`tar -a -cf ..\garden.zip index.html css js
    # fonts`, run from the repo root), so this produces a directly
    # comparable archive. Unlike Compress-Archive, it writes forward-slash
    # entry names even on Windows, which matters for a zip meant to be
    # uploaded to Yandex Games (a Linux-hosted service) - bsdtar (what
    # Windows 10/Server 2019+ bundles as tar.exe) does this by default.
    Push-Location $stagingDir
    try {
        & tar -a -cf $zipPath @shippedItems
        if ($LASTEXITCODE -ne 0) {
            throw "tar exited with code $LASTEXITCODE while building '$zipPath'."
        }
    } finally {
        Pop-Location
    }

    $fileCount = (Get-ChildItem -LiteralPath $stagingDir -Recurse -File).Count
    Write-Host "Built '$zipPath' ($fileCount files) for platform '$Platform'." -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
}
