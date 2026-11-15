// Channel catalogue: the Wii Sports selector (15 sports, 17 title-specific entries), and the modes of Mario Kart
// Wii and Super Smash Bros. Brawl. Dolphin can open a disc but cannot choose a sport or mode inside it, so every
// entry starts its title and shows the in-game menu path. Menu paths follow the games' manuals; they are not
// verified on this PC.

export const TITLE_NAMES = { sports: 'Wii Sports', resort: 'Wii Sports Resort', mkw: 'Mario Kart Wii', brawl: 'Super Smash Bros. Brawl' };

// The 2-in-1 "Wii Sports + Wii Sports Resort" disc can stand in for either of its two games, and nothing else.
export const discFits = (kind, title) => kind === title || (kind === 'pack' && (title === 'sports' || title === 'resort'));

const WS_START = ['Press A at the wrist-strap reminder', 'Press A at the title screen'];
const WSR_START = ['Press A at the wrist-strap reminder', 'Press A at the title screen (the first time, also skip the intro and the MotionPlus video with A)'];
const ws = (position, extra) => [...WS_START, `Choose ${position}`, ...extra];
const wsr = (position, extra) => [...WSR_START, `Choose ${position}`, ...extra];
const RESORT_ORDER = ['Swordplay', 'Wakeboarding', 'Frisbee', 'Archery', 'Basketball', 'Table Tennis', 'Golf', 'Bowling', 'Power Cruising', 'Canoeing', 'Cycling', 'Air Sports'];
const SPORTS_ORDER = ['Tennis', 'Baseball', 'Bowling', 'Golf', 'Boxing'];
const at = (order, name) => `${name} (${order.indexOf(name) + 1}${['st', 'nd', 'rd'][order.indexOf(name)] || 'th'} of ${order.length})`;

// Support levels by controller: good | partial | limited | none.
const MOTION_GOOD = { phone: 'good', dualsense: 'good', keyboard: 'limited', wiimote: 'good' };
const MOTIONPLUS = { phone: 'good', dualsense: 'good', keyboard: 'none', wiimote: 'good' };

function original(name, players, modes, extra = {}) {
  return {
    title: 'sports', label: 'Original', players, modes,
    requires: { nunchuk: false, motionPlus: false, ...extra.requires },
    support: { ...MOTION_GOOD, ...extra.support },
    note: extra.note || null,
    path: ws(at(SPORTS_ORDER, name), extra.path || ['Each player presses A on their controller to join, then choose a Mii'])
  };
}
function resort(name, players, modes, extra = {}) {
  return {
    title: 'resort', label: 'Resort', players, modes,
    requires: { nunchuk: false, motionPlus: true, ...extra.requires },
    support: { ...MOTIONPLUS, ...extra.support },
    note: extra.note || null,
    path: wsr(at(RESORT_ORDER, name), extra.path || [modes.length > 1 ? `Choose ${modes.join(', ').replace(/, ([^,]*)$/, ' or $1')}` : 'Choose the number of players'])
  };
}

