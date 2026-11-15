// The controller page, for a phone or an iPad. On the Wii Menu it is a Wii Remote: point to move a hand, A
// selects. In a game it streams a full controller state for Dolphin (buttons, Nunchuk stick, pointer,
// accelerometer and gyro) and changes its layout to what the game needs: the Wii Remote, the Wii Remote with
// a Nunchuk, or a Wii Wheel. It follows the screen, upright or in landscape.
import { createCalibration, remoteMotion, heldMotion, pointerFrom, orientationSpeed, steeringAngle, stickFrom, screenAngle, controllerView, controllerScale, deviceKind, unrotate } from './phone-motion.js';

const $ = id => document.getElementById(id);
const PAD_MS = { game: 16, menu: 50 };   // full controller state: 60 a second in a game, 20 on the menu
const POINTER_MS = 33;                   // menu pointer updates
const SETTLE_MS = 600, MOVING_SPEED = 100; // the screen is followed once the device turns slower than 100°/s for 0.6 s
const DEVICE = deviceKind(navigator.userAgent, navigator.maxTouchPoints); // phone, iPad or tablet
const MOTION_TEXT = {
  active: 'Motion on',
  waiting: 'Motion is starting…',
  permission: 'Motion needs your permission',
  denied: 'Motion is off. The buttons still work.',
  insecure: `Motion is off until this ${DEVICE} trusts the PC.`,
  unavailable: `This ${DEVICE} reports no motion. The buttons still work.`
};
document.querySelectorAll('[data-device]').forEach(el => { el.textContent = DEVICE; });
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

let socket = null, joined = false, desired = false, reconnectTimer = null, padTimer = null, sensorTimer = null, quitTimer = null;
let slot = null, activity = { mode: 'menu' }, layout = 'remote', motion = null, listening = false, permissionPending = false;
let base = null, lastOrientation = null, lastOrientationAt = 0, lastRate = 0, pointer = { x: 0, y: 0 };
let latest = { a: [0, 0, 1], g: [0, 0, 0] }, stick = [0, 0], stickPointer = null;
let lastPointerSend = 0, lastSwing = 0, lastShake = 0, swing = 0, wakeLock = null;
const calibration = createCalibration();
const held = new Set(), touches = new Map();
let suspended = document.hidden;

// ---- Identity: the same phone gets its player number back after a drop ---------------------------
const params = new URLSearchParams(location.search);
const store = {
  get(key) { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set(key, value) { try { globalThis.localStorage?.setItem(key, value); } catch {} }
};
function clientId() {
  const passed = params.get('id');
  if (/^[\w-]{8,64}$/.test(passed || '')) store.set('lrs-client', passed);
  let id = store.get('lrs-client');
  if (!/^[\w-]{8,64}$/.test(id || '')) {
    id = Array.from({ length: 20 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    store.set('lrs-client', id);
  }
  return id;
}
const myId = clientId();
const roomCode = params.get('code');
if (/^\d{6}$/.test(roomCode || '')) $('code').value = roomCode;
$('name').value = store.get('lrs-name') || '';

// ---- Connection ---------------------------------------------------------------------------------
const isOpen = () => joined && socket?.readyState === WebSocket.OPEN;
function send(value) { if (isOpen()) socket.send(JSON.stringify(value)); }
// Wii Menu messages; a game takes its input from the controller state alone.
function sendMenu(value) { if (activity.mode !== 'game') send({ type: 'input', x: pointer.x, y: pointer.y, ...value }); }

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'join', name: $('name').value.trim(), code: $('code').value, clientId: myId }));
  socket.onmessage = event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'joined') onJoined(msg);
    else if (msg.type === 'activity') applyActivity(msg);
    else if (msg.type === 'rumble') navigator.vibrate?.(msg.duration);
    else if (msg.type === 'kicked') { desired = false; showJoin(`The console removed this ${DEVICE}. Join again to play.`); }
    else if (msg.type === 'error') { desired = false; showJoin(msg.message); socket.close(); }
  };
  socket.onclose = () => {
    joined = false;
    stopPad();
    releaseAll();
    if (desired) { setStatus('Connection lost. Reconnecting…'); reconnectTimer = setTimeout(connect, 1500); }
  };
  socket.onerror = () => setStatus(`Cannot reach the console. Check that this ${DEVICE} is on the same Wi-Fi as the PC.`);
}

