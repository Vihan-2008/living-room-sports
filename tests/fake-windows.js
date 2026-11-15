// A pretend Windows for the screen helper in console/screens.js: it answers in the helper's own output format, so
// tests run the real parsing. The screens are the PC this was built on: a 1920 × 1080 main screen, and a
// 2560 × 1600 screen at 200% scaling to its right and a little higher.
export const MAIN = '\\\\.\\DISPLAY2', SECOND = '\\\\.\\DISPLAY1';
export const THIS_PC = [
  `screen\t${SECOND}\t0\t1920,-212,2560,1600\t1920,-212,2560,1552\t192`,
  `screen\t${MAIN}\t1\t0,0,1920,1080\t0,0,1920,1032\t96`
].join('\r\n');
export const MAIN_ONLY = `screen\t${MAIN}\t1\t0,0,1920,1080\t0,0,1920,1032\t96`;

// window: Dolphin's game window as it first opens (small, on the main screen, with a title bar), or null before it
// has opened. framed: false is Dolphin's full screen, which has no title bar.
// refuse: how many moves leave the window where it was, as when Dolphin goes full screen on the screen it opened on
// just after being moved.
// race: how many moves land while Dolphin is going full screen: the window loses its title bar but keeps the size
// it was being moved at.
export function fakeWindows({ screens = THIS_PC, window = { x: 632, y: 269, width: 656, height: 519 }, refuse = 0, race = 0 } = {}) {
  const calls = [];
  const open = next => next && { handle: '2428142', framed: true, ...next };
  let current = open(window);
  const screenOf = w => (w.x >= 1920 ? SECOND : MAIN);
  const place = w => [w.x, w.y, w.width, w.height].join(',');
  async function run(env) {
    calls.push(env);
    const out = [screens];
    if (env.LRS_DO === 'window' && current) out.push(`window\t${current.handle}\t${place(current)}\t${screenOf(current)}\t${current.framed ? 1 : 0}`);
    if (env.LRS_DO === 'move') {
      const [x, y, width, height] = env.LRS_RECT.split(',').map(Number);
      if (refuse > 0) refuse--;
      else if (race > 0) { race--; current = { ...current, x, y, width, height, framed: false }; }
      else current = { ...current, x, y, width, height };
      out.push(`moved\t${place(current)}\t${screenOf(current)}\t${current.framed ? 1 : 0}`);
    }
    return out.join('\r\n');
  }
  return {
    run, calls,
    get moves() { return calls.filter(c => c.LRS_DO === 'move').map(c => c.LRS_RECT); },
    get window() { return current; },
    set window(next) { current = open(next); }
  };
}

export async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
