# Windows 코드 서명 (셀프 인증서)

사내·폐쇄망 배포용 Windows 빌드를 자체 발급 인증서로 서명하는 방법과 개인 키 관리 지침입니다.
공인 CA 인증서가 아니므로 SmartScreen 평판은 생기지 않으며, 배포 대상 PC에 공개 인증서를 등록해야
'확인된 게시자'로 표시됩니다.

## 한눈에 보기

| 항목 | 값 |
|---|---|
| 주체(Subject) | `CN=Dany Kim, O=SSH Editor` |
| 지문(Thumbprint) | `A07D75A44D4E0FC8346446E0132D0B50E7D8325C` (2026-10-24 생성) |
| 유효 기간 | 2026-10-24 ~ 2031-10-24 (5년) |
| 키 | RSA 3072, 내보내기 가능(Exportable) |
| 개인 키 위치 | 빌드 PC의 `Cert:\CurrentUser\My` (현재 사용자 인증서 저장소) |
| 공개 인증서 | `codesign/SSH-Editor-codesign.cer` (저장소에 포함) |
| 서명 | SHA-256, RFC 3161 타임스탬프 `http://timestamp.digicert.com` |
| 관련 스크립트 | `scripts/codesign-cert.ps1`, `scripts/codesign.ps1`, `scripts/build-signed.ps1`, `codesign/install-cert.cmd` |

> 인증서를 새로 만들면 지문이 바뀝니다. 이 표와 반입본 README의 지문을 함께 고쳐 주세요.

## 파일 구성

| 파일 | 역할 | 저장소 |
|---|---|---|
| `scripts/codesign-cert.ps1` | 인증서 생성(없을 때만) · `.cer` 내보내기 · `.pfx` 백업 | 포함 |
| `scripts/codesign.ps1` | 공용 함수: 인증서 조회, signtool 탐색, 서명·검증 | 포함 |
| `scripts/build-signed.ps1` | 서명 빌드 (`npm run tauri:signed`) | 포함 |
| `codesign/SSH-Editor-codesign.cer` | 공개 인증서 — 대상 PC 등록용 | 포함 |
| `codesign/install-cert.cmd` | 대상 PC에 공개 인증서 등록 | 포함 |
| `*.pfx` (개인 키 백업) | 다른 PC 복원용 | **절대 포함 금지** |

## 1. 인증서 생성 (최초 1회)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\codesign-cert.ps1
```

- 같은 주체의 유효한 인증서가 이미 있으면 새로 만들지 않고 그 인증서를 사용합니다.
- 없으면 `New-SelfSignedCertificate`로 코드 서명용 인증서를 `Cert:\CurrentUser\My`에 만듭니다.
- 공개 인증서를 `codesign\SSH-Editor-codesign.cer`로 내보냅니다. 이 파일은 커밋합니다.
- 같은 주체의 유효한 인증서가 2개 이상이면 오류로 멈춥니다. `certmgr.msc` → 개인 → 인증서에서 하나만 남기세요.

옵션: `-Subject '<DN>'`(기본 `CN=Dany Kim, O=SSH Editor`), `-Years <n>`(기본 5).
주체를 바꾸면 `scripts/codesign.ps1`의 `$CodeSignSubject`도 같이 바꿔야 서명 빌드가 찾습니다.

## 2. 개인 키 관리

### 원칙

- 개인 키는 **빌드 PC의 현재 사용자 인증서 저장소에만** 둡니다. 서명 스크립트는 주체 이름으로 저장소에서 찾아 쓰며,
  `.pfx` 경로나 비밀번호를 설정 파일·환경 변수·저장소에 두지 않습니다.
- 반입본·배포물에는 공개 인증서(`.cer`)만 넣습니다.
- 개인 키가 있으면 누구나 'Dany Kim' 이름으로 서명할 수 있고, 인증서를 등록한 PC는 그 파일을 신뢰합니다.
  등록 위치가 신뢰할 수 있는 루트이므로 키 유출의 영향이 큽니다.

### 백업

PC 교체·재설치·다른 PC 빌드에 대비해 비밀번호를 건 `.pfx`로 백업합니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\codesign-cert.ps1 -BackupPfx D:\safe\ssh-editor-codesign.pfx
# 비밀번호를 묻는다 (화면에 표시되지 않음)
```

