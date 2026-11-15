// Small DOM toolkit for the menu screens. Text always goes in as text nodes; only artwork from
// menu-art.js (fixed SVG drawn by this app) is ever inserted as markup.
import { GLYPHS } from './menu-art.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'art') el.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Like replaceChildren, but skips null, false and undefined instead of printing them.
export function fill(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

// Full screen either way: the page asked for it, or the window itself is (F11, or the launcher's start setting).
export const isFullscreen = () => !!document.fullscreenElement || !!globalThis.matchMedia?.('(display-mode: fullscreen)').matches;

export const art = (markup, className = 'art') => h('span', { class: className, 'aria-hidden': 'true', art: markup });

export function button(label, onClick, { kind = '', icon = null, disabled = false, sound, title, isDefault = false, className = '' } = {}) {
  return h('button', { type: 'button', class: ['wbtn', kind, className].filter(Boolean).join(' '), disabled, title,
    dataset: { ...(sound ? { sound } : {}), ...(isDefault ? { default: '' } : {}) }, onClick },
  icon ? art(icon, 'wbtn-icon') : null, h('span', { class: 'wbtn-label' }, label));
}

export function backButton(onClick, label = 'Back') {
  return h('button', { type: 'button', class: 'wbtn back', dataset: { sound: 'back' }, onClick }, art(GLYPHS.arrow, 'wbtn-icon'), h('span', { class: 'wbtn-label' }, label));
}

// A row of mutually exclusive choices. options: [{ value, label, disabled, title }].
export function segmented(options, value, onChange, { label, className = '' } = {}) {
  const group = h('div', { class: `seg ${className}`.trim(), role: 'group', 'aria-label': label });
  const render = current => {
    group.replaceChildren(...options.map(option => h('button', {
      type: 'button', 'aria-pressed': String(option.value === current), disabled: option.disabled, title: option.title,
      onClick: () => { if (option.value !== current) { render(option.value); onChange(option.value); } }
    }, option.label)));
  };
  render(value);
  group.set = render;
  return group;
}

export const onOff = (value, onChange, label) => segmented([{ value: true, label: 'On' }, { value: false, label: 'Off' }], value, onChange, { label, className: 'seg-small' });

export function slider({ min, max, step, value, format = v => v, onChange, label }) {
  const output = h('output', { class: 'slider-value' }, format(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => { output.textContent = format(Number(input.value)); });
  input.addEventListener('change', () => onChange(Number(input.value)));
  return h('div', { class: 'slider' }, input, output);
}

// One line of setup status: a check or a warning, what is true, and the exact next step when needed.
export function status({ done, message, next }) {
  return h('div', { class: `status ${done ? 'is-done' : 'is-todo'}` },
    art(done ? GLYPHS.check : GLYPHS.alert, 'status-icon'),
    h('div', { class: 'status-text' }, h('p', { class: 'status-message' }, message), !done && next ? h('p', { class: 'status-next' }, next) : null));
}

export function setting(label, control, hint) {
  return h('div', { class: 'setting' }, h('div', { class: 'setting-label' }, h('p', {}, label), hint ? h('p', { class: 'setting-hint' }, hint) : null), h('div', { class: 'setting-control' }, control));
}

// The frame every screen below the Wii Menu shares: a title, a body and a bottom bar with Back.
export function frame({ title, body, onBack, backLabel = 'Back', actions = [], className = '' }) {
  return h('section', { class: `frame ${className}`.trim() },
    h('header', { class: 'frame-head' }, h('h1', {}, title)),
    h('div', { class: 'frame-body' }, body),
    h('footer', { class: 'frame-foot' }, backButton(onBack, backLabel), h('div', { class: 'frame-actions' }, actions)));
}

export function steps(list) {
  return h('ol', { class: 'path' }, list.map(step => h('li', {}, step)));
}

// Re-renders a part of a screen without losing the keyboard or controller focus inside it.
const focusKey = el => [el.tagName, el.className.replace(/\bis-hot\b/g, '').trim(), el.textContent, el.getAttribute('aria-label')].join('|');
export function keepFocus(root, render) {
  const active = document.activeElement;
  const key = active && active !== document.body && root.contains(active) ? focusKey(active) : null;
  render();
  if (key && !active.isConnected) [...root.querySelectorAll(active.tagName)].find(el => focusKey(el) === key)?.focus({ preventScroll: true });
}
