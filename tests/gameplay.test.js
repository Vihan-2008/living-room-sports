import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { sports, evaluate, timingAt } from '../public/games.js';
import { bowlingScore, createSportsMatch, resolveShot, matchLabel, matchResult } from '../public/sports-match.js';
import { courses, createRace, raceInput, stepRace, standings } from '../public/kart.js';
import { drawRace } from '../public/race-view.js';

const players = count => Array.from({ length: count }, (_, i) => ({ slot: i + 1, name: `Player ${i + 1}`, color: '#139ed3' }));
const shot = (state, score, options) => resolveShot(state, { score, text: 'Shot.' }, options);

test('bowling scores strikes, spares, open frames, a perfect game and a gutter game', () => {
  assert.equal(bowlingScore([[10], [3, 4]]), 24);
  assert.equal(bowlingScore([[5, 5], [3, 4]]), 20);
  assert.equal(bowlingScore([...Array.from({ length: 9 }, () => [10]), [10, 10, 10]]), 300);
  assert.equal(bowlingScore(Array.from({ length: 10 }, () => [0, 0])), 0);
});
test('bowling keeps the second roll with its player, caps pins and rotates after frames', () => {
  const state = createSportsMatch('bowling', players(2));
  shot(state, 7); assert.equal(state.turn, 0); assert.equal(state.players[0].pins, 3);
  shot(state, 8); assert.equal(state.turn, 1); assert.deepEqual(state.players[0].frames[0], [7, 3]);
  shot(state, 10); assert.equal(state.turn, 0); assert.match(matchLabel(state), /Frame 2/);
});
test('bowling tenth frame gives exactly the earned bonus rolls', () => {
  for (const [rolls, count, total] of [[[10, 10, 10], 3, 30], [[6, 4, 7], 3, 17], [[3, 4], 2, 7], [[10, 7, 8], 3, 20]]) {
    const state = createSportsMatch('bowling', players(1));
    for (let i = 0; i < 18; i++) shot(state, 0);
    for (const score of rolls) shot(state, score);
    assert.ok(state.finished); assert.equal(state.players[0].frames[9].length, count);
    assert.equal(state.players[0].score, total);
    shot(state, 10); assert.equal(state.players[0].score, total);
  }
});
test('all four bowlers complete ten frames and earn a perfect 300', () => {
  const state = createSportsMatch('bowling', players(4));
  let rolls = 0; while (!state.finished && rolls < 100) { shot(state, 10); rolls++; }
  assert.equal(rolls, 48); assert.deepEqual(state.players.map(p => p.score), [300, 300, 300, 300]);
});
test('tennis deuce requires two clear points, then first to two games wins', () => {
  const state = createSportsMatch('tennis', players(1));
  for (let i = 0; i < 3; i++) { shot(state, 10); shot(state, 0); }
  assert.match(matchLabel(state), /Deuce/);
  shot(state, 10); assert.match(matchLabel(state), /Advantage you/);
  shot(state, 0); assert.match(matchLabel(state), /Deuce/);
  shot(state, 10); shot(state, 10); assert.deepEqual(state.players[0].games, [1, 0]);
  for (let i = 0; i < 4; i++) shot(state, 10);
  assert.ok(state.finished); assert.equal(state.players[0].score, 2);
});
test('boxing can end in either knockout and blocking protects health', () => {
  const loss = createSportsMatch('boxing', players(1));
  for (let i = 0; i < 9; i++) shot(loss, 0);
  assert.ok(loss.finished); assert.equal(loss.players[0].health[0], 0);
  const win = createSportsMatch('boxing', players(1));
  for (let i = 0; i < 4; i++) shot(win, 10, { block: true });
  assert.ok(win.finished); assert.equal(win.players[0].health[1], 0); assert.equal(win.players[0].health[0], 88);
});
test('golf counts strokes across three holes and caps an unsuccessful hole at eight', () => {
  const state = createSportsMatch('golf', players(1));
  for (let i = 0; i < 6; i++) shot(state, 30);
  assert.ok(state.finished); assert.equal(state.players[0].score, 6);
  const missed = createSportsMatch('golf', players(1));
  for (let i = 0; i < 24; i++) shot(missed, 0);
  assert.ok(missed.finished); assert.equal(missed.players[0].score, 24);
});
test('baseball advances runners, scores runs and clears bases between innings', () => {
  const state = createSportsMatch('baseball', players(1));
  shot(state, 1); shot(state, 2);
  assert.deepEqual(state.players[0].bases, [false, true, true]);
  shot(state, 4); assert.equal(state.players[0].score, 3); assert.equal(state.players[0].inning, 2);
  assert.deepEqual(state.players[0].bases, [false, false, false]);
  for (let i = 0; i < 18; i++) shot(state, 0);
  assert.ok(state.finished); assert.equal(state.players[0].score, 3);
});
test('every sport completes with one to four players without skipping anyone', () => {
  for (const id of ['bowling', 'tennis', 'boxing', 'golf', 'baseball']) for (let count = 1; count <= 4; count++) {
    const state = createSportsMatch(id, players(count)); let actions = 0;
    const played = new Set();
    while (!state.finished && actions++ < 500) { played.add(state.turn); shot(state, id === 'golf' ? 30 : id === 'baseball' ? 4 : 10); }
    assert.ok(state.finished, `${id}/${count}`); assert.ok(state.players.every(p => p.done));
    assert.equal(played.size, count, `${id}/${count}: everyone plays`);
  }
});
test('one player plays tennis and boxing against the CPU; two or more play each other', () => {
  for (const id of ['tennis', 'boxing']) {
    assert.equal(createSportsMatch(id, players(1)).sides, undefined);
    assert.deepEqual(createSportsMatch(id, players(2)).sides.map(s => s.members), [[0], [1]]);
    assert.deepEqual(createSportsMatch(id, players(3)).sides.map(s => s.members), [[0, 1], [2]]);
    assert.deepEqual(createSportsMatch(id, players(4)).sides.map(s => s.members), [[0, 1], [2, 3]]);
  }
  for (const id of ['bowling', 'golf', 'baseball']) assert.equal(createSportsMatch(id, players(2)).sides, undefined);
});
test('head-to-head tennis rallies, changes serve each game, plays deuce and names the winner', () => {
  const state = createSportsMatch('tennis', players(2));
  assert.equal(shot(state, 5), 'Good serve.'); assert.equal(state.turn, 1);
  assert.equal(shot(state, 5), 'Shot.'); assert.equal(state.turn, 0);
  assert.equal(shot(state, 9), 'Shot. Point to Player 1.'); assert.equal(state.turn, 0, 'The server serves the next point');
  assert.equal(shot(state, 0), 'Fault! Point to Player 2.'); assert.equal(matchLabel(state), 'Games 0–0 · 15–15');
  shot(state, 10); shot(state, 10);
  assert.match(shot(state, 10), /^Ace! Point to Player 1\. Game to Player 1\.$/);
  assert.equal(matchLabel(state), 'Games 1–0 · 0–0'); assert.equal(state.turn, 1, 'Player 2 serves the second game');
  for (let i = 0; i < 3; i++) { shot(state, 10); shot(state, 0); }
  assert.equal(matchLabel(state), 'Games 1–0 · Deuce');
  shot(state, 10); assert.equal(matchLabel(state), 'Games 1–0 · Advantage Player 2');
  shot(state, 0); assert.equal(matchLabel(state), 'Games 1–0 · Deuce');
  shot(state, 10); shot(state, 10); assert.equal(matchLabel(state), 'Games 1–1 · 0–0');
  assert.deepEqual(state.players.map(p => p.score), [1, 1]);
  for (let i = 0; i < 4; i++) shot(state, 10);
  assert.ok(state.finished); assert.deepEqual(state.players.map(p => p.score), [2, 1]);
  assert.equal(matchResult(state, 'games'), 'Player 1 wins, 2 games to 1!');
});
test('head-to-head teams take turns within each side', () => {
  const turns = (count, shots) => { const state = createSportsMatch('tennis', players(count)), seen = [];
    for (let i = 0; i < shots; i++) { seen.push(state.turn); shot(state, 5); } return { state, seen }; };
  assert.deepEqual(turns(4, 6).seen, [0, 2, 1, 3, 0, 2]);
  assert.deepEqual(turns(3, 6).seen, [0, 2, 1, 2, 0, 2]);
  const { state } = turns(3, 0);
  for (let i = 0; i < 8; i++) shot(state, i % 2 ? 0 : 10);
  assert.equal(matchLabel(state), 'Games 0–0 · Deuce');
  shot(state, 10); assert.equal(matchLabel(state), 'Games 0–0 · Advantage Player 1 & Player 2');
  assert.match(shot(state, 10), /Game to Player 1 & Player 2\.$/);
  assert.equal(state.turn, 2, 'Player 3 serves the second game');
  while (!state.finished) shot(state, 0);
  assert.equal(matchResult(state, 'games'), 'Player 1 & Player 2 win, 2 games to 0!');
});
test('head-to-head boxing: guards halve punches both ways, rounds run out and knockouts end it', () => {
  const bout = createSportsMatch('boxing', players(2));
  assert.equal(shot(bout, 10), 'Shot. 30 damage.'); assert.equal(bout.sides[1].health, 70); assert.equal(bout.turn, 1);
  assert.equal(shot(bout, 10, { block: true }), 'Shot. 15 damage.', 'A guarded punch lands at half strength');
  assert.equal(shot(bout, 10), 'Shot. 15 damage.', 'and so does the next punch against the guarded boxer');
  assert.equal(shot(bout, 0), 'Shot.'); assert.equal(bout.sides[1].guard, false);
  assert.match(matchLabel(bout), /^Round 1 \/ 3 · Health: Player 1 85, Player 2 55$/);
  shot(bout, 10); shot(bout, 0);
  assert.equal(shot(bout, 10), 'Shot. 30 damage. Knockout! Player 1 wins the bout.');
  assert.ok(bout.finished && bout.knockout); assert.deepEqual(bout.players.map(p => p.score), [85, 0]);
  assert.equal(matchResult(bout, 'damage'), 'Knockout! Player 1 wins.');

  const points = createSportsMatch('boxing', players(4));
  shot(points, 1);
  for (let i = 1; i < 12; i++) shot(points, 0);
  assert.match(matchLabel(points), /^Round 2 \/ 3 · Health: Player 1 & Player 2 100, Player 3 & Player 4 97$/);
  while (!points.finished) shot(points, 0);
  assert.equal(points.punches, 36); assert.equal(points.knockout, false);
  assert.equal(matchResult(points, 'damage'), 'Player 1 & Player 2 win on points, 100 health to 97.');
  const level = createSportsMatch('boxing', players(2));
  while (!level.finished) shot(level, 0);
  assert.equal(matchResult(level, 'damage'), 'A draw, with 100 health each.');
});
test('race fills spare slots with CPU racers and accepts simultaneous slot-specific controls', () => {
  for (let count = 1; count <= 4; count++) {
    const race = createRace(players(count)); assert.equal(race.racers.length, 4);
    assert.equal(race.racers.filter(p => !p.bot).length, count);
  }
  const race = createRace(players(4));
  raceInput(race, 1, { button: 'left', pressed: true }); raceInput(race, 2, { button: 'right', pressed: true });
  raceInput(race, 99, { button: 'down', pressed: true });
  assert.equal(race.racers[0].controls.left, true); assert.equal(race.racers[1].controls.right, true);
  assert.deepEqual(race.racers[2].controls, {});
  raceInput(race, 1, { button: 'left', pressed: false }); assert.equal(race.racers[0].controls.left, false);
});
test('countdown prevents movement, off-road slows karts and suspended frames are capped', () => {
  const race = createRace(players(1)); stepRace(race, 100);
  assert.equal(race.racers[0].distance, 0); assert.ok(race.time < -2.9);
  race.time = 0; const p = race.racers[0]; p.lane = 1.5; p.speed = 100;
  stepRace(race, .05); assert.ok(p.speed <= 42); assert.ok(p.lane <= 1.5);
  const time = race.time; stepRace(race, NaN); assert.equal(race.time, time);
});
test('item boxes grant items; boost, shields and attacks have distinct effects', () => {
  const race = createRace(players(2)); race.time = 0;
  const [a, b] = race.racers; a.distance = 449; a.speed = 110; a.lane = 0;
  stepRace(race, .05); assert.ok(a.item);
  a.item = 'Boost'; raceInput(race, 1, { button: 'a', pressed: true }); assert.equal(a.boost, 2); assert.equal(a.item, null);
  b.distance = a.distance + 50; b.item = 'Shield'; raceInput(race, 2, { button: 'a', pressed: true });
  a.item = 'Spark'; raceInput(race, 1, { button: 'a', pressed: true }); assert.equal(b.stun, 0);
  b.shield = 0; a.item = 'Spark'; raceInput(race, 1, { button: 'a', pressed: true }); assert.equal(b.stun, 1.2);
});
test('charged drifts grant a boost when released', () => {
  const race = createRace(players(1)); race.time = 0;
  const p = race.racers[0]; p.drift = .8; p.controls.b = false;
  stepRace(race, .05); assert.equal(p.boost, .8); assert.equal(p.drift, 0);
});
test('three-lap finishes use crossing order and stop only after every human finishes', () => {
  const race = createRace(players(2)); race.time = 10;
  const finish = race.course.length * 3;
  race.racers[0].distance = finish - 3; race.racers[0].speed = 100;
  race.racers[1].distance = finish - 1; race.racers[1].speed = 100;
  stepRace(race, .05);
  assert.equal(standings(race)[0].slot, 2); assert.equal(race.racers[1].place, 1); assert.ok(race.finished);
  const time = race.time; stepRace(race, .05); assert.equal(race.time, time);
});
test('all courses support complete races with finite results and CPU competition', () => {
  for (let course = 0; course < courses.length; course++) {
    const race = createRace(players(1), course); let steps = 0;
    while (!race.finished && steps++ < 12000) {
      const p = race.racers[0]; raceInput(race, 1, { pointing: true, x: -p.lane * 2 });
      stepRace(race, .05);
    }
    assert.ok(race.finished, courses[course].name); assert.ok(Number.isFinite(race.racers[0].finishTime));
    assert.ok(race.racers.every(p => Number.isFinite(p.distance) && Number.isFinite(p.speed)));
  }
});

