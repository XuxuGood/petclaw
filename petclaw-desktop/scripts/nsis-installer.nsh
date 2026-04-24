; scripts/nsis-installer.nsh
; Windows NSIS 自定义安装/卸载脚本
; 负责：管理员权限申请、进程终止、用户 skills 备份/恢复、资源解压、Defender 排除

!include "FileFunc.nsh"

; 获取当前时间戳（精确到毫秒），用于安装日志
!macro GetTimestamp OUTVAR
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "[DateTime]::Now.ToString(\"yyyy-MM-dd HH:mm:ss.fff\")"'
  Pop $0
  Pop ${OUTVAR}
  StrCmp $0 "0" +2
    StrCpy ${OUTVAR} "unknown-time"
!macroend

; 申请管理员权限并隐藏安装详情窗口
!macro customHeader
  RequestExecutionLevel admin
  ShowInstDetails nevershow
!macroend

; 安装前阶段：终止旧进程 → 备份用户 skills → 移除旧安装目录
!macro customInit
  CreateDirectory "$APPDATA\PetClaw"
  FileOpen $9 "$APPDATA\PetClaw\install-timing.log" w
  !insertmacro GetTimestamp $8
  FileWrite $9 "$8 phase=custom-init-start instdir=$INSTDIR appdata=$APPDATA$\r$\n"
  FileClose $9

  ; 终止 PetClaw.exe 及其关联 node.exe，最多等待 7.5 秒
  DetailPrint "[Installer] Stopping running PetClaw processes"
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    Stop-Process -Name PetClaw -Force -ErrorAction SilentlyContinue;\
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*PetClaw*\" } | Stop-Process -Force -ErrorAction SilentlyContinue;\
    for ($$i = 0; $$i -lt 15; $$i++) {\
      $$procs = @();\
      $$procs += Get-Process -Name PetClaw -ErrorAction SilentlyContinue;\
      $$procs += Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*PetClaw*\" };\
      if ($$procs.Count -eq 0) { break };\
      Start-Sleep -Milliseconds 500;\
    }"'
  Pop $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $9 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $9 "$8 phase=process-stop-complete exit=$0 elapsed_ms=$5$\r$\n"
  FileClose $9

  ; 备份用户自创 skills（排除 skills.config.json 中的内置 skills）
  DetailPrint "[Installer] Backing up user-created skills"
  System::Call 'kernel32::GetTickCount()i .r7'
  ClearErrors
  FileOpen $R0 "$APPDATA\PetClaw\skill-migrate.log" w
  IfErrors BackupLogOpenFailed
    !insertmacro GetTimestamp $8
    FileWrite $R0 "$8 phase=backup-start instdir=$INSTDIR appdata=$APPDATA$\r$\n"
    Goto BackupDoExec
  BackupLogOpenFailed:
    StrCpy $R0 ""
  BackupDoExec:

  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
    $$src    = \"$INSTDIR\resources\SKILLs\";\
    $$backup = \"$APPDATA\PetClaw\skills-backup\";\
    $$config = \"$$src\skills.config.json\";\
    if (Test-Path $$backup) { Remove-Item -Path $$backup -Recurse -Force -ErrorAction SilentlyContinue };\
    if (Test-Path $$src) {\
      $$bundled = @(try {\
        if (Test-Path $$config) {\
          (Get-Content $$config -Raw | ConvertFrom-Json).defaults.PSObject.Properties.Name\
        }\
      } catch { });\
      $$userSkills = @(Get-ChildItem -Path $$src -Directory | Where-Object { $$bundled -notcontains $$_.Name });\
      if ($$userSkills.Count -gt 0) {\
        New-Item -ItemType Directory -Path $$backup -Force | Out-Null;\
        $$userSkills | ForEach-Object {\
          Copy-Item -Path $$_.FullName -Destination (Join-Path $$backup $$_.Name) -Recurse -Force\
        }\
      }\
    }"'
  Pop $0
  Pop $1
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7

  StrCmp $R0 "" BackupSkipCloseLog
    !insertmacro GetTimestamp $8
    FileWrite $R0 "$8 phase=backup-end exit=$0 elapsed_ms=$5$\r$\n"
    FileWrite $R0 "$8 phase=backup-output text=$1$\r$\n"
    FileClose $R0
  BackupSkipCloseLog:
  FileOpen $9 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $9 "$8 phase=skill-backup-complete exit=$0 elapsed_ms=$5$\r$\n"
  FileClose $9

  ; 异步删除旧安装目录：先 rename 再后台 rd，避免阻塞安装进度
  DetailPrint "[Installer] Removing previous installation directory"
  System::Call 'kernel32::GetTickCount()i .r7'
  IfFileExists "$INSTDIR\*.*" 0 SkipOldDirRemoval
    nsExec::ExecToLog 'cmd /c for /d %D in ("$INSTDIR.old*") do @start "" /b cmd /c rd /s /q "%~fD"'
    Pop $0
    System::Call 'kernel32::GetTickCount()i .r4'
    StrCpy $3 "$INSTDIR.old.$4"
    Rename "$INSTDIR" "$3"
    IfErrors 0 RenameOK
      Goto SkipOldDirRemoval
    RenameOK:
      nsExec::ExecToLog 'cmd /c start "" /b cmd /c rd /s /q "$3"'
      Pop $0
  SkipOldDirRemoval:
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $9 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $9 "$8 phase=old-install-cleanup-complete elapsed_ms=$5 renamed_path=$3 cleanup_mode=async$\r$\n"
  FileClose $9
