// Wii Options: setup, controllers, phones, screen and sound, and how Dolphin is started.
import { h, fill, button, frame, segmented, onOff, slider, status, setting, keepFocus, isFullscreen } from './menu-ui.js';
import { PLAYER_COLORS } from './menu-input.js';

const PLAYER_CHOICES = [
  { value: 'dualsense', label: 'DualSense' }, { value: 'phone', label: 'Phone' }, { value: 'keyboard', label: 'Keyboard' },
  { value: 'wiimote', label: 'Wii Remote' }, { value: 'off', label: 'Off' }
];
// Standard Gamepad API button order, named as they are printed on a DualSense.
export const PAD_BUTTONS = ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right', 'PS', 'Touchpad'];
const MENU_ACTIONS = [
  { key: 'select', name: 'Select (A)' }, { key: 'back', name: 'Back (B)' }, { key: 'home', name: 'Wii Menu (Home)' },
  { key: 'options', name: 'Wii Options' }, { key: 'pageLeft', name: 'Previous page' }, { key: 'pageRight', name: 'Next page' }
];
const DEFAULT_MENU_BUTTONS = { select: 0, back: 1, home: 16, options: 9, pageLeft: 4, pageRight: 5 };
const MOTION_TEXT = {
  active: 'Motion on', waiting: 'Waiting for motion permission', denied: 'Motion permission turned down',
  insecure: 'Buttons only: this phone has not trusted the PC yet', unavailable: 'This phone has no motion sensors'
};
const percent = v => `${Math.round(v * 100)}%`;

