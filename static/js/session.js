/**
 * Shared anonymous session bootstrap (HttpOnly cookie + display name cache).
 */
export async function bootstrapSession() {
  const res = await fetch("/api/me/", { credentials: "include" });
  if (!res.ok) throw new Error("Session bootstrap failed");
  const data = await res.json();
  if (data.anonymous_name) {
    localStorage.setItem("bbl_anon_name", data.anonymous_name);
    localStorage.setItem("bbl_session_uuid", data.session_uuid);
  }
  return data;
}

export function cachedDisplayName() {
  return localStorage.getItem("bbl_anon_name") || "…";
}

export function showWhoami() {
  const el = document.getElementById("whoami");
  if (!el) return;
  const n = cachedDisplayName();
  el.textContent = n;
  el.hidden = false;
}
