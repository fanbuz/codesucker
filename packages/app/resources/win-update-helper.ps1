param([int]$OldPid, [string]$Installer, [string]$TargetDir, [string]$UserData, [string]$Work)
$ErrorActionPreference = 'Stop'
try {
  [System.IO.File]::WriteAllText((Join-Path $Work 'helper-ready'), 'ready')
  $old = Get-Process -Id $OldPid -ErrorAction SilentlyContinue
  if ($old -and -not $old.WaitForExit(30000)) { throw 'Application did not exit' }
  # NSIS requires /D to be the final argument; spaces are consumed as part of its value.
  $process = Start-Process -FilePath $Installer -ArgumentList ('/S /D=' + $TargetDir) -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw ('Installer failed: ' + $process.ExitCode) }
  Start-Process -FilePath (Join-Path $TargetDir 'CodeSucker.exe') -ArgumentList ('--user-data-dir="' + $UserData + '"')
  Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  [System.IO.File]::WriteAllText((Join-Path $UserData 'update-install-error.txt'), '上次更新安装未完成，请重试或从官方下载后安装。')
  $executable = Join-Path $TargetDir 'CodeSucker.exe'
  if (Test-Path -LiteralPath $executable) { Start-Process -FilePath $executable -ArgumentList ('--user-data-dir="' + $UserData + '"') }
  exit 1
}