function onJoined(msg) {
  joined = true; slot = msg.slot;
  store.set('lrs-name', $('name').value.trim());
  $('join-screen').hidden = true; $('remote-controls').hidden = false;
  document.documentElement.style.setProperty('--player', msg.color);
  $('slot-label').textContent = `P${slot}`;
  document.querySelectorAll('.led').forEach((led, i) => led.classList.toggle('on', i === slot - 1));
  $('slot-note').hidden = msg.inGames !== false;
  $('slot-note').textContent = msg.inGames === false ? `This ${DEVICE} works the Wii Menu. In games, player ${slot} uses the controller chosen in Wii Options.` : '';
  setStatus(msg.returning ? `Welcome back, player ${slot}.` : `You are player ${slot}.`);
  enableMotion();
  keepAwake();
  startPad();
  reportStatus();
}

function showJoin(message) {
  joined = false;
  stopPad();
  releaseAll();
  $('join-screen').hidden = false; $('remote-controls').hidden = true; $('join-form').hidden = false;
  setStatus(message);
}
const setStatus = text => { $('remote-status').textContent = text; };

function join() { desired = true; setStatus('Joining…'); connect(); }

$('join-form').onsubmit = event => {
  event.preventDefault();
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  enableMotion(true); // iOS only grants motion from a tap, and this is one
  join();
};
$('leave').onclick = () => {
  desired = false;
  clearTimeout(reconnectTimer);
  releaseAll();
  socket?.close();
  closeSheet();
  showJoin('You left the room.');
};

