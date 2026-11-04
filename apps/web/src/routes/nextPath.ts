// The `next` parameter on /login: where to go after signing in. It comes from the
// address bar, so it is untrusted. Only a path on this origin is allowed: anything
// that could leave the site (scheme-relative "//host", "/\host", absolute URLs,
// javascript: and friends) falls back to the landing page.

const FALLBACK = "/";

function hasControlOrBackslash(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || raw[i] === "\\") return true;
  }
  return false;
}

export function safeNextPath(raw: string | null | undefined, origin: string): string {
  if (!raw) return FALLBACK;
  // Must be a path on this site: a single leading slash, and not "//" or "/\"
  // (browsers read a backslash as a slash, so "/\evil.com" is "//evil.com").
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return FALLBACK;
  // Control characters and backslashes never belong in a path; they are how
  // parser differences get exploited.
  if (hasControlOrBackslash(raw)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== origin) return FALLBACK;
  // Never send a signed-in Learner back to the login page itself.
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return FALLBACK;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The login URL that brings the Learner back to `from` (omitted when that is the landing page). */
export function loginPathFor(from: string): string {
  return from === FALLBACK || from === "" ? "/login" : `/login?next=${encodeURIComponent(from)}`;
}
