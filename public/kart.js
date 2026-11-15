const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const courses = [
  { name: 'Seabreeze Circuit', color: '#80cbb4', road: '#627982', curve: .7, length: 2400, width: 1 },
  { name: 'Copper Canyon', color: '#d9a678', road: '#876f63', curve: 1, length: 2800, width: .85 },
  { name: 'Starlight Ring', color: '#29395f', road: '#66719a', curve: 1.3, length: 3000, width: .75 }
];
export function createRace(players, course = 0) {
  const racers = players.map(p => ({ ...p, bot: false }));
  while (racers.length < 4) racers.push({ slot: -racers.length - 1, name: `CPU ${racers.length + 1}`, color: ['#139ed3', '#ed8e78', '#e4b64c', '#976ac4'][racers.length], bot: true });
  return { course: courses[course] || courses[0], time: -3, finished: false, racers: racers.map((p, i) => ({ ...p, distance: 0, lane: (i - 1.5) * .28, speed: 0, item: null, box: 0, boost: 0, shield: 0, stun: 0, drift: 0, place: null, finishTime: null, controls: {} })) };
}
export function raceInput(race, slot, message) {
  const p = race.racers.find(p => p.slot === slot && !p.bot);
  if (!p) return;
  if (message.pointing && Number.isFinite(message.x)) p.controls.tilt = clamp(message.x, -1, 1);
  if (message.shake || (message.button === 'one' && message.pressed)) p.controls.tilt = 0;
  if (message.button) p.controls[message.button] = !!message.pressed;
  if (message.button === 'a' && message.pressed) useItem(race, p);
}
export function useItem(race, p) {
  if (race.time < 0 || p.finishTime !== null || !p.item) return;
  if (p.item === 'Boost') p.boost = 2;
  if (p.item === 'Shield') p.shield = 5;
  if (p.item === 'Spark') {
    const target = race.racers.filter(q => q !== p && q.distance > p.distance && q.finishTime === null).sort((a, b) => a.distance - b.distance)[0];
    if (target && target.shield <= 0) target.stun = 1.2;
  }
  p.item = null;
}
export function stepRace(race, elapsed) {
  if (race.finished) return;
  const dt = clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, .05);
  race.time += dt;
  if (race.time < 0) return;
  for (const [i, p] of race.racers.entries()) {
    if (p.finishTime !== null) continue;
    const c = p.controls;
    if (p.bot) {
      c.tilt = clamp(-p.lane * 1.8 + Math.sin(race.time * .7 + i) * .25, -1, 1);
      c.b = Math.sin(race.time + i) > .85;
      if (p.item) useItem(race, p);
    }
    for (const key of ['boost', 'shield', 'stun']) p[key] = Math.max(0, p[key] - dt);
    const steer = clamp((c.tilt || 0) + (c.right ? 1 : 0) - (c.left ? 1 : 0), -1, 1);
    const bend = Math.sin(p.distance / race.course.length * Math.PI * 4) * race.course.curve;
    p.lane = clamp(p.lane + (steer * 1.25 + bend * p.speed / 130) * dt, -1.5, 1.5);
    const offRoad = Math.abs(p.lane) > race.course.width;
    const maximum = p.stun > 0 ? 25 : offRoad ? 42 : c.down ? 40 : p.boost > 0 ? 155 : c.b ? 87 : p.bot ? 99 + i : 110;
    p.speed = clamp(p.speed + (p.speed < maximum ? 42 : -100) * dt, 0, maximum);
    if (c.b && Math.abs(steer) > .3 && !offRoad) p.drift = Math.min(1.5, p.drift + dt);
    else { if (p.drift > .65) p.boost = Math.max(p.boost, p.drift); p.drift = 0; }
    p.distance += p.speed * dt;
    const box = Math.floor(p.distance / 450);
    if (box > p.box) {
      p.box = box;
      if (!p.item && !offRoad) p.item = ['Boost', 'Shield', 'Spark'][(box + i) % 3];
    }
  }
  // Resolve same-frame finishes by their interpolated crossing times, not player order.
  const finish = race.course.length * 3;
  for (const p of race.racers.filter(p => p.finishTime === null && p.distance >= finish)) {
    p.finishTime = race.time - (p.distance - finish) / Math.max(1, p.speed);
    p.distance = finish;
  }
  const winners = race.racers.filter(p => p.finishTime !== null).sort((a, b) => a.finishTime - b.finishTime);
  winners.forEach((p, i) => { p.place = i + 1; });
  race.finished = race.racers.every(p => p.bot || p.finishTime !== null);
}
export function standings(race) {
  return [...race.racers].sort((a, b) => (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || b.distance - a.distance);
}
