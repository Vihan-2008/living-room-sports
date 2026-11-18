import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, extname } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { qrSvg } from './qr.js';
import { activityNeeds, activityGuide } from './public/catalog.js';

const root = new URL('./public/', import.meta.url);
const rootDir = fileURLToPath(root);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const PAGES = { '/': 'index.html', '/remote': 'remote.html', '/arcade': 'arcade.html', '/phone-setup': 'phone-setup.html' };
// Only plain files directly inside public/ are served.
const assets = new Map(readdirSync(rootDir).filter(name => /^[a-z0-9][a-z0-9.-]*$/i.test(name) && MIME[extname(name).toLowerCase()]).map(name => ['/' + name, name]));

export const colors = ['#149ed4', '#ef665e', '#61b968', '#e1ab23'];
const RESERVE_MS = 60000;
// Wrong room codes allowed from one address each minute, so the six digits cannot be found by trying them all.
const CODE_TRIES_PER_MINUTE = 5;

// preferred: addresses of adapters that have a default gateway, i.e. the ones on the home network.
// routedOnly drops the other adapters once a routed one is known: a phone can never reach a
// host-only adapter such as VirtualBox's, so offering it as a fallback only wastes the player's time.
function rankedAddresses(interfaces, preferred = [], { routedOnly = false } = {}) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (!['IPv4', 4].includes(entry.family) || entry.internal || /^(127\.|169\.254\.|0\.)/.test(entry.address)) continue;
      // Prefer physical home-network adapters, keeping VPNs as alternatives.
      const virtual = /vpn|virtual|vethernet|vmware|vbox|hyper-v|docker|wsl|tailscale|zerotier|tunnel|tap|tun\d/i.test(name);
      const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address);
      const routed = !preferred.length || preferred.includes(entry.address);
      candidates.push({ address: entry.address, rank: (routed ? 0 : 8) + (virtual ? 4 : 0) + (privateAddress ? 0 : 2) });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const reachable = routedOnly && candidates.some(c => c.rank < 8) ? candidates.filter(c => c.rank < 8) : candidates;
  return [...new Set(reachable.map(c => c.address))];
}
export const lanAddresses = (interfaces, preferred = []) => rankedAddresses(interfaces, preferred);
export function phoneAddresses(interfaces, port, code, protocol = 'http', preferred = []) {
  return rankedAddresses(interfaces, preferred, { routedOnly: true }).map(address => `${protocol}://${address}:${port}/remote?code=${code}`);
}
export function frame(value, opcode = 1) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const header = Buffer.alloc(body.length < 126 ? 2 : body.length < 65536 ? 4 : 10);
  header[0] = 0x80 | opcode;
  if (body.length < 126) header[1] = body.length;
  else if (body.length < 65536) { header[1] = 126; header.writeUInt16BE(body.length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
  return Buffer.concat([header, body]);
}
const isLoopback = address => /^(127\.|::1$|::ffff:127\.)/.test(address || '');
const bounded = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'minus', 'plus', 'home', 'one', 'two', 'c', 'z'];
// The reply to every controller update from a phone.
const PAD_ACK = frame({ type: 'ack' });

