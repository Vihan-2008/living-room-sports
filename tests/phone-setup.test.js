// The page that helps a phone trust the PC, so its controller can use motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server.js';
import { platformOf, iosBrowser, controllerLink, checkTrust, TRUST_TEXT } from '../public/phone-setup.js';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

test('the page shows the steps for the phone it is opened on', () => {
  assert.equal(platformOf(IPHONE_SAFARI, 5), 'ios');
  assert.equal(platformOf(IPAD, 5), 'ios', 'an iPad asking for the desktop page');
  assert.equal(platformOf(IPAD, 0), 'other', 'a real Mac');
  assert.equal(platformOf(PIXEL, 5), 'android');
  assert.equal(iosBrowser(IPHONE_SAFARI), null);
  assert.equal(iosBrowser(IPHONE_CHROME), 'Chrome', 'only Safari can install the certificate, so other browsers are named');
});

test('the secure controller link keeps the room code and the phone\'s identity', () => {
  assert.equal(controllerLink('192.168.1.40', 3443, '123456', 'phone-abc'), 'https://192.168.1.40:3443/remote?code=123456&id=phone-abc');
  assert.equal(controllerLink('192.168.1.40', 3443, null, null), 'https://192.168.1.40:3443/remote');
});

test('the trust check answers from what the phone can actually reach', async () => {
  const http = { protocol: 'http:', hostname: '192.168.1.40' };
  const config = (body = { code: '123456', securePort: 3443 }) => async url => (url === '/config' ? { json: async () => body } : { ok: true });
  assert.deepEqual(await checkTrust({ location: http, clientId: 'phone-abc', fetch: config() }),
    { state: 'trusted', link: 'https://192.168.1.40:3443/remote?code=123456&id=phone-abc' });
  assert.deepEqual(await checkTrust({ location: http, fetch: async url => (url === '/config' ? { json: async () => ({ code: '123456', securePort: 3443 }) } : Promise.reject(new TypeError('certificate'))) }),
    { state: 'untrusted' }, 'an untrusted certificate fails the request');
  assert.deepEqual(await checkTrust({ location: http, timeout: 20, fetch: (url, { signal } = {}) => (url === '/config'
    ? Promise.resolve({ json: async () => ({ code: '123456', securePort: 3443 }) })
    : new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))) }),
  { state: 'untrusted' }, 'a request that never answers gives up');
  assert.deepEqual(await checkTrust({ location: http, fetch: config({ code: '123456', securePort: null }) }), { state: 'off' });
  assert.deepEqual(await checkTrust({ location: http, fetch: async () => { throw new TypeError('offline'); } }), { state: 'offline' });
  assert.deepEqual(await checkTrust({ location: { protocol: 'https:', hostname: '192.168.1.40' }, fetch: config() }),
    { state: 'trusted', link: '/remote?code=123456' }, 'a page that loaded securely is already trusted');
  for (const state of ['checking', 'trusted', 'untrusted', 'off', 'offline']) assert.ok(TRUST_TEXT[state]);
});

test('the page\'s script finds everything it needs, and both downloads are offered', async () => {
  const html = await readFile(new URL('../public/phone-setup.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/phone-setup.js', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => id));
  for (const [, id] of script.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(id), `Missing element ${id}`);
  assert.match(html, /href="\/ca\.crt"/, 'iPhone: served as a certificate, so Safari offers to install it');
  assert.match(html, /href="\/ca\.crt\?save" download/, 'Android: saved as a file for Settings to install');
  assert.match(html, /data-platform="ios"/); assert.match(html, /data-platform="android"/);
  const remote = await readFile(new URL('../public/remote.html', import.meta.url), 'utf8');
  assert.match(remote, /id="motion-setup"[^>]*href="\/phone-setup"|href="\/phone-setup"[^>]*id="motion-setup"/, 'the controller links here when motion is off');
});

test('the PC serves the setup page and its certificate both ways', async t => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  let cert = null;
  const app = createApp({ authorityCert: () => cert, securePort: () => 3443 });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  for (const path of ['/phone-setup', '/phone-setup.js', '/phone-setup.css', '/remote.css']) assert.equal((await fetch(base + path)).status, 200, path);
  assert.equal((await fetch(`${base}/ca.crt`)).status, 404, 'no certificate before the PC has made one');
  cert = pem;
  const install = await fetch(`${base}/ca.crt`);
  assert.equal(install.headers.get('content-type'), 'application/x-x509-ca-cert');
  assert.match(install.headers.get('content-disposition'), /^inline; filename="LivingRoomSports\.crt"$/);
  assert.equal(await install.text(), pem);
  const saved = await fetch(`${base}/ca.crt?save`);
  assert.equal(saved.headers.get('content-type'), 'application/octet-stream');
  assert.match(saved.headers.get('content-disposition'), /^attachment; filename="LivingRoomSports\.crt"$/);
  assert.equal((await (await fetch(`${base}/config`)).json()).securePort, 3443, 'the page learns the secure port here');
});
