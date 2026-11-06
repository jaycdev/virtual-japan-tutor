// How the hooks remember a failure (issue #125, branch review B1).
//
// Hooks store failures in this language-independent shape, never as a
// translated string: translating on storage would bake one Interface Language
// into the state and force every fetch to re-run when the Learner switches.
// A state hook renders its `message` from here at return time, so a switch
// re-labels the failure it already holds without touching the server; an
// action hook translates at call time, because a one-shot toast belongs to
// the language it was produced in.

import type { InterfaceLanguage } from "./language.ts";
import { errorMessage } from "./errorMessages.ts";
import { translate, translatePlain } from "./translate.ts";

/** A key of the string table, for failures that carry their own line. */
export type TableKey = Parameters<typeof translate>[1];

/** A failure as the hooks hold it: untranslated, ready to render in any language. */
export type Failure =
  /** The server (or the fetch transport) answered; show its words in English. */
  | { source: "server"; code?: string; message: string }
  /** No response came back: offline, DNS dead, the server down. */
  | { source: "unreachable" }
  /** Our own line from the string table, with its {placeholders}. */
  | { source: "table"; key: TableKey; params?: Record<string, string | number> };

/** The transport failure every hook falls back to. */
export const UNREACHABLE_FAILURE: Failure = { source: "unreachable" };

/**
 * A failed openapi-fetch call: the server's own body when there is one, the
 * table's status line when there is not. `error` is the parsed error body
 * (`{code, message}`), `status` the HTTP status.
 */
export function apiFailure(
  error: { code?: string; message?: string } | undefined,
  status: number,
  fallbackKey: TableKey = "errors.failedStatus",
): Failure {
  if (error?.message) return { source: "server", code: error.code, message: error.message };
  return { source: "table", key: fallbackKey, params: { status } };
}

/** Render a stored failure in the Learner's Interface Language. */
export function renderFailure(language: InterfaceLanguage, failure: Failure): string {
  switch (failure.source) {
    case "server":
      return errorMessage(language, failure.code, failure.message);
    case "unreachable":
      return translatePlain(language, "errors.unreachable");
    case "table":
      return translatePlain(language, failure.key, failure.params);
  }
}
