// Console settings, stored as JSON in the app's data folder (never inside Dolphin's folders).
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function dataDir(env = process.env) {
  if (env.LRS_DATA_DIR) return env.LRS_DATA_DIR;
  if (process.platform === 'win32') return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'LivingRoomSports');
  return join(homedir(), '.living-room-sports');
}

export const PLAYER_TYPES = ['dualsense', 'phone', 'keyboard', 'wiimote', 'off'];

export function defaults() {
  return {
    dolphinPath: '',
    gameFolders: [],
    gameFiles: [],
    titles: { mkw: '', sports: '', resort: '' },
    // screen: 'main', or the id Windows gives another screen (such as \\.\DISPLAY1).
    launch: { fullscreen: true, backgroundInput: true, screen: 'main' },
    controls: {
      // 'console': write this app's layouts into Dolphin for each launch (and undo them afterwards).
      // 'dolphin': leave Dolphin's own controller settings alone.
      layouts: 'console',
      players: ['dualsense', 'phone', 'phone', 'phone'],
      keyboardP1: true,
      gameDeadzone: 0.1,
      dashboard: { deadzone: 0.2, pointerSpeed: 1, buttons: { select: 0, back: 1, home: 16, options: 9, pageLeft: 4, pageRight: 5 } }
    },
    phones: { joining: true },
    display: { aspect: 'auto', startFullscreen: false, sounds: true, volume: 0.6 },
    menu: { lastChannel: 'mkw', lastSport: 'tennis', lastMode: 'grand-prix', editions: { bowling: 'sports', golf: 'sports' } },
    setupSeen: false
  };
}

// Only keys present in the defaults are kept, and each keeps the default's type.
export function sanitize(value, template = defaults()) {
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return template;
    if (template.every(item => typeof item === 'string')) return value.filter(v => typeof v === 'string').slice(0, 64);
    return template;
  }
  if (template && typeof template === 'object') {
    const out = {};
    for (const [key, def] of Object.entries(template)) {
      if (def && typeof def === 'object' && !Array.isArray(def) && Object.keys(def).length === 0) {
        out[key] = value && typeof value[key] === 'object' && value[key] ? { ...value[key] } : {};
      } else out[key] = sanitize(value?.[key], def);
    }
    return out;
  }
  if (typeof value !== typeof template) return template;
  if (typeof value === 'number' && !Number.isFinite(value)) return template;
  if (typeof value === 'string') return value.slice(0, 1024);
  return value;
}

export function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
      ? merge(base[key], value) : value;
  }
  return out;
}

export function validPlayers(players) {
  return Array.from({ length: 4 }, (_, i) => (PLAYER_TYPES.includes(players?.[i]) ? players[i] : 'phone'));
}

export function createSettings(dir = dataDir()) {
  const file = join(dir, 'settings.json');
  let current = null;
  async function load() {
    if (current) return current;
    try { current = sanitize(JSON.parse(await readFile(file, 'utf8'))); }
    catch { current = defaults(); }
    current.controls.players = validPlayers(current.controls.players);
    return current;
  }
  async function save(patch) {
    const next = sanitize(merge(await load(), patch));
    next.controls.players = validPlayers(next.controls.players);
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, file);
    current = next;
    return current;
  }
  return { file, dir, load, save, get: () => current };
}
