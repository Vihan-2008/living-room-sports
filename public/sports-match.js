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
export function createSportsMatch(id, players) {
  return { id, turn: 0, finished: false, players: players.map(p => ({ ...p, score: 0, done: false, frames: [[]], pins: 10, strokes: 0, hole: 1, distance: 150, points: [0, 0], games: [0, 0], health: [100, 100], punches: 0, inning: 1, outs: 0, strikes: 0, bases: [false, false, false] })) };
}
export function matchLabel(state) {
  const p = state.players[state.turn];
  if (state.finished) return 'Match complete';
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
