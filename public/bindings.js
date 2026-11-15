// One table for every controller layout. The server writes Dolphin profiles from it and the menu draws
// the on-screen bindings from it, so what players see always matches what Dolphin receives.

// Dolphin input names. SDL (DualSense): "Button S/E/W/N" are Cross/Circle/Square/Triangle.
// DSU (phones): this app's DSU server reports phone buttons with PlayStation names.
// Keyboard: Dolphin's DirectInput key names.

// Phone buttons, as the phone page names them, and the DSU input each one drives.
export const PHONE_TO_DSU = {
  a: 'Cross', b: 'R1', one: 'Square', two: 'Triangle', minus: 'Share', plus: 'Options', home: 'PS',
  up: 'Pad N', down: 'Pad S', left: 'Pad W', right: 'Pad E',
  c: 'L1', z: 'L2', nswing: 'L3', recenter: 'R3'
};

// Wii Remote (+ Nunchuk) controls → input name per controller type.
export const WIIMOTE = {
  'Buttons/A': { phone: 'Cross', dualsense: 'Button S', keyboard: ['Click 0', 'RETURN'] },
  'Buttons/B': { phone: 'R1', dualsense: ['Trigger R', 'Shoulder R'], keyboard: ['Click 1', 'SPACE'] },
  'Buttons/1': { phone: 'Square', dualsense: 'Button W', keyboard: '1' },
  'Buttons/2': { phone: 'Triangle', dualsense: 'Button N', keyboard: '2' },
  'Buttons/-': { phone: 'Share', dualsense: 'Back', keyboard: 'MINUS' },
  'Buttons/+': { phone: 'Options', dualsense: 'Start', keyboard: 'EQUALS' },
  'Buttons/Home': { phone: 'PS', dualsense: 'Guide', keyboard: 'HOME' },
  'D-Pad/Up': { phone: 'Pad N', dualsense: 'Pad N', keyboard: 'UP' },
  'D-Pad/Down': { phone: 'Pad S', dualsense: 'Pad S', keyboard: 'DOWN' },
  'D-Pad/Left': { phone: 'Pad W', dualsense: 'Pad W', keyboard: 'LEFT' },
  'D-Pad/Right': { phone: 'Pad E', dualsense: 'Pad E', keyboard: 'RIGHT' }
};
export const NUNCHUK = {
  'Nunchuk/Buttons/C': { phone: 'L1', dualsense: 'Shoulder L', keyboard: 'C' },
  'Nunchuk/Buttons/Z': { phone: 'L2', dualsense: 'Trigger L', keyboard: 'Z' },
  'Nunchuk/Stick/Up': { phone: 'Left Y+', dualsense: 'Left Y+', keyboard: 'I' },
  'Nunchuk/Stick/Down': { phone: 'Left Y-', dualsense: 'Left Y-', keyboard: 'K' },
  'Nunchuk/Stick/Left': { phone: 'Left X-', dualsense: 'Left X-', keyboard: 'J' },
  'Nunchuk/Stick/Right': { phone: 'Left X+', dualsense: 'Left X+', keyboard: 'L' },
  // A one-device player has no second hand to swing, so a button gives the Nunchuk its swing (Boxing jabs, Cycling).
  'Nunchuk/Swing/Forward': { phone: 'L3', dualsense: 'Thumb L', keyboard: 'V' }
};
// Pointer: phones aim with their own orientation (sent as the right stick); the DualSense uses its gyro.
export const POINTER = {
  'IR/Up': { phone: 'Right Y+', dualsense: 'Right Y+', keyboard: 'Cursor Y-' },
  'IR/Down': { phone: 'Right Y-', dualsense: 'Right Y-', keyboard: 'Cursor Y+' },
  'IR/Left': { phone: 'Right X-', dualsense: 'Right X-', keyboard: 'Cursor X-' },
  'IR/Right': { phone: 'Right X+', dualsense: 'Right X+', keyboard: 'Cursor X+' }
};
export const MOTION_AXES = {
  accel: ['Up', 'Down', 'Left', 'Right', 'Forward', 'Backward'],
  gyro: ['Pitch Up', 'Pitch Down', 'Roll Left', 'Roll Right', 'Yaw Left', 'Yaw Right']
};
// Keyboard players have no motion sensor, so keys drive Dolphin's emulated swing and tilt.
export const KEYBOARD_MOTION = {
  'Swing/Up': 'W', 'Swing/Down': 'S', 'Swing/Left': 'A', 'Swing/Right': 'D', 'Swing/Forward': 'F', 'Swing/Backward': 'R',
  'Tilt/Left': 'Q', 'Tilt/Right': 'E', 'Tilt/Forward': 'T', 'Tilt/Backward': 'G', 'Shake/X': 'H', 'Shake/Y': 'H', 'Shake/Z': 'H'
};