// Run the actual dashboard event handlers and renderer against a minimal DOM.
// This catches wiring errors without adding a browser dependency to the local app.
async function dashboard({ href = 'http://localhost:3000/', config = { code: '123456', addresses: [], local: '/remote' }, ok = true } = {}) {
  const html = await readFile(new URL('../public/arcade.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  const handlers = {}, timers = [], elements = new Map();
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  function element() {
    return { hidden: false, open: false, value: '0', textContent: '', children: [], style: { setProperty() {} }, classList: { toggle() {} },
      append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; },
      getContext() { return ctx; }, matches() { return false; }, showModal() { this.open = true; }, close() { this.open = false; } };
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element());
  let now = 1000;
  const context = vm.createContext({ sports, evaluate, timingAt, createSportsMatch, resolveShot, matchLabel, matchResult, createRace, raceInput, stepRace, standings, drawRace,
    document: { getElementById: id => { assert.ok(elements.has(id), `Missing element ${id}`); return elements.get(id); }, createElement: element, querySelectorAll: () => [], addEventListener: (name, callback) => { handlers[name] = callback; } },
    window: { addEventListener: (name, callback) => { handlers[name] = callback; } },
    location: new URL(href), URL,
    WebSocket: class { static OPEN = 1; constructor() { this.readyState = 1; } send() {} },
    performance: { now: () => now }, fetch: async () => ({ ok, json: async () => config }),
    requestAnimationFrame() {}, setInterval() {}, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout: id => { if (id) timers[id - 1] = null; }, console
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, handlers, run: code => vm.runInContext(code, context), advance: () => { now += 2500; const callback = timers.findIndex(Boolean); if (callback >= 0) { const fn = timers[callback]; timers[callback] = null; fn(); } } };
}

test('pairing never offers localhost as a phone link and reports missing network addresses', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'demo.localhost', '0.0.0.0']) {
    const app = await dashboard({ href: `http://${host}:3000/` });
    assert.equal(app.elements.get('join-links').children.length, 0);
    assert.match(app.elements.get('join-links').textContent, /Connect this PC to Wi-Fi/);
  }
});

