' codex-bg watchdog autostart wrapper: run node watchdog fully hidden at logon
' Keep this file pure ASCII so the WSH code page never matters.
' Paths are derived from this script's own folder, so the project can live anywhere.
Option Explicit
Dim sh, fso, here, nodeExe
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)

' Prefer the default install path, otherwise fall back to "node" from PATH.
nodeExe = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = "C:\Program Files\nodejs\node.exe"
End If

sh.CurrentDirectory = here
sh.Run """" & nodeExe & """ ""codex-bg-watchdog.mjs""", 0, False
