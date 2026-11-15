// The PC's screens, and where Dolphin's game window goes when it moves between them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHelper, findScreen, nextScreen, placeWindow, fillsScreen, createDisplays } from '../console/screens.js';
import { THIS_PC, MAIN, SECOND, fakeWindows } from './fake-windows.js';

const { screens } = parseHelper(THIS_PC);
const [main, second] = screens;

test('screens are listed main screen first, in real pixels, with the names the menu shows', () => {
  assert.deepEqual(screens.map(s => [s.id, s.name, s.primary, s.x, s.y, s.width, s.height, s.scale]), [
    [MAIN, 'Main screen', true, 0, 0, 1920, 1080, 1],
    [SECOND, 'Second screen', false, 1920, -212, 2560, 1600, 2]
  ], 'a 200% screen keeps its true 2560 × 1600');
  assert.deepEqual(second.work, { x: 1920, y: -212, width: 2560, height: 1552 });
  const parsed = parseHelper(`${THIS_PC}\r\nwindow\t2428142\t632,269,656,519\t${MAIN}\t1\r\nmoved\t1920,-212,2560,1600\t${SECOND}\t0\r\nnoise\r\nscreen\tbroken`);
  assert.deepEqual(parsed.window, { handle: '2428142', x: 632, y: 269, width: 656, height: 519, screen: MAIN, framed: true });
  assert.deepEqual(parsed.moved, { x: 1920, y: -212, width: 2560, height: 1600, screen: SECOND, framed: false }, 'Dolphin\'s full screen has no title bar');
  assert.equal(parsed.screens.length, 2, 'lines it does not understand are skipped');
  assert.deepEqual(parseHelper(''), { screens: [], window: null, moved: null });
});

test('a chosen screen that has been unplugged falls back to the main screen, and "next" goes round', () => {
  assert.equal(findScreen(screens, 'main'), main);
  assert.equal(findScreen(screens, SECOND), second);
  assert.equal(findScreen(screens, '\\\\.\\DISPLAY9'), main);
  assert.equal(findScreen([], 'main'), null);
  assert.equal(nextScreen(screens, MAIN), second);
  assert.equal(nextScreen(screens, SECOND), main);
  assert.equal(nextScreen([main], MAIN), null, 'nowhere to go with one screen');
});

test('a full-screen game fills the other screen exactly; a windowed one keeps how big it looks and stays on screen', () => {
  assert.ok(fillsScreen({ x: 0, y: 0, width: 1920, height: 1080 }, main));
  assert.deepEqual(placeWindow({ x: 0, y: 0, width: 1920, height: 1080 }, main, second), { x: 1920, y: -212, width: 2560, height: 1600 });
  assert.deepEqual(placeWindow({ x: 1920, y: -212, width: 2560, height: 1600 }, second, main), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(placeWindow({ x: 632, y: 269, width: 656, height: 519 }, main, second), { x: 2544, y: 45, width: 1312, height: 1038 },
    'twice the pixels on a 200% screen, in the middle of it');
  assert.deepEqual(placeWindow({ x: 2544, y: 45, width: 1312, height: 1038 }, second, main), { x: 632, y: 257, width: 656, height: 519 });
  assert.deepEqual(placeWindow({ x: 10, y: 10, width: 1600, height: 1000 }, main, second), { x: 1920, y: -212, width: 2560, height: 1552 },
    'too big to double, so it is shrunk to fit');
  const stuck = { x: 636, y: 290, width: 648, height: 500, framed: false }; // full screen with no title bar, but small
  assert.deepEqual(placeWindow(stuck, main, second), { x: 1920, y: -212, width: 2560, height: 1600 }, 'a window with no title bar is full screen, whatever its size');
  assert.deepEqual(placeWindow(stuck, main, main), { x: 0, y: 0, width: 1920, height: 1080 }, 'and on its own screen it is made to fill it');
});

test('the helper is asked for the right window and place, and the latest screen list is kept', async () => {
  const windows = fakeWindows();
  const seen = [];
  const displays = createDisplays({ run: windows.run, onChange: list => seen.push(list.length) });
  assert.deepEqual(displays.screens, []);
  const found = await displays.gameWindow(4100, 20000);
  assert.deepEqual(windows.calls[0], { LRS_DO: 'window', LRS_PID: '4100', LRS_WAIT: '20000' });
  assert.deepEqual(found.window, { handle: '2428142', x: 632, y: 269, width: 656, height: 519, screen: MAIN, framed: true });
  assert.equal(displays.screens[1].name, 'Second screen');
  const { moved } = await displays.move(found.window.handle, { x: 1920, y: -212, width: 2560, height: 1600 });
  assert.deepEqual(windows.calls[1], { LRS_DO: 'move', LRS_WINDOW: '2428142', LRS_RECT: '1920,-212,2560,1600' });
  assert.equal(moved.screen, SECOND);
  await displays.list();
  assert.deepEqual(seen, [2], 'listeners hear about a change of screens, not every answer');
  await assert.rejects(createDisplays({ run: null }).list(), { code: 'unsupported' });
});