test('pairing preserves the reachable dashboard origin including HTTPS and deduplicates LAN links', async () => {
  for (const origin of ['https://sports.example:8443', 'http://192.168.1.40:3000']) {
    const link = `${origin}/remote?code=123456`;
    const app = await dashboard({ href: `${origin}/`, config: { code: '123456', addresses: [link, 'http://172.20.0.1:3000/remote?code=123456'] } });
    assert.deepEqual(app.elements.get('join-links').children.map(a => a.href), [link, 'http://172.20.0.1:3000/remote?code=123456']);
    assert.equal(app.elements.get('room-code').textContent, '123456');
    const [qr, label, fallback] = app.elements.get('join-links').children[0].children;
    assert.equal(qr.src, `/qr?url=${encodeURIComponent(link)}`);
    assert.equal(qr.width, 270); assert.equal(qr.height, 270);
    assert.match(qr.alt, /four players/); assert.match(label.textContent, /4 players/);
    assert.equal(fallback.textContent, link);
    qr.onerror(); assert.equal(qr.hidden, true); assert.match(label.textContent, /QR unavailable/);
  }
});

test('reopening pairing refreshes addresses after a network change and handles configuration failures', async () => {
  const config = { code: '123456', addresses: ['http://192.168.1.40:3000/remote?code=123456'] };
  const app = await dashboard({ config });
  config.addresses = ['http://192.168.2.50:3000/remote?code=123456'];
  app.elements.get('pair').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.elements.get('join-links').children.map(a => a.href), config.addresses);
  const failed = await dashboard({ ok: false });
  assert.match(failed.elements.get('join-links').textContent, /reopen this dialog to retry/);
});
test('dashboard launches racing, routes four remotes, draws, restarts courses and returns home', async () => {
  const app = await dashboard();
  app.run(`players = ${JSON.stringify(players(4).map(p => ({ ...p, connected: true })))}; start(sports.findIndex(s => s.id === 'kart'));`);
  assert.equal(app.elements.get('course-picker').hidden, false);
  assert.equal(app.elements.get('power-label').hidden, true);
  app.run("input({ slot: 2, button: 'right', pressed: true }); draw(1000); draw(1050);");
  assert.equal(app.run('race.racers[1].controls.right'), true); assert.equal(app.run('race.racers[0].controls.right'), undefined);
  assert.equal(app.elements.get('scores').children.length, 4);
  app.elements.get('course').value = '2'; app.elements.get('course').onchange();
  assert.equal(app.run('race.course.name'), 'Starlight Ring');
  app.run("input({ slot: 1, button: 'home', pressed: true });");
  assert.equal(app.run('race'), null); assert.equal(app.elements.get('game').hidden, true);
});
test('dashboard bowling preserves roll ownership then rotates, and sports draw without errors', async () => {
  const app = await dashboard();
  app.run(`players = ${JSON.stringify(players(2).map(p => ({ ...p, connected: true })))}; start(sports.findIndex(s => s.id === 'bowling')); aim = 0; play(.4); draw(1000);`);
  assert.equal(app.run('match[0].frames[0][0]'), 7);
  app.advance(); assert.equal(app.run('turn'), 0);
  app.run('play(1); draw(3600);'); app.advance(); assert.equal(app.run('turn'), 1);
  for (const id of ['tennis', 'boxing', 'golf', 'baseball']) app.run(`start(sports.findIndex(s => s.id === '${id}')); draw(7000); play(.7); draw(7100); home();`);
});
test('keyboard fallback transfers from finished to remaining offline racers and blur releases controls', async () => {
  const app = await dashboard();
  app.run(`players = ${JSON.stringify(players(2).map(p => ({ ...p, connected: true })))}; start(0); players = []; race.racers[0].finishTime = 10; input({slot: 0, button: 'left', pressed: true});`);
  assert.equal(app.run('race.racers[1].controls.left'), true);
  app.handlers.blur(); assert.equal(app.run('Object.keys(race.racers[1].controls).length'), 0);
});
test('pairing pauses the race and clears held controls; course select retains keyboard input', async () => {
  const app = await dashboard();
  app.run("start(0); race.time = 1; input({slot: 0, button: 'b', pressed: true}); draw(1000);");
  app.elements.get('pair').onclick(); app.run('draw(1050);');
  assert.equal(app.run('race.time'), 1); assert.equal(app.run('Object.keys(race.racers[0].controls).length'), 0);
  app.elements.get('pair-dialog').close();
  app.handlers.keydown({ key: 'ArrowRight', target: { matches: selector => selector.includes('select') }, preventDefault() { assert.fail('Native select input intercepted'); } });
  app.run('draw(1100);'); assert.ok(app.run('race.time') > 1);
});
test('sports cancellation clears charge and block before modal handling without taking a shot', async () => {
  const app = await dashboard();
  app.run("players = [{slot: 1, name: 'Player 1', connected: true}]; start(sports.findIndex(s => s.id === 'bowling')); input({slot: 1, button: 'b', pressed: true});");
  assert.equal(app.run('charging && block'), true);
  app.run('input({slot: 2, cancel: true})');
  assert.equal(app.run('charging && block'), true);
  app.elements.get('pair-dialog').open = true;
  app.run('input({slot: 1, cancel: true})');
  assert.equal(app.run('charging || block || busy'), false);
  app.elements.get('pair-dialog').close();
  app.run("input({slot: 1, button: 'b', pressed: false})");
  assert.equal(app.run('match[0].frames.flat().length'), 0);
  for (const reason of ['blur', 'hidden', 'disconnect']) {
    app.run("input({slot: 0, button: 'b', pressed: true})");
    assert.equal(app.run('charging && block'), true);
    if (reason === 'blur') app.handlers.blur();
    if (reason === 'hidden') { app.run('document.hidden = true'); app.handlers.visibilitychange(); }
    if (reason === 'disconnect') app.run('socket.onclose()');
    assert.equal(app.run('charging || block || busy'), false, reason);
  }
  app.run("input({slot: 1, button: 'b', pressed: true}); input({slot: 1, button: 'b', pressed: false})");
  assert.equal(app.run('busy'), true);
  assert.equal(app.run('match[0].frames.flat().length'), 1);
});

