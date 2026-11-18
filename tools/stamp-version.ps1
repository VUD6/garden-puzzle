<#
.SYNOPSIS
  Stamps a shared cache-busting ?v=<token> query onto every LOCAL
  <link rel="stylesheet" href="..."> and <script src="..."> tag in
  index.html, so a new deploy always reaches players (the root cause of
  stale JS on phones: GitHub Pages serves index.html's referenced css/js
  files from the same URL on every deploy, with no build step and no
  version token, so a browser/CDN that already cached an old copy of e.g.
  js/render.js can keep serving it indefinitely).

.DESCRIPTION
  - Only touches LOCAL tags (a relative href/src, no scheme like http:/
    https:/data: and no leading "//") - external URLs are left untouched.
  - One specific exception within those local-looking tags: the Yandex
    Games SDK tag (<script src="/sdk.js">) is never touched either, in
    stamping OR -Check, even though "/sdk.js" is itself a local-looking
    path - Yandex serves it from a fixed path and expects it exactly as
    written, with no query string this script invented.
  - Only touches <link> tags whose rel="stylesheet", and <script src="...">
    tags - no other tags exist in index.html today, and none are added here.
  - The token is the current local date-time, formatted yyyyMMdd-HHmm.
  - Any existing ?... query on a tag is replaced outright with ?v=<token>
    (this script is the sole owner of versioning on these tags).
  - Idempotent: re-running always leaves every qualifying tag with the
    SAME token (this run's), never a mix of old and new ones.
  - Preserves the file's exact encoding (BOM or not) and line endings -
    reads/writes raw bytes directly rather than through Get-Content/
    Set-Content, which in Windows PowerShell 5.1 would otherwise silently
    add a UTF-8 BOM (or mis-handle the Cyrillic already in the file).
  - Fonts (css/*.css's @font-face url(...)) and standalone SVGs referenced
    from CSS are out of scope - they aren't <link>/<script> tags in
    index.html, so this script never touches them (see tools/README or the
    command's own report for what to flag to Codex instead).

.PARAMETER Path
  Path to index.html. Defaults to the repo root relative to this script
  (tools/../index.html).

.PARAMETER Check
  Verifies every qualifying local tag already has a ?v= token and that all
  of them share the exact same token - prints a report and exits non-zero
  if anything is missing or inconsistent, without modifying the file.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\stamp-version.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\stamp-version.ps1 -Check
#>
[CmdletBinding()]
param(
    [string]$Path,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not reliably available inside a param() block's default
# value expression in Windows PowerShell 5.1 (it's only guaranteed once the
# script body starts) - resolved here instead, after the param block closes.
if (-not $Path) {
    $Path = Join-Path $PSScriptRoot '..\index.html'
}

function Test-LocalUrl {
    param([string]$Url)
    if ([string]::IsNullOrEmpty($Url)) { return $false }
    if ($Url.StartsWith('//')) { return $false } # protocol-relative
    # Any "<scheme>:" prefix (http:, https:, data:, mailto:, ...) means it's
    # not a plain relative local path.
    if ($Url -match '^[a-zA-Z][a-zA-Z0-9+.\-]*:') { return $false }
    return $true
}

# The Yandex Games SDK tag - "/sdk.js" looks local by Test-LocalUrl's own
# rule (no scheme, no leading "//"), but it's actually Yandex's fixed CDN
# path, not one of our own cache-busted assets, so it's carved out here as
# its own explicit exception rather than folded into Test-LocalUrl (which
# stays a plain "is this relative" check, nothing more).
function Test-SdkTag {
    param([string]$Url)
    if ([string]::IsNullOrEmpty($Url)) { return $false }
    return $Url.Split('?')[0] -eq '/sdk.js'
}

# Finds every LOCAL <link rel="stylesheet" href="..."> / <script src="...">
# opening tag in $Text and returns one object per qualifying tag with
# everything needed to either rewrite it or inspect its current token.
function Get-VersionableTags {
    param([string]$Text)

    $tagPattern = [regex]'<(?:link|script)\b[^>]*>'
    $hrefAttrPattern = [regex]'href\s*=\s*"([^"]*)"'
    $srcAttrPattern = [regex]'src\s*=\s*"([^"]*)"'
    $relStylesheetPattern = [regex]'rel\s*=\s*"stylesheet"'

    $results = @()
    foreach ($m in $tagPattern.Matches($Text)) {
        $tagText = $m.Value
        $attrMatch = $null

        if ($tagText -match '^<link\b') {
            if (-not $relStylesheetPattern.IsMatch($tagText)) { continue }
            $attrMatch = $hrefAttrPattern.Match($tagText)
        } elseif ($tagText -match '^<script\b') {
            $attrMatch = $srcAttrPattern.Match($tagText)
        } else {
            continue
        }

        if (-not $attrMatch.Success) { continue } # e.g. a <script> with no src at all

        $urlGroup = $attrMatch.Groups[1]
        $url = $urlGroup.Value
        if (-not (Test-LocalUrl $url)) { continue }
        if (Test-SdkTag $url) { continue } # never stamped - see Test-SdkTag's own comment

        $queryIndex = $url.IndexOf('?')
        $baseUrl = if ($queryIndex -ge 0) { $url.Substring(0, $queryIndex) } else { $url }
        $currentToken = if ($queryIndex -ge 0) { $url.Substring($queryIndex + 1) } else { $null }
        if ($currentToken -and $currentToken.StartsWith('v=')) {
            $currentToken = $currentToken.Substring(2)
        }

        $results += [PSCustomObject]@{
            TagIndex       = $m.Index
            TagLength      = $m.Length
            TagText        = $tagText
            UrlIndexInTag  = $urlGroup.Index   # relative to $tagText
            UrlLengthInTag = $urlGroup.Length
            BaseUrl        = $baseUrl
            CurrentToken   = $currentToken
        }
    }
    return $results
}

function Read-RawFile {
    param([string]$FilePath)
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $offset = if ($hasBom) { 3 } else { 0 }
    $text = [System.Text.Encoding]::UTF8.GetString($bytes, $offset, $bytes.Length - $offset)
    return [PSCustomObject]@{ Text = $text; HasBom = $hasBom }
}

function Write-RawFile {
    param([string]$FilePath, [string]$Text, [bool]$HasBom)
    $contentBytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    if ($HasBom) {
        $bom = [byte[]](0xEF, 0xBB, 0xBF)
        $finalBytes = New-Object byte[] ($bom.Length + $contentBytes.Length)
        [System.Array]::Copy($bom, 0, $finalBytes, 0, $bom.Length)
        [System.Array]::Copy($contentBytes, 0, $finalBytes, $bom.Length, $contentBytes.Length)
    } else {
        $finalBytes = $contentBytes
    }
    [System.IO.File]::WriteAllBytes($FilePath, $finalBytes)
}

$resolvedPath = (Resolve-Path -LiteralPath $Path).ProviderPath
$file = Read-RawFile -FilePath $resolvedPath
$tags = Get-VersionableTags -Text $file.Text

if ($tags.Count -eq 0) {
    Write-Error "No local <link rel=`"stylesheet`"> or <script src> tags found in '$resolvedPath' - nothing to do."
}

if ($Check) {
    $missing = @($tags | Where-Object { -not $_.CurrentToken })
    $distinctTokens = @($tags | Where-Object { $_.CurrentToken } | ForEach-Object { $_.CurrentToken } | Select-Object -Unique)

    if ($missing.Count -gt 0) {
        Write-Host "FAIL: $($missing.Count) of $($tags.Count) tag(s) have no ?v= token:" -ForegroundColor Red
        $missing | ForEach-Object { Write-Host "  $($_.TagText)" }
        exit 1
    }
    if ($distinctTokens.Count -gt 1) {
        Write-Host "FAIL: tags have $($distinctTokens.Count) different tokens, expected exactly 1: $($distinctTokens -join ', ')" -ForegroundColor Red
        foreach ($t in $tags) { Write-Host "  v=$($t.CurrentToken)  $($t.TagText)" }
        exit 1
    }

    Write-Host "OK: all $($tags.Count) tag(s) share the same token: $($distinctTokens[0])" -ForegroundColor Green
    exit 0
}

$token = Get-Date -Format 'yyyyMMdd-HHmm'

# Apply replacements back-to-front so earlier edits never shift the
# positions recorded for tags that come later in the scan order.
$orderedTags = $tags | Sort-Object TagIndex -Descending
$text = $file.Text
foreach ($t in $orderedTags) {
    $newUrl = "$($t.BaseUrl)?v=$token"
    $newTagText = $t.TagText.Substring(0, $t.UrlIndexInTag) + $newUrl + $t.TagText.Substring($t.UrlIndexInTag + $t.UrlLengthInTag)
    $text = $text.Substring(0, $t.TagIndex) + $newTagText + $text.Substring($t.TagIndex + $t.TagLength)
}

Write-RawFile -FilePath $resolvedPath -Text $text -HasBom $file.HasBom

Write-Host "Stamped $($tags.Count) tag(s) in '$resolvedPath' with token: $token" -ForegroundColor Green
