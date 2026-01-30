Set objShell = CreateObject("Shell.Application")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.ShellExecute "powershell.exe", "-NoExit -Command ""cd '" & strPath & "'; npm run dev""", "", "runas", 1