export const SPORTS = [
  { id: 'tennis', name: 'Tennis', art: 'tennis', editions: [original('Tennis', '1–4', ['Doubles match', 'Training: Returning Balls, Timing Your Swing, Target Practice'])] },
  { id: 'baseball', name: 'Baseball', art: 'baseball', editions: [original('Baseball', '1–2', ['Game', 'Training: Swing Control, Hitting Home Runs, Batting Practice'])] },
  { id: 'bowling', name: 'Bowling', art: 'bowling', editions: [
    original('Bowling', '1–4', ['Standard game', 'Training: Picking Up Spares, Power Throws, Spin Control']),
    resort('Bowling', '1–4', ['Standard Game', '100-Pin Game', 'Spin Control'])] },
  { id: 'golf', name: 'Golf', art: 'golf', editions: [
    original('Golf', '1–4', ['3 holes (Beginner, Intermediate, Expert)', '9 holes', 'Training: Putting, Hitting the Green, Target Practice']),
    resort('Golf', '1–4', ['Wuhu Island course: 3, 9 or 18 holes'])] },
  { id: 'boxing', name: 'Boxing', art: 'boxing', editions: [original('Boxing', '1–2', ['Match', 'Training: Working the Bag, Dodging, Throwing Punches'], {
    requires: { nunchuk: true },
    support: { phone: 'partial', dualsense: 'partial' },
    note: 'Boxing reads punches from both hands. With one phone or a DualSense, the left jab comes from the Nunchuk swing button (L3 on the DualSense).'
  })] },
  { id: 'swordplay', name: 'Swordplay', art: 'swordplay', editions: [resort('Swordplay', '1–2', ['Duel', 'Speed Slice', 'Showdown'])] },
  { id: 'wakeboarding', name: 'Wakeboarding', art: 'wakeboarding', editions: [resort('Wakeboarding', '1–4', ['Wakeboarding'])] },
  { id: 'frisbee', name: 'Frisbee', art: 'frisbee', editions: [resort('Frisbee', '1–4', ['Frisbee Dog', 'Frisbee Golf'])] },
  { id: 'archery', name: 'Archery', art: 'archery', editions: [resort('Archery', '1–4', ['Beginner, Intermediate and Expert courses'], {
    requires: { nunchuk: true },
    note: 'Hold the Nunchuk like the bow: phones show the C and Z buttons and a stick on screen.'
  })] },
  { id: 'basketball', name: 'Basketball', art: 'basketball', editions: [resort('Basketball', '1–2', ['3-Point Contest', 'Pickup Game'])] },
  { id: 'table-tennis', name: 'Table Tennis', art: 'tabletennis', editions: [resort('Table Tennis', '1–2', ['Match', 'Return Challenge'])] },
  { id: 'power-cruising', name: 'Power Cruising', art: 'cruising', editions: [resort('Power Cruising', '1–2', ['Slalom Course', 'VS'], {
    requires: { nunchuk: true },
    support: { phone: 'partial', dualsense: 'partial' },
    note: 'The game steers with both hands held like handlebars. One phone or a DualSense steers by tilting; throttle comes from twisting.'
  })] },
  { id: 'canoeing', name: 'Canoeing', art: 'canoeing', editions: [resort('Canoeing', '1–4', ['Speed Challenge', 'VS'])] },
  { id: 'cycling', name: 'Cycling', art: 'cycling', editions: [resort('Cycling', '1–2', ['Road Race', 'VS'], {
    requires: { nunchuk: true },
    support: { phone: 'partial', dualsense: 'partial' },
    note: 'Pedalling alternates both hands. One phone or a DualSense pedals with its own motion plus the Nunchuk swing button; a real Wii Remote and Nunchuk work best.'
  })] },
  { id: 'air-sports', name: 'Air Sports', art: 'airsports', editions: [resort('Air Sports', '1–2', ['Skydiving', 'Island Flyover', 'Dogfight'])] }
];

export const sportById = id => SPORTS.find(sport => sport.id === id) || null;
export function editionOf(sport, title) { return sport.editions.find(e => e.title === title) || sport.editions[0]; }
export const ENTRY_COUNT = SPORTS.reduce((sum, sport) => sum + sport.editions.length, 0);

// What a running activity needs from each controller (for the phone's on-screen layout). pointer: whether the game
// aims the Wii Remote at the screen anywhere, menus included. Brawl never does, so a phone is not asked to aim.
export function activityNeeds(title, sportId) {
  if (title === 'mkw') return { layout: 'wheel', nunchuk: false, motionPlus: false, pointer: true };
  if (title === 'brawl') return { layout: 'remote', nunchuk: true, motionPlus: false, pointer: false };
  const sport = sportById(sportId);
  const edition = sport ? editionOf(sport, title) : null;
  return { layout: 'remote', nunchuk: edition ? edition.requires.nunchuk : false, motionPlus: title === 'resort', pointer: true };
}

