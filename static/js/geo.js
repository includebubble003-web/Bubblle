/** Browser geolocation — prompt quickly, then refine. */

export const POS_CACHE_KEY = "bbl_last_pos";

const FAST_OPTS = {
  enableHighAccuracy: false,
  maximumAge: 120_000,
  timeout: 8_000,
};

const WATCH_OPTS = {
  enableHighAccuracy: false,
  maximumAge: 120_000,
  timeout: 10_000,
};

export function isGeolocationContextOk() {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export function secureContextHint() {
  const host = window.location.hostname;
  const proto = window.location.protocol;
  if (isGeolocationContextOk()) return "";
  if (proto === "http:" && host !== "localhost" && host !== "127.0.0.1") {
    return `Location requires HTTPS or localhost (not http://${host}).`;
  }
  return "This page cannot use location in an insecure context.";
}

export function formatGeolocationError(err) {
  if (err && typeof err === "object" && "code" in err) {
    const code = /** @type {GeolocationPositionError} */ (err).code;
    if (code === 1) {
      return "Location blocked. Allow it in site settings, then reload.";
    }
    if (code === 2) {
      return "Turn on device location services and try again.";
    }
    if (code === 3) {
      return "Location timed out. Move near a window or try again.";
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Location unavailable. Check permissions and try again.";
}

export function readCachedPosition() {
  try {
    const raw = sessionStorage.getItem(POS_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.lat === "number" && typeof p?.lng === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

export function cachePosition(p) {
  try {
    sessionStorage.setItem(POS_CACHE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function toPoint(pos) {
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
}

/** @returns {Promise<'granted'|'prompt'|'denied'|null>} */
export async function geolocationPermissionState() {
  if (!navigator.permissions?.query) return null;
  try {
    const r = await navigator.permissions.query({ name: "geolocation" });
    return /** @type {'granted'|'prompt'|'denied'} */ (r.state);
  } catch {
    return null;
  }
}

/**
 * Acquire location: cache → immediate getCurrentPosition (prompt) → watchPosition.
 * Calls onUpdate for each useful fix. Returns cleanup function.
 *
 * @param {{ onUpdate: (p: {lat:number,lng:number}, meta: {source:string}) => void, onError?: (err: unknown) => void, onStatus?: (s: string) => void }} handlers
 */
export function acquireLocation({ onUpdate, onError, onStatus }) {
  if (!navigator.geolocation) {
    onError?.(new Error("Geolocation not supported"));
    return () => {};
  }
  if (!isGeolocationContextOk()) {
    onError?.(new Error(secureContextHint()));
    return () => {};
  }

  let watchId = null;
  let fallbackTimer = null;
  let gotFix = false;
  let cleaned = false;
  let reportedError = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (fallbackTimer) clearTimeout(fallbackTimer);
  };

  const deliver = (p, source) => {
    const point = { lat: p.lat, lng: p.lng };
    cachePosition(point);
    onUpdate(point, { source });
  };

  const handleSuccess = (pos, source) => {
    if (gotFix) return;
    gotFix = true;
    onStatus?.("fast");
    deliver(toPoint(pos), source);
    cleanup();
    refineInBackground(onUpdate);
  };

  const handleError = (err) => {
    if (gotFix || reportedError) return;
    reportedError = true;
    cleanup();
    onError?.(err);
    onStatus?.("error");
  };

  const cached = readCachedPosition();
  if (cached) {
    gotFix = true;
    onStatus?.("cached");
    deliver(cached, "cached");
  }

  // Do not wait on Permissions API — getCurrentPosition triggers the browser prompt immediately.
  const requestFix = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => handleSuccess(pos, "fast"),
      (err) => handleError(err),
      FAST_OPTS
    );
  };

  if (!gotFix) {
    onStatus?.("prompt");
    requestFix();
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!gotFix) handleSuccess(pos, "fast");
    },
    () => {},
    WATCH_OPTS
  );

  // Permissions API only updates status text (denied → clear message without waiting on timeouts).
  geolocationPermissionState().then((perm) => {
    if (perm === "granted" && !gotFix) onStatus?.("detecting");
    else if (perm === "prompt" && !gotFix) onStatus?.("prompt");
    else if (perm === "denied" && !gotFix) {
      onStatus?.("error");
      setTimeout(() => {
        if (!gotFix && !reportedError) {
          handleError(new Error("Location blocked. Allow it in site settings, then reload."));
        }
      }, 400);
    }
  });

  fallbackTimer = setTimeout(() => {
    if (gotFix || cleaned || reportedError) return;
    requestFix();
  }, 3_000);

  return cleanup;
}

function refineInBackground(onUpdate) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const p = toPoint(pos);
      onUpdate({ lat: p.lat, lng: p.lng }, { source: "refined" });
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }
  );
}

/** @deprecated use acquireLocation */
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    const stop = acquireLocation({
      onUpdate: (p) => {
        stop();
        resolve(p);
      },
      onError: (e) => {
        stop();
        reject(e);
      },
    });
  });
}
