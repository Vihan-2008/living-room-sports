// The channels' own screens: the Wii Sports selector, the Mario Kart Wii channel, and the screen shown
// while Dolphin is running a game.
import { sportIcon, drawChannel } from './menu-art.js';
import { h, fill, art, button, frame, segmented, status, steps } from './menu-ui.js';
import { SPORTS, sportById, editionOf, TITLE_NAMES, SUPPORT_TEXT, CONTROLLER_NAMES, MKW_MODES } from './catalog.js';
import { mkwRows } from './bindings.js';
import { PLAYER_COLORS } from './menu-input.js';

const PLAYER_KIND_NAMES = { dualsense: 'DualSense', phone: 'Phone', keyboard: 'Keyboard and mouse', wiimote: 'Real Wii Remote', off: 'Nobody' };

// What stops a title from starting, as one status line, or null when it can start.
function titleBlocker(state, title) {
  const dolphin = state.setup.find(s => s.id === 'dolphin');
  if (!dolphin.done) return dolphin;
  const step = state.setup.find(s => s.id === title);
  return step && !step.done ? step : null;
}

function requirement(label, needed) {
  return h('li', { class: `need ${needed ? 'is-needed' : ''}` }, h('span', { class: 'need-mark', 'aria-hidden': 'true' }), label, needed ? '' : h('span', { class: 'visually-hidden' }, ' (not needed)'));
}

function supportRows(state, support) {
  const kinds = [...new Set(state.settings.controls.players.filter(kind => kind !== 'off'))];
  if (!kinds.length) return h('p', { class: 'muted small' }, 'No players are set up. Choose controllers in Wii Options › Controllers.');
  return h('ul', { class: 'support' }, kinds.map(kind => h('li', { class: `support-${support[kind]}` },
    h('span', { class: 'support-dot', 'aria-hidden': 'true' }), h('span', { class: 'support-kind' }, CONTROLLER_NAMES[kind]), h('span', { class: 'support-level' }, SUPPORT_TEXT[support[kind]]))));
}

// ---- Wii Sports ---------------------------------------------------------------------------------
function sportsView(ctx) {
  const remembered = ctx.state.settings.menu;
  let sport = sportById(remembered.lastSport) || SPORTS[0];
  const editions = { ...remembered.editions };
  const tiles = new Map();
  const grid = h('div', { class: 'sport-grid', role: 'group', 'aria-label': 'Sports' }, SPORTS.map(item => {
    const tile = h('button', { type: 'button', class: 'sport', 'aria-pressed': 'false', dataset: { sport: item.id }, onClick: () => select(item) },
      art(sportIcon(item.art), 'sport-icon'), h('span', { class: 'sport-name' }, item.name),
      item.editions.length > 1 ? h('span', { class: 'sport-badge' }, '2 editions') : null);
    tiles.set(item.id, tile);
    return tile;
  }));
  const detail = h('div', { class: 'sport-detail panel' });
  const start = button('Start', () => launch(), { kind: 'primary', sound: 'start' });
  const el = frame({ title: 'Wii Sports', className: 'sports-screen', onBack: () => ctx.back(), body: h('div', { class: 'sports-layout' }, grid, detail), actions: [start] });

  const edition = () => editionOf(sport, editions[sport.id] || sport.editions[0].title);

  function select(item) {
    sport = item;
    ctx.save({ menu: { lastSport: item.id } });
    render();
  }

  function render() {
    const state = ctx.state;
    for (const [id, tile] of tiles) {
      tile.setAttribute('aria-pressed', String(id === sport.id));
      const available = sportById(id).editions.some(e => state.library.titles[e.title]?.ready);
      tile.classList.toggle('is-unavailable', !available);
    }
    const current = edition();
    const blocker = titleBlocker(state, current.title);
    const switcher = sport.editions.length > 1 ? segmented(sport.editions.map(e => ({ value: e.title, label: e.label === 'Original' ? 'Wii Sports' : 'Wii Sports Resort' })), current.title, value => {
      editions[sport.id] = value;
      ctx.save({ menu: { editions: { [sport.id]: value } } });
      render();
    }, { label: 'Edition', className: 'edition-switch' }) : null;
    fill(detail, 
      h('div', { class: 'detail-head' }, art(sportIcon(sport.art), 'detail-icon'), h('div', {},
        h('h2', {}, sport.name), h('p', { class: 'muted' }, `${TITLE_NAMES[current.title]}, ${current.players} players`))),
      switcher,
      h('div', { class: 'detail-scroll scroll' },
        blocker ? status(blocker) : null,
        h('h3', {}, 'Modes'), h('p', { class: 'small' }, current.modes.join('; ')),
        h('h3', {}, 'Needs'), h('ul', { class: 'needs' }, requirement('Wii Remote', true), requirement('Nunchuk', current.requires.nunchuk), requirement('MotionPlus', current.requires.motionPlus)),
        h('h3', {}, 'Your controllers'), supportRows(state, current.support),
        current.note ? h('p', { class: 'note small' }, current.note) : null,
        h('h3', {}, 'After it starts'), steps(current.path)));
    start.querySelector('.wbtn-label').textContent = blocker ? 'Set up' : `Start ${TITLE_NAMES[current.title]}`;
    start.dataset.sound = blocker ? 'select' : 'start';
  }

  async function launch() {
    const current = edition();
    if (titleBlocker(ctx.state, current.title)) return ctx.go('setup');
    await ctx.save({ menu: { lastSport: sport.id, editions } });
    await ctx.launch(current.title, sport.id);
  }

  return {
    el,
    update: render,
    focus: () => ctx.input.focusFirst(`.sport[data-sport="${sport.id}"]`),
    page: direction => { const i = SPORTS.indexOf(sport); select(SPORTS[(i + direction + SPORTS.length) % SPORTS.length]); }
  };
}

