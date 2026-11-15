// Builds the Dolphin controller profiles and per-game [Controls] keys for one launch.
import { WIIMOTE, NUNCHUK, POINTER, MOTION_AXES, KEYBOARD_MOTION, GCPAD } from '../public/bindings.js';

export const DSU_NAME = 'LivingRoomPhones';
export const DUALSENSE_NAMES = ['DualSense Wireless Controller', 'PS5 Controller'];
export const KEYBOARD_DEVICE = 'DInput/0/Keyboard Mouse';
export const PROFILE_PREFIX = 'Living Room';
// Dolphin's Wii Remote sources and GameCube port device ids.
export const WIIMOTE_SOURCE = { none: 0, emulated: 1, real: 2 };
export const SI_GC_CONTROLLER = 6, SI_NONE = 0;

const list = value => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
const tick = (device, input) => `\`${device}:${input}\``;
export const phoneDevice = index => `DSUClient/${index}/${DSU_NAME}`;
export const dualsenseDevices = (index, names = DUALSENSE_NAMES) => names.map(name => `SDL/${index}/${name}`);

// One binding expression: every input on every candidate device, OR-ed together.
function expression(devices, inputs) {
  const parts = [];
  for (const input of list(inputs)) for (const device of devices) parts.push(tick(device, input));
  return parts.join(' | ');
}

function devicesFor(player) {
  if (player.kind === 'phone') return [phoneDevice(player.index)];
  if (player.kind === 'dualsense') return dualsenseDevices(player.padIndex, player.dualsenseNames);
  return [KEYBOARD_DEVICE];
}

function joined(base, extra) { return [base, extra].filter(Boolean).join(' | '); }

export function wiimoteProfile(player, { nunchuk = false, motionPlus = false, keyboardExtra = false, deadzone = 0.1 } = {}) {
  const devices = devicesFor(player), kind = player.kind;
  const lines = { Device: devices[0] };
  const kb = key => (keyboardExtra && kind !== 'keyboard' ? expression([KEYBOARD_DEVICE], key) : '');
  for (const [control, inputs] of Object.entries(WIIMOTE)) {
    // Mouse clicks stay off the combined profile so clicking the desktop cannot press buttons in the game.
    const keys = list(inputs.keyboard).filter(name => !name.startsWith('Click'));
    lines[control] = joined(expression(devices, inputs[kind]), kb(keys));
  }
  for (const [control, inputs] of Object.entries(POINTER)) lines[control] = expression(devices, inputs[kind]);
  lines['IR/Relative Input'] = 'False';
  lines['IR/Auto-Hide'] = 'False';
  if (kind === 'keyboard') {
    for (const [control, key] of Object.entries(KEYBOARD_MOTION)) lines[control] = expression(devices, key);
    lines['IMUIR/Enabled'] = 'False';
  } else {
    for (const axis of MOTION_AXES.accel) lines[`IMUAccelerometer/${axis}`] = expression(devices, `Accel ${axis}`);
    for (const axis of MOTION_AXES.gyro) lines[`IMUGyroscope/${axis}`] = expression(devices, `Gyro ${axis}`);
    // Phones aim with their own fused orientation (the right stick above); the DualSense aims with its gyro.
    lines['IMUIR/Enabled'] = kind === 'dualsense' ? 'True' : 'False';
    if (kind === 'dualsense') lines['IMUIR/Recenter'] = expression(devices, ['Thumb R', 'Touchpad']);
  }
  lines.Extension = nunchuk ? 'Nunchuk' : 'None';
  lines['Extension/Attach MotionPlus'] = motionPlus ? 'True' : 'False';
  if (nunchuk) {
    for (const [control, inputs] of Object.entries(NUNCHUK)) lines[control] = joined(expression(devices, inputs[kind]), kb(inputs.keyboard));
    lines['Nunchuk/Stick/Dead Zone'] = kind === 'phone' ? '4.0' : (deadzone * 100).toFixed(1);
  }
  if (kind === 'dualsense') lines['Rumble/Motor'] = expression(devices, 'Motor');
  return lines;
}

