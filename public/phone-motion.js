// Phone and tablet sensors → Wii Remote motion and pointer, and how the controller lies on the screen. Pure
// functions, shared by the controller page and its tests.
//
// Device axes (W3C DeviceMotion): x toward the device's right edge, y toward its top edge, z out of the screen,
// all fixed to the device's natural orientation. A phone held upright like a Wii Remote (top edge toward the
// TV, screen up) already has the remote's axes: right, forward (the pointing end) and up (the button face).
// The controller follows the screen, so in landscape the end that points at the TV is the screen's top edge,
// which is the device's side: `hold` (see controllerView) says which edge it is, and the readings are turned
// to match.

export const STANDARD_GRAVITY = 9.80665;
const DEGREES = 180 / Math.PI;
export const clamp = (value, low = -1, high = 1) => Math.max(low, Math.min(high, value));
export const wrap180 = degrees => ((((degrees + 180) % 360) + 360) % 360) - 180;
const round = value => Math.round(value * 1000) / 1000 + 0; // + 0 turns -0 into 0
const finite = value => (Number.isFinite(value) ? value : 0);
const quarters = degrees => ((Math.round(degrees / 90) % 4) + 4) % 4; // 0..3 quarter turns

// "Up" in device axes for a phone at this tilt: what accelerationIncludingGravity reports at rest, per the spec.
export function expectedGravity(beta, gamma) {
  const b = beta / DEGREES, g = gamma / DEGREES;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

// Safari on iPhone reports accelerationIncludingGravity with the opposite sign, and some older browsers report
// rotationRate in radians a second. Both are learnt in the first moments of use by comparing the readings with
// deviceorientation, which every browser reports the same way. Until then the spec's conventions are assumed.
export function createCalibration() {
  let signVotes = 0, unitVotes = 0;
  const state = { gravitySign: 1, gyroScale: 1, gravityKnown: false, gyroKnown: false };
  return {
    state,
    // vector: accelerationIncludingGravity in m/s²; beta and gamma from the latest deviceorientation.
    gravity(vector, beta, gamma) {
      if (state.gravityKnown || !vector || ![...vector, beta, gamma].every(Number.isFinite)) return;
      const length = Math.hypot(...vector);
      if (length < 7 || length > 12.5) return; // the phone is moving, so the reading is not mostly gravity
      const expected = expectedGravity(beta, gamma);
      const agreement = vector.reduce((sum, v, i) => sum + v * expected[i], 0) / length;
      if (Math.abs(agreement) < 0.7) return;
      signVotes += Math.sign(agreement);
      if (Math.abs(signVotes) >= 6) { state.gravitySign = Math.sign(signVotes); state.gravityKnown = true; }
    },
    // rateMagnitude: |rotationRate| as reported; orientationSpeed: how fast deviceorientation turned, in °/s.
    rates(rateMagnitude, orientationSpeed) {
      if (state.gyroKnown || !Number.isFinite(rateMagnitude) || !(orientationSpeed > 60 && orientationSpeed < 2000)) return;
      const ratio = orientationSpeed / Math.max(rateMagnitude, 1e-3);
      if (ratio > 15) unitVotes--;
      else if (ratio > 0.25 && ratio < 4) unitVotes++;
      if (Math.abs(unitVotes) >= 4) { state.gyroScale = unitVotes < 0 ? DEGREES : 1; state.gyroKnown = true; }
    }
  };
}

// devicemotion → the remote's accelerometer [right, forward, up] in g and gyro [pitchUp, yawRight, rollRight]
// in °/s. rotationRate is about the device axes: beta about x, gamma about y, alpha about z.
export function remoteMotion(gravityVector, rotationRate, calibration) {
  const scale = calibration.gravitySign / STANDARD_GRAVITY;
  const a = gravityVector ? gravityVector.map(v => round(clamp(finite(v) * scale, -8, 8))) : [0, 0, 1];
  const k = calibration.gyroScale;
  const g = rotationRate
    ? [finite(rotationRate.beta) * k, -finite(rotationRate.alpha) * k, finite(rotationRate.gamma) * k].map(v => round(clamp(v, -2000, 2000)))
    : [0, 0, 0];
  return { a, g };
}

// remoteMotion's readings for a remote whose pointing end is `hold` degrees round from the device's top edge
// (90: its right edge). Both turn about the screen's normal, which stays the remote's up.
export function heldMotion({ a, g }, hold = 0) {
  const q = quarters(hold);
  if (!q) return { a, g };
  const cos = [1, 0, -1, 0][q], sin = [0, 1, 0, -1][q];
  const turn = (x, y) => [x * cos - y * sin, x * sin + y * cos].map(round);
  const [right, forward] = turn(a[0], a[1]);
  const [pitch, roll] = turn(g[0], g[2]); // turning about the device's x and y axes
  return { a: [right, forward, a[2]], g: [pitch, g[1], roll] };
}

// How far the phone can turn from where it was recentred before the pointer reaches the screen's edge.
export const POINTER_RANGE = { yaw: 24, pitch: 16 };
// How far the pointing end is lifted, from deviceorientation: beta lifts the device's top edge and gamma lowers
// its right edge.
export function pitchOf(orientation, hold = 0) {
  const beta = finite(orientation.beta), gamma = finite(orientation.gamma);
  return [beta, -gamma, -beta, gamma][quarters(hold)];
}
// deviceorientation → pointer in -1..1, x to the right and y downward (alpha grows as the device turns left).
export function pointerFrom(orientation, base, hold = 0) {
  const yaw = wrap180(orientation.alpha - base.alpha);
  const pitch = wrap180(pitchOf(orientation, hold) - pitchOf(base, hold));
  return { x: round(clamp(-yaw / POINTER_RANGE.yaw)), y: round(clamp(-pitch / POINTER_RANGE.pitch)) };
}

export function orientationSpeed(previous, next, seconds) {
  if (!previous || !(seconds > 0)) return 0;
  const turned = [wrap180(next.alpha - previous.alpha), next.beta - previous.beta, wrap180(finite(next.gamma) - finite(previous.gamma))];
  return Math.hypot(...turned) / seconds;
}

// Steering angle of a sideways remote, in degrees, counter-clockwise as the player sees it.
export const steeringAngle = ([right, forward]) => Math.atan2(forward, right) * DEGREES;

// A touch on the on-screen stick, as an offset from its centre in its own (unrotated) pixels → [x, y] inside the
// unit circle with up positive, as Dolphin reads a stick.
export function stickFrom(dx, dy, radius) {
  let x = dx / radius, y = -dy / radius;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  return [round(x), round(y)];
}

// The screen's rotation from the device's natural orientation: 0, 90 (top edge to the left), 180 or 270.
export function screenAngle(screenObject, legacyOrientation) {
  return quarters(Number(screenObject?.orientation?.angle ?? legacyOrientation ?? 0) || 0) * 90;
}

// How the controller lies on the screen.
//   layout: remote, nunchuk or wheel.
//   shown:  the screen angle the controller is drawn for. The page passes the screen's angle once the device
//           has been held still, so a swing that tips the browser into turning the page changes nothing.
//   actual: the screen's angle now. width, height: the page's size now.
// Returns
//   view:   the screen angle the controller is drawn upright for. The wheel is always wide, so on a tall screen
//           it is drawn across, for the device turned a quarter to the left.
//   turn:   how far to turn the page's contents (clockwise, as CSS rotate()) to draw it so.
//   width, height, shape: the controller's own size once turned, and whether that is portrait or landscape.
//   hold:   where the remote's pointing end is, in degrees round from the device's top edge (see heldMotion):
//           the top of the drawn controller, or for the wheel its left.
// The page's shape comes from its size, not the angle, because some Android tablets are landscape at 0°.
export function controllerView(layout, shown, actual, width, height) {
  const pageTall = width > 0 && height > 0 ? height >= width : quarters(actual) % 2 === 0;
  const tallWhenShown = pageTall !== ((quarters(shown) - quarters(actual)) % 2 !== 0);
  const view = ((quarters(shown) + (layout === 'wheel' && tallWhenShown ? 1 : 0)) % 4) * 90;
  const turn = wrap180(view - quarters(actual) * 90);
  const sideways = Math.abs(turn) === 90;
  return {
    view, turn,
    width: sideways ? height : width, height: sideways ? width : height,
    shape: pageTall !== sideways ? 'portrait' : 'landscape',
    hold: (view + (layout === 'wheel' ? 270 : 0)) % 360
  };
}

// How much larger than on a phone to draw the controller: a phone page is about 390 by 800, either way round,
// and an iPad about half as large again.
export function controllerScale(width, height) {
  const short = Math.min(width, height), long = Math.max(width, height);
  return short > 0 ? round(clamp(Math.min(short / 390, long / 800), 1, 1.75)) : 1;
}

// What the page calls the device. iPads ask for desktop pages and name themselves a Mac, but a Mac has no
// touch screen; Android tablets leave "Mobile" out of their user agent.
export function deviceKind(userAgent = '', maxTouchPoints = 0) {
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(userAgent) && !/Mobile/.test(userAgent)) return 'tablet';
  return 'phone';
}

// A point given in screen pixels relative to an element's centre, in the element's own axes when the element
// is turned by `degrees` (clockwise, as CSS rotate()).
export function unrotate(dx, dy, degrees) {
  const t = degrees / DEGREES, c = Math.cos(t), s = Math.sin(t);
  return [dx * c + dy * s, -dx * s + dy * c];
}