// The mode a title starts in, from the id last chosen on its channel; an unavailable mode is never one.
export function modeOf(title, modeId) {
  const modes = MODES[title] || [];
  return modes.find(m => m.id === modeId && !m.unavailable) || null;
}

// What a phone shows about the running game: its name, the edition or mode, and the in-game menu path.
export function activityGuide(title, sportId, modeId = null) {
  if (MODES[title]) {
    const mode = modeOf(title, modeId);
    return { name: TITLE_NAMES[title], detail: mode?.name || null, path: mode?.path || [] };
  }
  const sport = sportById(sportId);
  const edition = sport ? editionOf(sport, title) : null;
  return { name: sport?.name || TITLE_NAMES[title] || 'Game', detail: TITLE_NAMES[title] || null, path: edition?.path || [] };
}

export const SUPPORT_TEXT = {
  good: 'Works', partial: 'Works with limits', limited: 'Buttons only', none: 'Not playable'
};
export const CONTROLLER_NAMES = { phone: 'Phone', dualsense: 'DualSense', keyboard: 'Keyboard and mouse', wiimote: 'Real Wii Remote' };

export const MKW_MODES = [
  { id: 'grand-prix', name: 'Grand Prix', players: '1–2', detail: '50cc, 100cc, 150cc and Mirror cups against eleven CPU racers.',
    path: ['Press A at the title screen', 'Choose Single Player (or Multiplayer for two)', 'Choose Grand Prix', 'Pick an engine class, a character, a vehicle and a cup'] },
  { id: 'time-trials', name: 'Time Trials', players: '1', detail: 'Race the clock and your saved ghosts on any unlocked track.',
    path: ['Press A at the title screen', 'Choose Single Player', 'Choose Time Trials'] },
  { id: 'vs-race', name: 'VS Race', players: '1–4', detail: 'Single races with your own rules, split screen for up to four.',
    path: ['Press A at the title screen', 'Choose Multiplayer; each player presses A on their controller', 'Choose VS Race'] },
  { id: 'battle', name: 'Battle', players: '1–4', detail: 'Balloon Battle and Coin Runners in teams.',
    path: ['Press A at the title screen', 'Choose Multiplayer (or Single Player)', 'Choose Battle'] },
  { id: 'online', name: 'Mario Kart Channel and online play', players: '—', detail: 'Unavailable: Nintendo closed the Wii\'s online service in 2014.', unavailable: true, path: [] }
];

// Seen in Dolphin on this PC: the wrist-strap reminder passes by itself, and the first start asks to create a save
// file before the title screen.
const BRAWL_START = ['Wait for the wrist-strap reminder to pass', 'The first time, choose Yes to create a save file', 'Press A or Start at the title screen'];
export const BRAWL_MODES = [
  { id: 'brawl', name: 'Brawl', players: '1–4', detail: 'Free-for-all or team fights on any unlocked stage. Empty places can be filled with CPU fighters.',
    path: [...BRAWL_START, 'Choose Group, then Brawl', 'Each player picks a fighter, then choose a stage'] },
  { id: 'subspace', name: 'The Subspace Emissary', players: '1–2', detail: 'The adventure: side-scrolling stages and boss fights, alone or with a second player.',
    path: [...BRAWL_START, 'Choose Solo, then The Subspace Emissary', 'Start a new game, or continue a saved one'] },
  { id: 'classic', name: 'Classic', players: '1', detail: 'A run of set fights against CPU fighters at the difficulty you pick.',
    path: [...BRAWL_START, 'Choose Solo, then Classic', 'Pick a difficulty and a fighter'] },
  { id: 'training', name: 'Training', players: '1', detail: 'Try moves at any speed against a CPU fighter that does what you set.',
    path: [...BRAWL_START, 'Choose Solo, then Training', 'Pick your fighter, an opponent and a stage'] },
  { id: 'online', name: 'Online play', players: '—', detail: 'Unavailable: Nintendo closed the Wii\'s online service in 2014.', unavailable: true, path: [] }
];

// The titles whose channel lists modes rather than sports.
export const MODES = { mkw: MKW_MODES, brawl: BRAWL_MODES };
