// The Wii Menu: a 4 × 3 channel grid over four pages, the bottom shelf with the clock, the channel
// preview, and a stack of screens above it. Everything is laid out on a fixed 1280 × 720 (16:9) or
// 960 × 720 (4:3) stage that is scaled to fit the window.
import { drawChannel, clockSvg, GLYPHS } from './menu-art.js';
import { createInput, PLAYER_COLORS } from './menu-input.js';
import { play, configure as configureSound, unlock } from './menu-sound.js';
import { h, art, button, isFullscreen } from './menu-ui.js';
import { channelViews } from './menu-channels.js';
import { optionViews } from './menu-options.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const CHANNELS = [
  { id: 'sports', name: 'Wii Sports', art: 'sports' },
  { id: 'mkw', name: 'Mario Kart Wii', art: 'mkw' },
  { id: 'brawl', name: 'Super Smash Bros. Brawl', art: 'brawl' },
  { id: 'arcade', name: 'Living Room Sports', art: 'arcade' }
];
const PAGE_COUNT = 4, PER_PAGE = 12, BANNER_HEIGHT = 560;
const VIEWS = { ...channelViews, ...optionViews };

const app = { state: null, roster: [], room: null, page: 0, scale: 1, online: false };
const stack = [];
const padListeners = new Set();
let preview = null, dialogClose = null, shownExit = null, queue = Promise.resolve(), busy = false, socket = null, zooming = null, firstRunShown = false;

// ---- Stage --------------------------------------------------------------------------------------
function aspect() {
  const chosen = app.state?.settings.display.aspect || 'auto';
  if (chosen === '16:9' || chosen === '4:3') return chosen;
  return innerWidth / innerHeight < 1.55 ? '4:3' : '16:9';
}
function stageWidth() { return stage.dataset.aspect === '4:3' ? 960 : 1280; }

let afterFit = () => {};
function fit() {
  const next = aspect();
  if (stage.dataset.aspect !== next || !stage.style.width) {
    stage.dataset.aspect = next;
    stage.style.width = `${stageWidth()}px`;
    drawShelf();
  }
  const width = stageWidth(), scale = Math.min(innerWidth / width, innerHeight / 720);
  app.scale = scale;
  stage.style.transform = `translate(${(innerWidth - width * scale) / 2}px, ${(innerHeight - 720 * scale) / 2}px) scale(${scale})`;
  afterFit();
}
addEventListener('resize', fit);
document.addEventListener('fullscreenchange', fit);

function rectInStage(el) {
  const r = el.getBoundingClientRect(), origin = stage.getBoundingClientRect();
  return { x: (r.left - origin.left) / app.scale, y: (r.top - origin.top) / app.scale, w: r.width / app.scale, h: r.height / app.scale };
}

// The shelf: a curved panel with a well for each round button and a dip under the date.
function drawShelf() {
  const w = stageWidth(), cx = w === 960 ? 92 : 128, r = 58, flat = 30, top = 8, dip = 44;
  const edge = `M0 ${flat} L${cx - r - 16} ${flat} C${cx - r} ${flat} ${cx - r + 4} ${top} ${cx} ${top} C${cx + r - 4} ${top} ${cx + r} ${flat} ${cx + r + 16} ${flat}`
    + ` C${w * 0.34} ${flat} ${w * 0.4} ${dip} ${w / 2} ${dip} C${w * 0.6} ${dip} ${w * 0.66} ${flat} ${w - cx - r - 16} ${flat}`
    + ` C${w - cx - r} ${flat} ${w - cx - r + 4} ${top} ${w - cx} ${top} C${w - cx + r - 4} ${top} ${w - cx + r} ${flat} ${w - cx + r + 16} ${flat} L${w} ${flat}`;
  const shape = $('shelf-shape');
  shape.setAttribute('viewBox', `0 0 ${w} 134`);
  shape.setAttribute('width', w);
  shape.querySelector('.shelf-fill').setAttribute('d', `${edge} L${w} 134 L0 134 Z`);
  shape.querySelector('.shelf-edge').setAttribute('d', edge);
  shape.querySelector('.shelf-shine').setAttribute('d', edge);
}

// ---- Channel grid -------------------------------------------------------------------------------
function buildGrid() {
  const pages = $('pages');
  pages.replaceChildren(...Array.from({ length: PAGE_COUNT }, (_, p) => h('div', { class: 'page', style: { left: `${p * 100}%` } },
    Array.from({ length: PER_PAGE }, (_, i) => {
      const channel = CHANNELS[p * PER_PAGE + i];
      if (!channel) return h('div', { class: 'slot empty', 'aria-hidden': 'true' });
      return h('button', { type: 'button', class: 'slot tile', 'aria-label': channel.name, dataset: { channel: channel.id, sound: 'open' },
        onClick: e => openPreview(channel, e.currentTarget) }, h('canvas', { class: 'tile-art' }));
    }))));
  setPage(0, { silent: true });
}

