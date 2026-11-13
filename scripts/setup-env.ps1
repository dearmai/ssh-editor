# SSH Editor - Windows 빌드 환경 자동 세팅 스크립트
# 사용: powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1 [-ToolsRoot D:\devtools]
# Makefile의 `make env-setup`이 호출함.
#
# winget 없이(LTSC 등) 동작하도록 공식 배포처에서 직접 내려받아 공통 도구 루트
# (기본 D:\devtools, 환경변수 DEVTOOLS_ROOT로 변경 가능) 아래에 설치하고
# 사용자 PATH/환경변수에 등록한다.
#
#   <root>\make         GNU make (ezwinports)
#   <root>\nasm         NASM (aws-lc-sys 어셈블리 빌드)
#   <root>\cmake        CMake (aws-lc-sys CMake 빌더 폴백)
#   <root>\rust\cargo   CARGO_HOME   (rustup, cargo, rustc)
#   <root>\rust\rustup  RUSTUP_HOME  (툴체인)
#   <root>\vs\BuildTools  VS 2022 Build Tools (MSVC 링커 + Windows SDK) — 관리자 권한 필요

param(
    [string]$ToolsRoot = $(if ($env:DEVTOOLS_ROOT) { $env:DEVTOOLS_ROOT } else { 'D:\devtools' })
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NasmVersion  = '2.16.03'
$CmakeVersion = '3.31.6'
$MakeZip      = 'make-4.4.1-without-guile-w32-bin.zip'

$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
$dl = Join-Path $ToolsRoot '_downloads'
New-Item -ItemType Directory -Force -Path $ToolsRoot, $dl | Out-Null

function Get-File([string]$Url, [string]$Name) {
    $out = Join-Path $dl $Name
    if (-not (Test-Path $out)) {
        Write-Host "    다운로드: $Url" -ForegroundColor DarkGray
        & $curl -fsSL --retry 3 -o "$out.part" $Url
        if ($LASTEXITCODE -ne 0) { throw "다운로드 실패: $Url" }
        Move-Item -Force "$out.part" $out
    }
    return $out
}

# zip을 풀어 단일 최상위 폴더가 있으면 그 내용을 $Dest로 옮긴다
function Expand-To([string]$Zip, [string]$Dest) {
    $tmp = "$Dest.__tmp"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $Zip -DestinationPath $tmp -Force
    $items = @(Get-ChildItem $tmp)
    $src = if ($items.Count -eq 1 -and $items[0].PSIsContainer) { $items[0].FullName } else { $tmp }
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
    Move-Item $src $Dest
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}

function Add-UserPath([string]$Dir) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($userPath -split ';' | Where-Object { $_ })
    if ($parts -notcontains $Dir) {
        [Environment]::SetEnvironmentVariable('Path', (($parts + $Dir) -join ';'), 'User')
        Write-Host "    [PATH] 사용자 PATH 등록: $Dir" -ForegroundColor Cyan
    }
    if (($env:Path -split ';') -notcontains $Dir) { $env:Path = "$Dir;$env:Path" }
}