// options.console: the console back end (console/index.js), or null for the plain arcade server.
// options.securePort(): the HTTPS port when phones can use motion over HTTPS.
// options.authorityCert(): the local certificate authority phones install once.
export function createApp({ console: consoleApi = null, securePort = () => null, authorityCert = () => null, onConfig = async () => {}, preferredAddresses = () => [] } = {}) {
  const code = String(randomInt(100000, 1000000));
  const clients = new Set();
  const slots = Array(4).fill(null);
  const reservations = Array(4).fill(null);
  let host = null, activity = { mode: 'menu' };
  const servers = [];

  const send = (client, value) => { if (client && !client.socket.destroyed) client.socket.write(frame(value)); };
  const menus = () => [...clients].filter(c => c.role === 'menu');
  const roster = () => slots.map((p, i) => ({ slot: i + 1, color: colors[i], name: p?.name || '', connected: !!p,
    motion: p?.motion || null, layout: p?.layout || null, waiting: !p && !!reservations[i] && reservations[i].until > Date.now() }));
  // The roster is for the TV and the arcade; phones never see who else is playing.
  const broadcast = () => {
    for (const c of clients) if (c === host || c.role === 'menu') send(c, { type: 'roster', players: roster() });
    refreshLobby();
  };
  const playerTypes = () => consoleApi?.settings.get()?.controls.players || ['phone', 'phone', 'phone', 'phone'];
  const joiningOpen = () => consoleApi?.settings.get()?.phones.joining !== false;
  const toInputClients = value => { send(host, value); for (const m of menus()) send(m, value); };
  const wrongCodes = new Map();
  const recentWrongCodes = address => {
    const recent = (wrongCodes.get(address) || []).filter(t => Date.now() - t < 60000);
    if (recent.length) wrongCodes.set(address, recent); else wrongCodes.delete(address);
    return recent;
  };
  // A room code from a phone. Wrong ones count against the address it connects from.
  function codeError(address, given) {
    if (recentWrongCodes(address).length >= CODE_TRIES_PER_MINUTE) return 'Too many wrong room codes. Wait a minute, then enter the code shown on the TV.';
    if (given !== code) { wrongCodes.set(address, [...recentWrongCodes(address), Date.now()]); return 'Room code does not match.'; }
    return null;
  }
  const clientIdOf = value => (typeof value === 'string' && /^[\w-]{8,64}$/.test(value) ? value : null);

  // The players a phone may be: those nobody has. A player kept for a phone that dropped is free to that phone
  // alone, and while joining is closed a phone is offered only its own.
  function vacancies(clientId) {
    const now = Date.now(), types = playerTypes(), open = joiningOpen();
    return [0, 1, 2, 3].flatMap(i => {
      const live = slots[i], kept = reservations[i]?.until > now ? reservations[i] : null;
      const yours = !!clientId && (live?.clientId === clientId || kept?.clientId === clientId);
      if (!yours && (live || kept || !open)) return [];
      return [{ slot: i + 1, color: colors[i], inGames: types[i] === 'phone', yours }];
    });
  }
  // A phone that has the room code but has not chosen a player yet hears whenever its choice changes.
  const lobbyView = client => ({ places: vacancies(client.clientId), joining: joiningOpen() });
  function sendPlaces(client, message = null) {
    const view = lobbyView(client);
    client.placesSent = JSON.stringify(view);
    send(client, { type: 'places', ...view, ...(message ? { message } : {}) });
  }
  function refreshLobby() {
    for (const c of clients) if (c.role === 'lobby' && JSON.stringify(lobbyView(c)) !== c.placesSent) sendPlaces(c);
  }

  // wanted: the player the phone chose. Without one (an older page), its own player comes first, then one set to
  // Phone, then any other free one.
  function chooseSlot(clientId, wanted = null) {
    const places = vacancies(clientId);
    const place = wanted ? places.find(p => p.slot === wanted) : places.find(p => p.yours) || places.find(p => p.inGames) || places[0];
    if (!place) {
      if (!joiningOpen()) return { error: 'Joining is closed. Open it from Connect controllers on the TV.' };
      if (wanted) return { error: `Player ${wanted} was just taken. Choose another player.` };
      if (slots.every(Boolean)) return { error: 'Room full: four players are already connected.' };
      return { error: 'The free players are being kept for phones that dropped. One opens up within a minute.' };
    }
    // A phone is one player: an older connection of its own, and any player kept for it, are let go.
    if (clientId) {
      slots.forEach((s, i) => {
        if (s?.clientId !== clientId) return;
        s.replaced = true; s.socket.destroy(); slots[i] = null;
        toInputClients({ type: 'input', slot: i + 1, cancel: true });
        consoleApi?.phoneLeft(i + 1);
      });
      reservations.forEach((r, i) => { if (r?.clientId === clientId) reservations[i] = null; });
    }
    return { index: place.slot - 1, returning: place.yours };
  }

  function activityFor(state) {
    if (!state?.dolphin?.running) return { mode: 'menu' };
    const { title, sport } = state.dolphin;
    const screen = state.screens?.find(s => s.id === state.dolphin.screen)?.name || null;
    return { mode: 'game', title, sport, ...activityNeeds(title, sport), ...activityGuide(title, sport, state.settings?.menu?.modes?.[title]),
      screens: state.screens?.length || 1, screen };
  }
  consoleApi?.onChange(state => {
    const next = activityFor(state);
    if (JSON.stringify(next) !== JSON.stringify(activity)) {
      activity = next;
      for (const c of clients) if (c.role === 'remote') send(c, { type: 'activity', ...activity });
    }
    for (const m of menus()) send(m, { type: 'console', state });
    refreshLobby(); // joining opened or closed, or a player's controller changed
  });

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname.startsWith('/api/')) {
      if (!consoleApi) { res.writeHead(503); return res.end('Console features are not running.'); }
      return consoleApi.api(req, res, url);
    }
    if (url.pathname === '/qr') {
      try {
        const target = new URL(url.searchParams.get('url'));
        if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/remote' || target.searchParams.get('code') !== code) throw new Error('Invalid pairing URL');
        const svg = qrSvg(target.href);
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.end(svg);
      } catch { res.writeHead(400); return res.end('Invalid or oversized pairing URL'); }
    }
    if (url.pathname === '/config') {
      await onConfig().catch(() => {});
      const port = req.socket.localPort, secure = securePort();
      res.setHeader('Content-Type', 'application/json');
      // The room code is for the TV to show. A phone brings it from there, in the QR code's link or typed in, so
      // another device on the network is never handed it here.
      // httpPort: the plain address's port, which a phone needs to invite another from the secure page.
      if (!isLoopback(req.socket.remoteAddress)) return res.end(JSON.stringify({ joining: joiningOpen(), securePort: secure, httpPort: server.address()?.port ?? null }));
      const interfaces = networkInterfaces();
      const preferred = preferredAddresses();
      return res.end(JSON.stringify({ code, joining: joiningOpen(), addresses: phoneAddresses(interfaces, port, code, 'http', preferred),
        secure: secure ? phoneAddresses(interfaces, secure, code, 'https', preferred) : [], securePort: secure, local: `http://localhost:${port}/remote?code=${code}` }));
    }
    if (url.pathname === '/ping') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.end('ok');
    }
    if (url.pathname === '/ca.crt') {
      const cert = authorityCert();
      if (!cert) { res.writeHead(404); return res.end('No certificate yet.'); }
      // iPhone: Safari offers a certificate served as itself as a profile to install. Android 11 and later refuse
      // to install one straight from the browser, so ?save hands it over as a plain file for Settings to install.
      const save = url.searchParams.has('save');
      res.writeHead(200, { 'Content-Type': save ? 'application/octet-stream' : 'application/x-x509-ca-cert',
        'Content-Disposition': `${save ? 'attachment' : 'inline'}; filename="LivingRoomSports.crt"`, 'Cache-Control': 'no-store' });
      return res.end(cert);
    }
    // The Wii Menu belongs to the TV; a phone that opens the PC's address gets its controller instead.
    if (url.pathname === '/' && consoleApi && !isLoopback(req.socket.remoteAddress)) {
      res.writeHead(302, { Location: `/remote${url.search}` });
      return res.end();
    }
    const name = PAGES[url.pathname] || assets.get(url.pathname);
    if (!name) { res.writeHead(404); return res.end('Not found'); }
    try {
      const body = await readFile(new URL(name, root));
      res.setHeader('Content-Type', MIME[extname(name).toLowerCase()]);
      res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  }

  function upgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (req.url !== '/ws' || req.headers['sec-websocket-version'] !== '13' || typeof key !== 'string') return socket.destroy();
    // Same-origin browser clients only; non-browser clients may omit Origin.
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return socket.destroy(); }
      catch { return socket.destroy(); }
    }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.setNoDelay(true);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const client = { socket, role: null, slot: null, name: '', clientId: null, last: 0, padTimes: [], lastPadForward: 0, alive: true, local: isLoopback(socket.remoteAddress) };
    clients.add(client);
    let buffer = Buffer.alloc(0);

    const handle = data => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'lobby' && !client.role) {
        // A phone with the room code sees which players it can be before it joins.
        const problem = codeError(socket.remoteAddress || '', msg.code);
        if (problem) return send(client, { type: 'error', message: problem });
        client.role = 'lobby'; client.clientId = clientIdOf(msg.clientId);
        sendPlaces(client);
      } else if (msg.type === 'join' && (!client.role || client.role === 'lobby')) {
        const problem = codeError(socket.remoteAddress || '', msg.code);
        if (problem) return send(client, { type: 'error', message: problem });
        const clientId = clientIdOf(msg.clientId);
        const wanted = Number.isInteger(msg.slot) && msg.slot >= 1 && msg.slot <= 4 ? msg.slot : null;
        const choice = chooseSlot(clientId, wanted);
        if (choice.error && !wanted) return send(client, { type: 'error', message: choice.error });
        if (choice.error) {
          // Someone took that player a moment before: this phone stays to choose another.
          client.role = 'lobby'; client.clientId = clientId;
          return sendPlaces(client, choice.error);
        }
        const index = choice.index;
        client.role = 'remote'; client.slot = index + 1; client.clientId = clientId;
        client.name = String(msg.name || `Player ${index + 1}`).trim().slice(0, 20) || `Player ${index + 1}`;
        slots[index] = client; reservations[index] = null;
        const inGames = playerTypes()[index] === 'phone';
        send(client, { type: 'joined', slot: client.slot, color: colors[index], returning: choice.returning, inGames });
        send(client, { type: 'activity', ...activity });
        broadcast();
      } else if (msg.type === 'host' && !client.role) {
        // The arcade sees every phone's input, so like the console menu it only runs on this PC.
        if (!client.local) return send(client, { type: 'error', message: 'The arcade only runs on this PC.' });
        if (host) return send(client, { type: 'error', message: 'A dashboard is already open. Close it and retry.' });
        client.role = 'host'; host = client; broadcast();
      } else if (msg.type === 'menu' && !client.role) {
        if (!client.local) return send(client, { type: 'error', message: 'The console menu only runs on this PC.' });
        client.role = 'menu';
        send(client, { type: 'roster', players: roster() });
        send(client, { type: 'room', code });
        consoleApi?.state().then(state => send(client, { type: 'console', state }));
      } else if (msg.type === 'input' && client.role === 'remote') {
        // While a game runs the phone is Dolphin's controller; its presses must not also work the
        // menu hidden behind the game (B there would ask to close the game).
        if (activity.mode === 'game') return;
        const now = Date.now();
        // Never drop button releases or gestures behind a high-rate sensor update.
        if (!msg.button && !msg.shake && !msg.swing && msg.cancel !== true) {
          if (now - client.last < 12) return;
          client.last = now;
        }
        toInputClients({ type: 'input', slot: client.slot, button: BUTTONS.includes(msg.button) ? msg.button : null,
          pressed: msg.pressed === true, cancel: msg.cancel === true, swing: bounded(msg.swing, 0, 1), shake: msg.shake === true, pointing: msg.pointing === true,
          x: bounded(msg.x, -1, 1), y: bounded(msg.y, -1, 1) });
      } else if (msg.type === 'pad' && client.role === 'remote') {
        // Full controller state for Dolphin, at most 250 updates a second per phone. Each update is answered at
        // once. The phone sends its newest state as replies come in, so a slow moment on the Wi-Fi never queues
        // old ones. And the reply takes the network's acknowledgement straight back: Windows otherwise holds it
        // for up to 200 ms, and some phones (Safari) send nothing more until it comes.
        if (!socket.destroyed) socket.write(PAD_ACK);
        const now = Date.now();
        client.padTimes = client.padTimes.filter(t => now - t < 1000);
        if (client.padTimes.length >= 250) return;
        client.padTimes.push(now);
        consoleApi?.phonePad(client.slot, msg);
        if (now - client.lastPadForward >= 66) {
          client.lastPadForward = now;
          const list = v => (Array.isArray(v) ? v.slice(0, 3).map(n => bounded(n, -2000, 2000)) : null);
          for (const m of menus()) send(m, { type: 'pad', slot: client.slot, b: Array.isArray(msg.b) ? msg.b.filter(b => typeof b === 'string').slice(0, 20) : [], s: list(msg.s), p: list(msg.p), a: list(msg.a), g: list(msg.g) });
        }
      } else if (msg.type === 'status' && client.role === 'remote') {
        client.motion = ['active', 'waiting', 'denied', 'insecure', 'unavailable'].includes(msg.motion) ? msg.motion : client.motion;
        client.layout = ['remote', 'nunchuk', 'wheel'].includes(msg.layout) ? msg.layout : client.layout;
        broadcast();
      } else if (msg.type === 'quit' && client.role === 'remote') {
        consoleApi?.dolphin.stop();
      } else if (msg.type === 'screen' && client.role === 'remote') {
        consoleApi?.dolphin.moveTo('next').catch(() => {});
      } else if (msg.type === 'rumble' && (client === host || client.role === 'menu')) {
        send(slots[msg.slot - 1], { type: 'rumble', duration: Math.min(250, Math.max(0, Number(msg.duration) || 60)) });
      } else if (msg.type === 'kick' && client.role === 'menu') {
        const target = slots[msg.slot - 1];
        if (target) { target.kicked = true; send(target, { type: 'kicked' }); target.socket.end(); target.socket.destroy(); }
      } else if (msg.type === 'joining' && client.role === 'menu') {
        consoleApi?.settings.save({ phones: { joining: msg.open === true } }).then(() => { consoleApi.notify(); broadcast(); });
      }
    };
    // A burst of small messages after a Wi-Fi stall is normal; only a single oversized frame is refused, so all
    // that is ever kept between reads is part of one frame.
    const consume = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        if (!(buffer[0] & 128) || (buffer[0] & 112) || !(buffer[1] & 128)) return socket.destroy();
        let length = buffer[1] & 127, offset = 2;
        if (length === 127) return socket.destroy();
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
        if (length > 4096 || (opcode >= 8 && length > 125)) return socket.destroy();
        if (buffer.length < offset + 4 + length) return;
        const mask = buffer.subarray(offset, offset + 4);
        const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
        buffer = buffer.subarray(offset + 4 + length);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        if (opcode === 8) { socket.end(frame('', 8)); return; }
        if (opcode === 9) socket.write(frame(payload.toString(), 10));
        else if (opcode === 10) client.alive = true;
        else if (opcode === 1) handle(payload.toString());
        else return socket.destroy();
      }
    };
    socket.on('data', consume);
    socket.on('error', () => {});
    socket.on('close', () => {
      clients.delete(client);
      if (client === host) host = null;
      if (client.slot && slots[client.slot - 1] === client) {
        toInputClients({ type: 'input', slot: client.slot, cancel: true });
        consoleApi?.phoneLeft(client.slot);
        slots[client.slot - 1] = null;
        // A phone that drops (screen lock, Wi-Fi blip) gets its own slot back for a minute.
        if (client.clientId && !client.kicked && !client.replaced) {
          reservations[client.slot - 1] = { clientId: client.clientId, until: Date.now() + RESERVE_MS };
          // When the minute is up, the TV stops saying so and the player is free to everyone.
          setTimeout(broadcast, RESERVE_MS + 50).unref?.();
        }
      }
      broadcast();
    });
    if (head.length) consume(head);
  }

  function attach(server) {
    server.on('request', handler);
    server.on('upgrade', upgrade);
    servers.push(server);
    return server;
  }
  const server = attach(http.createServer());
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) c.socket.destroy();
      else { c.alive = false; c.socket.write(frame('', 9)); }
    }
  }, 15000);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));
  return {
    server, code, attach, roster,
    close: () => { for (const c of clients) c.socket.destroy(); for (const s of servers) s.close(); }
  };
}

