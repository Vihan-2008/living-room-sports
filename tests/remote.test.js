// The phone controller: its motion maths, and the real page script driven through fake browser objects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as motion from '../public/phone-motion.js';

const html = await readFile(new URL('../public/remote.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../public/remote.js', import.meta.url), 'utf8')).replace(/^import .*$/m, '');
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} is not ${expected}`);

// ---- Motion maths -------------------------------------------------------------------------------
test('a phone held like a remote reports the remote\'s own axes', () => {
  const calibration = motion.createCalibration().state;
  // Resting level, screen up: gravity reads "up".
  assert.deepEqual(motion.remoteMotion([0, 0, 9.80665], null, calibration).a, [0, 0, 1]);
  // Pointing straight down at the floor (top edge down): the reaction to gravity runs toward the back.
  assert.deepEqual(motion.remoteMotion([0, -9.80665, 0], null, calibration).a, [0, -1, 0]);
  // rotationRate is about the device axes: beta about x (pitch), alpha about z (yaw, left positive), gamma about y (roll).
  assert.deepEqual(motion.remoteMotion(null, { alpha: 30, beta: 20, gamma: -10 }, calibration).g, [20, -30, -10]);
  assert.deepEqual(motion.remoteMotion(null, { alpha: null, beta: undefined, gamma: 5 }, calibration).g, [0, 0, 5], 'missing axes read as still');
});

test('an iPhone\'s inverted gravity is learnt from deviceorientation, and so are radians', () => {
  const iphone = motion.createCalibration();
  for (let i = 0; i < 6; i++) iphone.gravity([0, 0, -9.81], 0, 0);
  assert.equal(iphone.state.gravitySign, -1);
  assert.deepEqual(motion.remoteMotion([0, 0, -9.80665], null, iphone.state).a, [0, 0, 1], 'level reads as level once learnt');
  const android = motion.createCalibration();
  for (let i = 0; i < 20; i++) android.gravity([0, 6.9, 6.9], 45, 0); // tilted 45° toward the player
  assert.equal(android.state.gravitySign, 1);
  const moving = motion.createCalibration();
  for (let i = 0; i < 20; i++) moving.gravity([0, 0, -25], 0, 0); // a swing, not gravity
  assert.equal(moving.state.gravityKnown, false, 'readings taken while the phone moves are ignored');

  const radians = motion.createCalibration();
  for (let i = 0; i < 4; i++) radians.rates(1.5, 86); // turning at 86°/s reported as 1.5
  close(radians.state.gyroScale, 180 / Math.PI, 'radians are scaled to degrees');
  const degrees = motion.createCalibration();
  for (let i = 0; i < 4; i++) degrees.rates(90, 86);
  assert.equal(degrees.state.gyroScale, 1);
  const still = motion.createCalibration();
  for (let i = 0; i < 10; i++) still.rates(0.01, 5);
  assert.equal(still.state.gyroKnown, false, 'nothing is decided while the phone is barely turning');
});

test('the pointer follows the phone: turning right moves it right, lifting the top moves it up', () => {
  const base = { alpha: 350, beta: 10 };
  const right = motion.pointerFrom({ alpha: 350 - 12, beta: 10 }, base);
  assert.ok(right.x > 0.45 && right.x < 0.55); assert.equal(right.y, 0);
  const up = motion.pointerFrom({ alpha: 350, beta: 18 }, base);
  assert.equal(up.x, 0); assert.equal(up.y, -0.5);
  assert.equal(motion.pointerFrom({ alpha: 10, beta: 10 }, base).x, -0.833, 'turning left across north wraps instead of jumping');
  assert.deepEqual(motion.pointerFrom({ alpha: 200, beta: 80 }, base), { x: 1, y: -1 }, 'and stops at the screen edge');
});

test('layouts lie along the phone the way they are held, however the page is turned', () => {
  assert.equal(motion.screenAngle({ orientation: { angle: 90 } }), 90);
  assert.equal(motion.screenAngle(undefined, -90), 270, 'iOS reports the other landscape as -90');
  assert.equal(motion.screenAngle(undefined, undefined), 0);
  assert.equal(motion.layoutRotation('remote', 0), 0);
  assert.equal(motion.layoutRotation('remote', 90), -90, 'a page the browser turned sideways is turned back for the remote');
  assert.equal(motion.layoutRotation('wheel', 0), 90, 'with rotation locked, the wheel is drawn across the phone');
  assert.equal(motion.layoutRotation('wheel', 90), 0);
  assert.equal(motion.layoutRotation('wheel', 270), -180, 'held the other way round, the wheel shows upside down until the phone is turned');
  // A touch below the centre of a stick drawn a quarter-turn clockwise is the stick's own right.
  const [x, y] = motion.unrotate(0, 10, 90);
  close(x, 10, 'x'); close(y, 0, 'y');
  assert.deepEqual(motion.stickFrom(0, -30, 60), [0, 0.5], 'up the screen is up the stick');
  assert.deepEqual(motion.stickFrom(300, 0, 60), [1, 0], 'the stick stops at its edge');
  close(motion.steeringAngle([1, 0]), 0, 'level');
  assert.ok(motion.steeringAngle([0.9, 0.4]) > 20, 'tipping the left end down steers left');
});

// ---- The page -----------------------------------------------------------------------------------
// The real remote.js, with the motion module supplied and the browser faked.
async function remote({ search = '?code=123456', secure = true, motionType = {}, orientationType = {}, fetch = undefined, stored = {} } = {}) {
  const elements = new Map(), handlers = {}, sockets = [], timers = new Map(), intervals = new Map(), replaced = [];
  const storage = new Map(Object.entries(stored));
  let timerId = 0, now = 3000;
  function element(id = null) {
    const classes = new Set();
    return { id, value: '', hidden: false, textContent: '', dataset: {}, style: { setProperty() {} }, children: [],
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        toggle: (name, force) => ((force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name)) },
      addEventListener() {}, setPointerCapture() {}, setAttribute() {},
      replaceChildren(...children) { this.children = children; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element(id));
  const buttons = [...html.matchAll(/data-button="([^"]+)"/g)].map(([, name]) => { const b = element(); b.dataset.button = name; return b; });
  const leds = [0, 1, 2, 3].map(() => element());
  const document = { hidden: false, documentElement: { style: { setProperty() {} } },
    getElementById: id => { assert.ok(elements.has(id), `Missing element ${id}`); return elements.get(id); },
    querySelectorAll: selector => (selector === '[data-button]' ? buttons : selector === '.held' ? buttons.filter(b => b.classList.contains('held')) : selector === '.led' ? leds : []),
    createElement: () => element(),
    addEventListener: (name, fn) => { handlers[name] = fn; } };
  const context = vm.createContext({ ...motion, document,
    window: { isSecureContext: secure, DeviceMotionEvent: motionType, DeviceOrientationEvent: orientationType, addEventListener: (name, fn) => { handlers[name] = fn; } },
    location: { search, protocol: secure ? 'https:' : 'http:', host: 'pc.local:3000', hostname: 'pc.local', replace: url => replaced.push(url) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    URLSearchParams, AbortController, Promise, fetch, navigator: { vibrate() {} }, performance: { now: () => now },
    WebSocket: class {
      static OPEN = 1; static CONNECTING = 0;
      constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.events = []; sockets.push(this); }
      send(data) { assert.equal(this.readyState, 1); const value = JSON.parse(data); this.sent.push(value); this.events.push(value); }
      close() { this.events.push('close'); this.readyState = 3; }
    },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => { intervals.set(++timerId, { fn, ms }); return timerId; }, clearInterval: id => intervals.delete(id)
  });
  vm.runInContext(source, context);
  const $ = id => elements.get(id);
  function join(slot = 1, extra = {}) {
    if (sockets.at(-1)?.readyState !== 0) $('join-form').onsubmit({ preventDefault() {} });
    const socket = sockets.at(-1); socket.readyState = 1; socket.onopen();
    socket.onmessage({ data: JSON.stringify({ type: 'joined', slot, color: '#149ed4', ...extra }) });
    socket.onmessage({ data: JSON.stringify({ type: 'activity', mode: 'menu' }) });
    return socket;
  }
  const activity = (socket, value) => socket.onmessage({ data: JSON.stringify({ type: 'activity', ...value }) });
  function pointer(name, type, pointerId = 1, index = 0) {
    const handler = type === 'lostpointercapture' ? 'onlostpointercapture' : `onpointer${type}`;
    buttons.filter(b => b.dataset.button === name)[index][handler]({ pointerId, preventDefault() {} });
  }
  return { elements, $, handlers, sockets, timers, intervals, replaced, storage, document, buttons, join, activity, pointer,
    settle: () => new Promise(resolve => setImmediate(resolve)), // lets the motion permission answer arrive
    tick: (ms = 1000) => { now += ms; },
    sensors(alpha = 90, beta = 20) { handlers.deviceorientation({ alpha, beta, gamma: 0 }); handlers.devicemotion({ acceleration: { x: 30, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } }); } };
}
const inputs = socket => socket.sent.filter(m => m.type === 'input');
const pads = socket => socket.sent.filter(m => m.type === 'pad');

test('two fingers on one button make one press, released only when both lift', async () => {
  const app = await remote(), socket = app.join();
  app.pointer('b', 'down', 1); app.pointer('b', 'down', 2);
  app.pointer('b', 'up', 1);
  assert.deepEqual(inputs(socket).filter(m => m.button === 'b').map(m => m.pressed), [true]);
  assert.deepEqual(pads(socket).at(-1).b, ['b'], 'Dolphin sees B held');
  app.pointer('b', 'up', 2); app.pointer('b', 'lostpointercapture', 2);
  assert.deepEqual(inputs(socket).filter(m => m.button === 'b').map(m => m.pressed), [true, false]);
  assert.deepEqual(pads(socket).at(-1).b, []);
});

test('a cancelled touch lets go of everything without counting as a release', async () => {
  const app = await remote(), socket = app.join();
  app.pointer('left', 'down', 1); app.pointer('b', 'down', 2);
  app.pointer('left', 'cancel', 1); app.pointer('left', 'lostpointercapture', 1);
  app.pointer('b', 'lostpointercapture', 2); app.pointer('b', 'up', 2);
  assert.deepEqual(inputs(socket).filter(m => m.button).map(m => [m.button, m.pressed]), [['left', true], ['b', true]]);
  assert.equal(inputs(socket).filter(m => m.cancel === true).length, 1);
  assert.ok(app.buttons.every(b => !b.classList.contains('held')));
  assert.deepEqual(pads(socket).at(-1).b, []);
});

for (const reason of ['blur', 'visibilitychange']) test(`${reason} lets go of every button and ignores the sensors until the page is back`, async () => {
  const app = await remote(), socket = app.join();
  await app.$('enable-motion').onclick();
  app.sensors(); app.pointer('b', 'down');
  if (reason === 'visibilitychange') app.document.hidden = true;
  app.handlers[reason]();
  const release = inputs(socket).findLast(m => m.cancel === true);
  assert.ok(release); assert.equal(release.x, 0); assert.equal(release.y, 0);
  assert.equal(inputs(socket).filter(m => m.button === 'b' && !m.pressed).length, 0, 'not a B release, which would throw a ball');
  const count = socket.sent.length;
  app.tick(); app.sensors(); app.pointer('a', 'down', 2); app.pointer('b', 'up');
  assert.equal(socket.sent.length, count);
  app.document.hidden = false;
  app.handlers[reason === 'blur' ? 'focus' : 'visibilitychange']();
  app.tick(); app.sensors();
  assert.ok(socket.sent.length > count);
});

test('leaving releases controls first, does not reconnect, and a new join starts clean', async () => {
  const app = await remote(), socket = app.join();
  app.pointer('b', 'down'); app.$('leave').onclick();
  assert.equal(socket.events.at(-1), 'close');
  assert.equal(inputs(socket).findLast(m => m.cancel === true).cancel, true);
  socket.onclose();
  assert.equal(app.sockets.length, 1); assert.ok(![...app.timers.values()].length || app.sockets.length === 1);
  assert.equal(app.$('join-screen').hidden, false); assert.equal(app.$('remote-status').textContent, 'You left the room.');
  assert.equal(app.intervals.size, 0, 'no controller updates while out of the room');
  const next = app.join(); app.pointer('b', 'down'); app.pointer('b', 'up');
  assert.deepEqual(inputs(next).filter(m => m.button).map(m => m.pressed), [true, false]);
});

test('a dropped connection comes back as the same phone', async () => {
  const app = await remote(), socket = app.join();
  const id = socket.sent[0].clientId;
  assert.match(id, /^[\w-]{8,64}$/); assert.equal(app.storage.get('lrs-client'), id);
  app.pointer('right', 'down'); socket.readyState = 3; socket.onclose();
  assert.ok(app.buttons.every(b => !b.classList.contains('held')));
  assert.match(app.$('remote-status').textContent, /Reconnecting/);
  [...app.timers.values()].at(-1)();
  const next = app.sockets.at(-1); next.readyState = 1; next.onopen();
  assert.equal(next.sent[0].clientId, id, 'the server gives a returning phone its player number back');
  next.onmessage({ data: JSON.stringify({ type: 'joined', slot: 2, color: '#ef665e', returning: true }) });
  assert.equal(app.$('remote-status').textContent, 'Welcome back, player 2.');
  app.pointer('right', 'up'); app.pointer('right', 'down'); app.pointer('right', 'up');
  assert.deepEqual(inputs(next).filter(m => m.button).map(m => m.pressed), [true, false]);
});

test('a scanned code joins at once, and the hand moves the way the phone turns', async () => {
  const app = await remote();
  assert.equal(app.sockets.length, 1);
  assert.equal(app.$('join-form').hidden, true);
  const socket = app.join(); await app.settle();
  assert.equal(socket.sent[0].code, '123456'); assert.equal(socket.sent[0].name, '');
  assert.equal(app.$('enable-motion').hidden, true, 'no tap needed outside iOS');
  app.handlers.deviceorientation({ alpha: 90, beta: 20, gamma: 0 });
  app.tick();
  app.handlers.deviceorientation({ alpha: 78, beta: 28, gamma: 0 }); // turned right, top lifted
  const last = inputs(socket).at(-1);
  assert.ok(last.pointing); assert.equal(last.x, 0.5); assert.equal(last.y, -0.5);
  assert.equal(app.$('sensor-status').textContent, 'Motion on');
  assert.ok(socket.sent.some(m => m.type === 'status' && m.motion === 'active'), 'the TV is told motion works');
  app.tick(); app.sensors();
  assert.ok(inputs(socket).some(m => m.swing > 0), 'a swing still reaches the arcade games');
});

test('a missing or malformed code keeps manual joining', async () => {
  for (const search of ['', '?code=bad', '?code=12345', '?code=1234567']) {
    const app = await remote({ search });
    assert.equal(app.sockets.length, 0);
    assert.equal(app.$('code').value, '');
    app.join(); assert.equal(app.sockets.length, 1);
  }
});

test('iOS asks for motion only from the tap, and both permissions in that tap', async () => {
  const calls = [];
  const app = await remote({ motionType: { requestPermission() { calls.push('motion'); return Promise.resolve('granted'); } },
    orientationType: { requestPermission() { calls.push('orientation'); return Promise.resolve('granted'); } } });
  const socket = app.join();
  assert.deepEqual(calls, []);
  assert.equal(app.$('enable-motion').hidden, false);
  assert.equal(app.$('sensor-status').textContent, 'Motion needs your permission');
  const pending = app.$('enable-motion').onclick();
  assert.deepEqual(calls, ['motion', 'orientation'], 'both requested before anything is awaited');
  await pending;
  app.sensors(); assert.ok(pads(socket).length || inputs(socket).some(m => m.pointing));
  await app.$('enable-motion').onclick();
  assert.equal(calls.length, 2, 'never asked twice');
});

test('motion turned down: the buttons work, a retry is offered, and the TV is told', async () => {
  for (const requestPermission of [() => Promise.resolve('denied'), () => Promise.reject(new Error('blocked'))]) {
    const app = await remote({ motionType: { requestPermission }, orientationType: {} });
    const socket = app.join();
    await app.$('enable-motion').onclick();
    assert.equal(app.handlers.deviceorientation, undefined);
    assert.equal(app.$('enable-motion').hidden, false);
    assert.ok(socket.sent.some(m => m.type === 'status' && m.motion === 'denied'));
    app.pointer('a', 'down'); assert.equal(inputs(socket).at(-1).button, 'a');
  }
});

test('over plain HTTP, or with no sensors, the phone says so truthfully and links to the fix', async () => {
  const http = await remote({ secure: false }), socket = http.join();
  assert.equal(http.$('sensor-status').textContent, 'Motion is off until this phone trusts the PC.');
  assert.equal(http.$('motion-setup').hidden, false);
  assert.ok(socket.sent.some(m => m.type === 'status' && m.motion === 'insecure'));
  http.pointer('a', 'down'); assert.equal(inputs(socket).at(-1).button, 'a');
  const bare = await remote({ motionType: null, orientationType: null }); bare.join();
  assert.match(bare.$('sensor-status').textContent, /reports no motion/);
  assert.equal(bare.$('motion-setup').hidden, true);
});

test('on HTTP, a phone that already trusts the PC moves to the secure page before joining, keeping its identity', async () => {
  const fetch = async url => (url === '/config' ? { json: async () => ({ securePort: 3443 }) } : { ok: url === 'https://pc.local:3443/ping' });
  const app = await remote({ secure: false, fetch, stored: { 'lrs-client': 'phone-abc-123' } });
  assert.equal(app.sockets.length, 0, 'no join over HTTP first, or the player number would change');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.replaced, ['https://pc.local:3443/remote?code=123456&id=phone-abc-123']);
  const untrusted = await remote({ secure: false, fetch: async url => (url === '/config' ? { json: async () => ({ securePort: 3443 }) } : Promise.reject(new TypeError('certificate'))) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(untrusted.replaced, []); assert.equal(untrusted.sockets.length, 1, 'joins with buttons only');
  const adopted = await remote({ search: '?code=123456&id=phone-abc-123' });
  assert.equal(adopted.join().sent[0].clientId, 'phone-abc-123', 'the secure page takes over the identity');
});

test('in a game the phone becomes Dolphin\'s controller and changes shape to match', async () => {
  const app = await remote(), socket = app.join(); await app.settle();
  assert.equal([...app.intervals.values()][0].ms, 50, '20 updates a second on the menu');
  app.activity(socket, { mode: 'game', title: 'resort', sport: 'archery', layout: 'remote', nunchuk: true, motionPlus: true,
    name: 'Archery', detail: 'Wii Sports Resort', path: ['Press A at the wrist-strap reminder', 'Choose Archery (4th of 12)'] });
  assert.equal(app.$('controller').dataset.layout, 'nunchuk');
  assert.equal(app.$('activity-name').textContent, 'Archery');
  assert.deepEqual(app.$('game-steps').children.map(li => li.textContent), ['Press A at the wrist-strap reminder', 'Choose Archery (4th of 12)']);
  assert.equal(app.$('game-guide').hidden, false); assert.equal(app.$('quit-game').hidden, false);
  assert.deepEqual([...app.intervals.values()].map(i => i.ms), [16], '60 a second in a game');
  const before = inputs(socket).length;
  app.pointer('b', 'down'); app.pointer('z', 'down', 2);
  assert.equal(inputs(socket).length, before, 'no menu presses reach the PC while the game runs');
  assert.deepEqual(pads(socket).at(-1).b.sort(), ['b', 'z']);
  // The Nunchuk stick: a touch half way up from the centre.
  app.$('stick').onpointerdown({ pointerId: 7, clientX: 50, clientY: 50 - 36 * 0.5, preventDefault() {} });
  [...app.intervals.values()][0].fn();
  assert.deepEqual(pads(socket).at(-1).s, [0, 0.5]);
  app.$('stick').onpointerup({ pointerId: 7 });
  assert.deepEqual(pads(socket).at(-1).s, [0, 0]);
  // Motion goes out with every update, gyro in °/s.
  app.handlers.devicemotion({ accelerationIncludingGravity: { x: 0, y: 0, z: 9.80665 }, rotationRate: { alpha: -40, beta: 10, gamma: 0 } });
  [...app.intervals.values()][0].fn();
  assert.deepEqual([pads(socket).at(-1).a, pads(socket).at(-1).g], [[0, 0, 1], [10, 40, 0]]);

  app.activity(socket, { mode: 'game', title: 'mkw', layout: 'wheel', nunchuk: false, motionPlus: false, name: 'Mario Kart Wii', detail: 'Grand Prix', path: [] });
  assert.equal(app.$('controller').dataset.layout, 'wheel');
  assert.deepEqual(pads(socket).at(-1).b, [], 'buttons held for the last layout are let go');
  assert.equal(app.$('remote-controls').dataset.turn, '90', 'a portrait page draws the wheel across the phone');
  assert.equal(app.$('game-guide').hidden, true);
});

test('the wheel\'s pad is the remote\'s pad turned on its side', () => {
  const wheel = html.slice(html.indexOf('class="wheel"'));
  const at = cls => wheel.match(new RegExp(`data-button="(\\w+)" class="dir ${cls}"`))[1];
  assert.deepEqual([at('left'), at('up'), at('right'), at('down')], ['up', 'right', 'down', 'left']);
});

test('quitting from the phone takes two taps, and the console can remove a phone', async () => {
  const app = await remote(), socket = app.join();
  app.activity(socket, { mode: 'game', title: 'sports', sport: 'tennis', layout: 'remote', nunchuk: false, name: 'Tennis', path: [] });
  app.$('more-button').onclick();
  app.$('quit-game').onclick();
  assert.ok(!socket.sent.some(m => m.type === 'quit'));
  assert.equal(app.$('quit-game').textContent, 'Tap again to quit the game');
  app.$('quit-game').onclick();
  assert.ok(socket.sent.some(m => m.type === 'quit'));
  assert.equal(app.$('sheet').hidden, true);
  socket.onmessage({ data: JSON.stringify({ type: 'kicked' }) });
  socket.onclose();
  assert.equal(app.$('join-screen').hidden, false);
  assert.match(app.$('remote-status').textContent, /removed this phone/);
  assert.equal(app.sockets.length, 1, 'and it does not rejoin by itself');
});