function setPage(page, { silent = false } = {}) {
  const next = Math.max(0, Math.min(PAGE_COUNT - 1, page));
  if (next === app.page && !silent) return;
  app.page = next;
  $('pages').style.transform = `translateX(${-next * 100}%)`;
  $('page-prev').hidden = next === 0;
  $('page-next').hidden = next === PAGE_COUNT - 1;
  [...$('pages').children].forEach((el, i) => { el.inert = i !== next; });
  if (!silent) play('page');
}

// ---- Clock and shelf ----------------------------------------------------------------------------
const hour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'numeric' });
const spokenTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
function tickClock() {
  const now = new Date();
  let hours = now.getHours();
  const suffix = hour12 ? (hours < 12 ? 'AM' : 'PM') : '';
  if (hour12) hours = hours % 12 || 12;
  const clock = $('clock');
  clock.replaceChildren(art(clockSvg(`${hours}:${String(now.getMinutes()).padStart(2, '0')}`, { colon: now.getSeconds() % 2 === 0 }), 'clock-digits'),
    suffix ? h('span', { class: 'clock-suffix' }, suffix) : '');
  clock.setAttribute('aria-label', spokenTime.format(now));
  $('date').textContent = dateFormat.format(now).replace(',', '');
  setTimeout(tickClock, 1000 - (Date.now() % 1000) + 5);
}

function updateLeds() {
  const players = app.state?.settings.controls.players || [];
  const padConnected = !!input?.activePad();
  document.querySelectorAll('#open-controllers .led').forEach((led, i) => {
    const type = players[i];
    const lit = app.roster[i]?.connected || (type === 'dualsense' && padConnected) || (type === 'keyboard');
    led.classList.toggle('lit', !!lit);
  });
}

// ---- Channel preview ----------------------------------------------------------------------------
function channelStatus(id) {
  const s = app.state;
  if (id === 'arcade') return { ready: true };
  if (!s) return { ready: false, message: 'Waiting for the console service…' };
  const dolphinStep = s.setup.find(step => step.id === 'dolphin');
  if (!dolphinStep.done) return { ready: false, message: dolphinStep.message, next: dolphinStep.next };
  if (id === 'sports') {
    const { sports, resort } = s.library.titles;
    if (sports.ready || resort.ready) return { ready: true };
    return { ready: false, message: 'Neither Wii Sports nor Wii Sports Resort is in your game folders.', next: 'Add the folder or file that holds them in Wii Options › Setup.' };
  }
  const step = s.setup.find(x => x.id === id);
  return step.done ? { ready: true } : { ready: false, message: step.message, next: step.next };
}

function updatePreview() {
  if (!preview) return;
  const status = channelStatus(preview.id);
  const start = $('preview-start');
  start.querySelector('.wbtn-label').textContent = status.ready ? 'Start' : 'Set up';
  start.dataset.sound = status.ready ? 'start' : 'select';
  const line = $('preview-status');
  line.replaceChildren(...(status.ready ? [] : [h('span', {}, status.message), status.next ? h('span', { class: 'preview-next' }, status.next) : '']));
  line.hidden = status.ready;
}

function openPreview(channel, tile) {
  run(async () => {
    preview = channel;
    updatePreview();
    save({ menu: { lastChannel: channel.id } });
    const width = stageWidth();
    await zoom(channel, rectInStage(tile), { x: 0, y: 0, w: width, h: BANNER_HEIGHT });
    $('home').hidden = true;
    $('preview').hidden = false;
    if (!reduceMotion.matches) $('preview-foot').animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    input.reset();
    input.focusFirst('#preview-start');
  });
}

function closePreview() {
  run(async () => {
    const channel = preview;
    const tile = document.querySelector(`.tile[data-channel="${channel.id}"]`);
    play('close');
    $('preview').hidden = true;
    $('home').hidden = false;
    setPage(Math.floor(CHANNELS.indexOf(channel) / PER_PAGE), { silent: true });
    await zoom(channel, { x: 0, y: 0, w: stageWidth(), h: BANNER_HEIGHT }, rectInStage(tile));
    preview = null;
    input.reset();
    input.focusFirst(`.tile[data-channel="${channel.id}"]`);
  });
}