// ---- Mario Kart Wii -----------------------------------------------------------------------------
function mkwView(ctx) {
  let mode = MKW_MODES.find(m => m.id === ctx.state.settings.menu.lastMode && !m.unavailable) || MKW_MODES[0];
  let tab = 'start';
  const modeButtons = MKW_MODES.map(item => h('button', { type: 'button', class: 'mode', 'aria-pressed': 'false', dataset: { mode: item.id },
    onClick: () => { mode = item; if (!item.unavailable) ctx.save({ menu: { lastMode: item.id } }); render(); } },
  h('span', { class: 'mode-name' }, item.name), h('span', { class: 'mode-players' }, item.unavailable ? 'Unavailable' : `${item.players} ${item.players === '1' ? 'player' : 'players'}`)));
  const tabs = segmented([{ value: 'start', label: 'How to start' }, { value: 'controls', label: 'Controls' }, { value: 'players', label: 'Players' }], tab, value => { tab = value; render(); }, { label: 'Show', className: 'tabs' });
  const body = h('div', { class: 'mkw-body scroll' });
  const start = button('Start Mario Kart Wii', () => launch(), { kind: 'primary', sound: 'start' });
  const el = frame({ title: 'Mario Kart Wii', className: 'mkw-screen', onBack: () => ctx.back(),
    body: h('div', { class: 'mkw-layout' }, h('div', { class: 'modes', role: 'group', 'aria-label': 'Modes' }, modeButtons), h('div', { class: 'mkw-panel panel' }, tabs, body)),
    actions: [start] });

  function controlsTable() {
    const rows = mkwRows();
    return h('table', { class: 'bindings' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'DualSense'), h('th', {}, 'Keyboard'), h('th', {}, 'Phone (Wii Wheel)'))),
      h('tbody', {}, rows.map(row => h('tr', {}, h('th', {}, row.action), h('td', {}, row.dualsense), h('td', {}, row.keyboard), h('td', {}, row.phone)))));
  }

  function playersList() {
    const players = ctx.state.settings.controls.players;
    return h('div', {},
      h('ul', { class: 'roles' }, players.map((kind, i) => {
        const phone = ctx.roster[i];
        const as = kind === 'phone' ? (phone?.connected ? `${phone.name}'s phone, held sideways like a Wii Wheel` : 'A phone, held sideways like a Wii Wheel (not connected yet)')
          : kind === 'dualsense' || kind === 'keyboard' ? `${PLAYER_KIND_NAMES[kind]}, as a GameCube controller` : kind === 'wiimote' ? 'Real Wii Remote, paired in Dolphin' : 'Nobody';
        return h('li', {}, h('span', { class: 'role-player', style: { background: PLAYER_COLORS[i] } }, `P${i + 1}`), h('span', {}, as));
      })),
      h('div', { class: 'row-actions' }, button('Change controllers', () => ctx.go('controllers'), { kind: 'small' })));
  }

  function render() {
    const state = ctx.state;
    modeButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode.id)));
    const blocker = titleBlocker(state, 'mkw');
    if (tab === 'start') fill(body, 
      blocker ? status(blocker) : null,
      h('h2', {}, mode.name), h('p', { class: mode.unavailable ? 'note' : 'muted' }, mode.detail),
      mode.path.length ? h('h3', {}, 'After it starts') : null, mode.path.length ? steps(mode.path) : null);
    else if (tab === 'controls') fill(body, controlsTable(), h('p', { class: 'small muted' }, 'A DualSense or the keyboard plays as a GameCube controller, which Mario Kart Wii supports natively. A phone is a Wii Remote held sideways: tilt it to steer.'));
    else fill(body, playersList());
    start.disabled = !!mode.unavailable;
    start.querySelector('.wbtn-label').textContent = blocker ? 'Set up' : 'Start Mario Kart Wii';
    start.dataset.sound = blocker ? 'select' : 'start';
  }

  async function launch() {
    if (titleBlocker(ctx.state, 'mkw')) return ctx.go('setup');
    await ctx.launch('mkw', null);
  }

  return {
    el,
    update: render,
    focus: () => ctx.input.focusFirst(`.mode[data-mode="${mode.id}"]`),
    page: direction => { tabs.querySelectorAll('button')[(['start', 'controls', 'players'].indexOf(tab) + direction + 3) % 3].click(); }
  };
}

