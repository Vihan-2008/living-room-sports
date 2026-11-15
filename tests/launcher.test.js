import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, linkSync, copyFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { createApp } from '../server.js';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const windowsOnly = process.platform !== 'win32' && 'the desktop launcher is Windows-only';
let work;
const workDir = () => (work ??= mkdtempSync(join(tmpdir(), 'lrs-launcher-')));
after(() => { if (work) rmSync(work, { recursive: true, force: true, maxRetries: 5 }); });

let built;
function build() {
  if (built) return built;
  const dir = workDir();
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(project, 'launcher', 'install.ps1'),
    '-OutDir', join(dir, 'bin'), '-ShortcutDir', join(dir, 'shortcuts')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  built = { exe: join(dir, 'bin', 'LivingRoomSports.exe'), ico: join(dir, 'bin', 'LivingRoomSports.ico'), lnk: join(dir, 'shortcuts', 'Living Room Sports.lnk') };
  return built;
}

async function freePort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close(); await once(server, 'close');
  return port;
}

// Runs the launcher without blocking this event loop, so servers in this process can answer it.
let runs = 0;
async function launch(args, dataDir = join(workDir(), `data-${++runs}`)) {
  const child = spawn(build().exe, [...args, '--data-dir', dataDir]);
  const timer = setTimeout(() => child.kill(), 30000);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  return { code, dataDir, log: readFileSync(join(dataDir, 'launcher.log'), 'utf8') };
}
const localState = dataDir => JSON.parse(readFileSync(join(dataDir, 'browser-profile', 'Local State'), 'utf8'));