// GameCube controller (Mario Kart Wii with a DualSense or keyboard).
export const GCPAD = {
  'Buttons/A': { dualsense: 'Button S', keyboard: 'X' },
  'Buttons/B': { dualsense: 'Button W', keyboard: 'Z' },
  'Buttons/X': { dualsense: 'Button N', keyboard: 'S' },
  'Buttons/Y': { dualsense: 'Button E', keyboard: 'A' },
  'Buttons/Z': { dualsense: ['Touchpad', 'Back'], keyboard: 'Q' },
  'Buttons/Start': { dualsense: 'Start', keyboard: 'RETURN' },
  'Main Stick/Up': { dualsense: 'Left Y+', keyboard: 'UP' },
  'Main Stick/Down': { dualsense: 'Left Y-', keyboard: 'DOWN' },
  'Main Stick/Left': { dualsense: 'Left X-', keyboard: 'LEFT' },
  'Main Stick/Right': { dualsense: 'Left X+', keyboard: 'RIGHT' },
  'C-Stick/Up': { dualsense: 'Right Y+' },
  'C-Stick/Down': { dualsense: 'Right Y-' },
  'C-Stick/Left': { dualsense: 'Right X-' },
  'C-Stick/Right': { dualsense: 'Right X+' },
  'Triggers/L': { dualsense: ['Shoulder L', 'Trigger L'], keyboard: 'SPACE' },
  'Triggers/R': { dualsense: ['Shoulder R', 'Trigger R'], keyboard: 'C' },
  'Triggers/L-Analog': { dualsense: 'Trigger L' },
  'Triggers/R-Analog': { dualsense: 'Trigger R' },
  'D-Pad/Up': { dualsense: 'Pad N', keyboard: 'I' },
  'D-Pad/Down': { dualsense: 'Pad S', keyboard: 'K' },
  'D-Pad/Left': { dualsense: 'Pad W', keyboard: 'J' },
  'D-Pad/Right': { dualsense: 'Pad E', keyboard: 'L' }
};

