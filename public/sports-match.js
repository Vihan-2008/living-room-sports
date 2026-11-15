// Rules are independent of the canvas so complete matches can be tested without a browser.
export function bowlingScore(frames) {
  const rolls = frames.flat(); let score = 0, offset = 0;
  frames.forEach((frame, i) => {
    if (i === 9) score += frame.reduce((a, b) => a + b, 0);
    else if (frame[0] === 10) score += 10 + (rolls[offset + 1] || 0) + (rolls[offset + 2] || 0);
    else if (frame.length === 2 && frame[0] + frame[1] === 10) score += 10 + (rolls[offset + 2] || 0);
    else score += frame.reduce((a, b) => a + b, 0);
    offset += frame.length;
  });
  return score;
}
// Tennis and boxing are head to head when two or more play: two players face each other,
// and three or four split into two sides (the first half of the players against the rest).
// One player on their own plays the CPU.
const HEAD_TO_HEAD = new Set(['tennis', 'boxing']);
const ROUND_PUNCHES = 12; // six for each side
const ROUNDS = 3;
const GAMES_TO_WIN = 2;

export function createSportsMatch(id, players) {
  const state = { id, turn: 0, finished: false, players: players.map(p => ({ ...p, score: 0, done: false, frames: [[]], pins: 10, strokes: 0, hole: 1, distance: 150, points: [0, 0], games: [0, 0], health: [100, 100], punches: 0, inning: 1, outs: 0, strikes: 0, bases: [false, false, false] })) };
  if (HEAD_TO_HEAD.has(id) && players.length > 1) {
    const split = Math.ceil(players.length / 2);
    state.sides = [0, 1].map(side => ({
      members: state.players.map((_, i) => i).filter(i => (i < split) === (side === 0)),
      next: 0, games: 0, points: 0, health: 100, guard: false
    }));
    state.players.forEach((p, i) => { p.side = i < split ? 0 : 1; });
    Object.assign(state, { serving: 0, rally: 0, punches: 0, knockout: false });
    if (id === 'boxing') for (const p of state.players) p.score = 100;
    handTo(state, 0);
  }
  return state;
}
export const sideName = (state, side) => state.sides[side].members.map(i => state.players[i].name).join(' & ');
// Gives the next shot to a side; its players take turns within it.
function handTo(state, side) {
  const s = state.sides[side];
  state.hitting = side; state.turn = s.members[s.next];
  s.next = (s.next + 1) % s.members.length;
}
export function matchLabel(state) {
  const p = state.players[state.turn];
  if (state.finished) return 'Match complete';
  if (state.sides) {
    const [a, b] = state.sides;
    if (state.id === 'boxing') return `Round ${Math.min(ROUNDS, Math.floor(state.punches / ROUND_PUNCHES) + 1)} / ${ROUNDS} · Health: ${sideName(state, 0)} ${a.health}, ${sideName(state, 1)} ${b.health}`;
    const point = n => [0, 15, 30, 40][Math.min(n, 3)];
    const score = a.points >= 3 && b.points >= 3
      ? a.points === b.points ? 'Deuce' : `Advantage ${sideName(state, a.points > b.points ? 0 : 1)}`
      : `${point(a.points)}–${point(b.points)}`;
    return `Games ${a.games}–${b.games} · ${score}`;
  }
  if (state.id === 'bowling') return `Frame ${p.frames.length} / 10 · ${p.pins} pins standing`;
  if (state.id === 'golf') return `Hole ${p.hole} / 3 · Par 3 · ${p.distance} m · Stroke ${p.strokes + 1}`;
  if (state.id === 'tennis') {
    const [a, b] = p.points;
    const point = n => [0, 15, 30, 40][Math.min(n, 3)];
    return `Games ${p.games.join('–')} · ${a >= 3 && b >= 3 ? a === b ? 'Deuce' : a > b ? 'Advantage you' : 'Advantage CPU' : `${point(a)}–${point(b)}`}`;
  }
  if (state.id === 'boxing') return `Round ${Math.min(3, Math.floor(p.punches / 6) + 1)} / 3 · Health ${p.health[0]} · CPU ${p.health[1]}`;
  return `Inning ${p.inning} / 3 · ${p.outs} outs · ${p.strikes} strikes · Bases ${p.bases.map((b, i) => b ? i + 1 : '–').join(' ')}`;
}
export function resolveShot(state, result, { block = false } = {}) {
  if (state.finished) return '';
  if (state.sides) return state.id === 'tennis' ? rally(state, result) : exchange(state, result, block);
  const p = state.players[state.turn]; let text = result.text, advance = true;
  if (state.id === 'bowling') {
    const frame = p.frames.at(-1), pins = Math.min(p.pins, result.score);
    frame.push(pins); p.pins -= pins;
    const tenth = p.frames.length === 10;
    const complete = tenth ? frame.length === 3 || (frame.length === 2 && frame[0] + frame[1] < 10) : pins === 10 || frame.length === 2;
    text = pins === 10 ? 'Strike!' : p.pins === 0 ? 'Spare!' : `${pins} pins down. ${p.pins} remain.`;
    if (complete) { p.done = tenth; if (!tenth) p.frames.push([]); p.pins = 10; }
    else { if (p.pins === 0) p.pins = 10; advance = false; }
    p.score = bowlingScore(p.frames);
  } else if (state.id === 'tennis') {
    p.points[result.score >= 6 ? 0 : 1]++;
    const [a, b] = p.points;
    if (Math.max(a, b) >= 4 && Math.abs(a - b) >= 2) {
      p.games[a > b ? 0 : 1]++; p.points = [0, 0];
      text += a > b ? ' Game to you!' : ' Game to CPU.';
    } else advance = false;
    p.score = p.games[0]; p.done = Math.max(...p.games) >= 2;
  } else if (state.id === 'boxing') {
    p.punches++; p.health[1] = Math.max(0, p.health[1] - result.score * 3);
    if (p.health[1] > 0) p.health[0] = Math.max(0, p.health[0] - (block ? 4 : 12));
    p.score = 100 - p.health[1]; p.done = p.health.includes(0) || p.punches >= 18;
    text += p.health[1] === 0 ? ' Knockout! You win the bout.' : p.health[0] === 0 ? ' Knockout. CPU wins the bout.' : '';
    advance = p.done || p.punches % 6 === 0;
  } else if (state.id === 'golf') {
    p.strokes++; p.score++;
    // First stroke approaches the green; the second is a putt, using the same aim/power controls.
    p.distance = p.strokes === 1 ? Math.max(2, 32 - result.score) : Math.max(0, Math.round((30 - result.score) / 4));
    const holed = p.distance <= 1;
    text = holed ? `Holed in ${p.strokes}!` : `${p.distance} m to the cup.`;
    if (holed || p.strokes >= 8) { if (!holed) text += ' Eight-stroke limit.'; p.hole++; p.strokes = 0; p.distance = 150; p.done = p.hole > 3; }
    else advance = false;
  } else if (state.id === 'baseball') {
    if (result.score === 0) {
      if (++p.strikes === 3) { p.outs++; p.strikes = 0; text = 'Strike three! Out.'; }
    } else {
      p.strikes = 0;
      for (let base = 2; base >= 0; base--) if (p.bases[base]) {
        p.bases[base] = false;
        if (base + result.score >= 3) p.score++; else p.bases[base + result.score] = true;
      }
      if (result.score === 4) p.score++; else p.bases[result.score - 1] = true;
      // Each successful hit is followed by a CPU fielding out, bounding each half-inning.
      p.outs++; text += ' Next batter retired by the fielders.';
    }
    if (p.outs >= 3) { p.inning++; p.outs = 0; p.bases = [false, false, false]; p.done = p.inning > 3; }
    else advance = false;
  }
  state.finished = state.players.every(p => p.done);
  if (!state.finished && (advance || p.done)) {
    do { state.turn = (state.turn + 1) % state.players.length; } while (state.players[state.turn].done);
  }
  return text;
}