// ---- Activity and layout ------------------------------------------------------------------------
function applyActivity(next) {
  activity = next.mode === 'game' ? next : { mode: 'menu' };
  const nextLayout = activity.mode !== 'game' ? 'remote' : activity.layout === 'wheel' ? 'wheel' : activity.nunchuk ? 'nunchuk' : 'remote';
  if (nextLayout !== layout) releaseAll();
  layout = nextLayout;
  $('controller').dataset.layout = layout;
  $('activity-name').textContent = activity.mode === 'game' ? activity.name || 'Game' : 'Wii Menu';
  $('activity-detail').textContent = activity.mode === 'game' ? activity.detail || '' : '';
  const steps = activity.mode === 'game' ? activity.path || [] : [];
  $('game-guide').hidden = !steps.length;
  $('game-steps').replaceChildren(...steps.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('quit-game').hidden = $('quit-note').hidden = activity.mode !== 'game';
  $('move-game').hidden = activity.mode !== 'game' || !(activity.screens > 1);
  $('move-game').textContent = activity.screens > 2 ? 'Move the game to the next screen' : 'Move the game to the other screen';
  resetQuit();
  fit();
  startPad();
  reportStatus();
}

// ---- Screen: the controller follows it once the device is held still -----------------------------
// A swing or a hard turn of the wheel can tip the browser into turning the page. Until the device has been
// still for a moment the controller keeps its shape, turned back against the page, so nothing moves under the
// player's thumbs and the motion readings keep their meaning.
let view = controllerView('remote', 0, 0), shownAngle = null, movingUntil = 0, settleTimer = null;
function fit() {
  clearTimeout(settleTimer);
  const actual = screenAngle(globalThis.screen, globalThis.orientation);
  const wait = movingUntil - performance.now();
  if (shownAngle === null || wait <= 0) shownAngle = actual;
  else if (shownAngle !== actual) settleTimer = setTimeout(fit, wait);
  const width = globalThis.innerWidth, height = globalThis.innerHeight;
  const next = controllerView(layout, shownAngle, actual, width, height);
  if (next.hold !== view.hold) base = null; // the pointer starts again from wherever the new pointing end points
  view = next;
  const frame = $('remote-controls'), controller = $('controller');
  frame.dataset.turn = String(view.turn);
  controller.dataset.shape = view.shape;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  frame.style.width = `${view.width}px`;
  frame.style.height = `${view.height}px`;
  frame.style.transform = `translate(-50%, -50%) rotate(${view.turn}deg)`;
  controller.style.setProperty('--scale', String(controllerScale(width, height)));
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
globalThis.screen?.orientation?.addEventListener?.('change', fit);

// ---- Controller state ---------------------------------------------------------------------------
function padState() {
  return { type: 'pad', b: [...held], s: stick, p: layout === 'wheel' ? [0, 0] : [pointer.x, -pointer.y], a: latest.a, g: latest.g };
}
function sendPad() { if (!suspended) send(padState()); }
function startPad() {
  clearInterval(padTimer);
  padTimer = joined ? setInterval(sendPad, activity.mode === 'game' ? PAD_MS.game : PAD_MS.menu) : null;
}
function stopPad() { clearInterval(padTimer); padTimer = null; }
function reportStatus() { if (motion) send({ type: 'status', motion: motion === 'permission' ? 'waiting' : motion, layout }); }

function recenter() {
  base = null; pointer = { x: 0, y: 0 };
  sendMenu({ shake: true });
  navigator.vibrate?.(20);
}
$('recenter').onclick = () => { recenter(); closeSheet(); };

function releaseAll() {
  pointer = { x: 0, y: 0 }; base = null; swing = 0;
  if (held.size) sendMenu({ cancel: true });
  held.clear(); touches.clear();
  document.querySelectorAll('.held').forEach(el => el.classList.remove('held'));
  releaseStick();
  sendMenu({ pointing: true });
  sendPad();
}

// ---- Buttons: one press per button however many fingers are on it -------------------------------
for (const button of document.querySelectorAll('[data-button]')) {
  const name = button.dataset.button;
  button.addEventListener('contextmenu', event => event.preventDefault());
  button.onpointerdown = event => {
    event.preventDefault();
    if (!joined || suspended || document.hidden) return;
    button.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, name);
    if (held.has(name)) return;
    held.add(name);
    button.classList.add('held');
    if (name === 'one' && activity.mode !== 'game') recenter();
    sendMenu({ button: name, pressed: true });
    sendPad();
    navigator.vibrate?.(DIRECTIONS.has(name) ? 8 : 12);
  };
  button.onpointerup = event => {
    event.preventDefault();
    if (touches.get(event.pointerId) !== name) return;
    touches.delete(event.pointerId);
    if ([...touches.values()].includes(name) || !held.delete(name)) return;
    button.classList.remove('held');
    sendMenu({ button: name, pressed: false, swing: name === 'b' ? swing : 0 });
    swing = 0;
    sendPad();
  };
  // The system took the touch (a notification, a gesture): let go of everything rather than guess.
  const cancel = event => { if (touches.get(event.pointerId) === name) releaseAll(); };
  button.onpointercancel = cancel;
  button.onlostpointercapture = cancel;
}

// ---- Nunchuk stick ------------------------------------------------------------------------------
const stickEl = $('stick'), knob = $('stick-knob');
function moveStick(event) {
  const r = stickEl.getBoundingClientRect(), radius = r.width / 2 * 0.72;
  const [dx, dy] = unrotate(event.clientX - (r.left + r.width / 2), event.clientY - (r.top + r.height / 2), view.turn);
  stick = stickFrom(dx, dy, radius);
  knob.style.transform = `translate(${stick[0] * radius}px, ${-stick[1] * radius}px)`;
}
function releaseStick() {
  stick = [0, 0]; stickPointer = null;
  if (knob?.style) knob.style.transform = '';
  stickEl?.classList.remove('held');
}
if (stickEl) {
  stickEl.onpointerdown = event => {
    event.preventDefault();
    if (!joined || suspended) return;
    stickEl.setPointerCapture(event.pointerId);
    stickPointer = event.pointerId;
    stickEl.classList.add('held');
    moveStick(event);
  };
  stickEl.onpointermove = event => { if (event.pointerId === stickPointer) moveStick(event); };
  stickEl.onpointerup = stickEl.onpointercancel = event => { if (event.pointerId === stickPointer) { releaseStick(); sendPad(); } };
}

// ---- Sheet: recenter, the in-game path, moving the game, quit, leave ----------------------------
function openSheet() { $('sheet').hidden = false; $('more-button').setAttribute?.('aria-expanded', 'true'); }
function closeSheet() { $('sheet').hidden = true; $('more-button').setAttribute?.('aria-expanded', 'false'); resetQuit(); }
$('more-button').onclick = () => ($('sheet').hidden ? openSheet() : closeSheet());
$('sheet-close').onclick = closeSheet;
function resetQuit() { clearTimeout(quitTimer); $('quit-game').textContent = 'Quit the game'; $('quit-game').classList.remove('confirm'); }
$('move-game').onclick = () => { send({ type: 'screen' }); closeSheet(); };
// Two taps, so a stray touch never ends a game.
$('quit-game').onclick = () => {
  if (!$('quit-game').classList.contains('confirm')) {
    $('quit-game').classList.add('confirm');
    $('quit-game').textContent = 'Tap again to quit the game';
    quitTimer = setTimeout(resetQuit, 4000);
    return;
  }
  send({ type: 'quit' });
  closeSheet();
};

// ---- Pausing: a hidden page or a lost focus lets go of every button ------------------------------
window.addEventListener('blur', () => { suspended = true; releaseAll(); });
window.addEventListener('focus', () => { suspended = document.hidden; });
document.addEventListener('visibilitychange', () => {
  suspended = document.hidden;
  if (suspended) releaseAll(); else keepAwake();
});
async function keepAwake() {
  if (wakeLock || !navigator.wakeLock || document.hidden) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); } catch {}
}