test('kart cancellation clears only the affected racer including under a modal and discards drift', async () => {
  const app = await dashboard();
  app.run(`players = ${JSON.stringify(players(2).map(p => ({ ...p, connected: true })))}; start(0); race.time = 1;`);
  app.run("input({slot: 1, button: 'b', pressed: true}); input({slot: 2, button: 'right', pressed: true}); race.racers[0].drift = 2;");
  app.elements.get('pair-dialog').open = true;
  app.run('input({slot: 1, cancel: true})');
  assert.equal(app.run('Object.keys(race.racers[0].controls).length'), 0);
  assert.equal(app.run('race.racers[0].drift'), 0);
  assert.equal(app.run('race.racers[1].controls.right'), true);
  app.elements.get('pair-dialog').close(); app.run('stepRace(race, .05)');
  assert.equal(app.run('race.racers[0].boost'), 0);
  app.run('socket.onclose()');
  assert.equal(app.run('race.racers.filter(p => !p.bot).every(p => Object.keys(p.controls).length === 0)'), true);
});

test('pairing and connection interruptions discard stored drift without awarding a boost', async () => {
  for (const reason of ['pair', 'pair-bottom', 'roster', 'disconnect', 'blur', 'hidden']) {
    const app = await dashboard();
    app.run(`players = ${JSON.stringify(players(2).map(p => ({ ...p, connected: true })))}; start(0); race.time = 1;
      input({slot: 1, button: 'b', pressed: true}); input({slot: 1, button: 'right', pressed: true}); race.racers[0].drift = 1.2;`);
    if (reason === 'pair' || reason === 'pair-bottom') app.elements.get(reason).onclick();
    if (reason === 'roster') app.run(`socket.onmessage({data: JSON.stringify({type: 'roster', players: players.map(p => ({...p, connected: p.slot !== 1}))})});`);
    if (reason === 'disconnect') app.run('socket.onclose()');
    if (reason === 'blur') app.handlers.blur();
    if (reason === 'hidden') { app.run('document.hidden = true'); app.handlers.visibilitychange(); }
    assert.equal(app.run('Object.keys(race.racers[0].controls).length'), 0, reason);
    assert.equal(app.run('race.racers[0].drift'), 0, reason);
    app.elements.get('pair-dialog').close();
    app.run('stepRace(race, .05)');
    assert.equal(app.run('race.racers[0].boost'), 0, reason);
  }
});