const listening = port => new Promise(resolve => {
  const socket = net.connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

test('the app icon is served and linked from the dashboard and the remote', async t => {
  const app = createApp(); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const res = await fetch(`http://127.0.0.1:${app.server.address().port}/icon.svg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  assert.match(await res.text(), /^<svg [^>]*viewBox="0 0 256 256"/);
  for (const page of ['index.html', 'arcade.html', 'remote.html', 'phone-setup.html'])
    assert.match(await readFile(join(project, 'public', page), 'utf8'), /<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml">/);
});

test('installer builds the launcher, a multi-size icon and a shortcut to it', { skip: windowsOnly }, () => {
  const { exe, ico, lnk } = build();
  assert.ok(existsSync(exe), 'launcher exe');
  const icon = readFileSync(ico);
  assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0], 'ICO header');
  const sizes = Array.from({ length: icon.readUInt16LE(4) }, (_, i) => icon[6 + 16 * i] || 256);
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
  const read = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}'); "$($s.TargetPath)|$($s.WorkingDirectory)|$($s.IconLocation)"`], { encoding: 'utf8' });
  const [target, workingDir, iconLocation] = read.stdout.trim().split('|');
  assert.equal(target.toLowerCase(), exe.toLowerCase());
  assert.equal(workingDir.toLowerCase(), project.toLowerCase());
  assert.equal(iconLocation.toLowerCase(), `${exe},0`.toLowerCase());
});

test('launcher starts the server on the chosen port, confirms it, and stops it on exit', { skip: windowsOnly }, async () => {
  const port = await freePort();
  const { code, log, dataDir } = await launch(['--check', '--port', String(port), '--project', project]);
  assert.equal(code, 0, log);
  assert.match(log, /Started server \(pid \d+\)/);
  assert.deepEqual(localState(dataDir), { background_mode: { enabled: false } }, 'new browser profile cannot linger in the background');
  assert.match(log, new RegExp(`\\[server\\] Living Room Sports: http://localhost:${port}`));
  assert.match(log, /Window: maximized\./);
  assert.match(log, /Check passed\.[\s\S]*Stopping server\./);
  assert.equal(await listening(port), false, 'server stopped with the launcher');
});

test('launcher reuses a Living Room Sports server that is already running', { skip: windowsOnly }, async t => {
  const app = createApp(); app.server.listen(await freePort(), '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const port = app.server.address().port;
  const { code, log } = await launch(['--check', '--port', String(port), '--project', project]);
  assert.equal(code, 0, log);
  assert.match(log, /already running on port \d+; reusing it/);
  assert.doesNotMatch(log, /Started server|Stopping server/);
  assert.equal(await listening(port), true, 'existing server left running');
});

test('launcher reports a port taken by another program instead of starting a second server', { skip: windowsOnly }, async t => {
  const other = http.createServer((req, res) => { res.writeHead(404); res.end('not this app'); });
  other.listen(0, '127.0.0.1'); await once(other, 'listening');
  t.after(() => other.close());
  const { code, log } = await launch(['--check', '--port', String(other.address().port), '--project', project]);
  assert.equal(code, 1);
  assert.match(log, /already in use by another program/);
  assert.doesNotMatch(log, /Started server/);
});

test('launcher refuses a folder without the game files', { skip: windowsOnly }, async () => {
  const empty = mkdtempSync(join(workDir(), 'empty-'));
  const child = spawn(build().exe, ['--check', '--port', String(await freePort()), '--project', empty, '--data-dir', join(empty, 'data')]);
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.equal(existsSync(join(empty, 'data', 'launcher.log')), false, 'fails before starting anything');
});

test('launcher turns off background mode in an existing game profile and keeps its other settings', { skip: windowsOnly }, async () => {
  const dataDir = join(workDir(), 'seeded');
  mkdirSync(join(dataDir, 'browser-profile'), { recursive: true });
  const before = { background_mode: { enabled: true, other: 'kept' }, browser: { last_time: '13439235490199618', list: [1, 'two', { three: 3.5 }] } };
  writeFileSync(join(dataDir, 'browser-profile', 'Local State'), JSON.stringify(before));
  const { code, log } = await launch(['--check', '--port', String(await freePort()), '--project', project], dataDir);
  assert.equal(code, 0, log);
  assert.deepEqual(localState(dataDir), { ...before, background_mode: { enabled: false, other: 'kept' } });
});

// A stand-in project whose server answers like Living Room Sports: `state` is the body of a function that
// returns what /api/state reports, and `setup` runs first.
function fakeProject(name, { setup = '', state = 'return {};' } = {}) {
  const fake = mkdtempSync(join(workDir(), `${name}-`));
  mkdirSync(join(fake, 'public'));
  writeFileSync(join(fake, 'public', 'index.html'), '<!doctype html>');
  writeFileSync(join(fake, 'server.js'), `const http = require('node:http');
${setup}
const state = () => { ${state} };
http.createServer((req, res) => res.end(JSON.stringify(req.url === '/api/state' ? state() : { code: '123456', addresses: [] })))
  .listen(Number(process.env.PORT), '127.0.0.1');`);
  return fake;
}

test('the portable build\'s own Node.js is used, and the server learns where the launcher and settings are', { skip: windowsOnly }, async () => {
  const fake = fakeProject('portable', { setup: "console.log('node=' + process.execPath + ' launcher=' + process.env.LRS_LAUNCHER + ' data=' + process.env.LRS_DATA_DIR);" });
  mkdirSync(join(fake, 'runtime'));
  const bundled = join(fake, 'runtime', 'node.exe');
  try { linkSync(process.execPath, bundled); } catch { copyFileSync(process.execPath, bundled); }
  const dataDir = join(fake, 'data');
  mkdirSync(dataDir);
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ display: { startFullscreen: true } }));
  const { code, log } = await launch(['--check', '--port', String(await freePort()), '--project', fake], dataDir);
  assert.equal(code, 0, log);
  assert.ok(log.includes(`Started server`) && log.includes(`with ${bundled}`), log);
  assert.ok(log.includes(`node=${bundled} launcher=${build().exe} data=${dataDir}`), log);
  assert.match(log, /Window: full screen\./, 'Wii Options › Start full screen is honoured');
});

