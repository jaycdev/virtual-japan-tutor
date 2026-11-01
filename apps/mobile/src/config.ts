// 10.0.2.2 is the host machine as seen from the Android emulator.
const DEFAULT_API_URL = "http://10.0.2.2:8080";

/**
 * Resolve the API base URL for the client. Priority: an in-app override the Learner
 * saved (issue #11 server-connection requirement: mobile has no same-origin fallback),
 * then EXPO_PUBLIC_API_URL baked into the build, then the emulator default.
 * A stored value that no longer validates is treated as unset.
 */
export function resolveApiBaseUrl(
  env: { EXPO_PUBLIC_API_URL?: string | undefined },
  storedUrl?: string | null,
): string {
  const stored = storedUrl ? normalizeServerUrl(storedUrl) : null;
  const url = stored || env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;
  return url.replace(/\/+$/, "");
}

/**
 * Validate a user-entered server address: an absolute http/https URL, trailing slashes
 * trimmed. Returns null for anything else so the UI can show its own message.
 */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // Embedded credentials would leak into the on-screen "Server:" lines and into
  // every request's URL; the API never needs them (auth is via bearer token).
  if (parsed.username || parsed.password) return null;
  return trimmed.replace(/\/+$/, "");
}
