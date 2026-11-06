/**
 * The server speaks English whatever the Learner's Interface Language says (it
 * is one server shared by both apps, and its logs stay greppable). So the
 * failure lines a request shows are mapped here: English keeps showing the
 * server's own sentence, and Japanese substitutes a translated line for the
 * code — one generic sentence per code, since the server varies its English
 * per endpoint ("unknown item kind", "bad story id", …) and the message a
 * Learner can act on is about the code, not the wording.
 *
 * Unknown codes, and any non-Japanese language, fall back to the caller's
 * fallbackMessage: the server's words, which today is all Learners ever see.
 */

import type { PracticeExercise } from "@vjt/api-client";
import type { InterfaceLanguage } from "./language.ts";
import { translatePlain } from "./translate.ts";
import type { StringKey } from "./strings.ts";

/**
 * Every `code` the Go API can answer with (httpapi, story, practice,
 * itemlist, progress handlers). The i18n test walks this list against the
 * table, so a new server code has to show up here to pass CI.
 */
export const ERROR_CODES = [
  "bad_request",
  "internal",
  "unauthorized",
  "invalid_credentials",
  "too_many_attempts",
  "payload_too_large",
  "not_found",
  "invalid_settings",
  "invalid_rating",
  "story_not_ready",
  "invalid_question",
  "invalid_answer",
  "invalid_input",
  "invalid_threshold",
  "invalid_preference",
  "invalid_timezone",
  "generation_running",
  "no_story",
  "practice_no_items",
  "already_answered",
  "duplicate_name",
  "reserved_list",
  "invalid_key",
  "no_key",
  "sync_running",
  "invalid_level",
  "name_taken",
  "invalid_provider",
  "provider_in_use",
  "no_ai_provider",
] as const;

export type ServerErrorCode = (typeof ERROR_CODES)[number];

/** code → table entry. Filled exhaustively; TS flags a missing code at build. */
const ERROR_STRINGS: Record<ServerErrorCode, StringKey> = {
  bad_request: "errors.bad_request",
  internal: "errors.internal",
  unauthorized: "errors.unauthorized",
  invalid_credentials: "errors.invalid_credentials",
  too_many_attempts: "errors.too_many_attempts",
  payload_too_large: "errors.payload_too_large",
  not_found: "errors.not_found",
  invalid_settings: "errors.invalid_settings",
  invalid_rating: "errors.invalid_rating",
  story_not_ready: "errors.story_not_ready",
  invalid_question: "errors.invalid_question",
  invalid_answer: "errors.invalid_answer",
  invalid_input: "errors.invalid_input",
  invalid_threshold: "errors.invalid_threshold",
  invalid_preference: "errors.invalid_preference",
  invalid_timezone: "errors.invalid_timezone",
  generation_running: "errors.generation_running",
  no_story: "errors.no_story",
  practice_no_items: "errors.practice_no_items",
  already_answered: "errors.already_answered",
  duplicate_name: "errors.duplicate_name",
  reserved_list: "errors.reserved_list",
  invalid_key: "errors.invalid_key",
  no_key: "errors.no_key",
  sync_running: "errors.sync_running",
  invalid_level: "errors.invalid_level",
  name_taken: "errors.name_taken",
  invalid_provider: "errors.invalid_provider",
  provider_in_use: "errors.provider_in_use",
  no_ai_provider: "errors.no_ai_provider",
};

/**
 * The line for a failed request: English shows the server's own message;
 * Japanese shows the code's translated line, falling back to the server's
 * message for codes this table has never seen.
 */
export function errorMessage(
  lang: InterfaceLanguage,
  code: string | undefined | null,
  fallbackMessage: string,
): string {
  if (lang === "en" || code === undefined || code === null) return fallbackMessage;
  const key = (ERROR_STRINGS as Record<string, StringKey | undefined>)[code];
  return key === undefined ? fallbackMessage : translatePlain(lang, key);
}

/** The `code` off an api-client error body, whatever the error type was narrowed to. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** The transport failure line: no response came back at all. */
export function failureText(lang: InterfaceLanguage): string {
  return translatePlain(lang, "errors.unreachable");
}

/** A failed request with nothing to show but its status: "Request failed (503)". */
export function httpFailureText(lang: InterfaceLanguage, status: number): string {
  return translatePlain(lang, "errors.failedStatus", { status });
}

/**
 * The exercise kinds the practice generator can put on the wire — every
 * member of the generated schema's `kind` union. The i18n test checks each
 * one has an entry, so a new generator kind fails CI until it is translated.
 */
export type ExerciseKind = PracticeExercise["kind"];

export const EXERCISE_KINDS: readonly ExerciseKind[] = ["recognition", "grammar_cloze"];

const EXERCISE_STRINGS: Record<ExerciseKind, StringKey> = {
  recognition: "exercise.recognition",
  grammar_cloze: "exercise.grammar_cloze",
};

/**
 * The instruction over an exercise: English keeps the server's own sentence
 * (what the Learner reads today), Japanese uses the translated line. An
 * unknown kind — a newer server than this client — falls back to the
 * server's message.
 */
export function exerciseInstruction(
  lang: InterfaceLanguage,
  kind: ExerciseKind | string,
  fallbackMessage: string,
): string {
  if (lang === "en") return fallbackMessage;
  const key = (EXERCISE_STRINGS as Record<string, StringKey | undefined>)[kind];
  return key === undefined ? fallbackMessage : translatePlain(lang, key);
}
