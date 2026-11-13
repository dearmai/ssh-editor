# SSH Editor - Windows 무설치(포터블) 실행파일 빌드
# `make portable` / `npm run tauri:portable` 이 호출함. 결과: build/windows-portable/ssh-editor.exe
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw '포터블 빌드는 Windows 전용입니다.' }
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'src-tauri/target/portable/release/ssh-editor.exe'
$output = Join-Path $root 'build/windows-portable'
$target = Join-Path $output 'ssh-editor.exe'

# 빌드 결과물·복사 대상 경로에서 실행 중인 SSH Editor 프로세스
function Get-RunningTarget {
    $paths = @($source, $target) | ForEach-Object { [IO.Path]::GetFullPath($_) }
    Get-Process -Name 'ssh-editor' -ErrorAction SilentlyContinue | Where-Object {
        $p = $null
        try { $p = $_.Path } catch {}
        $p -and ($paths -contains [IO.Path]::GetFullPath($p))
    }
}

function Confirm-Yes([string]$Question) {
    $answer = Read-Host $Question
    return ($answer -match '^\s*(y|yes)\s*$')
}

# 실행 중이면 파일이 잠겨 링크/복사가 실패하므로, 물어본 뒤 닫는다
function Close-RunningTarget {
    $procs = @(Get-RunningTarget)
    if ($procs.Count -eq 0) { return }
    Write-Host ''
    Write-Host '대상 실행파일이 실행 중입니다:' -ForegroundColor Yellow
    $procs | ForEach-Object { Write-Host "  [PID $($_.Id)] $($_.Path)" }
    if (-not (Confirm-Yes '닫고 계속할까요? (y/N)')) {
        throw '취소했습니다. 실행 중인 SSH Editor를 닫은 뒤 다시 실행하세요.'
    }
    # 정상 종료 요청 — 앱이 미저장 문서 확인 창을 띄울 수 있으므로 잠시 기다린다
    foreach ($p in $procs) { [void]$p.CloseMainWindow() }
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and @(Get-RunningTarget).Count -gt 0) {
        Start-Sleep -Milliseconds 300
    }
    $left = @(Get-RunningTarget)
    if ($left.Count -gt 0) {
        Write-Host '정상 종료되지 않았습니다. (저장 확인 창이 떠 있거나 창이 여러 개일 수 있습니다)' -ForegroundColor Yellow
        if (-not (Confirm-Yes '강제 종료할까요? 저장하지 않은 내용은 사라집니다. (y/N)')) {
            throw '취소했습니다. 실행 중인 SSH Editor를 닫은 뒤 다시 실행하세요.'
        }
        $left | Stop-Process -Force
        $left | ForEach-Object { [void]$_.WaitForExit(5000) }
    }
    Write-Host '실행 중이던 SSH Editor를 닫았습니다.' -ForegroundColor Green
}

Push-Location $root
$previousTargetDir = $env:CARGO_TARGET_DIR
try {
    Close-RunningTarget
    # 설치판 빌드가 포터블 바이너리를 재사용하지 않도록 Cargo 출력 폴더를 분리
    $env:CARGO_TARGET_DIR = Join-Path $root 'src-tauri/target/portable'
    & npm run tauri:build -- --no-bundle --features portable
    if ($LASTEXITCODE -ne 0) { throw "포터블 빌드 실패 (exit $LASTEXITCODE)" }
    if (-not (Test-Path -LiteralPath $source)) { throw "실행파일을 찾지 못했습니다: $source" }
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    # 빌드하는 동안 다시 실행했을 수도 있으므로 복사 직전에 한 번 더 확인
    Close-RunningTarget
    Copy-Item -LiteralPath $source -Destination $target -Force
    Write-Host "포터블 실행파일: $target"
    Write-Host '설정과 WebView2 데이터는 실행파일 옆 data 폴더에 생성됩니다.'
} finally {
    $env:CARGO_TARGET_DIR = $previousTargetDir
    Pop-Location
}
