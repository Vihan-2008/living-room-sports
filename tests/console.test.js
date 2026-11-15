import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import dgram from 'node:dgram';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { createSettings, defaults, sanitize } from '../console/settings.js';
import { identify, recognize, scanLibrary, chooseTitles } from '../console/disc.js';
import { setValues, readValue, createJournal } from '../console/ini.js';
import { buildLaunchPlan, wiimoteProfile, phoneDevice } from '../console/profiles.js';
import { createDsuServer, crc32, padFromPhone, PROTOCOL_VERSION } from '../console/dsu.js';
import { createAuthority, issueServerCertificate, createCertificateStore, isPermittedAddress } from '../console/certs.js';
import { candidatePaths, findDolphin, resolveUserDir, classifyExit, launchArgs, dsuEntries, createDolphinManager, asksForWiiMenu, followLog } from '../console/dolphin.js';
import { createDisplays } from '../console/screens.js';
import { fakeWindows, until, SECOND, MAIN_ONLY } from './fake-windows.js';
import { PHONE_TO_DSU, mkwRows, remoteRows } from '../public/bindings.js';
import { SPORTS, ENTRY_COUNT, activityNeeds, activityGuide, MKW_MODES, sportById } from '../public/catalog.js';

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lrs-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// ---- Disc images ----------------------------------------------------------------------------
function discHeader(id, title, wii = true) {
  const buf = Buffer.alloc(0x440);
  buf.write(id, 0, 'latin1');
  if (wii) buf.writeUInt32BE(0x5d1c9ea3, 0x18); else buf.writeUInt32BE(0xc2339f3d, 0x1c);
  buf.write(title, 0x20, 'utf8');
  return buf;
}
const images = {
  iso: (id, title) => discHeader(id, title),
  wbfs: (id, title) => { const b = Buffer.alloc(0x800); b.write('WBFS', 0, 'latin1'); discHeader(id, title).copy(b, 0x200, 0, 0x100); return b; },
  rvz: (id, title) => { const b = Buffer.alloc(0x400); b.write('RVZ\x01', 0, 'latin1'); discHeader(id, title).copy(b, 0x58, 0, 0x100); return b; },
  ciso: (id, title) => { const b = Buffer.alloc(0x8200); b.write('CISO', 0, 'latin1'); discHeader(id, title).copy(b, 0x8000, 0, 0x100); return b; },
  gcz: (id, title) => {
    const blockSize = 0x4000, plain = Buffer.alloc(blockSize * 2); discHeader(id, title).copy(plain);
    const blocks = [deflateSync(plain.subarray(0, blockSize)), deflateSync(plain.subarray(blockSize))];
    const header = Buffer.alloc(32); header.writeUInt32LE(0xb10bc001, 0); header.writeUInt32LE(blockSize, 24); header.writeUInt32LE(2, 28);
    const table = Buffer.alloc(2 * 12); table.writeBigUInt64LE(0n, 0); table.writeBigUInt64LE(BigInt(blocks[0].length), 8);
    return Buffer.concat([header, table, ...blocks]);
  }
};

test('disc headers are read from ISO, WBFS, RVZ, CISO and GCZ images, and junk is refused', async t => {
  const dir = await temp(t);
  for (const [format, make] of Object.entries(images)) {
    const file = join(dir, `game.${format}`);
    await writeFile(file, make('RMCE01', 'MARIO KART WII'));
    const info = await identify(file);
    assert.equal(info.id, 'RMCE01', format); assert.equal(info.title, 'MARIO KART WII'); assert.equal(info.platform, 'Wii');
  }
  await writeFile(join(dir, 'gc.iso'), discHeader('GALE01', 'Super Smash Bros Melee', false));
  assert.equal((await identify(join(dir, 'gc.iso'))).platform, 'GameCube');
  await writeFile(join(dir, 'junk.iso'), Buffer.alloc(0x500, 7));
  assert.equal(await identify(join(dir, 'junk.iso')), null);
  await writeFile(join(dir, 'tiny.iso'), Buffer.from('x'));
  assert.equal(await identify(join(dir, 'tiny.iso')), null);
});

test('the three channel titles are recognised by ID in every region, plus the two-in-one disc by title', () => {
  for (const region of 'EPJK') {
    assert.equal(recognize(`RMC${region}01`), 'mkw'); assert.equal(recognize(`RSP${region}01`), 'sports'); assert.equal(recognize(`RZT${region}01`), 'resort');
  }
  assert.equal(recognize('RSPE02'), null);
  assert.equal(recognize('SP2E01', 'Wii Sports + Wii Sports Resort'), 'pack');
  assert.equal(recognize('GALE01', 'Melee'), null);
});

