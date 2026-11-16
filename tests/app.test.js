import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { createApp, lanAddresses, phoneAddresses } from '../server.js';
import { sports, evaluate, nextTurn, timingAt } from '../public/games.js';

async function fixture(t) {
  const app = createApp(); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}`, ws: `ws://127.0.0.1:${app.server.address().port}/ws` };
}
async function client(url) {
  const ws = new WebSocket(url), queue = [], pending = [];
  ws.addEventListener('message', e => {
    const value = JSON.parse(e.data), i = pending.findIndex(p => p.type === value.type);
    if (i >= 0) { const p = pending.splice(i, 1)[0]; clearTimeout(p.timer); p.resolve(value); }
    else queue.push(value);
  });
  await once(ws, 'open');
  return { ws, send: value => ws.send(JSON.stringify(value)), get: type => {
    const i = queue.findIndex(msg => msg.type === type);
    if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { const p = { type, resolve }; p.timer = setTimeout(() => reject(new Error(`Timed out: ${type}`)), 2500); pending.push(p); });
  } };
}

test('phone links prefer home adapters and omit loopback, link-local and duplicate addresses', () => {
  const ipv4 = address => ({ address, family: 'IPv4', internal: false });
  const addresses = phoneAddresses({
    'vEthernet (WSL)': [ipv4('172.20.0.1')],
    Tailscale: [ipv4('100.64.0.2')],
    Ethernet: [ipv4('169.254.2.3')],
    'Wi-Fi': [ipv4('192.168.1.40'), { ...ipv4('192.168.1.40'), family: 4 },
      { address: 'fe80::1', family: 'IPv6', internal: false }],
    Loopback: [{ ...ipv4('127.0.0.1'), internal: true }, ipv4('127.0.0.2'), ipv4('0.0.0.0')]
  }, 4321, '123456');
  assert.deepEqual(addresses, ['192.168.1.40', '172.20.0.1', '100.64.0.2'].map(ip => `http://${ip}:4321/remote?code=123456`));
  assert.deepEqual(phoneAddresses({}, 3000, '123456'), []);
});
test('the adapter with a default gateway comes first, whatever Windows calls it', () => {
  const ipv4 = address => ({ address, family: 'IPv4', internal: false });
  const interfaces = { 'Ethernet 3': [ipv4('192.168.56.1')], 'Wi-Fi': [ipv4('192.168.1.183')] };
  assert.equal(phoneAddresses(interfaces, 3000, '123456')[0], 'http://192.168.56.1:3000/remote?code=123456', 'without gateway information the order is unchanged');
  assert.deepEqual(phoneAddresses(interfaces, 3000, '123456', 'https', ['192.168.1.183']), ['https://192.168.1.183:3000/remote?code=123456'],
    'a host-only adapter is never offered to phones once the home network is known');
  assert.deepEqual(lanAddresses(interfaces, ['192.168.1.183']), ['192.168.1.183', '192.168.56.1'], 'the certificate still names every address');
  assert.equal(phoneAddresses(interfaces, 3000, '123456', 'http', ['10.9.9.9']).length, 2, 'a stale gateway list never hides every address');
});
test('HTTP serves only public assets, join configuration and correct MIME types', async t => {
  const app = await fixture(t);
  for (const path of ['/', '/arcade', '/remote', '/phone-setup', '/style.css', '/dashboard.js', '/remote.js', '/games.js', '/kart.js', '/sports-match.js', '/race-view.js']) {
    const response = await fetch(app.base + path); assert.equal(response.status, 200); assert.ok((await response.text()).length > 100);
    if (path.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
  }
  for (const path of ['/server.js', '/package.json', '/.env', '/%2e%2e/check.py']) assert.equal((await fetch(app.base + path)).status, 404);
  const config = await (await fetch(app.base + '/config')).json(); assert.equal(config.code, app.code); assert.match(config.local, /\/remote\?code=\d{6}/);
});
test('another device on the network has to bring the room code from the TV, and cannot find it by guessing', async t => {
  const app = await fixture(t);
  // From here on every connection looks like a phone on the Wi-Fi.
  app.server.prependListener('connection', socket => Object.defineProperty(socket, 'remoteAddress', { value: '192.168.1.40' }));
  const config = await (await fetch(app.base + '/config')).text();
  assert.ok(!config.includes(app.code), 'the room code is not handed out');
  assert.equal(JSON.parse(config).joining, true);
  const stranger = await client(app.ws);
  stranger.send({ type: 'host' }); assert.equal((await stranger.get('error')).message, 'The arcade only runs on this PC.');
  stranger.send({ type: 'menu' }); assert.equal((await stranger.get('error')).message, 'The console menu only runs on this PC.');
  for (let i = 0; i < 5; i++) {
    stranger.send({ type: 'join', code: String(100000 + i) === app.code ? '999999' : String(100000 + i) });
    assert.equal((await stranger.get('error')).message, 'Room code does not match.');
  }
  stranger.send({ type: 'join', code: app.code });
  assert.match((await stranger.get('error')).message, /^Too many wrong room codes/, 'even the right code waits once the guesses run out');
  const another = await client(app.ws);
  another.send({ type: 'join', code: app.code });
  assert.match((await another.get('error')).message, /^Too many wrong room codes/, 'a fresh connection from the same address waits too');
  stranger.ws.close(); another.ws.close();
});
test('four phones pair, fifth is refused, inputs sanitized, rumble returned and freed slot reused', async t => {
  const app = await fixture(t), host = await client(app.ws); host.send({ type: 'host' });
  assert.equal((await host.get('roster')).players.filter(p => p.connected).length, 0);
  const phones = [];
  for (let i = 0; i < 4; i++) {
    const phone = await client(app.ws); phones.push(phone); phone.send({ type: 'join', code: app.code, name: `Guest ${i}` });
    const joined = await phone.get('joined'); assert.equal(joined.slot, i + 1); assert.match(joined.color, /^#/);
    const roster = await host.get('roster'); assert.equal(roster.players.filter(p => p.connected).length, i + 1);
  }
  const fifth = await client(app.ws); fifth.send({ type: 'join', code: app.code }); assert.match((await fifth.get('error')).message, /four/);
  phones[0].send({ type: 'input', x: 900, y: -900, pointing: true, swing: 5, shake: true, button: 'unknown', pressed: true, slot: 4 });
  const input = await host.get('input'); assert.equal(input.slot, 1); assert.equal(input.x, 1); assert.equal(input.y, -1); assert.equal(input.swing, 1); assert.equal(input.button, null); assert.equal(input.pointing, true); assert.equal(input.shake, true);
  host.send({ type: 'rumble', slot: 1, duration: 9999 }); assert.equal((await phones[0].get('rumble')).duration, 250);
  phones[0].ws.close(); const roster = await host.get('roster'); assert.equal(roster.players[0].connected, false);
  fifth.send({ type: 'join', code: app.code, name: '<script>long player name must be bounded</script>' });
  assert.equal((await fifth.get('joined')).slot, 1); const updated = await host.get('roster'); assert.equal(updated.players[0].name.length, 20);
});
test('wrong room code and duplicate host are rejected without consuming a slot', async t => {
  const app = await fixture(t), phone = await client(app.ws), host = await client(app.ws), secondHost = await client(app.ws);
  phone.send({ type: 'join', code: 'wrong' }); assert.match((await phone.get('error')).message, /code/);
  host.send({ type: 'host' }); await host.get('roster'); secondHost.send({ type: 'host' }); assert.match((await secondHost.get('error')).message, /already/);
  phone.send({ type: 'join', code: app.code }); assert.equal((await phone.get('joined')).slot, 1);
});
test('rapid button presses and releases survive sensor throttling', async t => {
  const app = await fixture(t), host = await client(app.ws), phone = await client(app.ws);
  host.send({ type: 'host' }); await host.get('roster');
  phone.send({ type: 'join', code: app.code }); await phone.get('joined');
  phone.send({ type: 'input', pointing: true, x: .5 });
  phone.send({ type: 'input', button: 'b', pressed: true });
  phone.send({ type: 'input', button: 'b', pressed: false, swing: .8 });
  assert.equal((await host.get('input')).pointing, true);
  assert.equal((await host.get('input')).pressed, true);
  const release = await host.get('input'); assert.equal(release.button, 'b'); assert.equal(release.pressed, false); assert.equal(release.swing, .8);
});
test('cancellation bypasses sensor throttling, uses the authenticated slot and precedes disconnect roster', async t => {
  const app = await fixture(t), host = await client(app.ws), phone = await client(app.ws);
  host.send({ type: 'host' }); await host.get('roster');
  phone.send({ type: 'join', code: app.code }); await phone.get('joined'); await host.get('roster');
  phone.send({ type: 'input', pointing: true, x: .5 });
  phone.send({ type: 'input', cancel: true, slot: 4 });
  assert.equal((await host.get('input')).pointing, true);
  const cancelled = await host.get('input');
  assert.equal(cancelled.cancel, true); assert.equal(cancelled.slot, 1);
  phone.send({ type: 'input', button: 'b', pressed: true });
  assert.equal((await host.get('input')).pressed, true);
  phone.ws.close();
  const disconnected = await host.get('input');
  assert.equal(disconnected.cancel, true); assert.equal(disconnected.slot, 1);
  assert.equal((await host.get('roster')).players[0].connected, false);
});

test('fragmented TCP delivery works; unmasked WebSocket frames are disconnected', async t => {
  const app = await fixture(t), socket = net.connect(app.server.address().port, '127.0.0.1');
  t.after(() => socket.destroy()); await once(socket, 'connect');
  socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${app.server.address().port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
  const [upgrade] = await once(socket, 'data'); assert.match(upgrade.toString(), /101 Switching/);
  const body = Buffer.from(JSON.stringify({ type: 'join', code: app.code })), mask = Buffer.from([1,2,3,4]);
  const encoded = Buffer.from(body.map((v, i) => v ^ mask[i % 4]));
  const response = once(socket, 'data'); socket.write(Buffer.from([0x81]));
  await new Promise(resolve => setImmediate(resolve)); socket.write(Buffer.concat([Buffer.from([0x80 | body.length]), mask, encoded]));
  const [reply] = await response; assert.match(reply.toString(), /joined/);
  const closed = once(socket, 'close'); socket.write(Buffer.from([0x81, 0])); await closed;
});
test('all five original sports reward aim, power or timing and produce bounded scores', () => {
  assert.equal(sports.length, 6); assert.equal(new Set(sports.map(s => s.name)).size, 6);
  for (const sport of sports.filter(s => s.id !== 'kart')) {
    const good = evaluate(sport.id, { aim: sport.id === 'golf' ? .15 : 0, power: sport.id === 'golf' ? .68 : 1, timing: .8 });
    const miss = evaluate(sport.id, { aim: -1, power: 0, timing: 0 });
    assert.ok(good.score > miss.score, sport.id); assert.ok(good.text.length > 0);
  }
  assert.equal(evaluate('bowling', { power: 1 }).score, 10);
  assert.equal(evaluate('baseball', { power: 1, timing: .8 }).score, 4);
  assert.ok(evaluate('boxing', { timing: .4, block: true }).score > evaluate('boxing', { timing: .4 }).score);
  for (let time = 0; time < 10000; time += 100) assert.ok(timingAt(time) >= 0 && timingAt(time) <= 1);
});
test('one to four players each receive exactly three turns and a finished match', () => {
  for (let count = 1; count <= 4; count++) {
    const players = Array(count).fill(0), turns = Array(count).fill(0); let state = { turn: 0, round: 1, finished: false };
    while (!state.finished) { turns[state.turn]++; state = nextTurn(players, state.turn, state.round); }
    assert.deepEqual(turns, Array(count).fill(3)); assert.equal(state.round, 4);
  }
});
test('client scripts parse and markup contains complete remote controls and permission UI', async () => {
  for (const file of ['server.js', 'public/dashboard.js', 'public/remote.js', 'public/games.js', 'public/kart.js', 'public/sports-match.js', 'public/race-view.js']) {
    const result = spawnSync(process.execPath, ['--check', new URL('../' + file, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const html = await readFile(new URL('../public/remote.html', import.meta.url), 'utf8');
  for (const button of ['up','down','left','right','a','b','minus','plus','home','one','two']) assert.ok(html.includes(`data-button="${button}"`));
  const js = await readFile(new URL('../public/remote.js', import.meta.url), 'utf8');
  for (const feature of ['requestPermission', 'deviceorientation', 'devicemotion', 'vibrate', 'isSecureContext', 'pointercancel', 'visibilitychange']) assert.ok(js.includes(feature));
});
