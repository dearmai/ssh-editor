# 셀프 인증서로 서명한 Windows 배포본 빌드 (사내·폐쇄망 배포용)
#   1) 처음 한 번: powershell -ExecutionPolicy Bypass -File scripts\codesign-cert.ps1
#   2) npm run tauri:signed            # 설치판(NSIS, WebView2 오프라인 설치 포함) + 포터블
#      scripts\build-signed.ps1 -Installer | -Portable   # 하나만
# 산출물은 build\windows-signed\ 한 곳에 모은다 (설치판 · 포터블 · install-cert.cmd · .cer).
# 셀프 인증서라 배포 대상 PC 에서 같은 폴더의 install-cert.cmd 로 인증서를 등록해야 '확인된 게시자'로 보인다.
param([switch]$Installer, [switch]$Portable)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows 서명 빌드는 Windows 에서만 가능합니다.' }
if (-not $Installer -and -not $Portable) { $Installer = $true; $Portable = $true }
. (Join-Path $PSScriptRoot 'codesign.ps1')
$root = Split-Path -Parent $PSScriptRoot
$cert = Get-CodeSignCert
Write-Host "서명 인증서: $($cert.Subject) $($cert.Thumbprint)"

$conf = Get-Content -Raw -Encoding utf8 (Join-Path $root 'src-tauri/tauri.conf.json') | ConvertFrom-Json
$output = Join-Path $root 'build/windows-signed'
New-Item -ItemType Directory -Force $output | Out-Null

Push-Location $root
try {
  if ($Installer) {
    # Tauri 가 앱 exe · 언인스톨러 · 설치 파일을 이 인증서로 서명한다
    $overlay = Join-Path $root 'src-tauri/target/codesign.conf.json'
    New-Item -ItemType Directory -Force (Split-Path $overlay) | Out-Null
    @{ bundle = @{ windows = @{
      certificateThumbprint = $cert.Thumbprint
      digestAlgorithm = 'sha256'
      timestampUrl = $CodeSignTimestampUrl
      tsp = $true
    } } } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $overlay
    & npm run tauri:build -- --config src-tauri/tauri.offline.conf.json --config $overlay --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "설치판 빌드 실패 (exit $LASTEXITCODE)" }
    $setup = Get-ChildItem (Join-Path $root 'src-tauri/target/release/bundle/nsis') -Filter '*-setup.exe' |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    # target/release/ssh-editor.exe 는 Tauri 가 번들 후 서명 전 원본으로 되돌리므로 설치 파일만 확인한다
    # (설치 파일 안에 든 앱 exe 는 서명된 사본)
    Assert-CodeSigned -File $setup.FullName -Cert $cert
    # 이전 버전 설치판이 섞이지 않게 지우고 복사
    Get-ChildItem $output -Filter '*-setup.exe' | Remove-Item -Force
    Copy-Item -LiteralPath $setup.FullName -Destination $output -Force
  }
  if ($Portable) {
    & (Join-Path $PSScriptRoot 'build-portable.ps1')
    # 설치판과 같은 이름 규칙: <제품명>_<버전>_x64-portable.exe (data\ 는 exe 옆에 생기므로 이름 무관)
    Get-ChildItem $output -Filter '*-portable.exe' | Remove-Item -Force
    $portableExe = Join-Path $output "$($conf.productName)_$($conf.version)_x64-portable.exe"
    Copy-Item -LiteralPath (Join-Path $root 'build/windows-portable/ssh-editor.exe') -Destination $portableExe -Force
    Invoke-CodeSign -Files $portableExe -Cert $cert
  }
  # 대상 PC 인증서 등록 스크립트와 공개 인증서를 함께 둔다 (install-cert.cmd 는 자기 폴더의 .cer 를 찾음)
  $cer = Join-Path $root 'codesign/SSH-Editor-codesign.cer'
  if (-not (Test-Path -LiteralPath $cer)) { throw "공개 인증서가 없습니다: $cer (scripts\codesign-cert.ps1 실행)" }
  Copy-Item -LiteralPath $cer, (Join-Path $root 'codesign/install-cert.cmd') -Destination $output -Force
  Write-Host "배포본: $output"
  Get-ChildItem $output -File | ForEach-Object { Write-Host "  $($_.Name)" }
} finally {
  Pop-Location
}
