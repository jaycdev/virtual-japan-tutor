// The platform half of the fallback lives in the platformDefault split
// (platformDefault.ts for web, platformDefault.native.ts for the Android
// bundle). The import stays extensionless on purpose — "./platformDefault.ts"
// would pin the web file for every platform, leaking window.location into
// the Android bundle and the emulator address into the web one. Same rule
// and precedent as src/secureStore.
import { platformApiDefault } from "./platformDefault";

/**
 * Resolve the API base URL for the client. Precedence (#51 review B1):
 *
 *   1. an in-app override the Learner saved (issue #11: mobile has no
 *      same-origin fallback); a stored value that no longer validates is
 *      treated as unset;
 *   2. EXPO_PUBLIC_API_URL baked into the build — the dev opt-in: Metro
 *      (`expo start --web`) serves no API on its own port, so web dev
 *      points the app at the Go server through this env value. The Docker
 *      web export bakes in no such value and falls straight through;
 *   3. the platform default: on web the page's own origin (the server
 *      serving the bundle also hosts the API — like the pre-#51 Vite app),
 *      on Android the host machine as seen from the emulator.
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
