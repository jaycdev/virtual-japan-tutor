// Every top-level API path in api/openapi.yaml, proxied to the Go server in development
// (vite.config.ts). Written out by hand, not read from the spec at runtime;
// src/vite-proxy.test.ts fails when the spec and this list disagree. Kept in its own
// module so the test can import it without loading the Vite config.
export const API_PREFIXES = [
  "health",
  "auth",
  "me",
  "grammar",
  "ai-providers",
  "ai-tasks",
  "marumori",
  "starting-level",
  "focus-set",
  "practice",
  "stories",
  "story-settings",
  "reading-settings",
  "item-lists",
  "weak-signals",
  "dictionary",
];
