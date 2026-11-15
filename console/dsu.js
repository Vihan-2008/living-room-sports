// A DSU ("cemuhook") motion server: Dolphin's DSU client reads each phone as a controller with
// buttons, two sticks, an accelerometer and a gyroscope. Protocol version 1001, little-endian, CRC32-checked.
import dgram from 'node:dgram';
import zlib from 'node:zlib';
import { randomInt } from 'node:crypto';

export const DEFAULT_DSU_PORT = 26760;
export const PROTOCOL_VERSION = 1001;
export const MSG = { version: 0x100000, ports: 0x100001, data: 0x100002 };
const SUBSCRIBER_TTL = 5000, KEEPALIVE_MS = 200;

let table;
export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  table ??= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function finish(buf, serverId) {
  buf.write('DSUS', 0, 'latin1');
  buf.writeUInt16LE(PROTOCOL_VERSION, 4);
  buf.writeUInt16LE(buf.length - 16, 6);
  buf.writeUInt32LE(0, 8);
  buf.writeUInt32LE(serverId >>> 0, 12);
  buf.writeUInt32LE(crc32(buf), 8);
  return buf;
}

// Button bits in the two DSU button bytes, and which analog byte mirrors each one (Dolphin reads those).
const BITS1 = { 'Pad W': 0x80, 'Pad S': 0x40, 'Pad E': 0x20, 'Pad N': 0x10, Options: 0x08, R3: 0x04, L3: 0x02, Share: 0x01 };
const BITS2 = { Square: 0x80, Cross: 0x40, Circle: 0x20, Triangle: 0x10, R1: 0x08, L1: 0x04, R2: 0x02, L2: 0x01 };
const ANALOG = { 'Pad W': 44, 'Pad S': 45, 'Pad E': 46, 'Pad N': 47, Square: 48, Cross: 49, Circle: 50, Triangle: 51, R1: 52, L1: 53, R2: 54, L2: 55 };
export const DSU_BUTTONS = [...Object.keys(BITS1), ...Object.keys(BITS2), 'PS'];

// Resting state: no buttons, centred sticks, and gravity pulling down on a remote held flat.
export function restingPad() {
  return { buttons: [], lx: 0, ly: 0, rx: 0, ry: 0, accel: { right: 0, forward: 0, up: 1 }, gyro: { pitchUp: 0, yawRight: 0, rollRight: 0 } };
}
const axisByte = v => Math.max(0, Math.min(255, Math.round(128 + (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0) * 127)));
const finite = (v, limit) => (Number.isFinite(v) ? Math.max(-limit, Math.min(limit, v)) : 0);

function slotHeader(buf, pad, connected) {
  buf.writeUInt8(pad, 20);
  buf.writeUInt8(connected ? 2 : 0, 21); // slot state: connected
  buf.writeUInt8(connected ? 2 : 0, 22); // model: full gyro
  buf.writeUInt8(connected ? 2 : 0, 23); // connection: Bluetooth
  if (connected) { buf.writeUInt8(0x4c, 24); buf.writeUInt8(0x52, 25); buf.writeUInt8(0x53, 26); buf.writeUInt8(0, 27); buf.writeUInt8(0, 28); buf.writeUInt8(pad + 1, 29); }
  buf.writeUInt8(connected ? 0x05 : 0, 30); // battery: full
}