// A tennis point starts with a serve. A strong shot (8 or more) wins the point, a weaker one
// goes over and the other side has to play it, and a miss loses the point.
function rally(state, result) {
  const side = state.hitting, serve = state.rally === 0, { score } = result;
  if (score > 0 && score < 8) {
    state.rally++; handTo(state, 1 - side);
    return serve ? 'Good serve.' : result.text;
  }
  const winner = score ? side : 1 - side, [a, b] = state.sides;
  let text = `${serve ? score ? 'Ace!' : 'Fault!' : result.text} Point to ${sideName(state, winner)}.`;
  state.sides[winner].points++; state.rally = 0;
  if (Math.max(a.points, b.points) >= 4 && Math.abs(a.points - b.points) >= 2) {
    const game = a.points > b.points ? 0 : 1;
    state.sides[game].games++; a.points = b.points = 0; state.serving = 1 - state.serving;
    text += ` Game to ${sideName(state, game)}.`;
  }
  for (const p of state.players) p.score = state.sides[p.side].games;
  if (Math.max(a.games, b.games) >= GAMES_TO_WIN) finish(state);
  else handTo(state, state.serving);
  return text;
}
// Boxers take turns to punch. Holding B keeps the puncher's guard up: their punch lands at
// half strength, and so does the next punch against them.
function exchange(state, result, block) {
  const side = state.hitting, own = state.sides[side], other = state.sides[1 - side];
  let damage = result.score * 3;
  if (block) damage = Math.round(damage / 2);
  if (other.guard) damage = Math.round(damage / 2);
  other.health = Math.max(0, other.health - damage); own.guard = block; state.punches++;
  for (const p of state.players) p.score = state.sides[p.side].health;
  let text = damage ? `${result.text} ${damage} damage.` : result.text;
  if (other.health === 0) {
    state.knockout = true; finish(state);
    return `${text} Knockout! ${sideName(state, side)} ${wins(state, side)} the bout.`;
  }
  if (state.punches >= ROUND_PUNCHES * ROUNDS) { finish(state); return `${text} That's the final bell.`; }
  if (state.punches % ROUND_PUNCHES === 0) text += ` End of round ${state.punches / ROUND_PUNCHES}.`;
  handTo(state, 1 - side);
  return text;
}
const wins = (state, side) => state.sides[side].members.length > 1 ? 'win' : 'wins';
function finish(state) { state.finished = true; for (const p of state.players) p.done = true; }