test('library scans nested folders, reports unreadable files and keeps an earlier per-title choice', async t => {
  const dir = await temp(t);
  await mkdir(join(dir, 'Wii', 'Racing'), { recursive: true });
  await writeFile(join(dir, 'Wii', 'Racing', 'Mario Kart Wii.rvz'), images.rvz('RMCE01', 'MARIO KART WII'));
  await writeFile(join(dir, 'Wii', 'sports-us.wbfs'), images.wbfs('RSPE01', 'Wii Sports'));
  await writeFile(join(dir, 'Wii', 'sports-eu.iso'), images.iso('RSPP01', 'Wii Sports'));
  await writeFile(join(dir, 'Wii', 'broken.iso'), Buffer.alloc(0x500));
  await writeFile(join(dir, 'Wii', 'notes.txt'), 'ignored');
  const discs = await scanLibrary([dir], [join(dir, 'missing.iso')]);
  assert.equal(discs.filter(d => d.kind).length, 3);
  assert.equal(discs.find(d => d.name === 'broken.iso').error, 'Not a readable Wii or GameCube disc image');
  assert.equal(discs.find(d => d.name === 'missing.iso').error, 'File not found');
  assert.equal(discs.find(d => d.id === 'RSPP01').region, 'Europe');
  const titles = chooseTitles(discs, { sports: join(dir, 'Wii', 'sports-eu.iso') });
  assert.equal(titles.mkw.id, 'RMCE01'); assert.equal(titles.sports.id, 'RSPP01'); assert.equal(titles.resort, null);
});

// ---- Settings -------------------------------------------------------------------------------
test('settings keep only known keys with the right types and save atomically', async t => {
  const dir = await temp(t), store = createSettings(dir);
  assert.deepEqual(await store.load(), defaults());
  const saved = await store.save({ dolphinPath: 'C:\\Dolphin\\Dolphin.exe', controls: { players: ['keyboard', 'bogus'], gameDeadzone: 'x' }, evil: 1, display: { volume: 0.3 } });
  assert.equal(saved.evil, undefined);
  assert.deepEqual(saved.controls.players, ['keyboard', 'phone', 'phone', 'phone']);
  assert.equal(saved.controls.gameDeadzone, 0.1);
  assert.equal(saved.display.volume, 0.3); assert.equal(saved.display.sounds, true);
  const reread = await createSettings(dir).load();
  assert.equal(reread.dolphinPath, 'C:\\Dolphin\\Dolphin.exe');
  assert.deepEqual((await readdir(dir)).sort(), ['settings.json']);
  assert.deepEqual(sanitize({ gameFolders: ['a', 3, 'b'] }).gameFolders, ['a', 'b']);
});

// ---- INI journaling -------------------------------------------------------------------------
test('INI edits replace, add and remove keys case-insensitively and leave other lines alone', () => {
  const text = '# user notes\r\n[Core]\r\nCPUThread = True\r\n\r\n[controls]\r\nwiimoteprofile1 = Mine\r\nPadProfile2 = Pad\r\n';
  const next = setValues(text, 'Controls', { WiimoteProfile1: 'Living Room P1', WiimoteSource0: '1', PadProfile2: null });
  assert.equal(next, '# user notes\r\n[Core]\r\nCPUThread = True\r\n\r\n[controls]\r\nwiimoteprofile1 = Living Room P1\r\nWiimoteSource0 = 1\r\n');
  assert.equal(readValue(next, 'CONTROLS', 'WiimoteProfile1'), 'Living Room P1');
  assert.equal(setValues('', 'Controls', { A: '1' }), '[Controls]\nA = 1\n');
  assert.equal(setValues('[Other]\nB = 2\n', 'Controls', { A: '1' }), '[Other]\nB = 2\n\n[Controls]\nA = 1\n');
});

test('journal restores the exact original values, deletes files it created, and survives a crash', async t => {
  const dir = await temp(t);
  const existing = join(dir, 'RSPE01.ini'), created = join(dir, 'RMCE01.ini');
  const original = '[Video_Settings]\nSafeTextureCacheSize = 0\n[Controls]\nWiimoteProfile1 = My remote\n';
  await writeFile(existing, original);
  const journal = createJournal(join(dir, 'journal.json'));
  await journal.apply(existing, 'Controls', { WiimoteProfile1: 'Living Room', WiimoteSource0: '1' });
  await journal.apply(created, 'Controls', { PadProfile1: 'Living Room Pad' });
  assert.match(await readFile(existing, 'utf8'), /WiimoteProfile1 = Living Room\n/);
  // Dolphin may write its own changes while running; those stay.
  await writeFile(existing, (await readFile(existing, 'utf8')).replace('SafeTextureCacheSize = 0', 'SafeTextureCacheSize = 512'));
  const afterCrash = createJournal(join(dir, 'journal.json'));
  const result = await afterCrash.restore();
  assert.equal(result.restored, 2); assert.deepEqual(result.failures, []);
  assert.equal(await readFile(existing, 'utf8'), original.replace('SafeTextureCacheSize = 0', 'SafeTextureCacheSize = 512'));
  await assert.rejects(readFile(created), { code: 'ENOENT' });
  await assert.rejects(readFile(join(dir, 'journal.json')), { code: 'ENOENT' });
  assert.deepEqual(await afterCrash.restore(), { restored: 0, failures: [] });
});

