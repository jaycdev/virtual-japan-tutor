// The platform half of the fallback lives in platformDefault.ts (the Android
// emulator address).
import { platformApiDefault } from "./platformDefault.ts";

/**
 * Resolve the API base URL for the client. Precedence (#51 review B1):
 *
 *   1. an in-app override the Learner saved (issue #11: mobile has no
 *      same-origin fallback); a stored value that no longer validates is
 *      treated as unset;
 *   2. EXPO_PUBLIC_API_URL baked into the build — the dev opt-in, for
 *      pointing a dev build at the Go server;
 *   3. the platform default: the host machine as seen from the emulator.
 *
 * `platformDefault` overrides step 3 so tests can pin either side of the
 * split; callers omit it.
 */
export function resolveApiBaseUrl(
  env: { EXPO_PUBLIC_API_URL?: string | undefined },
  storedUrl?: string | null,
  platformDefault?: string,
): string {
  const stored = storedUrl ? normalizeServerUrl(storedUrl) : null;
  const url = stored || env.EXPO_PUBLIC_API_URL || platformDefault || platformApiDefault();
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