- 백업 파일은 저장소·공유 폴더·반입 폴더 밖의 안전한 곳(암호화된 외장 매체, 비밀번호 관리자 첨부 등)에 둡니다.
- 비밀번호는 백업 파일과 다른 곳에 보관합니다.
- `*.pfx`, `*.p12`는 `.gitignore`에 들어 있지만, 저장소 폴더 안에는 두지 마세요.

### 다른 PC로 복원

```powershell
$pw = Read-Host 'pfx 비밀번호' -AsSecureString
Import-PfxCertificate -FilePath D:\safe\ssh-editor-codesign.pfx -CertStoreLocation Cert:\CurrentUser\My -Password $pw
```

복원 후 `scripts\codesign-cert.ps1`을 실행하면 기존 인증서를 그대로 사용합니다(지문 동일).
복원 PC에 서명 권한이 생기므로, 더 쓰지 않는 PC에서는 아래 '삭제'로 키를 지웁니다.

### 확인

```powershell
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object Subject -eq 'CN=Dany Kim, O=SSH Editor' |
  Select-Object Subject, Thumbprint, NotAfter, HasPrivateKey
```

`HasPrivateKey`가 `True`여야 서명할 수 있습니다.

### 삭제

```powershell
Remove-Item Cert:\CurrentUser\My\A07D75A44D4E0FC8346446E0132D0B50E7D8325C
```

또는 `certmgr.msc` → 개인 → 인증서에서 삭제합니다.

## 3. 서명 빌드

사전 조건: 인증서가 저장소에 있을 것, Windows SDK의 `signtool.exe`(VS Build Tools 설치 시 포함),
타임스탬프 서버 접속을 위한 인터넷.

```powershell
npm run tauri:signed                                              # 설치판 + 포터블
powershell -ExecutionPolicy Bypass -File scripts\build-signed.ps1 -Installer   # 설치판만
powershell -ExecutionPolicy Bypass -File scripts\build-signed.ps1 -Portable    # 포터블만
```

산출물은 모두 `build/windows-signed/` 한 폴더에 모입니다. 이 폴더를 그대로 반입·배포하면 됩니다.

| 산출물 | 파일 | 서명 방식 |
|---|---|---|
| NSIS 설치판 (WebView2 오프라인 설치 포함) | `SSH Editor_<버전>_x64-setup.exe` | Tauri 번들러 |
| 포터블 exe | `SSH Editor_<버전>_x64-portable.exe` | `signtool` (스크립트) |
| 인증서 등록 스크립트 | `install-cert.cmd` | — |
| 공개 인증서 | `SSH-Editor-codesign.cer` | — |

해당 종류의 이전 버전 파일은 빌드할 때 지워지므로 폴더에는 최신본만 남습니다.

동작:

- **설치판**: 인증서 지문으로 Tauri 설정 오버레이(`src-tauri/target/codesign.conf.json`, 빌드 산출물 폴더라 커밋되지 않음)를
  만들고 `tauri.offline.conf.json`과 함께 넘깁니다. Tauri가 앱 exe, NSIS 플러그인 DLL, 언인스톨러, 설치 파일을 서명합니다.
- **포터블**: `build-portable.ps1`로 빌드한 뒤 `signtool sign /sha1 <지문> /fd sha256 /tr <타임스탬프> /td sha256`으로 서명합니다.
- 서명 후 서명자 지문과 타임스탬프 존재를 확인하고, 다르면 빌드를 실패로 처리합니다.

타임스탬프가 있으므로 인증서가 만료된 뒤에도 만료 전에 서명한 파일의 서명은 유효합니다.

## 4. 서명 확인

```powershell
Get-AuthenticodeSignature '.\SSH Editor_0.1.0_x64-setup.exe' |
  Select-Object Status, @{n='Signer';e={$_.SignerCertificate.Subject}}, @{n='Timestamp';e={[bool]$_.TimeStamperCertificate}}
```

| Status | 의미 |
|---|---|
| `Valid` | 서명 정상, 인증서가 신뢰됨 (등록된 PC) |
| `UnknownError` | 서명은 있으나 루트를 신뢰하지 않음 — 인증서를 등록하지 않은 PC에서 정상 |
| `NotSigned` | 서명 없음 |
| `HashMismatch` | 서명 후 파일이 바뀜 — 사용 금지 |

설치 파일 안의 앱 exe를 확인하려면 7-Zip으로 `ssh-editor.exe`만 풀어 같은 명령으로 봅니다.