async function zoom(channel, from, to) {
  if (reduceMotion.matches) return;
  const zoomer = $('zoomer');
  zooming = channel;
  zoomer.hidden = false;
  const frame = r => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  const animation = zoomer.animate([{ ...frame(from), borderRadius: '16px' }, { ...frame(to), borderRadius: to.w > from.w ? '0px' : '16px' }],
    { duration: 380, easing: 'cubic-bezier(.32,.72,.24,1)', fill: 'forwards' });
  await animation.finished;
  zoomer.hidden = true;
  animation.cancel();
  zooming = null;
}

function startChannel() {
  const status = channelStatus(preview.id);
  if (!status.ready) return push('setup');
  if (preview.id === 'arcade') {
    return run(async () => {
      if (!reduceMotion.matches) await $('fade').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: 'forwards' }).finished;
      location.href = '/arcade';
    });
  }
  push(preview.id);
}

// ---- Screens ------------------------------------------------------------------------------------
const top = () => stack[stack.length - 1] || null;

// Serialises screen changes so quick presses never interleave two transitions.
function run(task) {
  queue = queue.then(async () => { busy = true; try { await task(); } finally { busy = false; } }).catch(error => console.error(error));
  return queue;
}

async function fadeThrough(change) {
  const fade = $('fade');
  if (!reduceMotion.matches) await fade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'forwards', easing: 'ease-out' }).finished;
  change();
  input.reset();
  if (!reduceMotion.matches) await fade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 210, fill: 'forwards', easing: 'ease-in' }).finished;
}

function showTop() {
  const current = top();
  $('home').hidden = !!current || !!preview;
  $('preview').hidden = !!current || !preview;
  stack.forEach(entry => { entry.view.el.hidden = entry !== current; });
}

// The *Now forms run inside a queued task; push and pop queue one.
async function pushNow(name, params = {}) {
  const factory = VIEWS[name];
  if (!factory) return;
  const view = factory(context, params);
  const entry = { name, params, view };
  await fadeThrough(() => {
    view.el.hidden = true;
    $('views').append(view.el);
    stack.push(entry);
    if (app.state) view.update?.(app.state);
    showTop();
  });
  view.focus?.();
  input.focusFirst();
}

async function popNow() {
  const entry = top();
  if (!entry) return;
  await fadeThrough(() => {
    stack.pop();
    entry.view.dispose?.();
    entry.view.el.remove();
    showTop();
  });
  const now = top();
  if (now) now.view.update?.(app.state);
  input.focusFirst(now ? undefined : preview ? '#preview-start' : undefined);
}

const push = (name, params = {}) => run(() => pushNow(name, params));
const pop = () => run(popNow);

// Shows the Now playing screen exactly while a game runs. It is decided inside the queue, against the
// latest state, so a game that ends during a screen change can never leave the screen up (or open it twice).
let playingQueued = false;
function syncPlaying() {
  if (playingQueued) return;
  playingQueued = true;
  run(async () => {
    playingQueued = false;
    // Checked again after each change: the game may have ended while the screen was fading in.
    for (;;) {
      const running = !!app.state?.dolphin.running, showing = top()?.name === 'playing';
      if (running && !showing) await pushNow('playing');
      else if (!running && showing) await popNow();
      else break;
    }
  });
}

function goHome() {
  if (!stack.length && !preview) return;
  if (top()?.name === 'playing') return;
  run(async () => {
    play('close');
    await fadeThrough(() => {
      while (stack.length) { const entry = stack.pop(); entry.view.dispose?.(); entry.view.el.remove(); }
      preview = null;
      showTop();
    });
  });
}

function back() {
  if (busy) return;
  if (dialogClose) return dialogClose(null);
  const current = top();
  if (current) {
    if (current.view.back?.()) return;
    if (current.name === 'playing') return;
    play('back');
    pop();
    return;
  }
  if (preview) closePreview();
}