// Asks Windows which adapters have a default gateway. Virtual adapters (VirtualBox, VPNs, WSL) usually
// have none, so this picks the home network even when its name says nothing about it.
export function gatewayAddresses() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const script = "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress }";
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 },
    (error, stdout) => resolve(error ? [] : String(stdout).split(/\s+/).filter(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)))));
}

// Asks the desktop launcher to bring a window to the front: Dolphin's (by its process id) once a game
// starts, or the Wii Menu's after it closes. Windows only lets a background process like this server do
// that through a helper; without the launcher (a plain `npm start`) nothing is moved.
function focusLauncher(port, pid = null) {
  const launcher = process.env.LRS_LAUNCHER;
  if (!launcher) return;
  const args = ['--focus', '--port', String(port), ...(pid ? ['--pid', String(pid)] : [])];
  try { spawn(launcher, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {}
}

async function main() {
  const { createConsole } = await import('./console/index.js');
  const { dataDir } = await import('./console/settings.js');
  const { createCertificateStore } = await import('./console/certs.js');
  const port = Number(process.env.PORT) || 3000;
  const securePort = Number(process.env.HTTPS_PORT) || port + 443;
  const dir = dataDir();
  const certs = createCertificateStore(join(dir, 'certs'));
  let secure = null, app = null, preferred = await gatewayAddresses(), preferredAt = Date.now();
  const consoleApi = createConsole({ dataDir: dir, ports: [port, securePort], getPhones: () => app?.roster() || [], focusApp: pid => focusLauncher(port, pid) });
  const refreshCertificate = async () => {
    consoleApi.refreshFirewall();
    if (Date.now() - preferredAt > 30000) { preferred = await gatewayAddresses(); preferredAt = Date.now(); }
    if (!secure) return;
    const tls = await certs.ensure(lanAddresses(networkInterfaces(), preferred));
    if (tls.issued) secure.setSecureContext({ key: tls.key, cert: tls.cert });
  };
  app = createApp({ console: consoleApi, securePort: () => (secure?.listening ? securePort : null), authorityCert: () => certs.authorityCertificate(), onConfig: refreshCertificate, preferredAddresses: () => preferred });
  await consoleApi.start();
  app.server.listen(port, '0.0.0.0', () => console.log(`Living Room Sports: http://localhost:${port}`));
  try {
    const tls = await certs.ensure(lanAddresses(networkInterfaces(), preferred));
    secure = app.attach(https.createServer({ key: tls.key, cert: tls.cert }));
    secure.on('error', error => consoleApi.setHttps({ ready: false, error: `HTTPS for phone motion is off: ${error.message}` }));
    secure.listen(securePort, '0.0.0.0', () => consoleApi.setHttps({ ready: true, port: securePort, error: null }));
  } catch (error) { consoleApi.setHttps({ ready: false, error: `HTTPS for phone motion is off: ${error.message}` }); }
  const shutdown = () => { consoleApi.close(); app.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