## 5. 배포 대상 PC에 인증서 등록

배포본 폴더(`build\windows-signed\`)의 `install-cert.cmd`를 실행합니다(같은 폴더의 `.cer`를 등록).

- 관리자 권한: PC 전체(LocalMachine), 일반 권한: 현재 사용자에게만 등록합니다.
- 등록 위치: 신뢰할 수 있는 루트 인증 기관(Root) + 신뢰할 수 있는 게시자(TrustedPublisher).
- 여러 PC라면 GPO(컴퓨터 구성 → Windows 설정 → 보안 설정 → 공개 키 정책)로 `.cer`를 배포할 수 있습니다.
- 게시자 기준 실행 정책(AppLocker 게시자 규칙, WDAC 서명자 규칙)에 이 인증서를 쓸 수 있습니다.

등록 해제:

```bat
certutil -delstore Root A07D75A44D4E0FC8346446E0132D0B50E7D8325C
certutil -delstore TrustedPublisher A07D75A44D4E0FC8346446E0132D0B50E7D8325C
rem 현재 사용자에게 등록했다면 -user 를 붙인다
```

## 6. 갱신 · 교체

### 만료 전 갱신 (권장: 만료 3개월 전)

1. 기존 키의 `.pfx` 백업이 있는지 확인한 뒤 저장소에서 기존 인증서를 삭제합니다(2의 '삭제').
   스크립트는 같은 주체의 유효한 인증서가 있으면 새로 만들지 않고, 2개면 멈춥니다.
2. `scripts\codesign-cert.ps1` 실행 → 새 `.cer` 커밋, `-BackupPfx`로 새 키 백업.
3. 대상 PC에 새 `.cer`를 등록합니다. 기존 서명 파일은 타임스탬프 덕분에 계속 유효하므로 옛 인증서 등록은
   그 파일들을 더 쓰지 않을 때 해제합니다.
4. 이 문서와 반입본 README의 지문·만료일을 고칩니다.

### 키 유출 · 분실 시

셀프 인증서에는 폐기 목록(CRL)이 없어서 원격으로 폐기할 수 없습니다. 대신:

1. 모든 대상 PC에서 해당 지문의 인증서를 등록 해제합니다(GPO 배포였다면 정책에서 제거).
2. 새 인증서를 만들어 다시 서명·배포합니다.
3. 유출 의심 기간에 서명된 파일을 확인할 수 없다면 모두 새 빌드로 교체합니다.

분실(유출 아님)이면 백업 `.pfx`로 복원합니다. 백업도 없으면 새 인증서로 교체합니다.

## 7. 문제 해결

| 증상 | 원인 · 조치 |
|---|---|
| `'CN=Dany Kim, O=SSH Editor' 코드 서명 인증서가 없습니다` | 이 PC에 키가 없음 → 1(생성) 또는 2(복원) |
| `인증서가 N개 있습니다` | 같은 주체의 유효한 인증서 중복 → `certmgr.msc`에서 하나만 남김 |
| `signtool.exe 를 찾을 수 없습니다` | Windows SDK 미설치 → VS Build Tools(Windows SDK 포함) 설치 |
| 타임스탬프 단계 실패 | 빌드 PC에서 `timestamp.digicert.com` 접속 불가 → 네트워크 확인 |
| `target/release/ssh-editor.exe`가 `NotSigned` | 정상. Tauri는 서명한 사본을 설치 파일에 넣은 뒤 원본으로 되돌림. 설치 파일 안의 exe를 확인 |
| npm에서 실행 시 `Get-AuthenticodeSignature` 를 불러올 수 없음 | PowerShell 7에서 띄운 Windows PowerShell 5가 7의 `PSModulePath`를 물려받는 문제. `scripts/codesign.ps1`이 시작 시 기본 경로로 되돌림 |
| 대상 PC에서 '알 수 없는 게시자' | 인증서 미등록 → 5 |

## 참고

- BrightTerm(`D:\works\BrightTerm`)의 같은 방식(`scripts/codesign-cert.ps1`, `build/codesign/install-cert.cmd`)을 따릅니다.
  인증서는 제품별로 따로 씁니다(`O=BrightTerm` / `O=SSH Editor`).
- Tauri Windows 서명 설정: https://v2.tauri.app/distribute/sign/windows/
