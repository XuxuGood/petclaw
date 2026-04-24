; scripts/nsis-installer.nsh
; Windows NSIS 自定义安装/卸载脚本

!macro customInstall
  DetailPrint "Extracting PetClaw runtime..."
  nsExec::ExecToLog '"$INSTDIR\resources\unpack-petmind.cjs"'
!macroend

!macro customUnInstall
  RMDir /r "$INSTDIR\resources\petmind"
  RMDir /r "$INSTDIR\resources\SKILLs"
!macroend