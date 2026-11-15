// One input model for the menu: every player has a hand pointer (mouse, DualSense stick or phone), and the
// keyboard, D-pads and phone arrows move between buttons. Pointer positions are kept in stage pixels, so a
// stick or phone hand stays on the same spot when the window is resized, made full screen or switched between
// 16:9 and 4:3; the mouse hand goes back under the cursor, which has not moved.
import { handSvg, HAND_HOTSPOT } from './menu-art.js';
import { play, unlock } from './menu-sound.js';

export const PLAYER_COLORS = ['#149ed4', '#ef665e', '#61b968', '#e1ab23'];
const INTERACTIVE = 'button:not(:disabled), a[href], input:not(:disabled), [data-nav]';
const HAND = { w: 46, h: 52 };
const PHONE_IDLE_MS = 5000;
const PAD_DIRECTIONS = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const KEY_DIRECTIONS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const visible = el => {
  if (!el.isConnected || el.closest('[hidden], [inert], .is-leaving')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// Picks the nearest element in a direction, favouring ones in line with the current one.
export function nearest(fromRect, candidates, direction) {
  const from = center(fromRect);
  let best = null, bestScore = Infinity;
  for (const { el, rect } of candidates) {
    const to = center(rect);
    const dx = to.x - from.x, dy = to.y - from.y;
    const main = { up: -dy, down: dy, left: -dx, right: dx }[direction];
    const cross = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (main <= 4) continue;
    const score = main + cross * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function createInput({ stage, layer, scope, actions, settings }) {
  const pointers = new Map();
  let focusHot = null, padPressed = [], padSeen = false, capture = null, padListener = null, lastFrame = performance.now(), mouseAt = null;

  const size = () => ({ w: stage.offsetWidth, h: stage.offsetHeight });
  const scale = () => stage.getBoundingClientRect().width / (stage.offsetWidth || 1);
  const controls = () => settings()?.controls || { players: ['dualsense', 'phone', 'phone', 'phone'], dashboard: { deadzone: 0.2, pointerSpeed: 1, buttons: {} } };
  const padSlot = () => (controls().players.indexOf('dualsense') + 1) || 1;

  function toStage(clientX, clientY) {
    const r = stage.getBoundingClientRect(), s = scale();
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  }

  function pointer(slot) {
    let p = pointers.get(slot);
    if (p) return p;
    const el = document.createElement('div');
    el.className = 'hand';
    el.dataset.slot = slot;
    el.innerHTML = handSvg(PLAYER_COLORS[slot - 1], slot);
    el.hidden = true;
    // Player 1 is drawn on top, as on the console.
    const after = [...layer.children].find(child => Number(child.dataset.slot) < slot);
    layer.insertBefore(el, after || null);
    p = { slot, el, x: size().w / 2, y: size().h / 2, visible: false, hot: null, moved: 0, source: null };
    pointers.set(slot, p);
    return p;
  }

  function refresh(el) {
    if (!el) return;
    const hot = focusHot === el || [...pointers.values()].some(p => p.visible && p.hot === el);
    el.classList.toggle('is-hot', hot);
  }

  function setHot(p, el) {
    if (p.hot === el) return;
    const old = p.hot;
    p.hot = el;
    refresh(old); refresh(el);
    if (el && performance.now() - p.moved < 400) play('hover');
  }

  function hitTest(p) {
    if (!p.visible) return setHot(p, null);
    const r = stage.getBoundingClientRect(), s = scale();
    const target = document.elementFromPoint(r.left + p.x * s, r.top + p.y * s);
    const el = target?.closest(INTERACTIVE);
    setHot(p, el && scope().contains(el) && visible(el) ? el : null);
  }

  function place(p) {
    p.el.style.transform = `translate(${p.x - HAND.w * HAND_HOTSPOT.x}px, ${p.y - HAND.h * HAND_HOTSPOT.y}px)`;
  }

  function move(slot, x, y, source) {
    const p = pointer(slot), { w, h } = size();
    p.x = Math.max(0, Math.min(w, x)); p.y = Math.max(0, Math.min(h, y));
    p.moved = performance.now(); p.source = source;
    if (!p.visible) { p.visible = true; p.el.hidden = false; }
    place(p);
    setFocusHot(null);
    hitTest(p);
  }

  function hide(slot) {
    const p = pointers.get(slot);
    if (!p || !p.visible) return;
    p.visible = false; p.el.hidden = true;
    setHot(p, null);
  }

  function setFocusHot(el) {
    if (focusHot === el) return;
    const old = focusHot;
    focusHot = el;
    refresh(old); refresh(el);
  }

  function candidates() {
    const root = scope();
    const box = stage.getBoundingClientRect();
    return [...root.querySelectorAll(INTERACTIVE)].filter(visible).map(el => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > box.left + 2 && rect.left < box.right - 2 && rect.bottom > box.top + 2 && rect.top < box.bottom - 2);
  }

  function current() {
    const root = scope();
    if (focusHot && root.contains(focusHot) && visible(focusHot)) return focusHot;
    const recent = [...pointers.values()].filter(p => p.visible && p.hot).sort((a, b) => b.moved - a.moved)[0];
    return recent?.hot || null;
  }

  function focus(el, { snapSlot = null } = {}) {
    el.focus({ preventScroll: true });
    if (el.closest('.scroll')) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    for (const p of pointers.values()) if (p.source !== 'phone' && p.slot !== snapSlot) hide(p.slot);
    setFocusHot(el);
    if (snapSlot) {
      const p = pointer(snapSlot), r = el.getBoundingClientRect(), s = scale(), origin = stage.getBoundingClientRect();
      p.x = (r.left + r.width * 0.62 - origin.left) / s; p.y = (r.top + r.height * 0.6 - origin.top) / s;
      p.visible = true; p.el.hidden = false; place(p); p.hot = el;
    }
    play('hover');
  }

  function adjustRange(el, direction) {
    if (!el?.matches('input[type=range]') || (direction !== 'left' && direction !== 'right')) return false;
    if (direction === 'left') el.stepDown(); else el.stepUp();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function navigate(direction, snapSlot = null) {
    const from = current();
    if (adjustRange(from, direction)) return;
    const list = candidates();
    if (!list.length) return;
    if (!from) {
      const preferred = list.find(c => c.el.matches('[data-default]')) || list[0];
      return focus(preferred.el, { snapSlot });
    }
    const next = nearest(from.getBoundingClientRect(), list.filter(c => c.el !== from), direction);
    if (next) focus(next, { snapSlot });
    else actions.edge?.(direction);
  }

  function activate(el) {
    if (!el) return false;
    if (el.matches('input[type=range], input[type=text], input:not([type])')) { el.focus(); return true; }
    el.click();
    return true;
  }

  // A button press from any player: a, b, home, options, minus, plus or a direction.
  function press(slot, button, snapSlot = null) {
    unlock();
    if (actions.intercept?.(slot, button)) return;
    if (button === 'a') {
      const p = pointers.get(slot);
      const el = p?.visible && p.hot ? p.hot : current();
      if (el) activate(el); else navigate('down', snapSlot);
    } else if (button === 'b') actions.back();
    else if (button === 'home') actions.home();
    else if (button === 'options') actions.options?.();
    else if (button === 'minus') actions.page?.(-1);
    else if (button === 'plus') actions.page?.(1);
    else if (['up', 'down', 'left', 'right'].includes(button)) navigate(button, snapSlot);
  }

  // ---- Mouse and keyboard --------------------------------------------------------------------
  window.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    mouseAt = { x: e.clientX, y: e.clientY };
    const { x, y } = toStage(e.clientX, e.clientY);
    move(1, x, y, 'mouse');
  });
  // The stage was refitted under a resting mouse: put its hand back under the cursor.
  function refit() {
    const p = pointers.get(1);
    if (!mouseAt || !p?.visible || p.source !== 'mouse') return;
    const { x, y } = toStage(mouseAt.x, mouseAt.y);
    move(1, x, y, 'mouse');
  }
  document.documentElement.addEventListener('pointerleave', () => { const p = pointers.get(1); if (p?.source === 'mouse') hide(1); });
  // A click is also a pointer position: a press that arrives without a move first (a touch screen, a
  // remote desktop) still takes the highlight off whatever the keyboard had selected.
  window.addEventListener('pointerdown', e => {
    unlock();
    if (e.pointerType === 'mouse') { mouseAt = { x: e.clientX, y: e.clientY }; const { x, y } = toStage(e.clientX, e.clientY); move(1, x, y, 'mouse'); }
    else setFocusHot(null);
  }, { capture: true });
  stage.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > 20 && !e.target.closest('.scroll')) actions.wheel?.(Math.sign(e.deltaY)); }, { passive: true });
  // Every activation, from any source, makes the same sound.
  stage.addEventListener('click', e => {
    const el = e.target.closest(INTERACTIVE);
    if (el && !el.matches('input[type=range]')) play(el.dataset.sound || 'select');
  }, { capture: true });
  stage.addEventListener('focusin', e => {
    // A screen that redraws hands focus to the new copy of the same control; keep it highlighted.
    if (focusHot && !focusHot.isConnected) setFocusHot(e.target); else refresh(e.target);
  });

  window.addEventListener('keydown', e => {
    unlock();
    const typing = e.target.matches?.('input[type=text], input:not([type])');
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (actions.intercept?.(0, `key:${e.key}`)) { e.preventDefault(); return; }
    const direction = KEY_DIRECTIONS[e.key];
    if (direction) {
      if (e.target.matches?.('input[type=range]') && (direction === 'left' || direction === 'right')) return;
      e.preventDefault(); return navigate(direction);
    }
    if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); actions.back(); }
    else if (e.key === 'PageUp') { e.preventDefault(); actions.page?.(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); actions.page?.(1); }
    else if (e.key === 'Home') { e.preventDefault(); actions.home(); }
    else if ((e.key === 'Enter' || e.key === ' ') && !scope().contains(document.activeElement)) { e.preventDefault(); navigate('down'); }
  });

  // ---- DualSense (and any standard gamepad) ----------------------------------------------------
  window.addEventListener('gamepadconnected', e => { actions.gamepad?.(true, e.gamepad); });
  window.addEventListener('gamepaddisconnected', e => { padPressed = []; actions.gamepad?.(false, e.gamepad); });

  function activePad() {
    const pads = [...(navigator.getGamepads?.() || [])].filter(p => p && p.connected);
    return pads.find(p => p.mapping === 'standard') || pads[0] || null;
  }

  function pollPad(dt) {
    const pad = activePad();
    if (!pad) return;
    // While Dolphin (or anything else) is in front, the DualSense belongs to it: the menu only keeps
    // track of what is held, so a button still down when the menu returns does not count as a press.
    if (!document.hasFocus()) { padPressed = pad.buttons.map(b => b.pressed || b.value > 0.6); return; }
    padListener?.(pad);
    const { dashboard } = controls();
    const slot = padSlot();
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0, magnitude = Math.hypot(ax, ay);
    const deadzone = Math.min(0.9, Math.max(0, dashboard.deadzone));
    if (magnitude > deadzone) {
      const p = pointer(slot);
      if (!p.visible) { p.x = size().w / 2; p.y = size().h / 2; }
      const amount = Math.min(1, (magnitude - deadzone) / (1 - deadzone)) ** 1.6;
      const speed = 1050 * (dashboard.pointerSpeed || 1) * amount * dt;
      move(slot, p.x + (ax / magnitude) * speed, p.y + (ay / magnitude) * speed, 'pad');
    }
    const pressed = pad.buttons.map(b => b.pressed || b.value > 0.6);
    pressed.forEach((down, index) => {
      if (!down || padPressed[index]) return;
      if (!padSeen) { padSeen = true; }
      if (capture) { const fn = capture; capture = null; fn(index); return; }
      const map = dashboard.buttons || {};
      const button = PAD_DIRECTIONS[index] || (index === map.select ? 'a' : index === map.back ? 'b' : index === map.home ? 'home'
        : index === map.options ? 'options' : index === map.pageLeft ? 'minus' : index === map.pageRight ? 'plus' : null);
      if (button) press(slot, button, PAD_DIRECTIONS[index] ? slot : null);
    });
    padPressed = pressed;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    pollPad(dt);
    for (const p of pointers.values()) {
      if (p.visible && p.source === 'phone' && now - p.moved > PHONE_IDLE_MS) hide(p.slot);
      else hitTest(p);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    press, navigate, focus, hide, toStage, refit,
    // A phone's "input" message, as relayed by the server.
    phone(msg) {
      if (!msg?.slot) return;
      if (msg.cancel) return;
      if (msg.pointing && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
        const { w, h } = size();
        move(msg.slot, (msg.x + 1) / 2 * w, (msg.y + 1) / 2 * h, 'phone');
      }
      if (msg.button && msg.pressed) press(msg.slot, msg.button);
    },
    phoneLeft(slot) { const p = pointers.get(slot); if (p?.source === 'phone') hide(slot); },
    // Called after a screen changes, so nothing stays highlighted that is gone.
    reset() {
      setFocusHot(null);
      for (const p of pointers.values()) { p.hot = null; hitTest(p); }
      document.querySelectorAll('.is-hot').forEach(el => refresh(el));
    },
    focusFirst(selector) {
      const list = candidates();
      const target = (selector && list.find(c => c.el.matches(selector))) || list.find(c => c.el.matches('[data-default]'));
      if (target && ![...pointers.values()].some(p => p.visible && p.source !== 'phone')) focus(target.el);
    },
    activePad,
    onPad(listener) { padListener = listener; return () => { if (padListener === listener) padListener = null; }; },
    captureButton(fn) { capture = fn; return () => { if (capture === fn) capture = null; }; }
  };
}