// The line shown when a match is over.
export function matchResult(state, unit) {
  const players = state.players;
  if (state.sides) {
    const [a, b] = state.sides, name = side => `${sideName(state, side)} ${wins(state, side)}`;
    if (state.id === 'tennis') {
      const w = a.games > b.games ? 0 : 1;
      return `${name(w)}, ${state.sides[w].games} games to ${state.sides[1 - w].games}!`;
    }
    if (a.health === b.health) return `A draw, with ${a.health} health each.`;
    const w = a.health > b.health ? 0 : 1;
    return state.knockout ? `Knockout! ${name(w)}.` : `${name(w)} on points, ${state.sides[w].health} health to ${state.sides[1 - w].health}.`;
  }
  if (players.length === 1 && state.id === 'tennis') {
    const [you, cpu] = players[0].games;
    return `${you > cpu ? 'You win' : 'CPU wins'}! Games ${you}–${cpu}`;
  }
  if (players.length === 1 && state.id === 'boxing') {
    const [you, cpu] = players[0].health;
    return `${you === cpu ? 'Draw' : you > cpu ? 'You win' : 'CPU wins'}! Health ${you}–${cpu}`;
  }
  const best = (state.id === 'golf' ? Math.min : Math.max)(...players.map(p => p.score));
  const winners = players.filter(p => p.score === best);
  return `${winners.map(p => p.name).join(' & ')} ${winners.length > 1 ? 'tie' : 'wins'}! ${best} ${unit}`;
}
