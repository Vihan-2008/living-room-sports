// The console back end wired into the room server, as the Wii Menu and the phones use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import dgram from 'node:dgram';
import { createApp } from '../server.js';
import { createConsole } from '../console/index.js';
import { crc32, PROTOCOL_VERSION } from '../console/dsu.js';
import { createDisplays } from '../console/screens.js';
import { fakeWindows, until, SECOND } from './fake-windows.js';

function discImage(id, title) {
  const buf = Buffer.alloc(0x440);
  buf.write(id, 0, 'latin1'); buf.writeUInt32BE(0x5d1c9ea3, 0x18); buf.write(title, 0x20, 'utf8');
  return buf;
}

// displays: a screen helper for the console; without one, screens are not reported and games cannot move.
async function fixture(t, { players, displays } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'lrs-api-'));
  const exe = join(dir, 'Dolphin-x64', 'Dolphin.exe'), userDir = join(dir, 'DolphinUser'), games = join(dir, 'Games');
  await mkdir(join(dir, 'Dolphin-x64'), { recursive: true }); await writeFile(exe, 'stub');
  await mkdir(join(games, 'Racing'), { recursive: true });
  await writeFile(join(games, 'Racing', 'Mario Kart Wii.iso'), discImage('RMCP01', 'MARIO KART WII'));
  await writeFile(join(games, 'Wii Sports.iso'), discImage('RSPE01', 'Wii Sports'));
  await writeFile(join(games, 'notes.txt'), 'not a game');
  const spawned = [], closed = [];
  const spawn = (file, args) => {
    const child = new EventEmitter(); child.pid = 7000 + spawned.length;
    spawned.push({ file, args, child }); setImmediate(() => child.emit('spawn'));
    return child;
  };
  const hooks = {
    spawn, findDolphin: async () => exe, resolveUserDir: async () => ({ dir: userDir, reason: 'test' }),
    processes: async () => spawned.filter(s => !s.exited).map(s => s.child.pid),
    close: async pid => { closed.push(pid); const s = spawned.find(x => x.child.pid === pid); if (s && !s.exited) { s.exited = true; s.child.emit('exit', 0, null); } },
    pick: async kind => (kind === 'dolphin' ? [exe] : [games]),
    ...(displays ? { displays } : {})
  };
  let app;
  const consoleApi = createConsole({ dataDir: join(dir, 'data'), dsuPort: 0, getPhones: () => app.roster(), hooks });
  if (players) await consoleApi.settings.save({ controls: { players } });
  await consoleApi.start();
  app = createApp({ console: consoleApi });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.close(); consoleApi.close(); await rm(dir, { recursive: true, force: true }); });
  const port = app.server.address().port;
  const call = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, body === undefined ? {} :
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Living-Room': '1' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { dir, exe, games, userDir, consoleApi, app, port, call, spawned, closed, ws: `ws://127.0.0.1:${port}/ws` };
}