export function versionPacket(serverId) {
  const buf = Buffer.alloc(24);
  buf.writeUInt32LE(MSG.version, 16);
  buf.writeUInt16LE(PROTOCOL_VERSION, 20);
  return finish(buf, serverId);
}
export function portInfoPacket(serverId, pad, connected = true) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32LE(MSG.ports, 16);
  slotHeader(buf, pad, connected);
  return finish(buf, serverId);
}
// state: { buttons: [DSU names], lx, ly, rx, ry (-1..1, up/right positive),
//          accel: { right, forward, up } in g, gyro: { pitchUp, yawRight, rollRight } in deg/s } — in the Wii Remote's frame.
export function padDataPacket(serverId, pad, state, packetNumber, timestampUs) {
  const buf = Buffer.alloc(100);
  buf.writeUInt32LE(MSG.data, 16);
  slotHeader(buf, pad, true);
  buf.writeUInt8(1, 31);
  buf.writeUInt32LE(packetNumber >>> 0, 32);
  let b1 = 0, b2 = 0;
  for (const name of state.buttons || []) {
    if (BITS1[name]) b1 |= BITS1[name];
    if (BITS2[name]) b2 |= BITS2[name];
    if (ANALOG[name]) buf.writeUInt8(255, ANALOG[name]);
  }
  buf.writeUInt8(b1, 36); buf.writeUInt8(b2, 37);
  buf.writeUInt8((state.buttons || []).includes('PS') ? 1 : 0, 38);
  buf.writeUInt8(axisByte(state.lx), 40); buf.writeUInt8(axisByte(state.ly), 41);
  buf.writeUInt8(axisByte(state.rx), 42); buf.writeUInt8(axisByte(state.ry), 43);
  buf.writeBigUInt64LE(BigInt(Math.max(0, Math.floor(timestampUs))), 68);
  // Dolphin reads "Accel Left" as +x, "Accel Up" as -y and "Accel Forward" as +z.
  const accel = state.accel || {}, gyro = state.gyro || {};
  buf.writeFloatLE(-finite(accel.right, 8), 76);
  buf.writeFloatLE(-finite(accel.up, 8), 80);
  buf.writeFloatLE(finite(accel.forward, 8), 84);
  // "Gyro Pitch Up", "Gyro Yaw Right" and "Gyro Roll Right" read the raw pitch, yaw and roll rates.
  buf.writeFloatLE(finite(gyro.pitchUp, 2000), 88);
  buf.writeFloatLE(finite(gyro.yawRight, 2000), 92);
  buf.writeFloatLE(finite(gyro.rollRight, 2000), 96);
  return finish(buf, serverId);
}

export function parseRequest(msg) {
  if (msg.length < 20 || msg.toString('latin1', 0, 4) !== 'DSUC') return null;
  const length = msg.readUInt16LE(6);
  if (length + 16 > msg.length) return null;
  const packet = Buffer.from(msg.subarray(0, length + 16));
  const expected = packet.readUInt32LE(8);
  packet.writeUInt32LE(0, 8);
  if (crc32(packet) !== expected) return null;
  const type = packet.readUInt32LE(16), clientId = packet.readUInt32LE(12);
  if (type === MSG.version) return { type: 'version', clientId };
  if (type === MSG.ports && packet.length >= 24) {
    const count = Math.max(0, Math.min(4, packet.readInt32LE(20)));
    const pads = [];
    for (let i = 0; i < count && 24 + i < packet.length; i++) pads.push(packet.readUInt8(24 + i));
    return { type: 'ports', clientId, pads };
  }
  if (type === MSG.data && packet.length >= 22) {
    const flags = packet.readUInt8(20), pad = packet.readUInt8(21);
    return { type: 'data', clientId, all: flags === 0, pad: flags & 1 ? pad : null, mac: flags & 2 ? packet.subarray(22, 28) : null };
  }
  return null;
}