test('solo tennis and boxing results correctly name the CPU winner after losses', async () => {
  const app = await dashboard();
  // Fix scoring to misses to isolate result UI from the moving timing window.
  app.run("evaluate = () => ({ score: 0, text: 'Miss.' });");
  for (const id of ['tennis', 'boxing']) {
    app.run(`players = []; start(sports.findIndex(s => s.id === '${id}')); aim = -1;`);
    for (let i = 0; i < 9 && !app.run('finished'); i++) { app.run('play(0)'); app.advance(); }
    assert.equal(app.run('finished'), true, id);
    assert.match(app.elements.get('result').textContent, /CPU wins/);
  }
});

test('two or more phones get head-to-head tennis and boxing with a row per side', async () => {
  const app = await dashboard();
  app.run("evaluate = () => ({ score: 10, text: 'Clean hit.' });");
  for (const [id, count] of [['tennis', 2], ['tennis', 4], ['boxing', 3]]) {
    app.run(`players = ${JSON.stringify(players(count).map(p => ({ ...p, connected: true })))}; start(sports.findIndex(s => s.id === '${id}'));`);
    assert.equal(app.elements.get('game-help').textContent, sports.find(s => s.id === id).versusHelp);
    const rows = app.elements.get('scores').children;
    assert.equal(rows.length, 2, `${id}/${count}`);
    const names = rows[0].children[0].children;
    assert.equal(names.length, count > 2 ? 3 : 1, 'A side of two shows both players');
    if (count > 2) assert.equal(names[1], ' & ');
    assert.equal(rows[1].children[1].textContent, id === 'tennis' ? '0 games' : '100 health');
    app.run('draw(7000);');
    for (let i = 0; i < 40 && !app.run('finished'); i++) { app.run(`input({ slot: match[turn].slot, button: 'a', pressed: true });`); app.advance(); }
    assert.equal(app.run('finished'), true, `${id}/${count}`);
    assert.match(app.elements.get('result').textContent, id === 'tennis' ? /^Player 1.* wins?, 2 games to 1!$/ : /^Knockout! Player 1 & Player 2 win\.$/);
    app.run('draw(9000); home();');
  }
  app.run("players = []; start(sports.findIndex(s => s.id === 'tennis'));");
  assert.equal(app.elements.get('game-help').textContent, sports.find(s => s.id === 'tennis').help, 'One player still plays the CPU');
});