async function client(url) {
  const ws = new WebSocket(url), queue = [], pending = [];
  ws.addEventListener('message', e => {
    const value = JSON.parse(e.data), i = pending.findIndex(p => p.type === value.type && p.match(value));
    if (i >= 0) { const p = pending.splice(i, 1)[0]; clearTimeout(p.timer); p.resolve(value); }
    else queue.push(value);
  });
  await once(ws, 'open');
  return { ws, send: value => ws.send(JSON.stringify(value)), drain: () => { queue.length = 0; }, get: (type, match = () => true) => {
    const i = queue.findIndex(msg => msg.type === type && match(msg));
    if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { const p = { type, match, resolve }; p.timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}; received ${JSON.stringify(queue)}`)), 3000); pending.push(p); });
  } };
}

function rawRequest(port, { method = 'GET', path = '/api/state', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
}

test('the console API answers only this PC, and only requests made by the menu', async t => {
  const f = await fixture(t);
  assert.equal((await rawRequest(f.port, { headers: { host: 'living-room.example' } })).status, 403, 'a page on another name must not read the API');
  assert.equal((await rawRequest(f.port, { method: 'POST', path: '/api/library/scan', headers: { 'content-type': 'application/json' } })).status, 403, 'a cross-site form post is refused');
  assert.equal((await rawRequest(f.port, { method: 'POST', path: '/api/library/scan', headers: { 'content-type': 'text/plain', 'x-living-room': '1' } })).status, 403);
  assert.equal((await f.call('/api/nothing-here')).status, 404);
  const state = await f.call('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.body.dolphin.found, false);
  assert.deepEqual(state.body.setup.map(s => [s.id, s.done]), [['dolphin', false], ['mkw', false], ['sports', false], ['resort', false]]);
  assert.match(state.body.setup[0].next, /Dolphin\.exe/);
});

test('first-run setup: find Dolphin, add a games folder, and the recognised titles are ready', async t => {
  const f = await fixture(t);
  const wrong = await f.call('/api/dolphin/path', { path: join(f.dir, 'notes.exe') });
  assert.equal(wrong.status, 400); assert.equal(wrong.body.code, 'not-dolphin'); assert.match(wrong.body.step, /Dolphin\.exe/);
  const found = await f.call('/api/dolphin/detect', {});
  assert.equal(found.status, 200); assert.equal(found.body.dolphin.path, f.exe); assert.equal(found.body.dolphin.userDir, f.userDir);
  const notDisc = await f.call('/api/library/add', { path: join(f.games, 'notes.txt') });
  assert.equal(notDisc.body.code, 'not-a-disc'); assert.match(notDisc.body.step, /\.iso/);
  const added = await f.call('/api/pick', { kind: 'games' });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.library.folders, [f.games]);
  assert.equal(added.body.library.discs.length, 2);
  assert.equal(added.body.library.titles.mkw.ready, true);
  assert.equal(added.body.library.titles.mkw.disc.region, 'Europe');
  assert.equal(added.body.library.titles.sports.ready, true);
  assert.equal(added.body.library.titles.resort.ready, false);
  const resort = added.body.setup.find(s => s.id === 'resort');
  assert.equal(resort.done, false); assert.match(resort.next, /Wii Sports Resort/);
  const removed = await f.call('/api/library/remove', { path: f.games });
  assert.equal(removed.body.library.discs.length, 0); assert.equal(removed.body.library.titles.mkw.ready, false);
});

test('launching from a channel starts Dolphin, tells the phones what to show, and Stop brings everyone back', async t => {
  const f = await fixture(t);
  await f.call('/api/dolphin/detect', {}); await f.call('/api/pick', { kind: 'games' });
  const phone = await client(f.ws); phone.send({ type: 'join', code: f.app.code, name: 'Sam' });
  assert.equal((await phone.get('joined')).slot, 2, 'phones take the positions set to Phone before the DualSense one');
  assert.equal((await phone.get('activity')).mode, 'menu');
  const missing = await f.call('/api/launch', { title: 'resort', sport: 'archery' });
  assert.equal(missing.status, 409); assert.equal(missing.body.code, 'no-game'); assert.match(missing.body.step, /Setup/);
  const launched = await f.call('/api/launch', { title: 'sports', sport: 'bowling' });
  assert.equal(launched.status, 200); assert.equal(launched.body.dolphin.running, true); assert.equal(launched.body.dolphin.sport, 'bowling');
  assert.equal(f.spawned.length, 1); assert.ok(f.spawned[0].args.includes('-e'));
  const activity = await phone.get('activity', a => a.mode === 'game');
  assert.deepEqual([activity.title, activity.sport, activity.nunchuk, activity.motionPlus], ['sports', 'bowling', false, false]);
  assert.deepEqual([activity.layout, activity.name, activity.detail], ['remote', 'Bowling', 'Wii Sports'], 'the phone can say what is running');
  assert.ok(activity.path.includes('Choose Bowling (3rd of 5)'), 'and how to reach it in the game\'s own menus');
  const busy = await f.call('/api/launch', { title: 'mkw' });
  assert.equal(busy.body.code, 'busy');
  // In a game the phone is Dolphin's controller: its B must not also reach the hidden menu (where it would
  // ask to close the game). Back on the menu its presses work the menu again.
  const menu = await client(f.ws); menu.send({ type: 'menu' }); await menu.get('room');
  phone.send({ type: 'input', button: 'b', pressed: true });
  phone.send({ type: 'quit' });
  assert.equal((await phone.get('activity', a => a.mode === 'menu')).mode, 'menu');
  phone.send({ type: 'input', button: 'a', pressed: true });
  assert.equal((await menu.get('input')).button, 'a');
  assert.deepEqual(f.closed, [7000]);
  const after = await f.call('/api/state');
  assert.equal(after.body.dolphin.running, false); assert.equal(after.body.dolphin.lastExit.title, 'sports');
  assert.equal((await f.call('/api/exit/dismiss', {})).body.dolphin.lastExit, null);
});

test('the menu socket gets the room, the roster and live console state; phones cannot ask for it', async t => {
  const f = await fixture(t);
  const menu = await client(f.ws); menu.send({ type: 'menu' });
  assert.equal((await menu.get('room')).code, f.app.code);
  assert.equal((await menu.get('roster')).players.length, 4);
  assert.equal((await menu.get('console')).state.dolphin.found, false);
  await f.call('/api/dolphin/detect', {});
  assert.equal((await menu.get('console', m => m.state.dolphin.found)).state.dolphin.path, f.exe);
  const phone = await client(f.ws); phone.send({ type: 'join', code: f.app.code });
  await phone.get('joined');
  phone.send({ type: 'menu' });
  phone.send({ type: 'kick', slot: 2 });
  phone.send({ type: 'pad', b: ['a'], s: [0, 0] });
  const pad = await menu.get('pad');
  assert.deepEqual([pad.slot, pad.b], [2, ['a']], 'live controller state reaches the controller test screen');
});

test('a phone\'s pad reaches Dolphin over DSU on its own player number', async t => {
  const f = await fixture(t);
  const dsuPort = f.consoleApi.dsu.port;
  const udp = dgram.createSocket('udp4'); udp.bind(0, '127.0.0.1'); await once(udp, 'listening');
  t.after(() => udp.close());
  const subscribe = Buffer.alloc(28);
  subscribe.write('DSUC', 0, 'latin1'); subscribe.writeUInt16LE(PROTOCOL_VERSION, 4); subscribe.writeUInt16LE(12, 6);
  subscribe.writeUInt32LE(99, 12); subscribe.writeUInt32LE(0x100002, 16); subscribe[20] = 1; subscribe[21] = 1;
  subscribe.writeUInt32LE(crc32(subscribe), 8);
  udp.send(subscribe, dsuPort, '127.0.0.1');
  const phone = await client(f.ws); phone.send({ type: 'join', code: f.app.code });
  assert.equal((await phone.get('joined')).slot, 2);
  const pressed = new Promise(resolve => udp.on('message', msg => { if (msg[20] === 1 && msg[37] & 0x40) resolve(msg); }));
  phone.send({ type: 'pad', b: ['a', 'nope'], s: [0, 1], a: [0, 0, 1], g: [120, 0, 0] });
  const packet = await pressed;
  assert.equal(packet[41], 255, 'stick up');
  assert.equal(packet.readFloatLE(88), 120, 'gyro pitch');
  const released = new Promise(resolve => udp.on('message', msg => { if (msg[20] === 1 && !(msg[37] & 0x40)) resolve(msg); }));
  phone.ws.close();
  assert.equal((await released)[37], 0, 'a phone that leaves lets go of every button');
});

test('phones get their own slot back after a drop, but not after being removed; joining can be closed', async t => {
  const f = await fixture(t, { players: ['phone', 'phone', 'dualsense', 'phone'] });
  const menu = await client(f.ws); menu.send({ type: 'menu' }); await menu.get('room');
  const first = await client(f.ws); first.send({ type: 'join', code: f.app.code, clientId: 'phone-aaaa-1111' });
  assert.equal((await first.get('joined')).slot, 1);
  const second = await client(f.ws); second.send({ type: 'join', code: f.app.code, clientId: 'phone-bbbb-2222' });
  assert.equal((await second.get('joined')).slot, 2);
  first.ws.close(); await menu.get('roster', r => !r.players[0].connected);
  const stranger = await client(f.ws); stranger.send({ type: 'join', code: f.app.code });
  assert.equal((await stranger.get('joined')).slot, 4, 'a newcomer skips the reserved slot and the DualSense position');
  const back = await client(f.ws); back.send({ type: 'join', code: f.app.code, clientId: 'phone-aaaa-1111' });
  const rejoined = await back.get('joined'); assert.deepEqual([rejoined.slot, rejoined.returning], [1, true]);
  menu.send({ type: 'kick', slot: 2 });
  await second.get('kicked');
  await menu.get('roster', r => !r.players[1].connected);
  menu.drain();
  menu.send({ type: 'joining', open: false });
  await menu.get('console', m => m.state.settings.phones.joining === false);
  const late = await client(f.ws); late.send({ type: 'join', code: f.app.code, clientId: 'phone-bbbb-2222' });
  assert.match((await late.get('error')).message, /Joining is closed/);
  menu.drain();
  menu.send({ type: 'joining', open: true });
  await menu.get('console', m => m.state.settings.phones.joining === true);
  const retry = await client(f.ws); retry.send({ type: 'join', code: f.app.code, clientId: 'phone-bbbb-2222' });
  assert.equal((await retry.get('joined')).returning, false, 'a removed phone joins as new');
});

test('the menu and the phones can move a running game to the other screen, and the screens are reported', async t => {
  const windows = fakeWindows({ window: { x: 0, y: 0, width: 1920, height: 1080 } });
  const f = await fixture(t, { displays: createDisplays({ run: windows.run }) });
  const listed = await f.call('/api/screens', {});
  assert.deepEqual(listed.body.screens.map(s => [s.name, s.width, s.height]), [['Main screen', 1920, 1080], ['Second screen', 2560, 1600]]);
  const idle = await f.call('/api/screen', { to: 'next' });
  assert.equal(idle.status, 409); assert.equal(idle.body.code, 'not-running');
  await f.call('/api/dolphin/detect', {}); await f.call('/api/pick', { kind: 'games' });
  const phone = await client(f.ws); phone.send({ type: 'join', code: f.app.code });
  await phone.get('joined');
  await f.call('/api/launch', { title: 'sports', sport: 'tennis' });
  const playing = await phone.get('activity', a => a.mode === 'game');
  assert.deepEqual([playing.screens, playing.screen], [2, 'Main screen'], 'the phone knows there is another screen, and which one the game is on');
  const moved = await f.call('/api/screen', { to: 'next' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.settings.launch.screen, SECOND, 'kept for the next game');
  assert.equal(windows.window.x, 1920);
  assert.equal((await phone.get('activity', a => a.screen === 'Second screen')).mode, 'game', 'the phone is told where the game went');
  phone.send({ type: 'screen' });
  await until(() => windows.window.x === 0);
  assert.equal((await phone.get('activity', a => a.screen === 'Main screen')).mode, 'game');
  await until(async () => (await f.call('/api/state')).body.settings.launch.screen === 'main');
});
