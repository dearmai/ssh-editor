# SSH Editor - Windows 빌드 환경 자동 세팅 스크립트
# 사용: powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1
# Makefile의 `make env-setup`이 호출함. winget으로 누락 도구를 설치하고
# NASM을 PATH(사용자 환경변수)에 등록한다. 설치 후 새 셸을 열어야 PATH가 반영됨.

$ErrorActionPreference = 'Continue'

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget이 필요합니다. '앱 설치 관리자'(App Installer)를 Microsoft Store에서 설치하세요." -ForegroundColor Red
    exit 1
}

function Install-IfMissing {
    param([string]$Cmd, [string]$Id, [string]$Name, [string]$ExtraArgs = '')
    if (Get-Command $Cmd -ErrorAction SilentlyContinue) {
        Write-Host ("  [SKIP] {0} 이미 설치됨" -f $Name) -ForegroundColor DarkGray
        return
    }
    Write-Host ("  [INSTALL] {0} ({1})..." -f $Name, $Id) -ForegroundColor Cyan
    $args = @('install', '--id', $Id, '-e', '--accept-source-agreements', '--accept-package-agreements')
    if ($ExtraArgs) { $args += $ExtraArgs.Split(' ') }
    & winget @args
}

Write-Host ""
Write-Host "==== SSH Editor - Windows 빌드 환경 세팅 ====" -ForegroundColor Cyan
Write-Host ""

# 1) VS Build Tools (MSVC 링커 + Windows SDK) — VCTools 워크로드 포함
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
    Write-Host "  [INSTALL] VS 2022 Build Tools (VCTools 워크로드)..." -ForegroundColor Cyan
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
        --accept-source-agreements --accept-package-agreements `
        --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
} else {
    Write-Host "  [SKIP] MSVC 링커 이미 사용 가능" -ForegroundColor DarkGray
}

# 2) Rustup (stable-x86_64-pc-windows-msvc)
Install-IfMissing 'cargo' 'Rustlang.Rustup' 'Rustup'

# 3) Node.js LTS
Install-IfMissing 'node' 'OpenJS.NodeJS.LTS' 'Node.js LTS'

# 4) NASM (aws-lc-sys 어셈블리 빌드 필수)
$nasmPresent = [bool](Get-Command nasm -ErrorAction SilentlyContinue)
if (-not $nasmPresent) {
    Install-IfMissing 'nasm' 'NASM.NASM' 'NASM'
}

# 4b) NASM PATH 등록 — winget은 PATH를 자동 등록하지 않음
$nasmDir = Join-Path $env:LOCALAPPDATA 'bin\NASM'
if (Test-Path $nasmDir) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath -notlike "*$nasmDir*") {
        Write-Host "  [PATH] NASM 디렉토리를 사용자 PATH에 등록: $nasmDir" -ForegroundColor Cyan
        [Environment]::SetEnvironmentVariable('Path', "$userPath;$nasmDir", 'User')
    } else {
        Write-Host "  [SKIP] NASM PATH 이미 등록됨" -ForegroundColor DarkGray
    }
} elseif (-not $nasmPresent) {
    Write-Host "  [WARN] NASM 설치 경로($nasmDir)를 찾지 못함. 설치 후 PATH 수동 등록이 필요할 수 있음." -ForegroundColor Yellow
}

# 5) npm 의존성
$root = Split-Path -Parent $PSScriptRoot
if (Test-Path (Join-Path $root 'package.json')) {
    Write-Host "  [npm] 프론트엔드 의존성 설치 (npm install)..." -ForegroundColor Cyan
    Push-Location $root
    try { & npm install } finally { Pop-Location }
}

Write-Host ""
Write-Host "==> 세팅 완료. 새 PowerShell/터미널을 열어 PATH를 반영한 뒤 'make env-check'로 확인하세요." -ForegroundColor Green
Write-Host "    icon.ico가 placeholder면 유효한 ICO로 교체해야 빌드됩니다 (make check가 경고)." -ForegroundColor Yellow