function panel(title, ...children) { return h('section', { class: 'panel' }, title ? h('h2', {}, title) : null, children); }
function pathText(path) { return h('p', { class: 'path-text' }, path); }
// What a person types into a phone's browser: no scheme and no room code.
const shortAddress = url => url.replace(/^https?:\/\//, '').replace(/\?code=.*/, '');

// ---- Wii Options hub ----------------------------------------------------------------------------
function optionsView(ctx) {
  const items = [
    { id: 'setup', name: 'Setup', detail: s => { const left = s.setup.filter(x => !x.done).length; return left ? `${left} ${left === 1 ? 'thing' : 'things'} left to set up` : 'Dolphin and all three games are ready'; } },
    { id: 'controllers', name: 'Controllers', detail: () => 'Who plays with what, a test screen, menu buttons and dead zones' },
    { id: 'phones', name: 'Phones', detail: s => { const n = ctx.roster.filter(p => p.connected).length; return n ? `${n} connected` : 'Scan the code with a phone to join'; } },
    { id: 'display', name: 'Screen and sound', detail: s => `${s.settings.display.aspect === 'auto' ? 'Automatic' : s.settings.display.aspect} picture, sounds ${s.settings.display.sounds ? 'on' : 'off'}` },
    { id: 'dolphin', name: 'Dolphin', detail: s => (s.dolphin.found ? `Dolphin ${s.dolphin.version || ''}, games start ${s.settings.launch.fullscreen ? 'full screen' : 'in a window'}`.replace('  ', ' ') : 'Not set up yet') }
  ];
  const buttons = items.map((item, i) => h('button', { type: 'button', class: 'option', dataset: { option: item.id, ...(i === 0 ? { default: '' } : {}) }, onClick: () => ctx.go(item.id) },
    h('span', { class: 'option-name' }, item.name), h('span', { class: 'option-detail' }, '')));
  const el = frame({ title: 'Wii Options', className: 'options-screen', onBack: () => ctx.back(), backLabel: 'Wii Menu', body: h('div', { class: 'option-grid' }, buttons) });
  function update(state) {
    items.forEach((item, i) => { buttons[i].querySelector('.option-detail').textContent = item.detail(state); });
    buttons[0].classList.toggle('needs-attention', state.setup.some(x => !x.done));
  }
  return { el, update };
}

// ---- Setup panels (shared by the wizard and the single screens) ---------------------------------
function dolphinPanel(ctx) {
  const root = h('div', { class: 'stack' });
  const pathInput = h('input', { type: 'text', placeholder: 'C:\\Dolphin-x64\\Dolphin.exe', 'aria-label': 'Path to Dolphin.exe', spellcheck: 'false' });
  const render = state => keepFocus(root, () => {
    const step = state.setup.find(s => s.id === 'dolphin');
    const d = state.dolphin;
    fill(root, 
      status(step),
      d.found ? h('dl', { class: 'facts' },
        h('dt', {}, 'Dolphin.exe'), h('dd', {}, pathText(d.path)),
        h('dt', {}, 'Settings and saves'), h('dd', {}, pathText(d.userDir || 'Unknown'), h('p', { class: 'small muted' }, `Found through ${d.userDirReason}. This app never moves or deletes anything there.`))) : null,
      h('div', { class: 'row-actions' },
        button('Choose Dolphin.exe', () => ctx.attempt(() => ctx.api('/api/pick', { kind: 'dolphin' })), { kind: d.found ? '' : 'primary', isDefault: true }),
        button('Find automatically', () => ctx.attempt(() => ctx.api('/api/dolphin/detect', {})))),
      h('div', { class: 'paste-row' }, pathInput, button('Use this path', () => ctx.attempt(async () => { await ctx.api('/api/dolphin/path', { path: pathInput.value }); pathInput.value = ''; }), { kind: 'small' })),
      d.found ? null : h('p', { class: 'small muted' }, 'Dolphin is not included with this app. Download it from dolphin-emu.org, unzip it anywhere, then choose Dolphin.exe here.'));
  });
  return { el: root, update: render };
}

function gamesPanel(ctx) {
  const root = h('div', { class: 'stack' });
  const pathInput = h('input', { type: 'text', placeholder: 'D:\\Games\\Wii', 'aria-label': 'Folder or game file to add', spellcheck: 'false' });
  const addTyped = () => ctx.attempt(async () => { await ctx.api('/api/library/add', { path: pathInput.value }); pathInput.value = ''; });
  const render = state => keepFocus(root, () => {
    const { library } = state;
    const sources = [...library.folders.map(path => ({ path, folder: true })), ...library.files.map(path => ({ path, folder: false }))];
    const recognised = Object.entries(library.titles).map(([key, entry]) => {
      const disc = entry.disc;
      const copies = library.discs.filter(d => d.kind === key || (d.kind === 'pack' && key !== 'mkw'));
      return h('li', { class: 'title-row' },
        status(disc ? { done: true, message: entry.name } : state.setup.find(s => s.id === key)),
        disc ? h('p', { class: 'small muted title-facts' }, `${disc.name}: ${disc.id}, ${disc.region}, ${disc.format.toUpperCase()}`) : null,
        copies.length > 1 ? h('div', { class: 'copies' }, h('span', { class: 'small muted' }, 'Use:'), segmented(copies.map(c => ({ value: c.path, label: c.name })), disc?.path,
          path => ctx.attempt(() => ctx.api('/api/titles', { title: key, path })), { label: `Copy of ${entry.name}`, className: 'seg-wrap' })) : null);
    });
    const others = library.discs.filter(d => !d.kind && !d.error);
    const broken = library.discs.filter(d => d.error);
    fill(root,
      h('ul', { class: 'titles' }, recognised),
      others.length ? h('p', { class: 'small muted' }, `${others.length} other ${others.length === 1 ? 'game was' : 'games were'} found too. Only these three have channels.`) : null,
      broken.length ? h('p', { class: 'small note' }, `${broken.length} ${broken.length === 1 ? 'file' : 'files'} could not be read: ${broken.slice(0, 3).map(d => d.name).join(', ')}${broken.length > 3 ? '…' : ''}`) : null,
      h('div', { class: 'row-actions' },
        button('Add a folder', () => ctx.attempt(() => ctx.api('/api/pick', { kind: 'folder' })), { kind: library.discs.length ? '' : 'primary', isDefault: true }),
        button('Add a game file', () => ctx.attempt(() => ctx.api('/api/pick', { kind: 'games' }))),
        button(library.scanning ? 'Scanning…' : 'Scan again', () => ctx.attempt(() => ctx.api('/api/library/scan', {})), { disabled: library.scanning })),
      h('div', { class: 'paste-row' }, pathInput, button('Add this path', addTyped, { kind: 'small' })),
      sources.length ? h('ul', { class: 'sources' }, sources.map(source => h('li', {},
        h('span', { class: 'source-kind' }, source.folder ? 'Folder' : 'File'), pathText(source.path),
        button('Remove', () => ctx.attempt(() => ctx.api('/api/library/remove', { path: source.path })), { kind: 'small', sound: 'back' }))))
        : h('p', { class: 'muted' }, 'No folders yet. Add the folder that holds your Wii games (.iso, .wbfs, .rvz, .wia, .gcz or .ciso).'));
  });
  return { el: root, update: render };
}

function playersPanel(ctx) {
  const root = h('div', { class: 'stack' });
  const render = state => keepFocus(root, () => {
    const { players, keyboardP1 } = state.settings.controls;
    fill(root, 
      h('ul', { class: 'player-rows' }, players.map((kind, i) => h('li', {},
        h('span', { class: 'role-player', style: { background: PLAYER_COLORS[i] } }, `P${i + 1}`),
        segmented(PLAYER_CHOICES, kind, value => { const next = [...ctx.state.settings.controls.players]; next[i] = value; ctx.save({ controls: { players: next } }); }, { label: `Player ${i + 1} controller` })))),
      setting('Keyboard and mouse also control Player 1', onOff(keyboardP1, value => ctx.save({ controls: { keyboardP1: value } }), 'Keyboard for Player 1'),
        'Handy as a backup: the keyboard works alongside Player 1\'s DualSense or phone.'),
      h('p', { class: 'small muted' }, 'Real Wii Remotes pair with Dolphin itself (Dolphin › Controllers › Real Wii Remote). Choose Wii Remote here and this app leaves that player to Dolphin.'));
  });
  return { el: root, update: render };
}

function joinPanel(ctx) {
  const root = h('div', { class: 'join' });
  let config = null, loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    try { config = await (await fetch('/config')).json(); } catch { config = null; }
    loading = false;
    render(ctx.state);
  }
  const render = state => keepFocus(root, () => {
    if (!config) { fill(root, h('p', { class: 'muted' }, 'Getting this PC\'s address…')); return; }
    const address = config.addresses[0];
    const players = state.settings.controls.players;
    const padConnected = !!ctx.input.activePad();
    fill(root, 
      h('div', { class: 'join-code' },
        address ? h('img', { class: 'qr', src: `/qr?url=${encodeURIComponent(address)}`, alt: 'Code to scan with a phone' }) : h('div', { class: 'qr qr-missing' }, 'No network'),
        address ? h('p', { class: 'join-address' }, shortAddress(address)) : h('p', { class: 'note small' }, 'This PC is not on a network. Connect it to the same Wi-Fi as the phones.'),
        h('p', { class: 'small muted' }, `Room code ${config.code}`),
        config.addresses.length > 1 ? h('p', { class: 'small muted' }, `If that does not open, try ${config.addresses.slice(1, 3).map(shortAddress).join(' or ')}`) : null),
      h('div', { class: 'join-side' },
        h('ul', { class: 'slots' }, [0, 1, 2, 3].map(i => {
          const phone = ctx.roster[i], kind = players[i];
          let text, detail = null, actions = [];
          if (phone?.connected) {
            text = phone.name;
            detail = phone.motion ? MOTION_TEXT[phone.motion] : 'Connected';
            actions = [button('Identify', () => ctx.send({ type: 'rumble', slot: i + 1, duration: 250 }), { kind: 'small' }),
              button('Remove', () => ctx.send({ type: 'kick', slot: i + 1 }), { kind: 'small', sound: 'back' })];
          } else if (phone?.waiting) { text = 'Keeping this place for a phone that dropped'; detail = 'It has a minute to come back.'; }
          else if (kind === 'dualsense') { text = 'DualSense'; detail = padConnected ? 'Connected' : 'Not connected: turn it on or plug it in'; }
          else if (kind === 'keyboard') { text = 'Keyboard and mouse'; }
          else if (kind === 'wiimote') { text = 'Real Wii Remote'; detail = 'Paired in Dolphin'; }
          else if (kind === 'off') { text = 'Off'; }
          else { text = 'Free for a phone'; }
          return h('li', { class: phone?.connected ? 'is-connected' : '' }, h('span', { class: 'role-player', style: { background: PLAYER_COLORS[i] } }, `P${i + 1}`),
            h('div', { class: 'slot-text' }, h('p', {}, text), detail ? h('p', { class: 'small muted' }, detail) : null), h('div', { class: 'slot-actions' }, actions));
        })),
        setting('New phones can join', onOff(config.joining && state.settings.phones.joining, value => { ctx.send({ type: 'joining', open: value }); config.joining = value; }, 'Joining')),
        state.https.ready ? h('p', { class: 'small muted' }, 'For motion controls, each phone trusts this PC once; the phone shows how the first time it joins.')
          : h('p', { class: 'small note' }, state.https.error || 'Motion controls are starting…')));
  });
  load();
  return { el: root, update: render };
}

