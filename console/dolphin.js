// Finds Dolphin and its user folder, launches a game with this console's controller setup,
// watches the process, and puts every changed Dolphin setting back when the game ends.
import { spawn as nodeSpawn, execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { readValue, createJournal } from './ini.js';
import { buildLaunchPlan, DSU_NAME } from './profiles.js';
import { identify } from './disc.js';

export const exists = path => access(path).then(() => true, () => false);

function run(file, args, { timeout = 8000, env } = {}) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout, encoding: 'utf8', env: env ? { ...process.env, ...env } : undefined },
      (error, stdout) => resolve(error ? null : stdout));
  });
}

// ---- Finding Dolphin --------------------------------------------------------------------------
export function candidatePaths(env = process.env) {
  const home = env.USERPROFILE || homedir();
  const dirs = [];
  for (const root of [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']].filter(Boolean)) dirs.push(join(root, 'Dolphin'), join(root, 'Dolphin-x64'), join(root, 'Dolphin Emulator'));
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Programs', 'Dolphin'), join(env.LOCALAPPDATA, 'Programs', 'Dolphin Emulator'), join(env.LOCALAPPDATA, 'Dolphin'));
  for (const place of ['Downloads', 'Desktop', 'Documents']) dirs.push(join(home, place, 'Dolphin-x64'), join(home, place, 'Dolphin'));
  dirs.push(join(home, 'scoop', 'apps', 'dolphin', 'current'), join(home, 'Games', 'Dolphin-x64'), join(home, 'Games', 'Dolphin'));
  for (const drive of ['C:', 'D:', 'E:']) dirs.push(`${drive}\\Dolphin-x64`, `${drive}\\Dolphin`, `${drive}\\Games\\Dolphin-x64`, `${drive}\\Games\\Dolphin`, `${drive}\\Emulators\\Dolphin-x64`, `${drive}\\Emulators\\Dolphin`);
  return [...new Set(dirs)].map(dir => join(dir, 'Dolphin.exe'));
}

// Looks in the usual install places, then one and two folders deep in Downloads, Desktop and Games.
export async function findDolphin({ env = process.env, fileExists = exists, list = readdir } = {}) {
  for (const path of candidatePaths(env)) if (await fileExists(path)) return path;
  const home = env.USERPROFILE || homedir();
  for (const root of ['Downloads', 'Desktop', 'Games'].map(place => join(home, place))) {
    let entries;
    try { entries = await list(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.filter(e => e.isDirectory() && /dolphin/i.test(e.name))) {
      const direct = join(root, entry.name, 'Dolphin.exe');
      if (await fileExists(direct)) return direct;
      try {
        for (const inner of (await list(join(root, entry.name), { withFileTypes: true })).filter(e => e.isDirectory())) {
          const nested = join(root, entry.name, inner.name, 'Dolphin.exe');
          if (await fileExists(nested)) return nested;
        }
      } catch {}
    }
  }
  return null;
}

async function registryValue(key, name) {
  const out = await run('reg.exe', ['query', key, '/v', name]);
  const line = out?.split(/\r?\n/).find(l => l.trim().startsWith(name));
  const match = line?.match(/REG_\w+\s+(.*)$/);
  return match ? match[1].trim() : null;
}

export const windowsSources = {
  dolphin: name => registryValue('HKCU\\Software\\Dolphin Emulator', name),
  documents: async () => (await registryValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', 'Personal')) || join(homedir(), 'Documents'),
  appData: async () => process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
};

// Dolphin's own order for choosing its user folder on Windows (UICommon::SetUserDirectory).
export async function resolveUserDir(exe, { fileExists = exists, sources = windowsSources } = {}) {
  const exeDir = dirname(exe);
  if (await fileExists(join(exeDir, 'portable.txt'))) return { dir: join(exeDir, 'User'), reason: 'portable.txt next to Dolphin.exe' };
  const local = await sources.dolphin('LocalUserConfig');
  if (local && /^(1|0x0*1|true)$/i.test(local)) return { dir: join(exeDir, 'User'), reason: 'Dolphin is set to keep its settings next to Dolphin.exe' };
  const custom = await sources.dolphin('UserConfigPath');
  if (custom) return { dir: custom.replace(/[\\/]+$/, ''), reason: 'custom user folder set in Dolphin' };
  const documents = await sources.documents();
  if (documents && await fileExists(join(documents, 'Dolphin Emulator'))) return { dir: join(documents, 'Dolphin Emulator'), reason: 'Documents\\Dolphin Emulator' };
  const appData = await sources.appData();
  if (appData && await fileExists(appData)) return { dir: join(appData, 'Dolphin Emulator'), reason: 'AppData\\Roaming\\Dolphin Emulator' };
  return { dir: join(exeDir, 'User'), reason: 'next to Dolphin.exe' };
}

const versions = new Map();
export async function dolphinVersion(exe) {
  let key;
  try { key = `${exe}|${(await stat(exe)).mtimeMs}`; } catch { return null; }
  if (!versions.has(key)) {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:LRS_EXE).VersionInfo.ProductVersion'], { env: { LRS_EXE: exe } });
    versions.set(key, out?.trim() || null);
  }
  return versions.get(key);
}

// ---- Processes ----------------------------------------------------------------------------------
export async function listProcesses(image = 'Dolphin.exe') {
  const out = await run('tasklist.exe', ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`]);
  if (!out) return [];
  return out.split(/\r?\n/).map(line => line.match(/^"([^"]+)","(\d+)"/)).filter(Boolean).map(m => Number(m[2]));
}
export function closeProcess(pid, force = false) {
  return run('taskkill.exe', ['/PID', String(pid), ...(force ? ['/F'] : [])]);
}

// message is the headline the menu shows; detail says what it means and what to do next.
export function classifyExit(code, signal, runtimeMs) {
  if (code === 0 && runtimeMs >= 10000) return { kind: 'stopped', message: 'The game was closed.', detail: null };
  if (code === 0) return { kind: 'quick-exit', message: 'Dolphin closed right after starting.', detail: 'If Dolphin showed an error, open the game in Dolphin on its own to read it, then press Start here again.' };
  const unsigned = code === null ? null : code >>> 0;
  if (unsigned !== null && unsigned >= 0xc0000000) return { kind: 'crashed', message: 'Dolphin stopped unexpectedly.', detail: `Windows reported error 0x${unsigned.toString(16).toUpperCase()}. Anything the game saved before then is kept.` };
  if (runtimeMs < 10000) return { kind: 'launch-failed', message: 'Dolphin could not start the game.', detail: `It closed with exit code ${code ?? signal}. The end of Dolphin's log is below.` };
  return { kind: 'error', message: 'Dolphin closed with an error.', detail: `It closed with exit code ${code ?? signal}. Anything the game saved before then is kept.` };
}

export function launchArgs({ userDir, game, fullscreen = true, backgroundInput = true, dsuEntries, config = [] }) {
  const args = ['-b', '-u', userDir, '-e', game,
    '-C', `Dolphin.Display.Fullscreen=${fullscreen ? 'True' : 'False'}`,
    '-C', 'Dolphin.Interface.ConfirmStop=False',
    '-C', `Dolphin.Input.BackgroundInput=${backgroundInput ? 'True' : 'False'}`];
  if (dsuEntries) args.push('-C', 'DualShockUDPClient.Server.Enabled=True', '-C', `DualShockUDPClient.Server.Entries=${dsuEntries}`);
  for (const item of config) args.push('-C', item);
  return args;
}

// Keeps the person's own DSU servers and adds this app's phone server.
export function dsuEntries(existing, port) {
  const ours = `${DSU_NAME}:127.0.0.1:${port};`;
  const kept = String(existing || '').split(';').map(s => s.trim()).filter(entry => entry && !entry.startsWith(`${DSU_NAME}:`));
  return [...kept.map(entry => `${entry};`), ours].join('');
}

const logSize = file => stat(file).then(info => info.size, () => 0);
// Dolphin appends to one log across runs, so only what this run wrote (from byte `from` on) is shown.
async function tail(file, from, lines = 12) {
  try {
    const bytes = await readFile(file);
    const text = bytes.subarray(bytes.length >= from ? from : 0).toString('utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n') || null;
  } catch { return null; }
}

// ---- Launch manager ----------------------------------------------------------------------------
export class LaunchError extends Error {
  constructor(code, message, step, status = 409) { super(message); this.code = code; this.step = step; this.status = status; }
}

export function createDolphinManager({ settings, dataDir, dsuPort = () => null, onChange = () => {}, focusApp = () => {},
  spawn = nodeSpawn, processes = listProcesses, close = closeProcess, userDirOf = exe => resolveUserDir(exe), identifyDisc = identify } = {}) {
  const journal = createJournal(join(dataDir, 'dolphin-journal.json'));
  let session = null, lastExit = null, stopping = null;

  const state = () => ({
    running: !!session, title: session?.title || null, sport: session?.sport || null, pid: session?.child.pid || null,
    startedAt: session?.startedAt || null, roles: session?.roles || [], stopping: !!stopping, lastExit
  });
  const changed = () => onChange(state());

  async function foreignDolphins(exe) {
    const pids = await processes(basename(exe || 'Dolphin.exe'));
    return pids.filter(pid => pid !== session?.child.pid);
  }

  async function prepare({ title, sport = null }) {
    const s = await settings.load();
    if (session) throw new LaunchError('busy', 'A game is already running. Close it before starting another.', 'Return to the game, or press Quit game on a phone.');
    if (!s.dolphinPath || !await exists(s.dolphinPath)) throw new LaunchError('no-dolphin', 'Dolphin is not set up yet.', 'Open Wii Options › Setup and choose Dolphin.exe.');
    const game = s.titles[title];
    if (!game) throw new LaunchError('no-game', 'No game file is chosen for this channel.', 'Open Wii Options › Setup and add the folder or file with your game.');
    if (!await exists(game)) throw new LaunchError('missing-game', `The game file is missing: ${game}`, 'Reconnect the drive that holds it, or choose the file again in Wii Options › Setup.');
    const disc = await identifyDisc(game);
    if (!disc) throw new LaunchError('unreadable-game', 'That game file could not be read as a Wii disc.', 'Choose a different copy of the game in Wii Options › Setup.');
    if ((await foreignDolphins(s.dolphinPath)).length) throw new LaunchError('dolphin-open', 'Dolphin is already open.', 'Close Dolphin first so both copies do not share settings, then press Start again.');
    return { s, game, disc };
  }

  async function launch(request) {
    const { s, game, disc } = await prepare(request);
    const { dir: userDir } = await userDirOf(s.dolphinPath);
    await journal.restore();
    let plan = { roles: [], config: [] };
    if (s.controls.layouts === 'console') {
      plan = buildLaunchPlan(request.title, s.controls.players, { keyboardP1: s.controls.keyboardP1, deadzone: s.controls.gameDeadzone });
      for (const profile of plan.profiles) {
        const folder = join(userDir, 'Config', 'Profiles', profile.type);
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, `${profile.name}.ini`), profile.text);
      }
      await journal.apply(join(userDir, 'GameSettings', `${disc.id}.ini`), 'Controls', plan.controls);
    }
    let existingDsu = null;
    try { existingDsu = readValue(await readFile(join(userDir, 'Config', 'DualShockUDPClient.ini'), 'utf8'), 'Server', 'Entries'); } catch {}
    const port = dsuPort();
    const args = launchArgs({ userDir, game, fullscreen: s.launch.fullscreen, backgroundInput: s.launch.backgroundInput,
      dsuEntries: port ? dsuEntries(existingDsu, port) : null, config: plan.config });
    const logFile = join(userDir, 'Logs', 'dolphin.log');
    const logStart = await logSize(logFile);
    const startedAt = Date.now();
    let child;
    try { child = spawn(s.dolphinPath, args, { cwd: dirname(s.dolphinPath), stdio: 'ignore', windowsHide: false }); }
    catch (error) { await journal.restore(); throw new LaunchError('spawn-failed', `Dolphin could not be started: ${error.message}`, 'Choose Dolphin.exe again in Wii Options › Setup.', 500); }
    let ended;
    session = { child, title: request.title, sport: request.sport || null, startedAt, roles: plan.roles, userDir, discId: disc.id,
      ended: new Promise(resolve => { ended = resolve; }) };
    lastExit = null;
    await new Promise((resolve, reject) => {
      // Dolphin is started by the server, which Windows may not let take the foreground; ask for it.
      child.once('spawn', () => { focusApp(child.pid); resolve(); });
      child.once('error', async error => {
        session = null;
        await journal.restore();
        reject(new LaunchError('spawn-failed', `Dolphin could not be started: ${error.message}`, 'Choose Dolphin.exe again in Wii Options › Setup.', 500));
      });
    });
    child.once('exit', async (code, signal) => {
      // The game counts as running until Dolphin's settings are back, so nothing starts or shuts down mid-restore.
      const finished = session;
      const runtime = Date.now() - startedAt;
      // A close the player asked for is never reported as a failure, however soon or however it ended.
      const result = finished.requested ? { kind: 'stopped', message: 'The game was closed.', detail: null } : classifyExit(code, signal, runtime);
      const restored = await journal.restore().catch(error => ({ failures: [{ error: error.message }] }));
      const log = result.kind === 'stopped' ? null : await tail(logFile, logStart);
      lastExit = { ...result, code, title: finished.title, sport: finished.sport, at: Date.now(), runtime, log,
        restoreFailed: restored.failures?.length ? restored.failures : undefined };
      session = null; stopping = null;
      focusApp();
      changed();
      ended();
    });
    changed();
    return state();
  }

  // Asks Dolphin to close like its window's close button; forces it only if it does not respond.
  async function stop({ foreign = false } = {}) {
    if (foreign) {
      const s = await settings.load();
      for (const pid of await foreignDolphins(s.dolphinPath)) await close(pid);
      return state();
    }
    if (!session) return state();
    const { child: { pid }, ended } = session;
    session.requested = true;
    stopping ??= (async () => {
      changed();
      await close(pid);
      let timer;
      const timeout = new Promise(resolve => { timer = setTimeout(resolve, 8000, 'timeout'); });
      if (await Promise.race([ended, timeout]) === 'timeout') { await close(pid, true); await ended; }
      clearTimeout(timer);
    })();
    const pending = stopping;
    await pending;
    if (stopping === pending) stopping = null;
    return state();
  }

  return { launch, stop, state, restore: () => journal.restore(), foreignDolphins, clearLastExit: () => { lastExit = null; changed(); } };
}
