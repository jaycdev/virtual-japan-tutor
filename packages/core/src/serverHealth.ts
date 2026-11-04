// The pre-commit reachability probe for a candidate server address (mobile
// Server settings, review S1). It uses a plain fetch on purpose: the app's
// ApiClient still points at the OLD server while a new address is being checked.

export const PROBE_TIMEOUT_MS = 5000;

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Pick<Response, "ok" | "status">>;

/**
 * One GET /health against the candidate. Any 2xx counts as "this is a Virtual
 * Japan Tutor server"; degraded included, because the address itself was right.
 * Resolves to the message to show when the address is refused, or undefined when
 * it may be committed. Never rejects.
 */
export async function probeServerHealth(
  baseUrl: string,
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal });
    if (response.ok) return undefined;
    return `That address answered ${response.status} instead of a healthy /health. It does not look like a Virtual Japan Tutor server — the current address is still in use.`;
  } catch {
    return "That address did not answer. Check the host and port — the current address is still in use.";
  } finally {
    clearTimeout(timer);
  }
}