// ---- Setup wizard -------------------------------------------------------------------------------
// The wizard's controller check. Buttons keep working the menu here, unlike on the full test screen.
function testStep(ctx) {
  const test = testPanel(ctx);
  const el = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Press buttons and move the sticks; each controller lights up below. Cross and Circle still work the menu on this step.'),
    test.el);
  return { el, update: test.update, dispose: test.dispose };
}

function setupView(ctx, { firstRun = false } = {}) {
  // Steps with make() subscribe to live input, so they exist only while they are on screen.
  const steps = [
    { name: 'Dolphin', panel: dolphinPanel(ctx) }, { name: 'Games', panel: gamesPanel(ctx) },
    { name: 'Players', panel: playersPanel(ctx) }, { name: 'Phones', panel: joinPanel(ctx) },
    { name: 'Test', make: () => testStep(ctx) }, { name: 'Ready' }
  ];
  const last = steps.length - 1;
  let step = 0;
  const progress = h('ol', { class: 'progress' }, steps.map(s => h('li', {}, s.name)));
  const content = h('div', { class: 'setup-content scroll' });
  const next = button('Next', () => go(1), { kind: 'primary' });
  const el = frame({ title: firstRun ? 'Welcome. Let\'s set up the console' : 'Setup', className: 'setup-screen', onBack: () => back(), body: h('div', { class: 'setup-layout' }, progress, content), actions: [next] });
  const backLabel = el.querySelector('.frame-foot .back .wbtn-label');

  function summary(state) {
    const players = state.settings.controls.players;
    return h('div', { class: 'stack' }, state.setup.map(s => status(s)),
      h('ul', { class: 'ready-players' }, players.map((kind, i) => h('li', {},
        h('span', { class: 'role-player', style: { background: PLAYER_COLORS[i] } }, `P${i + 1}`), PLAYER_CHOICES.find(c => c.value === kind)?.label || kind))),
      h('p', { class: 'muted' }, state.setup.every(s => s.done) ? 'Everything is ready. Pick a channel on the Wii Menu and press Start.' : 'You can finish the rest later from Wii Options › Setup. Channels that are not ready say what they still need.'));
  }

  function render(state) {
    [...progress.children].forEach((li, i) => { li.className = i === step ? 'is-current' : i < step ? 'is-past' : ''; });
    const current = steps[step];
    if (current.make && !current.panel) current.panel = current.make();
    if (current.panel) { current.panel.update(state); if (content.firstChild !== current.panel.el) fill(content, current.panel.el); }
    else fill(content, summary(state));
    next.querySelector('.wbtn-label').textContent = step === last ? 'Go to the Wii Menu' : 'Next';
    backLabel.textContent = step === 0 ? (firstRun ? 'Later' : 'Back') : 'Previous';
  }

  function leaveStep() {
    const current = steps[step];
    if (current.make) { current.panel?.dispose?.(); current.panel = null; }
  }
  function finish() { ctx.save({ setupSeen: true }); ctx.home(); }
  function go(delta) {
    if (step + delta > last) return finish();
    if (step + delta < 0) return;
    leaveStep();
    step += delta;
    fill(content);
    render(ctx.state);
    ctx.input.reset();
    ctx.input.focusFirst();
    content.scrollTop = 0;
  }
  function back() {
    if (step === 0) { ctx.save({ setupSeen: true }); ctx.back(); return; }
    ctx.play('back');
    go(-1);
  }

  return { el, update: render, dispose: leaveStep, back: () => { back(); return true; }, page: direction => go(direction) };
}

