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

  Adding a platform later (e.g. Playgama): add its id to -Platform's
  ValidateSet below AND one entry to $platformConfigById - two small,
  self-contained edits in this one file, plus its own js/platform-<id>.js
  adapter file and <script> tag in index.html (see GAME_DESIGN.md). Nothing
  about the copy/zip logic itself needs to change.

.PARAMETER Platform
  Which platform to build for. Defaults to 'yandex' (the only platform
  shipped today).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build.ps1 -Platform yandex
#>
[CmdletBinding()]
param(
    [ValidateSet('yandex')]
    [string]$Platform = 'yandex'
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath

# The ONLY per-platform data this script needs - everything else about the
# build (which files to copy, how to zip) is identical across platforms.
$platformConfigById = @{
    'yandex' = "window.GAME_PLATFORM = 'yandex';`n"
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

    # Inserted right after the SDK tag (before every Garden.* script) in the
    # STAGED index.html only - the repo's own index.html is never opened
    # for writing here.
    $stagedIndexPath = Join-Path $stagingDir 'index.html'
    $indexText = Get-Content -LiteralPath $stagedIndexPath -Raw
    $sdkTag = '<script src="/sdk.js"></script>'
    if ($indexText -notmatch [regex]::Escape($sdkTag)) {
        throw "Could not find '$sdkTag' in the staged index.html to insert js/platform-config.js's own <script> tag after."
    }
    $configTag = '<script src="js/platform-config.js"></script>'
    $indexText = $indexText.Replace($sdkTag, $sdkTag + "`n" + $configTag)
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