// ---- Dialogs and notices ------------------------------------------------------------------------
function dialog({ text, detail = null, log = null, buttons = [{ label: 'OK', value: true }] }) {
  return new Promise(resolve => {
    const layer = $('dialog');
    const close = value => {
      dialogClose = null;
      layer.hidden = true;
      layer.replaceChildren();
      document.querySelectorAll('.stage > section, .views').forEach(el => { el.inert = false; });
      input.reset();
      resolve(value);
    };
    layer.replaceChildren(h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': text },
      h('p', { class: 'dialog-text' }, text),
      detail ? h('p', { class: 'dialog-detail' }, detail) : null,
      log ? h('pre', { class: 'dialog-log' }, log) : null,
      // A dialog with a way out starts on it, so a doubled press never confirms something by accident.
      h('div', { class: 'dialog-buttons' }, buttons.map((b, i) => button(b.label, () => close(b.value), { kind: b.kind || '', sound: b.sound, isDefault: buttons.some(x => x.cancel) ? !!b.cancel : i === 0 })))));
    document.querySelectorAll('.stage > section, .views').forEach(el => { el.inert = true; });
    layer.hidden = false;
    dialogClose = value => { play('back'); close(buttons.find(b => b.cancel)?.value ?? value); };
    input.reset();
    input.focusFirst();
  });
}

function toast(text, color = null) {
  const item = h('div', { class: 'toast', role: 'status' }, color ? h('span', { class: 'toast-dot', style: { background: color } }) : null, h('span', {}, text));
  $('toasts').append(item);
  setTimeout(() => {
    if (reduceMotion.matches) return item.remove();
    item.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 240, fill: 'forwards' }).finished.then(() => item.remove());
  }, 3600);
}

// ---- Console service ----------------------------------------------------------------------------
class ConsoleError extends Error {
  constructor(message, code, step) { super(message); this.code = code; this.step = step; }
}

async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Living-Room': '1' }, body: JSON.stringify(body) });
  } catch {
    throw new ConsoleError('The console service is not responding.', 'offline', 'Close Living Room Sports and open it again from its shortcut.');
  }
  const value = await response.json().catch(() => ({ error: `The console service answered with an error (${response.status}).` }));
  if (!response.ok) throw new ConsoleError(value.error || `Request failed (${response.status}).`, value.code, value.step);
  if (value.settings) setState(value);
  return value;
}

const SETUP_CODES = new Set(['no-dolphin', 'no-game', 'missing-game', 'unreadable-game', 'spawn-failed']);
async function attempt(task) {
  try { return await task(); } catch (error) {
    play('error');
    if (error.code === 'dolphin-open') {
      const choice = await dialog({ text: error.message, detail: 'Close it here, or switch to Dolphin and close it yourself. Unsaved progress in that copy would be lost.',
        buttons: [{ label: 'Close Dolphin', value: 'close', kind: 'primary' }, { label: 'Cancel', value: null, cancel: true, sound: 'back' }] });
      if (choice === 'close') await attempt(() => api('/api/stop', { foreign: true }));
      return null;
    }
    const setupButton = SETUP_CODES.has(error.code) && top()?.name !== 'setup';
    const choice = await dialog({ text: error.message, detail: error.step,
      buttons: setupButton ? [{ label: 'Open Setup', value: 'setup', kind: 'primary' }, { label: 'Cancel', value: null, cancel: true, sound: 'back' }] : [{ label: 'OK', value: null }] });
    if (choice === 'setup') push('setup');
    return null;
  }
}

function mergeInto(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') mergeInto(target[key], value);
    else target[key] = value;
  }
}
// Applies a settings change at once on screen, then stores it.
function save(patch) {
  if (app.state) { mergeInto(app.state.settings, structuredClone(patch)); applySettings(); }
  return api('/api/settings', { patch }).catch(error => { toast(`Could not save: ${error.message}`); });
}

function applySettings() {
  const { display } = app.state.settings;
  configureSound({ enabled: display.sounds, volume: display.volume });
  fit();
}

function setState(next) {
  const first = !app.state;
  app.state = next;
  applySettings();
  updatePreview();
  updateLeds();
  for (const entry of stack) entry.view.update?.(next);
  if (next.dolphin.running !== (top()?.name === 'playing')) syncPlaying();
  const exit = next.dolphin.lastExit;
  if (exit && exit.at !== shownExit) {
    shownExit = exit.at;
    if (exit.kind !== 'stopped') reportExit(exit);
  }
  if (first && !next.settings.setupSeen && !firstRunShown) { firstRunShown = true; push('setup', { firstRun: true }); }
}

async function reportExit(exit) {
  await queue;
  play('error');
  const restore = exit.restoreFailed ? 'Some controller settings could not be put back yet; they will be on the next start.' : 'Your Dolphin settings are as they were.';
  await dialog({ text: exit.message, detail: [exit.detail, restore].filter(Boolean).join(' '), log: exit.log || null, buttons: [{ label: 'OK', value: true }] });
  api('/api/exit/dismiss', {}).catch(() => {});
}