// ---- Controllers --------------------------------------------------------------------------------
function stickView() {
  const dot = h('span', { class: 'stick-dot' }), ring = h('span', { class: 'stick-zone' });
  const el = h('div', { class: 'stick' }, ring, dot);
  return { el, set(x, y, deadzone) { dot.style.transform = `translate(${x * 40}px, ${y * 40}px)`; ring.style.width = ring.style.height = `${deadzone * 92}px`; } };
}

function testPanel(ctx) {
  const root = h('div', { class: 'test-grid' });
  const padCard = h('section', { class: 'panel test-card' });
  const phoneCard = h('section', { class: 'panel test-card' });
  const keyCard = h('section', { class: 'panel test-card' });
  root.append(padCard, phoneCard, keyCard);
  const left = stickView(), right = stickView();
  const lights = new Map(PAD_BUTTONS.map(name => [name, h('span', { class: 'light' }, name)]));
  const triggers = [h('span', { class: 'bar-fill' }), h('span', { class: 'bar-fill' })];
  const padStatus = h('p', { class: 'small muted' });
  padCard.append(h('h2', {}, 'DualSense'), padStatus, h('div', { class: 'sticks' }, left.el, right.el),
    h('div', { class: 'bars' }, ['L2', 'R2'].map((name, i) => h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, name), h('span', { class: 'bar-track' }, triggers[i])))),
    h('div', { class: 'lights' }, [...lights.values()]));
  const phoneBody = h('div', { class: 'phone-tests' });
  phoneCard.append(h('h2', {}, 'Phones'), phoneBody);
  const keys = h('div', { class: 'lights keys' });
  keyCard.append(h('h2', {}, 'Keyboard and mouse'), h('p', { class: 'small muted' }, 'Keys you press light up here.'), keys);

  const phones = new Map();
  function phoneRow(slot) {
    let row = phones.get(slot);
    if (row) return row;
    const stick = stickView();
    const buttons = h('div', { class: 'lights' });
    const motion = ['Tilt', 'Turn'].map(label => h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, label), h('span', { class: 'bar-track center' }, h('span', { class: 'bar-fill' }))));
    row = { el: h('div', { class: 'phone-test' }, h('p', { class: 'phone-test-name' }), h('div', { class: 'phone-test-body' }, stick.el, h('div', {}, motion, buttons))), stick, buttons, motion };
    phones.set(slot, row);
    return row;
  }
  function renderPhones() {
    const connected = ctx.roster.filter(p => p.connected);
    if (!connected.length) { fill(phoneBody, h('p', { class: 'small muted' }, 'No phones are connected. Open Phones to join one.')); return; }
    fill(phoneBody, ...connected.map(p => {
      const row = phoneRow(p.slot);
      fill(row.el.querySelector('.phone-test-name'), h('span', { class: 'role-player', style: { background: PLAYER_COLORS[p.slot - 1] } }, `P${p.slot}`), ` ${p.name}`, h('span', { class: 'small muted' }, `  ${p.motion ? MOTION_TEXT[p.motion] : ''}`));
      return row.el;
    }));
  }
  const offPhone = ctx.onPhonePad(msg => {
    const row = phones.get(msg.slot);
    if (!row) return;
    const [sx, sy] = msg.s || [0, 0];
    row.stick.set(sx, -sy, 0);
    const g = msg.g || [0, 0, 0];
    row.motion.forEach((bar, i) => { const v = Math.max(-1, Math.min(1, (i === 0 ? g[0] : g[1]) / 360)); const fill = bar.querySelector('.bar-fill'); fill.style.left = `${50 + Math.min(0, v) * 50}%`; fill.style.width = `${Math.abs(v) * 50}%`; });
    fill(row.buttons, ...(msg.b || []).map(name => h('span', { class: 'light on' }, name)));
  });
  const offPad = ctx.input.onPad(pad => {
    const deadzone = ctx.state.settings.controls.dashboard.deadzone;
    left.set(pad.axes[0] || 0, pad.axes[1] || 0, deadzone);
    right.set(pad.axes[2] || 0, pad.axes[3] || 0, deadzone);
    PAD_BUTTONS.forEach((name, i) => lights.get(name).classList.toggle('on', !!pad.buttons[i]?.pressed));
    triggers[0].style.width = `${(pad.buttons[6]?.value || 0) * 100}%`;
    triggers[1].style.width = `${(pad.buttons[7]?.value || 0) * 100}%`;
  });
  const pressedKeys = new Set();
  const keyName = e => (e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const onKey = e => { if (e.type === 'keydown') pressedKeys.add(keyName(e)); else pressedKeys.delete(keyName(e)); fill(keys, ...[...pressedKeys].map(k => h('span', { class: 'light on' }, k))); };
  const onMouse = e => { const name = ['Left click', 'Middle click', 'Right click'][e.button]; if (!name) return; if (e.type === 'mousedown') pressedKeys.add(name); else pressedKeys.delete(name); fill(keys, ...[...pressedKeys].map(k => h('span', { class: 'light on' }, k))); };
  addEventListener('keydown', onKey); addEventListener('keyup', onKey); addEventListener('mousedown', onMouse); addEventListener('mouseup', onMouse);

  function update() {
    const pad = ctx.input.activePad();
    padStatus.textContent = pad ? 'Move the sticks and press buttons. The ring is the menu dead zone.' : 'No DualSense found. Connect it by USB or Bluetooth, then press any button on it.';
    renderPhones();
  }
  return {
    el: root, update,
    dispose() { offPhone(); offPad(); removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('mousedown', onMouse); removeEventListener('mouseup', onMouse); }
  };
}

