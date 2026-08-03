#!/usr/bin/env node
/**
 * Zugangsschutz für das GitHub-Pages-Deployment.
 *
 * GitHub Pages ist reines Static Hosting: HTTP-Basic-Auth ist dort nicht
 * möglich, weil kein Server konfigurierbar ist. Stattdessen werden die Daten
 * der Website vor dem Hochladen **verschlüsselt** (AES-256-GCM), der Schlüssel
 * wird im Browser aus dem Passwort abgeleitet (PBKDF2-SHA-256). Ohne Passwort
 * sind die veröffentlichten Dateien unbrauchbar — der reine «Passwort-Dialog
 * im JavaScript» wäre dagegen mit den Entwicklerwerkzeugen umgehbar.
 *
 * Aufruf (das Passwort kommt aus der Umgebung, nicht aus der Kommandozeile,
 * damit es nicht in der Prozessliste auftaucht):
 *
 *   SITE_PASSWORD='…' node scripts/protect-site.mjs --dir _site
 *
 * Ergebnis im Zielverzeichnis:
 *   data/<name>.json      → entfernt
 *   data/<name>.json.enc  → { v, iv, data } (Base64, AES-256-GCM)
 *   data/access.json      → { v, kdf, iterations, salt, check }
 */

import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';

/** Klartext, mit dem der Browser das eingegebene Passwort prüft. */
export const CHECK_PLAINTEXT = 'winterthur-council-tools';

/** Format-Version der erzeugten Dateien (muss zu `assets/js/access.js` passen). */
export const FORMAT_VERSION = 1;

/** PBKDF2-Runden. Bewusst hoch, die Ableitung passiert nur einmal pro Sitzung. */
export const DEFAULT_ITERATIONS = 310000;

const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM-Standard
const SALT_LENGTH = 16;

/**
 * Leitet den Schlüssel aus Passwort und Salt ab (identisch zu `deriveKey()`
 * in `assets/js/access.js`).
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} iterations
 * @returns {Buffer}
 */
export function deriveKey(password, salt, iterations) {
  return pbkdf2Sync(password, salt, iterations, KEY_LENGTH, 'sha256');
}

/**
 * Verschlüsselt einen String mit AES-256-GCM.
 *
 * Das Authentifizierungs-Tag wird an den Chiffretext angehängt — genau so
 * erwartet es die Web-Crypto-API des Browsers bei `crypto.subtle.decrypt`.
 *
 * @param {Buffer} key
 * @param {string} plaintext
 * @returns {{ v: number, iv: string, data: string }}
 */
export function encryptString(key, plaintext) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([body, cipher.getAuthTag()]);
  return {
    v: FORMAT_VERSION,
    iv: iv.toString('base64'),
    data: payload.toString('base64'),
  };
}

function parseArgs(argv) {
  const args = { dir: '_site', iterations: DEFAULT_ITERATIONS };
  for (const arg of argv) {
    if (arg.startsWith('--dir=')) args.dir = arg.slice('--dir='.length);
    else if (arg.startsWith('--iterations=')) args.iterations = Number(arg.slice('--iterations='.length));
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unbekannte Option: ${arg}`);
  }
  if (!Number.isInteger(args.iterations) || args.iterations < 100000) {
    throw new Error('--iterations muss eine ganze Zahl ≥ 100000 sein.');
  }
  return args;
}

const USAGE = `Verwendung: SITE_PASSWORD='…' node scripts/protect-site.mjs [--dir=_site] [--iterations=${DEFAULT_ITERATIONS}]`;

/**
 * Verschlüsselt alle JSON-Dateien in `<dir>/data` und legt `access.json` an.
 * @param {string} dir Zielverzeichnis (wird in place verändert)
 * @param {string} password
 * @param {number} iterations
 * @returns {Promise<string[]>} verschlüsselte Dateinamen
 */
export async function protectDirectory(dir, password, iterations = DEFAULT_ITERATIONS) {
  const dataDir = path.join(dir, 'data');
  const entries = await readdir(dataDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'access.json')
    .map((entry) => entry.name)
    .sort();

  if (!files.length) throw new Error(`Keine JSON-Dateien in ${dataDir} gefunden.`);

  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt, iterations);

  for (const name of files) {
    const source = path.join(dataDir, name);
    const plaintext = await readFile(source, 'utf8');
    await writeFile(`${source}.enc`, `${JSON.stringify(encryptString(key, plaintext))}\n`, 'utf8');
    await rm(source);
  }

  const config = {
    v: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: salt.toString('base64'),
    check: encryptString(key, CHECK_PLAINTEXT),
  };
  await writeFile(path.join(dataDir, 'access.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return files;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const password = process.env.SITE_PASSWORD;
  if (!password) {
    console.error('Fehler: Umgebungsvariable SITE_PASSWORD ist nicht gesetzt.');
    console.error('In GitHub: Settings → Secrets and variables → Actions → Secret «SITE_PASSWORD» anlegen.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Fehler: SITE_PASSWORD muss mindestens 8 Zeichen lang sein.');
    process.exit(1);
  }

  const files = await protectDirectory(args.dir, password, args.iterations);
  console.log(`Zugangsschutz aktiv (${args.iterations} PBKDF2-Runden).`);
  files.forEach((name) => console.log(`  verschlüsselt: data/${name} → data/${name}.enc`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
