; MeetMind NSIS hooks — ensure meetmind:// launches the installed app
; (electron-builder includes this from buildResources when nsis.include is set)

!macro customInstall
  DetailPrint "Registering meetmind:// protocol handler"
  WriteRegStr HKCU "Software\Classes\meetmind" "" "URL:MeetMind Protocol"
  WriteRegStr HKCU "Software\Classes\meetmind" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\meetmind\DefaultIcon" "" "$INSTDIR\MeetMind.exe,0"
  WriteRegStr HKCU "Software\Classes\meetmind\shell\open\command" "" '"$INSTDIR\MeetMind.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\meetmind"
!macroend
