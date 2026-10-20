/**
 * PowerShell scripts for Windows. None of them contains outside text: anything that comes from a
 * process, a project or a message arrives in an environment variable ($env:PL_*), so a project
 * named `'; Remove-Item …` stays text. Each runs as `powershell -NoProfile -EncodedCommand`.
 */

const UTC_FORMAT = `"yyyy-MM-dd'T'HH:mm:ss.fff'Z'"`;
const INVARIANT = '[Globalization.CultureInfo]::InvariantCulture';

/** Process rows for the pids in $ids: the shape parseWinProcesses expects. */
const PROCESS_ROWS = `
$p = @()
if ($ids.Count -gt 0) {
  $filter = ($ids | ForEach-Object { "ProcessId=$_" }) -join ' OR '
  $p = @(Get-CimInstance Win32_Process -Filter $filter | ForEach-Object {
    $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner
    [pscustomobject]@{
      pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = $_.Name; cmd = $_.CommandLine
      created = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString(${UTC_FORMAT}, ${INVARIANT}) } else { $null }
      mem = [double]$_.WorkingSetSize; user = $o.User
    }
  })
}`;

/** Everything one scan needs, in one PowerShell start (each start costs ~0.5 s). */
export const SCAN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$l = @(Get-NetTCPConnection -State Listen | ForEach-Object {
  [pscustomobject]@{ address = $_.LocalAddress; port = [int]$_.LocalPort; pid = [int]$_.OwningProcess }
})
$ids = @($l | ForEach-Object { $_.pid } | Sort-Object -Unique)
${PROCESS_ROWS}
ConvertTo-Json -Compress -Depth 3 -InputObject @{ listeners = $l; processes = $p }`;

/** Processes for $env:PL_PIDS (comma-separated digits, checked before use). */
export const PROCESSES_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$ids = @($env:PL_PIDS -split ',' | Where-Object { $_ -match '^[0-9]+$' })
${PROCESS_ROWS}
ConvertTo-Json -Compress -Depth 3 -InputObject @{ processes = $p }`;

/** The Windows service running $env:PL_PID, if any. */
export const SERVICE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
if ($env:PL_PID -match '^[0-9]+$') {
  $s = Get-CimInstance Win32_Service -Filter "ProcessId=$($env:PL_PID)" | Select-Object -First 1
  if ($s) { ConvertTo-Json -Compress -InputObject @{ name = $s.Name; startMode = $s.StartMode } }
}`;

/**
 * Runs $env:PL_INNER (a base64 -EncodedCommand built only from validated parts) elevated, after
 * the UAC prompt. Exit 1223 (ERROR_CANCELLED) when the user declines.
 */
export const ELEVATE_SCRIPT = `
try {
  $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $env:PL_INNER)
  exit $p.ExitCode
} catch { exit 1223 }`;

export const ELEVATION_CANCELLED_EXIT = 1223;
/** Exit code of the elevated terminate script when the process is no longer the one checked. */
export const PROCESS_CHANGED_EXIT = 3;

/** Elevated: stop a service by its (validated) name. */
export function stopServiceScript(name: string): string {
  return `Stop-Service -Name '${name}' -Force -ErrorAction Stop`;
}

/** Elevated: force-stop `pid` only if it still started at `isoUtc` (checked inside the elevated shell). */
export function terminateScript(pid: number, isoUtc: string): string {
  return `$p = Get-Process -Id ${pid} -ErrorAction Stop
if ($p.StartTime.ToUniversalTime().ToString(${UTC_FORMAT}, ${INVARIANT}) -ne '${isoUtc}') { exit ${PROCESS_CHANGED_EXIT} }
Stop-Process -Id ${pid} -Force -ErrorAction Stop`;
}

/** OK/Cancel dialog with $env:PL_MESSAGE; prints OK when confirmed. */
export const CONFIRM_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$r = [System.Windows.Forms.MessageBox]::Show($env:PL_MESSAGE, 'Portlight', 'OKCancel', 'Warning')
if ($r -eq 'OK') { 'OK' }`;

/**
 * A Windows toast with $env:PL_TITLE / $env:PL_MESSAGE. Shown under PowerShell's app id: an
 * unregistered id like "Portlight" is silently dropped by Windows 10/11.
 */
export const NOTIFY_SCRIPT = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $x.GetElementsByTagName('text')
$t.Item(0).AppendChild($x.CreateTextNode($env:PL_TITLE)) | Out-Null
$t.Item(1).AppendChild($x.CreateTextNode($env:PL_MESSAGE)) | Out-Null
$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))`;

export const COPY_SCRIPT = `Set-Clipboard -Value $env:PL_TEXT`;
export const OPEN_URL_SCRIPT = `Start-Process $env:PL_URL`;
