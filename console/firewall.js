// Whether Windows Firewall lets phones reach this server on the network the PC is on. Windows asks once whether a
// program may use the network and keeps the answer for each kind of network, so a program allowed on Public
// networks only is quietly blocked when the Wi-Fi is set to Private, and the other way round. Phones then cannot
// open the QR code's link at all, while everything still works from the PC itself.
import { execFile, spawn } from 'node:child_process';

// Prints the networks with a default gateway, the firewall's profiles and every inbound rule for the program in
// LRS_PROGRAM, as JSON. Everything is read; nothing is changed.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$program = $env:LRS_PROGRAM
$networks = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.NetProfile.Name; category = [string]$_.NetProfile.NetworkCategory } })
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.Name; enabled = [string]$_.Enabled; inbound = [string]$_.DefaultInboundAction } })
$rules = @(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Where-Object { [Environment]::ExpandEnvironmentVariables($_.Program) -eq $program } | ForEach-Object {
  $rule = $_ | Get-NetFirewallRule -PolicyStore ActiveStore
  if ([string]$rule.Enabled -eq 'True' -and [string]$rule.Direction -eq 'Inbound') {
    $port = $rule | Get-NetFirewallPortFilter -PolicyStore ActiveStore
    [pscustomobject]@{ name = [string]$rule.DisplayName; action = [string]$rule.Action; profile = [string]$rule.Profile; protocol = [string]$port.Protocol; ports = [string]($port.LocalPort -join ',') } } })
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[pscustomobject]@{ networks = $networks; profiles = $profiles; rules = $rules } | ConvertTo-Json -Depth 4 -Compress`;

const list = value => (Array.isArray(value) ? value : value ? [value] : []);

// report: what SCRIPT printed. ports: the ports phones use. Returns { blocked, network, category, rule } for the
// first network that keeps phones out, or { blocked: false }. A matching block rule always wins; otherwise a
// matching allow rule lets phones in, and without one the profile's default for incoming connections decides.
export function firewallVerdict(report, ports) {
  const profiles = list(report?.profiles), rules = list(report?.rules);
  for (const network of list(report?.networks)) {
    const category = network.category === 'DomainAuthenticated' ? 'Domain' : network.category;
    const profile = profiles.find(p => p.name === category);
    if (!profile || profile.enabled === 'False') continue;
    const applies = rule => (rule.profile === 'Any' || String(rule.profile).split(/,\s*/).includes(category))
      && ['TCP', 'Any'].includes(rule.protocol)
      && ports.every(port => rule.ports === 'Any' || String(rule.ports).split(',').includes(String(port)));
    const matching = rules.filter(applies);
    const blocked = matching.some(r => r.action === 'Block') || (!matching.some(r => r.action === 'Allow') && profile.inbound !== 'Allow');
    if (blocked) return { blocked: true, network: network.name || 'this network', category, rule: rules[0]?.name || null };
  }
  return { blocked: false };
}

// What Connect controllers says about a block, and the exact steps in Windows' list of allowed programs. program:
// the node.exe the firewall has to let in, named when Windows has no rule for it yet.
export function firewallAdvice({ network, category, rule }, program) {
  const fix = rule
    ? `Press Open firewall settings, then Change settings. Tick ${category} next to ${rule}, press OK, then press Check again.`
    : `Press Open firewall settings, then Change settings and Allow another app. Browse to ${program}, press Add, tick ${category} next to it and press OK, then press Check again.`;
  return { message: `Phones cannot reach this PC: Windows Firewall blocks Node.js on ${network}, a ${category} network.`, next: fix };
}

function runScript(program) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 30000, encoding: 'utf8', env: { ...process.env, LRS_PROGRAM: program } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

// Resolves to the verdict for this program, or null when Windows could not say (or this is not Windows).
export async function checkFirewall({ program = process.execPath, ports, run = process.platform === 'win32' ? runScript : null }) {
  if (!run) return null;
  try { return firewallVerdict(JSON.parse(await run(program)), ports); } catch { return null; }
}

// Windows' list of programs allowed through the firewall, where Private and Public are ticked per program.
export function openFirewallSettings(run = spawn) {
  if (process.platform !== 'win32' && run === spawn) return;
  run('control.exe', ['/name', 'Microsoft.WindowsFirewall', '/page', 'pageConfigureApps'], { detached: true, stdio: 'ignore', windowsHide: false }).unref?.();
}
