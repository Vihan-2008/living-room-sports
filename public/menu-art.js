// Everything the menu draws: animated channel tiles and banners (canvas), sport icons, the hand pointer
// and the clock digits (SVG). All artwork is original and drawn in code.

const TAU = Math.PI * 2;
const FONT = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function sky(ctx, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function hill(ctx, w, h, base, amp, phase, color) {
  ctx.beginPath(); ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += w / 24) ctx.lineTo(x, base + Math.sin(x / w * TAU * 1.2 + phase) * amp);
  ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function cloud(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.beginPath();
  ctx.arc(x, y, 14 * s, 0, TAU); ctx.arc(x + 16 * s, y - 7 * s, 17 * s, 0, TAU); ctx.arc(x + 34 * s, y, 13 * s, 0, TAU);
  ctx.fill();
  ctx.fillRect(x, y - 2 * s, 34 * s, 15 * s);
}
function title(ctx, text, x, y, size, { fill = '#fff', stroke = '#1d8fc6', align = 'center' } = {}) {
  ctx.font = `700 ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.22; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function tennisBall(ctx, x, y, r) {
  ctx.fillStyle = '#d7e94a'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.18;
  ctx.beginPath(); ctx.arc(x - r * 1.05, y, r * 0.8, -0.9, 0.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + r * 1.05, y, r * 0.8, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
}
function pin(ctx, x, y, s, tilt) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(s, s);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(40,60,70,.25)'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-5, 0); ctx.bezierCurveTo(-12, -14, -4, -22, -4, -30); ctx.bezierCurveTo(-7, -38, -5, -46, 0, -46);
  ctx.bezierCurveTo(5, -46, 7, -38, 4, -30); ctx.bezierCurveTo(4, -22, 12, -14, 5, 0); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e2493f'; ctx.fillRect(-4.3, -31, 8.6, 2.4); ctx.fillRect(-4.6, -27.5, 9.2, 2.4);
  ctx.restore();
}
function flag(ctx, x, y, t, s = 1) {
  ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = 2.4 * s; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 44 * s); ctx.stroke();
  ctx.fillStyle = '#e8463c'; ctx.beginPath(); ctx.moveTo(x, y - 44 * s);
  for (let i = 0; i <= 8; i++) ctx.lineTo(x + i * 3 * s, y - 44 * s + Math.sin(t * 6 + i * 0.7) * 1.6 * s + i * 0.15 * s);
  for (let i = 8; i >= 0; i--) ctx.lineTo(x + i * 3 * s, y - 31 * s + Math.sin(t * 6 + i * 0.7) * 1.6 * s - i * 0.15 * s);
  ctx.closePath(); ctx.fill();
}

// ---- Channels ----------------------------------------------------------------------------------
function sportsChannel(ctx, w, h, t, banner) {
  sky(ctx, w, h, '#7ccbf0', '#e6f6fc');
  ctx.fillStyle = 'rgba(255,244,190,.9)'; ctx.beginPath(); ctx.arc(w * 0.84, h * 0.2, h * 0.11, 0, TAU); ctx.fill();
  cloud(ctx, ((t * 9) % (w + 120)) - 60, h * 0.18, h / 260);
  cloud(ctx, ((t * 6 + w * 0.6) % (w + 120)) - 60, h * 0.32, h / 340);
  hill(ctx, w, h, h * 0.66, h * 0.05, 0.6, '#9fd667');
  hill(ctx, w, h, h * 0.76, h * 0.04, 2.4, '#74bf45');
  const ground = h * 0.8;
  // Tennis ball on a bouncing arc, a pin that wobbles, a flag in the breeze.
  const phase = (t * 0.55) % 1;
  // On the banner the bounce stays under the subtitle so the ball never crosses the lettering.
  const bx = w * (0.18 + phase * 0.42), by = ground - 6 - Math.abs(Math.sin(phase * Math.PI * 2)) * h * (banner ? 0.2 : 0.38);
  ctx.fillStyle = 'rgba(30,70,30,.18)'; ctx.beginPath(); ctx.ellipse(bx, ground - 2, h * 0.04, h * 0.012, 0, 0, TAU); ctx.fill();
  tennisBall(ctx, bx, by, h * 0.045);
  pin(ctx, w * 0.74, ground - 2, h / 150, Math.sin(t * 2.2) * 0.08);
  pin(ctx, w * 0.69, ground + 2, h / 175, Math.sin(t * 2.2 + 1) * 0.06);
  flag(ctx, w * 0.9, ground - 6, t, h / 150);
  if (banner) {
    title(ctx, 'Wii Sports', w / 2, h * 0.36, h * 0.15);
    ctx.font = `600 ${h * 0.05}px ${FONT}`; ctx.fillStyle = '#1b6f99'; ctx.textAlign = 'center';
    ctx.fillText('Wii Sports and Wii Sports Resort', w / 2, h * 0.5);
  } else title(ctx, 'Wii Sports', w / 2, h * 0.3, h * 0.2);
}

function kart(ctx, x, y, s, angle, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(0, 9, 19, 6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2b2f33';
  for (const [wx, wy] of [[-12, -7], [12, -7], [-12, 7], [12, 7]]) { roundRect(ctx, wx - 4.5, wy - 3.5, 9, 7, 2.5); ctx.fill(); }
  ctx.fillStyle = color; roundRect(ctx, -15, -6, 30, 12, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)'; roundRect(ctx, -12, -5, 24, 3.5, 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-2, -7, 5.4, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2fb6e8'; ctx.beginPath(); ctx.arc(-2, -7, 5.4, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  ctx.restore();
}
function mkwChannel(ctx, w, h, t, banner) {
  sky(ctx, w, h, '#ffcf5a', '#fff1c4');
  ctx.fillStyle = '#86c94f'; ctx.fillRect(0, h * 0.42, w, h);
  // A looping track: a wide ellipse seen from above, with curbs and a dashed centre line.
  const cx = w / 2, cy = h * 0.72, rx = w * 0.42, ry = h * 0.2;
  ctx.lineWidth = h * 0.15; ctx.strokeStyle = '#e8473c'; ctx.setLineDash([h * 0.04, h * 0.04]);
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]); ctx.strokeStyle = '#6f777c'; ctx.lineWidth = h * 0.13;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = h * 0.012; ctx.setLineDash([h * 0.04, h * 0.05]);
  ctx.lineDashOffset = -t * h * 0.3;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  // Start line.
  const size = h * 0.022;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#222' : '#fff'; ctx.fillRect(cx - size + j * size, cy + ry - h * 0.065 + i * size, size, size); }
  const karts = [['#e8473c', 0], ['#2fb6e8', 0.6], ['#5cb85c', 1.25]];
  for (const [color, offset] of karts) {
    const a = t * 0.9 + offset, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    kart(ctx, x, y, h / (banner ? 200 : 120), Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx), color);
  }
  // Checkered flag waving at the top right.
  const fx = w * 0.82, fy = h * 0.1;
  ctx.strokeStyle = '#555'; ctx.lineWidth = h * 0.012; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy + h * 0.28); ctx.stroke();
  const cell = h * 0.032;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    ctx.fillStyle = (i + j) % 2 ? '#222' : '#fff';
    ctx.fillRect(fx + i * cell, fy + j * cell + Math.sin(t * 5 + i * 0.9) * cell * 0.35, cell, cell);
  }
  if (banner) title(ctx, 'Mario Kart Wii', w / 2, h * 0.24, h * 0.13, { stroke: '#c23a2f' });
  else title(ctx, 'Mario Kart Wii', w / 2, h * 0.25, h * 0.17, { stroke: '#c23a2f' });
}

function arcadeChannel(ctx, w, h, t, banner) {
  sky(ctx, w, h, '#2b9fd6', '#7fd0f2');
  ctx.fillStyle = 'rgba(255,255,255,.1)';
  for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(((i * 173 + t * 14) % (w + 80)) - 40, h * (0.2 + (i % 3) * 0.28), h * 0.09, 0, TAU); ctx.fill(); }
  // The app's own phone remote, rocking gently.
  ctx.save(); ctx.translate(w * 0.5, h * 0.6); ctx.rotate(Math.sin(t * 1.6) * 0.12); ctx.scale(h / 260, h / 260);
  ctx.fillStyle = '#fff'; roundRect(ctx, -26, -88, 52, 176, 24); ctx.fill();
  ctx.fillStyle = '#9ab3bf'; ctx.fillRect(-16, -62, 32, 10); ctx.fillRect(-5, -73, 10, 32);
  ctx.fillStyle = '#139ed3'; ctx.beginPath(); ctx.arc(0, -20, 13, 0, TAU); ctx.fill();
  ['#149ed4', '#ef665e', '#61b968', '#e1ab23'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-18 + i * 12, 66, 4.2, 0, TAU); ctx.fill(); });
  ctx.restore();
  tennisBall(ctx, w * 0.22, h * 0.66 + Math.sin(t * 2.4) * h * 0.05, h * 0.06);
  pin(ctx, w * 0.8, h * 0.82, h / 130, Math.sin(t * 2) * 0.1);
  if (banner) title(ctx, 'Living Room Sports', w / 2, h * 0.2, h * 0.11, { stroke: '#0c6c99' });
  else title(ctx, 'Living Room Sports', w / 2, h * 0.2, h * 0.15, { stroke: '#0c6c99' });
}

const CHANNELS = { sports: sportsChannel, mkw: mkwChannel, arcade: arcadeChannel };
// scale: how much the stage is enlarged on screen, so tiles stay sharp in full screen.
export function drawChannel(canvas, id, time, banner = false, scale = 1) {
  const ratio = Math.min(3, (globalThis.devicePixelRatio || 1) * scale);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  CHANNELS[id]?.(ctx, w, h, time, banner);
}

// ---- SVG ---------------------------------------------------------------------------------------
const svg = (body, view = '0 0 64 64') => `<svg viewBox="${view}" aria-hidden="true" focusable="false">${body}</svg>`;

// Sport icons: one glyph per sport on a soft round badge, in a shared stroke weight.
const ICONS = {
  tennis: '<circle cx="25" cy="25" r="15" fill="none" stroke="#3b6f8f" stroke-width="4"/><path d="M15 15l20 20M15 25h20M25 15v20" stroke="#3b6f8f" stroke-width="1.6" opacity=".6"/><path d="M36 36l12 12" stroke="#3b6f8f" stroke-width="6" stroke-linecap="round"/><circle cx="47" cy="19" r="7" fill="#d4e648"/><path d="M41 17q6 2 12 0" stroke="#fff" stroke-width="1.6" fill="none"/>',
  baseball: '<path d="M14 50L44 14" stroke="#b07a3c" stroke-width="7" stroke-linecap="round"/><circle cx="44" cy="44" r="11" fill="#fff" stroke="#c9cfd2" stroke-width="1.5"/><path d="M37 37q4 7 0 14M51 37q-4 7 0 14" stroke="#e2493f" stroke-width="1.8" fill="none"/>',
  bowling: '<circle cx="23" cy="42" r="13" fill="#3a6ea5"/><circle cx="19" cy="37" r="2" fill="#1f3f63"/><circle cx="26" cy="35" r="2" fill="#1f3f63"/><path d="M45 54c-6-9 1-15 0-21c-2-4-1-10 3-10s5 6 3 10c-1 6 6 12 0 21z" fill="#fff" stroke="#c9cfd2" stroke-width="1.5"/><path d="M44 33h8M44 36h8" stroke="#e2493f" stroke-width="2"/>',
  golf: '<path d="M10 50q22-10 44 0" fill="#7cc24e"/><path d="M34 47V12" stroke="#7b8287" stroke-width="2.6"/><path d="M34 12l15 6l-15 6z" fill="#e8463c"/><circle cx="20" cy="44" r="4.5" fill="#fff" stroke="#c9cfd2"/>',
  boxing: '<path d="M18 30c0-11 8-16 18-16c11 0 16 8 16 18c0 9-6 15-14 15H26c-5 0-8-3-8-8z" fill="#e24a3f"/><path d="M18 34c-5 0-7 3-7 7s3 7 8 6" fill="#c63a30"/><rect x="24" y="46" width="20" height="9" rx="3" fill="#f2f2f2" stroke="#c9cfd2"/><path d="M29 26q8-4 15 2" stroke="#fff" stroke-width="2.5" fill="none" opacity=".6" stroke-linecap="round"/>',
  swordplay: '<path d="M18 46L46 18" stroke="#d8b26b" stroke-width="7" stroke-linecap="round"/><path d="M13 41l10 10" stroke="#4d5a62" stroke-width="5" stroke-linecap="round"/><path d="M10 54l6-6" stroke="#7b5a3a" stroke-width="5" stroke-linecap="round"/>',
  wakeboarding: '<path d="M6 46q8-6 16 0t16 0t16 0t10-2" stroke="#2fb6e8" stroke-width="4" fill="none" stroke-linecap="round"/><rect x="16" y="32" width="32" height="8" rx="4" transform="rotate(-12 32 36)" fill="#f2a33a"/><path d="M40 22q6-8 14-10" stroke="#7b8287" stroke-width="2" fill="none"/>',
  frisbee: '<ellipse cx="34" cy="34" rx="20" ry="9" fill="#ef7d3a"/><ellipse cx="34" cy="31" rx="13" ry="4.5" fill="#f6a066"/><path d="M8 22h10M6 30h8M10 38h6" stroke="#9bc6da" stroke-width="3" stroke-linecap="round"/>',
  archery: '<circle cx="34" cy="34" r="20" fill="#fff" stroke="#c9cfd2"/><circle cx="34" cy="34" r="14" fill="#2fb6e8"/><circle cx="34" cy="34" r="8" fill="#e8463c"/><circle cx="34" cy="34" r="3" fill="#f6d34a"/><path d="M10 10l24 24" stroke="#6a5137" stroke-width="2.6"/><path d="M8 8l6 1l-1 6z" fill="#6a5137"/>',
  basketball: '<circle cx="32" cy="32" r="19" fill="#ef8a2f"/><path d="M13 32h38M32 13v38M19 18q10 14 0 28M45 18q-10 14 0 28" stroke="#8f4a16" stroke-width="2" fill="none"/>',
  tabletennis: '<circle cx="26" cy="28" r="14" fill="#d9443a"/><path d="M34 38l12 12" stroke="#a87a4a" stroke-width="7" stroke-linecap="round"/><circle cx="48" cy="18" r="5" fill="#fff" stroke="#c9cfd2"/>',
  cruising: '<path d="M6 46q8-5 16 0t16 0t16 0" stroke="#2fb6e8" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M12 38h38l-6-8H24z" fill="#e8463c"/><path d="M30 30v-8h8" stroke="#4d5a62" stroke-width="3" fill="none" stroke-linecap="round"/>',
  canoeing: '<path d="M8 40q24 12 48 0q-24 4-48 0z" fill="#d68a3c"/><path d="M42 14L24 46" stroke="#7b5a3a" stroke-width="3" stroke-linecap="round"/><ellipse cx="22" cy="48" rx="4" ry="7" transform="rotate(30 22 48)" fill="#7b5a3a"/>',
  cycling: '<circle cx="18" cy="42" r="10" fill="none" stroke="#3b6f8f" stroke-width="3.5"/><circle cx="46" cy="42" r="10" fill="none" stroke="#3b6f8f" stroke-width="3.5"/><path d="M18 42l9-16h12l7 16M27 26l5 16h-14M36 20h7" stroke="#e8463c" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
  airsports: '<path d="M10 36l44-14l-6 8l-20 8l-4 10l-4-2l1-8z" fill="#fff" stroke="#9aa6ad" stroke-width="1.5" stroke-linejoin="round"/><path d="M30 31l-6-10l5-1l9 9" fill="#2fb6e8"/><path d="M12 48q8 4 16 0" stroke="#bfe3f3" stroke-width="3" fill="none" stroke-linecap="round"/>'
};
export const sportIcon = name => svg(`<circle cx="32" cy="32" r="30" fill="#eef7fb"/>${ICONS[name] || ''}`);

// The pointer hand: every part outlined first, then filled, so the outline traces one silhouette.
const HAND_PARTS = [
  '<rect x="16" y="1" width="11" height="28" rx="5.5"/>',
  '<rect x="7" y="21" width="32" height="27" rx="11"/>',
  '<ellipse cx="7.5" cy="33" rx="5.5" ry="9" transform="rotate(-24 7.5 33)"/>',
  '<circle cx="31" cy="23" r="5.5"/>', '<circle cx="37" cy="27" r="4.6"/>'
].join('');
export function handSvg(color, label) {
  return svg(`<g fill="#3d4549" stroke="#3d4549" stroke-width="5" stroke-linejoin="round">${HAND_PARTS}</g>
    <g fill="#fff">${HAND_PARTS}</g>
    <path d="M18 27q4 2 8 0" stroke="#c7ced2" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <circle cx="23" cy="37" r="8.5" fill="${color}"/>
    <text x="23" y="40.6" text-anchor="middle" font-family='${FONT}' font-size="11" font-weight="700" fill="#fff">${label}</text>`, '-4 -4 52 58');
}
export const HAND_HOTSPOT = { x: (21.5 + 4) / 52, y: (1 + 4) / 58 };

// Rounded clock digits, drawn as single strokes with round ends.
const DIGITS = {
  0: 'M5 9Q5 2 13 2Q21 2 21 9V31Q21 38 13 38Q5 38 5 31Z',
  1: 'M8 8L14 2V38',
  2: 'M5 9Q5 2 13 2Q21 2 21 9.5Q21 15 15 21L5 38H21',
  3: 'M5 7Q8 2 13 2Q21 2 21 10Q21 19 12 19Q21 19 21 29Q21 38 13 38Q7 38 4.5 33',
  4: 'M16 38V2L4 27H22',
  5: 'M20 2H7L6 18Q9 15 13 15Q21 15 21 26.5Q21 38 13 38Q7 38 4.5 34',
  6: 'M19 5Q16 2 13 2Q5 2 5 17V29Q5 38 13 38Q21 38 21 28.5Q21 19 13 19Q5 19 5 27',
  7: 'M4 2H21L10 38',
  8: 'M13 19Q5 19 5 10.5Q5 2 13 2Q21 2 21 10.5Q21 19 13 19Q4 19 4 28.5Q4 38 13 38Q22 38 22 28.5Q22 19 13 19Z',
  9: 'M21 13Q21 21 13 21Q5 21 5 11.5Q5 2 13 2Q21 2 21 12V23Q21 38 13 38Q9 38 6 35'
};
// colon: false dims the separator, for the once-a-second blink.
export function clockSvg(text, { colon = true } = {}) {
  let x = 0;
  const parts = [];
  for (const ch of text) {
    if (ch === ':') { parts.push(`<g fill="currentColor" stroke="none" opacity="${colon ? 1 : 0.3}"><circle cx="${x + 5}" cy="13" r="2.6"/><circle cx="${x + 5}" cy="29" r="2.6"/></g>`); x += 12; }
    else if (DIGITS[ch]) { parts.push(`<path transform="translate(${x} 0)" d="${DIGITS[ch]}"/>`); x += 27; }
  }
  return svg(`<g fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g>`, `-3 -2 ${x + 4} 44`);
}

// Small glyphs for the bottom shelf and status rows.
export const GLYPHS = {
  phones: svg('<rect x="10" y="6" width="22" height="40" rx="5" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="21" cy="39" r="2.4" fill="currentColor"/><rect x="34" y="18" width="20" height="36" rx="5" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M40 28h8M44 24v8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'),
  check: svg('<circle cx="32" cy="32" r="28" fill="#5cb85c"/><path d="M19 33l9 9l17-19" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  alert: svg('<circle cx="32" cy="32" r="28" fill="#f0a42f"/><path d="M32 17v19" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="32" cy="46" r="3.6" fill="#fff"/>'),
  arrow: svg('<path d="M40 12L20 32l20 20" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>')
};