function menuButtonsPanel(ctx) {
  const root = h('div', { class: 'stack' });
  let waiting = null, stopCapture = null;
  const render = state => keepFocus(root, () => {
    const map = state.settings.controls.dashboard.buttons;
    fill(root, 
      h('p', { class: 'small muted' }, 'The DualSense buttons that work the Wii Menu. Games use their own layout, shown on each channel.'),
      h('div', {}, MENU_ACTIONS.map(action => setting(action.name, h('div', { class: 'remap' },
        h('span', { class: `remap-current ${waiting === action.key ? 'is-waiting' : ''}` }, waiting === action.key ? 'Press a button…' : PAD_BUTTONS[map[action.key]] || `Button ${map[action.key]}`),
        button('Change', () => capture(action.key), { kind: 'small' }))))),
      h('div', { class: 'row-actions' }, button('Restore the usual buttons', () => ctx.save({ controls: { dashboard: { buttons: DEFAULT_MENU_BUTTONS } } }), { kind: 'small' })));
  });
  function capture(key) {
    if (!ctx.input.activePad()) { ctx.toast('Connect the DualSense first, then press Change again.'); return; }
    waiting = key;
    render(ctx.state);
    stopCapture?.();
    stopCapture = ctx.input.captureButton(index => {
      waiting = null;
      const map = { ...ctx.state.settings.controls.dashboard.buttons };
      const clash = Object.keys(map).find(k => k !== key && map[k] === index);
      if (clash) map[clash] = map[key];
      map[key] = index;
      ctx.save({ controls: { dashboard: { buttons: map } } });
      if (clash) ctx.toast(`${PAD_BUTTONS[index]} was ${MENU_ACTIONS.find(a => a.key === clash).name}; those two swapped.`);
      render(ctx.state);
    });
  }
  return { el: root, update: render, dispose: () => stopCapture?.() };
}

