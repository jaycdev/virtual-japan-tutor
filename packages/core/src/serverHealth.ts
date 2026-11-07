// The pre-commit reachability probe for a candidate server address (mobile
// Server settings, review S1). It uses a plain fetch on purpose: the app's
// ApiClient still points at the OLD server while a new address is being checked.

import type { EntryRef } from "./i18n/translate.ts";

export const PROBE_TIMEOUT_MS = 5000;

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Pick<Response, "ok" | "status">>;

/**
 * One GET /health against the candidate. Any 2xx counts as "this is a Virtual
 * Japan Tutor server"; degraded included, because the address itself was right.
 * Resolves to the string-table entry to show when the address is refused, or
 * undefined when it may be committed. Never rejects. The entry stays unresolved
 * on purpose: the caller holds it in state and the note follows the Interface
 * Language. The address and status inside it are the server's own data.
 */
export async function probeServerHealth(
  baseUrl: string,
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<EntryRef | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal });
    if (response.ok) return undefined;
    return { k: "serverHealth.answered", params: { status: response.status } };
  } catch {
    return { k: "serverHealth.noAnswer" };
  } finally {
    clearTimeout(timer);
  }
}
