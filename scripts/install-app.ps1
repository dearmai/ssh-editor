# SSH Editor - Windows 설치파일 빌드 후 실행 스크립트
# Makefile의 `make setup`이 호출함.
# tauri build로 NSIS/MSI 설치파일을 만든 뒤, 만들어진 설치 마법사를 실행한다.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "==== SSH Editor - 설치파일 빌드 & 설치 (Windows) ====" -ForegroundColor Cyan
Write-Host ""

# 1) 릴리스 빌드 (NSIS + MSI 설치파일 생성)
Write-Host "[1/2] tauri build (release) ..." -ForegroundColor Cyan
Push-Location $root
try {
    & npm run tauri:build
    if ($LASTEXITCODE -ne 0) { throw "tauri build 실패 (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

# 2) 생성된 설치파일 탐색 (NSIS setup.exe 우선, 없으면 MSI)
$bundleDir = Join-Path $root 'src-tauri\target\release\bundle'
$installer = Get-ChildItem -Path (Join-Path $bundleDir 'nsis') -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) {
    $installer = Get-ChildItem -Path (Join-Path $bundleDir 'msi') -Filter '*.msi' -ErrorAction SilentlyContinue |
                 Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if (-not $installer) {
    Write-Host "[ERROR] 설치파일을 찾지 못했습니다. ($bundleDir 확인)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2/2] 설치 마법사 실행: $($installer.FullName)" -ForegroundColor Green
if ($installer.Extension -ieq '.msi') {
    Start-Process 'msiexec.exe' -ArgumentList '/i', "`"$($installer.FullName)`"" -Wait
} else {
    Start-Process $installer.FullName -Wait
}

Write-Host ""
Write-Host "==> 설치 완료. 시작 메뉴에서 'SSH Editor'를 실행하세요." -ForegroundColor Green