function deadzonePanel(ctx) {
  const root = h('div', { class: 'stack' });
  const preview = stickView();
  let built = false;
  const off = ctx.input.onPad(pad => preview.set(pad.axes[0] || 0, pad.axes[1] || 0, ctx.state.settings.controls.dashboard.deadzone));
  const render = state => {
    if (built) return;
    built = true;
    const { dashboard, gameDeadzone } = state.settings.controls;
    fill(root, h('div', { class: 'deadzone-layout' }, h('div', {},
      setting('Menu pointer dead zone', slider({ min: 0, max: 0.5, step: 0.05, value: dashboard.deadzone, format: percent, label: 'Menu pointer dead zone', onChange: v => ctx.save({ controls: { dashboard: { deadzone: v } } }) }),
        'How far the left stick moves before the hand does. Raise it if the hand drifts by itself.'),
      setting('Pointer speed', slider({ min: 0.5, max: 2, step: 0.1, value: dashboard.pointerSpeed, format: v => `${v.toFixed(1)}×`, label: 'Pointer speed', onChange: v => ctx.save({ controls: { dashboard: { pointerSpeed: v } } }) })),
      setting('In-game stick dead zone', slider({ min: 0, max: 0.5, step: 0.05, value: gameDeadzone, format: percent, label: 'In-game stick dead zone', onChange: v => ctx.save({ controls: { gameDeadzone: v } }) }),
        'Used in the layouts this app gives Dolphin for each game, for the DualSense sticks and the phone\'s on-screen stick.')),
    h('div', { class: 'deadzone-preview' }, preview.el, h('p', { class: 'small muted' }, 'Left stick'))));
  };
  return { el: root, update: render, dispose: off };
}

