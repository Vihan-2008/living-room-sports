export const sports = [
  { id: 'bowling', name: 'Bluebird Lanes', sport: 'Bowling', icon: '●', color: '#4aaed3', unit: 'pins', help: 'Aim down the lane. Hold B, swing forward, then release B. A rolls with the power meter.' },
  { id: 'tennis', name: 'Sunbeam Rally', sport: 'Tennis', icon: '◉', color: '#78b961', unit: 'points', help: 'Aim at the open side. Swing or press A when the ball reaches the blue timing zone.' },
  { id: 'boxing', name: 'Cloud Nine Ring', sport: 'Boxing', icon: '◆', color: '#ed8e78', unit: 'points', help: 'Aim at the moving pad. Punch with a swing or A in the blue timing zone. B blocks to widen the timing window.' },
  { id: 'golf', name: 'Clover Greens', sport: 'Golf', icon: '⚑', color: '#61b995', unit: 'points', help: 'Aim toward the flag. Hold B and release with a swing, or press A. Match power to the flag distance.' },
  { id: 'baseball', name: 'Comet Ballpark', sport: 'Baseball', icon: '◇', color: '#c6a164', unit: 'bases', help: 'Point toward fair territory. Swing or press A as the pitch reaches the blue timing zone. Strong, well-timed hits travel farther.' }
];
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function timingAt(time) { return (Math.sin(time * 0.0025) + 1) / 2; }
export function evaluate(id, { aim = 0, power = 0.7, timing = 1, block = false } = {}) {
  aim = clamp(aim, -1, 1); power = clamp(power, 0, 1); timing = clamp(timing, 0, 1);
  const accuracy = 1 - Math.abs(aim);
  const contact = clamp(1 - Math.abs(timing - 0.8) * (block && id === 'boxing' ? 1.6 : 3), 0, 1);
  if (id === 'bowling') { const score = clamp(Math.round(10 * accuracy * Math.min(1, power * 1.65)), 0, 10); return { score, text: score === 10 ? 'All ten! A clean sweep.' : `${score} pins down!` }; }
  if (id === 'golf') { const distance = Math.round(Math.abs(power - 0.68) * 130 + Math.abs(aim - 0.15) * 22); return { score: Math.max(0, 30 - distance), text: distance < 4 ? 'Right by the cup!' : `${distance} m from the flag` }; }
  if (id === 'tennis') { const score = Math.round(contact * (0.6 + 0.4 * accuracy) * 10); return { score, text: score >= 8 ? 'A beautiful winner!' : score ? 'Rally returned!' : 'Late to the ball!' }; }
  if (id === 'boxing') { const score = Math.round(contact * accuracy * (0.5 + power / 2) * 10); return { score, text: score >= 8 ? 'Perfect pad strike!' : score ? 'Punch connected!' : 'The pad slipped away!' }; }
  if (id === 'baseball') { const score = clamp(Math.floor(contact * power * accuracy * 5), 0, 4); return { score, text: ['Strike!', 'Single!', 'Double!', 'Triple!', 'Home run!'][score] }; }
  throw new Error('Unknown sport');
}
export function nextTurn(players, turn, round, rounds = 3) {
  const next = turn + 1;
  return next < players.length ? { turn: next, round, finished: false } : { turn: 0, round: round + 1, finished: round >= rounds };
}
