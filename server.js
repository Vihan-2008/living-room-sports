import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { createHash, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { qrSvg } from './qr.js';

const root = new URL('./public/', import.meta.url);
const assets = new Map(['index.html', 'remote.html', 'style.css', 'dashboard.js', 'remote.js', 'games.js', 'kart.js', 'race-view.js', 'sports-match.js'].map(name => ['/' + name, name]));
export const colors = ['#149ed4', '#ef665e', '#61b968', '#e1ab23'];
export function phoneAddresses(interfaces, port, code) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (!['IPv4', 4].includes(entry.family) || entry.internal || /^(127\.|169\.254\.|0\.)/.test(entry.address)) continue;
      // Prefer physical home-network adapters, keeping VPNs as alternatives.
      const virtual = /vpn|virtual|vethernet|vmware|vbox|hyper-v|docker|wsl|tailscale|zerotier|tunnel|tap|tun\d/i.test(name);
      const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address);
      candidates.push({ address: entry.address, rank: (virtual ? 4 : 0) + (privateAddress ? 0 : 2) });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return [...new Set(candidates.map(a => `http://${a.address}:${port}/remote?code=${code}`))];
}
export function frame(value, opcode = 1) {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const header = Buffer.alloc(body.length < 126 ? 2 : 4);
  header[0] = 0x80 | opcode;
  if (body.length < 126) header[1] = body.length;
  else { header[1] = 126; header.writeUInt16BE(body.length, 2); }
  return Buffer.concat([header, body]);
}

export function createApp() {
  const code = String(randomInt(100000, 1000000));
  const clients = new Set();
  const slots = Array(4).fill(null);
  let host = null;
  const send = (client, value) => { if (client && !client.socket.destroyed) client.socket.write(frame(value)); };
  const roster = () => slots.map((p, i) => ({ slot: i + 1, color: colors[i], name: p?.name || '', connected: !!p }));
  const broadcast = () => { for (const c of clients) send(c, { type: 'roster', players: roster() }); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
      const port = server.address().port;
      const addresses = phoneAddresses(networkInterfaces(), port, code);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ code, addresses, local: `http://localhost:${port}/remote?code=${code}` }));
    }
    const name = assets.get(url.pathname === '/' ? '/index.html' : url.pathname === '/remote' ? '/remote.html' : url.pathname);
    if (!name) { res.writeHead(404); return res.end('Not found'); }
    try {
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await readFile(new URL(name, root)));
    } catch { res.writeHead(500); res.end('Unable to load application'); }
  });
  server.on('upgrade', (req, socket, head) => {
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
    const client = { socket, role: null, slot: null, name: '', last: 0, alive: true };
    clients.add(client);
    let buffer = Buffer.alloc(0);
    const handle = data => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'join' && !client.role) {
        if (msg.code !== code) return send(client, { type: 'error', message: 'Room code does not match.' });
        const index = slots.indexOf(null);
        if (index < 0) return send(client, { type: 'error', message: 'All four player slots are occupied.' });
        client.role = 'remote'; client.slot = index + 1;
        client.name = String(msg.name || `Player ${index + 1}`).trim().slice(0, 20) || `Player ${index + 1}`;
        slots[index] = client;
        send(client, { type: 'joined', slot: client.slot, color: colors[index] }); broadcast();
      } else if (msg.type === 'host' && !client.role) {
        if (host) return send(client, { type: 'error', message: 'A dashboard is already open. Close it and retry.' });
        client.role = 'host'; host = client; broadcast();
      } else if (msg.type === 'input' && client.role === 'remote') {
        const now = Date.now();
        // Never drop button releases or gestures behind a high-rate sensor update.
        if (!msg.button && !msg.shake && !msg.swing && msg.cancel !== true) {
          if (now - client.last < 12) return;
          client.last = now;
        }
        const bounded = (v, lo, hi) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;
        const buttons = ['up', 'down', 'left', 'right', 'a', 'b', 'minus', 'plus', 'home', 'one', 'two'];
        send(host, { type: 'input', slot: client.slot, button: buttons.includes(msg.button) ? msg.button : null,
          pressed: msg.pressed === true, cancel: msg.cancel === true, swing: bounded(msg.swing, 0, 1), shake: msg.shake === true, pointing: msg.pointing === true,
          x: bounded(msg.x, -1, 1), y: bounded(msg.y, -1, 1) });
      } else if (msg.type === 'rumble' && client === host) {
        send(slots[msg.slot - 1], { type: 'rumble', duration: Math.min(250, Math.max(0, Number(msg.duration) || 60)) });
      }
    };
    const consume = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 16384) return socket.destroy();
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
        send(host, { type: 'input', slot: client.slot, cancel: true });
        slots[client.slot - 1] = null;
      }
      broadcast();
    });
    if (head.length) consume(head);
  });
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) c.socket.destroy();
      else { c.alive = false; c.socket.write(frame('', 9)); }
    }
  }, 15000);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));
  return { server, code, close: () => { for (const c of clients) c.socket.destroy(); server.close(); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  app.server.listen(3000, '0.0.0.0', () => console.log('Living Room Sports: http://localhost:3000 — open the dashboard for phone join links.'));
}