function controllersView(ctx) {
  const tabs = [
    { value: 'players', label: 'Players', make: () => playersPanel(ctx) },
    { value: 'test', label: 'Test', make: () => testPanel(ctx) },
    { value: 'buttons', label: 'Menu buttons', make: () => menuButtonsPanel(ctx) },
    { value: 'deadzones', label: 'Dead zones', make: () => deadzonePanel(ctx) }
  ];
  let tab = 'players', panelView = null;
  const content = h('div', { class: 'tab-content scroll' });
  const switcher = segmented(tabs.map(({ value, label }) => ({ value, label })), tab, value => show(value), { label: 'Section', className: 'tabs' });
  const hint = h('p', { class: 'small muted test-hint' });
  const el = frame({ title: 'Controllers', className: 'controllers-screen', onBack: () => ctx.back(), body: h('div', { class: 'tabbed' }, switcher, content, hint) });
  function show(value) {
    panelView?.dispose?.();
    tab = value;
    panelView = tabs.find(t => t.value === value).make();
    fill(content, panelView.el);
    panelView.update(ctx.state);
    hint.textContent = value === 'test' ? 'Buttons are only tested here, not used. Leave with the pointer on Back, or with PS / Home.' : '';
    ctx.input.reset();
  }
  show(tab);
  return {
    el,
    update: state => panelView?.update(state),
    dispose: () => panelView?.dispose?.(),
    page: direction => { const i = tabs.findIndex(t => t.value === tab); const next = tabs[(i + direction + tabs.length) % tabs.length].value; switcher.set(next); show(next); },
    // On the test tab every button is shown rather than acted on, except Home and Escape.
    intercept: (slot, name) => tab === 'test' && name !== 'home' && name !== 'key:Escape'
  };
}

// ---- Phones, screen and sound, Dolphin ----------------------------------------------------------
function phonesView(ctx) {
  const join = joinPanel(ctx);
  const el = frame({ title: 'Connect controllers', className: 'phones-screen', onBack: () => ctx.back(), body: join.el,
    actions: [button('Controllers', () => ctx.go('controllers'))] });
  return { el, update: join.update };
}

