#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-time Windows setup so devices on the same Wi-Fi (ESP32) can reach the
  MQTT broker running in Docker inside WSL2.

.DESCRIPTION
  By default WSL2 sits behind its own NAT (172.x), so ports Docker publishes
  inside WSL are only reachable from this PC's localhost, and Windows Firewall
  blocks inbound connections anyway. This script:
    1. sets networkingMode=mirrored in %USERPROFILE%\.wslconfig (WSL shares
       Windows' network interfaces, so the broker listens on the LAN IP);
    2. switches connected Public networks to Private (the firewall rules
       below only apply to Private networks);
    3. allows inbound TCP on the MQTT port in both Windows Defender Firewall
       and the Hyper-V firewall that guards WSL in mirrored mode;
    4. prints the LAN IP(s) to put in the ESP32 firmware;
    5. runs `wsl --shutdown` so WSL restarts with the new network mode.
  Safe to re-run: existing settings/rules are detected and left alone.

  Run from an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File \\wsl.localhost\Ubuntu\<repo>\scripts\setup-windows-lan.ps1

.PARAMETER Port
  MQTT port to open (default 1883, as published by docker-compose).

.PARAMETER SkipNetworkProfile
  Don't change any network to Private.

.PARAMETER NoShutdown
  Don't run `wsl --shutdown` at the end (do it yourself, or reboot, before
  the .wslconfig change takes effect).

.PARAMETER Force
  Run `wsl --shutdown` without asking for confirmation.
#>
param(
  [int]$Port = 1883,
  [switch]$SkipNetworkProfile,
  [switch]$NoShutdown,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Fixed id of the WSL VM creator, used to scope Hyper-V firewall rules to WSL.
$WslVmCreatorId = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
$RuleName = "IoT-MQTT-$Port"
$RuleDisplayName = "IoT MQTT $Port (WSL)"

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "    [ok] $text" -ForegroundColor Green }
function Write-Skip($text) { Write-Host "    [skip] $text" -ForegroundColor DarkGray }
function Write-Warn2($text){ Write-Host "    [warn] $text" -ForegroundColor Yellow }

# Mirrored networking needs Windows 11 22H2 (build 22621) or newer.
$build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
if ($build -lt 22621) {
  throw "Windows build $build does not support WSL mirrored networking (needs 22621+ / Windows 11 22H2)."
}

# --- 1. .wslconfig -----------------------------------------------------------
Write-Step "WSL networking mode (.wslconfig)"
$wslConfigPath = Join-Path $env:USERPROFILE '.wslconfig'
$lines = @()
if (Test-Path $wslConfigPath) { $lines = @(Get-Content $wslConfigPath) }

$sectionStart = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i].Trim() -ieq '[wsl2]') { $sectionStart = $i; break }
}

$changed = $false
if ($sectionStart -lt 0) {
  if ($lines.Count -gt 0 -and $lines[-1].Trim() -ne '') { $lines += '' }
  $lines += '[wsl2]', 'networkingMode=mirrored'
  $changed = $true
} else {
  # Look for an existing networkingMode line inside [wsl2] (until the next section).
  $found = $false
  for ($i = $sectionStart + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim().StartsWith('[')) { break }
    if ($lines[$i] -match '^\s*networkingMode\s*=\s*(.*)$') {
      $found = $true
      if ($Matches[1].Trim() -ine 'mirrored') {
        $lines[$i] = 'networkingMode=mirrored'
        $changed = $true
      }
      break
    }
  }
  if (-not $found) {
    $before = if ($sectionStart -ge 0) { $lines[0..$sectionStart] } else { @() }
    $after = if ($sectionStart + 1 -lt $lines.Count) { $lines[($sectionStart + 1)..($lines.Count - 1)] } else { @() }
    $lines = @($before) + 'networkingMode=mirrored' + @($after)
    $changed = $true
  }
}

