// The `next` parameter on /login: where to go after signing in. It comes from the
// address bar, so it is untrusted. Only a path on this origin is allowed: anything
// that could leave the site (scheme-relative "//host", "/\host", absolute URLs,
// javascript: and friends) falls back to the landing page.

const FALLBACK = "/";

/** A path we are willing to navigate to: one leading slash, no "//" or "/\" start, no backslash or control characters. */
function isSafePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return false;
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || path[i] === "\\") return false;
  }
  return true;
}

export function safeNextPath(raw: string | null | undefined, origin: string): string {
  if (!raw) return FALLBACK;
  // Check the input before parsing, and then the parsed result again: URL parsing
  // normalises dot segments, so "/.//evil.example.com" and "/%2e%2e//evil.example.com"
  // come out as "//evil.example.com" and must be rejected at that point.
  if (!isSafePath(raw)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== origin) return FALLBACK;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!isSafePath(path)) return FALLBACK;
  // Never send a signed-in Learner back to the login page itself.
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return FALLBACK;
  return path;
}

/** The login URL that brings the Learner back to `from` (omitted when that is the landing page). */
export function loginPathFor(from: string): string {
  return from === FALLBACK || from === "" ? "/login" : `/login?next=${encodeURIComponent(from)}`;
}