// ---- While a game runs --------------------------------------------------------------------------
function playingView(ctx) {
  const canvas = h('canvas', { class: 'playing-art' });
  const info = h('div', { class: 'playing-info' });
  const close = button('Close the game', () => confirmClose(), { sound: 'select' });
  const move = button('Move to the other screen', () => ctx.attempt(() => ctx.api('/api/screen', { to: 'next' })), { sound: 'select' });
  const el = frame({ title: 'Now playing', className: 'playing-screen', onBack: () => confirmClose(), backLabel: 'Close the game',
    body: h('div', { class: 'playing-layout' }, h('div', { class: 'playing-banner' }, canvas), info), actions: [move] });
  el.querySelector('.frame-foot .back').remove();
  el.querySelector('.frame-foot').prepend(close);
  let raf = 0;

  async function confirmClose() {
    const choice = await ctx.dialog({ text: 'Close the game?', detail: 'Anything since your last save in the game will be lost. Dolphin is asked to close normally first.',
      buttons: [{ label: 'Close the game', value: true, kind: 'primary' }, { label: 'Keep playing', value: false, cancel: true, sound: 'back' }] });
    if (choice) await ctx.attempt(() => ctx.api('/api/stop', {}));
  }

  // The last title shown, so the banner stays put while the screen fades out after the game ends.
  let shown = 'sports';
  function render(state) {
    const { title, sport, roles, stopping } = state.dolphin;
    if (!title) return;
    shown = title === 'mkw' ? 'mkw' : 'sports';
    const item = sport ? sportById(sport) : null;
    const edition = item ? editionOf(item, title) : null;
    const mode = title === 'mkw' ? MKW_MODES.find(m => m.id === state.settings.menu.lastMode) : null;
    const path = edition?.path || mode?.path || [];
    fill(info, 
      h('h2', {}, item ? `${item.name}` : TITLE_NAMES[title]),
      h('p', { class: 'muted' }, item ? TITLE_NAMES[title] : mode ? mode.name : ''),
      h('p', { class: 'small' }, stopping ? 'Closing Dolphin…' : 'Dolphin has the game in its own window. This screen comes back when the game closes.'),
      path.length ? h('h3', {}, 'In the game') : null, path.length ? steps(path) : null,
      h('h3', {}, 'Quitting'),
      h('p', { class: 'small' }, 'Press Home in the game and choose Wii Menu, press Esc on the keyboard, or choose Quit the game in a phone\'s ⋯ menu.'),
      roles?.length ? h('h3', {}, 'Controllers') : null,
      roles?.length ? h('ul', { class: 'roles' }, roles.filter(r => r.kind !== 'off').map(r => h('li', {}, h('span', { class: 'role-player', style: { background: PLAYER_COLORS[r.slot - 1] } }, `P${r.slot}`), h('span', {}, `${PLAYER_KIND_NAMES[r.kind]}: ${r.as}`)))) : null);
    close.disabled = !!stopping;
    const screens = state.screens?.length || 0;
    move.hidden = screens < 2 || !!stopping;
    move.querySelector('.wbtn-label').textContent = screens > 2 ? 'Move to the next screen' : 'Move to the other screen';
  }

  const tick = now => { drawChannel(canvas, shown, now / 1000, true, ctx.scale); raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);

  return { el, update: render, dispose: () => cancelAnimationFrame(raf), back: () => { confirmClose(); return true; } };
}

export const channelViews = { sports: sportsView, mkw: mkwView, playing: playingView };
