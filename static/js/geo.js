/** Browser geolocation helpers. */

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
      return "Location blocked. Allow it in your browser site settings, then reload.";
    }
    if (code === 2) {
      return "Could not determine position. Turn on device location services.";
    }
    if (code === 3) {
      return "Location timed out. Try again.";
    }
  }
  if (err instanceof Error && err.message === "Geolocation not supported") {
    return "Geolocation is not supported in this browser.";
  }
  return "Location unavailable. Check permissions and try again.";
}

export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      {
        enableHighAccuracy: options.enableHighAccuracy ?? false,
        maximumAge: options.maximumAge ?? 120_000,
        timeout: options.timeout ?? 25_000,
        ...options,
      }
    );
  });
}