function updateRoster(players) {
  const before = app.roster;
  app.roster = players;
  players.forEach((player, i) => {
    const was = before[i]?.connected;
    if (player.connected && !was && before.length) { play('connect'); toast(`${player.name} joined as Player ${player.slot}`, PLAYER_COLORS[i]); }
    if (!player.connected && was) { play('disconnect'); toast(`Player ${player.slot}'s phone disconnected`, PLAYER_COLORS[i]); input.phoneLeft(player.slot); }
  });
  updateLeds();
  for (const entry of stack) entry.view.update?.(app.state);
}

function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }

function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.onopen = () => { app.online = true; $('offline').hidden = true; send({ type: 'menu' }); };
  socket.onmessage = event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'console') setState(msg.state);
    else if (msg.type === 'roster') updateRoster(msg.players);
    else if (msg.type === 'room') { app.room = msg.code; for (const entry of stack) entry.view.update?.(app.state); }
    else if (msg.type === 'input') input.phone(msg);
    else if (msg.type === 'pad') padListeners.forEach(listener => listener(msg));
    else if (msg.type === 'error') toast(msg.message);
  };
  socket.onclose = () => {
    app.online = false;
    setTimeout(() => { if (!app.online) $('offline').hidden = false; }, 2500);
    setTimeout(connect, 1500);
  };
}

// ---- Wiring -------------------------------------------------------------------------------------
const context = {
  get state() { return app.state; },
  get roster() { return app.roster; },
  get room() { return app.room; },
  get scale() { return app.scale; },
  api, attempt, save, dialog, toast, send, play,
  go: push, back: () => { play('back'); pop(); }, home: goHome,
  launch: (title, sport = null) => attempt(async () => { await api('/api/launch', { title, sport }); }),
  onPhonePad(listener) { padListeners.add(listener); return () => padListeners.delete(listener); },
  get input() { return input; }
};

function scope() {
  if (!$('dialog').hidden) return $('dialog');
  const current = top();
  if (current) return current.view.el;
  return preview ? $('preview') : $('home');
}

const input = createInput({
  stage, layer: $('hands'), scope,
  settings: () => app.state?.settings,
  actions: {
    back,
    home: () => { if (dialogClose || busy) return; goHome(); },
    options: () => { if (!dialogClose && !busy && top()?.name !== 'options') push('options'); },
    page: direction => { if (!dialogClose && !busy && !preview && !stack.length) setPage(app.page + direction); else top()?.view.page?.(direction); },
    wheel: direction => { if (!dialogClose && !preview && !stack.length) setPage(app.page + direction); },
    edge: direction => { if (!preview && !stack.length && (direction === 'left' || direction === 'right')) setPage(app.page + (direction === 'left' ? -1 : 1)); },
    intercept: (slot, button) => top()?.view.intercept?.(slot, button) || false,
    gamepad: (connected, pad) => {
      const name = /dualsense|054c/i.test(pad.id) ? 'DualSense' : 'Controller';
      play(connected ? 'connect' : 'disconnect');
      toast(connected ? `${name} connected` : `${name} disconnected. Turn it back on or plug it in, and it reconnects by itself.`);
      updateLeds();
      for (const entry of stack) entry.view.update?.(app.state);
    }
  }
});
afterFit = input.refit;

$('page-prev').addEventListener('click', () => setPage(app.page - 1));
$('page-next').addEventListener('click', () => setPage(app.page + 1));
$('open-options').addEventListener('click', () => push('options'));
$('open-controllers').addEventListener('click', () => push('phones'));
$('preview-menu').addEventListener('click', () => closePreview());
$('preview-start').addEventListener('click', () => startChannel());

// Full screen on the first press when the player asked to start that way.
addEventListener('pointerdown', firstPress, { once: true });
addEventListener('keydown', firstPress, { once: true });
function firstPress() {
  unlock();
  if (app.state?.settings.display.startFullscreen && !isFullscreen()) document.documentElement.requestFullscreen?.().catch(() => {});
}

function render(now) {
  if (!document.hidden && !app.state?.dolphin.running) {
    const t = now / 1000;
    if (!$('home').hidden) for (const canvas of document.querySelectorAll('.tile-art')) drawChannel(canvas, canvas.parentElement.dataset.channel, t, false, app.scale);
    if (!$('preview').hidden && preview) drawChannel($('banner'), preview.art, t, true, app.scale);
    if (zooming) drawChannel($('zoomer').firstElementChild, zooming.art, t, true, app.scale);
  }
  requestAnimationFrame(render);
}

fit();
buildGrid();
tickClock();
connect();
api('/api/state').catch(() => { $('offline').hidden = false; });
requestAnimationFrame(render);
