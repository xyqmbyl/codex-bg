$ErrorActionPreference = 'Stop'
Write-Output ("PSVersion: " + $PSVersionTable.PSVersion.ToString())

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await-Operation($op, $resultType) {
    $m = $asTaskGeneric.MakeGenericMethod($resultType)
    $t = $m.Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    return $t.Result
}

$stType = [Windows.ApplicationModel.StartupTask, Windows.ApplicationModel, ContentType = WindowsRuntime]
$task = Await-Operation ($stType::GetAsync('App')) ([Windows.ApplicationModel.StartupTask])
Write-Output ("taskId   : " + $task.TaskId)
Write-Output ("state    : " + $task.State)
if ($task.State -eq [Windows.ApplicationModel.StartupTaskState]::Enabled -or
    $task.State -eq [Windows.ApplicationModel.StartupTaskState]::EnabledByPolicy) {
    $task.Disable()
    Write-Output ("after disable -> state: " + $task.State)
} else {
    Write-Output "already not enabled"
}
$t2 = Await-Operation ($stType::GetAsync('App')) ([Windows.ApplicationModel.StartupTask])
Write-Output ("recheck  : " + $t2.State)