if ($changed) {
  if (Test-Path $wslConfigPath) {
    Copy-Item $wslConfigPath "$wslConfigPath.bak" -Force
    Write-Ok "backed up existing file to $wslConfigPath.bak"
  }
  # UTF-8 without BOM - WSL reads this file itself.
  [System.IO.File]::WriteAllText($wslConfigPath, (($lines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok "networkingMode=mirrored written to $wslConfigPath"
} else {
  Write-Skip "already mirrored in $wslConfigPath"
}

# --- 2. Network profile ----------------------------------------------------
Write-Step "Network profile (Public -> Private)"
if ($SkipNetworkProfile) {
  Write-Skip "skipped (-SkipNetworkProfile)"
} else {
  $profiles = Get-NetConnectionProfile |
    Where-Object { $_.IPv4Connectivity -in @('LocalNetwork', 'Internet') }
  foreach ($p in $profiles) {
    if ($p.NetworkCategory -eq 'Public') {
      Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private
      Write-Ok "'$($p.Name)' ($($p.InterfaceAlias)) set to Private"
    } else {
      Write-Skip "'$($p.Name)' ($($p.InterfaceAlias)) is already $($p.NetworkCategory)"
    }
  }
  Write-Host "    Note: a Wi-Fi/hotspot you join later starts as Public - re-run this script there." -ForegroundColor DarkGray
}

# --- 3. Firewall rules -------------------------------------------------------
Write-Step "Firewall rules for TCP $Port"
if (Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue) {
  Write-Skip "Windows Defender Firewall rule '$RuleName' already exists"
} else {
  New-NetFirewallRule -Name $RuleName -DisplayName $RuleDisplayName -Direction Inbound `
    -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
  Write-Ok "Windows Defender Firewall: allow inbound TCP $Port on Private networks"
}

if (Get-NetFirewallHyperVRule -Name $RuleName -ErrorAction SilentlyContinue) {
  Write-Skip "Hyper-V firewall rule '$RuleName' already exists"
} else {
  New-NetFirewallHyperVRule -Name $RuleName -DisplayName $RuleDisplayName -Direction Inbound `
    -VMCreatorId $WslVmCreatorId -Protocol TCP -LocalPorts $Port | Out-Null
  Write-Ok "Hyper-V firewall (WSL): allow inbound TCP $Port"
}

# --- 4. LAN IPs --------------------------------------------------------------
Write-Step "LAN IP(s) of this PC - use the one on the same network as the ESP32"
Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
  ForEach-Object {
    $name = (Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Name
    Write-Host ("    {0,-16} {1}  (network: {2})" -f $_.IPv4Address.IPAddress, $_.InterfaceAlias, $name) -ForegroundColor White
  }
Write-Host "    ESP32 firmware: broker = <that IP>, port = $Port" -ForegroundColor DarkGray

# --- 5. Restart WSL ----------------------------------------------------------
Write-Step "Restart WSL to apply the network mode"
if (-not $changed) {
  Write-Skip "network mode unchanged, no restart needed"
} elseif ($NoShutdown) {
  Write-Warn2 "not restarting (-NoShutdown) - run 'wsl --shutdown' or reboot before testing"
} else {
  if (-not $Force) {
    $answer = Read-Host "    This stops WSL and all running containers (data is kept). Run 'wsl --shutdown' now? [Y/n]"
    if ($answer -and $answer.Trim() -notmatch '^(y|yes)$') {
      Write-Warn2 "skipped - run 'wsl --shutdown' or reboot before testing"
      $changed = $false
    }
  }
  if ($changed) {
    wsl.exe --shutdown
    Write-Ok "WSL stopped. Open Ubuntu again; containers come back via systemd (or run ./run.sh start)."
  }
}

Write-Host "`nDone. Check from a phone on the same Wi-Fi with an MQTT client (e.g. MQTT Explorer) -> <LAN IP>:$Port`n" -ForegroundColor Green
