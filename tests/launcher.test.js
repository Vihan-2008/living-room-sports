import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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
  for (const page of ['index.html', 'remote.html'])
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
