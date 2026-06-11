/**
 * Anonymous session: cookie + display name (localStorage mirror for UI).
 */
import {
  isValidDisplayName,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
} from "./client-state.js";

const API_FETCH = { credentials: "include", cache: "no-store" };

export async function bootstrapSession() {
  const res = await fetch("/api/me/", API_FETCH);
  if (!res.ok) throw new Error("Session bootstrap failed");
  const data = await res.json();

  const cachedUuid = safeGetItem("bbl_session_uuid");
  if (cachedUuid && data.session_uuid && cachedUuid !== data.session_uuid) {
    safeRemoveItem("bbl_anon_name");
  }

  if (data.anonymous_name && isValidDisplayName(data.anonymous_name)) {
    safeSetItem("bbl_anon_name", data.anonymous_name);
  } else {
    safeRemoveItem("bbl_anon_name");
  }
  if (data.session_uuid) {
    safeSetItem("bbl_session_uuid", data.session_uuid);
  }
  return data;
}

export async function updateDisplayName(anonymousName) {
  const res = await fetch("/api/me/", {
    ...API_FETCH,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anonymous_name: anonymousName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.anonymous_name?.[0] || err.detail || "Could not save name";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const data = await res.json();
  if (data.anonymous_name && isValidDisplayName(data.anonymous_name)) {
    safeSetItem("bbl_anon_name", data.anonymous_name);
  }
  return data;
}

export function cachedDisplayName() {
  const name = safeGetItem("bbl_anon_name");
  return isValidDisplayName(name) ? name.trim() : "";
}

export function showWhoami() {
  const el = document.getElementById("whoami");
  if (!el) return;
  const n = cachedDisplayName();
  if (!n) {
    el.hidden = true;
    return;
  }
  el.textContent = n;
  el.hidden = false;
}
