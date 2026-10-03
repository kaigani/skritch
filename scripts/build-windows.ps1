param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nativeRoot = Join-Path $repoRoot 'apps/desktop/src-tauri'
$triple = 'x86_64-pc-windows-msvc'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

Push-Location $repoRoot
try {
    foreach ($tool in @('ffmpeg', 'ffprobe')) {
        $sidecar = Join-Path $nativeRoot "binaries/$tool-$triple.exe"
        if (-not (Test-Path -LiteralPath $sidecar)) {
            throw "Missing $sidecar. Build the LGPL sidecars with scripts/build-ffmpeg-windows.sh in WSL first (see README)."
        }
        $buildConfig = & $sidecar -hide_banner -buildconf 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $buildConfig -match '--enable-(gpl|nonfree|version3)') {
            throw "The $tool sidecar is not a working LGPL release build."
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $nativeRoot 'resources/licenses/zlib-LICENSE.txt'))) {
        throw 'Missing zlib notice. Rebuild the Windows sidecars.'
    }

    Invoke-Checked 'pnpm.cmd' @('install', '--frozen-lockfile')
    $outputDir = Join-Path $repoRoot 'dist/windows'
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    $jsReport = & pnpm.cmd licenses list --prod --json
    if ($LASTEXITCODE -ne 0) { throw 'Could not collect JavaScript license metadata' }
    $rustReport = & cargo.exe metadata --locked --format-version 1 --filter-platform $triple --manifest-path "$nativeRoot/Cargo.toml"
    if ($LASTEXITCODE -ne 0) { throw 'Could not collect Rust license metadata' }
    $jsReportPath = Join-Path $outputDir 'js-licenses.json'
    $rustReportPath = Join-Path $outputDir 'rust-metadata.json'
    [System.IO.File]::WriteAllText($jsReportPath, ($jsReport -join "`n"))
    [System.IO.File]::WriteAllText($rustReportPath, ($rustReport -join "`n"))
    Invoke-Checked 'node.exe' @('scripts/collect-licenses.mjs', $jsReportPath, $rustReportPath, "$nativeRoot/resources/licenses/DEPENDENCIES-WINDOWS.txt")
    if (-not $SkipTests) {
        Invoke-Checked 'pnpm.cmd' @('lint')
        Invoke-Checked 'pnpm.cmd' @('typecheck')
        Invoke-Checked 'pnpm.cmd' @('test')
        Invoke-Checked 'pnpm.cmd' @('test:e2e', '--project=chromium')
    }
    Invoke-Checked 'pnpm.cmd' @('tauri', 'build', '--target', $triple, '--ci')

    $releaseDir = Join-Path $nativeRoot "target/$triple/release"
    if (-not $SkipTests) {
        # Test binaries live in deps; resolve the exact tools shipped by the app via PATH.
        $previousPath = $env:PATH
        try {
            $env:PATH = "$releaseDir;$previousPath"
            Invoke-Checked 'cargo.exe' @('test', '--manifest-path', "$nativeRoot/Cargo.toml", '--locked', '--release', '--target', $triple, '--lib')
        } finally { $env:PATH = $previousPath }
    }

    $version = (Get-Content -Raw (Join-Path $nativeRoot 'tauri.conf.json') | ConvertFrom-Json).version
    $portableDir = Join-Path $outputDir "Skritch_${version}_x64_portable"
    New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
    foreach ($file in @('skritch.exe', 'ffmpeg.exe', 'ffprobe.exe')) {
        Copy-Item -LiteralPath (Join-Path $releaseDir $file) -Destination $portableDir -Force
    }
    Copy-Item -LiteralPath (Join-Path $nativeRoot 'resources/licenses') -Destination $portableDir -Recurse -Force
    @"
Skritch $version for Windows x64

Extract this entire folder and run skritch.exe. Keep ffmpeg.exe, ffprobe.exe and
licenses alongside it. Microsoft Edge WebView2 Runtime is required; Windows 11
normally includes it. The installers can install WebView2 automatically.

This build is unsigned. Install only a copy from a source you trust.
Third-party notices are in licenses. Corresponding video-tool sources are in
Skritch_${version}_windows_third-party-sources.tar.gz beside this download.
"@ | Set-Content -LiteralPath (Join-Path $portableDir 'README.txt') -Encoding UTF8
    $archive = Join-Path $outputDir "Skritch_${version}_x64_portable.zip"
    Compress-Archive -LiteralPath $portableDir -DestinationPath $archive -Force
    $artifacts = @($archive)
    foreach ($format in @('msi', 'nsis')) {
        $pattern = if ($format -eq 'msi') { '*.msi' } else { '*-setup.exe' }
        $bundles = @(Get-ChildItem -LiteralPath (Join-Path $releaseDir "bundle/$format") -Filter $pattern)
        if ($bundles.Count -ne 1) { throw "Expected one $format installer, found $($bundles.Count)" }
        $destination = Join-Path $outputDir $bundles[0].Name
        Copy-Item -LiteralPath $bundles[0].FullName -Destination $destination -Force
        $artifacts += $destination
    }
    $sourceDir = Join-Path $outputDir 'third-party-sources'
    foreach ($source in @('ffmpeg-7.1.1.tar.gz', 'v1.15.0.tar.gz', 'opus-1.5.2.tar.gz', 'zlib-1.3.1.tar.gz')) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceDir $source))) {
            throw "Missing corresponding source $source. Build sidecars with the source-archive-dir argument (see README)."
        }
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build-ffmpeg-windows.sh') -Destination $sourceDir -Force
    Copy-Item -LiteralPath (Join-Path $nativeRoot 'resources/licenses') -Destination $sourceDir -Recurse -Force
    $sourceArchive = Join-Path $outputDir "Skritch_${version}_windows_third-party-sources.tar.gz"
    Invoke-Checked 'tar.exe' @('-czf', $sourceArchive, '-C', $outputDir, 'third-party-sources')
    $artifacts += $sourceArchive
    $checksums = foreach ($artifact in $artifacts) {
        $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $(Split-Path -Leaf $artifact)"
    }
    $checksums | Set-Content -LiteralPath (Join-Path $outputDir 'SHA256SUMS.txt') -Encoding ASCII
    Write-Host "Windows artifacts: $outputDir"
} finally { Pop-Location }