test('sports cancel held charge and block on blur and pairing without firing on release', async () => {
  for (const id of ['bowling', 'golf', 'boxing']) for (const interrupt of ['blur', 'pair', 'pair-bottom']) {
    const app = await dashboard();
    app.run(`start(sports.findIndex(s => s.id === '${id}')); input({slot: 0, button: 'b', pressed: true});`);
    assert.equal(app.run('charging && block'), true);
    if (interrupt === 'blur') app.handlers.blur();
    else { app.elements.get(interrupt).onclick(); app.elements.get('pair-dialog').close(); }
    assert.equal(app.run('charging || block'), false, `${id}/${interrupt}`);
    app.run("input({slot: 0, button: 'b', pressed: false});");
    assert.equal(app.run('busy'), false, 'A cancelled charge must not shoot on release');
    // A fresh press must still work after returning to the game.
    app.run("input({slot: 0, button: 'b', pressed: true});");
    assert.equal(app.run('charging && block'), true);
    app.run("input({slot: 0, button: 'b', pressed: false});");
    assert.equal(app.run('busy'), id !== 'boxing');
  }
});

test('sports release held controls when the active remote or dashboard connection is lost', async () => {
  const app = await dashboard();
  const connected = players(2).map(p => ({ ...p, connected: true }));
  app.run(`players = ${JSON.stringify(connected)}; start(sports.findIndex(s => s.id === 'bowling')); input({slot: 1, button: 'b', pressed: true});`);
  const roster = list => app.run(`socket.onmessage({data: ${JSON.stringify(JSON.stringify({ type: 'roster', players: list }))}});`);
  roster(connected.map(p => ({ ...p, connected: p.slot === 1 })));
  assert.equal(app.run('charging && block'), true, 'Other players leaving must not cancel the active charge');
  roster(connected.map(p => ({ ...p, connected: false })));
  assert.equal(app.run('charging || block'), false);
  assert.match(app.elements.get('turn').textContent, /offline: use keyboard/);
  app.run("input({slot: 0, button: 'b', pressed: false});");
  assert.equal(app.run('busy'), false);
  app.run("input({slot: 0, button: 'b', pressed: true});");
  roster(connected.map(p => ({ ...p, connected: p.slot === 2 })));
  assert.equal(app.run('charging && block'), true, 'A roster update must preserve an offline keyboard charge');
  app.run('socket.onclose();');
  assert.equal(app.run('charging || block'), false);
  app.run("input({slot: 0, button: 'b', pressed: false});");
  assert.equal(app.run('busy'), false);
});