function displayView(ctx) {
  const root = h('div', { class: 'panel settings-panel' });
  const fullscreenButton = button('', () => toggleFullscreen(), { kind: 'small' });
  const toggleFullscreen = () => {
    // A window that opened full screen can only be put back by the player: browsers keep that key to themselves.
    if (isFullscreen() && !document.fullscreenElement) return ctx.toast('Press F11 to leave full screen.');
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => ctx.toast('Full screen is not available in this window.'));
  };
  const syncFullscreen = () => { fullscreenButton.querySelector('.wbtn-label').textContent = isFullscreen() ? 'Leave full screen' : 'Full screen'; };
  document.addEventListener('fullscreenchange', syncFullscreen);
  addEventListener('resize', syncFullscreen);
  let built = false;
  const render = state => {
    if (built) return;
    built = true;
    const { display } = state.settings;
    fill(root, 
      setting('Picture', segmented([{ value: 'auto', label: 'Automatic' }, { value: '16:9', label: '16:9' }, { value: '4:3', label: '4:3' }], display.aspect, value => ctx.save({ display: { aspect: value } }), { label: 'Picture shape' }),
        'Automatic follows the window. Pick 4:3 for an older, squarer screen.'),
      setting('Full screen', fullscreenButton, 'F11 does the same.'),
      setting('Start in full screen', onOff(display.startFullscreen, value => ctx.save({ display: { startFullscreen: value } }), 'Start in full screen'),
        'From the next time Living Room Sports opens.'),
      setting('Menu sounds', onOff(display.sounds, value => ctx.save({ display: { sounds: value } }), 'Menu sounds')),
      setting('Volume', slider({ min: 0, max: 1, step: 0.05, value: display.volume, format: percent, label: 'Volume', onChange: value => { ctx.save({ display: { volume: value } }); ctx.play('select'); } })));
    syncFullscreen();
  };
  const el = frame({ title: 'Screen and sound', className: 'display-screen', onBack: () => ctx.back(), body: root });
  return { el, update: render, dispose: () => { document.removeEventListener('fullscreenchange', syncFullscreen); removeEventListener('resize', syncFullscreen); } };
}

function dolphinView(ctx) {
  const settingsPanel = h('div', { class: 'panel settings-panel' });
  const info = h('div', { class: 'panel stack' });
  let built = false;
  const render = state => {
    if (!built) {
      built = true;
      const { launch, controls } = state.settings;
      fill(settingsPanel, 
        setting('Start games full screen', onOff(launch.fullscreen, value => ctx.save({ launch: { fullscreen: value } }), 'Start games full screen')),
        setting('Controllers work while Dolphin is behind another window', onOff(launch.backgroundInput, value => ctx.save({ launch: { backgroundInput: value } }), 'Background input'),
          'Keeps phones and the DualSense working if a notification takes focus.'),
        setting('Controller layouts', segmented([{ value: 'console', label: 'Set by this app' }, { value: 'dolphin', label: 'Dolphin\'s own' }], controls.layouts, value => ctx.save({ controls: { layouts: value } }), { label: 'Controller layouts' }),
          'This app gives each game the layouts shown on its channel, then puts your own Dolphin settings back when the game closes.'));
    }
    keepFocus(info, () => {
      const d = state.dolphin;
      fill(info, 
        status(state.setup.find(s => s.id === 'dolphin')),
        d.found ? h('dl', { class: 'facts' }, h('dt', {}, 'Settings and saves'), h('dd', {}, pathText(d.userDir || 'Unknown'))) : null,
        h('p', { class: 'small muted' }, state.dsu.error || (state.dsu.port ? `Phones reach Dolphin through a motion server on this PC (port ${state.dsu.port})${state.dsu.clients ? '; Dolphin is listening.' : '.'}` : 'The phone motion server is starting…')),
        h('div', { class: 'row-actions' }, button('Change Dolphin', () => ctx.go('setup'), { kind: 'small' }),
          button('Close an open Dolphin', () => ctx.attempt(() => ctx.api('/api/stop', { foreign: true })), { kind: 'small' })));
    });
  };
  const el = frame({ title: 'Dolphin', className: 'dolphin-screen', onBack: () => ctx.back(), body: h('div', { class: 'stack' }, settingsPanel, info) });
  return { el, update: render };
}

function setupSingle(ctx, title, make) {
  const panelView = make(ctx);
  const el = frame({ title, onBack: () => ctx.back(), body: h('div', { class: 'scroll fill' }, panelView.el) });
  return { el, update: panelView.update, dispose: panelView.dispose };
}

export const optionViews = {
  options: optionsView, setup: setupView, controllers: controllersView, phones: phonesView, display: displayView, dolphin: dolphinView,
  games: ctx => setupSingle(ctx, 'Games', gamesPanel)
};