function Set-UserEnv([string]$Name, [string]$Value) {
    [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
    Set-Item "env:$Name" $Value
}

Write-Host ""
Write-Host "==== SSH Editor - Windows 빌드 환경 세팅 (도구 루트: $ToolsRoot) ====" -ForegroundColor Cyan
Write-Host ""
Set-UserEnv 'DEVTOOLS_ROOT' $ToolsRoot

# 1) GNU make
$makeBin = Join-Path $ToolsRoot 'make\bin'
if (-not (Test-Path (Join-Path $makeBin 'make.exe'))) {
    Write-Host "  [INSTALL] GNU make" -ForegroundColor Cyan
    $zip = Get-File "https://sourceforge.net/projects/ezwinports/files/$MakeZip/download" $MakeZip
    Expand-To $zip (Join-Path $ToolsRoot 'make')
} else { Write-Host "  [SKIP] GNU make" -ForegroundColor DarkGray }
Add-UserPath $makeBin

# 2) NASM
$nasmDir = Join-Path $ToolsRoot 'nasm'
if (-not (Test-Path (Join-Path $nasmDir 'nasm.exe'))) {
    Write-Host "  [INSTALL] NASM $NasmVersion" -ForegroundColor Cyan
    $zip = Get-File "https://www.nasm.us/pub/nasm/releasebuilds/$NasmVersion/win64/nasm-$NasmVersion-win64.zip" "nasm-$NasmVersion-win64.zip"
    Expand-To $zip $nasmDir
} else { Write-Host "  [SKIP] NASM" -ForegroundColor DarkGray }
Add-UserPath $nasmDir

# 3) CMake
$cmakeDir = Join-Path $ToolsRoot 'cmake'
if (-not (Test-Path (Join-Path $cmakeDir 'bin\cmake.exe'))) {
    Write-Host "  [INSTALL] CMake $CmakeVersion" -ForegroundColor Cyan
    $name = "cmake-$CmakeVersion-windows-x86_64.zip"
    $zip = Get-File "https://github.com/Kitware/CMake/releases/download/v$CmakeVersion/$name" $name
    Expand-To $zip $cmakeDir
} else { Write-Host "  [SKIP] CMake" -ForegroundColor DarkGray }
Add-UserPath (Join-Path $cmakeDir 'bin')

# 4) Rust (rustup → stable-x86_64-pc-windows-msvc)
$cargoHome  = Join-Path $ToolsRoot 'rust\cargo'
$rustupHome = Join-Path $ToolsRoot 'rust\rustup'
Set-UserEnv 'CARGO_HOME'  $cargoHome
Set-UserEnv 'RUSTUP_HOME' $rustupHome
if (-not (Test-Path (Join-Path $cargoHome 'bin\cargo.exe'))) {
    Write-Host "  [INSTALL] Rust (rustup, stable msvc)" -ForegroundColor Cyan
    $init = Get-File 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' 'rustup-init.exe'
    & $init -y --no-modify-path --default-host x86_64-pc-windows-msvc --default-toolchain stable --profile minimal
    if ($LASTEXITCODE -ne 0) { throw "rustup 설치 실패 (exit $LASTEXITCODE)" }
} else { Write-Host "  [SKIP] Rust" -ForegroundColor DarkGray }
Add-UserPath (Join-Path $cargoHome 'bin')

# 5) VS 2022 Build Tools (VCTools 워크로드) — 관리자 권한 필요
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vc = if (Test-Path $vswhere) {
    & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
if (-not $vc) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw 'VS Build Tools 설치에는 관리자 권한이 필요합니다. 관리자 셸에서 다시 실행하세요.' }
    $vsPath = Join-Path $ToolsRoot 'vs\BuildTools'
    Write-Host "  [INSTALL] VS 2022 Build Tools → $vsPath (수 분~수십 분 소요)" -ForegroundColor Cyan
    $boot = Get-File 'https://aka.ms/vs/17/release/vs_BuildTools.exe' 'vs_BuildTools.exe'
    $p = Start-Process -FilePath $boot -Wait -PassThru -ArgumentList @(
        '--quiet', '--wait', '--norestart', '--nocache',
        '--installPath', "`"$vsPath`"",
        '--add', 'Microsoft.VisualStudio.Workload.VCTools', '--includeRecommended')
    if ($p.ExitCode -notin @(0, 3010)) { throw "VS Build Tools 설치 실패 (exit $($p.ExitCode))" }
    if ($p.ExitCode -eq 3010) { Write-Warning 'VS Build Tools: 재부팅이 필요할 수 있습니다.' }
} else { Write-Host "  [SKIP] MSVC 링커 ($vc)" -ForegroundColor DarkGray }

# 6) Node.js — 자동 설치하지 않음 (nvm/volta/fnm 등 사용자 선택 존중)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  [WARN] Node.js 없음 — https://nodejs.org 에서 LTS 설치 필요" -ForegroundColor Yellow
}

# 7) npm 의존성
$root = Split-Path -Parent $PSScriptRoot
if ((Get-Command npm -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $root 'package.json'))) {
    Write-Host "  [npm] 프론트엔드 의존성 설치 (npm install)..." -ForegroundColor Cyan
    Push-Location $root
    try { & npm install } finally { Pop-Location }
}

Write-Host ""
Write-Host "==> 세팅 완료. 새 터미널을 열어 PATH를 반영한 뒤 'make env-check' → 'make install'." -ForegroundColor Green
