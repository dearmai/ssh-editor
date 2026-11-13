; SSH Editor - NSIS 설치파일 훅 (tauri.windows.conf.json 의 installerHooks)
;
; 설치파일은 확장자를 자동 연결하지 않는다. 사용자가 앱 환경설정 > 파일 연결에서
; 등록한 HKCU 항목을 실제 제거(업데이트가 아닌 경우)할 때만 정리한다.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    StrCpy $R0 0
    ssheditor_assoc_loop:
      EnumRegValue $R1 HKCU "Software\SSHEditor\Capabilities\FileAssociations" $R0
      StrCmp $R1 "" ssheditor_assoc_done
      DeleteRegValue HKCU "Software\Classes\$R1\OpenWithProgids" "SSHEditor.File"
      DeleteRegKey /ifempty HKCU "Software\Classes\$R1\OpenWithProgids"
      DeleteRegKey /ifempty HKCU "Software\Classes\$R1"
      IntOp $R0 $R0 + 1
      Goto ssheditor_assoc_loop
    ssheditor_assoc_done:
    DeleteRegKey HKCU "Software\Classes\SSHEditor.File"
    DeleteRegKey HKCU "Software\SSHEditor"
    DeleteRegValue HKCU "Software\RegisteredApplications" "SSH Editor"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
