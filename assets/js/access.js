/**
 * Zugangsschutz im Browser.
 *
 * GitHub Pages kann kein HTTP-Basic-Auth (kein konfigurierbarer Server).
 * Deshalb werden die Datendateien beim Deployment verschlüsselt
 * (`scripts/protect-site.mjs`, AES-256-GCM) und hier wieder entschlüsselt:
 * Aus dem eingegebenen Passwort wird per PBKDF2-SHA-256 derselbe Schlüssel
 * abgeleitet. Ohne Passwort liefert die Website nur Chiffretext.
 *
 * Liegt keine `data/access.json` vor (lokale Entwicklung), ist die Seite
 * ungeschützt und die Daten werden unverändert als Klartext geladen.
 */

import { siteUrl } from './paths.js';

const CHECK_PLAINTEXT = 'winterthur-council-tools';
const STORAGE_KEY = 'wct.access.key';
const FORMAT_VERSION = 1;

let configPromise = null;
let keyPromise = null;

/** @param {string} value @returns {Uint8Array} */
function fromBase64(value) {
  const binary = atob(String(value ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {ArrayBuffer} buffer @returns {string} */
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function subtle() {
  const api = globalThis.crypto && globalThis.crypto.subtle;
  if (!api) {
    throw new Error(
      'Verschlüsselung ist in diesem Kontext nicht verfügbar. Die Seite muss über HTTPS aufgerufen werden.',
    );
  }
  return api;
}

/**
 * Lädt die Zugangskonfiguration. `null` = Seite ist nicht geschützt.
 * @returns {Promise<object|null>}
 */
export function loadAccessConfig() {
  if (!configPromise) {
    configPromise = fetch(siteUrl('data/access.json'), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((config) => {
        if (config && config.v !== FORMAT_VERSION) {
          throw new Error(`Unbekannte Version des Zugangsschutzes: ${config.v}`);
        }
        return config;
      })
      .catch(() => null);
  }
  return configPromise;
}

/** Leitet den AES-GCM-Schlüssel aus dem Passwort ab. */
async function deriveKey(password, config) {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(config.salt),
      iterations: config.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt'],
  );
}

/**
 * Entschlüsselt eine Nutzlast `{ iv, data }` und gibt den Klartext zurück.
 * @returns {Promise<string>}
 */
async function decryptPayload(key, payload) {
  if (!payload || typeof payload.iv !== 'string' || typeof payload.data !== 'string') {
    throw new Error('Ungültige verschlüsselte Datei.');
  }
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.data),
  );
  return new TextDecoder().decode(plain);
}

/** Prüft einen Schlüssel gegen den Prüfwert aus `access.json`. */
async function keyMatches(key, config) {
  try {
    return (await decryptPayload(key, config.check)) === CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}

/** Holt einen zwischengespeicherten Schlüssel aus der Sitzung (falls gültig). */
async function restoreKey(config) {
  let stored = null;
  try {
    stored = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // Speicher gesperrt (z.B. strikte Browser-Einstellungen)
  }
  if (!stored) return null;
  try {
    const key = await subtle().importKey('raw', fromBase64(stored), { name: 'AES-GCM' }, true, [
      'decrypt',
    ]);
    if (await keyMatches(key, config)) return key;
  } catch {
    /* unbrauchbarer Eintrag */
  }
  forgetKey();
  return null;
}

/** Legt den Schlüssel für die laufende Sitzung ab (nur `sessionStorage`). */
async function rememberKey(key) {
  try {
    sessionStorage.setItem(STORAGE_KEY, toBase64(await subtle().exportKey('raw', key)));
  } catch {
    /* ohne Zwischenspeicher wird bei jedem Seitenwechsel neu gefragt */
  }
}

/** Entfernt den zwischengespeicherten Schlüssel. */
export function forgetKey() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nichts zu tun */
  }
}

/** Baut den Passwort-Dialog und löst mit dem abgeleiteten Schlüssel auf. */
function askForPassword(config) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'access-gate';
    overlay.innerHTML = `
      <form class="access-card" novalidate>
        <h1>Zugang geschützt</h1>
        <p>
          Diese Seite ist ein privates Angebot. Inhalte und Daten sind verschlüsselt und
          werden erst nach Eingabe des Passworts angezeigt.
        </p>
        <label for="access-password">Passwort</label>
        <input id="access-password" name="password" type="password" autocomplete="current-password"
               required autofocus />
        <p class="access-error" role="alert" hidden></p>
        <button type="submit">Entsperren</button>
      </form>`;

    const form = overlay.querySelector('form');
    const input = overlay.querySelector('#access-password');
    const error = overlay.querySelector('.access-error');
    const button = overlay.querySelector('button');

    const showError = (message) => {
      error.textContent = message;
      error.hidden = false;
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = input.value;
      if (!password) {
        showError('Bitte Passwort eingeben.');
        return;
      }
      button.disabled = true;
      input.disabled = true;
      error.hidden = true;
      button.textContent = 'Wird geprüft …';
      try {
        const key = await deriveKey(password, config);
        if (await keyMatches(key, config)) {
          await rememberKey(key);
          overlay.remove();
          resolve(key);
          return;
        }
        showError('Falsches Passwort.');
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Entsperren fehlgeschlagen.');
      }
      button.disabled = false;
      input.disabled = false;
      button.textContent = 'Entsperren';
      input.value = '';
      input.focus();
    });

    document.body.append(overlay);
    input.focus();
  });
}

/** Liefert den Schlüssel — aus der Sitzung oder über den Passwort-Dialog. */
function getKey(config) {
  if (!keyPromise) {
    keyPromise = restoreKey(config)
      .then((key) => key || askForPassword(config))
      .catch((err) => {
        keyPromise = null;
        throw err;
      });
  }
  return keyPromise;
}

/**
 * Stellt sicher, dass die Seite entsperrt ist. Bei ungeschützten Deployments
 * (keine `data/access.json`) passiert nichts.
 * @returns {Promise<boolean>} ob die Seite geschützt ist
 */
export async function ensureAccess() {
  const config = await loadAccessConfig();
  if (!config) return false;
  document.documentElement.dataset.access = 'locked';
  await getKey(config);
  document.documentElement.dataset.access = 'unlocked';
  return true;
}

/**
 * Lädt eine JSON-Datei relativ zur Website-Basis — bei geschütztem Deployment
 * die verschlüsselte Variante (`<pfad>.enc`), sonst den Klartext.
 * @param {string} relPath z.B. 'data/members.json'
 * @returns {Promise<object>}
 */
export async function fetchJson(relPath) {
  const config = await loadAccessConfig();
  if (!config) {
    const res = await fetch(siteUrl(relPath));
    if (!res.ok) throw new Error(`${relPath}: HTTP ${res.status}`);
    return res.json();
  }

  const key = await getKey(config);
  const res = await fetch(siteUrl(`${relPath}.enc`));
  if (!res.ok) throw new Error(`${relPath}: HTTP ${res.status}`);
  return JSON.parse(await decryptPayload(key, await res.json()));
}
