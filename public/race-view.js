import { standings } from './kart.js';
export function drawRace(ctx, race) {
  const { course } = race;
  ctx.fillStyle = course.color; ctx.fillRect(0, 0, 1000, 560);
  const point = (distance, lane = 0) => {
    const a = distance / course.length * Math.PI * 2 - Math.PI / 2;
    return [500 + Math.cos(a) * (340 + lane * 47), 285 + Math.sin(a) * (170 + lane * 47), a];
  };
  const oval = (rx, ry, color, width) => {
    ctx.beginPath(); ctx.ellipse(500, 285, rx, ry, 0, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  oval(340, 170, '#f8ede4', 112 * course.width);
  oval(340, 170, course.road, 96 * course.width);
  ctx.setLineDash([15, 18]); oval(340, 170, '#ffffff75', 2); ctx.setLineDash([]);
  // A checkered start/finish line, with the course remaining fully visible for all players.
  for (let x = 0; x < 3; x++) for (let y = 0; y < 8; y++) {
    ctx.fillStyle = (x + y) % 2 ? '#fff' : '#284c60'; ctx.fillRect(485 + x * 10, 65 + y * 12, 10, 12);
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffffffdc'; ctx.font = 'bold 28px Trebuchet MS';
  ctx.fillText(course.name, 500, 255);
  ctx.font = '17px Trebuchet MS'; ctx.fillText('3 laps · Auto accelerate · A to use item', 500, 285);
  ctx.fillText('Steer with ← → or phone pointing · Hold B to drift', 500, 313);
  for (let d = 450; d < course.length; d += 450) {
    const [x, y] = point(d); ctx.fillStyle = '#f7cf55'; ctx.fillRect(x - 9, y - 9, 18, 18);
    ctx.fillStyle = '#284c60'; ctx.font = 'bold 16px Trebuchet MS'; ctx.fillText('?', x, y + 6);
  }
  for (const p of race.racers) {
    const [x, y, angle] = point(p.distance, p.lane);
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = '#233c4b';
    for (const side of [-1, 1]) { ctx.fillRect(side * 12 - 4, -14, 8, 12); ctx.fillRect(side * 12 - 4, 5, 8, 12); }
    ctx.fillStyle = p.stun > 0 ? '#ffffff' : p.color; ctx.fillRect(-11, -18, 22, 36);
    ctx.fillStyle = '#f8d2ac'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    if (p.boost > 0 || p.drift > .65) { ctx.fillStyle = '#ffcf5a'; ctx.fillRect(-7, 19, 14, 12); }
    if (p.shield > 0) { ctx.strokeStyle = '#9aeaff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 27, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore(); ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Trebuchet MS'; ctx.fillText(p.bot ? 'CPU' : p.slot ? `P${p.slot}` : 'You', x, y - 30);
  }
  ctx.fillStyle = '#ffffffed'; ctx.fillRect(15, 15, 300, 30);
  ctx.fillStyle = '#284c60'; ctx.textAlign = 'left'; ctx.font = '17px Trebuchet MS';
  ctx.fillText(`${Math.max(0, race.time).toFixed(1)} s · ${standings(race)[0].name} leads`, 25, 36);
  if (race.time < 0) {
    ctx.textAlign = 'center'; ctx.font = 'bold 90px Trebuchet MS'; ctx.fillStyle = '#fff'; ctx.fillText(Math.ceil(-race.time), 500, 430);
  }
  ctx.textAlign = 'left';
}
