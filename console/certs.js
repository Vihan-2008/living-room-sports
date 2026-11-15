// Phone browsers only expose motion sensors to secure (HTTPS) pages. This module creates a small local
// certificate authority, limited by name constraints to private network addresses, and a server
// certificate for this PC's current addresses. Each phone trusts the authority once; the server
// certificate is reissued whenever the PC's addresses change. Keys never leave this PC.
import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash, randomBytes, sign, X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';

// ---- DER encoding -------------------------------------------------------------------------------
function length(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), length(body.length), body]); };
const seq = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const bool = value => tlv(0x01, Buffer.from([value ? 0xff : 0]));
const octets = buf => tlv(0x04, buf);
const bits = (buf, unused = 0) => tlv(0x03, Buffer.from([unused]), buf);
function integer(value) {
  let buf = Buffer.isBuffer(value) ? value : Buffer.from([value]);
  while (buf.length > 1 && buf[0] === 0 && !(buf[1] & 0x80)) buf = buf.subarray(1);
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
  return tlv(0x02, buf);
}
function oid(text) {
  const [a, b, ...rest] = text.split('.').map(Number);
  const out = [40 * a + b];
  for (let n of rest) {
    const chunk = [n & 0x7f];
    for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) chunk.unshift(0x80 | (n & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(date) {
  const p = n => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const rest = `${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return y < 2050 ? tlv(0x17, Buffer.from(`${String(y).slice(2)}${rest}`)) : tlv(0x18, Buffer.from(`${y}${rest}`));
}
const name = fields => Buffer.isBuffer(fields) ? fields : seq(...fields.map(([type, value]) => set(seq(oid(type), tlv(0x0c, Buffer.from(value, 'utf8'))))));
const extension = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
const ipBytes = ip => Buffer.from(ip.split('.').map(Number));

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2', commonName: '2.5.4.3', organization: '2.5.4.10',
  basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', subjectAltName: '2.5.29.17',
  nameConstraints: '2.5.29.30', subjectKeyId: '2.5.29.14', authorityKeyId: '2.5.29.35', serverAuth: '1.3.6.1.5.5.7.3.1'
};

// The only addresses the authority may ever vouch for: private, loopback and carrier-grade NAT ranges.
export const PERMITTED_RANGES = [['10.0.0.0', '255.0.0.0'], ['172.16.0.0', '255.240.0.0'], ['192.168.0.0', '255.255.0.0'], ['127.0.0.0', '255.0.0.0'], ['100.64.0.0', '255.192.0.0']];
export function isPermittedAddress(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const value = ipBytes(ip);
  return PERMITTED_RANGES.some(([base, mask]) => { const b = ipBytes(base), m = ipBytes(mask); return value.every((v, i) => (v & m[i]) === b[i]); });
}

// Reads one TLV at offset; returns { tag, start, end, body } where body is the content's offset.
function readTlv(buf, offset) {
  const tag = buf[offset];
  let size = buf[offset + 1], body = offset + 2;
  if (size & 0x80) { const n = size & 0x7f; size = 0; for (let i = 0; i < n; i++) size = size * 256 + buf[body + i]; body += n; }
  return { tag, start: offset, body, end: body + size };
}
// The subject Name of a certificate, as raw DER, so issued certificates name their issuer byte for byte.
export function subjectOf(certPem) {
  const der = new X509Certificate(certPem).raw;
  const tbs = readTlv(der, readTlv(der, 0).body);
  let at = tbs.body;
  if (der[at] === 0xa0) at = readTlv(der, at).end; // version
  for (let skip = 0; skip < 4; skip++) at = readTlv(der, at).end; // serial, signature, issuer, validity
  const subject = readTlv(der, at);
  return der.subarray(subject.start, subject.end);
}

const keyId = publicKey => createHash('sha1').update(publicKey.export({ type: 'spki', format: 'der' })).digest();

function certificate({ subject, issuer, publicKey, signingKey, days, extensions, notBefore = new Date(Date.now() - 3600e3) }) {
  const serial = randomBytes(16); serial[0] &= 0x7f;
  const notAfter = new Date(notBefore.getTime() + days * 86400e3);
  const algorithm = seq(oid(OID.ecdsaSha256));
  const tbs = seq(
    tlv(0xa0, integer(2)), integer(serial), algorithm, name(issuer), seq(time(notBefore), time(notAfter)), name(subject),
    publicKey.export({ type: 'spki', format: 'der' }), tlv(0xa3, seq(...extensions))
  );
  const signature = sign('sha256', tbs, signingKey);
  return seq(tbs, algorithm, bits(signature));
}
const pem = der => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

export function createAuthority({ days = 3650, label = hostname() } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const subject = [[OID.organization, 'Living Room Sports'], [OID.commonName, `Living Room Sports local CA (${label})`.slice(0, 64)]];
  const permitted = tlv(0xa0, ...PERMITTED_RANGES.map(([base, mask]) => seq(tlv(0x87, Buffer.concat([ipBytes(base), ipBytes(mask)])))), seq(tlv(0x82, Buffer.from('localhost'))));
  const der = certificate({
    subject, issuer: subject, publicKey, signingKey: privateKey, days,
    extensions: [
      extension(OID.basicConstraints, true, seq(bool(true), integer(0))),
      extension(OID.keyUsage, true, bits(Buffer.from([0x06]), 1)),
      extension(OID.nameConstraints, true, seq(permitted)),
      extension(OID.subjectKeyId, false, octets(keyId(publicKey)))
    ]
  });
  return { cert: pem(der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

export function issueServerCertificate(authority, addresses, { days = 397, onlyPermitted = true } = {}) {
  const caKey = createPrivateKey(authority.key), caCert = new X509Certificate(authority.cert);
  const ips = [...new Set(['127.0.0.1', ...addresses])].filter(ip => !onlyPermitted || isPermittedAddress(ip));
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const issuer = authority.subject || [[OID.organization, 'Living Room Sports'], [OID.commonName, caCert.subject.split('\n').find(l => l.startsWith('CN='))?.slice(3) || 'Living Room Sports local CA']];
  const der = certificate({
    subject: [[OID.organization, 'Living Room Sports'], [OID.commonName, 'Living Room Sports']], issuer, publicKey, signingKey: caKey, days,
    extensions: [
      extension(OID.basicConstraints, true, seq()),
      extension(OID.keyUsage, true, bits(Buffer.from([0x80]), 7)),
      extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      extension(OID.subjectAltName, false, seq(tlv(0x82, Buffer.from('localhost')), ...ips.map(ip => tlv(0x87, ipBytes(ip))))),
      extension(OID.subjectKeyId, false, octets(keyId(publicKey))),
      extension(OID.authorityKeyId, false, seq(tlv(0x80, keyId(createPublicKey(authority.key)))))
    ]
  });
  return { cert: pem(der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }), addresses: ips };
}

// Stored in <data>/certs: ca.crt, ca.key, server.crt, server.key.
export function createCertificateStore(dir) {
  const path = file => join(dir, file);
  let authority = null, server = null;
  async function readPair(base) {
    try { return { cert: await readFile(path(`${base}.crt`), 'utf8'), key: await readFile(path(`${base}.key`), 'utf8') }; }
    catch { return null; }
  }
  async function writePair(base, pair) {
    await mkdir(dir, { recursive: true });
    await writeFile(path(`${base}.key`), pair.key, { mode: 0o600 });
    await writeFile(path(`${base}.crt`), pair.cert);
  }
  function usable(pair, addresses) {
    try {
      const cert = new X509Certificate(pair.cert);
      if (Date.parse(cert.validTo) - Date.now() < 30 * 86400e3) return false;
      return addresses.filter(isPermittedAddress).every(ip => cert.checkIP(ip));
    } catch { return false; }
  }
  // Returns { key, cert, ca } for the HTTPS server, creating or reissuing what is missing or stale.
  async function ensure(addresses) {
    authority ??= await readPair('ca');
    let authorityValid = false;
    try { authorityValid = !!authority && Date.parse(new X509Certificate(authority.cert).validTo) > Date.now() + 30 * 86400e3; } catch {}
    if (!authorityValid) { authority = createAuthority(); await writePair('ca', authority); server = null; }
    server ??= await readPair('server');
    let issued = false;
    if (!server || !usable(server, addresses) || !new X509Certificate(server.cert).verify(createPublicKey(authority.key))) {
      server = issueServerCertificate(authority, addresses);
      await writePair('server', server);
      issued = true;
    }
    return { key: server.key, cert: server.cert, ca: authority.cert, issued };
  }
  async function remove() { authority = null; server = null; await rm(dir, { recursive: true, force: true }); }
  return {
    ensure, remove,
    authorityCertificate: () => authority?.cert || null,
    fingerprint: () => { try { return new X509Certificate(authority.cert).fingerprint256; } catch { return null; } }
  };
}