export function gcProfile(player, { keyboardExtra = false, deadzone = 0.1 } = {}) {
  const devices = devicesFor(player), kind = player.kind;
  const lines = { Device: devices[0] };
  for (const [control, inputs] of Object.entries(GCPAD)) {
    const base = expression(devices, inputs[kind]);
    const extra = keyboardExtra && kind !== 'keyboard' && inputs.keyboard ? expression([KEYBOARD_DEVICE], inputs.keyboard) : '';
    const value = joined(base, extra);
    if (value) lines[control] = value;
  }
  lines['Main Stick/Dead Zone'] = (deadzone * 100).toFixed(1);
  lines['C-Stick/Dead Zone'] = (deadzone * 100).toFixed(1);
  if (kind === 'dualsense') lines['Rumble/Motor'] = expression(devices, 'Motor');
  return lines;
}

export function profileText(lines) {
  return ['[Profile]', ...Object.entries(lines).map(([key, value]) => `${key} = ${value}`), ''].join('\n');
}

const TITLE_SETUP = {
  mkw: { gamepadAs: 'gc', nunchuk: false, motionPlus: false, tag: 'Kart' },
  sports: { gamepadAs: 'wiimote', nunchuk: true, motionPlus: false, tag: 'Sports' },
  resort: { gamepadAs: 'wiimote', nunchuk: true, motionPlus: true, tag: 'Resort' }
};

// players: four entries from PLAYER_TYPES. Returns everything one launch needs.
export function buildLaunchPlan(title, players, { keyboardP1 = true, deadzone = 0.1, dualsenseNames = DUALSENSE_NAMES } = {}) {
  const setup = TITLE_SETUP[title];
  if (!setup) throw new Error(`Unknown title ${title}`);
  const profiles = [], controls = {}, config = [], roles = [];
  let gcPort = 0, padIndex = 0;
  const siDevices = [SI_NONE, SI_NONE, SI_NONE, SI_NONE];
  players.forEach((kind, i) => {
    const slot = i + 1, player = { kind, index: i, padIndex: kind === 'dualsense' ? padIndex++ : 0, dualsenseNames };
    const keyboardExtra = slot === 1 && keyboardP1 && kind !== 'keyboard';
    controls[`WiimoteSource${i}`] = WIIMOTE_SOURCE.none;
    if (kind === 'off') { roles.push({ slot, kind, as: 'Off' }); return; }
    if (kind === 'wiimote') {
      controls[`WiimoteSource${i}`] = WIIMOTE_SOURCE.real;
      roles.push({ slot, kind, as: 'Real Wii Remote' });
      return;
    }
    if (setup.gamepadAs === 'gc' && kind !== 'phone') {
      if (gcPort > 3) { roles.push({ slot, kind, as: 'Off' }); return; }
      const name = `${PROFILE_PREFIX} P${slot} ${setup.tag} ${kind}`;
      profiles.push({ type: 'GCPad', name, text: profileText(gcProfile(player, { keyboardExtra, deadzone })) });
      controls[`PadProfile${gcPort + 1}`] = name;
      siDevices[gcPort] = SI_GC_CONTROLLER;
      roles.push({ slot, kind, as: `GameCube Controller ${gcPort + 1}`, profile: name });
      gcPort++;
      return;
    }
    const name = `${PROFILE_PREFIX} P${slot} ${setup.tag} ${kind}`;
    profiles.push({ type: 'Wiimote', name, text: profileText(wiimoteProfile(player, { nunchuk: setup.nunchuk, motionPlus: setup.motionPlus, keyboardExtra, deadzone })) });
    controls[`WiimoteSource${i}`] = WIIMOTE_SOURCE.emulated;
    controls[`WiimoteProfile${slot}`] = name;
    const extras = [setup.nunchuk && 'Nunchuk', setup.motionPlus && 'MotionPlus'].filter(Boolean);
    roles.push({ slot, kind, as: `Wii Remote ${slot}${extras.length ? ' + ' + extras.join(' + ') : ''}${title === 'mkw' ? ' (held sideways)' : ''}`, profile: name });
  });
  siDevices.forEach((device, port) => config.push(`Dolphin.Core.SIDevice${port}=${device}`));
  for (const [key, value] of Object.entries(controls)) controls[key] = String(value);
  return { profiles, controls, config, roles };
}