// ---- Controller profiles --------------------------------------------------------------------
test('Mario Kart Wii: DualSense becomes GameCube port 1, phones become sideways Wii Remotes on their DSU pads', () => {
  const plan = buildLaunchPlan('mkw', ['dualsense', 'phone', 'phone', 'off'], { keyboardP1: true, deadzone: 0.15 });
  assert.deepEqual(plan.config, ['Dolphin.Core.SIDevice0=6', 'Dolphin.Core.SIDevice1=0', 'Dolphin.Core.SIDevice2=0', 'Dolphin.Core.SIDevice3=0']);
  assert.deepEqual(plan.controls, { WiimoteSource0: '0', PadProfile1: 'Living Room P1 Kart dualsense', WiimoteSource1: '1', WiimoteProfile2: 'Living Room P2 Kart phone',
    WiimoteSource2: '1', WiimoteProfile3: 'Living Room P3 Kart phone', WiimoteSource3: '0' });
  const pad = plan.profiles.find(p => p.type === 'GCPad').text;
  assert.match(pad, /^\[Profile\]\nDevice = SDL\/0\/DualSense Wireless Controller\n/);
  assert.match(pad, /Buttons\/A = `SDL\/0\/DualSense Wireless Controller:Button S` \| `SDL\/0\/PS5 Controller:Button S` \| `DInput\/0\/Keyboard Mouse:X`/);
  assert.match(pad, /Triggers\/R = .*Shoulder R.*Trigger R.*Keyboard Mouse:C`/);
  assert.match(pad, /Main Stick\/Dead Zone = 15\.0/);
  const phone = plan.profiles.find(p => p.name.includes('P3')).text;
  assert.match(phone, /Device = DSUClient\/2\/LivingRoomPhones/);
  assert.match(phone, /Buttons\/2 = `DSUClient\/2\/LivingRoomPhones:Triangle`/);
  assert.match(phone, /IMUAccelerometer\/Up = `DSUClient\/2\/LivingRoomPhones:Accel Up`/);
  assert.match(phone, /Extension = None/);
  assert.doesNotMatch(phone, /Keyboard/);
  assert.equal(plan.roles[1].as, 'Wii Remote 2 (held sideways)');
});

test('sports titles attach the Nunchuk, Resort adds MotionPlus and a Nunchuk only where the sport uses one, and real or keyboard players are handled', () => {
  const sports = buildLaunchPlan('sports', ['phone', 'keyboard', 'wiimote', 'dualsense']);
  assert.deepEqual(sports.config, ['Dolphin.Core.SIDevice0=0', 'Dolphin.Core.SIDevice1=0', 'Dolphin.Core.SIDevice2=0', 'Dolphin.Core.SIDevice3=0']);
  assert.equal(sports.controls.WiimoteSource2, '2');
  assert.equal(sports.controls.WiimoteProfile3, undefined);
  const p1 = sports.profiles.find(p => p.name.includes('P1')).text;
  assert.match(p1, /Extension = Nunchuk/); assert.match(p1, /Extension\/Attach MotionPlus = False/);
  assert.match(p1, /Nunchuk\/Buttons\/C = `DSUClient\/0\/LivingRoomPhones:L1` \| `DInput\/0\/Keyboard Mouse:C`/);
  assert.match(p1, /IR\/Up = `DSUClient\/0\/LivingRoomPhones:Right Y\+`/);
  assert.match(p1, /IMUIR\/Enabled = False/);
  assert.doesNotMatch(p1, /Click 0/, 'mouse clicks never press buttons through the combined profile');
  const keyboard = sports.profiles.find(p => p.name.includes('P2')).text;
  assert.match(keyboard, /IR\/Left = `DInput\/0\/Keyboard Mouse:Cursor X-`/);
  assert.match(keyboard, /Swing\/Forward = `DInput\/0\/Keyboard Mouse:F`/);
  assert.doesNotMatch(keyboard, /IMUAccelerometer/);
  const dualsense = sports.profiles.find(p => p.name.includes('P4')).text;
  assert.match(dualsense, /IMUGyroscope\/Pitch Up = `SDL\/0\/DualSense Wireless Controller:Gyro Pitch Up` \| `SDL\/0\/PS5 Controller:Gyro Pitch Up`/);
  assert.match(dualsense, /IMUIR\/Enabled = True/);
  // Resort stops and asks for anything plugged into the MotionPlus to be disconnected, unless the sport uses it.
  for (const sport of [null, 'golf', 'swordplay', 'table-tennis', 'air-sports']) {
    const resort = buildLaunchPlan('resort', ['phone', 'off', 'off', 'off'], { sport });
    assert.match(resort.profiles[0].text, /Extension = None/, `${sport}: nothing in the MotionPlus`);
    assert.match(resort.profiles[0].text, /Extension\/Attach MotionPlus = True/);
    assert.equal(resort.roles[0].as, 'Wii Remote 1 + MotionPlus');
  }
  for (const sport of ['archery', 'power-cruising', 'cycling']) {
    const resort = buildLaunchPlan('resort', ['phone', 'dualsense', 'off', 'off'], { sport });
    assert.match(resort.profiles[0].text, /Extension = Nunchuk/, `${sport} is played with the Nunchuk`);
    assert.equal(resort.roles[1].as, 'Wii Remote 2 + Nunchuk + MotionPlus');
  }
  assert.match(buildLaunchPlan('sports', ['phone', 'off', 'off', 'off'], { sport: 'golf' }).profiles[0].text, /Extension = Nunchuk/,
    'Wii Sports ignores a spare Nunchuk, so it stays ready for Boxing');
  assert.throws(() => buildLaunchPlan('zelda', []));
  assert.equal(phoneDevice(3), 'DSUClient/3/LivingRoomPhones');
  assert.equal(Object.keys(wiimoteProfile({ kind: 'phone', index: 0 })).filter(k => k.startsWith('Nunchuk')).length, 0);
});

test('on-screen binding tables come from the same table as the profiles', () => {
  const rows = mkwRows();
  assert.deepEqual(rows.map(r => r.action), ['Steer', 'Accelerate', 'Brake / reverse', 'Drift / hop', 'Use item', 'Trick / wheelie', 'Pause']);
  assert.deepEqual(rows.find(r => r.action === 'Accelerate'), { action: 'Accelerate', dualsense: '✕ Cross', keyboard: 'X', phone: '2' });
  assert.equal(rows.find(r => r.action === 'Drift / hop').dualsense, 'R1 or R2');
  assert.equal(rows.find(r => r.action === 'Steer').keyboard, '← or →');
  assert.equal(remoteRows('phone').find(r => r.control === 'B').input, 'B');
  assert.equal(remoteRows('dualsense').find(r => r.control === 'Home').input, 'PS button');
  for (const name of Object.values(PHONE_TO_DSU)) assert.match(name, /^(Cross|R1|Square|Triangle|Share|Options|PS|Pad [NSWE]|L1|L2|L3|R3)$/);
});

// ---- Catalogue ------------------------------------------------------------------------------
test('the sports selector has 15 sports and 17 title entries, with Bowling and Golf in both editions', () => {
  assert.equal(SPORTS.length, 15); assert.equal(ENTRY_COUNT, 17);
  assert.equal(new Set(SPORTS.map(s => s.id)).size, 15);
  assert.deepEqual(SPORTS.filter(s => s.editions.length === 2).map(s => s.id), ['bowling', 'golf']);
  assert.equal(SPORTS.flatMap(s => s.editions).filter(e => e.title === 'sports').length, 5);
  assert.equal(SPORTS.flatMap(s => s.editions).filter(e => e.title === 'resort').length, 12);
  for (const edition of SPORTS.flatMap(s => s.editions)) {
    assert.equal(edition.requires.motionPlus, edition.title === 'resort');
    assert.ok(edition.path.length >= 3 && edition.modes.length >= 1);
    if (edition.title === 'resort') assert.equal(edition.support.keyboard, 'none');
  }
  assert.deepEqual(SPORTS.filter(s => s.editions.some(e => e.requires.nunchuk)).map(s => s.id), ['boxing', 'archery', 'power-cruising', 'cycling']);
  assert.match(sportById('golf').editions[1].path[2], /Golf \(7th of 12\)/);
  assert.deepEqual(activityNeeds('resort', 'archery'), { layout: 'remote', nunchuk: true, motionPlus: true });
  assert.deepEqual(activityNeeds('mkw'), { layout: 'wheel', nunchuk: false, motionPlus: false });
  assert.deepEqual(activityGuide('mkw', null, 'vs-race'), { name: 'Mario Kart Wii', detail: 'VS Race', path: MKW_MODES.find(m => m.id === 'vs-race').path });
  assert.deepEqual(activityGuide('mkw', null, 'online').path, [], 'an unavailable mode never shows a path');
  const golf = activityGuide('resort', 'golf');
  assert.equal(golf.name, 'Golf'); assert.equal(golf.detail, 'Wii Sports Resort'); assert.ok(golf.path.includes('Choose Golf (7th of 12)'));
  assert.ok(MKW_MODES.find(m => m.id === 'online').unavailable);
});

// ---- DSU server -----------------------------------------------------------------------------
function request(type, body = Buffer.alloc(0)) {
  const buf = Buffer.alloc(20 + body.length);
  buf.write('DSUC', 0, 'latin1'); buf.writeUInt16LE(PROTOCOL_VERSION, 4); buf.writeUInt16LE(buf.length - 16, 6);
  buf.writeUInt32LE(4242, 12); buf.writeUInt32LE(type, 16); body.copy(buf, 20);
  buf.writeUInt32LE(crc32(buf), 8);
  return buf;
}
function checkCrc(packet) {
  const copy = Buffer.from(packet); const expected = copy.readUInt32LE(8); copy.writeUInt32LE(0, 8);
  assert.equal(crc32(copy), expected); assert.equal(copy.toString('latin1', 0, 4), 'DSUS'); assert.equal(copy.readUInt16LE(6), packet.length - 16);
}

test('DSU server answers Dolphin\'s requests and streams phone motion in the expected byte layout', async t => {
  const server = createDsuServer({ port: 0 }); const port = await server.start();
  const client = dgram.createSocket('udp4'); client.bind(0, '127.0.0.1'); await once(client, 'listening');
  t.after(() => { server.close(); client.close(); });
  const next = () => once(client, 'message').then(([msg]) => msg);
  client.send(request(0x100000), port, '127.0.0.1');
  const version = await next(); checkCrc(version); assert.equal(version.length, 24); assert.equal(version.readUInt16LE(20), 1001);
  const ports = Buffer.alloc(8); ports.writeInt32LE(2, 0); ports[4] = 0; ports[5] = 3;
  client.send(request(0x100001, ports), port, '127.0.0.1');
  const info = [await next(), await next()];
  for (const packet of info) { checkCrc(packet); assert.equal(packet.length, 32); assert.equal(packet[21], 2); assert.equal(packet[22], 2); }
  assert.deepEqual(info.map(p => p[20]).sort(), [0, 3]);
  // A corrupted request is ignored.
  const bad = request(0x100000); bad[16] ^= 1; client.send(bad, port, '127.0.0.1');
  const subscribe = Buffer.alloc(8); subscribe[0] = 1; subscribe[1] = 1;
  client.send(request(0x100002, subscribe), port, '127.0.0.1');
  const resting = await next(); checkCrc(resting); assert.equal(resting.length, 100); assert.equal(resting[20], 1);
  assert.equal(resting.readFloatLE(80), -1, 'gravity on a resting remote reads as Accel Up');
  const fresh = next();
  server.setPad(1, padFromPhone({ b: ['a', 'b', 'two', 'c', 'up', 'home', 'nope'], s: [1, -1], p: [-0.5, 0.25], a: [0.5, 2, -1], g: [90, -45, 10] }, PHONE_TO_DSU));
  const packet = await fresh; checkCrc(packet);
  assert.equal(packet[36], 0x10); // D-pad up
  assert.equal(packet[37], 0x40 | 0x10 | 0x08 | 0x04); // Cross, Triangle, R1, L1
  assert.equal(packet[38], 1); // PS (Home)
  assert.deepEqual([packet[47], packet[49], packet[51], packet[52], packet[53]], [255, 255, 255, 255, 255]);
  assert.deepEqual([packet[40], packet[41], packet[42], packet[43]], [255, 1, 65, 160]);
  assert.deepEqual([packet.readFloatLE(76), packet.readFloatLE(80), packet.readFloatLE(84)], [-0.5, 1, 2]);
  assert.deepEqual([packet.readFloatLE(88), packet.readFloatLE(92), packet.readFloatLE(96)], [90, -45, 10]);
  assert.ok(packet.readUInt32LE(32) > resting.readUInt32LE(32));
  assert.equal(server.info().clients, 1);
});

// ---- Certificates ---------------------------------------------------------------------------
function tlsGet(cert, key, ca) {
  return new Promise((resolve, reject) => {
    const server = https.createServer({ key, cert }, (req, res) => res.end('secure'));
    server.listen(0, '127.0.0.1', () => {
      https.get({ host: '127.0.0.1', port: server.address().port, ca }, res => { let body = ''; res.on('data', d => { body += d; }); res.on('end', () => { server.close(); resolve(body); }); })
        .on('error', error => { server.close(); reject(error); });
    });
  });
}

test('the local authority signs certificates for private addresses only, enforced by name constraints', async () => {
  const authority = createAuthority({ label: 'test' });
  const ca = new X509Certificate(authority.cert);
  assert.ok(ca.ca);
  const leaf = issueServerCertificate(authority, ['192.168.1.20', '8.8.8.8', 'fe80::1']);
  assert.equal(new X509Certificate(leaf.cert).subjectAltName, 'DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.1.20');
  assert.equal(await tlsGet(leaf.cert, leaf.key, authority.cert), 'secure');
  await assert.rejects(tlsGet(leaf.cert, leaf.key, undefined), /self-signed|unable to verify|local issuer/i);
  const outside = issueServerCertificate(authority, ['8.8.8.8'], { onlyPermitted: false });
  await assert.rejects(tlsGet(outside.cert, outside.key, authority.cert), /permitted|subtree|constraint/i);
  for (const [ip, ok] of [['10.1.2.3', true], ['172.31.0.1', true], ['172.32.0.1', false], ['100.100.1.1', true], ['1.1.1.1', false], ['192.168.0.1', true]]) assert.equal(isPermittedAddress(ip), ok, ip);
});

test('the certificate store keeps its authority and reissues the server certificate when addresses change', async t => {
  const dir = await temp(t), store = createCertificateStore(join(dir, 'certs'));
  const first = await store.ensure(['192.168.1.20']);
  assert.equal(first.issued, true);
  assert.equal((await store.ensure(['192.168.1.20'])).issued, false);
  const reopened = createCertificateStore(join(dir, 'certs'));
  const same = await reopened.ensure(['192.168.1.20']);
  assert.equal(same.issued, false); assert.equal(same.ca, first.ca);
  const moved = await reopened.ensure(['10.0.0.7']);
  assert.equal(moved.issued, true); assert.equal(moved.ca, first.ca);
  assert.ok(new X509Certificate(moved.cert).checkIP('10.0.0.7'));
  assert.match(reopened.fingerprint(), /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

// ---- Dolphin ---------------------------------------------------------------------------------
test('Dolphin is found in install folders or one level down in Downloads', async () => {
  const env = { ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  assert.ok(candidatePaths(env).includes('C:\\Program Files\\Dolphin-x64\\Dolphin.exe'));
  assert.equal(await findDolphin({ env, fileExists: async p => p === 'C:\\Program Files\\Dolphin-x64\\Dolphin.exe' }), 'C:\\Program Files\\Dolphin-x64\\Dolphin.exe');
  const dirent = name => ({ name, isDirectory: () => true });
  const list = async path => (path === join('C:\\Users\\me', 'Downloads') ? [dirent('dolphin-2509-x64')] : path.endsWith('dolphin-2509-x64') ? [dirent('Dolphin-x64')] : []);
  const nested = join('C:\\Users\\me', 'Downloads', 'dolphin-2509-x64', 'Dolphin-x64', 'Dolphin.exe');
  assert.equal(await findDolphin({ env, list, fileExists: async p => p === nested }), nested);
  assert.equal(await findDolphin({ env, list: async () => [], fileExists: async () => false }), null);
});

test('Dolphin\'s user folder is resolved in Dolphin\'s own order', async () => {
  const exe = 'D:\\Emu\\Dolphin\\Dolphin.exe';
  const sources = (reg = {}, documents = 'C:\\Users\\me\\Documents', appData = 'C:\\Users\\me\\AppData\\Roaming') => ({ dolphin: async name => reg[name] ?? null, documents: async () => documents, appData: async () => appData });
  const has = paths => async p => paths.includes(p);
  assert.equal((await resolveUserDir(exe, { fileExists: has(['D:\\Emu\\Dolphin\\portable.txt']), sources: sources({ UserConfigPath: 'X:\\Custom' }) })).dir, 'D:\\Emu\\Dolphin\\User');
  assert.equal((await resolveUserDir(exe, { fileExists: has([]), sources: sources({ LocalUserConfig: '0x1', UserConfigPath: 'X:\\Custom' }) })).dir, 'D:\\Emu\\Dolphin\\User');
  assert.equal((await resolveUserDir(exe, { fileExists: has([]), sources: sources({ LocalUserConfig: '0x0', UserConfigPath: 'X:\\Custom\\' }) })).dir, 'X:\\Custom');
  assert.equal((await resolveUserDir(exe, { fileExists: has(['C:\\Users\\me\\Documents\\Dolphin Emulator', 'C:\\Users\\me\\AppData\\Roaming']), sources: sources() })).dir, 'C:\\Users\\me\\Documents\\Dolphin Emulator');
  assert.equal((await resolveUserDir(exe, { fileExists: has(['C:\\Users\\me\\AppData\\Roaming']), sources: sources() })).dir, join('C:\\Users\\me\\AppData\\Roaming', 'Dolphin Emulator'));
  assert.equal((await resolveUserDir(exe, { fileExists: has([]), sources: sources() })).dir, 'D:\\Emu\\Dolphin\\User');
});

test('launch arguments, DSU entries and exit classification', () => {
  const args = launchArgs({ userDir: 'U', game: 'G.rvz', fullscreen: false, backgroundInput: true, dsuEntries: 'LivingRoomPhones:127.0.0.1:26760;', config: ['Dolphin.Core.SIDevice0=6'] });
  assert.deepEqual(args.slice(0, 5), ['-b', '-u', 'U', '-e', 'G.rvz']);
  assert.ok(args.includes('Dolphin.Display.Fullscreen=False') && args.includes('Dolphin.Interface.ConfirmStop=False') && args.includes('Dolphin.Core.SIDevice0=6'));
  assert.ok(args.includes('Graphics.Settings.BorderlessFullscreen=True'), 'full screen is a window that can move to another screen');
  assert.ok(args.includes('Dolphin.Interface.UsePanicHandlers=False'), 'warnings never stop the game with a pop-up');
  for (const item of ['Logger.Options.WriteToFile=True', 'Logger.Options.Verbosity=3', 'Logger.Logs.MASTER=True']) assert.ok(args.includes(item), `${item}: warnings reach the log`);
  for (let i = 5; i < args.length; i += 2) assert.equal(args[i], '-C', 'every setting is passed with -C, so none is saved to Dolphin\'s own files');
  assert.equal(dsuEntries('DS4Windows:127.0.0.1:26760;LivingRoomPhones:127.0.0.1:1;', 26761), 'DS4Windows:127.0.0.1:26760;LivingRoomPhones:127.0.0.1:26761;');
  assert.equal(dsuEntries('', 26760), 'LivingRoomPhones:127.0.0.1:26760;');
  assert.equal(classifyExit(0, null, 60000).kind, 'stopped');
  assert.equal(classifyExit(0, null, 2000).kind, 'quick-exit');
  assert.equal(classifyExit(-1073741819, null, 60000).kind, 'crashed');
  assert.match(classifyExit(3221225477, null, 60000).detail, /0xC0000005/);
  assert.equal(classifyExit(1, null, 3000).kind, 'launch-failed');
  assert.equal(classifyExit(1, null, 30000).kind, 'error');
});

// manager: extra options for createDolphinManager (a screen helper, quicker timings).
async function dolphinFixture(t, { players = ['dualsense', 'phone', 'off', 'off'], foreign = [], manager: extra = {} } = {}) {
  const dir = await temp(t);
  const exe = join(dir, 'Dolphin', 'Dolphin.exe'), userDir = join(dir, 'DolphinUser'), game = join(dir, 'mkw.iso');
  await mkdir(join(dir, 'Dolphin'), { recursive: true }); await writeFile(exe, 'stub');
  await mkdir(join(userDir, 'GameSettings'), { recursive: true });
  await mkdir(join(userDir, 'Config'), { recursive: true });
  await writeFile(join(userDir, 'Config', 'DualShockUDPClient.ini'), '[Server]\nEntries = DS4Windows:127.0.0.1:26760;\n');
  await writeFile(game, images.iso('RMCE01', 'MARIO KART WII'));
  const settings = createSettings(join(dir, 'data'));
  await settings.save({ dolphinPath: exe, titles: { mkw: game }, controls: { players } });
  const spawned = [], closed = [], changes = [];
  const focused = [];
  const spawn = (file, args) => {
    const child = new EventEmitter(); child.pid = 4100 + spawned.length;
    spawned.push({ file, args, child }); setImmediate(() => child.emit('spawn'));
    return child;
  };
  const manager = createDolphinManager({ settings, dataDir: join(dir, 'data'), dsuPort: () => 26761, spawn,
    processes: async () => [...foreign, ...spawned.filter(s => !s.exited).map(s => s.child.pid)],
    close: async (pid, force) => { closed.push([pid, force]); const s = spawned.find(x => x.child.pid === pid); if (s && !force) { s.exited = true; s.child.emit('exit', 0, null); } },
    userDirOf: async () => ({ dir: userDir, reason: 'test' }), focusApp: pid => { focused.push(pid ?? 'menu'); }, onChange: state => changes.push(state), ...extra });
  return { dir, exe, userDir, game, settings, manager, spawned, closed, changes, focused };
}

test('a launch writes profiles and per-game controls, then puts every setting back when Dolphin closes', async t => {
  const f = await dolphinFixture(t);
  const userGameIni = join(f.userDir, 'GameSettings', 'RMCE01.ini');
  await writeFile(userGameIni, '[Core]\nMMU = True\n');
  await f.manager.launch({ title: 'mkw' });
  const [{ file, args, child }] = f.spawned;
  assert.equal(file, f.exe);
  assert.deepEqual(args.slice(0, 5), ['-b', '-u', f.userDir, '-e', f.game]);
  assert.ok(args.includes('DualShockUDPClient.Server.Entries=DS4Windows:127.0.0.1:26760;LivingRoomPhones:127.0.0.1:26761;'));
  assert.ok(args.includes('Dolphin.Core.SIDevice0=6'));
  assert.match(await readFile(join(f.userDir, 'Config', 'Profiles', 'GCPad', 'Living Room P1 Kart dualsense.ini'), 'utf8'), /Buttons\/A = /);
  assert.match(await readFile(join(f.userDir, 'Config', 'Profiles', 'Wiimote', 'Living Room P2 Kart phone.ini'), 'utf8'), /DSUClient\/1\/LivingRoomPhones/);
  assert.equal(await readFile(userGameIni, 'utf8'), '[Core]\nMMU = True\n\n[Controls]\nWiimoteSource0 = 0\nPadProfile1 = Living Room P1 Kart dualsense\nWiimoteSource1 = 1\nWiimoteProfile2 = Living Room P2 Kart phone\nWiimoteSource2 = 0\nWiimoteSource3 = 0\n');
  assert.equal(f.manager.state().running, true);
  await assert.rejects(f.manager.launch({ title: 'mkw' }), { code: 'busy' });
  assert.deepEqual(f.focused, [4100], 'Dolphin is brought to the front once it starts');
  child.emit('exit', 3221225477, null);
  assert.equal(f.manager.state().running, true, 'still running while its settings are put back');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(f.manager.state().running, false);
  assert.equal(f.manager.state().lastExit.kind, 'crashed');
  assert.equal(await readFile(userGameIni, 'utf8'), '[Core]\nMMU = True\n');
  assert.deepEqual(f.focused, [4100, 'menu'], 'and the Wii Menu comes back after');
});

test('stopping asks Dolphin to close; missing setup and a foreign Dolphin give the exact next step', async t => {
  const f = await dolphinFixture(t);
  await f.manager.launch({ title: 'mkw', sport: null });
  await f.manager.stop();
  assert.deepEqual(f.closed, [[4100, undefined]]);
  assert.equal(f.manager.state().lastExit.kind, 'stopped', 'a requested close is not an error, even seconds after launch');
  assert.equal(f.manager.state().lastExit.closedBy, 'player');
  await assert.rejects(readFile(join(f.userDir, 'GameSettings', 'RMCE01.ini')), { code: 'ENOENT' });
  await assert.rejects(f.manager.launch({ title: 'sports' }), error => error.code === 'no-game' && /Setup/.test(error.step));
  await f.settings.save({ titles: { sports: join(f.dir, 'gone.iso') } });
  await assert.rejects(f.manager.launch({ title: 'sports' }), { code: 'missing-game' });
  await f.settings.save({ dolphinPath: join(f.dir, 'nowhere', 'Dolphin.exe') });
  await assert.rejects(f.manager.launch({ title: 'mkw' }), { code: 'no-dolphin' });
  const g = await dolphinFixture(t, { foreign: [999] });
  await assert.rejects(g.manager.launch({ title: 'mkw' }), error => error.code === 'dolphin-open' && /Close Dolphin/.test(error.step));
  await g.manager.stop({ foreign: true });
  assert.deepEqual(g.closed, [[999, undefined]]);
});

test('with "use Dolphin\'s own controller settings", no profile or game setting is written', async t => {
  const f = await dolphinFixture(t);
  await f.settings.save({ controls: { layouts: 'dolphin' } });
  await f.manager.launch({ title: 'mkw' });
  await assert.rejects(readdir(join(f.userDir, 'Config', 'Profiles')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.userDir, 'GameSettings', 'RMCE01.ini')), { code: 'ENOENT' });
  assert.ok(!f.spawned[0].args.some(a => a.startsWith('Dolphin.Core.SIDevice')));
  f.spawned[0].child.emit('exit', 0, null);
});

// ---- Quitting from inside the game, and the game's screen ---------------------------------------
const WII_MENU_LINE = String.raw`41:02:117 Core\IOS\ES\ES.cpp:395 W[MASTER]: Warning: Could not launch the Wii Menu because it is missing from the NAND.`;

test('a game asking for the Wii Menu is recognised in Dolphin\'s log, even when a line arrives in pieces', async t => {
  assert.ok(asksForWiiMenu(WII_MENU_LINE));
  assert.ok(asksForWiiMenu('41:02:117 Core/IOS/ES/ES.cpp:395 W[MASTER]: Warnung: Das Wii-Menü fehlt im NAND.'), 'a translated message still names the NAND');
  assert.ok(!asksForWiiMenu(String.raw`39:40:915 Core\Boot\Boot.cpp:208 W[MASTER]: Warning: The specified file "x.rvz" does not exist`));
  assert.ok(!asksForWiiMenu('The emulated software will likely hang now.'));
  const file = join(await temp(t), 'dolphin.log');
  await writeFile(file, 'old line\n');
  const lines = [];
  t.after(followLog(file, 9, line => lines.push(line), 5));
  await appendFile(file, 'first half of a li');
  await new Promise(resolve => setTimeout(resolve, 30));
  await appendFile(file, 'ne\nsecond\n');
  await until(() => lines.length === 2);
  assert.deepEqual(lines, ['first half of a line', 'second'], 'only what was added, a whole line at a time');
});

test('Home › Wii Menu in the game closes it the way Quit does; a line left by an earlier game does not', async t => {
  const f = await dolphinFixture(t, { manager: { logEvery: 5 } });
  const log = join(f.userDir, 'Logs', 'dolphin.log');
  await mkdir(join(f.userDir, 'Logs'), { recursive: true });
  await writeFile(log, `${WII_MENU_LINE}\nThe emulated software will likely hang now.\n`);
  await f.manager.launch({ title: 'mkw' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(f.closed, [], 'what earlier games wrote is not read');
  await appendFile(log, `41:01:002 Core\\Boot\\Boot.cpp:500 N[MASTER]: Booting\n${WII_MENU_LINE}\nThe emulated software will likely hang now.\n`);
  await until(() => !f.manager.state().running);
  assert.deepEqual(f.closed, [[4100, undefined]], 'Dolphin is asked to close normally');
  assert.deepEqual([f.manager.state().lastExit.kind, f.manager.state().lastExit.closedBy], ['stopped', 'wii-menu']);
});

test('a game opens on the screen chosen for it, checked again once Dolphin has gone full screen', async t => {
  const windows = fakeWindows({ refuse: 1 });
  const f = await dolphinFixture(t, { manager: { displays: createDisplays({ run: windows.run }), settleMs: 5 } });
  await f.settings.save({ launch: { screen: SECOND } });
  await f.manager.launch({ title: 'mkw' });
  await until(() => windows.window.x >= 1920);
  await until(() => windows.calls.length >= 5);
  assert.equal(windows.calls[0].LRS_WAIT, '20000', 'it waits for Dolphin to open the window');
  assert.deepEqual(windows.moves, ['2544,45,1312,1038', '2544,45,1312,1038'], 'moved again when the first move did not hold');
  assert.deepEqual(windows.window, { handle: '2428142', x: 2544, y: 45, width: 1312, height: 1038 });

  const untouched = fakeWindows();
  const g = await dolphinFixture(t, { manager: { displays: createDisplays({ run: untouched.run }) } });
  await g.manager.launch({ title: 'mkw' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(untouched.calls.length, 0, 'a game for the main screen is left where Dolphin puts it');

  const unplugged = fakeWindows();
  const h = await dolphinFixture(t, { manager: { displays: createDisplays({ run: unplugged.run }), settleMs: 5 } });
  await h.settings.save({ launch: { screen: String.raw`\\.\DISPLAY9` } });
  await h.manager.launch({ title: 'mkw' });
  await until(() => unplugged.calls.length >= 1);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(unplugged.moves, [], 'a chosen screen that has been unplugged leaves the game on the main screen');
});

test('a running game moves to the other screen and the next game opens there too', async t => {
  const windows = fakeWindows({ window: { x: 0, y: 0, width: 1920, height: 1080 } });
  const f = await dolphinFixture(t, { manager: { displays: createDisplays({ run: windows.run }) } });
  await assert.rejects(f.manager.moveTo(), { code: 'not-running' });
  await f.manager.launch({ title: 'mkw' });
  await f.manager.moveTo('next');
  assert.deepEqual(windows.window, { handle: '2428142', x: 1920, y: -212, width: 2560, height: 1600 }, 'a full-screen game fills the 2560 × 1600 screen');
  assert.equal((await f.settings.load()).launch.screen, SECOND);
  await f.manager.moveTo('next');
  assert.deepEqual(windows.window, { handle: '2428142', x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal((await f.settings.load()).launch.screen, 'main');

  const alone = await dolphinFixture(t, { manager: { displays: createDisplays({ run: fakeWindows({ screens: MAIN_ONLY }).run }) } });
  await alone.manager.launch({ title: 'mkw' });
  await assert.rejects(alone.manager.moveTo(), error => error.code === 'one-screen' && /Connect another screen/.test(error.step));
  const early = await dolphinFixture(t, { manager: { displays: createDisplays({ run: fakeWindows({ window: null }).run }) } });
  await early.manager.launch({ title: 'mkw' });
  await assert.rejects(early.manager.moveTo(), { code: 'no-window' });
  const elsewhere = await dolphinFixture(t);
  await elsewhere.manager.launch({ title: 'mkw' });
  await assert.rejects(elsewhere.manager.moveTo(), { code: 'unsupported' });
});
