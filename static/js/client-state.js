/**
 * Versioned client storage — migrate/clear stale data on app upgrades.
 */

export const CLIENT_STORAGE_VERSION = 2;
const VERSION_KEY = "bbl_client_version";

const LOCAL_KEYS = ["bbl_anon_name", "bbl_session_uuid"];
const SESSION_KEYS = ["bbl_last_pos"];

function targetClientVersion() {
  const fromWindow = Number(window.__BUBBLLE_CLIENT_VERSION__);
  if (Number.isFinite(fromWindow) && fromWindow > 0) return fromWindow;
  return CLIENT_STORAGE_VERSION;
}

function clearKeys(storage, keys) {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function clearLegacySessionKeys() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("bubble-intro-")) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

function migrateFromVersion(fromVersion) {
  if (fromVersion < 2) {
    clearKeys(sessionStorage, SESSION_KEYS);
    clearLegacySessionKeys();

    const name = safeGetItem("bbl_anon_name");
    if (name && !isValidDisplayName(name)) {
      safeRemoveItem("bbl_anon_name");
    }
  }
}

/** Run once at app boot before reading cached session/location. */
export function initClientStorage() {
  const expected = targetClientVersion();
  try {
    const raw = localStorage.getItem(VERSION_KEY);
    const stored = raw ? Number.parseInt(raw, 10) : 0;
    const fromVersion = Number.isFinite(stored) ? stored : 0;

    if (fromVersion !== expected) {
      migrateFromVersion(fromVersion);
      localStorage.setItem(VERSION_KEY, String(expected));
    }
  } catch {
    clearKeys(localStorage, [...LOCAL_KEYS, VERSION_KEY]);
    clearKeys(sessionStorage, SESSION_KEYS);
    clearLegacySessionKeys();
  }
}

export function safeGetItem(key) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? "" : String(value);
  } catch {
    return "";
  }
}

export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function isValidDisplayName(name) {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 64;
}

export function readJsonSessionItem(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function writeJsonSessionItem(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