!macroend

; 安装阶段：添加 Defender 排除 → 通过 ELECTRON_RUN_AS_NODE 解压资源 → 恢复 skills → 清理
!macro customInstall
  CreateDirectory "$APPDATA\PetClaw"
  FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=nsis-extract-complete$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Preparing installation steps"

  ; PetClaw 暂不打包 python，只创建 petmind + SKILLs
  CreateDirectory "$INSTDIR\resources\petmind"
  CreateDirectory "$INSTDIR\resources\SKILLs"
  DetailPrint "[Installer] Preparing resource directories"

  ; 解压前先加 Defender 排除，防止扫描导致解压失败或速度极慢
  DetailPrint "[Installer] Adding Windows Defender exclusions before extraction"
  FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=defender-exclusion-start$\r$\n"
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "try { Add-MpPreference -ExclusionPath $\"$INSTDIR\resources\petmind$\",$\"$INSTDIR\resources\SKILLs$\",$\"$INSTDIR\resources\app.asar.unpacked$\" -ErrorAction Stop; Write-Output \"[Installer] Windows Defender exclusions added\" } catch { Write-Output (\"[Installer] Windows Defender exclusions skipped: \" + $$_.Exception.Message) }"'
  Pop $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=defender-exclusion-complete exit=$0 elapsed_ms=$5$\r$\n"
  FileClose $2

  ; 设置 ELECTRON_RUN_AS_NODE=1，让 PetClaw.exe 以 Node.js 模式执行 unpack-petmind.cjs
  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'

  DetailPrint "[Installer] Launching bundled extractor"
  DetailPrint "[Installer] Extracting bundled resources"
  FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-start tar=$INSTDIR\resources\win-resources.tar dest=$INSTDIR\resources$\r$\n"
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r7'

  nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\unpack-petmind.cjs" "$INSTDIR\resources\win-resources.tar" "$INSTDIR\resources" "$APPDATA\PetClaw\install-timing.log"'
  Pop $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7

  StrCmp $0 "0" TarExtractOK
    FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=tar-extract-error exit=$0 elapsed_ms=$5$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction failed (exit code $0). See %APPDATA%\PetClaw\install-timing.log for details."
  TarExtractOK:

  FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-complete exit=$0 elapsed_ms=$5$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Bundled resources extraction complete"
  Delete "$INSTDIR\resources\win-resources.tar"

  ; 将用户自创 skills 从备份目录还原到新安装目录（不覆盖内置 skills）
  IfFileExists "$APPDATA\PetClaw\skills-backup\*.*" 0 SkipSkillRestore
    DetailPrint "[Installer] Restoring user-created skills"
    FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=skill-restore-start$\r$\n"
    FileClose $2
    System::Call 'kernel32::GetTickCount()i .r7'

    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
      $$backup    = \"$APPDATA\PetClaw\skills-backup\";\
      $$newSkills = \"$INSTDIR\resources\SKILLs\";\
      Get-ChildItem -Path $$backup -Directory | ForEach-Object {\
        $$target = Join-Path $$newSkills $$_.Name;\
        if (-not (Test-Path $$target)) {\
          Copy-Item -Path $$_.FullName -Destination $$target -Recurse -Force\
        }\
      };\
      Remove-Item -Path $$backup -Recurse -Force -ErrorAction SilentlyContinue"'
    Pop $0
    Pop $1
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=skill-restore-complete exit=$0 elapsed_ms=$5$\r$\n"
    FileWrite $2 "$8 phase=skill-restore-output text=$1$\r$\n"
    FileClose $2
  SkipSkillRestore:

  ; 清除 ELECTRON_RUN_AS_NODE，恢复正常 Electron 运行模式
  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'

  DetailPrint "[Installer] Cleaning up temporary installer files"
  Delete "$INSTDIR\resources\unpack-petmind.cjs"

  FileOpen $2 "$APPDATA\PetClaw\install-timing.log" a
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=install-complete$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Installation complete"
!macroend

; 卸载前：先终止所有 PetClaw 相关进程，防止文件锁定导致卸载失败
!macro customUnInit
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    Stop-Process -Name PetClaw -Force -ErrorAction SilentlyContinue;\
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*PetClaw*\" } | Stop-Process -Force -ErrorAction SilentlyContinue;\
    for ($$i = 0; $$i -lt 15; $$i++) {\
      $$procs = @();\
      $$procs += Get-Process -Name PetClaw -ErrorAction SilentlyContinue;\
      $$procs += Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*PetClaw*\" };\
      if ($$procs.Count -eq 0) { break };\
      Start-Sleep -Milliseconds 500;\
    }"'
  Pop $0
!macroend

; 卸载后：移除 Windows Defender 排除规则（忽略失败）
!macro customUnInstall
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Remove-MpPreference -ExclusionPath $\"$INSTDIR\resources\petmind$\",$\"$INSTDIR\resources\SKILLs$\",$\"$INSTDIR\resources\app.asar.unpacked$\" -ErrorAction SilentlyContinue } catch {}"'
  Pop $0
  Pop $1
!macroend