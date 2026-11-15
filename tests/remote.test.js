import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual phone event handlers without browser or network dependencies.
async function remote() {
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
    window: { isSecureContext: true, DeviceMotionEvent: {}, DeviceOrientationEvent: {}, addEventListener: (name, fn) => { handlers[name] = fn; } },
    location: { search: '?code=123456', protocol: 'http:', host: 'localhost:3000' }, URLSearchParams,
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
    elements.get('join-form').onsubmit({ preventDefault() {} });
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
  app.pointer('right', 'down'); socket.readyState = 3; socket.onclose();
  assert.ok(app.buttons.every(b => !b.classList.contains('held')));
  assert.equal(app.timers.size, 1);
  const reconnect = [...app.timers.values()][0]; reconnect();
  const next = app.sockets.at(-1); next.readyState = 1; next.onopen();
  next.onmessage({ data: JSON.stringify({ type: 'joined', slot: 2, color: '#ef665e' }) });
  app.pointer('right', 'up'); app.pointer('right', 'down'); app.pointer('right', 'up');
  assert.deepEqual(next.sent.filter(m => m.button).map(m => m.pressed), [true, false]);
});
