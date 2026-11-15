// Reads the game ID and title from Wii/GameCube disc images without Dolphin, and finds them in folders.
import { open, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import { discFits } from '../public/catalog.js';

export const DISC_EXTENSIONS = ['.iso', '.gcm', '.wbfs', '.rvz', '.wia', '.gcz', '.ciso'];
const WII_MAGIC = 0x5d1c9ea3, GC_MAGIC = 0xc2339f3d;

// The titles this console has channels for. Region letter: E USA, P Europe, J Japan, K Korea, W Taiwan.
export const TITLES = {
  mkw: { name: 'Mario Kart Wii', pattern: /^RMC[A-Z]01$/ },
  sports: { name: 'Wii Sports', pattern: /^RSP[A-Z]01$/ },
  resort: { name: 'Wii Sports Resort', pattern: /^RZT[A-Z]01$/ },
  brawl: { name: 'Super Smash Bros. Brawl', pattern: /^RSB[A-Z]01$/ }
};
const REGIONS = { E: 'USA', P: 'Europe', J: 'Japan', K: 'Korea', W: 'Taiwan' };

export function recognize(id, title = '') {
  for (const [key, entry] of Object.entries(TITLES)) if (entry.pattern.test(id)) return key;
  // The 2-in-1 "Wii Sports + Wii Sports Resort" disc: recognised by its title, offered for both channels.
  if (/wii\s*sports/i.test(title) && /resort/i.test(title) && /\+|&/.test(title)) return 'pack';
  return null;
}
export const regionOf = id => REGIONS[id?.[3]] || 'Unknown region';

function parseHeader(buf, offset, format) {
  if (buf.length < offset + 0x60) return null;
  const isWii = buf.readUInt32BE(offset + 0x18) === WII_MAGIC, isGC = buf.readUInt32BE(offset + 0x1c) === GC_MAGIC;
  if (!isWii && !isGC) return null;
  const id = buf.toString('latin1', offset, offset + 6);
  if (!/^[A-Z0-9]{6}$/.test(id)) return null;
  const raw = buf.subarray(offset + 0x20, offset + 0x60);
  const end = raw.indexOf(0);
  const title = (end < 0 ? raw : raw.subarray(0, end)).toString('utf8').trim();
  return { id, title, platform: isWii ? 'Wii' : 'GameCube', format };
}

async function readAt(handle, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

export async function identify(path) {
  const handle = await open(path, 'r');
  try {
    const head = await readAt(handle, 0, 0x400);
    if (head.length < 0x60) return null;
    const magic = head.toString('latin1', 0, 4);
    if (magic === 'WBFS') return parseHeader(head, 0x200, 'WBFS');
    if ((magic === 'RVZ\x01' || magic === 'WIA\x01')) return parseHeader(head, 0x58, magic.slice(0, 3));
    if (magic === 'CISO') return parseHeader(await readAt(handle, 0x8000, 0x100), 0, 'CISO');
    if (head.readUInt32LE(0) === 0xb10bc001) {
      // GCZ: 32-byte header, then u64 block offsets and u32 hashes, then the (usually zlib) blocks.
      const blockSize = head.readUInt32LE(24), blocks = head.readUInt32LE(28);
      if (!blocks || blocks > 1e7 || blockSize > 0x400000) return null;
      const table = await readAt(handle, 32, 16);
      const first = table.readBigUInt64LE(0), second = blocks > 1 ? table.readBigUInt64LE(8) : null;
      const dataStart = 32 + blocks * 12;
      const uncompressed = (first >> 63n) === 1n, start = first & ~(1n << 63n);
      const length = second === null ? blockSize : Number((second & ~(1n << 63n)) - start);
      const block = await readAt(handle, dataStart + Number(start), Math.min(Math.max(length, 0x60), blockSize + 64));
      return parseHeader(uncompressed ? block : inflateSync(block, { finishFlush: 2 }), 0, 'GCZ');
    }
    return parseHeader(head, 0, extname(path).toLowerCase() === '.gcm' ? 'GCM' : 'ISO');
  } catch { return null; }
  finally { await handle.close(); }
}

// Recursively lists disc images (depth-limited, skipping tiny files and split WBFS parts).
export async function findDiscs(folder, depth = 3) {
  const found = [];
  async function walk(dir, level) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (level < depth && !entry.name.startsWith('.')) await walk(full, level + 1); }
      else if (DISC_EXTENSIONS.includes(extname(entry.name).toLowerCase())) found.push(full);
    }
  }
  await walk(folder, 0);
  return found;
}

export async function scanLibrary(folders, files = [], identifyFn = identify) {
  const paths = new Set(files);
  for (const folder of folders) for (const path of await findDiscs(folder)) paths.add(path);
  const discs = [];
  for (const path of paths) {
    let size = 0;
    try { size = (await stat(path)).size; } catch { discs.push({ path, name: basename(path), error: 'File not found' }); continue; }
    const info = await identifyFn(path);
    if (!info) { discs.push({ path, name: basename(path), size, error: 'Not a readable Wii or GameCube disc image' }); continue; }
    discs.push({ path, name: basename(path), size, ...info, region: regionOf(info.id), title: info.title, kind: recognize(info.id, info.title) });
  }
  return discs.sort((a, b) => (a.kind ? 0 : 1) - (b.kind ? 0 : 1) || a.name.localeCompare(b.name));
}

// Picks one disc per channel title, honouring the person's earlier choice when it still exists.
export function chooseTitles(discs, chosen = {}) {
  const out = {};
  for (const key of Object.keys(TITLES)) {
    const matches = discs.filter(d => discFits(d.kind, key));
    const keep = matches.find(d => d.path === chosen[key]);
    const pick = keep || matches.find(d => d.kind === key) || matches[0];
    out[key] = pick ? { path: pick.path, id: pick.id, region: pick.region, title: pick.title, pack: pick.kind === 'pack' } : null;
  }
  return out;
}
