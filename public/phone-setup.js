// The phone setup page: walks a phone through trusting the PC's certificate, so the controller page can be
// served securely and the browser lets it read the motion sensors. It then checks that the trust took.

const CHECK_TIMEOUT_MS = 2500;

export function platformOf(userAgent = '', maxTouchPoints = 0) {
  // iPads ask for desktop pages and name themselves a Mac; a touch screen gives them away.
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

// Only Safari can install a certificate on an iPhone. Returns the other browser's name, or null for Safari.
export function iosBrowser(userAgent = '') {
  const others = [['CriOS', 'Chrome'], ['FxiOS', 'Firefox'], ['EdgiOS', 'Edge'], ['OPiOS', 'Opera'], ['GSA/', 'The Google app']];
  return others.find(([token]) => userAgent.includes(token))?.[1] ?? null;
}

// The secure controller, carrying this phone's identity over so it keeps its player number.
export function controllerLink(hostname, securePort, code, clientId) {
  const url = new URL(`https://${hostname}:${securePort}/remote`);
  if (code) url.searchParams.set('code', code);
  if (clientId) url.searchParams.set('id', clientId);
  return url.href;
}

// Whether this phone trusts the PC yet: the secure address only answers once the certificate is trusted.
// Resolves to { state: 'trusted', link } or { state: 'untrusted' | 'off' | 'offline' }.
export async function checkTrust({ fetch, location, clientId = null, timeout = CHECK_TIMEOUT_MS }) {
  let config;
  try { config = await (await fetch('/config')).json(); } catch { return { state: 'offline' }; }
  const code = /^\d{6}$/.test(config?.code) ? config.code : null;
  if (location.protocol === 'https:') return { state: 'trusted', link: code ? `/remote?code=${code}` : '/remote' };
  if (!config?.securePort) return { state: 'off' };
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeout);
  try {
    const answered = await fetch(`https://${location.hostname}:${config.securePort}/ping`, { signal: abort.signal }).then(response => response.ok, () => false);
    return answered ? { state: 'trusted', link: controllerLink(location.hostname, config.securePort, code, clientId) } : { state: 'untrusted' };
  } finally { clearTimeout(timer); }
}

export const TRUST_TEXT = {
  checking: 'Checking whether this phone trusts the PC…',
  trusted: 'This phone trusts the PC. Motion controls are ready.',
  untrusted: 'This phone does not trust the PC yet.',
  off: 'The PC is not offering a secure connection right now. Restart Living Room Sports on the PC, then check again.',
  offline: 'This phone cannot reach the PC. Make sure it is on the same Wi-Fi, then check again.'
};

if (typeof document !== 'undefined') startPage();

function startPage() {
  const $ = id => document.getElementById(id);
  const userAgent = navigator.userAgent;
  const platform = platformOf(userAgent, navigator.maxTouchPoints);
  let clientId = null;
  try { clientId = localStorage.getItem('lrs-client'); } catch {}

  const choices = [...document.querySelectorAll('[data-platform]')];
  function choose(name) {
    for (const button of choices) button.setAttribute('aria-checked', String(button.dataset.platform === name));
    $('steps-ios').hidden = name !== 'ios';
    $('steps-android').hidden = name !== 'android';
  }
  for (const button of choices) button.onclick = () => choose(button.dataset.platform);
  choose(platform === 'android' ? 'android' : 'ios');

  const other = platform === 'ios' && iosBrowser(userAgent);
  if (other) { $('safari-note').textContent = `Open this page in Safari to install the certificate. ${other} on iPhone cannot install one.`; $('safari-note').hidden = false; }
  $('elsewhere').hidden = platform !== 'other';

  let running = null;
  function render(result) {
    const panel = $('trust');
    panel.dataset.state = result.state;
    $('trust-text').textContent = TRUST_TEXT[result.state];
    $('open-controller').hidden = result.state !== 'trusted';
    if (result.link) $('open-controller').href = result.link;
    $('check-again').hidden = result.state === 'trusted' || result.state === 'checking';
  }
  function check() {
    running ??= (async () => {
      render({ state: 'checking' });
      try { render(await checkTrust({ fetch, location, clientId })); } finally { running = null; }
    })();
    return running;
  }
  $('check-again').onclick = check;
  // Coming back from Settings is the moment the answer changes.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('trust').dataset.state !== 'trusted') check(); });
  window.addEventListener('pageshow', event => { if (event.persisted) check(); });

  fetch('/config').then(response => response.json()).then(config => {
    if (/^\d{6}$/.test(config?.code)) $('buttons-only').href = `/remote?code=${config.code}`;
  }, () => {});
  check();
}
