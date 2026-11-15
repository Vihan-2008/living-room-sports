import { sports, evaluate, timingAt } from './games.js';
import { createRace, raceInput, stepRace, standings } from './kart.js';
import { drawRace } from './race-view.js';
import { createSportsMatch, resolveShot, matchLabel, matchResult } from './sports-match.js';
const $ = id => document.getElementById(id);
let players = [], selected = 0, game = null, match = [], turn = 0, finished = false;
let aim = 0, power = .7, block = false, busy = false, charging = false, chargeStart = 0, advanceTimer;
let shot = null, lastPlay = 0, socket;
let race = null, sportMatch = null, lastFrame = null, lastHud = 0;
const canvas = $('court'), ctx = canvas.getContext('2d');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.onopen = () => { socket.send(JSON.stringify({ type: 'host' })); $('connection').textContent = 'Room online'; };
  socket.onclose = () => {
    releaseSportsControls();
    if (race) for (const p of race.racers) if (!p.bot) raceInput(race, p.slot, { cancel: true });
    $('connection').textContent = 'Reconnecting…'; setTimeout(connect, 1500);
  };
  socket.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'roster') {
      const activeRemoteLost = sportMatch && players.some(p => p.slot === match[turn].slot && p.connected) && !msg.players.some(p => p.slot === match[turn].slot && p.connected);
      players = msg.players;
      if (race) for (const p of race.racers) if (!p.bot && p.slot > 0 && !players.some(q => q.slot === p.slot && q.connected)) raceInput(race, p.slot, { cancel: true });
      if (activeRemoteLost) releaseSportsControls();
      renderPlayers(); if (game) renderScores();
    }
    if (msg.type === 'error') $('connection').textContent = msg.message;
    if (msg.type === 'input') input(msg);
  };
}
function renderPlayers() {
  $('players').replaceChildren();
  for (const p of players) {
    const item = document.createElement('div'); item.className = `player ${p.connected ? '' : 'off'}`; item.style.setProperty('--p', p.color);
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.innerHTML = '<i></i>';
    const info = document.createElement('div'), name = document.createElement('strong'), status = document.createElement('small');
    name.textContent = p.connected ? p.name : `Player ${p.slot}`; status.textContent = p.connected ? `P${p.slot} · Connected` : 'Ready to join';
    info.append(name, status); item.append(avatar, info); $('players').append(item);
  }
  $('player-count').textContent = `${players.filter(p => p.connected).length} remotes connected`;
}
function select(index) { selected = (index + sports.length) % sports.length; document.querySelectorAll('.channel').forEach((el, i) => el.classList.toggle('selected', i === selected)); }
for (const [i, sport] of sports.entries()) {
  const button = document.createElement('button'); button.className = 'channel'; button.style.setProperty('--art', sport.color);
  button.innerHTML = `<div class="channel-art"><span aria-hidden="true">${sport.icon}</span></div><div class="channel-title"><strong>${sport.name}</strong><small>${sport.sport} · 1–4 players</small></div>`;
  button.onfocus = () => select(i); button.onclick = () => start(i); $('channels').append(button);
}
select(0);
function start(index) {
  clearTimeout(advanceTimer); select(index); game = sports[index];
  match = players.filter(p => p.connected).map(p => ({ ...p, score: 0 }));
  if (!match.length) match = [{ slot: 0, name: 'You (keyboard)', color: '#139ed3', score: 0 }];
  race = game.id === 'kart' ? createRace(match, Number($('course').value)) : null;
  sportMatch = race ? null : createSportsMatch(game.id, match);
  if (sportMatch) match = sportMatch.players;
  lastFrame = null;
  turn = 0; finished = false; busy = false; shot = null; aim = 0; power = .7; charging = false; block = false;
  lastPlay = -Infinity;
  $('menu').hidden = true; $('game').hidden = false; $('game-title').textContent = game.name;
  $('game-help').textContent = sportMatch?.sides ? game.versusHelp : game.help;
  $('course-picker').hidden = !race; $('power-label').hidden = !!race; $('timing-label').hidden = !!race;
  $('action').textContent = race ? 'Use item (A)' : 'Play / Swing (A)';
  $('controls-help').textContent = race ? 'Auto accelerate. Point or use left/right to steer. B drifts, Down brakes, A uses an item. Escape / Home returns to the menu.' : 'Left/right aim. Space / A swings. Hold B to charge or block. Home / Escape returns to menu. Shake or 1 recenters.';
  $('result').textContent = ''; $('action').disabled = false; renderScores();
}
function home() { clearTimeout(advanceTimer); game = null; race = null; sportMatch = null; charging = false; block = false; $('menu').hidden = false; $('game').hidden = true; }
function renderScores() {
  if (race) {
    $('round').textContent = race.finished ? 'Race complete' : race.time < 0 ? 'Get ready…' : 'Three-lap race';
    $('turn').textContent = 'Everyone races together'; $('scores').replaceChildren();
    for (const [i, p] of standings(race).entries()) {
      const row = document.createElement('p'); row.style.color = p.color;
      row.textContent = `${i + 1}. ${p.name} · ${p.finishTime !== null ? p.finishTime.toFixed(1) + ' s' : race.finished ? 'Did not finish' : 'Lap ' + Math.min(3, Math.floor(p.distance / race.course.length) + 1) + '/3'} · ${p.item || 'No item'}`;
      $('scores').append(row);
    }
    const controlled = keyboardRacer();
    $('action').disabled = race.finished || !controlled?.item;
    return;
  }
  $('round').textContent = matchLabel(sportMatch);
  const current = match[turn];
  const offline = current.slot && !players.some(p => p.slot === current.slot && p.connected);
  $('turn').textContent = finished ? 'Good game, everyone!' : `${current.name}’s turn${offline ? ' (offline: use keyboard)' : ''}`;
  $('scores').replaceChildren();
  const label = p => { const name = document.createElement('span'); name.textContent = `${p.slot ? 'P' + p.slot + ' ' : ''}${p.name}`; name.style.color = p.color; return name; };
  // Head to head, each side gets one row: its players and the side's games or health.
  const rows = sportMatch.sides
    ? sportMatch.sides.map(side => ({ members: side.members.map(i => match[i]), score: game.id === 'tennis' ? `${side.games} ${side.games === 1 ? 'game' : 'games'}` : `${side.health} health` }))
    : match.map(p => ({ members: [p], score: `${p.score} ${game.unit}` }));
  for (const { members, score } of rows) {
    const row = document.createElement('p'), names = document.createElement('span'), value = document.createElement('strong');
    members.forEach((p, i) => { if (i) names.append(' & '); names.append(label(p)); });
    value.textContent = score; row.append(names, value); $('scores').append(row);
  }
}
function play(strength) {
  if (race) { const p = keyboardRacer(); if (p) raceInput(race, p.slot, { button: 'a', pressed: true }); return; }
  if (!game || busy || finished || performance.now() - lastPlay < 500) return;
  lastPlay = performance.now(); busy = true; charging = false;
  const t = timingAt(performance.now());
  const target = game.id === 'tennis' ? Math.sin(performance.now() * .0007) * .4 : game.id === 'boxing' ? Math.sin(performance.now() * .001) * .45 : 0;
  const result = evaluate(game.id, { aim: aim - target, power: strength ?? power, timing: t, block });
  const pinsBefore = game.id === 'bowling' ? match[turn].pins : 10;
  const text = resolveShot(sportMatch, result, { block });
  shot = { ...result, score: Math.min(pinsBefore, result.score), pinsBefore, aim, start: performance.now(), power: strength ?? power };
  $('result').textContent = text; $('action').disabled = true;
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'rumble', slot: match[turn].slot, duration: result.score > 0 ? 100 : 40 }));
  renderScores();
  advanceTimer = setTimeout(() => {
    turn = sportMatch.turn; finished = sportMatch.finished;
    busy = false; shot = null; power = .7; aim = 0; block = false;
    if (finished) $('result').textContent = matchResult(sportMatch, game.unit);
    else { $('result').textContent = ''; $('action').disabled = false; }
    renderScores();
  }, 2000);
}
function input(m) {
  // Cancellation must work even while a dialog or shot animation owns input.
  if (m.cancel === true) {
    if (race) {
      const p = m.slot === 0 ? keyboardRacer() : race.racers.find(p => p.slot === m.slot && !p.bot);
      if (p) raceInput(race, p.slot, m);
    } else if (game && (m.slot === match[turn].slot || m.slot === 0)) {
      releaseSportsControls();
    }
    return;
  }
  if ($('pair-dialog').open) { if (m.button === 'home' && m.pressed) $('pair-dialog').close(); return; }
  if (!game) {
    if (!m.pressed) return;
    if (m.button === 'left' || m.button === 'minus') select(selected - 1);
    if (m.button === 'right' || m.button === 'plus') select(selected + 1);
    if (m.button === 'a' || m.button === 'two') start(selected);
    return;
  }
  if (race) {
    if (m.button === 'home' && m.pressed) return home();
    if (m.button === 'plus' && m.pressed && race.finished) return start(selected);
    const p = m.slot === 0 ? keyboardRacer() : race.racers.find(p => p.slot === m.slot && !p.bot);
    if (p) raceInput(race, p.slot, m);
    return;
  }
  if (m.slot !== match[turn].slot && m.slot !== 0) return;
  if (m.button === 'home' && m.pressed) return home();
  if (finished) { if (m.button === 'plus' && m.pressed) start(selected); return; }
  if (busy) return;
  if (m.pointing && Number.isFinite(m.x)) aim = m.x;
  if (m.shake || (m.button === 'one' && m.pressed)) aim = 0;
  if (m.button === 'left' && m.pressed) aim = clamp(aim - .12, -1, 1);
  if (m.button === 'right' && m.pressed) aim = clamp(aim + .12, -1, 1);
  if (m.button === 'b') {
    block = m.pressed;
    if (m.pressed) { charging = true; chargeStart = performance.now(); }
    else if (charging) { charging = false; if (game.id !== 'boxing') play(m.swing > .15 ? m.swing : power); }
  }
  if (((m.button === 'a' || m.button === 'two') && m.pressed) || (m.swing > .28 && (game.id !== 'golf' && game.id !== 'bowling' || !charging))) play(m.swing > .28 ? m.swing : undefined);
}
const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'a', ' ': 'a', Enter: 'a', b: 'b', Escape: 'home', Home: 'home', '1': 'one', '2': 'two', '+': 'plus', '-': 'minus' };
for (const type of ['keydown', 'keyup']) document.addEventListener(type, e => {
  if (e.target.matches('input, select, textarea') || $('pair-dialog').open) return;
  const button = keys[e.key]; if (!button || e.repeat) return;
  if (e.target.matches('button') && (e.key === 'Enter' || e.key === ' ')) return;
  e.preventDefault(); input({ slot: 0, button, pressed: type === 'keydown' });
});
$('action').onclick = () => play(); $('home').onclick = home; $('restart').onclick = () => start(selected);
$('course').onchange = () => { if (race) start(selected); };
function keyboardRacer() {
  const active = race?.racers.filter(p => !p.bot && p.finishTime === null) || [];
  return active.find(p => p.slot === 0) || active.find(p => !players.some(q => q.slot === p.slot && q.connected)) || active[0];
}
function releaseSportsControls() { charging = false; block = false; }
window.addEventListener('blur', () => input({ slot: 0, cancel: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden) input({ slot: 0, cancel: true }); });
for (const id of ['pair', 'pair-bottom']) $(id).onclick = () => {
  releaseSportsControls();
  if (race) for (const p of race.racers) if (!p.bot) raceInput(race, p.slot, { cancel: true });
  $('pair-dialog').showModal();
  loadJoinLinks();
};
$('close-pair').onclick = () => $('pair-dialog').close();
async function loadJoinLinks() {
  $('join-links').replaceChildren();
  $('join-links').textContent = 'Loading QR codes…';
  try {
    const response = await fetch('/config');
    if (!response.ok) throw new Error('Configuration unavailable');
    const config = await response.json();
    $('room-code').textContent = config.code;
    const current = new URL(location.href);
    const local = /^(localhost|.*\.localhost|127\.[\d.]+|0\.0\.0\.0|\[::1\]|\[::\])$/i.test(current.hostname);
    const links = [...new Set([...(local ? [] : [`${current.origin}/remote?code=${config.code}`]), ...config.addresses])];
    $('join-links').textContent = '';
    if (!links.length) $('join-links').textContent = 'No phone-accessible network address found. Connect this PC to Wi-Fi, then close and reopen this dialog. Localhost only opens on this PC.';
    for (const [i, url] of links.entries()) {
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      const image = document.createElement('img'); image.src = `/qr?url=${encodeURIComponent(url)}`;
      image.alt = `Scan to join up to four players${i ? ' (alternate network)' : ''}`;
      image.width = 270; image.height = 270;
      const label = document.createElement('span'); label.textContent = i ? 'Alternate network' : 'Scan to play · Up to 4 players';
      const fallback = document.createElement('small'); fallback.textContent = url;
      image.onerror = () => { image.hidden = true; label.textContent = 'QR unavailable. Open this phone link.'; };
      a.append(image, label, fallback); $('join-links').append(a);
    }
  } catch { $('join-links').textContent = 'Unable to load join links. Keep the app running, then close and reopen this dialog to retry.'; }
}
loadJoinLinks();
function clock() { const now = new Date(); $('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); $('date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); }
clock(); setInterval(clock, 1000); connect();

