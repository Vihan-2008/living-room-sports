// Phone sensors → Wii Remote motion and pointer. Pure functions, shared by the phone page and its tests.
//
// Device axes (W3C DeviceMotion): x toward the phone's right edge, y toward its top edge, z out of the screen.
// A phone held like a Wii Remote (top edge toward the TV, screen up) already has the remote's axes: right,
// forward (the pointing end) and up (the button face). Held sideways like a Wii Wheel it is the same remote
// turned on its side, so the mapping is the same for every layout.

export const STANDARD_GRAVITY = 9.80665;
const DEGREES = 180 / Math.PI;
export const clamp = (value, low = -1, high = 1) => Math.max(low, Math.min(high, value));
export const wrap180 = degrees => ((((degrees + 180) % 360) + 360) % 360) - 180;
const round = value => Math.round(value * 1000) / 1000 + 0; // + 0 turns -0 into 0
const finite = value => (Number.isFinite(value) ? value : 0);

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

// How far the phone can turn from where it was recentred before the pointer reaches the screen's edge.
export const POINTER_RANGE = { yaw: 24, pitch: 16 };
// deviceorientation → pointer in -1..1, x to the right and y downward (alpha grows as the phone turns left,
// beta as its top edge lifts).
export function pointerFrom(orientation, base) {
  const yaw = wrap180(orientation.alpha - base.alpha);
  const pitch = orientation.beta - base.beta;
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

// The screen's rotation from the phone's natural portrait orientation: 0, 90 (top edge to the left), 180 or 270.
export function screenAngle(screenObject, legacyOrientation) {
  const angle = Number(screenObject?.orientation?.angle ?? legacyOrientation ?? 0) || 0;
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

// How far to turn the controller on screen so it lies along the phone the way its layout is held: the Wii
// Remote along the phone's length, the wheel across it with the top edge to the left. That way the controller
// faces the player whether or not the browser rotates the page.
export function layoutRotation(layout, angle) {
  return wrap180((layout === 'wheel' ? 90 : 0) - angle);
}

// A point given in screen pixels relative to an element's centre, in the element's own axes when the element
// is turned by `degrees` (clockwise, as CSS rotate()).
export function unrotate(dx, dy, degrees) {
  const t = degrees / DEGREES, c = Math.cos(t), s = Math.sin(t);
  return [dx * c + dy * s, -dx * s + dy * c];
}