export function createDsuServer({ port = DEFAULT_DSU_PORT, host = '127.0.0.1', pads = 4, attempts = 10, now = () => Date.now() } = {}) {
  const serverId = randomInt(1, 0x7fffffff);
  const states = Array.from({ length: pads }, () => restingPad());
  const counters = Array(pads).fill(0);
  const subscribers = new Map();
  const updated = Array(pads).fill(0);
  let socket = null, timer = null, boundPort = null, lastRequest = 0;
  const started = process.hrtime.bigint();
  const micros = () => Number((process.hrtime.bigint() - started) / 1000n);

  function sendPad(pad, sub) {
    const packet = padDataPacket(serverId, pad, states[pad], ++counters[pad], micros());
    socket.send(packet, sub.port, sub.address);
  }
  function broadcast(pad) {
    if (!socket) return;
    const t = now();
    for (const [key, sub] of subscribers) {
      if (t - sub.seen > SUBSCRIBER_TTL) { subscribers.delete(key); continue; }
      if (sub.all || sub.pads.has(pad)) sendPad(pad, sub);
    }
  }
  function onMessage(msg, rinfo) {
    const request = parseRequest(msg);
    if (!request) return;
    lastRequest = now();
    if (request.type === 'version') socket.send(versionPacket(serverId), rinfo.port, rinfo.address);
    else if (request.type === 'ports') {
      for (const pad of request.pads) if (pad < pads) socket.send(portInfoPacket(serverId, pad, true), rinfo.port, rinfo.address);
    } else if (request.type === 'data') {
      const key = `${rinfo.address}:${rinfo.port}`;
      const sub = subscribers.get(key) || { address: rinfo.address, port: rinfo.port, pads: new Set(), all: false, seen: 0 };
      sub.seen = now();
      if (request.all) sub.all = true;
      else if (request.pad !== null && request.pad < pads) sub.pads.add(request.pad);
      else if (request.mac) { const pad = request.mac[5] - 1; if (pad >= 0 && pad < pads) sub.pads.add(pad); }
      subscribers.set(key, sub);
      for (let pad = 0; pad < pads; pad++) if (sub.all || sub.pads.has(pad)) sendPad(pad, sub);
    }
  }
  function listen(candidate) {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      s.once('error', reject);
      s.bind(candidate, host, () => { s.removeListener('error', reject); resolve(s); });
    });
  }
  async function start() {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      const candidate = port === 0 ? 0 : port + i;
      try { socket = await listen(candidate); break; } catch (error) { lastError = error; }
    }
    if (!socket) throw lastError;
    socket.on('message', onMessage);
    socket.on('error', () => {});
    boundPort = socket.address().port;
    // Keep Dolphin's view fresh even while nobody moves.
    timer = setInterval(() => { for (let pad = 0; pad < pads; pad++) if (now() - updated[pad] >= KEEPALIVE_MS) broadcast(pad); }, KEEPALIVE_MS);
    timer.unref();
    return boundPort;
  }
  function setPad(pad, state) {
    if (pad < 0 || pad >= pads) return;
    states[pad] = { ...restingPad(), ...state };
    updated[pad] = now();
    broadcast(pad);
  }
  return {
    start, setPad,
    clearPad: pad => setPad(pad, restingPad()),
    get port() { return boundPort; },
    info: () => ({ port: boundPort, host, clients: [...subscribers.values()].filter(s => now() - s.seen <= SUBSCRIBER_TTL).length, lastRequest }),
    close: () => { clearInterval(timer); try { socket?.close(); } catch {} socket = null; }
  };
}

// Phone "pad" message → DSU state. Buttons arrive with the phone page's names.
export function padFromPhone(msg, phoneToDsu) {
  const buttons = [];
  for (const name of Array.isArray(msg.b) ? msg.b.slice(0, 20) : []) if (phoneToDsu[name]) buttons.push(phoneToDsu[name]);
  const num = (v, limit) => (Number.isFinite(v) ? Math.max(-limit, Math.min(limit, v)) : 0);
  const [sx, sy] = Array.isArray(msg.s) ? msg.s : [], [px, py] = Array.isArray(msg.p) ? msg.p : [];
  const [right, forward, up] = Array.isArray(msg.a) ? msg.a : [0, 0, 1];
  const [pitchUp, yawRight, rollRight] = Array.isArray(msg.g) ? msg.g : [];
  return {
    buttons,
    lx: num(sx, 1), ly: num(sy, 1), rx: num(px, 1), ry: num(py, 1),
    accel: { right: num(right, 8), forward: num(forward, 8), up: Array.isArray(msg.a) ? num(up, 8) : 1 },
    gyro: { pitchUp: num(pitchUp, 2000), yawRight: num(yawRight, 2000), rollRight: num(rollRight, 2000) }
  };
}