// ---- Motion -------------------------------------------------------------------------------------
function setMotion(next) {
  if (motion === next) return;
  motion = next;
  $('sensor-status').textContent = MOTION_TEXT[next];
  $('sensor-status').dataset.state = next;
  $('motion-setup').hidden = next !== 'insecure';
  reportStatus();
}

$('enable-motion').onclick = () => enableMotion(true);
async function enableMotion(fromTap = false) {
  if (listening || permissionPending) return;
  const button = $('enable-motion');
  button.hidden = true;
  if (!window.isSecureContext) { setMotion('insecure'); return; }
  const types = [window.DeviceMotionEvent, window.DeviceOrientationEvent];
  if (!types.some(Boolean)) { setMotion('unavailable'); return; }
  if (!fromTap && types.some(type => typeof type?.requestPermission === 'function')) { button.hidden = false; setMotion('permission'); return; }
  permissionPending = true;
  try {
    // iOS: both requests must start inside the tap, before anything is awaited.
    const answers = await Promise.all(types.map(type => (typeof type?.requestPermission === 'function' ? type.requestPermission() : Promise.resolve('granted'))));
    if (answers.some(answer => answer !== 'granted')) throw new Error('Motion permission was turned down.');
    listening = true;
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    setMotion('waiting');
    clearTimeout(sensorTimer);
    sensorTimer = setTimeout(() => { if (motion !== 'active') setMotion('unavailable'); }, 4000);
  } catch {
    button.hidden = false;
    setMotion('denied');
  } finally { permissionPending = false; }
}

