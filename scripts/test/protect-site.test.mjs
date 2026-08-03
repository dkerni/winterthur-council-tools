/**
 * Prüft, dass `scripts/protect-site.mjs` Dateien so verschlüsselt, wie sie
 * `assets/js/access.js` im Browser wieder entschlüsselt: PBKDF2-SHA-256 zur
 * Schlüsselableitung, AES-256-GCM mit angehängtem Auth-Tag (Web-Crypto-Format).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';

import { protectDirectory, CHECK_PLAINTEXT } from '../protect-site.mjs';

const ITERATIONS = 100000; // im Test bewusst tiefer als im Deployment
const subtle = webcrypto.subtle;

const b64 = (value) => Buffer.from(value, 'base64');

/** Schlüsselableitung genau wie im Browser (`deriveKey` in access.js). */
async function deriveKeyLikeBrowser(password, config) {
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(config.salt), iterations: config.iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt'],
  );
}

/** Entschlüsselung genau wie im Browser (`decryptPayload` in access.js). */
async function decryptLikeBrowser(key, payload) {
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64(payload.iv) },
    key,
    b64(payload.data),
  );
  return new TextDecoder().decode(plain);
}

async function buildFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'wct-protect-'));
  await mkdir(path.join(dir, 'data'));
  await writeFile(path.join(dir, 'data', 'members.json'), JSON.stringify({ members: [{ id: 'a' }] }));
  await writeFile(path.join(dir, 'data', 'party-meta.json'), JSON.stringify({ parties: [] }));
  return dir;
}

test('verschlüsselt alle Datendateien und entfernt den Klartext', async () => {
  const dir = await buildFixture();
  const files = await protectDirectory(dir, 'geheim-genug', ITERATIONS);

  assert.deepEqual(files, ['members.json', 'party-meta.json']);
  const entries = (await readdir(path.join(dir, 'data'))).sort();
  assert.deepEqual(entries, ['access.json', 'members.json.enc', 'party-meta.json.enc']);
});

test('Browser-Entschlüsselung liefert den ursprünglichen Inhalt', async () => {
  const dir = await buildFixture();
  await protectDirectory(dir, 'geheim-genug', ITERATIONS);

  const config = JSON.parse(await readFile(path.join(dir, 'data', 'access.json'), 'utf8'));
  const key = await deriveKeyLikeBrowser('geheim-genug', config);

  assert.equal(await decryptLikeBrowser(key, config.check), CHECK_PLAINTEXT);

  const payload = JSON.parse(await readFile(path.join(dir, 'data', 'members.json.enc'), 'utf8'));
  const plaintext = await decryptLikeBrowser(key, payload);
  assert.deepEqual(JSON.parse(plaintext), { members: [{ id: 'a' }] });
});

test('falsches Passwort scheitert an der Prüfung', async () => {
  const dir = await buildFixture();
  await protectDirectory(dir, 'geheim-genug', ITERATIONS);

  const config = JSON.parse(await readFile(path.join(dir, 'data', 'access.json'), 'utf8'));
  const key = await deriveKeyLikeBrowser('falsches-passwort', config);

  await assert.rejects(() => decryptLikeBrowser(key, config.check));
});
