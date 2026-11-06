// The pre-commit reachability probe for a candidate server address (mobile
// Server settings, review S1). It uses a plain fetch on purpose: the app's
// ApiClient still points at the OLD server while a new address is being checked.

import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "./i18n/language.ts";
import { translatePlain } from "./i18n/translate.ts";

export const PROBE_TIMEOUT_MS = 5000;

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Pick<Response, "ok" | "status">>;

/**
 * One GET /health against the candidate. Any 2xx counts as "this is a Virtual
 * Japan Tutor server"; degraded included, because the address itself was right.
 * Resolves to the message to show when the address is refused, or undefined when
 * it may be committed. Never rejects. The message is in the Learner's Interface
 * Language; the address and status inside it are the server's own data.
 */
export async function probeServerHealth(
  baseUrl: string,
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
  timeoutMs = PROBE_TIMEOUT_MS,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal });
    if (response.ok) return undefined;
    return translatePlain(lang, "serverHealth.answered", { status: response.status });
  } catch {
    return translatePlain(lang, "serverHealth.noAnswer");
  } finally {
    clearTimeout(timer);
  }
}
