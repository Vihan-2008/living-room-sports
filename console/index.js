// The console's back end: settings, game library, Dolphin launches and the phone-to-Dolphin bridge,
// exposed to the menu through a small JSON API that only answers this PC.
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createSettings } from './settings.js';
import { scanLibrary, chooseTitles, TITLES, DISC_EXTENSIONS } from './disc.js';
import { createDolphinManager, findDolphin, resolveUserDir, dolphinVersion, exists, LaunchError } from './dolphin.js';
import { createDsuServer, padFromPhone } from './dsu.js';
import { pick as nativePick } from './dialogs.js';
import { createDisplays } from './screens.js';
import { PHONE_TO_DSU } from '../public/bindings.js';

const MAX_BODY = 64 * 1024;

export function isLocalRequest(req) {
  const address = req.socket.remoteAddress || '';
  if (!/^(127\.|::1$|::ffff:127\.)/.test(address)) return false;
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  return ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(value && typeof value === 'object' ? value : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function createConsole({ dataDir, dsuPort = 26760, getPhones = () => [], focusApp = () => {}, hooks = {} } = {}) {
  const settings = createSettings(dataDir);
  const listeners = new Set();
  const dsu = createDsuServer({ port: dsuPort });
  const find = hooks.findDolphin || findDolphin;
  const userDirOf = hooks.resolveUserDir || (exe => resolveUserDir(exe));
  const pick = hooks.pick || nativePick;
  let library = { scanning: false, discs: [], scannedAt: null };
  let dolphinInfo = { path: '', found: false, version: null, userDir: null, userDirReason: null };
  let https = { ready: false, port: null, error: null };
  let dsuError = null;
  // A test that fakes Dolphin gets no real screen helper unless it brings its own.
  const displays = 'displays' in hooks ? hooks.displays : hooks.spawn ? null : createDisplays({ onChange: () => notify() });

  const dolphin = createDolphinManager({
    settings, dataDir, dsuPort: () => dsu.port, focusApp, userDirOf, displays,
    spawn: hooks.spawn, processes: hooks.processes, close: hooks.close, identifyDisc: hooks.identify,
    onChange: () => notify()
  });

  async function refreshDolphin() {
    const { dolphinPath } = await settings.load();
    if (!dolphinPath) { dolphinInfo = { path: '', found: false, version: null, userDir: null, userDirReason: null }; return; }
    const found = await exists(dolphinPath);
    const user = found ? await userDirOf(dolphinPath).catch(() => null) : null;
    dolphinInfo = { path: dolphinPath, found, version: found && !hooks.spawn ? await dolphinVersion(dolphinPath) : null, userDir: user?.dir || null, userDirReason: user?.reason || null };
  }

  async function scan() {
    const s = await settings.load();
    library = { ...library, scanning: true };
    notify();
    try {
      const discs = await scanLibrary(s.gameFolders, s.gameFiles, hooks.identify);
      const chosen = chooseTitles(discs, s.titles);
      await settings.save({ titles: Object.fromEntries(Object.entries(chosen).map(([key, disc]) => [key, disc?.path || ''])) });
      library = { scanning: false, discs, scannedAt: Date.now() };
    } catch (error) { library = { ...library, scanning: false, error: error.message }; }
    notify();
  }

  function setupSteps(s) {
    const steps = [];
    steps.push(dolphinInfo.found
      ? { id: 'dolphin', done: true, message: `Dolphin ${dolphinInfo.version || ''}`.trim() }
      : { id: 'dolphin', done: false, message: s.dolphinPath ? 'Dolphin.exe is no longer where it was.' : 'Dolphin is not chosen yet.', next: 'Choose Dolphin.exe, or press Find automatically.' });
    for (const [key, entry] of Object.entries(TITLES)) {
      const disc = library.discs.find(d => d.path === s.titles[key]);
      steps.push(disc
        ? { id: key, done: true, message: `${entry.name} · ${disc.id} · ${disc.region}` }
        : { id: key, done: false, message: `${entry.name} was not found in your game folders.`, next: `Add the folder or file that holds ${entry.name}.` });
    }
    return steps;
  }

  async function state() {
    const s = await settings.load();
    const titles = {};
    for (const [key, entry] of Object.entries(TITLES)) {
      const disc = library.discs.find(d => d.path === s.titles[key]) || null;
      titles[key] = { name: entry.name, ready: !!disc && dolphinInfo.found, disc };
    }
    return {
      settings: s,
      dolphin: { ...dolphinInfo, ...dolphin.state() },
      library: { ...library, folders: s.gameFolders, files: s.gameFiles, titles },
      setup: setupSteps(s),
      dsu: { ...dsu.info(), error: dsuError },
      https,
      phones: getPhones(),
      screens: (displays?.screens || []).map(({ id, name, primary, width, height }) => ({ id, name, primary, width, height }))
    };
  }

  let pendingNotify = null;
  function notify() {
    if (pendingNotify) return;
    pendingNotify = setTimeout(async () => {
      pendingNotify = null;
      const value = await state();
      for (const listener of listeners) listener(value);
    }, 30);
  }

  async function addPaths(paths) {
    const s = await settings.load();
    const folders = new Set(s.gameFolders), files = new Set(s.gameFiles);
    for (const path of paths) {
      let info;
      try { info = await stat(path); } catch { throw new LaunchError('not-found', `Nothing found at ${path}`, 'Check the path and try again.', 400); }
      if (info.isDirectory()) folders.add(path);
      else if (DISC_EXTENSIONS.includes(extname(path).toLowerCase())) files.add(path);
      else throw new LaunchError('not-a-disc', `${basename(path)} is not a Wii disc image.`, `Choose a file ending in ${DISC_EXTENSIONS.join(', ')}.`, 400);
    }
    await settings.save({ gameFolders: [...folders], gameFiles: [...files] });
    await scan();
  }

  async function setDolphin(path) {
    if (!/dolphin[^\\/]*\.exe$/i.test(path) || !await exists(path)) throw new LaunchError('not-dolphin', `${path} is not Dolphin.exe.`, 'Choose the Dolphin.exe file inside your Dolphin folder.', 400);
    await settings.save({ dolphinPath: path });
    await refreshDolphin();
    notify();
  }

  const routes = {
    'GET /api/state': async () => state(),
    'POST /api/settings': async body => {
      await settings.save(body.patch || {});
      if (body.patch && 'dolphinPath' in body.patch) await refreshDolphin();
      notify();
      return state();
    },
    'POST /api/pick': async body => {
      const s = await settings.load();
      const initial = body.kind === 'dolphin' ? (s.dolphinPath ? s.dolphinPath.replace(/[\\/][^\\/]+$/, '') : '') : s.gameFolders[0] || '';
      const chosen = await pick(body.kind, { initial });
      if (!chosen.length) return { cancelled: true, ...(await state()) };
      if (body.kind === 'dolphin') await setDolphin(chosen[0]);
      else await addPaths(chosen);
      return state();
    },
    'POST /api/dolphin/path': async body => { await setDolphin(String(body.path || '').trim().replace(/^"|"$/g, '')); return state(); },
    'POST /api/dolphin/detect': async () => {
      const found = await find();
      if (!found) throw new LaunchError('not-found', 'Dolphin was not found in the usual places.', 'Press Choose Dolphin.exe and pick it yourself, or install Dolphin from dolphin-emu.org.', 404);
      await setDolphin(found);
      return state();
    },
    'POST /api/library/add': async body => { await addPaths([String(body.path || '').trim().replace(/^"|"$/g, '')]); return state(); },
    'POST /api/library/remove': async body => {
      const s = await settings.load();
      await settings.save({ gameFolders: s.gameFolders.filter(p => p !== body.path), gameFiles: s.gameFiles.filter(p => p !== body.path) });
      await scan();
      return state();
    },
    'POST /api/library/scan': async () => { await scan(); return state(); },
    'POST /api/titles': async body => {
      if (!TITLES[body.title]) throw new LaunchError('bad-title', 'Unknown channel.', null, 400);
      const disc = library.discs.find(d => d.path === body.path);
      if (!disc) throw new LaunchError('bad-disc', 'That disc is not in the library.', 'Rescan the library.', 400);
      await settings.save({ titles: { [body.title]: disc.path } });
      notify();
      return state();
    },
    'POST /api/launch': async body => {
      if (!TITLES[body.title]) throw new LaunchError('bad-title', 'Unknown channel.', null, 400);
      await dolphin.launch({ title: body.title, sport: typeof body.sport === 'string' ? body.sport.slice(0, 40) : null });
      return state();
    },
    'POST /api/stop': async body => { await dolphin.stop({ foreign: body.foreign === true }); return state(); },
    'POST /api/screens': async () => { await displays?.list().catch(() => {}); return state(); },
    'POST /api/screen': async body => { await dolphin.moveTo(typeof body.to === 'string' ? body.to.slice(0, 64) : 'next'); return state(); },
    'POST /api/exit/dismiss': async () => { dolphin.clearLastExit(); return state(); }
  };

  async function api(req, res, url) {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (!isLocalRequest(req)) return send(403, { error: 'The console API only answers this PC.' });
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return send(404, { error: 'Not found' });
    if (req.method === 'POST' && (req.headers['x-living-room'] !== '1' || !/^application\/json/.test(req.headers['content-type'] || ''))) return send(403, { error: 'Missing console request header.' });
    try {
      const body = req.method === 'POST' ? await readJson(req) : {};
      send(200, await route(body));
    } catch (error) {
      const status = error.status || 500;
      send(status, { error: error.message, code: error.code || 'error', step: error.step || null });
    }
  }

  async function start() {
    await settings.load();
    await dolphin.restore().catch(() => {});
    try { await dsu.start(); } catch (error) { dsuError = `Phone controllers for Dolphin are unavailable: ${error.message}`; }
    displays?.list().catch(() => {});
    await refreshDolphin();
    await scan();
  }

  return {
    start, api, state, scan, settings, dolphin, dsu,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    notify,
    setHttps(value) { https = { ...https, ...value }; notify(); },
    phonePad(slot, msg) { dsu.setPad(slot - 1, padFromPhone(msg, PHONE_TO_DSU)); },
    phoneLeft(slot) { dsu.clearPad(slot - 1); },
    close() { dsu.close(); clearTimeout(pendingNotify); }
  };
}
