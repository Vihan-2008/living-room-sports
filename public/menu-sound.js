// Menu sounds, synthesised with Web Audio so nothing is downloaded or copied.
let ctx = null, master = null, enabled = true, volume = 0.6, lastHover = 0;

function audio() {
  if (!enabled) return null;
  if (!ctx) {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return null;
    ctx = new Context();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, at, length, { type = 'sine', gain = 0.18, attack = 0.005, to = null } = {}) {
  const osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + length);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(amp).connect(master);
  osc.start(at); osc.stop(at + length + 0.02);
}

function whoosh(at, length, from, to, gain = 0.08) {
  const frames = Math.round(ctx.sampleRate * length);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass'; filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(to, at + length);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + length * 0.35);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(filter).connect(amp).connect(master);
  source.start(at); source.stop(at + length + 0.02);
}

const SOUNDS = {
  // A soft, high tick as the pointer reaches something it can press.
  hover: t => { tone(2350, t, 0.045, { gain: 0.05, attack: 0.002 }); tone(1180, t, 0.03, { gain: 0.03, attack: 0.002 }); },
  select: t => { tone(988, t, 0.09, { gain: 0.12 }); tone(1480, t + 0.06, 0.16, { gain: 0.12 }); },
  back: t => { tone(1175, t, 0.08, { gain: 0.1 }); tone(784, t + 0.06, 0.15, { gain: 0.1 }); },
  page: t => whoosh(t, 0.32, 600, 2600, 0.07),
  open: t => { whoosh(t, 0.42, 300, 1800, 0.06); [523, 659, 784, 1047].forEach((f, i) => tone(f, t + 0.05 + i * 0.045, 0.5 - i * 0.05, { gain: 0.06, type: 'triangle' })); },
  close: t => whoosh(t, 0.3, 2200, 500, 0.06),
  start: t => [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.07, 0.3, { gain: 0.1, type: 'triangle' })),
  error: t => { tone(392, t, 0.16, { gain: 0.11, type: 'triangle' }); tone(311, t + 0.13, 0.26, { gain: 0.11, type: 'triangle' }); },
  connect: t => [659, 880, 1319].forEach((f, i) => tone(f, t + i * 0.06, 0.18, { gain: 0.08 })),
  disconnect: t => [1319, 880].forEach((f, i) => tone(f, t + i * 0.08, 0.2, { gain: 0.08 }))
};

export function play(name) {
  const now = performance.now();
  if (name === 'hover') { if (now - lastHover < 45) return; lastHover = now; }
  const context = audio();
  if (!context || !SOUNDS[name]) return;
  try { SOUNDS[name](context.currentTime + 0.005); } catch { /* audio is a nicety; never let it break input */ }
}

export function configure(options = {}) {
  if (typeof options.enabled === 'boolean') enabled = options.enabled;
  if (Number.isFinite(options.volume)) volume = Math.max(0, Math.min(1, options.volume));
  if (master) master.gain.value = enabled ? volume : 0;
}

// Browsers start audio only after a gesture; the first key, click or button press unlocks it.
export function unlock() { audio(); }