test('--focus never starts anything or shows a message, with or without a window to focus', { skip: windowsOnly }, async () => {
  const dataDir = join(workDir(), 'focus');
  const started = Date.now();
  const nothingOpen = spawn(build().exe, ['--focus', '--port', String(await freePort()), '--data-dir', dataDir]);
  assert.deepEqual(await once(nothingOpen, 'exit'), [0, null]);
  assert.ok(Date.now() - started < 10000);
  assert.equal(existsSync(dataDir), false, 'no log, profile or server');
  // A process with no window: --focus waits for one only while the process lives.
  const windowless = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']);
  const focus = spawn(build().exe, ['--focus', '--port', '3000', '--pid', String(windowless.pid)]);
  assert.deepEqual(await once(focus, 'exit'), [0, null]);
  const gone = spawn(build().exe, ['--focus', '--pid', '999999']);
  assert.deepEqual(await once(gone, 'exit'), [0, null], 'a process that has already ended is not an error');
});

test('closing the Wii Menu during a game keeps the server up, and the menu returns when the game ends', { skip: windowsOnly }, async () => {
  // A "browser" with no window that closes after a moment, as if the player closed the Wii Menu.
  const dir = mkdtempSync(join(workDir(), 'browser-'));
  writeFileSync(join(dir, 'browser.cs'), 'static class Browser { static void Main() { System.Threading.Thread.Sleep(1500); } }');
  const csc = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const compiled = spawnSync(csc, ['/nologo', '/target:winexe', `/out:${join(dir, 'browser.exe')}`, join(dir, 'browser.cs')], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout);
  // The game ends four seconds after the server starts.
  const fake = fakeProject('game', { setup: 'const started = Date.now();', state: 'return { dolphin: { running: Date.now() - started < 4000 } };' });
  const port = await freePort();
  const { code, log } = await launch(['--port', String(port), '--project', fake, '--browser', join(dir, 'browser.exe')]);
  assert.equal(code, 0, log);
  const events = log.split(/\r?\n/).map(line => line.slice(14)).filter(line => /^(Opening app window|App window closed|The window closed|Opening the Wii Menu|Stopping server)/.test(line));
  assert.deepEqual(events.map(line => line.split(':')[0].split(';')[0]), ['Opening app window', 'App window closed.', 'The window closed while a game is running',
    'Opening the Wii Menu again.', 'Opening app window', 'App window closed.', 'Stopping server.']);
  assert.equal(await listening(port), false, 'and once the menu is closed with no game running, everything stops');
});

test('the portable build runs on its own: launcher, server, pages and Node.js in one folder', { skip: windowsOnly }, async () => {
  const out = join(workDir(), 'package');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(project, 'launcher', 'package.ps1'), '-OutDir', out, '-NoZip'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const folder = join(out, 'Living Room Sports');
  for (const file of ['Living Room Sports.exe', 'Add Shortcuts.cmd', 'server.js', 'qr.js', 'package.json', 'README.md', 'public/index.html', 'public/remote.html',
    'public/phone-setup.html', 'console/dolphin.js', 'runtime/node.exe', 'runtime/Node.js LICENSE.txt']) assert.ok(existsSync(join(folder, file)), file);
  for (const left of ['tests', 'launcher', '.claude', 'check.py', 'AGENTS.md']) assert.equal(existsSync(join(folder, left)), false, `${left} stays out`);
  const port = await freePort(), dataDir = join(workDir(), 'portable-data');
  const child = spawn(join(folder, 'Living Room Sports.exe'), ['--check', '--port', String(port), '--data-dir', dataDir]);
  const [code] = await once(child, 'exit');
  const log = readFileSync(join(dataDir, 'launcher.log'), 'utf8');
  assert.equal(code, 0, log);
  assert.ok(log.includes(`with ${join(folder, 'runtime', 'node.exe')}`), log);
  assert.ok(log.includes(`[server] Living Room Sports: http://localhost:${port}`), log);
  assert.ok(existsSync(join(dataDir, 'settings.json')), 'the server keeps its settings in the launcher\'s data folder');
});
