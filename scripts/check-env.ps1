# SSH Editor - Windows 빌드 환경 점검 스크립트
# 사용: powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
# Makefile의 `make env-check`가 호출함. 누락 도구가 있으면 exit 1.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

function Test-Tool {
    param([string]$Name, [string]$Cmd, [string]$VersionArgs = '--version', [string]$Hint)
    $found = Get-Command $Cmd -ErrorAction SilentlyContinue
    if ($found) {
        $ver = ''
        try { $ver = (& $Cmd $VersionArgs.Split(' ') 2>$null | Select-Object -First 1) } catch {}
        Write-Host ("  [OK]   {0,-18} {1}" -f $Name, $ver) -ForegroundColor Green
        return $true
    } else {
        Write-Host ("  [MISS] {0,-18} {1}" -f $Name, $Hint) -ForegroundColor Red
        return $false
    }
}

Write-Host ""
Write-Host "==== SSH Editor - Windows 빌드 환경 점검 ====" -ForegroundColor Cyan
Write-Host ""

$ok = $true

# 1) Rust / cargo
if (-not (Test-Tool 'Rust (cargo)' 'cargo' '--version' 'winget install Rustlang.Rustup')) { $ok = $false }

# 2) Node / npm
if (-not (Test-Tool 'Node.js' 'node' '--version' 'winget install OpenJS.NodeJS.LTS')) { $ok = $false }
if (-not (Test-Tool 'npm' 'npm' '--version' 'Node.js와 함께 설치됨')) { $ok = $false }

# 3) NASM (aws-lc-sys 어셈블리 빌드에 필수)
if (-not (Test-Tool 'NASM' 'nasm' '-v' 'winget install NASM.NASM + PATH 등록')) { $ok = $false }

# 4) MSVC 링커 (link.exe) - VS Build Tools
$link = Get-Command 'link.exe' -ErrorAction SilentlyContinue
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if ($link) {
    Write-Host ("  [OK]   {0,-18} {1}" -f 'MSVC 링커', 'link.exe (개발자 셸)') -ForegroundColor Green
} elseif (Test-Path $vswhere) {
    $vc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vc) {
        Write-Host ("  [OK]   {0,-18} {1}" -f 'MSVC 링커', "VC Tools 설치됨: $vc") -ForegroundColor Green
    } else {
        Write-Host ("  [MISS] {0,-18} {1}" -f 'MSVC 링커', 'VS BuildTools에 VC.Tools 워크로드 추가 필요') -ForegroundColor Red
        $ok = $false
    }
} else {
    Write-Host ("  [MISS] {0,-18} {1}" -f 'MSVC 링커', 'winget install Microsoft.VisualStudio.2022.BuildTools') -ForegroundColor Red
    $ok = $false
}

# 5) WebView2 런타임 (Win11 기본 탑재)
$wv2 = $false
$wv2Keys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
foreach ($k in $wv2Keys) {
    if (Test-Path $k) { $wv2 = $true; break }
}
if ($wv2) {
    Write-Host ("  [OK]   {0,-18} {1}" -f 'WebView2', '설치됨') -ForegroundColor Green
} else {
    Write-Host ("  [WARN] {0,-18} {1}" -f 'WebView2', 'Win11 기본 탑재 (없으면 winget install Microsoft.EdgeWebView2Runtime)') -ForegroundColor Yellow
}

# 6) icon.ico placeholder 함정 점검 (6바이트 더미면 빌드 패닉)
$ico = Join-Path $root 'src-tauri\icons\icon.ico'
if (Test-Path $ico) {
    $size = (Get-Item $ico).Length
    if ($size -lt 100) {
        Write-Host ("  [WARN] {0,-18} {1}" -f 'icon.ico', "placeholder($size B) - 유효한 ICO로 교체해야 빌드됨") -ForegroundColor Yellow
    } else {
        Write-Host ("  [OK]   {0,-18} {1}" -f 'icon.ico', "$size B") -ForegroundColor Green
    }
} else {
    Write-Host ("  [WARN] {0,-18} {1}" -f 'icon.ico', '없음') -ForegroundColor Yellow
}

Write-Host ""
if ($ok) {
    Write-Host "==> 빌드 가능. 'npm run tauri:dev' (개발) / 'npm run tauri:build' (.msi/NSIS)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "==> 누락 도구 있음. 'make setup' 실행 후 새 셸에서 다시 점검하세요." -ForegroundColor Red
    exit 1
}
