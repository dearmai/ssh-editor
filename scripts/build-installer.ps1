# SSH Editor - Windows 설치판(NSIS/MSI) 빌드
# Makefile의 `make build`, install-app.ps1 이 호출함.
# tauri build 산출물(src-tauri/target/release/bundle/...)을 build/windows/ 로 모은다.

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw '설치판 빌드는 Windows 전용입니다.' }
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    & npm run tauri:build
    if ($LASTEXITCODE -ne 0) { throw "tauri build 실패 (exit $LASTEXITCODE)" }

    $bundleDir = Join-Path $root 'src-tauri/target/release/bundle'
    $output = Join-Path $root 'build/windows'
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    # 이전 버전 설치파일이 섞이지 않게 정리
    Get-ChildItem $output -File | Where-Object { $_.Name -like '*-setup.exe' -or $_.Extension -ieq '.msi' } | Remove-Item -Force

    $copied = @()
    foreach ($kind in @(@{ Dir = 'nsis'; Filter = '*-setup.exe' }, @{ Dir = 'msi'; Filter = '*.msi' })) {
        $file = Get-ChildItem (Join-Path $bundleDir $kind.Dir) -Filter $kind.Filter -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($file) {
            Copy-Item -LiteralPath $file.FullName -Destination $output -Force
            $copied += $file.Name
        }
    }
    if (-not $copied) { throw "설치파일을 찾지 못했습니다. ($bundleDir 확인)" }
    Write-Host "설치판: $output"
    $copied | ForEach-Object { Write-Host "  $_" }
} finally {
    Pop-Location
}
