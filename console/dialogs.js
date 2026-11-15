// Native Windows "Open" dialogs, shown on top of the console window, for choosing Dolphin and game files.
import { spawn } from 'node:child_process';

const FILTERS = {
  dolphin: { title: 'Choose Dolphin.exe', filter: 'Dolphin (Dolphin.exe)|Dolphin.exe|Programs (*.exe)|*.exe', multi: false },
  games: { title: 'Choose Wii game files', filter: 'Wii and GameCube discs (*.iso;*.wbfs;*.rvz;*.wia;*.gcz;*.ciso;*.gcm)|*.iso;*.wbfs;*.rvz;*.wia;*.gcz;*.ciso;*.gcm|All files (*.*)|*.*', multi: true }
};

function script(kind) {
  const common = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = 'CenterScreen' }",
    '$owner.Show(); $owner.Activate()'
  ];
  if (kind === 'folder') {
    return [...common,
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$d.Description = 'Choose a folder with your Wii games. Subfolders are searched too.'",
      '$d.ShowNewFolderButton = $false',
      'if ($env:LRS_INITIAL -and (Test-Path -LiteralPath $env:LRS_INITIAL)) { $d.SelectedPath = $env:LRS_INITIAL }',
      "if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath }"].join('\n');
  }
  const { title, filter, multi } = FILTERS[kind];
  return [...common,
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    `$d.Title = '${title}'`,
    `$d.Filter = '${filter}'`,
    `$d.Multiselect = $${multi}`,
    'if ($env:LRS_INITIAL -and (Test-Path -LiteralPath $env:LRS_INITIAL)) { $d.InitialDirectory = $env:LRS_INITIAL }',
    "if ($d.ShowDialog($owner) -eq 'OK') { $d.FileNames -join \"`n\" }"].join('\n');
}

let busy = false;
// Resolves to the chosen paths ([] when cancelled). kind: 'dolphin' | 'games' | 'folder'.
export function pick(kind, { initial = '', run = spawn } = {}) {
  if (!['dolphin', 'games', 'folder'].includes(kind)) return Promise.reject(new Error('Unknown picker'));
  if (process.platform !== 'win32' && run === spawn) return Promise.reject(Object.assign(new Error('File pickers need Windows. Type the path instead.'), { code: 'unsupported' }));
  if (busy) return Promise.reject(Object.assign(new Error('A file picker is already open.'), { code: 'busy' }));
  busy = true;
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script(kind), 'utf16le').toString('base64');
    const child = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, env: { ...process.env, LRS_INITIAL: initial }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', error => { busy = false; reject(error); });
    child.on('close', code => {
      busy = false;
      if (code !== 0) return reject(new Error('The file picker could not open.'));
      resolve(out.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    });
  });
}
