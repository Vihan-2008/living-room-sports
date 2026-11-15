const $ = id => document.getElementById(id);
let socket, slot = null, joined = false, reconnectTimer, desired = false, motionEnabled = false;
let x = 0, y = 0, baseAlpha = null, baseBeta = null, lastSend = 0, lastSwing = 0, lastShake = 0, swing = 0;
const held = new Set();
const codeFromLink = new URLSearchParams(location.search).get('code');
if (codeFromLink) $('code').value = codeFromLink;
function send(data, force = false) {
  if (!joined || socket?.readyState !== WebSocket.OPEN || (!force && performance.now() - lastSend < 32)) return;
  lastSend = performance.now(); socket.send(JSON.stringify({ type: 'input', x, y, ...data }));
}
function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'join', name: $('name').value, code: $('code').value }));
  socket.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'joined') {
      joined = true; slot = msg.slot; $('join-form').hidden = true; $('remote-controls').hidden = false;
      document.documentElement.style.setProperty('--player', msg.color); $('slot-label').textContent = `P${slot}`;
      document.querySelectorAll('.leds i').forEach((el, i) => el.classList.toggle('active', i === slot - 1));
      $('remote-status').textContent = `Connected as Player ${slot}. Ready to play!`;
    }
    if (msg.type === 'error') { desired = false; $('remote-status').textContent = msg.message; $('join-form').hidden = false; $('remote-controls').hidden = true; socket.close(); }
    if (msg.type === 'rumble') navigator.vibrate?.(msg.duration);
  };
  socket.onclose = () => {
    joined = false; releaseAll();
    if (desired) { $('remote-status').textContent = 'Disconnected. Reconnecting…'; reconnectTimer = setTimeout(connect, 1500); }
  };
  socket.onerror = () => { $('remote-status').textContent = 'Cannot reach the room. Check Wi-Fi and keep the PC dashboard running.'; };
}
$('join-form').onsubmit = e => { e.preventDefault(); if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return; desired = true; connect(); };
$('leave').onclick = () => { desired = false; clearTimeout(reconnectTimer); socket?.close(); joined = false; $('join-form').hidden = false; $('remote-controls').hidden = true; $('remote-status').textContent = 'You left the room.'; };
function recenter() { baseAlpha = null; baseBeta = null; x = 0; y = 0; send({ shake: true }, true); }
$('recenter').onclick = recenter;
function releaseAll() {
  for (const button of held) send({ button, pressed: false }, true);
  held.clear(); document.querySelectorAll('.held').forEach(el => el.classList.remove('held'));
}
for (const button of document.querySelectorAll('[data-button]')) {
  button.addEventListener('contextmenu', e => e.preventDefault());
  button.onpointerdown = e => {
    e.preventDefault(); button.setPointerCapture(e.pointerId); held.add(button.dataset.button); button.classList.add('held');
    if (button.dataset.button === 'one') recenter();
    send({ button: button.dataset.button, pressed: true }, true); navigator.vibrate?.(12);
  };
  const release = e => {
    e.preventDefault(); if (!held.delete(button.dataset.button)) return;
    button.classList.remove('held'); send({ button: button.dataset.button, pressed: false, swing: button.dataset.button === 'b' ? swing : 0 }, true); swing = 0;
  };
  button.onpointerup = release; button.onpointercancel = release; button.onlostpointercapture = release;
}
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
$('enable-motion').onclick = async () => {
  if (motionEnabled) return;
  if (!window.isSecureContext) { $('sensor-status').textContent = 'Motion needs trusted HTTPS on this phone. Use the buttons now; see the PC README for sensor setup.'; return; }
  try {
    // Request both permissions directly from this user gesture (required by iOS).
    const requests = [window.DeviceMotionEvent, window.DeviceOrientationEvent].map(type => typeof type?.requestPermission === 'function' ? type.requestPermission() : Promise.resolve('granted'));
    const permissions = await Promise.all(requests);
    if (permissions.some(value => value !== 'granted')) throw new Error('Permission denied. Allow motion in your browser settings, then try again.');
    if (!window.DeviceMotionEvent && !window.DeviceOrientationEvent) throw new Error('This browser has no motion sensors. Use the remote buttons.');
    motionEnabled = true;
    $('sensor-status').textContent = 'Waiting for sensor data. Hold upright and tap Recenter.';
    window.addEventListener('deviceorientation', orientation);
    window.addEventListener('devicemotion', motion);
    setTimeout(() => { if (motionEnabled && baseAlpha === null) $('sensor-status').textContent = 'No orientation data received. Try another browser or use the buttons.'; }, 5000);
  } catch (error) { $('sensor-status').textContent = error.message; }
};
function orientation(e) {
  if (!Number.isFinite(e.alpha) || !Number.isFinite(e.beta)) return;
  baseAlpha ??= e.alpha; baseBeta ??= e.beta;
  const yaw = ((e.alpha - baseAlpha + 540) % 360) - 180;
  x = Math.max(-1, Math.min(1, yaw / 35)); y = Math.max(-1, Math.min(1, (e.beta - baseBeta) / 45));
  $('sensor-status').textContent = 'Motion active · Point to aim, swing to play, shake to recenter.';
  send({ pointing: true });
}
function motion(e) {
  const acceleration = e.acceleration || e.accelerationIncludingGravity;
  if (!acceleration) return;
  const values = [acceleration.x, acceleration.y, acceleration.z];
  if (!values.every(Number.isFinite)) return;
  const magnitude = Math.hypot(...values), now = performance.now();
  // Gravity-inclusive fallback uses a higher threshold to avoid firing while resting.
  const threshold = e.acceleration ? 10 : 21;
  if (magnitude > threshold && now - lastSwing > 650) {
    lastSwing = now; swing = Math.min(1, (magnitude - threshold) / 24 + .3);
    send({ swing }, true);
  }
  if (magnitude > threshold + 25 && now - lastShake > 1800 && !held.has('b')) {
    lastShake = now; recenter();
  }
}