// What players press, by name, for the on-screen tables.
export const LABELS = {
  dualsense: {
    'Button S': '✕ Cross', 'Button E': '○ Circle', 'Button W': '□ Square', 'Button N': '△ Triangle',
    'Shoulder L': 'L1', 'Shoulder R': 'R1', 'Trigger L': 'L2', 'Trigger R': 'R2', 'Thumb L': 'L3 (press left stick)', 'Thumb R': 'R3',
    Back: 'Create', Start: 'Options', Guide: 'PS button', Touchpad: 'Touch pad click',
    'Pad N': 'D-pad ↑', 'Pad S': 'D-pad ↓', 'Pad W': 'D-pad ←', 'Pad E': 'D-pad →',
    'Left X-': 'Left stick', 'Left X+': 'Left stick', 'Left Y-': 'Left stick', 'Left Y+': 'Left stick',
    'Right X-': 'Right stick', 'Right X+': 'Right stick', 'Right Y-': 'Right stick', 'Right Y+': 'Right stick'
  },
  keyboard: {
    'Click 0': 'Left click', 'Click 1': 'Right click', RETURN: 'Enter', SPACE: 'Space', MINUS: '−', EQUALS: '=',
    HOME: 'Home', UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→', LSHIFT: 'Left Shift',
    'Cursor X-': 'Mouse', 'Cursor X+': 'Mouse', 'Cursor Y-': 'Mouse', 'Cursor Y+': 'Mouse'
  },
  phone: {
    Cross: 'A', R1: 'B', Square: '1', Triangle: '2', Share: '−', Options: '+', PS: 'Home',
    'Pad N': '✚ ↑', 'Pad S': '✚ ↓', 'Pad W': '✚ ←', 'Pad E': '✚ →', L1: 'C', L2: 'Z', L3: 'Nunchuk swing',
    'Left X-': 'Nunchuk stick', 'Left X+': 'Nunchuk stick', 'Left Y-': 'Nunchuk stick', 'Left Y+': 'Nunchuk stick'
  }
};
const list = value => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
export function label(kind, control) {
  const names = list(control).map(name => LABELS[kind]?.[name] || (kind === 'keyboard' && name.length === 1 ? name : name));
  return [...new Set(names)].join(' or ');
}

// Mario Kart Wii controls, per control style. The GameCube layout is what the DualSense and keyboard drive;
// the phone is a Wii Remote held sideways (the Wii Wheel style).
export const MKW_ACTIONS = [
  { action: 'Steer', gc: ['Main Stick/Left', 'Main Stick/Right'], wheel: 'Tilt the phone like a wheel' },
  { action: 'Accelerate', gc: 'Buttons/A', wheel: '2' },
  { action: 'Brake / reverse', gc: 'Buttons/B', wheel: '1' },
  { action: 'Drift / hop', gc: 'Triggers/R', wheel: 'B' },
  { action: 'Use item', gc: 'Triggers/L', wheel: '✚ (any direction)' },
  { action: 'Trick / wheelie', gc: 'D-Pad/Up', wheel: 'Flick the phone up' },
  { action: 'Pause', gc: 'Buttons/Start', wheel: '+' }
];
export function mkwRows() {
  return MKW_ACTIONS.map(row => ({
    action: row.action,
    dualsense: label('dualsense', list(row.gc).flatMap(key => list(GCPAD[key].dualsense))),
    keyboard: label('keyboard', list(row.gc).flatMap(key => list(GCPAD[key].keyboard))),
    phone: row.wheel
  }));
}

// Wii Remote controls for the sports titles, per controller type.
export function remoteRows(kind) {
  const rows = [['Pointer', kind === 'phone' ? 'Point the phone' : kind === 'dualsense' ? 'Gyro (R3 recentres)' : 'Mouse'],
    ['Swing / motion', kind === 'phone' ? 'Move the phone' : kind === 'dualsense' ? 'Move the controller' : 'W A S D F R (swing), Q E (tilt)']];
  for (const key of ['Buttons/A', 'Buttons/B', 'Buttons/1', 'Buttons/2', 'Buttons/-', 'Buttons/+', 'Buttons/Home']) rows.push([key.slice(8), label(kind, WIIMOTE[key][kind])]);
  rows.push(['D-pad', kind === 'keyboard' ? 'Arrow keys' : kind === 'phone' ? '✚' : 'D-pad']);
  rows.push(['Nunchuk C / Z', `${label(kind, NUNCHUK['Nunchuk/Buttons/C'][kind])} / ${label(kind, NUNCHUK['Nunchuk/Buttons/Z'][kind])}`]);
  rows.push(['Nunchuk stick', kind === 'keyboard' ? 'I J K L' : kind === 'phone' ? 'Stick on the phone' : 'Left stick']);
  rows.push(['Nunchuk swing', label(kind, NUNCHUK['Nunchuk/Swing/Forward'][kind])]);
  return rows.map(([control, input]) => ({ control, input }));
}