function onOrientation(event) {
  if (!joined || suspended || document.hidden) return;
  if (!Number.isFinite(event.alpha) || !Number.isFinite(event.beta)) return;
  const now = performance.now();
  const reading = { alpha: event.alpha, beta: event.beta, gamma: Number.isFinite(event.gamma) ? event.gamma : 0 };
  if (lastOrientation) calibration.rates(lastRate, orientationSpeed(lastOrientation, reading, (now - lastOrientationAt) / 1000));
  lastOrientation = reading; lastOrientationAt = now;
  base ??= reading;
  pointer = pointerFrom(reading, base, view.hold);
  setMotion('active');
  if (now - lastPointerSend >= POINTER_MS) { lastPointerSend = now; sendMenu({ pointing: true }); }
}

function onMotion(event) {
  if (!joined || suspended || document.hidden) return;
  const g = event.accelerationIncludingGravity, rate = event.rotationRate;
  const vector = g && [g.x, g.y, g.z].every(Number.isFinite) ? [g.x, g.y, g.z] : null;
  if (vector && lastOrientation) calibration.gravity(vector, lastOrientation.beta, lastOrientation.gamma);
  if (rate) {
    lastRate = Math.hypot(rate.alpha || 0, rate.beta || 0, rate.gamma || 0);
    if (lastRate * calibration.state.gyroScale > MOVING_SPEED) movingUntil = performance.now() + SETTLE_MS;
  }
  latest = heldMotion(remoteMotion(vector, rate, calibration.state), view.hold);
  if (layout === 'wheel' && $('wheel-dial').style) $('wheel-dial').style.transform = `rotate(${-steeringAngle(latest.a).toFixed(1)}deg)`;
  setMotion('active');
  if (activity.mode !== 'game') swingAndShake(event);
}

// Swings and shakes for the Wii Menu and the arcade games (Dolphin reads the raw motion instead).
function swingAndShake(event) {
  const acceleration = event.acceleration || event.accelerationIncludingGravity;
  if (!acceleration) return;
  const values = [acceleration.x, acceleration.y, acceleration.z];
  if (!values.every(Number.isFinite)) return;
  const magnitude = Math.hypot(...values), now = performance.now();
  // Readings that include gravity need a higher threshold, or a phone at rest would count as a swing.
  const threshold = event.acceleration ? 10 : 21;
  if (magnitude > threshold && now - lastSwing > 650) {
    lastSwing = now;
    swing = Math.min(1, (magnitude - threshold) / 24 + 0.3);
    sendMenu({ swing });
  }
  if (magnitude > threshold + 25 && now - lastShake > 1800 && !held.has('b')) { lastShake = now; recenter(); }
}

// ---- Motion over HTTPS --------------------------------------------------------------------------
// Phones only share motion with secure pages. When this phone already trusts the PC, the secure address
// works and the page moves there before joining, keeping its player identity; otherwise it joins here with
// buttons only and links to the one-time setup.
async function secureAddress() {
  if (window.isSecureContext || typeof fetch !== 'function') return null;
  try {
    const config = await (await fetch('/config')).json();
    if (!config.securePort) return null;
    const origin = `https://${location.hostname}:${config.securePort}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const trusted = await fetch(`${origin}/ping`, { signal: controller.signal }).then(response => response.ok, () => false);
    clearTimeout(timer);
    if (!trusted) return null;
    const next = new URLSearchParams(location.search);
    next.set('id', myId);
    return `${origin}/remote?${next}`;
  } catch { return null; }
}

function start() {
  fit();
  if (!/^\d{6}$/.test(roomCode || '')) return;
  // A scanned room address is enough to join: no typing.
  $('join-form').hidden = true;
  setStatus('Joining…');
  if (window.isSecureContext || typeof fetch !== 'function') return join();
  secureAddress().then(address => { if (address) location.replace(address); else join(); });
}
start();