// All sports artwork is drawn here from basic shapes; no downloaded game assets.
function rect(x,y,w,h,color) { ctx.fillStyle=color;ctx.fillRect(x,y,w,h); }
function circle(x,y,r,color) { ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill(); }
function line(x,y,x2,y2,color,width=3) { ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke(); }
function polygon(points,color) { ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill(); }
function draw(now) {
  requestAnimationFrame(draw); if (!game) return;
  if (race) {
    // Pause simulation under the pairing modal; cap elapsed time after tab suspension.
    const dt = lastFrame === null || $('pair-dialog').open ? 0 : (now - lastFrame) / 1000; lastFrame = now;
    stepRace(race, dt); drawRace(ctx, race);
    if (now - lastHud > 100) { renderScores(); lastHud = now; }
    if (race.finished) { const winner = standings(race)[0]; $('result').textContent = `${winner.name} wins! New match to race again.`; }
    return;
  }
  if (!busy && !finished) power = charging ? clamp((now-chargeStart)/1400, .05, 1) : .25 + .75 * timingAt(now * .65);
  $('power').value = power; $('timing').style.left = `${timingAt(now)*100}%`;
  const progress = shot ? clamp((now-shot.start)/1200,0,1) : 0;
  rect(0,0,1000,560,'#bfeafa'); circle(835,90,42,'#fff2b9');
  for(let i=0;i<4;i++){circle(110+i*240,75+(i%2)*25,27,'#ffffffa0');circle(138+i*240,70+(i%2)*25,36,'#ffffffa0');}
  rect(0,300,1000,260,'#89cfa4');
  if(game.id==='bowling') {
    rect(0,0,1000,560,'#d9eef5');rect(60,50,880,100,'#74b7d0');
    for(let i=0;i<5;i++)circle(180+i*160,100,16,'#ffffff90');
    polygon([[330,150],[670,150],[930,560],[70,560]],'#dfbf8d');
    for(let i=0;i<9;i++)line(330+i*42,150,70+i*107,560,'#cfa877',2);
    line(100,520,900,520,'#fff9',5);
    let pin=0;for(let row=0;row<4;row++)for(let c=0;c<=row;c++){
      const x=500+(c-row/2)*37,y=190-row*20;
      const number = pin++;
      const standing = shot ? shot.pinsBefore : match[turn].pins;
      if(number < standing && (!shot || progress < .8 || number >= shot.score)){rect(x-6,y-15,12,28,'#fff');circle(x,y-17,7,'#fff');rect(x-6,y-8,12,4,'#f16f69');}
    }
    const p=progress;circle(500+(shot?shot.aim:aim)*180*p,495-p*295,25-p*13,'#355d91');
    circle(493+(shot?shot.aim:aim)*180*p,488-p*295,4,'#a0c4ed');
  } else if(game.id==='tennis') {
    polygon([[270,180],[730,180],[940,560],[60,560]],'#4bb6a4');
    polygon([[300,210],[700,210],[870,535],[130,535]],'#71c4b4');
    line(300,210,130,535,'#fff');line(700,210,870,535,'#fff');line(300,210,700,210,'#fff');line(130,535,870,535,'#fff');line(500,210,500,535,'#fff');
    rect(180,340,640,9,'#fff');for(let x=190;x<820;x+=16)line(x,350,x,392,'#ffffff80',1);
    line(180,330,180,409,'#477d92',6);line(820,330,820,409,'#477d92',6);
    const t=timingAt(now);circle(500+Math.sin(now*.0007)*120,220,25,'#3188a0');
    circle(shot?500+shot.aim*280*progress:500+Math.sin(now*.002)*60,shot?480-progress*290:200+t*280,13,'#edff73');
    ctx.strokeStyle='#ef795e';ctx.lineWidth=8;ctx.beginPath();ctx.ellipse(500+aim*300,470,32,43,-.3,0,Math.PI*2);ctx.stroke();line(510+aim*300,505,530+aim*300,550,'#fff',10);
  } else if(game.id==='boxing') {
    rect(0,0,1000,560,'#c2deef');rect(80,220,840,340,'#698eb4');
    for(let i=0;i<3;i++)line(80,240+i*80,920,240+i*80,i===1?'#fff':'#e77e76',9);
    for(const x of [80,920])rect(x,180,15,380,'#4f739a');
    circle(500,185,45,'#e8c9a6');rect(440,225,120,160,'#e9f1f6');
    const target=500+Math.sin(now*.001)*135;circle(target,300,53,'#294e73');circle(target,300,30,'#fff');circle(target,300,12,'#ed897b');
    const punch=shot?Math.sin(progress*Math.PI)*130:0;
    circle(340+aim*160,495-punch,56,'#f1786b');circle(650+aim*90,495-(block?70:0),56,'#f1786b');
    rect(300+aim*160,525-punch,80,45,'#fff');
    // Head to head, the left bar is the first side and the right bar the second.
    const health = sportMatch.sides ? sportMatch.sides.map(side => side.health) : match[turn].health;
    rect(150,70,250,18,'#ffffff88');rect(600,70,250,18,'#ffffff88');
    rect(150,70,health[0]*2.5,18,'#61b995');rect(600,70,health[1]*2.5,18,'#ed8e78');
  } else if(game.id==='golf') {
    polygon([[0,280],[180,180],[350,280]],'#75bca9');polygon([[630,280],[820,170],[1000,280]],'#75bca9');
    ctx.fillStyle='#b8df87';ctx.beginPath();ctx.ellipse(530,355,370,125,0,0,Math.PI*2);ctx.fill();
    circle(700,330,45,'#d9c994');circle(555,310,9,'#386f58');line(555,310,555,210,'#fff',4);polygon([[555,210],[600,225],[555,240]],'#ed7e6b');
    const x=500+(shot?shot.aim:aim)*180*progress,y=500-progress*190;
    circle(x,y-(shot?Math.sin(progress*Math.PI)*shot.power*180:0),10,'#fff');
    line(500,485,555+aim*150,340,'#ffffff70',2);
  } else {
    polygon([[500,180],[900,400],[500,560],[100,400]],'#d6b887');polygon([[500,260],[760,400],[500,520],[240,400]],'#93ce8e');
    line(500,520,100,400,'#fff',4);line(500,520,900,400,'#fff',4);
    for(const [i,[x,y]] of [[500,520],[740,400],[500,285],[260,400]].entries())polygon([[x,y-8],[x+10,y],[x,y+8],[x-10,y]],i && match[turn].bases[i-1] ? '#ffda62' : '#fff');
    const t=timingAt(now);circle(shot?500+shot.aim*350*progress:500,shot?500-progress*420:240+t*260,shot?12-progress*7:8+t*5,'#fff');
    line(630+aim*100,530,shot?420:560+aim*120,shot?400:430,'#bb8255',18);
    circle(500,268,16,'#457a9b');rect(486,285,28,50,'#fff');
  }
  // Pointer is driven by phone orientation or the left/right buttons.
  if(!finished){const x=500+aim*300;circle(x,400,18,'#ffffff99');line(x-28,400,x+28,400,'#168dbd',3);line(x,372,x,428,'#168dbd',3);}
  ctx.font='17px Trebuchet MS';ctx.fillStyle='#284c60';ctx.fillText(`${game.sport} · ${finished?'Match complete':match[turn].name}`,25,32);
}
requestAnimationFrame(draw);