test('dashboard connection loss releases all racers held inputs', async () => {
  const app = await dashboard();
  app.run(`players = ${JSON.stringify(players(4).map(p => ({ ...p, connected: true })))}; start(0);`);
  app.run("for (let slot = 1; slot <= 4; slot++) { input({slot, button: 'b', pressed: true}); input({slot, button: 'right', pressed: true}); } socket.onclose();");
  assert.equal(app.run('race.racers.every(p => Object.keys(p.controls).length === 0)'), true);
});

test('race interruptions discard accumulated drift without awarding a release boost', async () => {
  for (const interrupt of ['blur', 'hidden', 'pair', 'pair-bottom', 'connection', 'roster']) {
    const app = await dashboard();
    app.run(`players = ${JSON.stringify(players(2).map(p => ({ ...p, connected: true })))}; start(0); race.time = 1;
      for (let slot = 1; slot <= 2; slot++) {
        input({slot, button: 'b', pressed: true}); input({slot, button: 'right', pressed: true});
        race.racers[slot - 1].drift = .9;
      }`);
    if (interrupt === 'blur') app.handlers.blur();
    if (interrupt === 'hidden') { app.run('document.hidden = true'); app.handlers.visibilitychange(); }
    if (interrupt === 'pair' || interrupt === 'pair-bottom') {
      app.elements.get(interrupt).onclick(); app.elements.get('pair-dialog').close();
    }
    if (interrupt === 'connection') app.run('socket.onclose();');
    if (interrupt === 'roster') {
      const roster = players(2).map(p => ({ ...p, connected: p.slot === 2 }));
      app.run(`socket.onmessage({data: ${JSON.stringify(JSON.stringify({ type: 'roster', players: roster }))}});`);
    }
    assert.equal(app.run('Object.keys(race.racers[0].controls).length'), 0, interrupt);
    assert.equal(app.run('race.racers[0].drift'), 0, interrupt);
    if (['blur', 'hidden', 'roster'].includes(interrupt)) {
      assert.equal(app.run('race.racers[1].controls.b'), true, 'Unaffected remote keeps its controls');
      assert.equal(app.run('race.racers[1].drift'), .9);
    } else {
      assert.equal(app.run('Object.keys(race.racers[1].controls).length'), 0, interrupt);
      assert.equal(app.run('race.racers[1].drift'), 0, interrupt);
    }
    app.run('stepRace(race, .05);');
    assert.equal(app.run('race.racers[0].boost'), 0, interrupt);
  }
});
