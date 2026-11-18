# Start the OpenAI Codex desktop app with its MSIX package identity attached,
# plus Electron remote-debugging flags. Launching the exe directly from
# WindowsApps fails with "no package identity" - COM activation is required.
param(
    [string]$Port = 9223,
    [string]$Arguments = ""
)
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace CodexBg {
    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IApplicationActivationManager {
        int ActivateApplication([In] string appUserModelId, [In] string arguments, [In] int options, [Out] out uint processId);
    }

    [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    public class ApplicationActivationManager {}

    public static class Activator2 {
        public static uint Activate(string aumid, string args) {
            uint pid;
            IApplicationActivationManager m = (IApplicationActivationManager)new ApplicationActivationManager();
            int hr = m.ActivateApplication(aumid, args, 0, out pid);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            return pid;
        }
    }
}
"@

$aumid = "OpenAI.Codex_2p2nqsd0c76g0!App"
$fullArgs = ("--remote-debugging-port=$Port --remote-allow-origins=* " + $Arguments).Trim()
$procId = [CodexBg.Activator2]::Activate($aumid, $fullArgs)
Write-Output "activated pid=$procId port=$Port"
