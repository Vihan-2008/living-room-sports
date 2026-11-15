// Minimal INI editing that keeps every unrelated line of a Dolphin settings file intact.
// Section and key names compare case-insensitively, as Dolphin's own IniFile does.
import { readFile, writeFile, rm, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const sectionOf = line => line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1].trim();
const keyOf = line => {
  if (/^\s*[#;]/.test(line)) return null;
  const at = line.indexOf('=');
  return at > 0 ? line.slice(0, at).trim() : null;
};
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

export function readValue(text, section, key) {
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const name = sectionOf(line);
    if (name !== undefined) { current = name; continue; }
    if (current && same(current, section) && keyOf(line) && same(keyOf(line), key)) return line.slice(line.indexOf('=') + 1).trim();
  }
  return null;
}

export function readSection(text, section) {
  const out = {};
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const name = sectionOf(line);
    if (name !== undefined) { current = name; continue; }
    const key = keyOf(line);
    if (current && same(current, section) && key) out[key] = line.slice(line.indexOf('=') + 1).trim();
  }
  return out;
}

// values: { key: string | null }, where null removes the key. Returns the new text.
export function setValues(text, section, values) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text ? String(text).split(/\r?\n/) : [];
  if (lines.length && lines.at(-1) === '') lines.pop();
  const pending = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), [k, v]]));
  const out = [];
  let current = null, sectionEnd = -1, found = false;
  for (const line of lines) {
    const name = sectionOf(line);
    if (name !== undefined) {
      if (current && same(current, section)) sectionEnd = out.length;
      current = name;
      if (same(name, section)) found = true;
      out.push(line);
      continue;
    }
    const key = keyOf(line);
    if (current && same(current, section) && key && pending.has(key.toLowerCase())) {
      const [, value] = pending.get(key.toLowerCase());
      pending.delete(key.toLowerCase());
      if (value !== null && value !== undefined) out.push(`${key} = ${value}`);
      continue;
    }
    out.push(line);
  }
  if (current && same(current, section)) sectionEnd = out.length;
  const additions = [...pending.values()].filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k} = ${v}`);
  if (additions.length) {
    if (!found) { if (out.length && out.at(-1).trim() !== '') out.push(''); out.push(`[${section}]`, ...additions); }
    else {
      // Insert before trailing blank lines of the section.
      let at = sectionEnd;
      while (at > 0 && out[at - 1].trim() === '' && sectionOf(out[at - 1]) === undefined) at--;
      out.splice(at, 0, ...additions);
    }
  }
  return out.length ? out.join(eol) + eol : '';
}

// Removes [section] when it holds no keys, with the blank line this module put before it.
export function removeEmptySection(text, section) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex(line => sectionOf(line) !== undefined && same(sectionOf(line), section));
  if (start < 0) return text;
  let end = start + 1;
  while (end < lines.length && sectionOf(lines[end]) === undefined) { if (lines[end].trim()) return text; end++; }
  const from = start > 0 && lines[start - 1].trim() === '' ? start - 1 : start;
  lines.splice(from, end - from);
  const out = lines.join(eol).replace(/(\r?\n)+$/, '');
  return out ? out + eol : '';
}

// True when the text holds nothing but blank lines and empty sections.
export function isEmptyIni(text) {
  return String(text).split(/\r?\n/).every(line => line.trim() === '' || sectionOf(line) !== undefined);
}

async function readText(file) {
  try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.lrs-tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

// A journal records the original value of every key this app changes in someone else's settings file,
// before changing it, so the change can be undone after the game, or on the next start after a crash.
export function createJournal(file) {
  async function load() {
    const text = await readText(file);
    if (!text) return [];
    try { const list = JSON.parse(text); return Array.isArray(list) ? list : []; } catch { return []; }
  }
  async function restore() {
    const entries = await load();
    const failures = [];
    for (const entry of entries.reverse()) {
      try {
        const current = await readText(entry.file);
        if (current === null) continue;
        let restored = setValues(current, entry.section, entry.originals);
        if (entry.sectionExisted === false) restored = removeEmptySection(restored, entry.section);
        if (!entry.existed && isEmptyIni(restored)) await rm(entry.file, { force: true });
        else if (restored !== current) await writeAtomic(entry.file, restored);
      } catch (error) { failures.push({ file: entry.file, error: error.message }); }
    }
    if (!failures.length) await rm(file, { force: true });
    return { restored: entries.length, failures };
  }
  // Applies { key: value } to [section] of target, journaling originals first.
  async function apply(target, section, values) {
    const current = await readText(target);
    const originals = {};
    for (const key of Object.keys(values)) originals[key] = current === null ? null : readValue(current, section, key);
    const entries = await load();
    const sectionExisted = current !== null && String(current).split(/\r?\n/).some(line => sectionOf(line) !== undefined && same(sectionOf(line), section));
    entries.push({ file: target, section, existed: current !== null, sectionExisted, originals });
    await writeAtomic(file, JSON.stringify(entries, null, 2));
    await writeAtomic(target, setValues(current || '', section, values));
  }
  return { file, load, restore, apply };
}
