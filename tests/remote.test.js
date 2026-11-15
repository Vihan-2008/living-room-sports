import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual phone event handlers without browser or network dependencies.
async function remote({ search = '?code=123456', secure = true, motionType = {}, orientationType = {} } = {}) {
  const html = await readFile(new URL('../public/remote.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/remote.js', import.meta.url), 'utf8');
  const elements = new Map(), handlers = {}, sockets = [], timers = new Map();
  let timerId = 0, now = 3000;
  function element() {
    const classes = new Set();
    return { value: '', hidden: false, textContent: '', dataset: {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name), toggle() {} },
      addEventListener() {}, setPointerCapture() {} };
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element());
  const buttons = [...html.matchAll(/data-button="([^"]+)"/g)].map(([, name]) => {
    const button = element(); button.dataset.button = name; return button;
  });
  const document = { hidden: false, documentElement: { style: { setProperty() {} } },
    getElementById: id => { assert.ok(elements.has(id), `Missing element ${id}`); return elements.get(id); },
    querySelectorAll: selector => selector === '[data-button]' ? buttons : selector === '.held' ? buttons.filter(b => b.classList.contains('held')) : [],
    addEventListener: (name, fn) => { handlers[name] = fn; } };
  const context = vm.createContext({ document,
    window: { isSecureContext: secure, DeviceMotionEvent: motionType, DeviceOrientationEvent: orientationType, addEventListener: (name, fn) => { handlers[name] = fn; } },
    location: { search, protocol: secure ? 'https:' : 'http:', host: 'localhost:3000' }, URLSearchParams,
    navigator: { vibrate() {} }, performance: { now: () => now },
    WebSocket: class {
      static OPEN = 1; static CONNECTING = 0;
      constructor() { this.readyState = 0; this.sent = []; this.events = []; sockets.push(this); }
      send(data) { assert.equal(this.readyState, 1); const value = JSON.parse(data); this.sent.push(value); this.events.push(value); }
      close() { this.events.push('close'); this.readyState = 3; }
    },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(source, context);
  function join() {
    if (sockets.at(-1)?.readyState !== 0) elements.get('join-form').onsubmit({ preventDefault() {} });
    const socket = sockets.at(-1); socket.readyState = 1; socket.onopen();
    socket.onmessage({ data: JSON.stringify({ type: 'joined', slot: 1, color: '#149ed4' }) });
    return socket;
  }
  function pointer(name, type, pointerId = 1) {
    const handler = type === 'lostpointercapture' ? 'onlostpointercapture' : `onpointer${type}`;
    buttons.find(b => b.dataset.button === name)[handler]({ pointerId, preventDefault() {} });
  }
  return { elements, handlers, sockets, timers, document, buttons, join, pointer,
    tick: () => { now += 1000; },
    sensors() { handlers.deviceorientation({ alpha: 90, beta: 20 }); handlers.devicemotion({ acceleration: { x: 30, y: 0, z: 0 } }); } };
}

test('two fingers on one button emit one press and release only after both lift', async () => {
  const app = await remote(), socket = app.join();
  app.pointer('b', 'down', 1); app.pointer('b', 'down', 2);
  app.pointer('b', 'up', 1);
  assert.deepEqual(socket.sent.filter(m => m.button === 'b').map(m => m.pressed), [true]);
  assert.ok(app.buttons.find(b => b.dataset.button === 'b').classList.contains('held'));
  app.pointer('b', 'up', 2); app.pointer('b', 'lostpointercapture', 2);
  assert.deepEqual(socket.sent.filter(m => m.button === 'b').map(m => m.pressed), [true, false]);
});

test('pointer cancellation and lost capture cancel all controls without a shot release', async () => {
  const app = await remote(), socket = app.join();
  app.pointer('left', 'down', 1); app.pointer('b', 'down', 2);
  app.pointer('left', 'cancel', 1); app.pointer('left', 'lostpointercapture', 1);
  app.pointer('b', 'lostpointercapture', 2); app.pointer('b', 'up', 2);
  assert.deepEqual(socket.sent.filter(m => m.button).map(m => [m.button, m.pressed]),
    [['left', true], ['b', true]]);
  assert.equal(socket.sent.filter(m => m.cancel === true).length, 1);
  assert.ok(app.buttons.every(b => !b.classList.contains('held')));
  app.pointer('b', 'down', 3); app.pointer('b', 'lostpointercapture', 3); app.pointer('b', 'up', 3);
  assert.equal(socket.sent.filter(m => m.cancel === true).length, 2);
  assert.equal(socket.sent.filter(m => m.button === 'b' && !m.pressed).length, 0);
});

for (const reason of ['blur', 'visibilitychange']) test(`${reason} clears held controls and suppresses sensors until resumed`, async () => {
  const app = await remote(), socket = app.join();
  await app.elements.get('enable-motion').onclick();
  app.sensors(); app.pointer('b', 'down');
  if (reason === 'visibilitychange') app.document.hidden = true;
  app.handlers[reason]();
  const release = socket.sent.findLast(m => m.cancel === true);
  assert.ok(release); assert.equal(release.x, 0); assert.equal(release.y, 0);
  assert.equal(socket.sent.filter(m => m.button === 'b' && !m.pressed).length, 0);
  assert.equal(release.swing, undefined);
  assert.deepEqual(socket.sent.at(-1), { type: 'input', x: 0, y: 0, pointing: true });
  assert.ok(app.buttons.every(b => !b.classList.contains('held')));
  const count = socket.sent.length;
  app.tick(); app.sensors(); app.pointer('a', 'down', 2); app.pointer('b', 'up');
  assert.equal(socket.sent.length, count);
  app.document.hidden = false;
  app.handlers[reason === 'blur' ? 'focus' : 'visibilitychange']();
  app.tick(); app.sensors();
  assert.ok(socket.sent.length > count);
  app.pointer('b', 'down', 3); app.pointer('b', 'up', 3);
  assert.equal(socket.sent.at(-1).pressed, false);
});

test('leave releases controls before closing and rejoining starts with fresh pointers', async () => {
  const app = await remote(), socket = app.join();
  await app.elements.get('enable-motion').onclick();
  app.pointer('b', 'down'); app.elements.get('leave').onclick();
  assert.equal(socket.events.at(-1), 'close');
  assert.equal(socket.sent.findLast(m => m.cancel === true).cancel, true);
  assert.equal(socket.sent.filter(m => m.button === 'b' && !m.pressed).length, 0);
  socket.onclose(); assert.equal(app.timers.size, 1); // Only the sensor-data notice, no reconnect.
  const count = socket.sent.length; app.tick(); app.sensors();
  assert.equal(socket.sent.length, count);
  assert.equal(app.elements.get('join-form').hidden, false);
  const next = app.join(); app.pointer('b', 'down'); app.pointer('b', 'up');
  assert.deepEqual(next.sent.filter(m => m.button).map(m => m.pressed), [true, false]);
});

test('disconnect clears held pointers and reconnect allows the same button again', async () => {
  const app = await remote(), socket = app.join();
  await new Promise(resolve => setImmediate(resolve));
  app.pointer('right', 'down'); socket.readyState = 3; socket.onclose();
  assert.ok(app.buttons.every(b => !b.classList.contains('held')));
  assert.equal(app.timers.size, 2); // Sensor notice plus reconnection.
  const reconnect = [...app.timers.values()].at(-1); reconnect();
  const next = app.sockets.at(-1); next.readyState = 1; next.onopen();
  next.onmessage({ data: JSON.stringify({ type: 'joined', slot: 2, color: '#ef665e' }) });
  app.pointer('right', 'up'); app.pointer('right', 'down'); app.pointer('right', 'up');
  assert.deepEqual(next.sent.filter(m => m.button).map(m => m.pressed), [true, false]);
});

test('scanned room autojoins without submitting a name and starts motion without a tap', async () => {
  const app = await remote();
  assert.equal(app.sockets.length, 1);
  assert.equal(app.elements.get('join-form').hidden, true);
  const socket = app.join();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(socket.sent[0], { type: 'join', name: '', code: '123456' });
  assert.equal(app.elements.get('enable-motion').hidden, true);
  app.sensors(); app.tick();
  app.handlers.deviceorientation({ alpha: 107.5, beta: 42.5 });
  assert.equal(socket.sent.at(-1).x, .5);
  assert.equal(socket.sent.at(-1).y, .5);
  assert.ok(socket.sent.some(m => m.swing > 0));
});

test('missing or malformed room URLs keep manual pairing available', async () => {
  for (const search of ['', '?code=bad', '?code=12345', '?code=1234567']) {
    const app = await remote({ search });
    assert.equal(app.sockets.length, 0);
    assert.equal(app.elements.get('code').value, '');
    app.join(); assert.equal(app.sockets.length, 1);
  }
});

test('iOS autojoins but requests both permissions only from the Allow motion tap', async () => {
  const calls = [];
  const app = await remote({ motionType: { requestPermission() { calls.push('motion'); return Promise.resolve('granted'); } },
    orientationType: { requestPermission() { calls.push('orientation'); return Promise.resolve('granted'); } } });
  const socket = app.join();
  assert.deepEqual(calls, []);
  assert.equal(app.elements.get('enable-motion').hidden, false);
  const pending = app.elements.get('enable-motion').onclick();
  assert.deepEqual(calls, ['motion', 'orientation']); // Both before any awaited work.
  await pending;
  app.sensors(); assert.ok(socket.sent.some(m => m.swing));
  await app.elements.get('enable-motion').onclick();
  assert.equal(calls.length, 2);
});

test('denied and rejected permissions leave buttons usable and offer retry', async () => {
  for (const requestPermission of [() => Promise.resolve('denied'), () => Promise.reject(new Error('blocked'))]) {
    const app = await remote({ motionType: { requestPermission }, orientationType: {} });
    const socket = app.join();
    await app.elements.get('enable-motion').onclick();
    assert.equal(app.handlers.deviceorientation, undefined);
    assert.equal(app.elements.get('enable-motion').hidden, false);
    app.pointer('a', 'down'); assert.equal(socket.sent.at(-1).button, 'a');
  }
});

test('HTTP and sensorless devices join with working buttons and truthful motion status', async () => {
  for (const options of [{ secure: false }, { motionType: null, orientationType: null }]) {
    const app = await remote(options), socket = app.join();
    assert.equal(app.elements.get('enable-motion').hidden, true);
    assert.match(app.elements.get('sensor-status').textContent, /unavailable/);
    assert.equal(app.handlers.deviceorientation, undefined);
    app.pointer('a', 'down'); assert.equal(socket.sent.at(-1).button, 'a');
  }
});
