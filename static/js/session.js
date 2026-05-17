/**
 * Anonymous session: cookie + display name (localStorage mirror for UI).
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

export async function updateDisplayName(anonymousName) {
  const res = await fetch("/api/me/", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anonymous_name: anonymousName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.anonymous_name?.[0] || err.detail || "Could not save name";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const data = await res.json();
  localStorage.setItem("bbl_anon_name", data.anonymous_name);
  return data;
}

export function cachedDisplayName() {
  return localStorage.getItem("bbl_anon_name") || "";
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
