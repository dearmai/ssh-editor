$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Portable builds require Windows.' }
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
$previousTargetDir = $env:CARGO_TARGET_DIR
try {
    # Isolate Cargo output so an installer build cannot reuse a portable binary.
    $env:CARGO_TARGET_DIR = Join-Path $root 'src-tauri/target/portable'
    & npm run tauri:build -- --no-bundle --features portable
    if ($LASTEXITCODE -ne 0) { throw "Portable build failed (exit $LASTEXITCODE)" }
    $source = Join-Path $root 'src-tauri/target/portable/release/ssh-editor.exe'
    if (-not (Test-Path -LiteralPath $source)) { throw "Executable not found: $source" }
    $output = Join-Path $root 'build/windows-portable'
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination (Join-Path $output 'ssh-editor.exe') -Force
    Write-Host "Portable executable: $output\ssh-editor.exe"
    Write-Host 'Settings and WebView2 data will be created in the adjacent data directory.'
} finally {
    $env:CARGO_TARGET_DIR = $previousTargetDir
    Pop-Location
}
