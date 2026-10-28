# 코드 서명 공용 함수 — codesign-cert.ps1 · build-signed.ps1 에서 dot-source 한다.
# 인증서는 현재 사용자 저장소(Cert:\CurrentUser\My)에서 주체 이름으로 찾는다 — .pfx·비밀번호를 설정에 두지 않는다.

if ($PSVersionTable.PSEdition -eq 'Desktop') {
  # pwsh 7 에서 (npm 등을 거쳐) 띄운 Windows PowerShell 은 7 의 PSModulePath 를 물려받아
  # Microsoft.PowerShell.Security(Get-AuthenticodeSignature 등)를 불러오지 못한다 → 기본 경로로 되돌린다
  $env:PSModulePath = @(
    (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'WindowsPowerShell\Modules'),
    (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
    (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules')
  ) -join ';'
}

$CodeSignSubject = 'CN=Dany Kim, O=SSH Editor'
$CodeSignTimestampUrl = 'http://timestamp.digicert.com'

function Get-CodeSignCert {
  param([string]$Subject = $CodeSignSubject, [switch]$AllowMissing)
  # Cert: 드라이브의 -CodeSigningCert 는 모듈 로드 상태에 따라 없을 수 있어 .NET 저장소를 직접 연다
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', 'CurrentUser')
  $store.Open('ReadOnly')
  try {
    $certs = @($store.Certificates | Where-Object {
      $_.Subject -eq $Subject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and
      ($_.Extensions | Where-Object { $_.EnhancedKeyUsages } |
        ForEach-Object { $_.EnhancedKeyUsages.Value }) -contains '1.3.6.1.5.5.7.3.3'
    })
  } finally {
    $store.Close()
  }
  if ($certs.Count -gt 1) {
    throw "'$Subject' 코드 서명 인증서가 $($certs.Count)개 있습니다. certmgr.msc 에서 하나만 남기세요: $($certs.Thumbprint -join ', ')"
  }
  if ($certs.Count -eq 0) {
    if ($AllowMissing) { return $null }
    throw "'$Subject' 코드 서명 인증서가 없습니다. 먼저 scripts\codesign-cert.ps1 을 실행하세요."
  }
  $certs[0]
}

# Windows SDK 의 최신 x64 signtool.exe
function Find-SignTool {
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $tool = Get-ChildItem $kits -Directory -Filter '10.*' -ErrorAction SilentlyContinue |
    Sort-Object { [version]$_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if (-not $tool) { throw 'signtool.exe 를 찾을 수 없습니다. Windows SDK 를 설치하세요.' }
  $tool
}

# SHA-256 서명 + RFC 3161 타임스탬프 (인증서 만료 후에도 서명 유효)
function Invoke-CodeSign {
  param([Parameter(Mandatory)][string[]]$Files, [Parameter(Mandatory)]$Cert)
  $signtool = Find-SignTool
  foreach ($file in $Files) {
    & $signtool sign /sha1 $Cert.Thumbprint /s My /fd sha256 /tr $CodeSignTimestampUrl /td sha256 /q $file
    if ($LASTEXITCODE -ne 0) { throw "서명 실패: $file" }
    Assert-CodeSigned -File $file -Cert $Cert
  }
}

function Assert-CodeSigned {
  param([Parameter(Mandatory)][string]$File, [Parameter(Mandatory)]$Cert)
  $sig = Get-AuthenticodeSignature -LiteralPath $File
  if ($sig.SignerCertificate.Thumbprint -ne $Cert.Thumbprint) { throw "서명 확인 실패: $File ($($sig.Status))" }
  if (-not $sig.TimeStamperCertificate) { throw "타임스탬프 없음: $File" }
  Write-Host "서명됨: $File ($($sig.Status))"
}
